import React, { useState } from 'react';
import { GymProvider, useGym } from './context/GymContext';
import { AdminSidebar } from './components/admin/AdminSidebar';
import { TopNavbar } from './components/admin/TopNavbar';
import { DashboardOverview } from './components/admin/DashboardOverview';
import { MembersView } from './components/admin/MembersView';
import { PlansView } from './components/admin/PlansView';
import { SubscriptionsView } from './components/admin/SubscriptionsView';
import { PaymentsView } from './components/admin/PaymentsView';
import { BiometricView } from './components/admin/BiometricView';
import { AttendanceView } from './components/admin/AttendanceView';
import { ReportsView } from './components/admin/ReportsView';
import { SettingsView } from './components/admin/SettingsView';
import { AddMemberModal } from './components/admin/AddMemberModal';
import { MemberApp } from './components/member/MemberApp';
import { AdminTab } from './types/gym';
import {
  CheckCircle2,
  XCircle,
  X,
  LayoutDashboard,
  Users,
  Fingerprint,
  CalendarDays,
  Menu,
} from 'lucide-react';

const MainLayout: React.FC = () => {
  const {
    activeView,
    currentTab,
    setCurrentTab,
    setIsAddMemberOpen,
    liveScanBanner,
    dismissLiveScanBanner,
    secureyeDevice,
  } = useGym();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // If URL, hash, or state is set to Member App, render the Member App
  const isMember =
    activeView === 'member' ||
    (typeof window !== 'undefined' &&
      (window.location.pathname.toLowerCase().includes('/member') ||
        window.location.search.toLowerCase().includes('member') ||
        window.location.hash.toLowerCase().includes('member')));

  if (isMember) {
    return <MemberApp />;
  }

  const renderActiveTab = () => {
    switch (currentTab) {
      case 'dashboard':
      case 'overview':
        return <DashboardOverview />;
      case 'members':
        return <MembersView onOpenAddMember={() => setIsAddMemberOpen(true)} />;
      case 'plans':
        return <PlansView />;
      case 'subscriptions':
        return <SubscriptionsView />;
      case 'payments':
      case 'finances':
        return <PaymentsView />;
      case 'biometric':
        return <BiometricView />;
      case 'attendance':
        return <AttendanceView />;
      case 'reports':
        return <ReportsView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <DashboardOverview />;
    }
  };

  const isSecureyeOnline = secureyeDevice?.wsConnectionStatus === 'connected';
  const mobileQuickTabs: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
    { id: 'dashboard', label: 'Home', icon: <LayoutDashboard className="w-5 h-5" /> },
    { id: 'members', label: 'Members', icon: <Users className="w-5 h-5" /> },
    { id: 'biometric', label: 'Biometric', icon: <Fingerprint className="w-5 h-5" /> },
    { id: 'attendance', label: 'Attendance', icon: <CalendarDays className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-[100dvh] w-full bg-[#E5E8E3] flex justify-center font-sans antialiased selection:bg-[#FFD447] selection:text-[#252A30]">
      {/* Phone-Only Mobile App Shell (full-bleed on phones, 430px centered mobile frame on wide screens) */}
      <div className="phone-only-shell w-full max-w-[430px] h-[100dvh] bg-[#F5F6F2] text-[#252A30] flex flex-col overflow-hidden relative shadow-[0_0_40px_rgba(37,42,48,0.14)] border-x border-[#DCE3E8]/80">
        {/* Slide-Over Mobile Navigation Drawer */}
        <AdminSidebar
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />

        {/* Row 1: Compact Sticky Top Navigation Bar */}
        <div className="shrink-0 z-30 bg-[#F5F6F2] border-b border-[#DCE3E8]/70">
          <TopNavbar onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        </div>

        {/* Row 2: Scrollable Content Area (strictly ABOVE bottom nav bar — zero overlap possible) */}
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3.5 pt-3.5 pb-10">
          {renderActiveTab()}
        </main>

        {/* Row 3: Solid Opaque Docked Mobile Bottom Navigation Bar */}
        <nav
          className="shrink-0 relative z-40 bg-[#252A30] text-white border-t border-[#353C46] px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-6px_24px_rgba(0,0,0,0.22)]"
          aria-label="Mobile admin navigation"
        >
          <div className="grid grid-cols-5 gap-1">
            {mobileQuickTabs.map((item) => {
              const isActive =
                currentTab === item.id ||
                (item.id === 'dashboard' && currentTab === 'overview');
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCurrentTab(item.id)}
                  className={`relative flex flex-col items-center justify-center py-1.5 rounded-xl transition-all active:scale-95 outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD447] ${
                    isActive
                      ? 'bg-[#FFD447] text-[#252A30] font-black shadow-sm'
                      : 'text-[#A0AEC0] hover:text-white'
                  }`}
                >
                  <div className="relative">
                    {item.icon}
                    {item.id === 'biometric' && isSecureyeOnline && (
                      <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-[#36A875] ring-2 ring-[#252A30]" />
                    )}
                  </div>
                  <span className="text-[10px] font-bold mt-0.5 leading-none">
                    {item.label}
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all active:scale-95 outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD447] ${
                mobileMenuOpen ||
                !mobileQuickTabs.some(
                  (t) => t.id === currentTab || (t.id === 'dashboard' && currentTab === 'overview')
                )
                  ? 'bg-white/15 text-[#FFD447] font-black'
                  : 'text-[#A0AEC0] hover:text-white'
              }`}
            >
              <Menu className="w-5 h-5" />
              <span className="text-[10px] font-bold mt-0.5 leading-none">More</span>
            </button>
          </div>
        </nav>

        {/* Global Add Member Modal */}
        <AddMemberModal />

        {/* Global Live Secureye Biometric Scan Verdict Toast */}
        {liveScanBanner && (
          <div
            className={`fixed bottom-20 left-3 right-3 max-w-[404px] mx-auto z-50 rounded-2xl p-4 shadow-2xl border-2 backdrop-blur-md animate-fade-in ${
              liveScanBanner.status === 'granted'
                ? 'bg-[#252A30]/95 border-[#36A875] text-white'
                : 'bg-[#252A30]/95 border-[#DC5555] text-white'
            }`}
          >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  liveScanBanner.status === 'granted' ? 'bg-[#36A875]' : 'bg-[#DC5555]'
                }`}
              >
                {liveScanBanner.status === 'granted' ? (
                  <CheckCircle2 className="w-5 h-5 text-white" />
                ) : (
                  <XCircle className="w-5 h-5 text-white" />
                )}
              </div>
              <div className="min-w-0">
                <p
                  className={`text-[10px] font-black uppercase tracking-widest ${
                    liveScanBanner.status === 'granted' ? 'text-[#36A875]' : 'text-[#DC5555]'
                  }`}
                >
                  {liveScanBanner.status === 'granted'
                    ? 'Secureye Access Granted'
                    : 'Secureye Access Denied'}
                </p>
                <p className="text-sm font-black truncate mt-0.5">{liveScanBanner.memberName}</p>
                <p className="text-[11px] text-white/75 mt-0.5 leading-snug">
                  {liveScanBanner.reason}
                </p>
                <p className="text-[10px] font-mono text-[#FFD447] mt-1">
                  Bio ID: {liveScanBanner.biometricUserId} &bull; {liveScanBanner.verifyMode} &bull; SN{' '}
                  {liveScanBanner.deviceSn}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={dismissLiveScanBanner}
              className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 shrink-0"
              aria-label="Dismiss biometric scan alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default function App() {
  return (
    <GymProvider>
      <MainLayout />
    </GymProvider>
  );
}
