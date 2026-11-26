/**
 * GymPro Production ADMS / iClock HTTP Push Server
 *
 * Receives real-time attendance logs directly from Secureye / ZKTeco ADMS
 * biometric machines over plain HTTP (port 80 / 8080) without any local PC.
 *
 * ADMS Endpoints:
 *   GET  /iclock/cdata      -> Handshake & device initialization
 *   POST /iclock/cdata      -> ATTLOG (attendance punches) & OPERLOG (op/user logs)
 *   GET  /iclock/getrequest -> Heartbeat / command polling
 *   POST /iclock/devicecmd  -> Command acknowledgment
 *
 * REST API Endpoints:
 *   GET   /api/attendance   -> Filter by from/to, employee_code, device_sn
 *   GET   /api/devices      -> List devices with live Online/Offline status
 *   PATCH /api/devices/:sn  -> Update device name & location
 *   GET   /api/debug/raw    -> Recent raw ADMS requests for pairing debug
 *   GET   /health           -> Service & DB health check
 */

import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { AdmsDatabase } from './db.js';
import {
  buildHandshakeResponse,
  getPunchStateLabel,
  getVerifyModeLabel,
  parseAttLogPayload,
  parseOperLogPayload,
} from './admsParser.js';
import {
  initFirebaseSync,
  isFirebaseSyncEnabled,
  syncDeviceHeartbeatToFirestore,
  syncPunchToFirestore,
} from './firebaseSync.js';
import {
  DEFAULT_PROBE_PORTS,
  getLocalLanIps,
  probeSecureyeDevice,
} from './lanProbe.js';
import { createWsHub } from './wsHub.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const P2P_CAPTURE_PORT = Number(process.env.P2P_CAPTURE_PORT || 0);
const API_AUTH_TOKEN = (process.env.API_AUTH_TOKEN || '').trim();

const app = express();
const httpServer = http.createServer(app);
const db = new AdmsDatabase();
const wsHub = createWsHub({ server: httpServer, db, apiAuthToken: API_AUTH_TOKEN });

app.set('trust proxy', true);
app.use(cors());

/**
 * Helper to extract real client IP behind Nginx / reverse proxies.
 */
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

/**
 * Optional API bearer/key guard for /api/* routes when API_AUTH_TOKEN is configured.
 */
function requireApiAuth(req, res, next) {
  if (!API_AUTH_TOKEN) return next();
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const apiKey = req.headers['x-api-key'] || bearer;
  if (apiKey !== API_AUTH_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Unauthorized API request' });
  }
  return next();
}

// ============================================================================
// ADMS / iClock Raw Body Middleware (accepts text/plain, missing headers, etc.)
// ============================================================================
app.use(
  '/iclock',
  express.raw({
    type: () => true,
    limit: '5mb',
  })
);

// Standard JSON parsing for REST API endpoints only
app.use('/api', express.json({ limit: '1mb' }));

/**
 * Clean request logger for all incoming /iclock/* hardware calls.
 */
