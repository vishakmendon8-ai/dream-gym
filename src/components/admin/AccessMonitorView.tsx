import React, { useState, useEffect } from 'react';
import { useGym } from '../../context/GymContext';
import {
  Volume2,
  VolumeX,
  CheckCircle2,
  XCircle,
  Fingerprint,
} from 'lucide-react';

export const AccessMonitorView: React.FC = () => {
  const {
    members,
    accessLogs,
    soundEnabled,
    setSoundEnabled,
    secureyeDevice,
    biometricWsStreamStatus,
    liveScanBanner,
    setCurrentTab,
  } = useGym();

  const [currentVerdict, setCurrentVerdict] = useState<{
    status: 'granted' | 'denied' | 'unknown' | 'idle';
    member?: any;
    message: string;
    timestamp: string;
  }>({
    status: 'idle',
    message: 'Waiting for a member to scan at the entrance biometric terminal.',
    timestamp: '--:--:--',
  });

  // Automatically update live entrance display whenever a real biometric scan arrives
  useEffect(() => {
    if (!liveScanBanner) return;
    const matched = members.find((m) => m.id === liveScanBanner.memberId);
    setCurrentVerdict({
      status: liveScanBanner.status,
      member: matched || {
        id: liveScanBanner.memberId,
        name: liveScanBanner.memberName,
        planName: liveScanBanner.planName || 'Biometric User',
      },
      message: liveScanBanner.reason,
      timestamp: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    });
  }, [liveScanBanner, members]);

  const isSecureyeOnline = secureyeDevice?.wsConnectionStatus === 'connected';
  const isWsServerLive = biometricWsStreamStatus === 'connected';

  return (
    <div className="space-y-5">
      {/* Top Status Strip */}
      <div className="bg-white/80 backdrop-blur-md rounded-2xl p-4 sm:p-5 border border-[#DCE3E8] shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isSecureyeOnline ? 'bg-[#36A875] animate-ping' : 'bg-[#FFD447]'
              }`}
            />
            <h1 className="text-lg sm:text-xl font-black text-[#252A30] tracking-tight">
              Live Entrance Monitor
            </h1>
          </div>
          <p className="text-xs text-[#84909A]">
            Displays real-time check-in verdicts and entrance logs as members scan at the door.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setCurrentTab('biometric')}
            className={`px-3 py-1.5 rounded-xl border text-xs font-black flex items-center gap-2 transition-all ${
              isSecureyeOnline
                ? 'bg-[#36A875]/10 border-[#36A875]/30 text-[#36A875]'
                : isWsServerLive
                ? 'bg-[#FFF8E7] border-[#FFD447]/70 text-[#8A6112]'
                : 'bg-white border-[#DCE3E8] text-[#84909A] hover:border-[#FFD447]'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isSecureyeOnline
                  ? 'bg-[#36A875] animate-ping'
                  : isWsServerLive
                  ? 'bg-[#E5A024]'
                  : 'bg-[#DC5555]'
              }`}
            />
            <span>
              {isSecureyeOnline
                ? 'Scanner Connected'
                : isWsServerLive
                ? 'Cloud Sync Ready'
                : 'Connecting...'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
              soundEnabled
                ? 'bg-white border-[#DCE3E8] text-[#252A30] hover:border-[#FFD447]'
                : 'bg-[#F5F6F2] border-transparent text-[#84909A]'
            }`}
          >
            {soundEnabled ? (
              <Volume2 className="w-3.5 h-3.5 text-[#36A875]" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
            <span>{soundEnabled ? 'Chime ON' : 'Muted'}</span>
          </button>
        </div>
      </div>

      {/* Live Entrance Screen + Recent Access Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Live Entrance Verdict Display */}
        <div className="lg:col-span-7 bg-[#252A30] rounded-3xl p-5 sm:p-6 text-white shadow-xl border border-[#3E4550] space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-[#3E4550]">
            <div className="flex items-center gap-2">
              <Fingerprint className="w-5 h-5 text-[#FFD447]" />
              <span className="font-bold text-xs uppercase tracking-wider text-[#A0AEC0]">
                Main Entrance Biometric Gate
              </span>
            </div>
            <span className="font-mono text-xs text-[#FFD447] font-black">
              {currentVerdict.timestamp}
            </span>
          </div>

          <div
            className={`p-8 sm:p-10 rounded-2xl border text-center transition-all ${
              currentVerdict.status === 'granted'
                ? 'bg-[#36A875]/15 border-[#36A875] shadow-lg shadow-[#36A875]/20'
                : currentVerdict.status === 'denied' || currentVerdict.status === 'unknown'
                ? 'bg-[#DC5555]/15 border-[#DC5555] shadow-lg shadow-[#DC5555]/20'
                : 'bg-[#2D333B] border-[#3E4550]'
            }`}
          >
            {currentVerdict.status === 'granted' ? (
              <div className="space-y-4 animate-fade-in">
                <div className="w-20 h-20 rounded-full bg-[#36A875] text-white flex items-center justify-center mx-auto shadow-lg shadow-[#36A875]/40 animate-bounce">
                  <CheckCircle2 className="w-10 h-10 stroke-[2.5]" />
                </div>
                <div>
                  <span className="px-3 py-1 rounded-full bg-[#36A875] text-white font-black text-xs uppercase tracking-widest">
                    ACCESS GRANTED
                  </span>
                  <h2 className="text-2xl font-black text-white mt-3">
                    {currentVerdict.member?.name}
                  </h2>
                  <p className="text-sm text-[#FFD447] font-semibold mt-0.5">
                    {currentVerdict.member?.planName} • ID: {currentVerdict.member?.id}
                  </p>
                  <p className="text-xs text-[#A0AEC0] mt-2">
                    {currentVerdict.message}
                  </p>
                </div>
              </div>
            ) : currentVerdict.status === 'denied' || currentVerdict.status === 'unknown' ? (
              <div className="space-y-4 animate-fade-in">
                <div className="w-20 h-20 rounded-full bg-[#DC5555] text-white flex items-center justify-center mx-auto shadow-lg shadow-[#DC5555]/40">
                  <XCircle className="w-10 h-10 stroke-[2.5]" />
                </div>
                <div>
                  <span className="px-3 py-1 rounded-full bg-[#DC5555] text-white font-black text-xs uppercase tracking-widest">
                    ACCESS DENIED
                  </span>
                  <h2 className="text-2xl font-black text-white mt-3">
                    {currentVerdict.member ? currentVerdict.member.name : 'Unrecognized Member'}
                  </h2>
                  <p className="text-sm text-[#DC5555] font-bold mt-0.5">
                    {currentVerdict.message}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 py-8">
                <div className="w-20 h-20 rounded-full bg-[#353C46] text-[#FFD447] flex items-center justify-center mx-auto border-2 border-dashed border-[#FFD447]/40 animate-pulse">
                  <Fingerprint className="w-10 h-10" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Entrance Gate Ready</h3>
                  <p className="text-xs text-[#84909A] max-w-sm mx-auto mt-1">
                    {currentVerdict.message}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Recent Live Access Logs */}
        <div className="lg:col-span-5 bg-white rounded-2xl p-5 border border-[#DCE3E8] shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E9ECEF]">
            <h3 className="text-xs font-black text-[#252A30] uppercase tracking-wider">
              Recent Access Logs
            </h3>
            <span className="text-[10px] font-mono text-[#84909A]">{accessLogs.length} Records</span>
          </div>

          <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
            {accessLogs.length === 0 ? (
              <p className="text-xs text-[#84909A] text-center py-8">
                No check-ins recorded yet.
              </p>
            ) : (
              accessLogs.slice(0, 12).map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] text-xs gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img
                      src={log.avatar}
                      alt={log.memberName}
                      className="w-7 h-7 rounded-full object-cover border border-[#DCE3E8] shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="font-bold text-[#252A30] truncate leading-tight">
                        {log.memberName}
                      </p>
                      <p className="text-[10px] text-[#84909A] truncate">
                        {log.time} • {log.reason || 'Entrance check-in'}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full font-black text-[9px] uppercase shrink-0 ${
                      log.status === 'granted'
                        ? 'bg-[#36A875]/15 text-[#36A875]'
                        : 'bg-[#DC5555]/15 text-[#DC5555]'
                    }`}
                  >
                    {log.status === 'granted' ? 'Granted' : 'Denied'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
