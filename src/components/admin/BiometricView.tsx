import React, { useMemo, useState } from 'react';
import { useGym } from '../../context/GymContext';
import { AdmsBackendPanel } from './AdmsBackendPanel';
import { BiometricManagementPanel } from './BiometricManagementPanel';
import { BIOMETRIC_CONFIG } from '../../config/biometricConfig';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Cloud,
  CloudUpload,
  Fingerprint,
  Link2,
  Lock,
  Radio,
  Save,
  Search,
  Server,
  Settings2,
  Volume2,
  VolumeX,
  Wifi,
  XCircle,
} from 'lucide-react';

type BiometricSubTab = 'member_mapping' | 'live_scans' | 'cloud_biometric' | 'secureye_bridge';

export const BiometricView: React.FC = () => {
  const {
    members,
    attendance,
    biometricSyncLogs,
    linkMemberBiometricId,
    seedFirestoreData,
    isSyncing,
    soundEnabled,
    setSoundEnabled,
    playAccessTone,
    secureyeDevice,
    biometricWsStreamStatus,
  } = useGym();

  // Default to the client-facing Member Fingerprint IDs view; technical setup stays hidden unless toggled open
  const [activeSubTab, setActiveSubTab] = useState<BiometricSubTab>('member_mapping');
  const [showSystemSetup, setShowSystemSetup] = useState(false);

  // Member <-> Secureye User ID Mapping state
  const [mappingSearch, setMappingSearch] = useState('');
  const [bioDrafts, setBioDrafts] = useState<Record<string, string>>({});
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [mappingFeedback, setMappingFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const isDeviceOnline = secureyeDevice?.wsConnectionStatus === 'connected';
  const isCloudLive = biometricWsStreamStatus === 'connected';

  const linkedMembersCount = useMemo(
    () =>
      members.filter(
        (m) =>
          m.biometricRegistered &&
          m.biometricId &&
          m.biometricId !== 'NONE' &&
          m.biometricId !== 'BIO-FP-UNREGISTERED'
      ).length,
    [members]
  );

  const filteredMappingMembers = useMemo(() => {
    const q = mappingSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.biometricId || '').toLowerCase().includes(q) ||
        (m.phone || '').toLowerCase().includes(q)
    );
  }, [members, mappingSearch]);

  const biometricAttendance = useMemo(
    () => attendance.filter((a) => a.method === 'biometric' || a.source === 'secureye_websocket'),
    [attendance]
  );

  const handleSaveMapping = async (memberId: string, memberName: string) => {
    const existingMember = members.find((m) => m.id === memberId);
    const val = (bioDrafts[memberId] ?? existingMember?.biometricId ?? '').trim();
    setSavingMemberId(memberId);
    setMappingFeedback(null);
    const res = await linkMemberBiometricId(memberId, val);
    if (!res.ok) {
      setMappingFeedback({ type: 'error', text: res.error || 'Failed to save User ID.' });
      playAccessTone('denied');
    } else {
      setMappingFeedback({
        type: 'success',
        text: val
          ? `Linked ${memberName} to Scanner User ID "${val}".`
          : `Cleared Scanner User ID for ${memberName}.`,
      });
      playAccessTone('granted');
    }
    setSavingMemberId(null);
  };

  const handleToggleSystemSetup = () => {
    setShowSystemSetup((prev) => {
      const next = !prev;
      if (!next && (activeSubTab === 'cloud_biometric' || activeSubTab === 'secureye_bridge')) {
        setActiveSubTab('member_mapping');
      }
      return next;
    });
  };

  return (
    <div className="space-y-5">
      {/* Clean Client-Facing Biometric Status Strip (Zero Server Config Needed) */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#DCE3E8] shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#252A30] text-[#FFD447] flex items-center justify-center shrink-0">
            <Fingerprint className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm sm:text-base font-black text-[#252A30]">
                Biometric Attendance &amp; Fingerprint IDs
              </h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border inline-flex items-center gap-1 ${
                  isDeviceOnline
                    ? 'bg-[#36A875]/15 text-[#237A54] border-[#36A875]/30'
                    : isCloudLive
                    ? 'bg-[#FFF8E7] text-[#8A6112] border-[#FFD447]/70'
                    : 'bg-[#F5F6F2] text-[#5A646E] border-[#DCE3E8]'
                }`}
              >
                {isDeviceOnline ? (
                  <Wifi className="w-3 h-3 text-[#36A875]" />
                ) : (
                  <Radio className={`w-3 h-3 ${isCloudLive ? 'text-[#E5A024] animate-pulse' : ''}`} />
                )}
                <span>
                  {isDeviceOnline
                    ? 'Scanner Connected'
                    : isCloudLive
                    ? 'Cloud Sync Ready'
                    : 'Connecting...'}
                </span>
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F5F6F2] text-[#5A646E] border border-[#DCE3E8] font-mono">
                {BIOMETRIC_CONFIG.defaultTerminal.name} • SN: {BIOMETRIC_CONFIG.defaultTerminal.serialNumber}
              </span>
            </div>
            <p className="text-xs text-[#84909A] mt-1">
              Cloud connection is built into the app. Enroll members on the biometric machine and match their numeric User ID below.
            </p>
          </div>
        </div>

        {/* Simple Client Controls + Hidden Installer System Setup Toggle */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
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

          <button
            type="button"
            onClick={handleToggleSystemSetup}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all ${
              showSystemSetup
                ? 'bg-[#252A30] text-[#FFD447] border-[#252A30]'
                : 'bg-white text-[#84909A] border-[#DCE3E8] hover:text-[#252A30]'
            }`}
            title="Show or hide technical server diagnostics (installer / developer only)"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>{showSystemSetup ? 'Hide System Setup' : 'System Setup'}</span>
          </button>
        </div>
      </div>

      {/* Installer / Developer Bar (Completely hidden from gym clients by default) */}
      {showSystemSetup && (
        <div className="bg-[#F5F6F2] rounded-2xl p-3.5 border border-[#DCE3E8] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs min-w-0">
            <p className="font-black text-[#252A30] flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[#E5B82A]" />
              <span>Installer / Developer Mode</span>
            </p>
            <p className="text-[11px] text-[#5A646E] truncate mt-0.5">
              Built-in Server: <code className="font-bold text-[#252A30]">{BIOMETRIC_CONFIG.serverUrl}</code> • Hidden from gym clients by default.
            </p>
          </div>

          <button
            type="button"
            onClick={seedFirestoreData}
            disabled={isSyncing}
            className="px-3 py-1.5 rounded-xl bg-[#252A30] text-[#FFD447] font-black text-xs flex items-center gap-1.5 hover:bg-[#313740] disabled:opacity-50 self-start sm:self-auto shrink-0"
          >
            <CloudUpload className="w-3.5 h-3.5" />
            <span>{isSyncing ? 'Syncing...' : 'Sync All Members to Cloud'}</span>
          </button>
        </div>
      )}

      {/* Sub-Navigation Tabs (Clients only see Member Fingerprint IDs & Live Scan History) */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveSubTab('member_mapping')}
          className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all ${
            activeSubTab === 'member_mapping'
              ? 'bg-[#252A30] text-[#FFD447] shadow-xs'
              : 'bg-white text-[#252A30] border border-[#DCE3E8] hover:border-[#FFD447]'
          }`}
        >
          <Link2 className="w-3.5 h-3.5" />
          <span>
            Member Fingerprint IDs ({linkedMembersCount}/{members.length})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('live_scans')}
          className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all ${
            activeSubTab === 'live_scans'
              ? 'bg-[#252A30] text-[#FFD447] shadow-xs'
              : 'bg-white text-[#252A30] border border-[#DCE3E8] hover:border-[#FFD447]'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Live Scan History ({biometricAttendance.length})</span>
        </button>

        {showSystemSetup && (
          <>
            <button
              type="button"
              onClick={() => setActiveSubTab('cloud_biometric')}
              className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all ${
                activeSubTab === 'cloud_biometric'
                  ? 'bg-[#252A30] text-[#FFD447] shadow-xs'
                  : 'bg-white text-[#5A646E] border border-[#DCE3E8] hover:border-[#FFD447]'
              }`}
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>Cloud Diagnostics</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('secureye_bridge')}
              className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all ${
                activeSubTab === 'secureye_bridge'
                  ? 'bg-[#252A30] text-[#FFD447] shadow-xs'
                  : 'bg-white text-[#5A646E] border border-[#DCE3E8] hover:border-[#FFD447]'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>ADMS / Local Bridge</span>
            </button>
          </>
        )}
      </div>

      {/* ================================================================= */}
      {/* TAB 1 (DEFAULT): MEMBER <-> SCANNER USER ID MAPPING               */}
      {/* ================================================================= */}
      {activeSubTab === 'member_mapping' && (
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#DCE3E8] shadow-xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#E9ECEF]">
            <div>
              <h3 className="text-sm font-black text-[#252A30] flex items-center gap-2">
                <Link2 className="w-4 h-4 text-[#E5B82A]" />
                <span>Link Members to Scanner User IDs</span>
              </h3>
              <p className="text-xs text-[#84909A] mt-0.5">
                After enrolling a member&apos;s fingerprint or face on the scanner (e.g. User ID <code>1</code>, <code>2</code>, <code>101</code>), enter that same number below so check-ins validate automatically.
              </p>
            </div>

            <div className="relative w-full md:w-64">
              <Search className="w-3.5 h-3.5 text-[#84909A] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search member or ID..."
                value={mappingSearch}
                onChange={(e) => setMappingSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] text-xs font-semibold text-[#252A30] focus:outline-none focus:border-[#FFD447]"
              />
            </div>
          </div>

          {mappingFeedback && (
            <div
              className={`p-3 rounded-xl text-xs font-semibold border flex items-center gap-2 ${
                mappingFeedback.type === 'success'
                  ? 'bg-[#36A875]/10 border-[#36A875]/30 text-[#237A54]'
                  : 'bg-[#DC5555]/10 border-[#DC5555]/30 text-[#DC5555]'
              }`}
            >
              {mappingFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{mappingFeedback.text}</span>
            </div>
          )}

          {/* Mobile Card Layout (< md) */}
          <div className="md:hidden space-y-3">
            {filteredMappingMembers.map((m) => {
              const draft = bioDrafts[m.id] ?? m.biometricId ?? '';
              return (
                <div
                  key={m.id}
                  className="p-3.5 rounded-xl bg-[#F5F6F2]/70 border border-[#DCE3E8] space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={m.avatar}
                        alt={m.name}
                        className="w-9 h-9 rounded-full object-cover border border-[#DCE3E8] shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-black text-[#252A30] truncate">{m.name}</p>
                        <p className="text-[10px] text-[#84909A] truncate">
                          {m.planName} • Exp: {m.expiryDate}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase shrink-0 ${
                        m.status === 'active'
                          ? 'bg-[#36A875]/15 text-[#36A875]'
                          : m.status === 'expiring'
                          ? 'bg-[#E5A024]/15 text-[#B57B14]'
                          : 'bg-[#DC5555]/15 text-[#DC5555]'
                      }`}
                    >
                      {m.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draft}
                      placeholder="Scanner ID (e.g. 1)"
                      onChange={(e) =>
                        setBioDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))
                      }
                      className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white border border-[#DCE3E8] font-mono text-xs font-bold text-[#252A30] focus:outline-none focus:border-[#FFD447]"
                    />
                    <button
                      type="button"
                      disabled={savingMemberId === m.id}
                      onClick={() => handleSaveMapping(m.id, m.name)}
                      className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#FFD447] to-[#F5C62F] text-[#252A30] font-black text-xs inline-flex items-center gap-1 shrink-0 disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{savingMemberId === m.id ? 'Saving...' : 'Save ID'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table Layout (md+) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#F5F6F2] border-b border-[#DCE3E8] text-[10px] font-bold text-[#84909A] uppercase">
                  <th className="py-2.5 px-3">Member</th>
                  <th className="py-2.5 px-3">Plan &amp; Expiry</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Scanner User ID</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E9ECEF]">
                {filteredMappingMembers.map((m) => {
                  const draft = bioDrafts[m.id] ?? m.biometricId ?? '';
                  return (
                    <tr key={m.id} className="hover:bg-[#F5F6F2]/50">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={m.avatar}
                            alt={m.name}
                            className="w-8 h-8 rounded-full object-cover border border-[#DCE3E8]"
                          />
                          <div>
                            <p className="font-bold text-[#252A30]">{m.name}</p>
                            <p className="font-mono text-[10px] text-[#84909A]">
                              {m.id} &bull; {m.phone}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <p className="font-semibold text-[#252A30]">{m.planName}</p>
                        <p className="text-[10px] text-[#84909A]">Expires: {m.expiryDate}</p>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            m.status === 'active'
                              ? 'bg-[#36A875]/15 text-[#36A875]'
                              : m.status === 'expiring'
                              ? 'bg-[#E5A024]/15 text-[#B57B14]'
                              : 'bg-[#DC5555]/15 text-[#DC5555]'
                          }`}
                        >
                          {m.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={draft}
                          placeholder="e.g. 1 or 101"
                          onChange={(e) =>
                            setBioDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                          className="w-36 px-2.5 py-1.5 rounded-lg bg-[#F5F6F2] border border-[#DCE3E8] font-mono font-bold text-[#252A30] focus:outline-none focus:border-[#FFD447]"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          disabled={savingMemberId === m.id}
                          onClick={() => handleSaveMapping(m.id, m.name)}
                          className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#FFD447] to-[#F5C62F] text-[#252A30] font-black text-xs inline-flex items-center gap-1 disabled:opacity-50"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>{savingMemberId === m.id ? 'Saving...' : 'Save ID'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: LIVE BIOMETRIC SCAN HISTORY                                */}
      {/* ================================================================= */}
      {activeSubTab === 'live_scans' && (
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#DCE3E8] shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#E9ECEF]">
            <div>
              <h3 className="text-sm font-black text-[#252A30] flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-[#E5B82A]" />
                <span>Recent Biometric Scans</span>
              </h3>
              <p className="text-xs text-[#84909A] mt-0.5">
                Every member check-in from the entrance scanner appears here automatically in real time.
              </p>
            </div>
            <span className="text-[11px] font-bold text-[#5A646E] bg-[#F5F6F2] px-3 py-1 rounded-full border border-[#DCE3E8] self-start sm:self-auto">
              {biometricAttendance.length} Recorded Scans
            </span>
          </div>

          {biometricAttendance.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#84909A] space-y-1">
              <Fingerprint className="w-8 h-8 mx-auto text-[#DCE3E8]" />
              <p className="font-bold text-[#252A30]">Waiting for biometric scans</p>
              <p>When a member scans their finger on the entrance machine, the check-in will appear here automatically.</p>
            </div>
          ) : (
            <>
              {/* Mobile Scan Cards (< md) */}
              <div className="md:hidden space-y-2.5">
                {biometricAttendance.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-xl bg-[#F5F6F2]/70 border border-[#DCE3E8] flex items-start justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={log.avatar}
                        alt={log.memberName}
                        className="w-8 h-8 rounded-full object-cover border border-[#DCE3E8] shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-black text-[#252A30] truncate">{log.memberName}</p>
                        <p className="text-[10px] text-[#84909A] font-mono">
                          {log.timestamp} {log.biometricUserId ? `• ID: ${log.biometricUserId}` : ''}
                        </p>
                        {log.reason && (
                          <p className="text-[10px] text-[#5A646E] truncate mt-0.5">{log.reason}</p>
                        )}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase inline-flex items-center gap-1 shrink-0 ${
                        log.status === 'granted'
                          ? 'bg-[#36A875]/15 text-[#237A54]'
                          : 'bg-[#DC5555]/15 text-[#DC5555]'
                      }`}
                    >
                      {log.status === 'granted' ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : (
                        <XCircle className="w-3 h-3" />
                      )}
                      {log.status}
                    </span>
                  </div>
                ))}
              </div>

              {/* Desktop Table (md+) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#F5F6F2] border-b border-[#DCE3E8] text-[10px] font-bold text-[#84909A] uppercase">
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3">Member</th>
                      <th className="py-2.5 px-3">Scanner ID</th>
                      <th className="py-2.5 px-3">Method</th>
                      <th className="py-2.5 px-3">Verdict</th>
                      <th className="py-2.5 px-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E9ECEF]">
                    {biometricAttendance.map((log) => (
                      <tr key={log.id} className="hover:bg-[#F5F6F2]/50">
                        <td className="py-2.5 px-3 font-mono font-bold text-[#252A30] whitespace-nowrap">
                          {log.timestamp}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <img
                              src={log.avatar}
                              alt={log.memberName}
                              className="w-7 h-7 rounded-full object-cover border border-[#DCE3E8]"
                            />
                            <span className="font-bold text-[#252A30]">{log.memberName}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-[#5A646E]">
                          {log.biometricUserId || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-[#5A646E]">{log.verifyMode || 'Fingerprint'}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                              log.status === 'granted'
                                ? 'bg-[#36A875]/15 text-[#237A54]'
                                : 'bg-[#DC5555]/15 text-[#DC5555]'
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[#5A646E]">
                          {log.reason || 'Verified biometric check-in'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* DEVELOPER-ONLY TAB: CLOUD SERVER DIAGNOSTICS                      */}
      {/* ================================================================= */}
      {showSystemSetup && activeSubTab === 'cloud_biometric' && <BiometricManagementPanel />}

      {/* ================================================================= */}
      {/* DEVELOPER-ONLY TAB: ADMS / LOCAL BRIDGE                           */}
      {/* ================================================================= */}
      {showSystemSetup && activeSubTab === 'secureye_bridge' && (
        <div className="space-y-5">
          <AdmsBackendPanel />

          {biometricSyncLogs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-[#DCE3E8] shadow-xs space-y-3">
              <h4 className="text-xs font-black text-[#252A30] uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-[#36A875]" />
                <span>Recent Cloud Sync Events ({biometricSyncLogs.length})</span>
              </h4>
              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {biometricSyncLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-xl bg-[#F5F6F2] border border-[#E9ECEF] flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase shrink-0 ${
                          log.level === 'success'
                            ? 'bg-[#36A875]/15 text-[#36A875]'
                            : log.level === 'warning'
                            ? 'bg-[#E5A024]/15 text-[#B57B14]'
                            : log.level === 'error'
                            ? 'bg-[#DC5555]/15 text-[#DC5555]'
                            : 'bg-[#84909A]/15 text-[#5A646E]'
                        }`}
                      >
                        {log.eventType}
                      </span>
                      <span className="font-semibold text-[#252A30] truncate">{log.message}</span>
                    </div>
                    <span className="font-mono text-[10px] text-[#84909A] shrink-0">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
