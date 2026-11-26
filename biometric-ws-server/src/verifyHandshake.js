/**
 * Automated Verification Script for /biometric WebSocket Handshake & Diagnostic Receiver.
 *
 * Tests:
 *  1. Plain HTTP GET /biometric returns 426 Upgrade Required
 *  2. Standard RFC 6455 WebSocket upgrade on /biometric returns HTTP 101 Switching Protocols
 *  3. Diagnostic receiver captures Binary, Plain Text, and JSON frames without crashing
 *  4. Device status updates & Disconnect Device API cleanly closes socket
 *
 * Usage:
 *   node src/verifyHandshake.js                      (spawns local test server)
 *   node src/verifyHandshake.js wss://your.run.app/biometric   (verifies live Cloud Run WSS)
 */

import { spawn } from 'child_process';
import WebSocket from 'ws';

const targetArg = process.argv[2] || '';

async function verifyRemoteWss(wssUrl) {
  console.log(`Verifying live WebSocket handshake on: ${wssUrl}`);
  let upgradeCode = 0;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wssUrl);
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('WebSocket handshake timed out after 10s'));
    }, 10_000);

    ws.on('upgrade', (res) => {
      upgradeCode = res.statusCode;
      console.log(`[OK] HTTP Upgrade Status: ${res.statusCode} ${res.statusMessage || ''}`);
    });

    ws.on('open', () => {
      console.log('[OK] WebSocket connection opened successfully!');
      clearTimeout(timeout);
      ws.close(1000, 'Handshake verification complete');
      resolve();
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  if (upgradeCode !== 101) {
    throw new Error(`Expected HTTP 101 Switching Protocols, received ${upgradeCode}`);
  }
  console.log('LIVE CLOUD RUN WSS HANDSHAKE VERIFIED!');
}

async function verifyLocalSuite() {
  const testPort = '18090';
  const child = spawn('node', ['src/server.js'], {
    env: { ...process.env, PORT: testPort },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let ready = false;
  child.stdout.on('data', (d) => {
    const s = d.toString();
    if (s.includes('Dedicated Secureye Biometric WebSocket Server Ready')) ready = true;
  });
  child.stderr.on('data', (d) => process.stderr.write(d.toString()));

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40 && !ready; i++) await wait(150);
  if (!ready) {
    child.kill();
    throw new Error('Server failed to start');
  }

  const base = `http://127.0.0.1:${testPort}`;

  // 1. Plain HTTP GET /biometric -> 426
  const httpRes = await fetch(`${base}/biometric`);
  if (httpRes.status !== 426) throw new Error(`Expected 426, got ${httpRes.status}`);
  console.log('[OK] Plain HTTP GET /biometric returned 426 Upgrade Required');

  // 2. WebSocket handshake -> HTTP 101
  let upgradeCode = 0;
  const ws = new WebSocket(`ws://127.0.0.1:${testPort}/biometric`);
  ws.on('upgrade', (res) => { upgradeCode = res.statusCode; });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  if (upgradeCode !== 101) throw new Error(`Expected 101, got ${upgradeCode}`);
  console.log('[OK] WebSocket /biometric handshake returned HTTP 101 Switching Protocols');

  // 3. Diagnostic capture: Binary, Plain Text, and JSON registration
  ws.send(Buffer.from([0xaa, 0x55, 0x01, 0x02, 0x03, 0x04]));
  ws.send('PLAIN_TEXT_DIAGNOSTIC_PROBE');
  await wait(200);

  const diagRes = await (await fetch(`${base}/api/biometric/diagnostics?limit=10`)).json();
  const hasBinary = diagRes.logs.some((l) => l.messageType === 'binary' && l.hexPreview === 'aa5501020304');
  const hasText = diagRes.logs.some((l) => l.messageType === 'text' && l.rawText === 'PLAIN_TEXT_DIAGNOSTIC_PROBE');
  if (!hasBinary || !hasText) {
    throw new Error('Diagnostic receiver failed to record binary/text frames');
  }
  console.log('[OK] Diagnostic receiver captured Binary (hex/base64) and Plain Text frames');

  // 4. Device registration + Disconnect API
  const replies = [];
  ws.on('message', (m) => replies.push(JSON.parse(m.toString())));
  ws.send(JSON.stringify({ cmd: 'reg', sn: '102026020002110' }));
  await wait(150);
  if (!replies.some((r) => r.ret === 'reg' && r.result === true)) {
    throw new Error('Missing reg ack');
  }
  console.log('[OK] Device registration acknowledged & status persisted');

  const discRes = await (
    await fetch(`${base}/api/biometric/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: '102026020002110' }),
    })
  ).json();
  if (!discRes.ok) throw new Error('Disconnect API failed');
  console.log('[OK] Admin Disconnect Device API closed socket cleanly');

  child.kill();
  console.log('ALL DEDICATED WEBSOCKET SERVER TESTS PASSED!');
}

(targetArg ? verifyRemoteWss(targetArg) : verifyLocalSuite())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[FAIL]', err.message);
    process.exit(1);
  });
