import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { 
  Member, 
  MemberStatus,
  Plan, 
  Subscription, 
  AttendanceRecord, 
  AccessLog, 
  PaymentRecord, 
  NotificationItem,
  AdminProfile,
  AdminTab,
  BiometricSyncLog
} from '../types/gym';
import { 
  ADMIN_PROFILE, 
  INITIAL_MEMBERS, 
  INITIAL_PLANS, 
  INITIAL_SUBSCRIPTIONS, 
  INITIAL_ATTENDANCE, 
  INITIAL_ACCESS_LOGS, 
  INITIAL_PAYMENTS, 
  INITIAL_NOTIFICATIONS 
} from '../data/initialData';
import { db } from '../firebase';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  limit
} from 'firebase/firestore';
import {
  CloudBiometricDeviceState,
  buildAdminWsUrl,
  fetchBiometricStatus,
  syncMembersToBiometricBackend,
} from '../services/biometricCloudClient';
import { BIOMETRIC_CONFIG } from '../config/biometricConfig';

function normalizeBiometricId(val?: string | null): string {
  const s = String(val || '').trim().toLowerCase();
  if (!s) return '';
  if (/^\d+$/.test(s)) return String(parseInt(s, 10));
  return s;
}

export interface LiveBiometricScanBanner {
  id: string;
  status: 'granted' | 'denied';
  memberId: string;
  memberName: string;
  planName?: string;
  biometricUserId: string;
  verifyMode: string;
  reason: string;
  timestamp: string;
  deviceSn: string;
  avatar?: string;
}

const STORAGE_KEYS = {
  members: 'dreamgym_members_v1',
  plans: 'dreamgym_plans_v1',
  subscriptions: 'dreamgym_subscriptions_v1',
  payments: 'dreamgym_payments_v1',
};

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(fallback) && !Array.isArray(parsed) ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export interface AssignMemberPlanOptions {
  planId: string;
  planName: string;
  status: MemberStatus;
  startDate: string;
  expiryDate: string;
  daysLeft: number;
  recordPaymentEntry?: boolean;
  paymentMethod?: string;
  amount?: number;
}

interface GymContextType {
  // Navigation & UI state
  currentTab: AdminTab;
  setCurrentTab: (tab: AdminTab) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  adminProfile: AdminProfile;
  setAdminProfile: React.Dispatch<React.SetStateAction<AdminProfile>>;
  isAddMemberOpen: boolean;
  setIsAddMemberOpen: (open: boolean) => void;

  // Collections
  members: Member[];
  plans: Plan[];
  subscriptions: Subscription[];
  attendance: AttendanceRecord[];
  accessLogs: AccessLog[];
  payments: PaymentRecord[];
  notifications: NotificationItem[];
  biometricSyncLogs: BiometricSyncLog[];

  // Live Secureye Cloud WebSocket Telemetry (App-Wide)
  biometricBackendUrl: string;
  biometricWsStreamStatus: 'connected' | 'connecting' | 'disconnected';
  secureyeDevice: CloudBiometricDeviceState | null;
  liveScanBanner: LiveBiometricScanBanner | null;
  dismissLiveScanBanner: () => void;

  // Selected Member
  selectedMember: Member | null;
  setSelectedMember: (member: Member | null) => void;

  // Actions: Members
  addMember: (memberData: Omit<Member, 'id'>) => Promise<Member>;
  updateMember: (memberId: string, memberData: Partial<Member>) => Promise<void>;
  deleteMember: (memberId: string) => Promise<void>;
  assignMemberPlan: (memberId: string, options: AssignMemberPlanOptions) => Promise<void>;

  // Actions: Plans
  addPlan: (planData: Omit<Plan, 'id'>) => Promise<Plan>;
  updatePlan: (planId: string, planData: Partial<Plan>) => Promise<void>;
  deletePlan: (planId: string) => Promise<void>;

  // Actions: Subscriptions
  createSubscription: (memberId: string, planId: string, paymentMethod?: string) => Promise<Subscription>;
  renewSubscription: (subscriptionId: string) => Promise<void>;
  deactivateSubscription: (subscriptionId: string) => Promise<void>;

  // Actions: Payments
  recordPayment: (paymentData: Omit<PaymentRecord, 'id' | 'invoiceNumber'>) => Promise<PaymentRecord>;

  // Actions: Biometric (Hardware Mapping & Simulation Mode)
  linkMemberBiometricId: (memberId: string, biometricId: string) => Promise<{ ok: boolean; error?: string }>;
  saveBiometricEnrollment: (memberId: string, token: string, samples: { sample1: boolean; sample2: boolean; sample3: boolean }) => Promise<void>;
  deleteBiometricEnrollment: (memberId: string) => Promise<void>;

  // Actions: Live Access Monitoring
  simulateAccessScan: (memberIdOrToken: string) => Promise<{ status: 'granted' | 'denied' | 'unknown'; member?: Member; message: string; log: AccessLog }>;

  // Sound & Notifications
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  playAccessTone: (type: 'granted' | 'denied' | 'beep') => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;

