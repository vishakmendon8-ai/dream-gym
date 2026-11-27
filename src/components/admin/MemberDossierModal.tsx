import React, { useState, useEffect } from 'react';
import { Member, MemberStatus } from '../../types/gym';
import { useGym } from '../../context/GymContext';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { 
  X, 
  Fingerprint, 
  Calendar, 
  CreditCard, 
  CheckCircle2, 
  Save,
  Layers,
  ShieldCheck,
  UserCog,
  Check
} from 'lucide-react';

interface MemberDossierModalProps {
  member: Member | null;
  isOpen: boolean;
  onClose: () => void;
}

function toInputDate(dateStr?: string): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

function computeDaysLeft(expiryStr: string): number {
  const target = new Date(expiryStr);
  if (isNaN(target.getTime())) return 0;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diff = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

function addMonthsToDate(startStr: string, months: number): string {
  const base = new Date(startStr);
  if (isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setMonth(fallback.getMonth() + months);
    return fallback.toISOString().split('T')[0];
  }
  base.setMonth(base.getMonth() + months);
  return base.toISOString().split('T')[0];
}

export const MemberDossierModal: React.FC<MemberDossierModalProps> = ({ member, isOpen, onClose }) => {
  const {
    plans,
    updateMember,
    assignMemberPlan,
    updateMemberStatus,
    attendance,
    payments
  } = useGym();

  const [activeTab, setActiveTab] = useState<'overview' | 'attendance' | 'billing' | 'biometric'>('overview');

  // Manual Membership Control States
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<MemberStatus>('active');
  const [startDate, setStartDate] = useState<string>('');
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [recordPaymentEntry, setRecordPaymentEntry] = useState<boolean>(false);
  const [paymentMethod, setPaymentMethod] = useState<string>('Cash (Admin Desk)');
  const [planSavedToast, setPlanSavedToast] = useState<boolean>(false);
  const [isSavingPlan, setIsSavingPlan] = useState<boolean>(false);

  // Editable Profile Details States
  const [editName, setEditName] = useState<string>('');
  const [editEmail, setEditEmail] = useState<string>('');
  const [editPhone, setEditPhone] = useState<string>('');
  const [editEmergency, setEditEmergency] = useState<string>('');
  const [editPassword, setEditPassword] = useState<string>('');
  const [profileSavedToast, setProfileSavedToast] = useState<boolean>(false);

  // Sync form state whenever member changes or modal opens
  useEffect(() => {
    if (!member) return;
    setSelectedPlanId(member.planId || '');
    setSelectedStatus(member.status || 'active');
    setStartDate(toInputDate(member.startDate || member.joinDate));
    setExpiryDate(toInputDate(member.expiryDate));
    setRecordPaymentEntry(false);
    setPlanSavedToast(false);

    setEditName(member.name || '');
    setEditEmail(member.email || '');
    setEditPhone(member.phone || '');
    setEditEmergency(member.emergencyContact || '');
    setEditPassword(member.password || '');
    setProfileSavedToast(false);
  }, [member?.id, isOpen]);

  if (!isOpen || !member) return null;

  const memberAttendance = attendance.filter(a => a.memberId === member.id || a.memberName === member.name);
  const memberPayments = payments.filter(p => p.memberId === member.id || p.memberName === member.name);

  const selectedPlanObj = plans.find(p => p.id === selectedPlanId);
  const calculatedDaysLeft = selectedPlanId ? computeDaysLeft(expiryDate) : 0;

  const handleSelectPlan = (planId: string) => {
    setSelectedPlanId(planId);
    if (!planId) {
      setSelectedStatus('pending');
      return;
    }
    const plan = plans.find(p => p.id === planId);
    if (plan) {
      const today = new Date().toISOString().split('T')[0];
      const nextExpiry = addMonthsToDate(today, plan.durationMonths);
      setStartDate(today);
      setExpiryDate(nextExpiry);
      setSelectedStatus('active');
    }
  };

  const handleStartDateChange = (newStart: string) => {
    setStartDate(newStart);
    if (selectedPlanObj) {
      setExpiryDate(addMonthsToDate(newStart, selectedPlanObj.durationMonths));
    }
  };

  const handleSaveMembership = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPlan(true);
    try {
      const planName = selectedPlanObj ? selectedPlanObj.name : 'No Plan Assigned';
      const daysLeft = selectedPlanId
        ? (selectedStatus === 'expired' || selectedStatus === 'pending' || selectedStatus === 'inactive' ? 0 : computeDaysLeft(expiryDate))
        : 0;

      await assignMemberPlan(member.id, {
        planId: selectedPlanId,
        planName,
        status: selectedStatus,
        startDate,
        expiryDate: selectedPlanId ? expiryDate : '—',
        daysLeft,
        recordPaymentEntry: recordPaymentEntry && !!selectedPlanId,
        paymentMethod,
        amount: selectedPlanObj?.price || 0
      });

      setPlanSavedToast(true);
      setRecordPaymentEntry(false);
      setTimeout(() => setPlanSavedToast(false), 3000);
    } finally {
      setIsSavingPlan(false);
    }
  };

  const handleSaveProfileDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateMember(member.id, {
      name: editName.trim() || member.name,
      email: editEmail.trim() || member.email,
      phone: editPhone.trim() || member.phone,
      emergencyContact: editEmergency.trim() || member.emergencyContact,
      password: editPassword.trim() || member.password
    });
    setProfileSavedToast(true);
    setTimeout(() => setProfileSavedToast(false), 3000);
  };

  // Generate a 30-day attendance consistency preview
  const daysInMonth = Array.from({ length: 30 }, (_, i) => {
    const day = i + 1;
    const attended = (day * 7) % 3 === 0 || day % 2 === 0;
    return { day, attended };
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-graphite/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-2xl glass-panel rounded-modal border border-cloud-border shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-cloud-border bg-white/80 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <img
                src={member.avatar}
                alt={member.name}
                className="w-14 h-14 rounded-full object-cover border-2 border-yellow-sunshine shadow-md"
              />
              <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white ${
                member.status === 'active' ? 'bg-status-success' : member.status === 'expiring' || member.status === 'pending' ? 'bg-status-warning' : 'bg-status-error'
              }`} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-black text-graphite">{member.name}</h3>
                <Badge status={member.status} />
              </div>
              <p className="text-xs text-graphite-muted flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="font-bold text-graphite">{member.planName || 'No Plan Assigned'}</span>
                <span>•</span>
                <span className="font-mono text-graphite-muted">{member.id}</span>
                <span>•</span>
                <span className="font-mono text-graphite font-bold">{member.biometricId}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-control text-graphite-muted hover:text-graphite hover:bg-cloud-grey transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-cloud-border bg-cloud-grey/40 px-6">
          {([
            { id: 'overview', label: 'Profile & Plan' },
            { id: 'attendance', label: 'Attendance' },
            { id: 'billing', label: 'Billing' },
            { id: 'biometric', label: 'Optical Biometric' }
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-3 px-3.5 text-xs font-bold border-b-2 transition-all ${
                activeTab === tab.id
                  ? 'border-yellow-sunshine text-graphite bg-white/50'
                  : 'border-transparent text-graphite-muted hover:text-graphite'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 text-xs space-y-5">
          
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Quick Metrics */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3.5 rounded-card bg-white border border-cloud-border">
                  <span className="text-[11px] font-semibold text-graphite-muted block">Current Active Plan</span>
                  <p className="text-sm font-black text-graphite mt-1 truncate">
                    {member.planName || 'Unassigned'}
                  </p>
                  <span className="text-[10px] text-graphite-muted">
                    {member.status === 'pending' ? 'Awaiting assignment' : `Expires: ${member.expiryDate}`}
                  </span>
                </div>

                <div className="p-3.5 rounded-card bg-white border border-cloud-border">
                  <span className="text-[11px] font-semibold text-graphite-muted block">Validity Remaining</span>
                  <p className="text-base font-black text-graphite mt-1">
                    {member.status === 'expired' ? 'Expired' : member.status === 'pending' ? 'Pending' : `${member.daysLeft} Days`}
                  </p>
                  <span className="text-[10px] text-graphite-muted">Start: {member.startDate || member.joinDate}</span>
                </div>

                <div className="p-3.5 rounded-card bg-white border border-cloud-border">
                  <span className="text-[11px] font-semibold text-graphite-muted block">Check-in Frequency</span>
                  <p className="text-base font-black text-graphite mt-1">{member.totalCheckIns} Total</p>
                  <span className="text-[10px] text-status-success font-semibold">Gate Verified</span>
                </div>
              </div>

              {/* ADMIN MANUAL MEMBERSHIP PLAN CONTROL */}
              <form onSubmit={handleSaveMembership} className="rounded-2xl bg-white border-2 border-[#FFD447]/70 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-[#252A30] text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[#FFD447] text-[#252A30] flex items-center justify-center">
                      <Layers className="w-4 h-4 stroke-[2.4]" />
                    </div>
                    <div>
                      <h4 className="font-black text-xs tracking-wide uppercase">Manual Membership Control</h4>
                      <p className="text-[10px] text-[#A0AEC0]">Select & assign plan manually — reflects live in member app</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-[#FFD447]/20 text-[#FFD447] text-[10px] font-black border border-[#FFD447]/30">
                    Admin Only
                  </span>
                </div>

                <div className="p-4 space-y-4">
                  {/* Plan Selector Cards */}
                  <div>
                    <label className="block text-[11px] font-extrabold text-graphite uppercase tracking-wider mb-2">
                      Select Membership Plan
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {plans.map((plan) => {
                        const isPicked = selectedPlanId === plan.id;
                        return (
                          <button
                            key={plan.id}
                            type="button"
                            onClick={() => handleSelectPlan(plan.id)}
                            className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between gap-2 ${
                              isPicked
                                ? 'bg-[#FFF8E7] border-[#FFD447] ring-2 ring-[#FFD447]/40 shadow-xs'
                                : 'bg-[#F5F6F2]/70 border-cloud-border hover:border-[#FFD447]/70 hover:bg-white'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-black text-graphite text-xs truncate">{plan.name}</div>
                              <div className="text-[10px] text-graphite-muted font-medium">
                                {plan.durationMonths} {plan.durationMonths === 1 ? 'Month' : 'Months'} • ₹{plan.price.toLocaleString('en-IN')}
                              </div>
                            </div>
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border ${
                              isPicked ? 'bg-[#252A30] border-[#252A30] text-[#FFD447]' : 'bg-white border-cloud-border'
                            }`}>
                              {isPicked && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                          </button>
                        );
                      })}

                      {/* Unassign / No Plan Option */}
                      <button
                        type="button"
                        onClick={() => handleSelectPlan('')}
                        className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between gap-2 ${
                          selectedPlanId === ''
                            ? 'bg-red-50 border-status-error/50 ring-2 ring-status-error/20'
                            : 'bg-[#F5F6F2]/70 border-cloud-border hover:border-status-error/40 hover:bg-white'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-graphite text-xs">No Active Plan</div>
                          <div className="text-[10px] text-graphite-muted">Set as unassigned / pending</div>
                        </div>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border ${
                          selectedPlanId === '' ? 'bg-status-error border-status-error text-white' : 'bg-white border-cloud-border'
                        }`}>
                          {selectedPlanId === '' && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Status + Dates Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-graphite mb-1">Membership Status</label>
                      <select
                        value={selectedStatus}
                        onChange={(e) => setSelectedStatus(e.target.value as MemberStatus)}
                        className="w-full px-3 py-2 rounded-xl bg-[#F5F6F2] border border-cloud-border text-xs font-bold text-graphite focus:outline-none focus:border-[#FFD447] focus:bg-white"
                      >
                        <option value="active">Active</option>
                        <option value="expiring">Expiring Soon</option>
                        <option value="expired">Expired</option>
                        <option value="pending">Pending</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-graphite mb-1 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-graphite-muted" /> Start Date
                      </label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => handleStartDateChange(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-[#F5F6F2] border border-cloud-border text-xs font-bold text-graphite focus:outline-none focus:border-[#FFD447] focus:bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-graphite mb-1 flex items-center justify-between">
                        <span>Expiry Date</span>
                        {selectedPlanId && (
                          <span className="text-[10px] text-status-success font-extrabold">{calculatedDaysLeft}d left</span>
                        )}
                      </label>
                      <input
                        type="date"
                        value={expiryDate}
                        onChange={(e) => setExpiryDate(e.target.value)}
                        disabled={!selectedPlanId}
                        className="w-full px-3 py-2 rounded-xl bg-[#F5F6F2] border border-cloud-border text-xs font-bold text-graphite focus:outline-none focus:border-[#FFD447] focus:bg-white disabled:opacity-50"
                      />
                    </div>
                  </div>

                  {/* Optional Manual Payment Entry */}
                  {selectedPlanId && (
                    <div className="p-3 rounded-xl bg-[#F5F6F2]/80 border border-cloud-border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <label className="flex items-center gap-2 cursor-pointer font-bold text-graphite">
                        <input
                          type="checkbox"
                          checked={recordPaymentEntry}
                          onChange={(e) => setRecordPaymentEntry(e.target.checked)}
                          className="w-4 h-4 rounded accent-[#252A30]"
                        />
                        <CreditCard className="w-3.5 h-3.5 text-yellow-active" />
                        <span>Also log payment (₹{selectedPlanObj?.price.toLocaleString('en-IN')})</span>
                      </label>

                      {recordPaymentEntry && (
                        <select
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg bg-white border border-cloud-border text-[11px] font-bold text-graphite"
                        >
                          <option value="Cash (Admin Desk)">Cash (Admin Desk)</option>
                          <option value="UPI / GPay / PhonePe">UPI / GPay / PhonePe</option>
                          <option value="Card Terminal">Card Terminal</option>
                          <option value="Bank Transfer">Bank Transfer</option>
                        </select>
                      )}
                    </div>
                  )}

                  {/* Save Plan Action Row */}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    {planSavedToast ? (
                      <div className="flex items-center gap-1.5 text-status-success font-extrabold text-xs animate-fade-in">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Plan saved & reflected on member profile!</span>
                      </div>
                    ) : (
                      <p className="text-[11px] text-graphite-muted flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-status-success shrink-0" />
                        <span>Member app shows only this active plan.</span>
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={isSavingPlan}
                      className="btn-jelly-yellow px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm shrink-0"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{isSavingPlan ? 'Saving...' : 'Save & Apply Plan'}</span>
                    </button>
                  </div>
                </div>
              </form>

              {/* Contact & Editable Profile Details */}
              <form onSubmit={handleSaveProfileDetails} className="p-4 rounded-card bg-white border border-cloud-border space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-graphite uppercase text-[11px] tracking-wider flex items-center gap-1.5">
                    <UserCog className="w-3.5 h-3.5 text-yellow-active" />
                    <span>Member Profile Details (Admin Controlled)</span>
                  </h4>
                  {profileSavedToast && (
                    <span className="text-[11px] font-bold text-status-success flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Profile Saved
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                  <div>
                    <label className="text-graphite-muted block text-[11px] font-semibold mb-1">Full Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-[#F5F6F2] border border-cloud-border font-bold text-graphite focus:outline-none focus:border-[#FFD447] focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-graphite-muted block text-[11px] font-semibold mb-1">Primary Email</label>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-[#F5F6F2] border border-cloud-border font-bold text-graphite focus:outline-none focus:border-[#FFD447] focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-graphite-muted block text-[11px] font-semibold mb-1">Mobile Phone</label>
                    <input
                      type="text"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-[#F5F6F2] border border-cloud-border font-bold text-graphite focus:outline-none focus:border-[#FFD447] focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-graphite-muted block text-[11px] font-semibold mb-1">Emergency Contact</label>
                    <input
                      type="text"
                      value={editEmergency}
                      onChange={(e) => setEditEmergency(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-[#F5F6F2] border border-cloud-border font-bold text-graphite focus:outline-none focus:border-[#FFD447] focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-graphite-muted block text-[11px] font-semibold mb-1">App Login Password</label>
                    <input
                      type="text"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-[#F5F6F2] border border-cloud-border font-mono font-bold text-graphite focus:outline-none focus:border-[#FFD447] focus:bg-white"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="w-full py-2 px-3 rounded-lg bg-[#252A30] hover:bg-[#313740] text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Save className="w-3.5 h-3.5 text-[#FFD447]" />
                      <span>Update Profile Info</span>
                    </button>
                  </div>
                </div>
              </form>

              {/* Attendance Heatmap Preview */}
              <div className="p-4 rounded-card bg-white border border-cloud-border">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-graphite uppercase text-[11px] tracking-wider">
                    30-Day Check-in Consistency
                  </h4>
                  <span className="text-[10px] font-bold text-status-success">18 / 30 Days Active</span>
                </div>
                <div className="grid grid-cols-10 gap-1.5 pt-1">
                  {daysInMonth.map((d) => (
                    <div
                      key={d.day}
                      title={`Day ${d.day}: ${d.attended ? 'Attended' : 'Rest day'}`}
                      className={`h-5 rounded-sm flex items-center justify-center text-[9px] font-bold transition-all ${
                        d.attended ? 'bg-yellow-sunshine text-graphite shadow-xs' : 'bg-cloud-grey text-graphite-muted/40'
                      }`}
                    >
                      {d.day}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'attendance' && (
            <div className="space-y-3">
              <h4 className="font-bold text-graphite uppercase text-[11px] tracking-wider">
                Logged Hardware Turnstile Entries
              </h4>
              <div className="divide-y divide-cloud-border border border-cloud-border rounded-card overflow-hidden bg-white">
                {memberAttendance.length > 0 ? (
                  memberAttendance.map((rec) => (
                    <div key={rec.id} className="p-3 flex items-center justify-between hover:bg-cloud-grey/30">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-graphite text-yellow-sunshine flex items-center justify-center">
                          <Fingerprint className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="font-bold text-graphite">{rec.terminalId}</p>
                          <p className="text-[10px] text-graphite-muted">{rec.timestamp}</p>
                        </div>
                      </div>
                      <Badge status={rec.status} />
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center text-graphite-muted">
                    No hardware gate passes recorded for this session yet.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'billing' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-graphite uppercase text-[11px] tracking-wider">
                  Payment History & Invoices
                </h4>
                <span className="text-[10px] font-bold text-graphite-muted">INR (₹)</span>
              </div>
              <div className="border border-cloud-border rounded-card overflow-hidden bg-white">
                {memberPayments.length > 0 ? (
                  memberPayments.map((pay) => (
                    <div key={pay.id} className="p-3.5 border-b border-cloud-border/70 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-graphite">{pay.planName}</div>
                        <div className="text-[10px] text-graphite-muted">{pay.invoiceNumber} • {pay.date} • {pay.paymentMethod}</div>
                      </div>
                      <div className="text-right">
                        <span className="font-black text-graphite">₹{pay.amount.toLocaleString('en-IN')}</span>
                        <div className="mt-0.5"><Badge status={pay.status} /></div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center text-graphite-muted">
                    No billing transactions found for this account.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'biometric' && (
            <div className="space-y-4">
              <div className="p-5 rounded-card bg-graphite text-white flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-cloud-grey/70">Hardware Token</span>
                  <p className="font-mono text-lg font-black text-yellow-sunshine mt-0.5">{member.biometricId}</p>
                  <p className="text-[11px] text-cloud-grey/60 mt-1">Status: Registered & Verified on 500 DPI Ridge Sensor</p>
                </div>
                <div className="w-14 h-14 rounded-full bg-graphite-light border border-graphite-muted flex items-center justify-center">
                  <Fingerprint className="w-8 h-8 text-yellow-sunshine" />
                </div>
              </div>

              {/* 3-Sample Template Status */}
              <div className="p-4 rounded-xl bg-cloud border border-cloud-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <h5 className="font-bold text-xs text-graphite uppercase tracking-wider">3-Sample Biometric Template</h5>
                  <span className="px-2 py-0.5 rounded-full bg-status-success/15 text-status-success text-[10px] font-black">
                    {member.biometricRegistered ? '3/3 Samples Connected' : 'Pending Enrollment'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2.5 rounded-xl bg-white border border-cloud-border">
                    <span className="text-[10px] font-bold text-graphite-muted block uppercase">Sample 1</span>
                    <span className="text-[11px] font-black text-status-success mt-0.5 block">✓ 99.4% Match</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-cloud-border">
                    <span className="text-[10px] font-bold text-graphite-muted block uppercase">Sample 2</span>
                    <span className="text-[11px] font-black text-status-success mt-0.5 block">✓ 98.9% Match</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-cloud-border">
                    <span className="text-[10px] font-bold text-graphite-muted block uppercase">Sample 3</span>
                    <span className="text-[11px] font-black text-status-success mt-0.5 block">✓ 99.6% Match</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-card bg-white border border-cloud-border space-y-2">
                <h5 className="font-bold text-graphite">Hardware Access Rights</h5>
                <ul className="space-y-1.5 text-graphite text-xs">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-status-success" />
                    Turnstile Alpha (Main Gate) — {member.status === 'active' || member.status === 'expiring' ? 'Unlocked' : 'Locked'}
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-status-success" />
                    Turnstile Beta (Express Lane) — {member.status === 'active' || member.status === 'expiring' ? 'Unlocked' : 'Locked'}
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-status-success" />
                    Locker Room Electronic Solenoid — {member.status === 'active' || member.status === 'expiring' ? 'Authorized' : 'Suspended'}
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-white/80 border-t border-cloud-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            {member.status === 'expired' ? (
              <Button
                size="sm"
                onClick={() => updateMemberStatus(member.id, 'active', 30)}
              >
                Quick Renew (+30 Days)
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => updateMemberStatus(member.id, 'active', 30)}
              >
                Quick Extend +30 Days
              </Button>
            )}
          </div>

          <Button variant="dark" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>

      </div>
    </div>
  );
};
