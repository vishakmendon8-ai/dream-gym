/**
 * LAN Network Helpers & TCP/IP Reachability Probe for Secureye Biometric Devices.
 *
 * - Detects the gym PC's local Wi-Fi / Ethernet IPv4 address(es) so you know
 *   which Server Address to type into Secureye -> Comm. -> Cloud Server / ADMS.
 * - Probes TCP/IP connectivity from the gym PC to the Secureye machine on
 *   common Secureye / ZKTeco ports (4000, 4370, 5005, 80, 8080).
 */

import net from 'net';
import os from 'os';
import { fileURLToPath } from 'url';

export const DEFAULT_PROBE_PORTS = [4000, 4370, 5005, 80, 8080];

/**
 * Return non-loopback IPv4 LAN addresses of the host running this bridge.
 */
export function getLocalLanIps() {
  const ifaces = os.networkInterfaces();
  const results = [];

  for (const [name, list] of Object.entries(ifaces)) {
    if (!Array.isArray(list)) continue;
    for (const addr of list) {
      if (addr.family === 'IPv4' && !addr.internal) {
        results.push({
          interface: name,
          address: addr.address,
          netmask: addr.netmask,
        });
      }
    }
  }

  // Prefer typical private LAN ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x) first
  results.sort((a, b) => {
    const score = (ip) =>
      ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3;
    return score(a.address) - score(b.address);
  });

  return results;
}

/**
 * Check whether a single TCP host:port accepts a connection within timeoutMs.
 */
export function probeTcpPort(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      resolve({
        port: Number(port),
        ...result,
        latencyMs: Date.now() - started,
      });
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      finish({ open: true, status: 'open', error: null });
    });

    socket.once('timeout', () => {
      finish({ open: false, status: 'timeout', error: `Timed out after ${timeoutMs}ms` });
    });

    socket.once('error', (err) => {
      const code = err?.code || 'ERROR';
      finish({
        open: false,
        status: code === 'ECONNREFUSED' ? 'closed' : 'unreachable',
        error: `${code}: ${err.message}`,
      });
    });

    try {
      socket.connect(Number(port), String(host).trim());
    } catch (err) {
      finish({ open: false, status: 'error', error: err.message });
    }
  });
}

/**
 * Probe multiple TCP ports on a Secureye device in parallel.
 */
export async function probeSecureyeDevice(host, ports = DEFAULT_PROBE_PORTS, timeoutMs = 2000) {
  const cleanHost = String(host || '').trim();
  if (!cleanHost) {
    throw new Error('Device IP address is required for LAN probe.');
  }

  const uniquePorts = Array.from(
    new Set(
      ports
        .map((p) => Number(p))
        .filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535)
    )
  );

  const checks = await Promise.all(
    uniquePorts.map((port) => probeTcpPort(cleanHost, port, timeoutMs))
  );

  const openPorts = checks.filter((c) => c.open).map((c) => c.port);
  const reachableOnLan =
    openPorts.length > 0 || checks.some((c) => c.status === 'closed');

  let summary = '';
  if (openPorts.length > 0) {
    summary = `Device ${cleanHost} is REACHABLE on LAN! Open TCP port(s): ${openPorts.join(', ')}.`;
  } else if (reachableOnLan) {
    summary = `Device ${cleanHost} responded on LAN (connection refused on tested ports — device is online, verify its TCP/IP port or use ADMS Cloud Server push).`;
  } else {
    summary = `Device ${cleanHost} did not respond on LAN. Verify the PC and Secureye machine are on the same Wi-Fi/router subnet and TCP/IP is ON.`;
  }

  return {
    ok: true,
    host: cleanHost,
    reachableOnLan,
    openPorts,
    results: checks,
    summary,
    checkedAt: new Date().toISOString(),
  };
}

// CLI execution: `node src/lanProbe.js 192.168.1.101 4000,4370,5005,80`
const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const targetIp = process.argv[2] || process.env.SECUREYE_DEVICE_IP || '192.168.1.101';
  const portsArg = process.argv[3]
    ? process.argv[3].split(',').map((s) => Number(s.trim()))
    : DEFAULT_PROBE_PORTS;

  console.log('===================================================================');
  console.log('Dream Gym — Secureye LAN TCP/IP Diagnostic Probe');
  console.log('===================================================================');
  const lanIps = getLocalLanIps();
  console.log(
    'This PC LAN IP(s):',
    lanIps.length > 0 ? lanIps.map((i) => `${i.address} (${i.interface})`).join(', ') : 'None detected'
  );
  console.log(`Probing Secureye Device: ${targetIp} on ports [${portsArg.join(', ')}]...`);
  console.log('');

  probeSecureyeDevice(targetIp, portsArg)
    .then((report) => {
      for (const r of report.results) {
        const badge = r.open ? 'OPEN       ' : r.status.toUpperCase().padEnd(11);
        console.log(`  Port ${String(r.port).padEnd(5)} -> ${badge} (${r.latencyMs}ms)${r.error ? ` | ${r.error}` : ''}`);
      }
      console.log('');
      console.log('Result:', report.summary);
      if (lanIps.length > 0) {
        console.log('');
        console.log('Next step on Secureye machine -> Menu -> Comm. -> Cloud Server / ADMS:');
        console.log(`  Server Address : ${lanIps[0].address}`);
        console.log(`  Server Port    : ${process.env.PORT || 8080}`);
        console.log('  Domain Name    : OFF');
        console.log('  HTTPS          : OFF');
      }
    })
    .catch((err) => {
      console.error('Probe failed:', err.message);
      process.exit(1);
    });
}