async function recordAdmsDebugLog(req, rawBody, statusCode = 200) {
  const sn = String(req.query.SN || req.query.sn || '').trim() || null;
  const queryString = req.originalUrl.includes('?') ? req.originalUrl.split('?')[1] : '';
  const remoteIp = getClientIp(req);
  const contentType = String(req.headers['content-type'] || 'none');

  const bodyPreview = rawBody
    ? rawBody.replace(/\r/g, '').slice(0, 300).replace(/\n/g, ' \\n ')
    : '(empty)';

  console.log(
    `[ADMS] ${new Date().toISOString()} | ${req.method} ${req.originalUrl} | SN=${sn || 'N/A'} | IP=${remoteIp} | CT=${contentType} | Body=${bodyPreview}`
  );

  try {
    await db.logRawRequest({
      method: req.method,
      reqPath: req.path,
      queryString,
      deviceSn: sn,
      contentType,
      remoteIp,
      rawBody,
      responseStatus: statusCode,
    });
    wsHub.broadcastLive('raw_packet', {
      method: req.method,
      path: req.path,
      query_string: queryString,
      device_sn: sn,
      remote_ip: remoteIp,
      raw_body: rawBody,
      received_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ADMS] Failed to save raw request log:', err.message);
  }
}

// ============================================================================
// 1. GET /iclock/cdata — Device Handshake / Initialization
// ============================================================================
app.get('/iclock/cdata', async (req, res) => {
  const sn = String(req.query.SN || req.query.sn || '').trim();
  const options = String(req.query.options || '').trim().toLowerCase();
  const pushVer = String(req.query.pushver || '').trim() || null;
  const remoteIp = getClientIp(req);

  await recordAdmsDebugLog(req, '', 200);

  if (sn) {
    try {
      const device = await db.upsertDeviceHeartbeat({
        serialNumber: sn,
        ipAddress: remoteIp,
        pushVersion: pushVer,
      });
      await syncDeviceHeartbeatToFirestore({ serialNumber: sn, ipAddress: remoteIp });
      wsHub.broadcastLive('device_heartbeat', {
        serial_number: sn,
        ip_address: remoteIp,
        protocol: 'adms_http',
        device,
      });
    } catch (err) {
      console.error('[ADMS GET /iclock/cdata] DB error:', err.message);
    }
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (sn && (options === 'all' || pushVer || req.query.language !== undefined)) {
    return res.status(200).send(buildHandshakeResponse(sn));
  }
  return res.status(200).send('OK');
});

// ============================================================================
// 2. POST /iclock/cdata — Real-Time Attendance (ATTLOG) & Operation (OPERLOG)
// ============================================================================
app.post('/iclock/cdata', async (req, res) => {
  const sn = String(req.query.SN || req.query.sn || '').trim() || 'UNKNOWN';
  const table = String(req.query.table || '').trim().toUpperCase();
  const remoteIp = getClientIp(req);
  const rawBody = (
    Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '')
  ).replace(/\0/g, '');

  await recordAdmsDebugLog(req, rawBody, 200);

  try {
    const device = await db.upsertDeviceHeartbeat({
      serialNumber: sn,
      ipAddress: remoteIp,
    });
    await syncDeviceHeartbeatToFirestore({ serialNumber: sn, ipAddress: remoteIp });
    wsHub.broadcastLive('device_heartbeat', {
      serial_number: sn,
      ip_address: remoteIp,
      protocol: 'adms_http',
      device,
    });

    if (table === 'ATTLOG' || table === 'RTLOG' || (!table && rawBody.includes('\t'))) {
      const { records, skipped } = parseAttLogPayload(rawBody);
      let insertedCount = 0;
      let duplicateCount = 0;

      for (const rec of records) {
        const result = await db.insertAttendancePunch({
          deviceSn: sn,
          employeeCode: rec.employeeCode,
          punchTime: rec.punchTime,
          punchState: rec.punchState,
          verifyMode: rec.verifyMode,
          workCode: rec.workCode,
          rawPayload: rec.rawPayload,
        });

        if (result.inserted) {
          insertedCount += 1;
          console.log(
            `[PUNCH SAVED] SN=${sn} | User=${rec.employeeCode} | Time=${rec.punchTime} | State=${rec.punchStateLabel} | Mode=${rec.verifyModeLabel}`
          );
          const fbRes = await syncPunchToFirestore({
            deviceSn: sn,
            employeeCode: rec.employeeCode,
            punchTime: rec.punchTime,
            verifyModeLabel: rec.verifyModeLabel,
          });
          wsHub.broadcastLive('attendance_punch', {
            device_sn: sn,
            employee_code: rec.employeeCode,
            punch_time: rec.punchTime,
            punch_state: rec.punchState,
            punch_state_label: rec.punchStateLabel,
            verify_mode: rec.verifyMode,
            verify_mode_label: rec.verifyModeLabel,
            protocol: 'adms_http',
            granted: fbRes?.granted ?? null,
          });
        } else if (result.duplicate) {
          duplicateCount += 1;
          console.log(
            `[PUNCH DUPLICATE IGNORED] SN=${sn} | User=${rec.employeeCode} | Time=${rec.punchTime}`
          );
        }
      }

      if (skipped.length > 0) {
        console.warn(`[ADMS ATTLOG] Skipped ${skipped.length} unparseable line(s) from SN=${sn}`);
      }
      console.log(
        `[ADMS ATTLOG SUMMARY] SN=${sn} | Parsed=${records.length} | Inserted=${insertedCount} | Duplicates=${duplicateCount}`
      );
    } else if (table === 'OPERLOG') {
      const parsed = parseOperLogPayload(rawBody);
      console.log(`[ADMS OPERLOG] SN=${sn} | Received ${parsed.count} operation/user log line(s)`);
    } else {
      console.log(`[ADMS OTHER TABLE] SN=${sn} | table=${table || '(none)'} | bytes=${rawBody.length}`);
    }
  } catch (err) {
    console.error('[ADMS POST /iclock/cdata] Processing error:', err);
  }

  // Strictly return plain text OK (HTTP 200) so device clears its pending queue
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).send('OK');
});

