import React, { useState, useEffect } from 'react';
import { useGym } from '../../context/GymContext';
import { useUsbBiometric } from '../../hooks/useUsbBiometric';
import { AdmsBackendPanel } from './AdmsBackendPanel';
import {
  Fingerprint,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Save,
  Trash2,
  Volume2,
  VolumeX,
  Check,
  Search,
  Server,
  Users,
  Link2,
  CloudUpload,
  Activity,
} from 'lucide-react';

type BiometricSubTab = 'secureye_bridge' | 'member_mapping' | 'usb_enrollment';

export const BiometricView: React.FC = () => {
  const {
    members,
    biometricSyncLogs,
    linkMemberBiometricId,
    saveBiometricEnrollment,
    deleteBiometricEnrollment,
    seedFirestoreData,
    isSyncing,
    soundEnabled,
    setSoundEnabled,
    playAccessTone,
  } = useGym();

  const [activeSubTab, setActiveSubTab] = useState<BiometricSubTab>('secureye_bridge');

  // Member <-> Secureye User ID Mapping state
  const [mappingSearch, setMappingSearch] = useState('');
  const [bioDrafts, setBioDrafts] = useState<Record<string, string>>({});
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [mappingFeedback, setMappingFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Legacy USB / Manual Enrollment state
  const [selectedMemberId, setSelectedMemberId] = useState<string>(members[0]?.id || '');
  const [samples, setSamples] = useState({
    sample1: false,
    sample2: false,
    sample3: false,
  });
  const [capturingStep, setCapturingStep] = useState<number | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [customToken, setCustomToken] = useState<string>('');
  const [searchMember, setSearchMember] = useState<string>('');

  const { isSensorConnected, sensorName, isReadingData, detectUsbDevice, lastDataRead } =
    useUsbBiometric();

  const currentMember = members.find((m) => m.id === selectedMemberId) || members[0];

  React.useEffect(() => {
    if (currentMember) {
      if (currentMember.biometricId && currentMember.biometricId !== 'NONE') {
        setCustomToken(currentMember.biometricId);
      } else {
        setCustomToken(`BIO-FP-${Math.floor(1000 + Math.random() * 9000)}`);
      }
      setSamples({
        sample1: !!currentMember.biometricRegistered,
        sample2: !!currentMember.biometricRegistered,
        sample3: !!currentMember.biometricRegistered,
      });
    }
  }, [selectedMemberId, currentMember]);

  const handleSaveMapping = async (memberId: string, memberName: string) => {
    const existingMember = members.find((m) => m.id === memberId);
    const val = (bioDrafts[memberId] ?? existingMember?.biometricId ?? '').trim();
    setSavingMemberId(memberId);
    setMappingFeedback(null);
    const res = await linkMemberBiometricId(memberId, val);
    if (!res.ok) {
      setMappingFeedback({ type: 'error', text: res.error || 'Failed to save mapping.' });
      playAccessTone('denied');
    } else {
      setMappingFeedback({
        type: 'success',
        text: `Linked ${memberName} (${memberId}) → Secureye Machine User ID "${val}" and synced to Firestore.`,
      });
      playAccessTone('granted');
    }
    setSavingMemberId(null);
  };

  const handleCaptureSample = (step: 1 | 2 | 3) => {
    setCapturingStep(step);
    playAccessTone('beep');

    setTimeout(() => {
      setSamples((prev) => ({ ...prev, [`sample${step}`]: true }));
      setCapturingStep(null);
      playAccessTone('granted');
      setFeedbackMsg(`Sample ${step} captured with 99.4% ridge clarity (SIMULATED).`);
      setTimeout(() => setFeedbackMsg(null), 3000);
    }, 900);
  };

  const handleSaveEnrollment = async () => {
    if (!currentMember) return;
    const token = customToken || `BIO-FP-${Math.floor(1000 + Math.random() * 9000)}`;
    await saveBiometricEnrollment(currentMember.id, token, samples);
    playAccessTone('granted');
    setFeedbackMsg(`Biometric profile for ${currentMember.name} successfully registered in database!`);
    setTimeout(() => setFeedbackMsg(null), 4000);
  };

  const handleDeleteEnrollment = async () => {
    if (!currentMember) return;
    await deleteBiometricEnrollment(currentMember.id);
    setSamples({ sample1: false, sample2: false, sample3: false });
    setCustomToken(`BIO-FP-${Math.floor(1000 + Math.random() * 9000)}`);
    playAccessTone('denied');
    setFeedbackMsg(`Biometric registration revoked for ${currentMember.name}.`);
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const handleResetSamples = () => {
    setSamples({ sample1: false, sample2: false, sample3: false });
    playAccessTone('beep');
  };

  useEffect(() => {
    if (lastDataRead) {
      if (!samples.sample1) {
        handleCaptureSample(1);
      } else if (!samples.sample2) {
        handleCaptureSample(2);
      } else if (!samples.sample3) {
        handleCaptureSample(3);
      }
    }
  }, [lastDataRead]);

  const isAllCaptured = samples.sample1 && samples.sample2 && samples.sample3;

  const filteredMappingMembers = members.filter((m) => {
    const q = mappingSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      (m.biometricId || '').toLowerCase().includes(q) ||
      (m.phone || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      {/* Top Sub-Tab Navigation Header */}
      <div className="bg-white rounded-2xl p-4 border border-[#DCE3E8] shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveSubTab('secureye_bridge')}
            className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all ${
              activeSubTab === 'secureye_bridge'
                ? 'bg-[#252A30] text-[#FFD447] shadow-xs'
                : 'bg-[#F5F6F2] text-[#252A30] hover:bg-[#EAECE6]'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Secureye LAN Bridge &amp; ADMS</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('member_mapping')}
            className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all ${
              activeSubTab === 'member_mapping'
                ? 'bg-[#252A30] text-[#FFD447] shadow-xs'
                : 'bg-[#F5F6F2] text-[#252A30] hover:bg-[#EAECE6]'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Member ↔ Machine User IDs ({members.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('usb_enrollment')}
            className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all ${
              activeSubTab === 'usb_enrollment'
                ? 'bg-[#252A30] text-[#FFD447] shadow-xs'
                : 'bg-[#F5F6F2] text-[#252A30] hover:bg-[#EAECE6]'
            }`}
          >
            <Fingerprint className="w-3.5 h-3.5" />
            <span>USB / Manual Enrollment</span>
          </button>
        </div>

        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all self-start lg:self-auto ${
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
          <span>{soundEnabled ? 'Audio Chime ON' : 'Audio Muted'}</span>
        </button>
      </div>

      {/* ================================================================= */}
      {/* TAB 1: SECUREYE LOCAL LAN BRIDGE & ADMS SERVER                    */}
      {/* ================================================================= */}
      {activeSubTab === 'secureye_bridge' && (
        <div className="space-y-5">
          <AdmsBackendPanel />

          {/* Live Firestore Sync Events Mirror */}
          {biometricSyncLogs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-[#DCE3E8] shadow-xs space-y-3">
              <h4 className="text-xs font-black text-[#252A30] uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-[#36A875]" />
                <span>Recent Firebase Live Sync Events ({biometricSyncLogs.length})</span>
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

      {/* ================================================================= */}
      {/* TAB 2: MEMBER <-> SECUREYE MACHINE USER ID MAPPING                */}
      {/* ================================================================= */}
      {activeSubTab === 'member_mapping' && (
        <div className="bg-white rounded-2xl p-5 border border-[#DCE3E8] shadow-xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#E9ECEF]">
            <div>
              <h3 className="text-sm font-black text-[#252A30] flex items-center gap-2">
                <Link2 className="w-4 h-4 text-[#E5B82A]" />
                <span>Link Dream Gym Members to Secureye User IDs</span>
              </h3>
              <p className="text-xs text-[#84909A] mt-0.5">
                Enroll a member&apos;s fingerprint/face on the Secureye machine (e.g. User ID <code>1</code>, <code>2</code>, <code>101</code>), then enter that exact ID here so real punches validate membership expiry automatically.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#84909A] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search member or ID..."
                  value={mappingSearch}
                  onChange={(e) => setMappingSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] text-xs font-semibold text-[#252A30] focus:outline-none focus:border-[#FFD447]"
                />
              </div>

              <button
                type="button"
                onClick={seedFirestoreData}
                disabled={isSyncing}
                className="px-3 py-1.5 rounded-xl bg-[#252A30] text-[#FFD447] font-black text-xs flex items-center gap-1.5 hover:bg-[#313740] disabled:opacity-50"
              >
                <CloudUpload className="w-3.5 h-3.5" />
                <span>{isSyncing ? 'Syncing...' : 'Push All Members to Firestore'}</span>
              </button>
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

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#F5F6F2] border-b border-[#DCE3E8] text-[10px] font-bold text-[#84909A] uppercase">
                  <th className="py-2.5 px-3">Member</th>
                  <th className="py-2.5 px-3">Plan &amp; Expiry</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Secureye Machine User ID</th>
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
                          <span>{savingMemberId === m.id ? 'Saving...' : 'Link ID'}</span>
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
      {/* TAB 3: USB / MANUAL ENROLLMENT (EXISTING DREAM GYM VIEW)          */}
      {/* ================================================================= */}
      {activeSubTab === 'usb_enrollment' && (
        <div className="space-y-6">
          {/* USB Sensor Status Banner */}
          <div className="bg-gradient-to-r from-[#FFF8E7] to-[#FFF0D0] border border-[#FFD447]/60 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#FFD447] text-[#252A30] flex items-center justify-center shrink-0">
                <Fingerprint className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-black text-xs text-[#252A30] tracking-wider uppercase">
                    {isReadingData
                      ? 'READING USB DATA...'
                      : isSensorConnected
                      ? 'BIOMETRIC SENSOR CONNECTED'
                      : 'USB SENSOR NOT DETECTED'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full font-black text-[10px] ${
                      isSensorConnected || isReadingData
                        ? 'bg-[#36A875]/20 text-[#36A875]'
                        : 'bg-[#84909A]/15 text-[#84909A]'
                    }`}
                  >
                    {isReadingData
                      ? 'DATA STREAM ACTIVE'
                      : isSensorConnected
                      ? 'DEVICE READY'
                      : 'SEARCHING USB'}
                  </span>
                </div>
                <p className="text-xs text-[#84909A] mt-0.5">
                  {isSensorConnected || isReadingData
                    ? `${sensorName} optical scanner active.`
                    : 'Use this tab for local USB scanner testing. For your Wi-Fi Secureye wall terminal, use the Secureye LAN Bridge tab.'}
                </p>
              </div>
            </div>

            {!isSensorConnected && (
              <button
                onClick={detectUsbDevice}
                className="px-3 py-1.5 rounded-xl border border-[#FFD447] bg-white text-[#252A30] hover:bg-[#FFF8E7] text-xs font-bold transition-all self-start sm:self-auto"
              >
                Detect USB Sensor
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Member Directory Selector */}
            <div className="lg:col-span-4 bg-white rounded-2xl p-4 border border-[#DCE3E8] shadow-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[#E9ECEF]">
                <h2 className="text-xs font-black text-[#252A30] uppercase tracking-wider">
                  Select Member
                </h2>
                <span className="text-[10px] font-bold text-[#84909A]">
                  {members.length} Total
                </span>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#84909A] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter members..."
                  value={searchMember}
                  onChange={(e) => setSearchMember(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] text-xs font-semibold text-[#252A30] focus:outline-none focus:border-[#FFD447]"
                />
              </div>

              <div className="space-y-1 max-h-[460px] overflow-y-auto pr-1">
                {members
                  .filter(
                    (m) =>
                      m.name.toLowerCase().includes(searchMember.toLowerCase()) ||
                      m.id.toLowerCase().includes(searchMember.toLowerCase())
                  )
                  .map((m) => {
                    const isSelected = m.id === currentMember?.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setSelectedMemberId(m.id)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all ${
                          isSelected
                            ? 'bg-[#252A30] text-white shadow-xs'
                            : 'hover:bg-[#F5F6F2] text-[#252A30]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img
                            src={m.avatar}
                            alt={m.name}
                            className="w-8 h-8 rounded-full object-cover border border-[#DCE3E8] shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-bold truncate leading-tight">{m.name}</p>
                            <p
                              className={`text-[10px] font-mono truncate ${
                                isSelected ? 'text-[#FFD447]' : 'text-[#84909A]'
                              }`}
                            >
                              {m.id} • {m.planName}
                            </p>
                          </div>
                        </div>
                        {m.biometricRegistered ? (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase shrink-0 ${
                              isSelected
                                ? 'bg-[#36A875] text-white'
                                : 'bg-[#36A875]/15 text-[#36A875]'
                            }`}
                          >
                            Enrolled
                          </span>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase shrink-0 ${
                              isSelected
                                ? 'bg-white/20 text-white'
                                : 'bg-[#F5F6F2] text-[#84909A]'
                            }`}
                          >
                            Pending
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>

            {/* Right: 3-Sample Enrollment Station */}
            <div className="lg:col-span-8 bg-white rounded-2xl p-6 border border-[#DCE3E8] shadow-xs space-y-6">
              {currentMember && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl bg-[#F5F6F2] border border-[#DCE3E8] gap-4">
                  <div className="flex items-center gap-3.5">
                    <img
                      src={currentMember.avatar}
                      alt={currentMember.name}
                      className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-xs"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-black text-[#252A30]">
                          {currentMember.name}
                        </h3>
                        <span className="font-mono text-xs font-bold text-[#84909A]">
                          ({currentMember.id})
                        </span>
                      </div>
                      <p className="text-xs text-[#84909A] font-medium mt-0.5">
                        Plan:{' '}
                        <span className="text-[#252A30] font-bold">{currentMember.planName}</span> •
                        Status:{' '}
                        <span className="font-bold text-[#36A875]">
                          {currentMember.status.toUpperCase()}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="text-right sm:border-l sm:border-[#DCE3E8] sm:pl-4">
                    <p className="text-[10px] font-bold text-[#84909A] uppercase tracking-wider">
                      Hardware Token ID
                    </p>
                    <input
                      type="text"
                      value={customToken}
                      onChange={(e) => setCustomToken(e.target.value)}
                      className="font-mono text-xs font-black text-[#252A30] bg-white border border-[#DCE3E8] rounded-lg px-2.5 py-1 text-center mt-1 focus:outline-none focus:border-[#FFD447]"
                    />
                  </div>
                </div>
              )}

              {feedbackMsg && (
                <div className="p-3 rounded-xl bg-[#36A875]/10 border border-[#36A875]/30 text-xs font-bold text-[#36A875] flex items-center gap-2 animate-fade-in">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{feedbackMsg}</span>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="text-xs font-black text-[#252A30] uppercase tracking-wider">
                      3-Sample Biometric Enrollment
                    </h4>
                    <p className="text-xs text-[#84909A]">
                      Capture 3 independent optical finger impressions to build feature map.
                    </p>
                  </div>
                  <button
                    onClick={handleResetSamples}
                    className="text-xs font-bold text-[#84909A] hover:text-[#252A30] flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {([1, 2, 3] as const).map((step) => {
                    const isCaptured = samples[`sample${step}`];
                    const isBusy = capturingStep === step;

                    return (
                      <div
                        key={step}
                        className={`rounded-2xl p-5 border text-center transition-all flex flex-col justify-between items-center ${
                          isCaptured
                            ? 'bg-[#36A875]/5 border-[#36A875]/30 ring-1 ring-[#36A875]/20'
                            : isBusy
                            ? 'bg-[#FFF8E7] border-[#FFD447] animate-pulse'
                            : 'bg-[#F5F6F2]/60 border-[#DCE3E8]'
                        }`}
                      >
                        <span className="text-[11px] font-bold text-[#84909A] uppercase tracking-wider mb-2">
                          Sample {step}
                        </span>

                        <div
                          className={`w-16 h-16 rounded-full flex items-center justify-center my-2 transition-all ${
                            isCaptured
                              ? 'bg-[#36A875] text-white shadow-md shadow-[#36A875]/25'
                              : isBusy
                              ? 'bg-[#FFD447] text-[#252A30] animate-bounce'
                              : 'bg-white border-2 border-dashed border-[#DCE3E8] text-[#84909A]'
                          }`}
                        >
                          <Fingerprint className="w-8 h-8" />
                        </div>

                        <div className="mt-2 w-full">
                          {isCaptured ? (
                            <div className="flex items-center justify-center gap-1 text-xs font-black text-[#36A875]">
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                              <span>Captured (99.4%)</span>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleCaptureSample(step)}
                              disabled={capturingStep !== null}
                              className="w-full py-2 rounded-xl bg-white border border-[#DCE3E8] hover:border-[#FFD447] text-[#252A30] font-bold text-xs shadow-2xs hover:shadow-xs transition-all disabled:opacity-50"
                            >
                              {isBusy ? 'Scanning...' : `Scan Sample ${step}`}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-[#F5F6F2] p-4 rounded-2xl border border-[#DCE3E8] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${
                      isAllCaptured
                        ? 'bg-[#36A875] text-white'
                        : 'bg-[#FFD447] text-[#252A30]'
                    }`}
                  >
                    {isAllCaptured
                      ? '3/3'
                      : `${[samples.sample1, samples.sample2, samples.sample3].filter(Boolean).length}/3`}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#252A30]">
                      {isAllCaptured
                        ? 'All 3 samples verified and ready to save'
                        : 'Capture remaining samples before registering'}
                    </p>
                    <p className="text-[11px] text-[#84909A]">
                      Token will be bound to member ID{' '}
                      <span className="font-mono text-[#252A30] font-bold">
                        {currentMember?.id}
                      </span>
                      .
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {currentMember?.biometricRegistered && (
                    <button
                      onClick={handleDeleteEnrollment}
                      className="px-3 py-2 rounded-xl bg-white border border-[#DC5555]/30 text-[#DC5555] hover:bg-[#FFF0F0] font-bold text-xs flex items-center gap-1.5 transition-all"
                      title="Revoke biometric registration"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Registration</span>
                    </button>
                  )}

                  <button
                    onClick={handleSaveEnrollment}
                    disabled={!isAllCaptured}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#FFD447] to-[#F5C62F] text-[#252A30] font-black text-xs hover:shadow-md hover:shadow-[#FFD447]/30 transition-all flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save Biometric</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
