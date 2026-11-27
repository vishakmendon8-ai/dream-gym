import React, { useState } from 'react';
import { useGym } from '../../context/GymContext';
import { 
  X, 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  Cpu, 
  CheckCircle2, 
  AlertTriangle, 
  Radio,
  Copy,
  Check
} from 'lucide-react';
import { BIOMETRIC_CONFIG } from '../../config/biometricConfig';
import { testBiometricConnection, buildBiometricWssUrl } from '../../services/biometricCloudClient';

interface MachineStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MachineStatusModal: React.FC<MachineStatusModalProps> = ({ isOpen, onClose }) => {
  const { 
    secureyeDevice, 
    biometricBackendUrl, 
    biometricWsStreamStatus,
    checkBiometricConnection,
  } = useGym();

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message?: string;
    serverReachable?: boolean;
    deviceConnected?: boolean;
    firestoreConnected?: boolean;
    error?: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const isConnected = secureyeDevice?.wsConnectionStatus === 'connected';
  const deviceSn = secureyeDevice?.deviceSn || secureyeDevice?.serialNumber || BIOMETRIC_CONFIG.defaultTerminal.serialNumber;
  const lastHeartbeat = secureyeDevice?.lastHeartbeatAt || secureyeDevice?.lastSeenAt;
  const wssUrl = buildBiometricWssUrl(biometricBackendUrl) || BIOMETRIC_CONFIG.wsUrl;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleRunDiagnostics = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testBiometricConnection(biometricBackendUrl, BIOMETRIC_CONFIG.apiToken);
      setTestResult(res);
      await checkBiometricConnection();
    } catch (err: any) {
      setTestResult({
        ok: false,
        error: err?.message || 'Connection test failed to reach server.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-xs animate-fade-in select-none"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-3xl max-w-[400px] w-full border border-[#DCE3E8] shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-[#E9ECEF] flex items-center justify-between bg-[#252A30] text-white shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
              isConnected ? 'bg-[#36A875]/25 text-[#36A875]' : 'bg-[#DC5555]/25 text-[#DC5555]'
            }`}>
              {isConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-black tracking-tight truncate">
                Biometric Status
              </h2>
              <p className="text-[10px] text-[#84909A] truncate">
                WebSocket Hardware &amp; Sync Diagnostics
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all shrink-0 ml-2"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-3.5 overflow-y-auto overflow-x-hidden space-y-3">
          
          {/* Main Status Hero Banner (Compact) */}
          <div className={`p-3 rounded-2xl border flex items-center justify-between gap-2.5 ${
            isConnected 
              ? 'bg-[#36A875]/10 border-[#36A875]/35 text-[#237A54]' 
              : 'bg-[#DC5555]/10 border-[#DC5555]/30 text-[#DC5555]'
          }`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-xs ${
                isConnected ? 'bg-[#36A875] text-white' : 'bg-[#DC5555] text-white'
              }`}>
                <Cpu className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-black uppercase tracking-wide truncate">
                  {isConnected ? 'Terminal Online' : 'Terminal Disconnected'}
                </div>
                <p className="text-[10px] text-[#6B7280] truncate mt-0.5">
                  {isConnected 
                    ? 'Connected via WebSocket (Live Scans)' 
                    : 'WebSocket not connected to server'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleRunDiagnostics}
              disabled={testing}
              className="px-2.5 py-1.5 rounded-xl bg-[#252A30] text-[#FFD447] text-[10px] font-black shrink-0 hover:bg-[#343A40] transition-all flex items-center gap-1 shadow-xs disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${testing ? 'animate-spin' : ''}`} />
              <span>{testing ? 'Testing...' : 'Test Now'}</span>
            </button>
          </div>

          {/* Multiple Available Machine WebSocket Endpoints */}
          <div className="p-3.5 bg-[#252A30] text-white rounded-2xl border border-white/10 space-y-2.5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-[#FFD447] flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-[#FFD447] animate-pulse" /> Available WebSocket URLs
              </span>
              <span className="text-[9px] font-bold text-[#84909A]">
                Click copy for your machine
              </span>
            </div>

            <div className="space-y-1.5">
              {/* Option 1: Cloud Global Render URL (Recommended) */}
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-black/40 border border-[#38BDF8]/40">
                <div className="min-w-0">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-[#38BDF8] block">
                    1. Cloud Live Target (Recommended)
                  </span>
                  <span className="font-mono text-[11px] font-black text-white truncate block">
                    wss://dream-gym-1.onrender.com/biometric
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy('wss://dream-gym-1.onrender.com/biometric', 'url_cloud')}
                  className="px-2.5 py-1 rounded-lg bg-[#38BDF8] text-[#252A30] text-[10px] font-black flex items-center gap-1 hover:bg-[#7dd3fc] shrink-0"
                >
                  {copiedKey === 'url_cloud' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'url_cloud' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              {/* Option 2: Plain WS (for devices without TLS) */}
              <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-black/40 border border-white/10">
                <div className="min-w-0">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-[#FFD447] block">
                    2. Plain WS URL (Port 80)
                  </span>
                  <span className="font-mono text-[11px] font-black text-white truncate block">
                    ws://dream-gym-1.onrender.com/biometric
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy('ws://dream-gym-1.onrender.com/biometric', 'url_ws')}
                  className="px-2.5 py-1 rounded-lg bg-[#FFD447] text-[#252A30] text-[10px] font-black flex items-center gap-1 hover:bg-[#ffe072] shrink-0"
                >
                  {copiedKey === 'url_ws' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'url_ws' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Device & Connection Details Grid (2x2) */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {/* Device SN */}
            <div className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl min-w-0">
              <span className="text-[9px] font-bold text-[#84909A] uppercase tracking-wider block truncate">Serial No.</span>
              <div className="flex items-center justify-between gap-1 mt-0.5">
                <span className="text-[11px] font-black text-[#252A30] font-mono truncate">{deviceSn}</span>
                <button
                  type="button"
                  onClick={() => handleCopy(deviceSn, 'sn')}
                  className="p-1 rounded hover:bg-white text-[#84909A] shrink-0"
                  title="Copy SN"
                >
                  {copiedKey === 'sn' ? <Check className="w-3 h-3 text-[#36A875]" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>

            {/* Protocol / Mode */}
            <div className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl min-w-0">
              <span className="text-[9px] font-bold text-[#84909A] uppercase tracking-wider block truncate">Protocol Mode</span>
              <div className="flex items-center justify-between gap-1 mt-0.5">
                <span className="text-[11px] font-black text-[#252A30] truncate">WebSocket</span>
                <span className={`px-1.5 py-0.5 rounded text-[8px] font-black shrink-0 ${
                  isConnected ? 'bg-[#36A875]/15 text-[#237A54]' : 'bg-[#E5A024]/15 text-[#8A6112]'
                }`}>
                  {isConnected ? 'ONLINE' : 'WAITING'}
                </span>
              </div>
            </div>

            {/* Last Heartbeat */}
            <div className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl min-w-0">
              <span className="text-[9px] font-bold text-[#84909A] uppercase tracking-wider block truncate">Last Comm.</span>
              <span className="text-[11px] font-bold text-[#252A30] truncate block mt-0.5">
                {lastHeartbeat ? new Date(lastHeartbeat).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Waiting...'}
              </span>
            </div>

            {/* Browser WebSocket Stream */}
            <div className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl min-w-0">
              <span className="text-[9px] font-bold text-[#84909A] uppercase tracking-wider block truncate">Live Stream</span>
              <div className="flex items-center justify-between gap-1 mt-0.5">
                <span className="text-[11px] font-bold text-[#252A30] truncate">
                  {biometricWsStreamStatus === 'connected' ? 'Connected' : 'Connecting...'}
                </span>
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  biometricWsStreamStatus === 'connected' ? 'bg-[#36A875]' : 'bg-[#E5A024] animate-pulse'
                }`} />
              </div>
            </div>
          </div>

          {/* Diagnostics Test Output (If run) */}
          {testResult && (
            <div className={`p-2.5 rounded-xl border text-xs ${
              testResult.ok ? 'bg-[#EBF7EE] border-[#36A875]/40 text-[#237A54]' : 'bg-[#FDEEEE] border-[#DC5555]/30 text-[#DC5555]'
            }`}>
              <div className="flex items-center gap-1.5 font-black text-[11px] mb-1">
                {testResult.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-[#36A875]" /> : <AlertTriangle className="w-3.5 h-3.5 text-[#DC5555]" />}
                <span>{testResult.ok ? 'Diagnostics Passed' : 'Diagnostics Warning'}</span>
              </div>
              <p className="text-[10px] font-medium leading-tight mb-2 opacity-90 break-words">
                {testResult.message || testResult.error}
              </p>
              <div className="grid grid-cols-3 gap-1 pt-2 border-t border-black/10 text-[9px]">
                <div className="p-1 rounded bg-white/80 text-center font-bold text-[#252A30] truncate">
                  Server: {testResult.serverReachable ? '✅ Yes' : '❌ No'}
                </div>
                <div className="p-1 rounded bg-white/80 text-center font-bold text-[#252A30] truncate">
                  Device: {testResult.deviceConnected ? '✅ Yes' : '⚠️ Wait'}
                </div>
                <div className="p-1 rounded bg-white/80 text-center font-bold text-[#252A30] truncate">
                  Firestore: {testResult.firestoreConnected ? '✅ Yes' : '⚠️ Off'}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-[#E9ECEF] bg-[#F8FAFC] flex items-center justify-between shrink-0">
          <span className="text-[10px] text-[#84909A] font-medium">
            Auto-refreshes every 4s
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#252A30] text-white text-[11px] font-black hover:bg-[#343A40] transition-colors shadow-xs active:scale-95"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
