import React, { useEffect, useRef, useState } from 'react';
import { useGym } from '../../context/GymContext';
import {
  AdmsAttendanceRow,
  AdmsDeviceRow,
  AdmsRawLogRow,
  AdmsServerHealth,
  ConnectedWsDevice,
  LanDeviceProbeResponse,
  buildBridgeWsUrl,
  fetchAdmsAttendance,
  fetchAdmsDevices,
  fetchAdmsHealth,
  fetchAdmsRawLogs,
  probeLanDevice,
  registerAdmsDevice,
  sendWsDeviceCommand,
} from '../../services/admsBackendClient';
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Fingerprint,
  Network,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Server,
  Terminal,
  Wifi,
  WifiOff,
} from 'lucide-react';

const DEFAULT_ADMS_URL =
  import.meta.env.VITE_ADMS_API_URL ||
  (typeof window !== 'undefined' ? window.localStorage.getItem('dreamgym_adms_url') || '' : '') ||
  'http://localhost:8080';

function fmtTime(iso?: string | null) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export const AdmsBackendPanel: React.FC = () => {
  const { playAccessTone } = useGym();
  const [serverUrl, setServerUrl] = useState(DEFAULT_ADMS_URL);
  const [apiToken, setApiToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [health, setHealth] = useState<AdmsServerHealth | null>(null);
  const [devices, setDevices] = useState<AdmsDeviceRow[]>([]);
  const [attendance, setAttendance] = useState<AdmsAttendanceRow[]>([]);
  const [attendanceTotal, setAttendanceTotal] = useState(0);
  const [rawLogs, setRawLogs] = useState<AdmsRawLogRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Live WebSocket state (Dream Gym <-> Bridge /ws/live)
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [wsDevices, setWsDevices] = useState<ConnectedWsDevice[]>([]);
  const [lastLiveEvent, setLastLiveEvent] = useState<string | null>(null);
  const [wsCmdFeedback, setWsCmdFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // LAN TCP/IP Device Probe
  const [probeIp, setProbeIp] = useState('192.168.1.101');
  const [probePorts, setProbePorts] = useState('4000,4370,5005,80,8080');
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<LanDeviceProbeResponse | null>(null);

  // Filters for GET /api/attendance
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterEmp, setFilterEmp] = useState('');
  const [filterSn, setFilterSn] = useState('');

  // Pre-filled with verified Secureye machine details (status stays Offline until real heartbeat)
  const [regSn, setRegSn] = useState('102026020002110');
  const [regName, setRegName] = useState('Dream Gym Secureye Main Entrance');
  const [regLocation, setRegLocation] = useState('Main Entrance');
  const [regIp, setRegIp] = useState('192.168.1.101');
  const [regSaving, setRegSaving] = useState(false);
  const [regMsg, setRegMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const copyValue = (key: string, value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(value).catch(() => {});
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  };

  const loadAll = async (targetUrl = serverUrl, silent = false) => {
    const cleaned = targetUrl.trim();
    if (!cleaned) return;
    if (!silent) setLoading(true);
    setErrorMsg(null);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('dreamgym_adms_url', cleaned);
    }

    const h = await fetchAdmsHealth(cleaned);
    setHealth(h);

    if (!h.ok) {
      setErrorMsg(h.error || 'Unable to connect to Local LAN Bridge.');
      setDevices([]);
      setAttendance([]);
      setRawLogs([]);
      setWsDevices([]);
      if (!silent) setLoading(false);
      return;
    }

    if (Array.isArray(h.connectedWsDevices)) {
      setWsDevices(h.connectedWsDevices);
    }

    const [devRes, attRes, rawRes] = await Promise.all([
      fetchAdmsDevices(cleaned, apiToken),
      fetchAdmsAttendance(
        cleaned,
        {
          from: filterFrom || undefined,
          to: filterTo || undefined,
          employee_code: filterEmp.trim() || undefined,
          device_sn: filterSn.trim() || undefined,
          limit: 100,
        },
        apiToken
      ),
      fetchAdmsRawLogs(cleaned, apiToken, 25),
    ]);

    if (!devRes.ok) {
      setErrorMsg(devRes.error || 'Failed to list devices from bridge.');
    } else {
      setDevices(devRes.devices);
    }

    if (attRes.ok) {
      setAttendance(attRes.data);
      setAttendanceTotal(attRes.total);
    }

    if (rawRes.ok) {
      setRawLogs(rawRes.logs);
    }

    if (!silent) setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  // Maintain live WebSocket stream to ws://<bridge>/ws/live whenever bridge is reachable
  useEffect(() => {
    if (!health?.ok) {
      setWsStatus('disconnected');
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
      return;
    }

    const wsUrl = buildBridgeWsUrl(serverUrl, apiToken);
    if (!wsUrl) return;

    let cancelled = false;
    setWsStatus('connecting');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!cancelled) setWsStatus('connected');
    };

    ws.onmessage = (event) => {
      if (cancelled) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'welcome' && Array.isArray(msg.data?.connectedWsDevices)) {
          setWsDevices(msg.data.connectedWsDevices);
        } else if (msg.type === 'ws_device_status' && Array.isArray(msg.data?.connectedWsDevices)) {
          setWsDevices(msg.data.connectedWsDevices);
          setLastLiveEvent(
            `WebSocket device ${msg.data.serial_number || 'unknown'} ${msg.data.connected ? 'CONNECTED' : 'DISCONNECTED'}`
          );
          loadAll(serverUrl, true);
        } else if (msg.type === 'attendance_punch') {
          const d = msg.data || {};
          setLastLiveEvent(
            `Live Punch (${d.protocol || 'adms'}): User ${d.employee_code} on SN ${d.device_sn} (${d.verify_mode_label || 'Biometric'})`
          );
          playAccessTone(d.granted === false ? 'denied' : 'granted');
          loadAll(serverUrl, true);
        } else if (msg.type === 'device_heartbeat') {
          setLastLiveEvent(
            `Heartbeat from SN ${msg.data?.serial_number} (${msg.data?.protocol || 'adms'})`
          );
          loadAll(serverUrl, true);
        } else if (msg.type === 'raw_packet') {
          const p = msg.data;
          setRawLogs((prev) => [
            {
              id: Date.now(),
              method: p.method,
              path: p.path,
              query_string: p.query_string,
              device_sn: p.device_sn,
              remote_ip: p.remote_ip,
              raw_body: p.raw_body,
              received_at: p.received_at,
            },
            ...prev.slice(0, 24),
          ]);
        } else if (msg.type === 'ws_device_reply') {
          setWsCmdFeedback({
            ok: true,
            text: `Reply from SN ${msg.data?.serial_number}: ${JSON.stringify(msg.data?.reply)}`,
          });
        }
      } catch {}
    };

    ws.onclose = () => {
      if (!cancelled) setWsStatus('disconnected');
    };

    ws.onerror = () => {
      if (!cancelled) setWsStatus('disconnected');
    };

    return () => {
      cancelled = true;
      try { ws.close(); } catch {}
      wsRef.current = null;
    };
  }, [health?.ok, serverUrl, apiToken]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      loadAll(serverUrl, true);
    }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, serverUrl, apiToken, filterFrom, filterTo, filterEmp, filterSn]);

  const handleSendWsCmd = async (sn: string, cmdObj: Record<string, unknown>) => {
    setWsCmdFeedback(null);
    const res = await sendWsDeviceCommand(serverUrl, sn, cmdObj, apiToken);
    if (!res.ok) {
      setWsCmdFeedback({ ok: false, text: res.error || 'Failed to send WebSocket command.' });
    } else {
      setWsCmdFeedback({ ok: true, text: `Sent to SN ${sn}: ${res.sent}` });
    }
  };

  const handleRunProbe = async (e: React.FormEvent) => {
    e.preventDefault();
    setProbing(true);
    setProbeResult(null);
    const res = await probeLanDevice(serverUrl, probeIp, probePorts, apiToken);
    setProbeResult(res);
    setProbing(false);
  };

  const handleRegisterDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegSaving(true);
    setRegMsg(null);
    const res = await registerAdmsDevice(
      serverUrl,
      {
        serial_number: regSn.trim(),
        name: regName.trim(),
        location: regLocation.trim(),
        ip_address: regIp.trim() || undefined,
      },
      apiToken
    );
    if (!res.ok) {
      setRegMsg({ ok: false, text: res.error || 'Failed to register device.' });
    } else {
      setRegMsg({
        ok: true,
        text: `Device SN ${regSn.trim()} registered as OFFLINE on the bridge. It will automatically switch to ONLINE once your Secureye machine sends its first /iclock/cdata or WebSocket heartbeat.`,
      });
      await loadAll();
    }
    setRegSaving(false);
  };

  const detectedLanIp = health?.lanIps?.[0] || '<YOUR_GYM_PC_LAN_IP>';
  const listenPort = health?.listenPort || 8080;

  return (
    <div className="space-y-5">
      {/* Bridge Connection Bar */}
      <div className="bg-white rounded-2xl p-5 border border-[#DCE3E8] shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#E9ECEF]">
          <div>
            <h3 className="text-sm font-black text-[#252A30] flex items-center gap-2">
              <Server className="w-4 h-4 text-[#E5B82A]" />
              <span>Local LAN Bridge &amp; Secureye ADMS / WebSocket Server</span>
            </h3>
            <p className="text-xs text-[#84909A]">
              Supports both <strong>ADMS HTTP Push</strong> (<code>/iclock/cdata</code>) and <strong>Hardware WebSocket</strong> (<code>ws://</code>) on port <code>{listenPort}</code>, with live WebSocket streaming to Dream Gym.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase border inline-flex items-center gap-1 ${
                wsStatus === 'connected'
                  ? 'bg-[#36A875]/15 text-[#36A875] border-[#36A875]/30'
                  : wsStatus === 'connecting'
                  ? 'bg-[#FFF8E7] text-[#8A6112] border-[#FFD447]/60'
                  : 'bg-[#84909A]/10 text-[#84909A] border-[#DCE3E8]'
              }`}
            >
              <Radio className={`w-3 h-3 ${wsStatus === 'connected' ? 'animate-pulse' : ''}`} />
              <span>
                {wsStatus === 'connected'
                  ? 'WS Live Stream ON'
                  : wsStatus === 'connecting'
                  ? 'WS Connecting...'
                  : 'WS Offline'}
              </span>
            </span>
            {health?.ok && (
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase border ${
                  health.firebaseSyncEnabled
                    ? 'bg-[#36A875]/15 text-[#36A875] border-[#36A875]/30'
                    : 'bg-[#FFF8E7] text-[#8A6112] border-[#FFD447]/60'
                }`}
              >
                {health.firebaseSyncEnabled ? 'Firebase Sync ON' : 'Firebase Key Not Added'}
              </span>
            )}
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase border ${
                health?.ok
                  ? 'bg-[#36A875]/15 text-[#36A875] border-[#36A875]/30'
                  : 'bg-[#DC5555]/10 text-[#DC5555] border-[#DC5555]/30'
              }`}
            >
              {health === null
                ? 'Checking...'
                : health.ok
                ? `Bridge Online (${(health.database || 'SQL').toUpperCase()})`
                : 'Bridge Not Running'}
            </span>
          </div>
        </div>

        {lastLiveEvent && (
          <div className="p-2.5 rounded-xl bg-[#36A875]/10 border border-[#36A875]/30 text-xs font-bold text-[#237A54] flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 shrink-0 animate-pulse" />
            <span>{lastLiveEvent}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
          <div className="md:col-span-5">
            <label className="block font-bold text-[#252A30] mb-1">Bridge URL (Local Gym PC or Cloud)</label>
            <input
              type="url"
              placeholder="http://localhost:8080"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] font-mono font-bold text-[#252A30] focus:outline-none focus:border-[#FFD447]"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block font-bold text-[#252A30] mb-1">API Token (Optional)</label>
            <input
              type="password"
              placeholder="Leave blank for local PC"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] font-mono text-[#252A30] focus:outline-none focus:border-[#FFD447]"
            />
          </div>
          <div className="md:col-span-2 flex items-end">
            <button
              onClick={() => loadAll()}
              disabled={loading}
              className="w-full py-2 px-3 rounded-xl bg-[#252A30] text-[#FFD447] font-black text-xs flex items-center justify-center gap-1.5 hover:bg-[#313740] transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Loading...' : 'Refresh'}</span>
            </button>
          </div>
          <div className="md:col-span-2 flex items-end">
            <button
              type="button"
              onClick={() => setAutoRefresh((v) => !v)}
              className={`w-full py-2 px-3 rounded-xl border font-black text-xs flex items-center justify-center gap-1.5 transition-all ${
                autoRefresh
                  ? 'bg-[#36A875] text-white border-[#36A875]'
                  : 'bg-[#F5F6F2] text-[#252A30] border-[#DCE3E8] hover:border-[#FFD447]'
              }`}
            >
              <Activity className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-pulse' : ''}`} />
              <span>{autoRefresh ? 'Live 5s ON' : 'Auto-Refresh'}</span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-[#FFF8E7] border border-[#FFD447]/60 text-xs font-semibold text-[#8A6112] flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#E5A024]" />
            <div>
              <p>{errorMsg}</p>
              <p className="text-[11px] font-normal mt-1">
                Start the bridge on your gym PC by double-clicking <code>adms-server/start-bridge.bat</code> (Windows) or running <code>cd adms-server &amp;&amp; npm install &amp;&amp; npm start</code>.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Secureye Machine Cloud Server / ADMS Settings + LAN TCP/IP Probe */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Exact Settings for Secureye Touchscreen */}
        <div className="xl:col-span-6 bg-gradient-to-br from-[#252A30] to-[#1B1F24] text-white rounded-2xl p-5 border border-[#313740] shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider text-[#FFD447] flex items-center gap-1.5">
                <Wifi className="w-4 h-4" />
                <span>Enter on Your Secureye Machine</span>
              </h4>
              <p className="text-[11px] text-white/70 mt-0.5">
                Menu &rarr; <strong>Comm.</strong> &rarr; <strong>Cloud Server / ADMS / Server Setting</strong>
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-[#FFD447]/15 text-[#FFD447] border border-[#FFD447]/30">
              SN: 102026020002110
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/55 font-bold">Server Address</p>
                <p className="font-mono font-black text-sm text-[#FFD447]">{detectedLanIp}</p>
              </div>
              {health?.lanIps?.[0] && (
                <button
                  type="button"
                  onClick={() => copyValue('ip', detectedLanIp)}
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
                  title="Copy LAN IP"
                >
                  {copiedKey === 'ip' ? <Check className="w-3.5 h-3.5 text-[#36A875]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>

            <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/55 font-bold">Server Port</p>
                <p className="font-mono font-black text-sm text-white">{listenPort}</p>
              </div>
              <button
                type="button"
                onClick={() => copyValue('port', String(listenPort))}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
                title="Copy Port"
              >
                {copiedKey === 'port' ? <Check className="w-3.5 h-3.5 text-[#36A875]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
              <p className="text-[10px] uppercase tracking-wider text-white/55 font-bold">Enable Domain Name</p>
              <p className="font-mono font-bold text-white">OFF (raw IPv4)</p>
            </div>

            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
              <p className="text-[10px] uppercase tracking-wider text-white/55 font-bold">HTTPS / Proxy</p>
              <p className="font-mono font-bold text-white">OFF (Plain HTTP)</p>
            </div>
          </div>

          <p className="text-[11px] text-white/65 leading-relaxed">
            Do <strong>not</strong> type <code>http://</code> or <code>/iclock/cdata</code> — the Secureye firmware appends <code>/iclock/cdata</code> automatically. Save &amp; reboot the machine, then watch the <strong>Raw Hardware Packet Debugger</strong> below.
          </p>
        </div>

        {/* LAN TCP/IP Reachability Probe */}
        <div className="xl:col-span-6 bg-white rounded-2xl p-5 border border-[#DCE3E8] shadow-xs space-y-3.5">
          <div className="flex items-center justify-between border-b border-[#E9ECEF] pb-2.5">
            <div>
              <h4 className="text-xs font-black text-[#252A30] uppercase tracking-wider flex items-center gap-1.5">
                <Network className="w-4 h-4 text-[#E5B82A]" />
                <span>LAN TCP/IP Device Probe</span>
              </h4>
              <p className="text-[11px] text-[#84909A]">
                Verify that your gym PC can reach the Secureye machine over Wi-Fi / TCP/IP right now.
              </p>
            </div>
          </div>

          <form onSubmit={handleRunProbe} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 text-xs">
            <div className="sm:col-span-5">
              <label className="block font-bold text-[#252A30] mb-1">Secureye Local IP</label>
              <input
                type="text"
                required
                value={probeIp}
                onChange={(e) => setProbeIp(e.target.value)}
                placeholder="192.168.1.101"
                className="w-full px-3 py-1.5 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] font-mono font-bold"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block font-bold text-[#252A30] mb-1">TCP Ports</label>
              <input
                type="text"
                value={probePorts}
                onChange={(e) => setProbePorts(e.target.value)}
                placeholder="4000,4370,5005,80"
                className="w-full px-3 py-1.5 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] font-mono"
              />
            </div>
            <div className="sm:col-span-3 flex items-end">
              <button
                type="submit"
                disabled={probing || !health?.ok}
                className="w-full py-1.5 px-3 rounded-xl bg-gradient-to-r from-[#FFD447] to-[#F5C62F] text-[#252A30] font-black text-xs disabled:opacity-50"
              >
                {probing ? 'Probing...' : 'Test TCP/IP'}
              </button>
            </div>
          </form>

          {probeResult && (
            <div className="space-y-2">
              <div
                className={`p-2.5 rounded-xl text-xs font-semibold border flex items-start gap-2 ${
                  probeResult.openPorts && probeResult.openPorts.length > 0
                    ? 'bg-[#36A875]/10 border-[#36A875]/30 text-[#237A54]'
                    : probeResult.reachableOnLan
                    ? 'bg-[#FFF8E7] border-[#FFD447]/60 text-[#8A6112]'
                    : 'bg-[#DC5555]/10 border-[#DC5555]/30 text-[#DC5555]'
                }`}
              >
                {probeResult.openPorts && probeResult.openPorts.length > 0 ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{probeResult.summary || probeResult.error}</span>
              </div>

              {probeResult.results && probeResult.results.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {probeResult.results.map((r) => (
                    <span
                      key={r.port}
                      className={`px-2.5 py-1 rounded-lg font-mono text-[11px] font-bold border ${
                        r.open
                          ? 'bg-[#36A875]/15 text-[#237A54] border-[#36A875]/30'
                          : 'bg-[#F5F6F2] text-[#84909A] border-[#DCE3E8]'
                      }`}
                    >
                      :{r.port} {r.open ? `OPEN (${r.latencyMs}ms)` : r.status.toUpperCase()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* WebSocket Two-Way Hardware Controls */}
      <div className="bg-white rounded-2xl p-5 border border-[#DCE3E8] shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#E9ECEF]">
          <div>
            <h4 className="text-xs font-black text-[#252A30] uppercase tracking-wider flex items-center gap-1.5">
              <Radio className="w-4 h-4 text-[#E5B82A]" />
              <span>WebSocket Endpoints &amp; Two-Way Hardware Commands</span>
            </h4>
            <p className="text-[11px] text-[#84909A]">
              Device WS URL: <code>ws://{detectedLanIp}:{listenPort}/</code> &bull; Browser Live Stream: <code>ws://localhost:{listenPort}/ws/live</code>
            </p>
          </div>
          <span className="text-[11px] font-bold text-[#84909A]">
            {wsDevices.length} Active Hardware WS Session(s)
          </span>
        </div>

        {wsCmdFeedback && (
          <div
            className={`p-2.5 rounded-xl text-xs font-semibold border flex items-start gap-2 ${
              wsCmdFeedback.ok
                ? 'bg-[#36A875]/10 border-[#36A875]/30 text-[#237A54]'
                : 'bg-[#DC5555]/10 border-[#DC5555]/30 text-[#DC5555]'
            }`}
          >
            {wsCmdFeedback.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span className="break-all font-mono">{wsCmdFeedback.text}</span>
          </div>
        )}

        {wsDevices.length === 0 ? (
          <p className="text-xs text-[#84909A]">
            No biometric machine is currently holding an open WebSocket session. If your Secureye model uses ADMS HTTP Push, punches still stream live to this page over <code>/ws/live</code>. If your model uses WebSocket push (<code>cmd: &quot;reg&quot; / &quot;sendlog&quot;</code>), point it to <code>{detectedLanIp}:{listenPort}</code> and two-way controls will appear here automatically.
          </p>
        ) : (
          <div className="space-y-2">
            {wsDevices.map((d) => (
              <div
                key={d.serial_number}
                className="p-3 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs"
              >
                <div>
                  <p className="font-mono font-black text-[#252A30]">
                    SN: {d.serial_number}{' '}
                    <span className="text-[10px] font-bold text-[#36A875]">(WS OPEN)</span>
                  </p>
                  <p className="text-[10px] text-[#84909A] font-mono">
                    IP: {d.remote_ip} &bull; Path: {d.path} &bull; Connected: {fmtTime(d.connected_at)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleSendWsCmd(d.serial_number, { cmd: 'getnewlog', stn: true })}
                    className="px-2.5 py-1.5 rounded-lg bg-[#252A30] text-[#FFD447] font-bold text-[11px] inline-flex items-center gap-1"
                  >
                    <Send className="w-3 h-3" />
                    <span>Pull New Logs</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendWsCmd(d.serial_number, { cmd: 'getalllog', stn: true })}
                    className="px-2.5 py-1.5 rounded-lg bg-white border border-[#DCE3E8] text-[#252A30] font-bold text-[11px]"
                  >
                    Pull All Logs
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendWsCmd(d.serial_number, { cmd: 'opendoor' })}
                    className="px-2.5 py-1.5 rounded-lg bg-[#36A875] text-white font-bold text-[11px]"
                  >
                    Unlock Door
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Devices List + Quick Registration */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-4 bg-white rounded-2xl p-5 border border-[#DCE3E8] shadow-xs space-y-3">
          <h4 className="text-xs font-black text-[#252A30] uppercase tracking-wider flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5 text-[#E5B82A]" />
            <span>Pre-Register Secureye Device</span>
          </h4>
          <p className="text-[11px] text-[#84909A]">
            Pre-filled with your Secureye serial number and local IP. Status remains <strong>Offline</strong> until a real hardware heartbeat arrives.
          </p>

          {regMsg && (
            <div
              className={`p-2.5 rounded-xl text-xs font-semibold border flex items-start gap-2 ${
                regMsg.ok
                  ? 'bg-[#36A875]/10 border-[#36A875]/30 text-[#237A54]'
                  : 'bg-[#DC5555]/10 border-[#DC5555]/30 text-[#DC5555]'
              }`}
            >
              {regMsg.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{regMsg.text}</span>
            </div>
          )}

          <form onSubmit={handleRegisterDevice} className="space-y-2.5 text-xs">
            <div>
              <label className="block font-bold text-[#252A30] mb-1">Serial Number *</label>
              <input
                type="text"
                required
                value={regSn}
                onChange={(e) => setRegSn(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-[#252A30] mb-1">Device Name</label>
              <input
                type="text"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] font-semibold"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-bold text-[#252A30] mb-1">Location</label>
                <input
                  type="text"
                  value={regLocation}
                  onChange={(e) => setRegLocation(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8]"
                />
              </div>
              <div>
                <label className="block font-bold text-[#252A30] mb-1">Local IP</label>
                <input
                  type="text"
                  value={regIp}
                  onChange={(e) => setRegIp(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] font-mono"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={regSaving || !health?.ok}
              className="w-full py-2 rounded-xl bg-gradient-to-r from-[#FFD447] to-[#F5C62F] text-[#252A30] font-black text-xs disabled:opacity-50"
            >
              {regSaving ? 'Registering...' : 'Register Device on Bridge'}
            </button>
          </form>
        </div>

        {/* Live Devices Table */}
        <div className="xl:col-span-8 bg-white rounded-2xl p-5 border border-[#DCE3E8] shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E9ECEF]">
            <h4 className="text-xs font-black text-[#252A30] uppercase tracking-wider flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-[#E5B82A]" />
              <span>Connected Biometric Devices</span>
            </h4>
            <span className="text-xs font-bold text-[#84909A]">{devices.length} Device(s)</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#F5F6F2] border-b border-[#DCE3E8] text-[10px] font-bold text-[#84909A] uppercase">
                  <th className="py-2.5 px-3">Serial Number</th>
                  <th className="py-2.5 px-3">Name &amp; Location</th>
                  <th className="py-2.5 px-3">IP</th>
                  <th className="py-2.5 px-3">Last Heartbeat</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E9ECEF]">
                {devices.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-[#84909A]">
                      No devices seen on the bridge yet. Point your Secureye Cloud Server / ADMS setting to <code>{detectedLanIp}:{listenPort}</code>.
                    </td>
                  </tr>
                ) : (
                  devices.map((dev) => (
                    <tr key={dev.serial_number} className="hover:bg-[#F5F6F2]/50">
                      <td className="py-2.5 px-3 font-mono font-bold text-[#252A30]">
                        {dev.serial_number}
                      </td>
                      <td className="py-2.5 px-3">
                        <p className="font-bold text-[#252A30]">{dev.name}</p>
                        <p className="text-[10px] text-[#84909A]">{dev.location}</p>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">{dev.ip_address || '—'}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">{fmtTime(dev.last_seen_at)}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            dev.is_online
                              ? 'bg-[#36A875]/15 text-[#36A875]'
                              : 'bg-[#DC5555]/10 text-[#DC5555]'
                          }`}
                        >
                          {dev.is_online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                          {dev.is_online ? 'Online' : 'Offline'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Live Attendance Punches Table */}
      <div className="bg-white rounded-2xl p-5 border border-[#DCE3E8] shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[#E9ECEF]">
          <h4 className="text-xs font-black text-[#252A30] uppercase tracking-wider flex items-center gap-1.5">
            <Fingerprint className="w-3.5 h-3.5 text-[#E5B82A]" />
            <span>Live Hardware Attendance Punches ({attendanceTotal} Total)</span>
          </h4>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-[#F5F6F2] border border-[#DCE3E8]"
            />
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-[#F5F6F2] border border-[#DCE3E8]"
            />
            <input
              type="text"
              placeholder="Secureye User ID"
              value={filterEmp}
              onChange={(e) => setFilterEmp(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-[#F5F6F2] border border-[#DCE3E8] w-36"
            />
            <input
              type="text"
              placeholder="Device SN"
              value={filterSn}
              onChange={(e) => setFilterSn(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-[#F5F6F2] border border-[#DCE3E8] w-36 font-mono"
            />
            <button
              onClick={() => loadAll()}
              className="px-3 py-1.5 rounded-lg bg-[#252A30] text-[#FFD447] font-bold"
            >
              Filter
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#F5F6F2] border-b border-[#DCE3E8] text-[10px] font-bold text-[#84909A] uppercase">
                <th className="py-2.5 px-3">Punch Time</th>
                <th className="py-2.5 px-3">Device SN</th>
                <th className="py-2.5 px-3">Secureye User ID</th>
                <th className="py-2.5 px-3">State</th>
                <th className="py-2.5 px-3">Verify Mode</th>
                <th className="py-2.5 px-3">Raw Payload</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E9ECEF]">
              {attendance.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-[#84909A]">
                    No punches received from the Secureye machine yet. Place a finger/card on the scanner once it is Online.
                  </td>
                </tr>
              ) : (
                attendance.map((row) => (
                  <tr key={row.id} className="hover:bg-[#F5F6F2]/50">
                    <td className="py-2.5 px-3 font-mono font-bold text-[#252A30]">
                      {fmtTime(row.punch_time)}
                    </td>
                    <td className="py-2.5 px-3 font-mono">{row.device_sn}</td>
                    <td className="py-2.5 px-3 font-mono font-bold text-[#252A30]">
                      {row.employee_code}
                    </td>
                    <td className="py-2.5 px-3">{row.punch_state_label || row.punch_state}</td>
                    <td className="py-2.5 px-3">{row.verify_mode_label || row.verify_mode}</td>
                    <td className="py-2.5 px-3 font-mono text-[10px] text-[#84909A]">
                      {row.raw_payload}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Raw Incoming Packet Log */}
      <div className="bg-white rounded-2xl p-5 border border-[#DCE3E8] shadow-xs space-y-3">
        <h4 className="text-xs font-black text-[#252A30] uppercase tracking-wider flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5 text-[#E5B82A]" />
          <span>Raw Hardware Packet Debugger (GET /api/debug/raw)</span>
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#F5F6F2] border-b border-[#DCE3E8] text-[10px] font-bold text-[#84909A] uppercase">
                <th className="py-2 px-3">Time</th>
                <th className="py-2 px-3">Method &amp; Path</th>
                <th className="py-2 px-3">SN / IP</th>
                <th className="py-2 px-3">Raw Body</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E9ECEF]">
              {rawLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-5 text-center text-[#84909A]">
                    Waiting for first incoming <code>/iclock/cdata</code> packet from your Secureye device.
                  </td>
                </tr>
              ) : (
                rawLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2 px-3 font-mono text-[10px] whitespace-nowrap">
                      {fmtTime(log.received_at)}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px]">
                      <strong>{log.method}</strong> {log.path}
                      {log.query_string ? `?${log.query_string}` : ''}
                    </td>
                    <td className="py-2 px-3 font-mono text-[10px]">
                      {log.device_sn || '—'} ({log.remote_ip || '—'})
                    </td>
                    <td className="py-2 px-3 font-mono text-[10px] text-[#5A646E] break-all">
                      {log.raw_body || '(empty)'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
