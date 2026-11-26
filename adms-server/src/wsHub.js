/**
 * Dual-Purpose WebSocket Hub for Dream Gym Local LAN Bridge
 *
 * Runs on the SAME port (default 8080) as HTTP ADMS using HTTP Upgrade:
 *
 *  1. Browser Live Stream:  ws://<BRIDGE_HOST>:8080/ws/live
 *     - Pushes instant device heartbeats, attendance punches, and raw hardware
 *       packets directly to the Dream Gym React UI (zero polling delay).
 *
 *  2. Biometric Hardware WebSocket:  ws://<BRIDGE_HOST>:8080/ (or any non-/ws/live path)
 *     - Supports Secureye / Timmy / AI Face terminals that communicate over JSON WebSockets
 *       (e.g. {"cmd":"reg"}, {"cmd":"sendlog"}, {"cmd":"heartbeat"}, {"cmd":"senduser"}).
 *     - Also captures any unknown/custom WS payload into raw_request_logs for debugging.
 *     - Allows two-way commands from Dream Gym -> connected WebSocket machine via POST /api/ws/send.
 */

import { WebSocketServer, WebSocket } from 'ws';
import {
  getPunchStateLabel,
  getVerifyModeLabel,
  normalizeAdmsTimestamp,
} from './admsParser.js';
import {
  syncDeviceHeartbeatToFirestore,
  syncPunchToFirestore,
} from './firebaseSync.js';

function formatCloudTime(tzOffsetHours = Number(process.env.ADMS_TIMEZONE ?? 5.5)) {
  const offsetMs = (Number.isFinite(tzOffsetHours) ? tzOffsetHours : 0) * 3600_000;
  const local = new Date(Date.now() + offsetMs);
  const pad = (n) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
}

