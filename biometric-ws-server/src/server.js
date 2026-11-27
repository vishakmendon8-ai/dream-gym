/**
 * Dream Gym — Dedicated Google Cloud Run Secureye Biometric WebSocket Backend
 *
 * WebSocket Endpoints (Standard RFC 6455 `ws`, NOT Socket.IO):
 *   - wss://<CLOUD-RUN-URL>/biometric  -> Physical Secureye WebSocket client
 *   - wss://<CLOUD-RUN-URL>/ws/admin   -> Real-time Admin Dashboard stream
 *
 * REST Admin & Diagnostic Endpoints:
 *   - GET  /health
 *   - GET  /biometric                  -> HTTP 426 Upgrade Required notice
 *   - GET  /api/biometric/status
 *   - POST /api/biometric/test-connection
 *   - GET  /api/biometric/diagnostics
 *   - GET  /api/biometric/attendance
 *   - POST /api/biometric/sync
 *   - POST /api/biometric/disconnect
 */

import 'dotenv/config';
import http from 'http';
import net from 'net';
import os from 'os';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { BiometricFirebaseStore } from './firebaseStore.js';
import { attachBiometricWebSocketServer } from './wsServer.js';
import { MemberPushService } from './pushService.js';

const app = express();
const httpServer = http.createServer(app);
const store = new BiometricFirebaseStore();
const pushService = new MemberPushService(store);
const wsController = attachBiometricWebSocketServer({ httpServer, store, pushService });

app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Diagnostic Request Logger (logs all incoming non-polling device/client requests)
app.use((req, res, next) => {
  const ip = req.ip || req.socket?.remoteAddress;
  if (!req.url.startsWith('/api/biometric/status') && req.url !== '/health') {
    console.log(`[HTTP ${req.method}] ${req.url} | from IP: ${ip}`);
  }
  next();
});

// ADMS / Cloud Push Protocol Handler for Secureye terminals that use HTTP Push
app.all(['/iclock/cdata', '/cdata', '/iclock/getrequest'], (req, res) => {
  const sn = req.query.SN || req.query.sn || config.defaultDevice.serialNumber;
  console.log(`[ADMS HTTP] ${req.method} ${req.url} from Device SN=${sn} | IP=${req.ip || req.socket?.remoteAddress}`);
  if (req.method === 'GET' && req.query.options === 'all') {
    res.setHeader('Content-Type', 'text/plain');
    return res.send(`GET OPTION FROM: ${sn}\nStamp=9999\nOpStamp=9999\nErrorDelay=30\nDelay=10\nTransTimes=00:00;14:00\nTransInterval=1\nTransFlag=1111000000\nTimeZone=5.5\nRealtime=1\nEncrypt=0`);
  }
  res.setHeader('Content-Type', 'text/plain');
  return res.send('OK');
});

function requireAdminSecret(req, res, next) {
  if (!config.biometricApiSecret) return next();
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const key = req.headers['x-api-key'] || bearer;
  if (key !== config.biometricApiSecret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized biometric API request.' });
  }
  return next();
}

app.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'dream-gym-biometric-ws-server',
    websocketEndpoint: '/biometric',
    adminStreamEndpoint: '/ws/admin',
    healthEndpoint: '/health',
    cloudRun: config.isCloudRun,
    firebaseProjectId: config.firebaseProjectId,
    firestoreConnected: store.firestoreReady,
  });
});

app.get('/health', (_req, res) => {
  const activeConnections = wsController.getActiveConnections();
  res.status(200).json({
    ok: true,
    service: 'dream-gym-biometric-ws-server',
    cloudRun: config.isCloudRun,
    cloudRunService: config.cloudRunService,
    cloudRunRevision: config.cloudRunRevision,
    firebaseProjectId: config.firebaseProjectId,
    firestoreConnected: store.firestoreReady,
    firestoreAuthMode: store.authMode,
    websocketEndpoint: '/biometric',
    activeDeviceConnections: activeConnections.length,
    serverTime: new Date().toISOString(),
  });
});

