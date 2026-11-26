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
import os from 'os';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { BiometricFirebaseStore } from './firebaseStore.js';
import { attachBiometricWebSocketServer } from './wsServer.js';

const app = express();
const httpServer = http.createServer(app);
const store = new BiometricFirebaseStore();
const wsController = attachBiometricWebSocketServer({ httpServer, store });

app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

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
  const primaryDevice = store.getDevice(config.defaultDevice.serialNumber);
  res.status(200).json({
    ok: true,
    cloudRun: config.isCloudRun,
    firebaseProjectId: config.firebaseProjectId,
    firestoreConnected: store.firestoreReady,
    firestoreAuthMode: store.authMode,
    device: primaryDevice,
    devices: store.listDevices(),
    activeConnections: wsController.getActiveConnections(),
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

  httpServer.listen(config.port, config.host, () => {
    const lanIps = getLocalIpv4List();
    const serverIp = lanIps[0] || '<THIS_PC_IP>';
    console.log('===================================================================');
    console.log('Dream Gym — Dedicated Secureye Biometric WebSocket Server Ready');
    console.log(`Listening on       : http://${config.host}:${config.port}`);
    console.log(`WebSocket Endpoint : /biometric (and / for IP+Port clients)`);
    console.log(`Admin Live Stream  : /ws/admin`);
    console.log(`Firebase Project   : ${config.firebaseProjectId} (${store.authMode})`);
    console.log(`Expected Device SN : ${config.defaultDevice.serialNumber} (Cloud ID: ${config.defaultDevice.cloudId})`);
    console.log('-------------------------------------------------------------------');
    console.log('ENTER ON YOUR SECUREYE MACHINE (Communication -> Web Server):');
    console.log(`  Server Address   : ${serverIp}`);
    console.log(`  Port Number      : ${config.port}`);
    console.log(`  Web Server URL   : ws://${serverIp}:${config.port}/biometric`);
    console.log('===================================================================');
  });
}

start().catch((err) => {
  console.error('[FATAL] Failed to start biometric WebSocket server:', err);
  process.exit(1);
});