export function createWsHub({ server, db, apiAuthToken = '' }) {
  const liveWss = new WebSocketServer({ noServer: true });
  const deviceWss = new WebSocketServer({ noServer: true });

  // Active browser UI subscribers
  const liveClients = new Set();

  // Active WebSocket biometric machines keyed by SN (or socket id until registered)
  const wsDevices = new Map(); // sn -> { sn, socket, remoteIp, path, connectedAt, lastMessageAt }

  function listConnectedWsDevices() {
    const out = [];
    for (const entry of wsDevices.values()) {
      if (entry.socket.readyState === WebSocket.OPEN) {
        out.push({
          serial_number: entry.sn,
          remote_ip: entry.remoteIp,
          path: entry.path,
          connected_at: entry.connectedAt,
          last_message_at: entry.lastMessageAt,
        });
      }
    }
    return out;
  }

  function broadcastLive(eventType, payload) {
    const frame = JSON.stringify({
      type: eventType,
      timestamp: new Date().toISOString(),
      data: payload,
    });
    for (const ws of liveClients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(frame);
        } catch {}
      }
    }
  }

  // Handle HTTP Upgrade requests on the shared HTTP server
  server.on('upgrade', (req, socket, head) => {
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    if (pathname === '/ws/live') {
      if (apiAuthToken) {
        const token = urlObj.searchParams.get('token') || '';
        if (token !== apiAuthToken) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
      }
      liveWss.handleUpgrade(req, socket, head, (ws) => {
        liveWss.emit('connection', ws, req);
      });
      return;
    }

    // Any other WebSocket path is treated as an incoming biometric hardware WebSocket
    deviceWss.handleUpgrade(req, socket, head, (ws) => {
      deviceWss.emit('connection', ws, req);
    });
  });

  // --------------------------------------------------------------------------
  // 1. Browser Live Stream Connections (/ws/live)
  // --------------------------------------------------------------------------
  liveWss.on('connection', (ws) => {
    liveClients.add(ws);
    ws.send(
      JSON.stringify({
        type: 'welcome',
        timestamp: new Date().toISOString(),
        data: {
          message: 'Connected to Dream Gym live WebSocket stream.',
          connectedWsDevices: listConnectedWsDevices(),
        },
      })
    );

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString('utf8'));
        if (msg?.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch {}
    });

    ws.on('close', () => {
      liveClients.delete(ws);
    });
    ws.on('error', () => {
      liveClients.delete(ws);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Biometric Machine WebSocket Connections (/, /ws, /pub/chat, etc.)
  // --------------------------------------------------------------------------
  deviceWss.on('connection', (ws, req) => {
    const remoteIp =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : null) ||
      req.socket?.remoteAddress ||
      'unknown';
    const reqPath = req.url || '/';
    let boundSn = null;

    console.log(`[WS-DEVICE] Connected from ${remoteIp} on ${reqPath}`);

    ws.on('message', async (rawBuf) => {
      const rawText = rawBuf.toString('utf8').replace(/\0/g, '').trim();
      const nowIso = new Date().toISOString();
      console.log(`[WS-DEVICE] ${nowIso} | IP=${remoteIp} | Path=${reqPath} | Msg=${rawText.slice(0, 300)}`);

      let parsed = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = null;
      }

      const sn =
        String(
          parsed?.sn ||
            parsed?.SN ||
            parsed?.device_sn ||
            parsed?.devid ||
            boundSn ||
            ''
        ).trim() || null;

      if (sn) {
        boundSn = sn;
        wsDevices.set(sn, {
          sn,
          socket: ws,
          remoteIp,
          path: reqPath,
          connectedAt: wsDevices.get(sn)?.connectedAt || nowIso,
          lastMessageAt: nowIso,
        });
      }

      // Record raw WS packet in DB + broadcast to live debugger
      try {
        await db.logRawRequest({
          method: 'WS',
          reqPath,
          queryString: parsed?.cmd ? `cmd=${parsed.cmd}` : '',
          deviceSn: sn,
          contentType: parsed ? 'application/json' : 'text/plain',
          remoteIp,
          rawBody: rawText,
          responseStatus: 200,
        });
      } catch (err) {
        console.error('[WS-DEVICE] Failed to log raw WS packet:', err.message);
      }

      broadcastLive('raw_packet', {
        method: 'WS',
        path: reqPath,
        query_string: parsed?.cmd ? `cmd=${parsed.cmd}` : '',
        device_sn: sn,
        remote_ip: remoteIp,
        raw_body: rawText,
        received_at: nowIso,
      });

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      const cmd = String(parsed.cmd || parsed.ret || '').toLowerCase();

      // Upsert device heartbeat whenever SN is known
      if (sn) {
        try {
          const device = await db.upsertDeviceHeartbeat({
            serialNumber: sn,
            ipAddress: remoteIp,
            pushVersion: parsed.devinfo?.firmware || 'ws-json',
          });
          await syncDeviceHeartbeatToFirestore({ serialNumber: sn, ipAddress: remoteIp });
          broadcastLive('device_heartbeat', {
            serial_number: sn,
            ip_address: remoteIp,
            protocol: 'websocket',
            device,
          });
        } catch (err) {
          console.error('[WS-DEVICE] Heartbeat DB error:', err.message);
        }
      }

      // Handle standard JSON biometric WebSocket commands
      if (cmd === 'reg') {
        const reply = {
          ret: 'reg',
          result: true,
          cloudtime: formatCloudTime(),
          nosenduser: true,
        };
        ws.send(JSON.stringify(reply));
        broadcastLive('ws_device_status', {
          serial_number: sn,
          connected: true,
          connectedWsDevices: listConnectedWsDevices(),
        });
        return;
      }

      if (cmd === 'sendlog' || cmd === 'rtlog' || cmd === 'attlog') {
        const records = Array.isArray(parsed.record)
          ? parsed.record
          : Array.isArray(parsed.records)
          ? parsed.records
          : Array.isArray(parsed.data)
          ? parsed.data
          : parsed.enrollid !== undefined || parsed.pin !== undefined
          ? [parsed]
          : [];

        let insertedCount = 0;
        for (const rec of records) {
          const employeeCode = String(
            rec.enrollid ?? rec.pin ?? rec.userid ?? rec.user_id ?? rec.empcode ?? ''
          ).trim();
          const rawTime = String(rec.time ?? rec.punch_time ?? rec.datetime ?? '').trim();
          const punchTime = normalizeAdmsTimestamp(rawTime) || nowIso;
          if (!employeeCode) continue;

          const punchState = String(rec.inout ?? rec.status ?? rec.event ?? '0');
          const verifyMode = String(rec.mode ?? rec.verifytype ?? rec.verifymode ?? '1');

          try {
            const res = await db.insertAttendancePunch({
              deviceSn: sn || 'WS-UNKNOWN',
              employeeCode,
              punchTime,
              punchState,
              verifyMode,
              workCode: String(rec.workcode ?? '0'),
              rawPayload: JSON.stringify(rec),
            });

            if (res.inserted) {
              insertedCount += 1;
              const verifyModeLabel = getVerifyModeLabel(verifyMode);
              const punchStateLabel = getPunchStateLabel(punchState);
              console.log(
                `[WS PUNCH SAVED] SN=${sn || 'WS-UNKNOWN'} | User=${employeeCode} | Time=${punchTime} | Mode=${verifyModeLabel}`
              );
              const fbRes = await syncPunchToFirestore({
                deviceSn: sn || 'WS-UNKNOWN',
                employeeCode,
                punchTime,
                verifyModeLabel,
              });
              broadcastLive('attendance_punch', {
                device_sn: sn || 'WS-UNKNOWN',
                employee_code: employeeCode,
                punch_time: punchTime,
                punch_state: punchState,
                punch_state_label: punchStateLabel,
                verify_mode: verifyMode,
                verify_mode_label: verifyModeLabel,
                protocol: 'websocket',
                granted: fbRes?.granted ?? null,
              });
            }
          } catch (err) {
            console.error('[WS-DEVICE] Failed to save punch:', err.message);
          }
        }

        const reply = {
          ret: parsed.cmd || 'sendlog',
          result: true,
          count: records.length,
          ...(parsed.logindex !== undefined ? { logindex: parsed.logindex } : {}),
          cloudtime: formatCloudTime(),
          access: 1,
        };
        ws.send(JSON.stringify(reply));
        console.log(
          `[WS SENDLOG] SN=${sn || 'WS-UNKNOWN'} | Records=${records.length} | Inserted=${insertedCount}`
        );
        return;
      }

      if (cmd === 'senduser' || cmd === 'heartbeat' || cmd === 'ping') {
        ws.send(
          JSON.stringify({
            ret: parsed.cmd,
            result: true,
            cloudtime: formatCloudTime(),
          })
        );
        return;
      }

      // If this was a response (`ret`) to a command we sent from Dream Gym, broadcast it to UI
      if (parsed.ret) {
        broadcastLive('ws_device_reply', {
          serial_number: sn,
          reply: parsed,
        });
      }
    });

    ws.on('close', () => {
      if (boundSn && wsDevices.get(boundSn)?.socket === ws) {
        wsDevices.delete(boundSn);
        broadcastLive('ws_device_status', {
          serial_number: boundSn,
          connected: false,
          connectedWsDevices: listConnectedWsDevices(),
        });
      }
      console.log(`[WS-DEVICE] Disconnected (${boundSn || remoteIp})`);
    });

    ws.on('error', () => {});
  });

  function sendCommandToWsDevice(serialNumber, payload) {
    const sn = String(serialNumber || '').trim();
    const entry = wsDevices.get(sn);
    if (!entry || entry.socket.readyState !== WebSocket.OPEN) {
      return {
        ok: false,
        error: `Device SN "${sn}" does not currently have an open WebSocket connection to the bridge.`,
      };
    }
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    entry.socket.send(text);
    return { ok: true, sent: text };
  }

  return {
    broadcastLive,
    listConnectedWsDevices,
    sendCommandToWsDevice,
    getLiveClientCount: () => liveClients.size,
  };
}
