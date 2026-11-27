import React, { useState } from 'react';
import { useGym } from '../../context/GymContext';
import { 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  Cpu, 
  CheckCircle2, 
  AlertCircle, 
  Fingerprint,
  Radio,
  ExternalLink
} from 'lucide-react';
import { MachineStatusModal } from '../admin/MachineStatusModal';
import { BIOMETRIC_CONFIG } from '../../config/biometricConfig';

interface BiometricMachineStatusCardProps {
  compact?: boolean;
  showDetailsButton?: boolean;
}

export const BiometricMachineStatusCard: React.FC<BiometricMachineStatusCardProps> = ({
  compact = false,
  showDetailsButton = true
}) => {
  const { 
    secureyeDevice, 
    checkBiometricConnection, 
    biometricBackendUrl,
    biometricWsStreamStatus 
  } = useGym();

  const [checking, setChecking] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [lastCheckedText, setLastCheckedText] = useState<string | null>(null);

  const isConnected = secureyeDevice?.wsConnectionStatus === 'connected';
  const deviceSn = secureyeDevice?.deviceSn || secureyeDevice?.serialNumber || BIOMETRIC_CONFIG.defaultTerminal.serialNumber;
  const lastHeartbeat = secureyeDevice?.lastHeartbeatAt || secureyeDevice?.lastSeenAt;

  const handleRefresh = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setChecking(true);
    try {
      await checkBiometricConnection();
      setLastCheckedText(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } finally {
      setTimeout(() => setChecking(false), 500);
    }
  };

  if (compact) {
    return (
      <>
        <div 
          onClick={() => setShowModal(true)}
          className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs cursor-pointer transition-all shadow-xs ${
            isConnected
              ? 'bg-[#36A875]/10 border-[#36A875]/30 text-[#237A54] hover:bg-[#36A875]/20'
              : 'bg-[#DC5555]/10 border-[#DC5555]/30 text-[#DC5555] hover:bg-[#DC5555]/20'
          }`}
          title="Click to view machine connection status"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              {isConnected ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#36A875] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#36A875]"></span>
                </>
              ) : (
                <span className="inline-flex rounded-full h-2.5 w-2.5 bg-[#DC5555]"></span>
              )}
            </span>
            <div className="min-w-0">
              <span className="font-extrabold text-[11px] block truncate">
                {isConnected ? 'Machine Online' : 'Machine Offline'}
              </span>
              <span className="text-[9px] text-[#84909A] font-mono block truncate">
                SN: {deviceSn}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={checking}
            className="p-1.5 rounded-lg bg-white/70 hover:bg-white text-[#252A30] shrink-0 border border-black/5 transition-all disabled:opacity-50"
            title="Refresh connection status"
          >
            <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <MachineStatusModal isOpen={showModal} onClose={() => setShowModal(false)} />
      </>
    );
  }

  return (
    <>
      <div 
        className={`w-full rounded-2xl border p-4 transition-all shadow-xs relative overflow-hidden ${
          isConnected
            ? 'bg-gradient-to-r from-[#EBF7EE] to-[#F5FBF6] border-[#36A875]/40 text-[#237A54]'
            : 'bg-gradient-to-r from-[#FFF5F5] to-[#FEF8F8] border-[#DC5555]/35 text-[#9E2A2B]'
        }`}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          {/* Left Info */}
          <div className="flex items-center gap-3.5 min-w-0">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${
              isConnected ? 'bg-[#36A875] text-white' : 'bg-[#DC5555] text-white'
            }`}>
              {isConnected ? (
                <Wifi className="w-5 h-5 animate-pulse" />
              ) : (
                <WifiOff className="w-5 h-5" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                  isConnected 
                    ? 'bg-[#36A875]/20 text-[#237A54] border border-[#36A875]/30' 
                    : 'bg-[#DC5555]/20 text-[#DC5555] border border-[#DC5555]/30'
                }`}>
                  {isConnected ? '● Connected' : '○ Offline'}
                </span>
                <span className="text-[11px] font-extrabold text-[#252A30] truncate">
                  Secureye S-FB6K
                </span>
              </div>

              <h2 className="text-sm font-black text-[#252A30] mt-0.5 tracking-tight truncate">
                {isConnected 
                  ? 'Biometric Machine is Connected & Ready'
                  : 'Biometric Machine is Offline (Not Connected)'}
              </h2>

              <p className="text-[11px] text-[#6B7280] font-medium mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span>Serial No: <strong className="font-mono text-[#252A30]">{deviceSn}</strong></span>
                <span>•</span>
                <span>Target: <strong className="font-mono text-[#252A30]">wss://dream-gym-1.onrender.com/biometric</strong></span>
                {lastHeartbeat && (
                  <>
                    <span>•</span>
                    <span>Last punch/seen: {new Date(lastHeartbeat).toLocaleTimeString()}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={checking}
              className="px-3 py-2 rounded-xl bg-white hover:bg-[#F9FAFB] text-[#252A30] text-xs font-bold border border-[#DCE3E8] shadow-xs flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin text-[#E5A024]' : ''}`} />
              <span>{checking ? 'Checking...' : 'Check Status'}</span>
            </button>

            {showDetailsButton && (
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="px-3 py-2 rounded-xl bg-[#252A30] hover:bg-[#343A40] text-[#FFD447] text-xs font-black shadow-xs flex items-center gap-1.5 transition-all active:scale-95"
              >
                <Cpu className="w-3.5 h-3.5 text-[#FFD447]" />
                <span>Diagnostics</span>
              </button>
            )}
          </div>
        </div>

        {/* Informative helper note when offline */}
        {!isConnected && (
          <div className="mt-3 pt-2.5 border-t border-[#DC5555]/20 flex items-start gap-2 text-[11px] text-[#9E2A2B]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#DC5555]" />
            <span>
              <strong>Troubleshooting:</strong> Ensure the Secureye machine is powered on and connected to the Internet. In <strong>Menu ➔ Comm. ➔ Web Server</strong>, confirm Server Address is set to <strong>dream-gym-1.onrender.com</strong> and press <strong>OK</strong>.
            </span>
          </div>
        )}
      </div>

      <MachineStatusModal isOpen={showModal} onClose={() => setShowModal(false)} />
    </>
  );
};