// Plain HTTP request to /biometric confirms WebSocket Upgrade is required
app.get('/biometric', (_req, res) => {
  res.status(426).json({
    ok: false,
    error: 'Upgrade Required',
    protocol: 'websocket',
    endpoint: '/biometric',
    message: 'Secureye biometric terminals must connect using WebSocket (wss://<HOST>/biometric).',
  });
});

app.get('/api/biometric/status', requireAdminSecret, (_req, res) => {
  const activeConnections = wsController.getActiveConnections();
  const primaryDevice = store.getDevice(config.defaultDevice.serialNumber);

  // Guarantee real-time status: strictly check live active WebSocket connections
  const isActuallyConnected = activeConnections.some(
    (c) => c.deviceId === primaryDevice.id || c.deviceId === config.defaultDevice.serialNumber
  );
  primaryDevice.wsConnectionStatus = isActuallyConnected ? 'connected' : 'disconnected';

  res.status(200).json({
    ok: true,
    cloudRun: config.isCloudRun,
    firebaseProjectId: config.firebaseProjectId,
    firestoreConnected: store.firestoreReady,
    firestoreAuthMode: store.authMode,
    device: primaryDevice,
    devices: store.listDevices().map((d) => ({
      ...d,
      wsConnectionStatus: activeConnections.some((c) => c.deviceId === d.id) ? 'connected' : 'disconnected',
    })),
    activeConnections,
    serverTime: new Date().toISOString(),
  });
});

app.post('/api/biometric/test-connection', requireAdminSecret, (_req, res) => {
  const active = wsController.getActiveConnections();
  const primary = store.getDevice(config.defaultDevice.serialNumber);
  const deviceOnline = primary.wsConnectionStatus === 'connected';
  res.status(200).json({
    ok: true,
    serverReachable: true,
    websocketEndpointReady: true,
    firestoreConnected: store.firestoreReady,
    deviceConnected: deviceOnline,
    activeConnections: active.length,
    message: deviceOnline
      ? `Cloud Run WebSocket backend is online and physical Secureye device ${primary.serialNumber} is actively connected.`
      : `Cloud Run WebSocket backend (/biometric) is online and ready, but physical Secureye device ${primary.serialNumber} has not connected yet. Enter your deployed wss://.../biometric URL into Secureye -> Communication -> Web Server URL.`,
    checkedAt: new Date().toISOString(),
  });
});

app.get('/api/biometric/diagnostics', requireAdminSecret, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50);
    const logs = await store.listDiagnostics(limit);
    res.status(200).json({ ok: true, count: logs.length, logs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/biometric/attendance', requireAdminSecret, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 100);
    const records = await store.listAttendance(limit);
    res.status(200).json({ ok: true, count: records.length, records });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/biometric/sync', requireAdminSecret, async (req, res) => {
  const deviceId = req.body?.deviceId || config.defaultDevice.serialNumber;
  const result = await wsController.requestAttendanceSync(deviceId);
  if (!result.ok) {
    return res.status(409).json(result);
  }
  return res.status(200).json(result);
});

app.post('/api/biometric/disconnect', requireAdminSecret, async (req, res) => {
  const deviceId = req.body?.deviceId || config.defaultDevice.serialNumber;
  const result = await wsController.disconnectDevice(deviceId);
  if (!result.ok) {
    return res.status(409).json(result);
  }
  return res.status(200).json(result);
});

app.post('/api/biometric/members-sync', requireAdminSecret, async (req, res) => {
  const membersList = Array.isArray(req.body?.members) ? req.body.members : [];
  const deviceId = req.body?.deviceId || config.defaultDevice.serialNumber;
  const summary = store.syncMembersDirectory(membersList);
  const enforcement = await wsController.enforceAllSubscriptionsOnDevice(deviceId);
  pushService.notifyExpiringMembers(membersList).catch(() => {});
  return res.status(200).json({
    ok: true,
    synced: summary,
    enforcement,
  });
});

