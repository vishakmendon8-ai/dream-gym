import React, { useEffect, useRef, useState } from 'react';
import { useGym } from '../../context/GymContext';
import {
  BiometricCloudAttendanceRecord,
  BiometricDiagnosticLog,
  CloudBiometricDeviceState,
  buildAdminWsUrl,
  buildBiometricWssUrl,
  disconnectBiometricDevice,
  fetchBiometricAttendance,
  fetchBiometricDiagnostics,
  fetchBiometricStatus,
  syncBiometricAttendance,
  syncMembersToBiometricBackend,
  testBiometricConnection,
} from '../../services/biometricCloudClient';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  FileCode2,
  Fingerprint,
  PowerOff,
  Radio,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Terminal,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { BIOMETRIC_CONFIG } from '../../config/biometricConfig';

const VERIFIED_BASELINE_DEVICE: CloudBiometricDeviceState = {
  id: BIOMETRIC_CONFIG.defaultTerminal.serialNumber,
  brand: 'Secureye',
  serialNumber: BIOMETRIC_CONFIG.defaultTerminal.serialNumber,
  cloudId: BIOMETRIC_CONFIG.defaultTerminal.cloudId,
  deviceUniqueId: BIOMETRIC_CONFIG.defaultTerminal.p2pCloudId,
  localIp: BIOMETRIC_CONFIG.defaultTerminal.ipAddress,
  subnetMask: '255.255.255.0',
  gateway: '192.168.1.1',
  p2pServerIp: '54.187.2.68',
  p2pServerPort: BIOMETRIC_CONFIG.defaultTerminal.p2pPort,
  tcpPort: 5005,
  communicationPassword: false,
  serverClientMode: 'WebSocket',
  p2pLinkStatus: 'Registered',
  registrationStatus: 'awaiting_device_connection',
  wsConnectionStatus: 'disconnected',
  protocolStatus: 'awaiting_device_traffic',
  remoteIp: null,
  connectedAt: null,
  disconnectedAt: null,
  lastHeartbeatAt: null,
  lastReceivedMessage: null,
  lastReceivedMessageType: null,
  lastReceivedMessageAt: null,
  lastAttendanceEvent: null,
  totalAttendanceEvents: 0,
  connectionErrors: [],
  updatedAt: '',
};