// ============================================================================
// 3. GET /iclock/getrequest — Heartbeat & Command Polling
// ============================================================================
app.get('/iclock/getrequest', async (req, res) => {
  const sn = String(req.query.SN || req.query.sn || '').trim();
  const remoteIp = getClientIp(req);

  await recordAdmsDebugLog(req, '', 200);

  if (sn) {
    try {
      const device = await db.upsertDeviceHeartbeat({
        serialNumber: sn,
        ipAddress: remoteIp,
      });
      await syncDeviceHeartbeatToFirestore({ serialNumber: sn, ipAddress: remoteIp });
      wsHub.broadcastLive('device_heartbeat', {
        serial_number: sn,
        ip_address: remoteIp,
        protocol: 'adms_http',
        device,
      });
    } catch (err) {
      console.error('[ADMS GET /iclock/getrequest] DB error:', err.message);
    }
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).send('OK');
});

// ============================================================================
// 4. POST /iclock/devicecmd — Command Acknowledgment
// ============================================================================
app.post('/iclock/devicecmd', async (req, res) => {
  const sn = String(req.query.SN || req.query.sn || '').trim();
  const rawBody = (
    Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '')
  ).replace(/\0/g, '');

  await recordAdmsDebugLog(req, rawBody, 200);

  if (sn) {
    try {
      await db.upsertDeviceHeartbeat({
        serialNumber: sn,
        ipAddress: getClientIp(req),
      });
    } catch (err) {
      console.error('[ADMS POST /iclock/devicecmd] DB error:', err.message);
    }
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).send('OK');
});

// ============================================================================
// REST API Endpoints for Web App & Monitoring Dashboard
// ============================================================================