app.post('/api/biometric/enforce-subscriptions', requireAdminSecret, async (req, res) => {
  const deviceId = req.body?.deviceId || config.defaultDevice.serialNumber;
  const result = await wsController.enforceAllSubscriptionsOnDevice(deviceId);
  return res.status(200).json(result);
});

// ============================================================================
// Block / Unblock a single biometric user ID on the connected Secureye device
// POST /api/biometric/block-user   { enrollId: "5", deviceId?: "..." }
// POST /api/biometric/unblock-user { enrollId: "5", deviceId?: "..." }
// ============================================================================
app.post('/api/biometric/block-user', requireAdminSecret, async (req, res) => {
  const rawId = String(req.body?.enrollId ?? req.body?.biometricId ?? '').trim();
  const deviceId = String(req.body?.deviceId || config.defaultDevice.serialNumber).trim();
  if (!rawId) return res.status(400).json({ ok: false, error: 'enrollId is required.' });

  const numericId = /^\d+$/.test(rawId) ? Number(rawId) : rawId;
  const result = await wsController.blockSingleUserOnDevice(deviceId, rawId, numericId);
  return res.status(result.ok ? 200 : 409).json(result);
});

app.post('/api/biometric/unblock-user', requireAdminSecret, async (req, res) => {
  const rawId = String(req.body?.enrollId ?? req.body?.biometricId ?? '').trim();
  const deviceId = String(req.body?.deviceId || config.defaultDevice.serialNumber).trim();
  if (!rawId) return res.status(400).json({ ok: false, error: 'enrollId is required.' });

  const numericId = /^\d+$/.test(rawId) ? Number(rawId) : rawId;
  const result = await wsController.unblockSingleUserOnDevice(deviceId, rawId, numericId);
  return res.status(result.ok ? 200 : 409).json(result);
});

// ============================================================================
// Web Push Notification Endpoints for Dream Gym Member App
// ============================================================================
app.get('/api/push/vapid-public-key', (_req, res) => {
  const publicKey = pushService.getPublicKey();
  if (!publicKey) {
    return res.status(503).json({ ok: false, error: 'Push service initializing' });
  }
  return res.status(200).json({ ok: true, publicKey });
});

app.post('/api/push/subscribe', async (req, res) => {
  const { memberId, memberName, biometricId, subscription } = req.body || {};
  const result = await pushService.saveSubscription({
    memberId,
    memberName,
    biometricId,
    subscription,
  });
  if (!result.ok) {
    return res.status(400).json(result);
  }
  return res.status(200).json(result);
});

app.post('/api/push/send', requireAdminSecret, async (req, res) => {
  const { targetMemberId, biometricId, title, body, url, tag } = req.body || {};
  const result = await pushService.sendPush({
    targetMemberId: targetMemberId || 'all',
    biometricId: biometricId || null,
    title,
    body,
    url: url || '/member',
    tag: tag || 'dreamgym-alert',
  });
  return res.status(200).json(result);
});