  // Database Sync
  firebaseConnected: boolean;
  isSyncing: boolean;
  seedFirestoreData: () => Promise<void>;

  // Multi-view & Member Compatibility
  activeView: 'admin' | 'member' | 'biometric';
  setActiveView: (view: 'admin' | 'member' | 'biometric') => void;
  loginMember: (email: string, password?: string) => { success: boolean; error?: string; member?: Member };
  updateMemberStatus: (memberId: string, status: any, daysToAdd?: number) => Promise<void>;
  updateMemberBiometric: (memberId: string, tokenOrRegistered: any) => Promise<any>;
  recordBiometricScan: (biometricId: string) => Promise<{ status: 'granted' | 'denied' | 'unknown'; member?: Member; message: string }>;
  activateMemberPlan: (memberId: string, planId: string, paymentMethod?: string) => Promise<void>;
}

const GymContext = createContext<GymContextType | undefined>(undefined);

export const GymProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentTab, setCurrentTab] = useState<AdminTab>('dashboard');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [adminProfile, setAdminProfile] = useState<AdminProfile>(ADMIN_PROFILE);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState<boolean>(false);

  const [members, setMembers] = useState<Member[]>(() => loadFromStorage(STORAGE_KEYS.members, INITIAL_MEMBERS));
  const [plans, setPlans] = useState<Plan[]>(() => loadFromStorage(STORAGE_KEYS.plans, INITIAL_PLANS));
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(() => loadFromStorage(STORAGE_KEYS.subscriptions, INITIAL_SUBSCRIPTIONS));
  const [attendance, setAttendance] = useState<AttendanceRecord[]>(INITIAL_ATTENDANCE);
  const [accessLogs, setAccessLogs] = useState<AccessLog[]>(INITIAL_ACCESS_LOGS);
  const [payments, setPayments] = useState<PaymentRecord[]>(() => loadFromStorage(STORAGE_KEYS.payments, INITIAL_PAYMENTS));
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);
  const [biometricSyncLogs, setBiometricSyncLogs] = useState<BiometricSyncLog[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(() => loadFromStorage(STORAGE_KEYS.members, INITIAL_MEMBERS)[0] || null);

  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [firebaseConnected, setFirebaseConnected] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // App-wide live Secureye Cloud WebSocket state (built directly into the app)
  const biometricBackendUrl = BIOMETRIC_CONFIG.serverUrl;
  const [biometricWsStreamStatus, setBiometricWsStreamStatus] = useState<
    'connected' | 'connecting' | 'disconnected'
  >('disconnected');
  const [secureyeDevice, setSecureyeDevice] = useState<CloudBiometricDeviceState | null>(null);
  const [liveScanBanner, setLiveScanBanner] = useState<LiveBiometricScanBanner | null>(null);
  const dismissLiveScanBanner = () => setLiveScanBanner(null);

  const membersRef = useRef<Member[]>(members);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  // Auto-sync member subscription expiry dates to the Secureye WebSocket server
  // so expired members are automatically declined on scan and blocked on the terminal
  useEffect(() => {
    if (!biometricBackendUrl || members.length === 0) return;
    const timer = setTimeout(() => {
      syncMembersToBiometricBackend(
        biometricBackendUrl,
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
        BIOMETRIC_CONFIG.apiToken
      ).catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [members, biometricBackendUrl]);

  const soundEnabledRef = useRef<boolean>(soundEnabled);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // Persistent App-Wide WebSocket subscription to wss://dream-gym-1.onrender.com/ws/admin
  useEffect(() => {
    if (typeof window === 'undefined' || !biometricBackendUrl) return;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let bannerTimer: ReturnType<typeof setTimeout> | null = null;

    const triggerTone = (type: 'granted' | 'denied') => {
      if (!soundEnabledRef.current) return;
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        if (type === 'granted') {
          osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
          osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.08);
          osc.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.16);
          gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.35);
        } else {
          osc.frequency.setValueAtTime(220, audioCtx.currentTime);
          osc.frequency.setValueAtTime(160, audioCtx.currentTime + 0.1);
          gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.35);
        }
      } catch {}
    };

    const handleIncomingWsAttendance = (rawEvt: any) => {
      const bioId = String(rawEvt?.biometricUserId || '').trim();
      const normBioId = normalizeBiometricId(bioId);
      const deviceSn = String(rawEvt?.deviceSn || BIOMETRIC_CONFIG.defaultTerminal.serialNumber);
      const verifyMode = String(rawEvt?.verifyMode || 'Fingerprint');
      const nowTime = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
      const todayDate = new Date().toISOString().split('T')[0];

      // Match biometricUserId against Dream Gym members (normalized numeric ID or member ID)
      const matched = normBioId
        ? membersRef.current.find(
            (m) =>
              (m.biometricId && normalizeBiometricId(m.biometricId) === normBioId) ||
              normalizeBiometricId(m.id) === normBioId
          )
        : undefined;

      let status: 'granted' | 'denied' = rawEvt?.status === 'granted' ? 'granted' : 'denied';
      let reason = rawEvt?.reason || 'Biometric User ID not linked to any Dream Gym member.';
      let memberId = rawEvt?.memberId || (matched ? matched.id : `UNLINKED:${bioId}`);
      let memberName = rawEvt?.memberName || (matched ? matched.name : `Unlinked User (${bioId})`);
      let avatar =
        matched?.avatar ||
        rawEvt?.avatar ||
        'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80';

      // Re-validate locally against live Dream Gym members list when backend ran without Firestore creds
      if (matched) {
        memberId = matched.id;
        memberName = matched.name;
        avatar = matched.avatar;
        const expiry = matched.expiryDate ? new Date(matched.expiryDate) : null;
        if (expiry && !Number.isNaN(expiry.getTime())) {
          expiry.setHours(23, 59, 59, 999);
        }
        const isExpired =
          matched.status === 'expired' ||
          (expiry && !Number.isNaN(expiry.getTime()) && expiry.getTime() < Date.now());
        if (matched.status === 'inactive') {
          status = 'denied';
          reason = 'Membership account is inactive / suspended.';
        } else if (isExpired) {
          status = 'denied';
          reason = `Membership expired on ${matched.expiryDate}.`;
        } else if (matched.status === 'pending') {
          status = 'denied';
          reason = 'Membership payment pending activation.';
        } else {
          status = 'granted';
          reason = `Active ${matched.planName} verified via Secureye WebSocket (${verifyMode}).`;
        }
      }

      const recordId = rawEvt?.id || `att-ws-${Date.now()}`;
      const newAttendance: AttendanceRecord = {
        id: recordId,
        memberId,
        memberName,
        avatar,
        checkInDate: rawEvt?.checkInDate || todayDate,
        checkInTime: rawEvt?.checkInTime || nowTime,
        timestamp: rawEvt?.timestamp || `${todayDate} ${nowTime}`,
        method: 'biometric',
        verifyMode,
        status,
        reason,
        terminalId: rawEvt?.terminalId || `Secureye WS (${deviceSn})`,
        deviceSn,
        biometricUserId: bioId,
        source: 'secureye_websocket',
      };

      const newAccessLog: AccessLog = {
        id: `log-${recordId}`,
        memberId,
        memberName,
        avatar,
        time: rawEvt?.checkInTime || nowTime,
        status,
        reason,
        terminalId: newAttendance.terminalId,
        deviceSn,
        biometricUserId: bioId,
        source: 'secureye_websocket',
      };

      setAttendance((prev) =>
        prev.some((a) => a.id === recordId) ? prev : [newAttendance, ...prev]
      );
      setAccessLogs((prev) =>
        prev.some((l) => l.id === newAccessLog.id) ? prev : [newAccessLog, ...prev]
      );
      setNotifications((prev) => [
        {
          id: `notif-ws-${Date.now()}`,
          title: status === 'granted' ? 'Biometric Check-In Granted' : 'Biometric Check-In Denied',
          message: `${memberName} (Bio ID: ${bioId}) — ${reason}`,
          date: 'Today',
          time: nowTime,
          category: status === 'granted' ? 'membership' : 'alert',
          isRead: false,
        },
        ...prev,
      ]);

      if (matched && status === 'granted') {
        const updatedCount = (matched.totalCheckIns || 0) + 1;
        setMembers((prev) =>
          prev.map((m) =>
            m.id === matched.id
              ? { ...m, totalCheckIns: updatedCount, lastCheckIn: `${todayDate} ${nowTime}` }
              : m
          )
        );
        setDoc(
          doc(db, 'members', matched.id),
          { totalCheckIns: updatedCount, lastCheckIn: `${todayDate} ${nowTime}` },
          { merge: true }
        ).catch(() => {});
      }

      triggerTone(status);

      setLiveScanBanner({
        id: recordId,
        status,
        memberId,
        memberName,
        planName: matched?.planName,
        biometricUserId: bioId,
        verifyMode,
        reason,
        timestamp: newAttendance.timestamp,
        deviceSn,
        avatar,
      });

      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        if (!cancelled) setLiveScanBanner(null);
      }, 9000);
    };

    // Initial HTTP status probe (also wakes Render free instance immediately on page load)
    fetchBiometricStatus(biometricBackendUrl, BIOMETRIC_CONFIG.apiToken).then((res) => {
      if (!cancelled && res.ok && res.device) {
        setSecureyeDevice(res.device);
      }
    });

    const connectWs = () => {
      if (cancelled) return;
      const adminWsUrl = buildAdminWsUrl(biometricBackendUrl, BIOMETRIC_CONFIG.apiToken);
      if (!adminWsUrl) return;

      setBiometricWsStreamStatus('connecting');
      try {
        ws = new WebSocket(adminWsUrl);
      } catch {
        setBiometricWsStreamStatus('disconnected');
        reconnectTimer = setTimeout(connectWs, 5000);
        return;
      }

      ws.onopen = () => {
        if (!cancelled) setBiometricWsStreamStatus('connected');
      };

      ws.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'welcome' && Array.isArray(msg.data?.devices) && msg.data.devices[0]) {
            setSecureyeDevice(msg.data.devices[0]);
          } else if (msg.type === 'device_status' && msg.data) {
            setSecureyeDevice(msg.data);
          } else if (msg.type === 'attendance_event' && msg.data) {
            handleIncomingWsAttendance(msg.data);
          }
        } catch {}
      };

      ws.onclose = () => {
        if (cancelled) return;
        setBiometricWsStreamStatus('disconnected');
        reconnectTimer = setTimeout(connectWs, 5000);
      };

      ws.onerror = () => {
        if (!cancelled) setBiometricWsStreamStatus('disconnected');
      };
    };

    connectWs();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (bannerTimer) clearTimeout(bannerTimer);
      if (ws) {
        try { ws.close(); } catch {}
      }
    };
  }, [biometricBackendUrl]);

  // Real-time Firestore subscriptions for Secureye biometric attendance, access logs, and sync logs
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    try {
      const attQuery = query(collection(db, 'attendance'), orderBy('createdAt', 'desc'), limit(100));
      unsubs.push(
        onSnapshot(
          attQuery,
          (snap) => {
            if (snap.empty) return;
            const liveRows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AttendanceRecord, 'id'>) }));
            setAttendance((prev) => {
              const seen = new Set(liveRows.map((r) => r.id));
              const localOnly = prev.filter((r) => !seen.has(r.id));
              return [...liveRows, ...localOnly];
            });
            setFirebaseConnected(true);
          },
          () => {
            // Keep working gracefully with local state if Firestore rules require auth
          }
        )
      );
    } catch {}

    try {
      const logsQuery = query(collection(db, 'access_logs'), orderBy('createdAt', 'desc'), limit(60));
      unsubs.push(
        onSnapshot(
          logsQuery,
          (snap) => {
            if (snap.empty) return;
            const liveLogs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AccessLog, 'id'>) }));
            setAccessLogs((prev) => {
              const seen = new Set(liveLogs.map((l) => l.id));
              const localOnly = prev.filter((l) => !seen.has(l.id));
              return [...liveLogs, ...localOnly];
            });
          },
          () => {}
        )
      );
    } catch {}

    try {
      const syncQuery = query(collection(db, 'biometric_sync_logs'), orderBy('createdAt', 'desc'), limit(50));
      unsubs.push(
        onSnapshot(
          syncQuery,
          (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BiometricSyncLog, 'id'>) }));
            setBiometricSyncLogs(rows);
          },
          () => {}
        )
      );
    } catch {}

    return () => {
      unsubs.forEach((u) => {
        try { u(); } catch {}
      });
    };
  }, []);

  // Persist collections to localStorage and sync across tabs (Admin <-> Member App)
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEYS.members, JSON.stringify(members)); } catch {}
  }, [members]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEYS.plans, JSON.stringify(plans)); } catch {}
  }, [plans]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEYS.subscriptions, JSON.stringify(subscriptions)); } catch {}
  }, [subscriptions]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEYS.payments, JSON.stringify(payments)); } catch {}
  }, [payments]);

  useEffect(() => {
    const handleStorageSync = (e: StorageEvent) => {
      if (!e.newValue) return;
      try {
        if (e.key === STORAGE_KEYS.members) {
          setMembers(JSON.parse(e.newValue));
        } else if (e.key === STORAGE_KEYS.plans) {
          setPlans(JSON.parse(e.newValue));
        } else if (e.key === STORAGE_KEYS.subscriptions) {
          setSubscriptions(JSON.parse(e.newValue));
        } else if (e.key === STORAGE_KEYS.payments) {
          setPayments(JSON.parse(e.newValue));
        }
      } catch {}
    };
    window.addEventListener('storage', handleStorageSync);
    return () => window.removeEventListener('storage', handleStorageSync);
  }, []);

  // Determine active view from URL path, query params, or hash
  const getInitialView = (): 'admin' | 'member' | 'biometric' => {
    if (typeof window === 'undefined') return 'admin';
    const path = window.location.pathname.toLowerCase();
    const search = new URLSearchParams(window.location.search).get('view')?.toLowerCase();
    const hash = window.location.hash.toLowerCase();

    if (path.includes('/member') || search === 'member' || hash.includes('member')) {
      return 'member';
    }
    if (path.includes('/biometric') || search === 'biometric' || hash.includes('biometric')) {
      return 'biometric';
    }
    return 'admin';
  };

  const [activeView, setActiveViewState] = useState<'admin' | 'member' | 'biometric'>(getInitialView);

  const setActiveView = (view: 'admin' | 'member' | 'biometric') => {
    setActiveViewState(view);
    if (typeof window !== 'undefined') {
      const targetPath = `/${view}`;
      if (window.location.pathname !== targetPath) {
        window.history.pushState({}, '', targetPath);
      }
    }
  };

  // Sync with browser navigation (popstate & hashchange)
  useEffect(() => {
    const handleLocationChange = () => {
      setActiveViewState(getInitialView());
    };

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  const loginMember = (email: string, _password?: string) => {
    const member = members.find(m => m.email.toLowerCase() === email.trim().toLowerCase());
    if (!member) {
      return { success: false, error: 'No member found with this email' };
    }
    setSelectedMember(member);
    return { success: true, member };
  };

  const updateMemberStatus = async (memberId: string, status: any, daysToAdd?: number) => {
    setMembers(prev => prev.map(m => {
      if (m.id === memberId) {
        return {
          ...m,
          status,
          daysLeft: daysToAdd !== undefined ? (m.daysLeft || 0) + daysToAdd : m.daysLeft
        };
      }
      return m;
    }));
  };

  const updateMemberBiometric = async (memberId: string, tokenOrRegistered: string | boolean) => {
    const token = typeof tokenOrRegistered === 'string' ? tokenOrRegistered : `BIO-FP-${Date.now().toString().slice(-4)}`;
    const target = members.find(m => m.id === memberId);
    if (target) {
      const updated = { ...target, biometricId: token, biometricRegistered: true };
      await updateMember(memberId, { biometricId: token, biometricRegistered: true });
      return { success: true, member: updated };
    }
    return { success: false };
  };

  const recordBiometricScan = async (biometricId: string) => {
    const res = await simulateAccessScan(biometricId);
    return {
      status: res.status,
      member: res.member,
      message: res.message
    };
  };

  const activateMemberPlan = async (memberId: string, planId: string, paymentMethod = 'Razorpay UPI') => {
    await createSubscription(memberId, planId, paymentMethod);
  };

  // Sound Synthesizer
  const playAccessTone = (type: 'granted' | 'denied' | 'beep') => {
    if (!soundEnabled || typeof window === 'undefined') return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'beep') {
        osc.frequency.setValueAtTime(750, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.08);
      } else if (type === 'granted') {
        osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
        osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.08); // E5
        osc.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.16); // G5
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
      } else if (type === 'denied') {
        osc.frequency.setValueAtTime(220, audioCtx.currentTime);
        osc.frequency.setValueAtTime(160, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
      }
    } catch {}
  };

  // Add Member
  const addMember = async (memberData: Omit<Member, 'id'>): Promise<Member> => {
    // Generate next serial member ID: GYM0349...
    const count = members.length + 341;
    const newId = `GYM0${count + 1}`;
    const newMember: Member = {
      ...memberData,
      id: newId
    };

    setMembers(prev => [newMember, ...prev]);

    // Create initial subscription if plan assigned
    if (memberData.planId) {
      const plan = plans.find(p => p.id === memberData.planId) || plans[0];
      const newSub: Subscription = {
        id: `SUB-${Date.now().toString().slice(-4)}`,
        memberId: newId,
        memberName: newMember.name,
        memberAvatar: newMember.avatar,
        planId: plan.id,
        planName: plan.name,
        startDate: memberData.joinDate,
        expiryDate: memberData.expiryDate,
        amount: plan.price,
        paymentStatus: memberData.status === 'active' ? 'paid' : 'pending',
        status: memberData.status
      };
      setSubscriptions(prev => [newSub, ...prev]);

      // Record payment if active
      if (memberData.status === 'active') {
        const newPay: PaymentRecord = {
          id: `PAY-${Date.now().toString().slice(-4)}`,
          memberId: newId,
          memberName: newMember.name,
          planName: `${plan.name} (${plan.durationMonths} Mo)`,
          amount: plan.price,
          date: memberData.joinDate,
          status: 'completed',
          paymentMethod: 'Razorpay UPI',
          invoiceNumber: `INV-2026-${Math.floor(1000 + Math.random() * 9000)}`
        };
        setPayments(prev => [newPay, ...prev]);
      }
    }

    // Add notification
    const newNotif: NotificationItem = {
      id: `notif-${Date.now()}`,
      title: 'New Member Registered',
      message: `${newMember.name} (${newMember.id}) enrolled in ${newMember.planName}.`,
      date: 'Today',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      category: 'membership',
      isRead: false
    };
    setNotifications(prev => [newNotif, ...prev]);

    try {
      await setDoc(doc(db, 'members', newId), newMember);
    } catch {}

    return newMember;
  };

  // Update Member
  const updateMember = async (memberId: string, memberData: Partial<Member>) => {
    const existing = members.find(m => m.id === memberId);
    const merged = existing ? { ...existing, ...memberData } : memberData;
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, ...memberData } : m));
    if (selectedMember?.id === memberId) {
      setSelectedMember(prev => prev ? { ...prev, ...memberData } : null);
    }
    try {
      await setDoc(doc(db, 'members', memberId), merged, { merge: true });
    } catch {}
  };

  // Link a Gym Member to their exact Secureye Biometric Machine User ID (e.g. "101")
  const linkMemberBiometricId = async (
    memberId: string,
    biometricId: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const cleanId = biometricId.trim();
    if (!cleanId) {
      return { ok: false, error: 'Enter the numeric User ID enrolled on the Secureye machine (e.g. 1, 101).' };
    }
    const conflict = members.find(
      (m) => m.id !== memberId && (m.biometricId || '').trim().toLowerCase() === cleanId.toLowerCase()
    );
    if (conflict) {
      return {
        ok: false,
        error: `Secureye User ID "${cleanId}" is already assigned to ${conflict.name} (${conflict.id}).`,
      };
    }

    await updateMember(memberId, {
      biometricId: cleanId,
      biometricRegistered: true,
      biometricEnrolled: true,
    });
    return { ok: true };
  };

  // Delete Member
  const deleteMember = async (memberId: string) => {
    setMembers(prev => prev.filter(m => m.id !== memberId));
    setSubscriptions(prev => prev.filter(s => s.memberId !== memberId));
    if (selectedMember?.id === memberId) {
      setSelectedMember(null);
    }
    try {
      await deleteDoc(doc(db, 'members', memberId));
    } catch {}
  };

  // Manual Admin Membership Assignment (reflected immediately in member profile)
  const assignMemberPlan = async (memberId: string, options: AssignMemberPlanOptions) => {
    const member = members.find(m => m.id === memberId);
    const matchedPlan = plans.find(p => p.id === options.planId);

    const updatedFields: Partial<Member> = {
      planId: options.planId,
      planName: options.planName,
      status: options.status,
      startDate: options.startDate,
      expiryDate: options.expiryDate,
      daysLeft: options.daysLeft
    };

    await updateMember(memberId, updatedFields);

    // Sync subscriptions collection
    if (options.planId) {
      const amount = options.amount !== undefined ? options.amount : (matchedPlan?.price || 0);
      setSubscriptions(prev => {
        const existingIdx = prev.findIndex(s => s.memberId === memberId);
        const subRecord: Subscription = {
          id: existingIdx >= 0 ? prev[existingIdx].id : `SUB-${Date.now().toString().slice(-4)}`,
          memberId,
          memberName: member?.name || 'Member',
          memberAvatar: member?.avatar,
          planId: options.planId,
          planName: options.planName,
          startDate: options.startDate,
          expiryDate: options.expiryDate,
          amount,
          paymentStatus: options.status === 'active' || options.status === 'expiring' ? 'paid' : 'pending',
          status: options.status
        };
        if (existingIdx >= 0) {
          const next = [...prev];
          next[existingIdx] = subRecord;
          return next;
        }
        return [subRecord, ...prev];
      });

      if (options.recordPaymentEntry && amount > 0) {
        await recordPayment({
          memberId,
          memberName: member?.name || 'Member',
          planName: matchedPlan ? `${matchedPlan.name} (${matchedPlan.durationMonths} Mo)` : options.planName,
          amount,
          date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          status: 'completed',
          paymentMethod: options.paymentMethod || 'Cash (Admin Desk)'
        });
      }
    }

    const newNotif: NotificationItem = {
      id: `notif-${Date.now()}`,
      title: 'Membership Plan Updated',
      message: `${member?.name || memberId} assigned to ${options.planName} (${options.status}) by Admin.`,
      date: 'Today',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      category: 'membership',
      isRead: false
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  // Add Plan
  const addPlan = async (planData: Omit<Plan, 'id'>): Promise<Plan> => {
    const newId = `plan-${Date.now().toString().slice(-4)}`;
    const newPlan: Plan = {
      ...planData,
      id: newId
    };
    setPlans(prev => [...prev, newPlan]);
    try {
      await setDoc(doc(db, 'plans', newId), newPlan);
    } catch {}
    return newPlan;
  };

  // Update Plan
  const updatePlan = async (planId: string, planData: Partial<Plan>) => {
    setPlans(prev => prev.map(p => p.id === planId ? { ...p, ...planData } : p));
    if (planData.name) {
      setMembers(prev => prev.map(m => m.planId === planId ? { ...m, planName: planData.name! } : m));
      setSubscriptions(prev => prev.map(s => s.planId === planId ? { ...s, planName: planData.name! } : s));
    }
    try {
      await setDoc(doc(db, 'plans', planId), planData, { merge: true });
    } catch {}
  };

  // Delete Plan
  const deletePlan = async (planId: string) => {
    setPlans(prev => prev.filter(p => p.id !== planId));
    try {
      await deleteDoc(doc(db, 'plans', planId));
    } catch {}
  };

  // Create Subscription
  const createSubscription = async (memberId: string, planId: string, paymentMethod = 'Razorpay'): Promise<Subscription> => {
    const member = members.find(m => m.id === memberId);
    const plan = plans.find(p => p.id === planId) || plans[0];
    const now = new Date();
    const expiry = new Date();
    expiry.setMonth(now.getMonth() + plan.durationMonths);

    const startStr = now.toISOString().split('T')[0];
    const expiryStr = expiry.toISOString().split('T')[0];

    const newSub: Subscription = {
      id: `SUB-${Date.now().toString().slice(-4)}`,
      memberId,
      memberName: member?.name || 'Member',
      memberAvatar: member?.avatar,
      planId: plan.id,
      planName: plan.name,
      startDate: startStr,
      expiryDate: expiryStr,
      amount: plan.price,
      paymentStatus: 'paid',
      status: 'active'
    };

    setSubscriptions(prev => [newSub, ...prev]);

    // Update member
    await updateMember(memberId, {
      planId: plan.id,
      planName: plan.name,
      status: 'active',
      expiryDate: expiryStr,
      daysLeft: plan.durationMonths * 30
    });

    // Record Payment
    await recordPayment({
      memberId,
      memberName: member?.name || 'Member',
      planName: `${plan.name} (${plan.durationMonths} Mo)`,
      amount: plan.price,
      date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      status: 'completed',
      paymentMethod
    });

    return newSub;
  };

  // Renew Subscription
  const renewSubscription = async (subscriptionId: string) => {
    const sub = subscriptions.find(s => s.id === subscriptionId);
    if (!sub) return;

    const plan = plans.find(p => p.id === sub.planId) || plans[0];
    const now = new Date();
    const expiry = new Date();
    expiry.setMonth(now.getMonth() + plan.durationMonths);
    const expiryStr = expiry.toISOString().split('T')[0];

    setSubscriptions(prev => prev.map(s => s.id === subscriptionId ? {
      ...s,
      expiryDate: expiryStr,
      status: 'active',
      paymentStatus: 'paid'
    } : s));

    await updateMember(sub.memberId, {
      status: 'active',
      expiryDate: expiryStr,
      daysLeft: plan.durationMonths * 30
    });

    await recordPayment({
      memberId: sub.memberId,
      memberName: sub.memberName,
      planName: `${sub.planName} (Renewal)`,
      amount: sub.amount,
      date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      status: 'completed',
      paymentMethod: 'Razorpay UPI'
    });

    const newNotif: NotificationItem = {
      id: `notif-${Date.now()}`,
      title: 'Subscription Renewed',
      message: `${sub.memberName} renewed ${sub.planName} (+${plan.durationMonths} Months).`,
      date: 'Today',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      category: 'membership',
      isRead: false
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  // Deactivate Subscription
  const deactivateSubscription = async (subscriptionId: string) => {
    const sub = subscriptions.find(s => s.id === subscriptionId);
    if (!sub) return;

    setSubscriptions(prev => prev.map(s => s.id === subscriptionId ? { ...s, status: 'inactive' } : s));
    await updateMember(sub.memberId, { status: 'inactive' });
  };

  // Record Payment
  const recordPayment = async (paymentData: Omit<PaymentRecord, 'id' | 'invoiceNumber'>): Promise<PaymentRecord> => {
    const newPayment: PaymentRecord = {
      ...paymentData,
      id: `PAY-${Date.now().toString().slice(-4)}`,
      invoiceNumber: `INV-2026-${Math.floor(1000 + Math.random() * 9000)}`
    };

    setPayments(prev => [newPayment, ...prev]);

    try {
      await setDoc(doc(db, 'payments', newPayment.id), newPayment);
    } catch {}

    return newPayment;
  };

  // Biometric Enrollment (Simulation Mode)
  const saveBiometricEnrollment = async (
    memberId: string, 
    token: string, 
    samples: { sample1: boolean; sample2: boolean; sample3: boolean }
  ) => {
    await updateMember(memberId, {
      biometricId: token,
      biometricRegistered: true,
      biometricSamples: samples
    });

    const member = members.find(m => m.id === memberId);
    const newNotif: NotificationItem = {
      id: `notif-${Date.now()}`,
      title: 'Biometric Enrolled (Simulated)',
      message: `3 fingerprint samples captured and verified for ${member?.name || 'Member'}. Token: ${token}.`,
      date: 'Today',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      category: 'membership',
      isRead: false
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  const deleteBiometricEnrollment = async (memberId: string) => {
    await updateMember(memberId, {
      biometricId: 'BIO-FP-UNREGISTERED',
      biometricRegistered: false,
      biometricSamples: { sample1: false, sample2: false, sample3: false }
    });
  };

  // Live Access Scan Verification
  const simulateAccessScan = async (memberIdOrToken: string): Promise<{ 
    status: 'granted' | 'denied' | 'unknown'; 
    member?: Member; 
    message: string; 
    log: AccessLog 
  }> => {
    playAccessTone('beep');
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Find member by ID or biometricId
    const member = members.find(m => 
      m.id.toLowerCase() === memberIdOrToken.trim().toLowerCase() ||
      m.biometricId.toLowerCase() === memberIdOrToken.trim().toLowerCase()
    );

    if (!member) {
      playAccessTone('denied');
      const deniedLog: AccessLog = {
        id: `log-${Date.now()}`,
        memberId: 'UNKNOWN',
        memberName: 'Unrecognized Fingerprint',
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80',
        time: timeStr,
        status: 'denied',
        reason: 'Fingerprint token not enrolled in Dream Gym database',
        terminalId: 'Turnstile Gateway #01 (Alpha)'
      };
      setAccessLogs(prev => [deniedLog, ...prev]);
      return { status: 'unknown', message: 'Unknown member: Access Denied', log: deniedLog };
    }

    if (!member.biometricRegistered) {
      playAccessTone('denied');
      const deniedLog: AccessLog = {
        id: `log-${Date.now()}`,
        memberId: member.id,
        memberName: member.name,
        avatar: member.avatar,
        time: timeStr,
        status: 'denied',
        reason: 'Biometric profile not enrolled',
        terminalId: 'Turnstile Gateway #01 (Alpha)'
      };
      setAccessLogs(prev => [deniedLog, ...prev]);
      return { status: 'denied', member, message: 'Biometric not registered: Access Denied', log: deniedLog };
    }

    if (member.status === 'expired' || member.status === 'inactive') {
      playAccessTone('denied');
      const deniedLog: AccessLog = {
        id: `log-${Date.now()}`,
        memberId: member.id,
        memberName: member.name,
        avatar: member.avatar,
        time: timeStr,
        status: 'denied',
        reason: member.status === 'expired' ? `Membership expired on ${member.expiryDate}` : 'Account suspended/inactive',
        terminalId: 'Turnstile Gateway #01 (Alpha)'
      };
      setAccessLogs(prev => [deniedLog, ...prev]);
      return { status: 'denied', member, message: `Access Denied: ${deniedLog.reason}`, log: deniedLog };
    }

    // Access Granted
    playAccessTone('granted');
    const grantedLog: AccessLog = {
      id: `log-${Date.now()}`,
      memberId: member.id,
      memberName: member.name,
      avatar: member.avatar,
      time: timeStr,
      status: 'granted',
      terminalId: 'Turnstile Gateway #01 (Alpha)'
    };
    setAccessLogs(prev => [grantedLog, ...prev]);

    // Create real attendance record
    const newAtt: AttendanceRecord = {
      id: `att-${Date.now()}`,
      memberId: member.id,
      memberName: member.name,
      avatar: member.avatar,
      checkInDate: new Date().toISOString().split('T')[0],
      checkInTime: timeStr,
      timestamp: `Today at ${timeStr}`,
      method: 'biometric',
      status: 'granted',
      terminalId: 'Turnstile Gateway #01 (Alpha)'
    };
    setAttendance(prev => [newAtt, ...prev]);

    // Update member's checkin count and last seen
    await updateMember(member.id, {
      totalCheckIns: (member.totalCheckIns || 0) + 1,
      lastCheckIn: `Today at ${timeStr}`
    });

    return { status: 'granted', member, message: `Access Granted: Welcome, ${member.name}!`, log: grantedLog };
  };

  // Notification management
  const markNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const clearNotifications = () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  // Seed Firestore
  const seedFirestoreData = async () => {
    setIsSyncing(true);
    try {
      for (const m of members) await setDoc(doc(db, 'members', m.id), m);
      for (const p of plans) await setDoc(doc(db, 'plans', p.id), p);
      for (const s of subscriptions) await setDoc(doc(db, 'subscriptions', s.id), s);
      for (const a of attendance) await setDoc(doc(db, 'attendance', a.id), a);
      for (const l of accessLogs) await setDoc(doc(db, 'access_logs', l.id), l);
      for (const pay of payments) await setDoc(doc(db, 'payments', pay.id), pay);
      for (const n of notifications) await setDoc(doc(db, 'notifications', n.id), n);
      setFirebaseConnected(true);
    } catch (e: any) {
      console.warn('Firestore seeding:', e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <GymContext.Provider value={{
      currentTab,
      setCurrentTab,
      searchQuery,
      setSearchQuery,
      adminProfile,
      setAdminProfile,
      isAddMemberOpen,
      setIsAddMemberOpen,
      members,
      plans,
      subscriptions,
      attendance,
      accessLogs,
      payments,
      notifications,
      biometricSyncLogs,
      biometricBackendUrl,
      biometricWsStreamStatus,
      secureyeDevice,
      liveScanBanner,
      dismissLiveScanBanner,
      selectedMember,
      setSelectedMember,
      addMember,
      updateMember,
      deleteMember,
      assignMemberPlan,
      addPlan,
      updatePlan,
      deletePlan,
      createSubscription,
      renewSubscription,
      deactivateSubscription,
      recordPayment,
      linkMemberBiometricId,
      saveBiometricEnrollment,
      deleteBiometricEnrollment,
      simulateAccessScan,
      soundEnabled,
      setSoundEnabled,
      playAccessTone,
      markNotificationRead,
      clearNotifications,
      firebaseConnected,
      isSyncing,
      seedFirestoreData,
      activeView,
      setActiveView,
      loginMember,
      updateMemberStatus,
      updateMemberBiometric,
      recordBiometricScan,
      activateMemberPlan
    }}>
      {children}
    </GymContext.Provider>
  );
};

export const useGym = () => {
  const context = useContext(GymContext);
  if (!context) {
    throw new Error('useGym must be used within a GymProvider');
  }
  return context;
};
