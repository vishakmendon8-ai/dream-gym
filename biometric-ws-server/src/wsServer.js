/**
 * Dedicated Standard WebSocket Server (`ws`, NOT Socket.IO) for Secureye Biometric Devices.
 *
 * Endpoints:
 *   - /biometric  -> Physical Secureye WebSocket client connections (WSS on Cloud Run)
 *   - /ws/admin   -> Real-time status & diagnostic stream for Dream Gym Admin Panel
 */

import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.js';
import { inspectIncomingFrame } from './diagnosticParser.js';
import { evaluateSubscription } from './firebaseStore.js';

function extractRemoteIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function sanitizeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = k.toLowerCase();
    if (key === 'authorization' || key === 'cookie') {
      out[key] = '[REDACTED]';
    } else {
      out[key] = Array.isArray(v) ? v.join(', ') : String(v);
    }
  }
  return out;
}

export function attachBiometricWebSocketServer({ httpServer, store, pushService = null }) {
  const biometricWss = new WebSocketServer({ noServer: true });
  const adminWss = new WebSocketServer({ noServer: true });

  const adminClients = new Set();
  // Active device sessions keyed by deviceId (SN/Cloud ID) or temporary connectionId until identified
  const activeDeviceSessions = new Map();

  function broadcastAdmin(type, data) {
    const payload = JSON.stringify({
      type,
      timestamp: new Date().toISOString(),
      data,
    });
    for (const client of adminClients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch {}
      }
    }
  }

  function getActiveConnections() {
    const list = [];
    for (const sess of activeDeviceSessions.values()) {
      if (sess.ws.readyState === WebSocket.OPEN) {
        list.push({
          connectionId: sess.connectionId,
          deviceId: sess.deviceId,
          remoteIp: sess.remoteIp,
          path: sess.path,
          connectedAt: sess.connectedAt,
          lastHeartbeatAt: sess.lastHeartbeatAt,
        });
      }
    }
    return list;
  }

  // Heartbeat monitor (keeps Cloud Run WSS connections alive & detects dead links)
  const heartbeatTimer = setInterval(async () => {
    const nowIso = new Date().toISOString();

    for (const client of adminClients) {
      if (client.isAlive === false) {
        adminClients.delete(client);
        try { client.terminate(); } catch {}
        continue;
      }
      client.isAlive = false;
      try { client.ping(); } catch {}
    }

    for (const [key, sess] of activeDeviceSessions.entries()) {
      if (sess.ws.readyState !== WebSocket.OPEN) {
        activeDeviceSessions.delete(key);
        continue;
      }
      if (sess.ws.isAlive === false) {
        console.warn(`[WS /biometric] Heartbeat timeout for ${sess.deviceId || key}; terminating stale socket.`);
        activeDeviceSessions.delete(key);
        const targetId = sess.deviceId || config.defaultDevice.serialNumber;
        await store.recordConnectionError(targetId, 'WebSocket heartbeat ping/pong timeout');
        await store.updateDeviceState(targetId, {
          wsConnectionStatus: 'disconnected',
          disconnectedAt: nowIso,
        });
        broadcastAdmin('device_status', store.getDevice(targetId));
        try { sess.ws.terminate(); } catch {}
        continue;
      }
      sess.ws.isAlive = false;
      try {
        sess.ws.ping();
      } catch {}
    }
  }, config.heartbeatIntervalMs);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();

  // Route HTTP Upgrade: /ws/admin -> Admin Live Stream, all other paths -> Secureye Terminal
  function bindHttpUpgrade(server) {
    server.on('upgrade', (req, socket, head) => {
      const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = urlObj.pathname.replace(/\/+$/, '') || '/';

      if (pathname === '/ws/admin') {
        if (config.biometricApiSecret) {
          const token = urlObj.searchParams.get('token') || '';
          if (token !== config.biometricApiSecret) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
        }
        adminWss.handleUpgrade(req, socket, head, (ws) => {
          adminWss.emit('connection', ws, req);
        });
        return;
      }

      biometricWss.handleUpgrade(req, socket, head, (ws) => {
        biometricWss.emit('connection', ws, req);
      });
    });
  }

  bindHttpUpgrade(httpServer);

  // --------------------------------------------------------------------------
  // Admin Live Stream (/ws/admin)
  // --------------------------------------------------------------------------
  adminWss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    adminClients.add(ws);

    ws.send(
      JSON.stringify({
        type: 'welcome',
        timestamp: new Date().toISOString(),
        data: {
          devices: store.listDevices(),
          activeConnections: getActiveConnections(),
        },
      })
    );

    ws.on('close', () => adminClients.delete(ws));
    ws.on('error', () => adminClients.delete(ws));
  });

  // --------------------------------------------------------------------------
  // Physical Secureye Biometric WebSocket Endpoint (/biometric)
  // --------------------------------------------------------------------------
  biometricWss.on('connection', async (ws, req) => {
    const connectionId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const remoteIp = extractRemoteIp(req);
    const reqUrl = req.url || '/biometric';
    const urlObj = new URL(reqUrl, `http://${req.headers.host || 'localhost'}`);
    const querySn =
      (urlObj.searchParams.get('sn') ||
        urlObj.searchParams.get('SN') ||
        urlObj.searchParams.get('cloudId') ||
        urlObj.searchParams.get('deviceId') ||
        '').trim() || null;

    const nowIso = new Date().toISOString();
    ws.isAlive = true;

    const session = {
      connectionId,
      deviceId: querySn,
      ws,
      remoteIp,
      path: reqUrl,
      connectedAt: nowIso,
      lastHeartbeatAt: nowIso,
    };

    const sessionKey = querySn || connectionId;
    const prev = querySn ? activeDeviceSessions.get(querySn) : null;
    if (prev && prev.ws !== ws) {
      console.log(`[WS /biometric] Device ${querySn} reconnected; closing previous socket ${prev.connectionId}.`);
      try { prev.ws.close(1000, 'Replaced by newer device connection'); } catch {}
    }
    activeDeviceSessions.set(sessionKey, session);

    console.log(`[WS /biometric] CONNECTED | conn=${connectionId} | IP=${remoteIp} | querySN=${querySn || 'pending'} | path=${reqUrl}`);

    const diag = await store.logDiagnostic({
      event: 'ws_connected',
      connectionId,
      deviceId: querySn,
      remoteIp,
      path: reqUrl,
      messageType: 'lifecycle',
      headers: sanitizeHeaders(req.headers),
      rawPreview: `WebSocket handshake succeeded (HTTP 101) from ${remoteIp} on ${reqUrl}`,
    });
    broadcastAdmin('diagnostic', diag);

    // Update persistent status immediately upon WebSocket connection
    const targetSn = querySn || config.defaultDevice.serialNumber;
    session.deviceId = targetSn;
    activeDeviceSessions.set(targetSn, session);

    const updated = await store.updateDeviceState(targetSn, {
      wsConnectionStatus: 'connected',
      remoteIp,
      connectedAt: nowIso,
      lastHeartbeatAt: nowIso,
    });
    broadcastAdmin('device_status', updated);

    // Track WebSocket control-frame pongs as live heartbeats
    ws.on('pong', async () => {
      ws.isAlive = true;
      const hbIso = new Date().toISOString();
      session.lastHeartbeatAt = hbIso;
      if (session.deviceId) {
        const updated = await store.updateDeviceState(session.deviceId, {
          wsConnectionStatus: 'connected',
          lastHeartbeatAt: hbIso,
        });
        broadcastAdmin('device_status', updated);
      }
    });

    // Receive EVERY incoming frame: Text, JSON, or Binary
    ws.on('message', async (rawData, isBinary) => {
      ws.isAlive = true;
      const msgIso = new Date().toISOString();
      session.lastHeartbeatAt = msgIso;

      const inspection = inspectIncomingFrame(rawData, isBinary);

      // Bind session to real deviceId if discovered in payload
      if (inspection.deviceId && session.deviceId !== inspection.deviceId) {
        if (!session.deviceId) {
          activeDeviceSessions.delete(connectionId);
        } else {
          activeDeviceSessions.delete(session.deviceId);
        }
        const existingOther = activeDeviceSessions.get(inspection.deviceId);
        if (existingOther && existingOther.ws !== ws) {
          try { existingOther.ws.close(1000, 'Replaced by reconnected session'); } catch {}
        }
        session.deviceId = inspection.deviceId;
        activeDeviceSessions.set(inspection.deviceId, session);
      }

      const effectiveDeviceId = session.deviceId || config.defaultDevice.serialNumber;

      console.log(
        `[WS /biometric] MSG | device=${effectiveDeviceId} | type=${inspection.messageType} | category=${inspection.category} | bytes=${inspection.byteLength} | preview=${inspection.rawPreview}`
      );

      // Always store the raw diagnostic record (no invented formats)
      const diagRecord = await store.logDiagnostic({
        event: 'ws_message',
        connectionId,
        deviceId: session.deviceId || null,
        remoteIp,
        path: reqUrl,
        messageType: inspection.messageType,
        category: inspection.category,
        command: inspection.command || null,
        keys: inspection.keys || null,
        byteLength: inspection.byteLength,
        protocolRecognized: inspection.protocolRecognized,
        needsOfficialDocs: inspection.needsOfficialDocs,
        rawText: inspection.rawText || null,
        hexPreview: inspection.hexPreview || null,
        asciiPreview: inspection.asciiPreview || null,
        base64Preview: inspection.base64Preview || null,
        rawPreview: inspection.rawPreview,
      });
      broadcastAdmin('diagnostic', diagRecord);

      // Update persistent device metadata in Firestore
      const statePatch = {
        wsConnectionStatus: 'connected',
        remoteIp,
        lastHeartbeatAt: msgIso,
        lastReceivedMessage: inspection.rawPreview,
        lastReceivedMessageType: inspection.messageType,
        lastReceivedMessageAt: msgIso,
      };

      if (inspection.category === 'device_registration') {
        statePatch.registrationStatus = 'registered';
        statePatch.protocolStatus = 'standard_ws_json';
      } else if (inspection.protocolRecognized) {
        statePatch.protocolStatus = 'standard_ws_json';
        if (session.deviceId) {
          statePatch.registrationStatus = 'registered';
        }
      } else if (inspection.needsOfficialDocs) {
        statePatch.protocolStatus = 'unrecognized_requires_vendor_sdk';
      }

      const updatedDevice = await store.updateDeviceState(effectiveDeviceId, statePatch);
      broadcastAdmin('device_status', updatedDevice);

      // Process extracted attendance events FIRST so we can reply with real access: 1 (ALLOW) or 0 (DECLINE)
      let allGranted = true;
      let lastDenialReason = null;
      const deniedBioIds = [];

      if (inspection.attendanceEvents.length > 0) {
        for (const evt of inspection.attendanceEvents) {
          const result = await store.processAttendanceEvent({
            ...evt,
            deviceId: evt.deviceId || effectiveDeviceId,
          });
          if (result.ok) {
            if (!result.granted) {
              allGranted = false;
              lastDenialReason = result.reason || result.record?.reason || 'Subscription Expired';
              if (evt.biometricUserId) deniedBioIds.push(evt.biometricUserId);
            }
            if (result.record) {
              broadcastAdmin('attendance_event', result.record);
              broadcastAdmin('device_status', store.getDevice(effectiveDeviceId));
              if (pushService) {
                pushService
                  .sendPush({
                    targetMemberId: result.record.memberId,
                    biometricId: evt.biometricUserId,
                    title: result.granted ? 'Dream Gym Check-In' : 'Dream Gym Entry Declined',
                    body: result.granted
                      ? `Welcome, ${result.record.memberName}! Check-in recorded at ${result.record.checkInTime}.`
                      : result.record.reason || 'Your gym membership has expired.',
                    url: result.granted ? '/member?screen=attendance' : '/member?screen=membership-details',
                    tag: `dreamgym-scan-${result.record.memberId}`,
                  })
                  .catch(() => {});
              }
            }
          }
        }
      }

      // Send protocol acknowledgment for recognized standard WS JSON / XML commands
      if (inspection.suggestedReply && ws.readyState === WebSocket.OPEN) {
        let replyStr;
        let isXml = false;

        if (typeof inspection.suggestedReply === 'string') {
          replyStr = inspection.suggestedReply;
          isXml = true;
        } else {
          const replyPayload = { ...inspection.suggestedReply };
          if (inspection.category === 'attendance_event') {
            replyPayload.access = allGranted ? 1 : 0;
            replyPayload.message = allGranted
              ? 'Access Granted'
              : (lastDenialReason || 'Subscription Expired').slice(0, 60);
          }
          replyStr = JSON.stringify(replyPayload);
        }

        ws.send(replyStr);
        await store.logDiagnostic({
          event: 'ws_reply_sent',
          connectionId,
          deviceId: session.deviceId || null,
          remoteIp,
          path: reqUrl,
          messageType: isXml ? 'xml' : 'json',
          rawText: replyStr,
          rawPreview: `SERVER REPLY (${allGranted ? 'ALLOW' : 'DECLINE'}) -> ${replyStr.slice(0, 200)}`,
        });

        // If member's subscription is expired/denied, ALSO send hardware disable command (`enableuser enflag: 0`)
        if (!allGranted && deniedBioIds.length > 0) {
          for (const bioId of deniedBioIds) {
            const numericId = /^\d+$/.test(bioId) ? Number(bioId) : bioId;
            const blockCmd = JSON.stringify({
              cmd: 'enableuser',
              enrollid: numericId,
              enflag: 0,
            });
            ws.send(blockCmd);
            const blockDiag = await store.logDiagnostic({
              event: 'ws_auto_block_expired',
              connectionId,
              deviceId: effectiveDeviceId,
              remoteIp,
              messageType: 'json',
              rawText: blockCmd,
              rawPreview: `AUTO-DECLINE EXPIRED USER -> ${blockCmd}`,
            });
            broadcastAdmin('diagnostic', blockDiag);
          }
        }
      }

      // When a device registers cleanly, enforce all known member subscription expiries on it
      if (inspection.category === 'device_registration') {
        enforceAllSubscriptionsOnDevice(effectiveDeviceId).catch(() => {});
      }
    });

    ws.on('error', async (err) => {
      console.error(`[WS /biometric] Socket error (${session.deviceId || connectionId}):`, err.message);
      const targetId = session.deviceId || config.defaultDevice.serialNumber;
      const updated = await store.recordConnectionError(targetId, `WebSocket error: ${err.message}`);
      broadcastAdmin('device_status', updated);
      const diagErr = await store.logDiagnostic({
        event: 'ws_error',
        connectionId,
        deviceId: session.deviceId || null,
        remoteIp,
        messageType: 'lifecycle',
        rawPreview: `Socket error: ${err.message}`,
      });
      broadcastAdmin('diagnostic', diagErr);
    });

    ws.on('close', async (code, reasonBuf) => {
      const reason = reasonBuf ? reasonBuf.toString('utf8') : '';
      const closeIso = new Date().toISOString();
      console.log(
        `[WS /biometric] DISCONNECTED | conn=${connectionId} | device=${session.deviceId || 'unidentified'} | code=${code} | reason=${reason || '(none)'}`
      );

      // Only mark disconnected if this socket is still the active session for that device
      const currentKey = session.deviceId || config.defaultDevice.serialNumber;
      const currentEntry = activeDeviceSessions.get(currentKey);
      if (!currentEntry || currentEntry.ws === ws) {
        activeDeviceSessions.delete(currentKey);
        activeDeviceSessions.delete(connectionId);
        const updated = await store.updateDeviceState(currentKey, {
          wsConnectionStatus: 'disconnected',
          disconnectedAt: closeIso,
        });
        broadcastAdmin('device_status', updated);
      }

      const diagClose = await store.logDiagnostic({
        event: 'ws_disconnected',
        connectionId,
        deviceId: session.deviceId || null,
        remoteIp,
        messageType: 'lifecycle',
        rawPreview: `Disconnected (code=${code}${reason ? `, reason=${reason}` : ''})`,
      });
      broadcastAdmin('diagnostic', diagClose);
    });
  });

  // Admin Control: Gracefully disconnect active device socket (triggers reconnect on device)
  async function disconnectDevice(deviceId = config.defaultDevice.serialNumber) {
    const id = String(deviceId || config.defaultDevice.serialNumber).trim();
    const sess = activeDeviceSessions.get(id);
    if (!sess || sess.ws.readyState !== WebSocket.OPEN) {
      return {
        ok: false,
        error: `Device ${id} does not currently have an active WebSocket connection.`,
      };
    }
    sess.ws.close(1000, 'Disconnected by Dream Gym Admin');
    activeDeviceSessions.delete(id);
    const updated = await store.updateDeviceState(id, {
      wsConnectionStatus: 'disconnected',
      disconnectedAt: new Date().toISOString(),
    });
    broadcastAdmin('device_status', updated);
    return { ok: true, deviceId: id, message: `Disconnected WebSocket session for ${id}.` };
  }

  // Admin Control: Request attendance log synchronization over active WebSocket
  async function requestAttendanceSync(deviceId = config.defaultDevice.serialNumber) {
    const id = String(deviceId || config.defaultDevice.serialNumber).trim();
    const sess = activeDeviceSessions.get(id);
    if (!sess || sess.ws.readyState !== WebSocket.OPEN) {
      return {
        ok: false,
        error: `Cannot synchronize: Device ${id} is not currently connected over WebSocket.`,
      };
    }
    const cmd = { cmd: 'getnewlog', stn: true };
    const text = JSON.stringify(cmd);
    sess.ws.send(text);
    const diag = await store.logDiagnostic({
      event: 'ws_command_sent',
      connectionId: sess.connectionId,
      deviceId: id,
      remoteIp: sess.remoteIp,
      messageType: 'json',
      rawText: text,
      rawPreview: `ADMIN SYNC CMD -> ${text}`,
    });
    broadcastAdmin('diagnostic', diag);
    return {
      ok: true,
      deviceId: id,
      commandSent: cmd,
      message: `Sent attendance sync command (${text}) to connected Secureye device ${id}.`,
    };
  }

  function formatLockDate(rawDate, isEnd = false) {
    const parsed = rawDate ? new Date(rawDate) : null;
    const d = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `${datePart} ${isEnd ? '23:59:59' : '00:00:00'}`;
  }

  /**
   * Push subscription enforcement rules to the connected Secureye machine:
   *  - Expired / inactive / pending members -> `enableuser` (`enflag: 0`) so machine declines them!
   *  - Active members -> `enableuser` (`enflag: 1`) + `setuserlock` (`starttime`/`endtime` expiry window)
   */
  async function enforceAllSubscriptionsOnDevice(deviceId = config.defaultDevice.serialNumber) {
    const id = String(deviceId || config.defaultDevice.serialNumber).trim();
    const sess = activeDeviceSessions.get(id);
    const members = await store.getAllMembers();
    const now = new Date();

    const activeMembers = [];
    const expiredMembers = [];

    for (const m of members) {
      const bioId = String(m.biometricId || '').trim();
      if (!bioId || bioId.toUpperCase() === 'NONE') continue;
      const verdict = evaluateSubscription(m, now);
      if (verdict.granted) activeMembers.push(m);
      else expiredMembers.push(m);
    }

    if (!sess || sess.ws.readyState !== WebSocket.OPEN) {
      return {
        ok: true,
        deviceConnected: false,
        deviceId: id,
        enabledCount: activeMembers.length,
        blockedCount: expiredMembers.length,
        commandsSent: 0,
        message: `Synced ${members.length} member(s) (${activeMembers.length} active, ${expiredMembers.length} expired/declined). Hardware commands will push automatically as soon as Secureye SN ${id} connects.`,
      };
    }

    let commandsSent = 0;

    // 1. Block / Decline all expired, inactive, or pending members directly on the machine
    for (const m of expiredMembers) {
      const bioId = String(m.biometricId).trim();
      const enrollid = /^\d+$/.test(bioId) ? Number(bioId) : bioId;
      const cmd = JSON.stringify({ cmd: 'enableuser', enrollid, enflag: 0 });
      sess.ws.send(cmd);
      commandsSent += 1;
    }

    // 2. Re-enable all active members + push their exact subscription start/expiry timestamps
    const lockRecords = [];
    for (const m of activeMembers) {
      const bioId = String(m.biometricId).trim();
      const enrollid = /^\d+$/.test(bioId) ? Number(bioId) : bioId;
      const enableCmd = JSON.stringify({ cmd: 'enableuser', enrollid, enflag: 1 });
      sess.ws.send(enableCmd);
      commandsSent += 1;

      if (m.expiryDate) {
        lockRecords.push({
          enrollid,
          weekzone: 1,
          starttime: formatLockDate(m.startDate || m.joinDate || new Date().toISOString(), false),
          endtime: formatLockDate(m.expiryDate, true),
        });
      }
    }

    if (lockRecords.length > 0) {
      const lockCmd = JSON.stringify({
        cmd: 'setuserlock',
        count: lockRecords.length,
        record: lockRecords,
      });
      sess.ws.send(lockCmd);
      commandsSent += 1;
    }

    const diag = await store.logDiagnostic({
      event: 'ws_subscription_enforced',
      connectionId: sess.connectionId,
      deviceId: id,
      remoteIp: sess.remoteIp,
      messageType: 'json',
      rawPreview: `SUBSCRIPTION ENFORCEMENT -> Enabled ${activeMembers.length} active, Blocked/Declined ${expiredMembers.length} expired (${commandsSent} WS command(s) sent)`,
    });
    broadcastAdmin('diagnostic', diag);

    return {
      ok: true,
      deviceConnected: true,
      deviceId: id,
      enabledCount: activeMembers.length,
      blockedCount: expiredMembers.length,
      commandsSent,
      message: `Enforced subscriptions on Secureye SN ${id}: ${activeMembers.length} active allowed, ${expiredMembers.length} expired/declined blocked on hardware.`,
    };
  }

  // Automatic 5-minute expiry sweep (catches memberships expiring at midnight automatically)
  const expirySweepTimer = setInterval(() => {
    for (const sess of activeDeviceSessions.values()) {
      if (sess.deviceId && sess.ws.readyState === WebSocket.OPEN) {
        enforceAllSubscriptionsOnDevice(sess.deviceId).catch(() => {});
      }
    }
  }, 5 * 60_000);
  if (typeof expirySweepTimer.unref === 'function') expirySweepTimer.unref();

  return {
    getActiveConnections,
    disconnectDevice,
    requestAttendanceSync,
    enforceAllSubscriptionsOnDevice,
    broadcastAdmin,
    bindHttpUpgrade,
  };
}