function getLocalIpv4List() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const list of Object.values(ifaces)) {
    for (const addr of list || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  ips.sort((a, b) => (a.startsWith('192.168.') ? -1 : b.startsWith('192.168.') ? 1 : 0));
  return ips;
}

async function start() {
  await store.init();
  await pushService.init();

  const lanIps = getLocalIpv4List();
  const serverIp = lanIps[0] || '<THIS_PC_IP>';

  // Primary Server (Default Port 8080)
  httpServer.listen(config.port, config.host, () => {
    console.log('===================================================================');
    console.log('Dream Gym — Dedicated Secureye Biometric WebSocket Server Ready');
    console.log(`Primary Port 8080  : http://${config.host}:${config.port}`);
    console.log(`WebSocket Endpoint : /biometric, /ws, and / (root)`);
    console.log(`Admin Live Stream  : /ws/admin`);
    console.log(`Firebase Project   : ${config.firebaseProjectId} (${store.authMode})`);
    console.log(`Expected Device SN : ${config.defaultDevice.serialNumber} (Cloud ID: ${config.defaultDevice.cloudId})`);
    console.log('-------------------------------------------------------------------');
    console.log('SECUREYE CLOUD SETTINGS (Menu -> Comm. -> Web Server):');
    console.log(`  Domain / Host    : dream-gym-1.onrender.com`);
    console.log(`  Public IP        : 216.24.57.16 (or 216.24.57.18)`);
    console.log(`  Port Number      : 443 (for wss://) or 80 (for ws://)`);
    console.log(`  Web Server URL   : wss://dream-gym-1.onrender.com/biometric`);
    console.log('-------------------------------------------------------------------');
  });

  const isCloudHost = Boolean(process.env.RENDER || config.isCloudRun || process.env.K_SERVICE);

  // Secondary Alternate Port 8000 Listener (Extra backup WebSocket URL for local machines only)
  const secondaryPort = 8000;
  if (!isCloudHost) {
    try {
      const secondaryServer = http.createServer(app);
      if (typeof wsController.bindHttpUpgrade === 'function') {
        wsController.bindHttpUpgrade(secondaryServer);
      }
      secondaryServer.listen(secondaryPort, config.host, () => {
        console.log('SECONDARY BACKUP URL (Port 8000):');
        console.log(`  Server Address   : ${serverIp}`);
        console.log(`  Port Number      : ${secondaryPort}`);
        console.log(`  Web Server URL   : ws://${serverIp}:${secondaryPort}/biometric`);
        console.log('===================================================================');
      }).on('error', (err) => {
        console.warn(`[SecondaryServer] Could not bind optional backup port ${secondaryPort}:`, err.message);
      });
    } catch {}
  }

  // Dedicated TCP LogClient Listener (Port 5005) - Realand / Secureye Log Client Stream
  const tcpLogPort = 5005;
  if (!isCloudHost) {
    try {
      const tcpServer = net.createServer((socket) => {
        const clientIp = socket.remoteAddress?.replace(/^.*:/, '') || 'unknown';
        console.log(`[TCP LogClient] Machine connected from ${clientIp}:${socket.remotePort}`);

        store.updateDeviceState(config.defaultDevice.serialNumber, {
          wsConnectionStatus: 'connected',
          remoteIp: clientIp,
          lastHeartbeatAt: new Date().toISOString(),
        }).then((updated) => {
          wsController.broadcastAdmin('device_status', updated);
        }).catch(() => {});

        socket.on('data', async (chunk) => {
          const rawText = chunk.toString('utf8');
          console.log(`[TCP LogClient Data] From ${clientIp} (${chunk.length} bytes): ${rawText.slice(0, 200)}`);

          const diag = await store.logDiagnostic({
            event: 'tcp_logclient_data',
            remoteIp: clientIp,
            rawPreview: rawText.slice(0, 300),
            byteLength: chunk.length,
          });
          wsController.broadcastAdmin('diagnostic', diag);

          // Standard LogClient acknowledgment
          try {
            socket.write('OK\r\n');
          } catch {}
        });

        socket.on('close', () => {
          console.log(`[TCP LogClient] Machine connection closed from ${clientIp}`);
        });

        socket.on('error', (err) => {
          console.warn(`[TCP LogClient Error] ${err.message}`);
        });
      });

      tcpServer.listen(tcpLogPort, config.host, () => {
        console.log(`TCP LogClient Listener : Port ${tcpLogPort} (Secureye / Realand LogClient Stream)`);
        console.log('===================================================================');
      }).on('error', (err) => {
        console.warn(`[TCP LogClient] Could not bind port ${tcpLogPort}:`, err.message);
      });
    } catch (err) {
      console.warn(`[TCP LogClient Init Error]`, err.message);
    }
  }
}

start().catch((err) => {
  console.error('[FATAL] Failed to start biometric WebSocket server:', err);
  process.exit(1);
});
