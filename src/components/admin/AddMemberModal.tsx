import React, { useState, useEffect } from 'react';
import { useGym } from '../../context/GymContext';
import { Member } from '../../types/gym';
import {
  X,
  UserPlus,
  Check,
  KeyRound,
  Eye,
  EyeOff,
  RefreshCw,
  Copy,
  CheckCircle2,
  Fingerprint,
} from 'lucide-react';

function generateSecurePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export const AddMemberModal: React.FC = () => {
  const { isAddMemberOpen, setIsAddMemberOpen, addMember, plans } = useGym();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(true);
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [address, setAddress] = useState('');
  const [planId, setPlanId] = useState(plans[0]?.id || 'plan-monthly');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [biometricId, setBiometricId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [createdMember, setCreatedMember] = useState<Member | null>(null);
  const [copiedCreds, setCopiedCreds] = useState(false);

  useEffect(() => {
    if (isAddMemberOpen) {
      setName('');
      setEmail('');
      setPhone('');
      setPassword(generateSecurePassword());
      setShowPassword(true);
      setDob('');
      setGender('Male');
      setAddress('');
      setPlanId(plans[0]?.id || 'plan-monthly');
      setEmergencyContact('');
      setBiometricId('');
      setCreatedMember(null);
      setCopiedCreds(false);
    }
  }, [isAddMemberOpen, plans]);

  if (!isAddMemberOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !phone.trim() || !password.trim()) return;

    setIsSubmitting(true);
    const selectedPlan = plans.find((p) => p.id === planId) || plans[0];
    const now = new Date();
    const expiry = new Date();
    expiry.setMonth(now.getMonth() + (selectedPlan?.durationMonths || 1));
    const cleanedBioId = biometricId.trim();

    const initialsSeed = encodeURIComponent(name.trim());
    const avatarUrl = `https://ui-avatars.com/api/?name=${initialsSeed}&background=252A30&color=FFD447&bold=true&size=200`;

    const member = await addMember({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      password: password.trim(),
      dob: dob || undefined,
      gender,
      address: address.trim() || undefined,
      avatar: avatarUrl,
      planId: selectedPlan?.id || 'plan-monthly',
      planName: selectedPlan?.name || 'Monthly Plan',
      status: 'active',
      joinDate: now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      expiryDate: expiry.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      biometricId: cleanedBioId,
      biometricRegistered: Boolean(cleanedBioId),
      daysLeft: (selectedPlan?.durationMonths || 1) * 30,
      totalCheckIns: 0,
      emergencyContact: emergencyContact.trim() || 'Not provided',
    });

    setIsSubmitting(false);
    setCreatedMember(member);
  };

  const handleCopyCredentials = () => {
    if (!createdMember) return;
    const text = [
      `Dream Gym — Member Login Credentials`,
      `Name: ${createdMember.name}`,
      `Member ID: ${createdMember.id}`,
      `Login Email: ${createdMember.email}`,
      `Password: ${createdMember.password || ''}`,
      `Plan: ${createdMember.planName} (Valid till ${createdMember.expiryDate})`,
    ].join('\n');
    navigator.clipboard.writeText(text);
    setCopiedCreds(true);
    setTimeout(() => setCopiedCreds(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4 bg-[#252A30]/70 backdrop-blur-xs animate-fade-in text-xs">
      <div className="w-full max-w-[410px] bg-white rounded-3xl shadow-2xl border border-[#DCE3E8] overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#E9ECEF] bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-r from-[#FFD447] to-[#F5C62F] text-[#252A30] flex items-center justify-center font-black shadow-xs">
              <UserPlus className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-black text-[#252A30] leading-tight">
                {createdMember ? 'Member Credentials Ready' : 'Create Genuine Member'}
              </h2>
              <p className="text-[10px] text-[#84909A] font-medium">
                {createdMember
                  ? 'Share these official Dream Gym login details with the member'
                  : 'Admin-created profile & login credentials'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsAddMemberOpen(false)}
            className="p-1.5 rounded-full bg-[#F5F6F2] text-[#252A30]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {createdMember ? (
          <div className="p-4 space-y-4 overflow-y-auto">
            <div className="p-4 rounded-2xl bg-[#36A875]/10 border border-[#36A875]/30 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-[#36A875] shrink-0" />
              <div>
                <p className="font-black text-sm text-[#252A30]">{createdMember.name}</p>
                <p className="text-[11px] text-[#36A875] font-bold">
                  Profile & Login Credentials Created
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#252A30] text-white space-y-2 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-[#A0AEC0]">Member ID:</span>
                <span className="font-black text-[#FFD447]">{createdMember.id}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#A0AEC0]">Login Email:</span>
                <span className="font-bold truncate">{createdMember.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#A0AEC0]">Password:</span>
                <span className="font-black text-[#FFD447]">{createdMember.password}</span>
              </div>
              {createdMember.biometricId && (
                <div className="flex justify-between">
                  <span className="text-[#A0AEC0]">Biometric User ID:</span>
                  <span className="font-bold">{createdMember.biometricId}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyCredentials}
                className="flex-1 py-2.5 rounded-xl bg-[#FFD447] text-[#252A30] font-black text-xs flex items-center justify-center gap-1.5 shadow-sm"
              >
                {copiedCreds ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedCreds ? 'Copied Credentials!' : 'Copy Login Details'}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsAddMemberOpen(false)}
                className="px-4 py-2.5 rounded-xl bg-[#F5F6F2] text-[#252A30] font-bold text-xs border border-[#DCE3E8]"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 space-y-3.5 overflow-y-auto">
            <div className="space-y-2.5">
              <div>
                <label className="block text-[#252A30] font-bold mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="Enter member full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] text-[#252A30] font-semibold focus:outline-none focus:border-[#FFD447] focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-[#252A30] font-bold mb-1">Mobile Number *</label>
                <input
                  type="tel"
                  required
                  placeholder="+91 XXXXX XXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] text-[#252A30] font-semibold focus:outline-none focus:border-[#FFD447] focus:bg-white"
                />
              </div>
            </div>

            {/* Admin-Created Login Credentials */}
            <div className="p-3.5 rounded-2xl bg-[#FFF8E7] border border-[#FFD447]/60 space-y-2.5">
              <span className="font-black text-[11px] text-[#252A30] uppercase tracking-wider flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" />
                Profile Login Credentials (Admin Created)
              </span>

              <div>
                <label className="block text-[#252A30] font-bold mb-1">Login Email *</label>
                <input
                  type="email"
                  required
                  placeholder="member@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white border border-[#DCE3E8] text-[#252A30] font-semibold focus:outline-none focus:border-[#FFD447]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[#252A30] font-bold">Login Password *</label>
                  <button
                    type="button"
                    onClick={() => setPassword(generateSecurePassword())}
                    className="text-[10px] font-black text-[#252A30] flex items-center gap-1 hover:underline"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Generate
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={4}
                    placeholder="Set member login password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-3 pr-9 py-2 rounded-xl bg-white border border-[#DCE3E8] font-mono font-bold text-[#252A30] focus:outline-none focus:border-[#FFD447]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#84909A]"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[#252A30] font-bold mb-1">Membership Plan *</label>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] text-[#252A30] font-bold focus:outline-none focus:border-[#FFD447]"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — ₹{p.price.toLocaleString('en-IN')} / {p.durationMonths} Mo
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[#252A30] font-bold mb-1 flex items-center gap-1">
                <Fingerprint className="w-3.5 h-3.5 text-[#E5B82A]" />
                Biometric Scanner User ID (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. 101 (ID enrolled on Secureye machine)"
                value={biometricId}
                onChange={(e) => setBiometricId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] font-mono font-bold text-[#252A30] focus:outline-none focus:border-[#FFD447] focus:bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[#252A30] font-bold mb-1">Gender</label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] text-[#252A30] font-semibold"
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-[#252A30] font-bold mb-1">Date of Birth</label>
                <input
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] text-[#252A30] font-semibold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[#252A30] font-bold mb-1">Address</label>
                <input
                  type="text"
                  placeholder="Optional"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] text-[#252A30]"
                />
              </div>
              <div>
                <label className="block text-[#252A30] font-bold mb-1">Emergency Contact</label>
                <input
                  type="text"
                  placeholder="Optional"
                  value={emergencyContact}
                  onChange={(e) => setEmergencyContact(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#F5F6F2] border border-[#DCE3E8] text-[#252A30]"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-[#E9ECEF] flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAddMemberOpen(false)}
                className="px-4 py-2.5 rounded-xl bg-[#F5F6F2] text-[#252A30] font-bold text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#FFD447] to-[#F5C62F] text-[#252A30] font-black text-xs shadow-sm flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4 stroke-[2.6]" />
                <span>{isSubmitting ? 'Creating...' : 'Create Profile & Credentials'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