function fmtTime(iso?: string | null) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export const BiometricManagementPanel: React.FC = () => {
  const { members, playAccessTone } = useGym();

  const [backendUrl, setBackendUrl] = useState<string>(BIOMETRIC_CONFIG.serverUrl);
  const [apiSecret, setApiSecret] = useState<string>(BIOMETRIC_CONFIG.apiToken);
  const [showServerOverride, setShowServerOverride] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [firestoreConnected, setFirestoreConnected] = useState(false);
  const [adminWsState, setAdminWsState] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');

  const [device, setDevice] = useState<CloudBiometricDeviceState>(VERIFIED_BASELINE_DEVICE);
  const [diagnostics, setDiagnostics] = useState<BiometricDiagnosticLog[]>([]);
  const [attendanceLogs, setAttendanceLogs] = useState<BiometricCloudAttendanceRecord[]>([]);

  const [activeLogView, setActiveLogView] = useState<'diagnostics' | 'attendance'>('diagnostics');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [copiedWss, setCopiedWss] = useState(false);

  const logsSectionRef = useRef<HTMLDivElement | null>(null);
  const adminWsRef = useRef<WebSocket | null>(null);

  const wssEndpoint = backendUrl.trim() ? buildBiometricWssUrl(backendUrl) : BIOMETRIC_CONFIG.wsUrl;

  const refreshAll = async (targetUrl = backendUrl) => {
    const cleaned = targetUrl.trim();
    if (!cleaned) {
      setServerOnline(false);
      setFeedback({
        type: 'warning',
        text: 'Built-in biometric server URL is empty. Reset to default or configure VITE_BIOMETRIC_WS_BACKEND_URL.',
      });
      return;
    }

    setBusyAction('refresh');
    setFeedback(null);

    const statusRes = await fetchBiometricStatus(cleaned, apiSecret);
    if (!statusRes.ok) {
      setServerOnline(false);
      setFirestoreConnected(false);
      setFeedback({
        type: 'error',
        text: statusRes.error || 'Could not reach Cloud Run biometric WebSocket backend.',
      });
      setBusyAction(null);
      return;
    }

    setServerOnline(true);
    setFirestoreConnected(Boolean(statusRes.firestoreConnected));
    if (statusRes.device) {
      setDevice(statusRes.device);
    }

    const [diagRes, attRes] = await Promise.all([
      fetchBiometricDiagnostics(cleaned, apiSecret, 60),
      fetchBiometricAttendance(cleaned, apiSecret, 100),
    ]);

    if (diagRes.ok) setDiagnostics(diagRes.logs);
    if (attRes.ok) setAttendanceLogs(attRes.records);

    setBusyAction(null);
  };

  useEffect(() => {
    if (backendUrl.trim()) {
      refreshAll(backendUrl);
    }
  }, []);

  // Maintain live admin WebSocket stream (/ws/admin) when Cloud Run backend is reachable
  useEffect(() => {
    if (!serverOnline || !backendUrl.trim()) {
      setAdminWsState('disconnected');
      if (adminWsRef.current) {
        try { adminWsRef.current.close(); } catch {}
        adminWsRef.current = null;
      }
      return;
    }

    const adminWsUrl = buildAdminWsUrl(backendUrl, apiSecret);
    if (!adminWsUrl) return;

    let cancelled = false;
    setAdminWsState('connecting');
    const ws = new WebSocket(adminWsUrl);
    adminWsRef.current = ws;

    ws.onopen = () => {
      if (!cancelled) setAdminWsState('connected');
    };

    ws.onmessage = (ev) => {
      if (cancelled) return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'device_status' && msg.data) {
          setDevice(msg.data);
        } else if (msg.type === 'diagnostic' && msg.data) {
          setDiagnostics((prev) => [msg.data, ...prev.slice(0, 59)]);
        } else if (msg.type === 'attendance_event' && msg.data) {
          setAttendanceLogs((prev) => [msg.data, ...prev.slice(0, 99)]);
          playAccessTone(msg.data.status === 'granted' ? 'granted' : 'denied');
        }
      } catch {}
    };

    ws.onclose = () => {
      if (!cancelled) setAdminWsState('disconnected');
    };

    ws.onerror = () => {
      if (!cancelled) setAdminWsState('disconnected');
    };

    return () => {
      cancelled = true;
      try { ws.close(); } catch {}
      adminWsRef.current = null;
    };
  }, [serverOnline, backendUrl, apiSecret]);

  // Button 1: Test Connection
  const handleTestConnection = async () => {
    if (!backendUrl.trim()) {
      setFeedback({
        type: 'warning',
        text: 'Enter your deployed Google Cloud Run HTTPS URL first to run the live connection & WSS handshake test.',
      });
      return;
    }
    setBusyAction('test');
    setFeedback(null);
    const res = await testBiometricConnection(backendUrl, apiSecret);
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error || 'Connection test failed.' });
      playAccessTone('denied');
    } else {
      setFeedback({
        type: res.deviceConnected ? 'success' : 'warning',
        text: res.message || 'Backend connection test completed.',
      });
      if (res.websocketHandshakeOk) playAccessTone('granted');
      await refreshAll(backendUrl);
    }
    setBusyAction(null);
  };

  // Button 2: Refresh Status
  const handleRefreshStatus = async () => {
    await refreshAll(backendUrl);
  };

  // Button 3: View Raw Diagnostic Logs
  const handleViewDiagnostics = async () => {
    setActiveLogView('diagnostics');
    if (backendUrl.trim()) {
      const res = await fetchBiometricDiagnostics(backendUrl, apiSecret, 60);
      if (res.ok) setDiagnostics(res.logs);
    }
    logsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Button 4: View Attendance Logs
  const handleViewAttendance = async () => {
    setActiveLogView('attendance');
    if (backendUrl.trim()) {
      const res = await fetchBiometricAttendance(backendUrl, apiSecret, 100);
      if (res.ok) setAttendanceLogs(res.records);
    }
    logsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Button 5: Synchronize Attendance
  const handleSyncAttendance = async () => {
    if (!backendUrl.trim()) {
      setFeedback({ type: 'warning', text: 'Configure your deployed Cloud Run backend URL first.' });
      return;
    }
    setBusyAction('sync');
    setFeedback(null);
    const res = await syncBiometricAttendance(backendUrl, device.serialNumber, apiSecret);
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error || 'Attendance sync failed.' });
      playAccessTone('denied');
    } else {
      setFeedback({ type: 'success', text: res.message || 'Synchronization command sent.' });
      playAccessTone('granted');
      await refreshAll(backendUrl);
    }
    setBusyAction(null);
  };

  // Button 6: Disconnect Device
  const handleDisconnectDevice = async () => {
    if (!backendUrl.trim()) {
      setFeedback({ type: 'warning', text: 'Configure your deployed Cloud Run backend URL first.' });
      return;
    }
    setBusyAction('disconnect');
    setFeedback(null);
    const res = await disconnectBiometricDevice(backendUrl, device.serialNumber, apiSecret);
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error || 'Disconnect failed.' });
    } else {
      setFeedback({ type: 'warning', text: res.message || 'Device WebSocket disconnected.' });
      await refreshAll(backendUrl);
    }
    setBusyAction(null);
  };

  // Button 7: Enforce Subscription Expiry (Auto-Decline Expired Members on Secureye Machine)
  const handleEnforceSubscriptions = async () => {
    if (!backendUrl.trim()) {
      setFeedback({ type: 'warning', text: 'Configure your backend URL first.' });
      return;
    }
    setBusyAction('enforce');
    setFeedback(null);
    const res = await syncMembersToBiometricBackend(
      backendUrl,
      members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        avatar: m.avatar,
        biometricId: m.biometricId,
        status: m.status,
        planName: m.planName,
        startDate: m.startDate || m.joinDate,
        expiryDate: m.expiryDate,
      })),
      apiSecret
    );
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error || 'Failed to enforce subscription rules.' });
      playAccessTone('denied');
    } else {
      setFeedback({
        type: 'success',
        text:
          res.message ||
          `Subscription expiry rules enforced: ${res.enabledCount ?? 0} active allowed, ${res.blockedCount ?? 0} expired/inactive declined.`,
      });
      playAccessTone('granted');
      await refreshAll(backendUrl);
    }
    setBusyAction(null);
  };

  const copyWssEndpoint = () => {
    if (!wssEndpoint || typeof navigator === 'undefined') return;
    navigator.clipboard.writeText(wssEndpoint).catch(() => {});
    setCopiedWss(true);
    setTimeout(() => setCopiedWss(false), 1800);
  };

  const isWsConnected = device.wsConnectionStatus === 'connected';

  return (
    <div className="space-y-5">
      {/* Cloud Run WebSocket Backend Connection Bar */}
      <div className="bg-white rounded-2xl p-5 border border-[#DCE3E8] shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#E9ECEF]">
          <div>
            <h3 className="text-sm font-black text-[#252A30] flex items-center gap-2">
              <Cloud className="w-4 h-4 text-[#E5B82A]" />
              <span>Built-in Cloud Biometric Server Diagnostics</span>
            </h3>
            <p className="text-xs text-[#84909A] mt-0.5">
              Pre-configured inside the app for Secureye terminal (<code>SN: {BIOMETRIC_CONFIG.defaultTerminal.serialNumber}</code>) &rarr; <code>{BIOMETRIC_CONFIG.serverUrl}</code>.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase border inline-flex items-center gap-1 ${
                adminWsState === 'connected'
                  ? 'bg-[#36A875]/15 text-[#36A875] border-[#36A875]/30'
                  : 'bg-[#84909A]/10 text-[#84909A] border-[#DCE3E8]'
              }`}
            >
              <Radio className={`w-3 h-3 ${adminWsState === 'connected' ? 'animate-pulse' : ''}`} />
              <span>{adminWsState === 'connected' ? 'Stream Live' : 'Stream Idle'}</span>
            </span>
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase border ${
                serverOnline
                  ? 'bg-[#36A875]/15 text-[#36A875] border-[#36A875]/30'
                  : 'bg-[#DC5555]/10 text-[#DC5555] border-[#DC5555]/30'
              }`}
            >
              {serverOnline === null
                ? 'Checking...'
                : serverOnline
                ? `Cloud Server Online${firestoreConnected ? ' • Firestore OK' : ''}`
                : 'Cloud Server Unreachable'}
            </span>
            <button
              type="button"
              onClick={() => setShowServerOverride((v) => !v)}
              className="py-1 px-2.5 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] text-[#5A646E] hover:text-[#252A30] font-bold text-[11px] inline-flex items-center gap-1"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>{showServerOverride ? 'Hide Override' : 'Override URL'}</span>
            </button>
          </div>
        </div>

        {/* Optional Temporary Developer Override (Collapsed by default) */}
        {showServerOverride && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
            <div className="md:col-span-6">
              <label className="block font-bold text-[#252A30] mb-1">
                Temporary Backend URL Override
              </label>
              <input
                type="url"
                placeholder="https://dream-gym-1.onrender.com"
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] font-mono font-bold text-[#252A30] focus:outline-none focus:border-[#FFD447]"
              />
            </div>
            <div className="md:col-span-3">
              <label className="block font-bold text-[#252A30] mb-1">
                API Secret (Set via VITE_BIOMETRIC_API_SECRET)
              </label>
              <input
                type="password"
                placeholder="Configured at build time"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] font-mono text-[#252A30] focus:outline-none focus:border-[#FFD447]"
              />
            </div>
            <div className="md:col-span-3 flex items-end">
              <button
                type="button"
                onClick={handleRefreshStatus}
                disabled={busyAction !== null}
                className="w-full py-2 px-3 rounded-xl bg-[#252A30] text-[#FFD447] font-black text-xs flex items-center justify-center gap-1.5 hover:bg-[#313740] disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'refresh' ? 'animate-spin' : ''}`} />
                <span>Apply &amp; Refresh</span>
              </button>
            </div>
          </div>
        )}

        {/* Generated Secureye Web Server URL Card */}
        {wssEndpoint && (
          <div className="p-3.5 rounded-xl bg-[#252A30] text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wider text-[#FFD447]">
                Enter into Secureye &rarr; Communication &rarr; Web Server URL (Keep P2P 54.187.2.68:4000 unchanged)
              </p>
              <p className="font-mono text-sm font-black truncate mt-0.5">{wssEndpoint}</p>
            </div>
            <button
              type="button"
              onClick={copyWssEndpoint}
              className="px-3 py-1.5 rounded-lg bg-[#FFD447] text-[#252A30] font-black text-xs inline-flex items-center gap-1.5 shrink-0 self-start sm:self-auto"
            >
              {copiedWss ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedWss ? 'Copied WSS URL' : 'Copy WSS URL'}</span>
            </button>
          </div>
        )}

        {/* Action Feedback Banner */}
        {feedback && (
          <div
            className={`p-3 rounded-xl text-xs font-semibold border flex items-start gap-2 ${
              feedback.type === 'success'
                ? 'bg-[#36A875]/10 border-[#36A875]/30 text-[#237A54]'
                : feedback.type === 'warning'
                ? 'bg-[#FFF8E7] border-[#FFD447]/60 text-[#8A6112]'
                : 'bg-[#DC5555]/10 border-[#DC5555]/30 text-[#DC5555]'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : feedback.type === 'warning' ? (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* 6 Required Functional Control Buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={busyAction !== null}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#FFD447] to-[#F5C62F] text-[#252A30] font-black text-xs inline-flex items-center gap-1.5 hover:shadow-xs disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>{busyAction === 'test' ? 'Testing...' : 'Test Connection'}</span>
          </button>

          <button
            type="button"
            onClick={handleRefreshStatus}
            disabled={busyAction !== null}
            className="px-3.5 py-2 rounded-xl bg-[#252A30] text-white font-bold text-xs inline-flex items-center gap-1.5 hover:bg-[#313740] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'refresh' ? 'animate-spin' : ''}`} />
            <span>Refresh Status</span>
          </button>

          <button
            type="button"
            onClick={handleViewDiagnostics}
            className={`px-3.5 py-2 rounded-xl border font-bold text-xs inline-flex items-center gap-1.5 transition-all ${
              activeLogView === 'diagnostics'
                ? 'bg-[#FFF8E7] border-[#FFD447] text-[#252A30]'
                : 'bg-white border-[#DCE3E8] text-[#252A30] hover:border-[#FFD447]'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>View Raw Diagnostic Logs ({diagnostics.length})</span>
          </button>

          <button
            type="button"
            onClick={handleViewAttendance}
            className={`px-3.5 py-2 rounded-xl border font-bold text-xs inline-flex items-center gap-1.5 transition-all ${
              activeLogView === 'attendance'
                ? 'bg-[#FFF8E7] border-[#FFD447] text-[#252A30]'
                : 'bg-white border-[#DCE3E8] text-[#252A30] hover:border-[#FFD447]'
            }`}
          >
            <Fingerprint className="w-3.5 h-3.5" />
            <span>View Attendance Logs ({attendanceLogs.length})</span>
          </button>

          <button
            type="button"
            onClick={handleSyncAttendance}
            disabled={busyAction !== null || !isWsConnected}
            className="px-3.5 py-2 rounded-xl bg-[#36A875] text-white font-black text-xs inline-flex items-center gap-1.5 hover:bg-[#2E9466] disabled:opacity-40"
            title={isWsConnected ? 'Request stored attendance logs over WebSocket' : 'Requires an active Secureye WebSocket connection'}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>{busyAction === 'sync' ? 'Syncing...' : 'Synchronize Attendance'}</span>
          </button>

          <button
            type="button"
            onClick={handleEnforceSubscriptions}
            disabled={busyAction !== null}
            className="px-3.5 py-2 rounded-xl bg-[#252A30] text-[#FFD447] font-black text-xs inline-flex items-center gap-1.5 hover:bg-[#313740] disabled:opacity-50"
            title="Sync all active & expired member dates to the WebSocket server and push block/enable rules to the Secureye machine"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{busyAction === 'enforce' ? 'Enforcing...' : 'Enforce Expiry Rules'}</span>
          </button>

          <button
            type="button"
            onClick={handleDisconnectDevice}
            disabled={busyAction !== null || !isWsConnected}
            className="px-3.5 py-2 rounded-xl bg-white border border-[#DC5555]/40 text-[#DC5555] font-black text-xs inline-flex items-center gap-1.5 hover:bg-[#FFF0F0] disabled:opacity-40"
          >
            <PowerOff className="w-3.5 h-3.5" />
            <span>Disconnect Device</span>
          </button>
        </div>
      </div>

      {/* 9 Required Biometric Device Telemetry & Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-[#DCE3E8] shadow-xs">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#84909A]">
            WebSocket Connection Status
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black uppercase ${
                isWsConnected
                  ? 'bg-[#36A875]/15 text-[#36A875]'
                  : 'bg-[#DC5555]/10 text-[#DC5555]'
              }`}
            >
              {isWsConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {isWsConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <p className="text-[11px] text-[#84909A] mt-2 font-mono">
            Mode: {device.serverClientMode} &bull; P2P: {device.p2pLinkStatus || 'Registered'}
          </p>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-[#DCE3E8] shadow-xs">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#84909A]">
            Device Registration Status
          </p>
          <p className="mt-2 text-sm font-black text-[#252A30] uppercase">
            {device.registrationStatus.replace(/_/g, ' ')}
          </p>
          <p className="text-[11px] text-[#84909A] mt-1 font-mono">
            Protocol: {device.protocolStatus.replace(/_/g, ' ')}
          </p>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-[#DCE3E8] shadow-xs">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#84909A]">
            Device Cloud ID &amp; Serial Number
          </p>
          <p className="mt-1.5 font-mono text-sm font-black text-[#252A30]">
            SN: {device.serialNumber}
          </p>
          <p className="font-mono text-xs font-bold text-[#5A646E]">
            Cloud ID: {device.cloudId}
          </p>
          <p className="font-mono text-[10px] text-[#84909A] mt-0.5">
            Unique ID: {device.deviceUniqueId || '—'}
          </p>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-[#DCE3E8] shadow-xs">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#84909A]">
            Total Attendance Events &amp; Heartbeat
          </p>
          <p className="mt-1 text-2xl font-black text-[#252A30]">
            {device.totalAttendanceEvents}
          </p>
          <p className="text-[11px] text-[#84909A] font-mono mt-0.5">
            Last Heartbeat: {fmtTime(device.lastHeartbeatAt)}
          </p>
        </div>
      </div>

      {/* Last Received Message + Last Attendance Event + Connection Errors */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-[#DCE3E8] shadow-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-wider text-[#84909A]">
              Last Received Message
            </p>
            {device.lastReceivedMessageType && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-[#252A30] text-[#FFD447]">
                {device.lastReceivedMessageType}
              </span>
            )}
          </div>
          <p className="font-mono text-[11px] text-[#252A30] break-all bg-[#F5F6F2] p-2.5 rounded-xl border border-[#E9ECEF] min-h-[56px]">
            {device.lastReceivedMessage || 'No WebSocket message received from physical device yet.'}
          </p>
          <p className="text-[10px] font-mono text-[#84909A]">
            Received At: {fmtTime(device.lastReceivedMessageAt)}
          </p>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-[#DCE3E8] shadow-xs space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-wider text-[#84909A]">
            Last Attendance Event
          </p>
          {device.lastAttendanceEvent ? (
            <div className="p-2.5 rounded-xl bg-[#F5F6F2] border border-[#E9ECEF] text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-black text-[#252A30]">
                  {device.lastAttendanceEvent.memberName}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                    device.lastAttendanceEvent.status === 'granted'
                      ? 'bg-[#36A875]/15 text-[#36A875]'
                      : 'bg-[#DC5555]/15 text-[#DC5555]'
                  }`}
                >
                  {device.lastAttendanceEvent.status}
                </span>
              </div>
              <p className="font-mono text-[11px] text-[#5A646E]">
                Bio ID: {device.lastAttendanceEvent.biometricUserId} &bull;{' '}
                {device.lastAttendanceEvent.verificationMethod}
              </p>
              <p className="text-[10px] text-[#84909A]">
                {fmtTime(device.lastAttendanceEvent.timestamp)} — {device.lastAttendanceEvent.reason}
              </p>
            </div>
          ) : (
            <p className="font-mono text-[11px] text-[#84909A] bg-[#F5F6F2] p-2.5 rounded-xl border border-[#E9ECEF] min-h-[56px]">
              Waiting for first real fingerprint scan from Secureye machine.
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl p-4 border border-[#DCE3E8] shadow-xs space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-wider text-[#84909A]">
            Connection Errors ({device.connectionErrors?.length || 0})
          </p>
          {device.connectionErrors && device.connectionErrors.length > 0 ? (
            <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
              {device.connectionErrors.map((err, idx) => (
                <div
                  key={`${err.timestamp}-${idx}`}
                  className="p-2 rounded-lg bg-[#DC5555]/10 border border-[#DC5555]/25 text-[11px] text-[#DC5555]"
                >
                  <p className="font-semibold">{err.message}</p>
                  <p className="font-mono text-[9px] opacity-80">{fmtTime(err.timestamp)}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-2.5 rounded-xl bg-[#36A875]/5 border border-[#36A875]/20 text-xs text-[#237A54] flex items-center gap-2 min-h-[56px]">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>No WebSocket connection errors recorded.</span>
            </div>
          )}
        </div>
      </div>

      {/* Diagnostic Logs OR Attendance Logs Table */}
      <div
        ref={logsSectionRef}
        className="bg-white rounded-2xl p-5 border border-[#DCE3E8] shadow-xs space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#E9ECEF]">
          <h4 className="text-xs font-black text-[#252A30] uppercase tracking-wider flex items-center gap-1.5">
            {activeLogView === 'diagnostics' ? (
              <>
                <FileCode2 className="w-4 h-4 text-[#E5B82A]" />
                <span>Raw Diagnostic Logs — Text, JSON &amp; Binary Frames ({diagnostics.length})</span>
              </>
            ) : (
              <>
                <Fingerprint className="w-4 h-4 text-[#E5B82A]" />
                <span>Processed Biometric Attendance Logs ({attendanceLogs.length})</span>
              </>
            )}
          </h4>
          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveLogView('diagnostics')}
              className={`px-3 py-1 rounded-lg font-bold ${
                activeLogView === 'diagnostics'
                  ? 'bg-[#252A30] text-[#FFD447]'
                  : 'bg-[#F5F6F2] text-[#252A30]'
              }`}
            >
              Raw Diagnostics
            </button>
            <button
              type="button"
              onClick={() => setActiveLogView('attendance')}
              className={`px-3 py-1 rounded-lg font-bold ${
                activeLogView === 'attendance'
                  ? 'bg-[#252A30] text-[#FFD447]'
                  : 'bg-[#F5F6F2] text-[#252A30]'
              }`}
            >
              Attendance Logs
            </button>
          </div>
        </div>

        {activeLogView === 'diagnostics' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#F5F6F2] border-b border-[#DCE3E8] text-[10px] font-bold text-[#84909A] uppercase">
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Event / Type</th>
                  <th className="py-2 px-3">Device / IP</th>
                  <th className="py-2 px-3">Raw Payload / Hex / Headers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E9ECEF]">
                {diagnostics.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-[#84909A]">
                      No raw diagnostic frames captured yet. Once your Secureye machine connects to <code>wss://.../biometric</code>, every handshake, JSON, text, and binary packet will appear here.
                    </td>
                  </tr>
                ) : (
                  diagnostics.map((d) => (
                    <tr key={d.id} className="hover:bg-[#F5F6F2]/50">
                      <td className="py-2 px-3 font-mono text-[10px] whitespace-nowrap">
                        {fmtTime(d.timestamp)}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-[#252A30] text-[#FFD447] mr-1">
                          {d.messageType}
                        </span>
                        <span className="font-mono text-[10px] text-[#5A646E]">{d.event}</span>
                        {d.needsOfficialDocs && (
                          <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-black bg-[#E5A024]/20 text-[#8A6112]">
                            UNRECOGNIZED PROTOCOL
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 font-mono text-[10px] whitespace-nowrap">
                        {d.deviceId || 'pending'} ({d.remoteIp || '—'})
                      </td>
                      <td className="py-2 px-3 font-mono text-[10px] text-[#252A30] break-all">
                        <div>{d.rawText || d.rawPreview}</div>
                        {d.hexPreview && (
                          <div className="text-[#84909A] mt-0.5">HEX: {d.hexPreview}</div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#F5F6F2] border-b border-[#DCE3E8] text-[10px] font-bold text-[#84909A] uppercase">
                  <th className="py-2 px-3">Timestamp</th>
                  <th className="py-2 px-3">Member</th>
                  <th className="py-2 px-3">Bio User ID</th>
                  <th className="py-2 px-3">Method</th>
                  <th className="py-2 px-3">Verdict</th>
                  <th className="py-2 px-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E9ECEF]">
                {attendanceLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-[#84909A]">
                      No real biometric attendance records stored yet.
                    </td>
                  </tr>
                ) : (
                  attendanceLogs.map((rec) => (
                    <tr key={rec.id} className="hover:bg-[#F5F6F2]/50">
                      <td className="py-2 px-3 font-mono font-bold text-[#252A30] whitespace-nowrap">
                        {rec.timestamp}
                      </td>
                      <td className="py-2 px-3 font-bold text-[#252A30]">{rec.memberName}</td>
                      <td className="py-2 px-3 font-mono font-bold">{rec.biometricUserId || '—'}</td>
                      <td className="py-2 px-3">{rec.verifyMode || 'Fingerprint'}</td>
                      <td className="py-2 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            rec.status === 'granted'
                              ? 'bg-[#36A875]/15 text-[#36A875]'
                              : 'bg-[#DC5555]/15 text-[#DC5555]'
                          }`}
                        >
                          {rec.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-[#5A646E]">{rec.reason || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