app.get('/health', async (_req, res) => {
  try {
    const devices = await db.listDevices();
    const lanIps = getLocalLanIps();
    res.status(200).json({
      ok: true,
      service: 'dream-gym-adms-bridge',
      database: db.mode,
      firebaseSyncEnabled: isFirebaseSyncEnabled(),
      registeredDevices: devices.length,
      onlineDevices: devices.filter((d) => d.is_online).length,
      listenPort: PORT,
      lanIps: lanIps.map((item) => item.address),
      lanInterfaces: lanIps,
      websocketEnabled: true,
      wsBiometricPath: '/biometric',
      wsLivePath: '/ws/live',
      cloudRun: Boolean(process.env.K_SERVICE),
      liveClients: wsHub.getLiveClientCount(),
      connectedWsDevices: wsHub.listConnectedWsDevices(),
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// Plain HTTP request to /biometric informs callers to upgrade to WebSocket (RFC 6455)
app.get('/biometric', (_req, res) => {
  res.status(426).json({
    ok: false,
    error: 'Upgrade Required',
    protocol: 'websocket',
    endpoint: '/biometric',
    message: 'This endpoint accepts Secureye WebSocket client connections (wss://<HOST>/biometric).',
  });
});

app.get('/api/ws/devices', requireApiAuth, (_req, res) => {
  const connected = wsHub.listConnectedWsDevices();
  res.status(200).json({ ok: true, count: connected.length, devices: connected });
});

app.post('/api/ws/send', requireApiAuth, (req, res) => {
  const { serial_number, command } = req.body || {};
  if (!serial_number || !command) {
    return res.status(400).json({ ok: false, error: 'serial_number and command are required.' });
  }
  const result = wsHub.sendCommandToWsDevice(serial_number, command);
  if (!result.ok) {
    return res.status(404).json(result);
  }
  return res.status(200).json(result);
});

app.get('/api/lan/probe', requireApiAuth, async (req, res) => {
  try {
    const ip = String(req.query.ip || process.env.SECUREYE_DEVICE_IP || '192.168.1.101').trim();
    const rawPorts = String(req.query.ports || '').trim();
    const ports = rawPorts
      ? rawPorts
          .split(',')
          .map((p) => Number(p.trim()))
          .filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535)
      : DEFAULT_PROBE_PORTS;

    const report = await probeSecureyeDevice(ip, ports.length ? ports : DEFAULT_PROBE_PORTS);
    res.status(200).json(report);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/devices', requireApiAuth, async (_req, res) => {
  try {
    const devices = await db.listDevices();
    res.status(200).json({ ok: true, count: devices.length, devices });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/devices', requireApiAuth, async (req, res) => {
  try {
    const { serial_number, name, location, ip_address } = req.body || {};
    if (!serial_number || !String(serial_number).trim()) {
      return res.status(400).json({ ok: false, error: 'serial_number is required.' });
    }
    const device = await db.registerDevice({
      serialNumber: serial_number,
      name,
      location,
      ipAddress: ip_address,
    });
    return res.status(200).json({ ok: true, device });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/devices/:sn', requireApiAuth, async (req, res) => {
  try {
    const sn = req.params.sn;
    const { name, location } = req.body || {};
    const updated = await db.updateDeviceMeta(sn, { name, location });
    if (!updated) {
      return res.status(404).json({ ok: false, error: `Device SN "${sn}" not found.` });
    }
    return res.status(200).json({ ok: true, device: updated });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/attendance', requireApiAuth, async (req, res) => {
  try {
    const from = String(req.query.from || req.query.start_date || '').trim() || undefined;
    const to = String(req.query.to || req.query.end_date || '').trim() || undefined;
    const employeeCode =
      String(req.query.employee_code || req.query.user_id || '').trim() || undefined;
    const deviceSn =
      String(req.query.device_sn || req.query.sn || '').trim() || undefined;
    const limit = Number(req.query.limit || 100);
    const offset = Number(req.query.offset || 0);

    const { total, rows } = await db.queryAttendance({
      from,
      to,
      employeeCode,
      deviceSn,
      limit,
      offset,
    });

    const enriched = rows.map((r) => ({
      ...r,
      punch_state_label: getPunchStateLabel(r.punch_state),
      verify_mode_label: getVerifyModeLabel(r.verify_mode),
    }));

    res.status(200).json({
      ok: true,
      total,
      count: enriched.length,
      filters: { from: from || null, to: to || null, employee_code: employeeCode || null, device_sn: deviceSn || null },
      data: enriched,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/debug/raw', requireApiAuth, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50);
    const logs = await db.listRawRequests(limit);
    res.status(200).json({ ok: true, count: logs.length, logs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Live Monitoring Dashboard (Static HTML)
app.use('/', express.static(path.join(__dirname, '../public')));

// Boot Server (HTTP + WebSocket on shared PORT)
async function start() {
  await db.init();
  initFirebaseSync();

  httpServer.listen(PORT, HOST, () => {
    const lanIps = getLocalLanIps();
    const primaryLanIp = lanIps[0]?.address || '<THIS_PC_LAN_IP>';

    console.log('===================================================================');
    console.log('Dream Gym — Secureye ADMS + WebSocket Local LAN Bridge Ready');
    console.log(`HTTP + WS Server   : http://${HOST}:${PORT}`);
    console.log(`This PC LAN IP(s)  : ${lanIps.length ? lanIps.map((i) => `${i.address} (${i.interface})`).join(', ') : 'Not detected'}`);
    console.log(`Database Engine    : ${db.mode.toUpperCase()}`);
    console.log(`Firebase Sync      : ${isFirebaseSyncEnabled() ? 'ENABLED (gym001-50a97)' : 'Disabled (add serviceAccountKey.json to sync live to Dream Gym)'}`);
    console.log(`ADMS HTTP Push     : http://${primaryLanIp}:${PORT}/iclock/cdata`);
    console.log(`Device WebSocket   : ws://${primaryLanIp}:${PORT}/`);
    console.log(`Dream Gym Live WS  : ws://localhost:${PORT}/ws/live`);
    console.log(`Live Dashboard     : http://localhost:${PORT}/`);
    console.log('-------------------------------------------------------------------');
    console.log('CONFIGURE YOUR SECUREYE MACHINE (Menu -> Comm. -> Cloud Server / ADMS):');
    console.log(`  Server Address   : ${primaryLanIp}`);
    console.log(`  Server Port      : ${PORT}`);
    console.log('  Domain Name      : OFF');
    console.log('  HTTPS            : OFF');
    console.log('===================================================================');
    if (P2P_CAPTURE_PORT > 0) {
      console.log(`P2P TCP Sniffer    : tcp://${HOST}:${P2P_CAPTURE_PORT} (captures raw P2P packets)`);
    }
  });

  if (P2P_CAPTURE_PORT > 0) {
    const tcpServer = net.createServer((socket) => {
      const remoteIp = socket.remoteAddress || 'unknown';
      socket.on('data', async (chunk) => {
        const hex = chunk.toString('hex');
        const ascii = chunk.toString('utf8').replace(/[^\x20-\x7E\r\n\t]/g, '.');
        console.log(
          `[P2P TCP:${P2P_CAPTURE_PORT}] From=${remoteIp} | Bytes=${chunk.length} | ASCII=${ascii.slice(0, 120)} | HEX=${hex.slice(0, 120)}`
        );
        try {
          await db.logRawRequest({
            method: 'TCP',
            reqPath: `/p2p-port-${P2P_CAPTURE_PORT}`,
            queryString: `bytes=${chunk.length}`,
            deviceSn: null,
            contentType: 'application/octet-stream',
            remoteIp,
            rawBody: `ASCII:\n${ascii}\n\nHEX:\n${hex}`,
            responseStatus: 200,
          });
        } catch (err) {
          console.error('[P2P TCP] Log error:', err.message);
        }
      });
      socket.on('error', () => {});
    });
    tcpServer.listen(P2P_CAPTURE_PORT, HOST);
  }
}

start().catch((err) => {
  console.error('[FATAL] Failed to start ADMS server:', err);
  process.exit(1);
});
