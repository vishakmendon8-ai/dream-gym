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
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[#F5F6F2] text-[#252A30] font-sans antialiased selection:bg-[#FFD447] selection:text-[#252A30]">
      {/* Desktop Fixed Sidebar + Mobile Slide-Over Drawer */}
      <AdminSidebar
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Main Viewport: Scrollable Cloud White Workspace */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-y-auto overflow-x-hidden">
        {/* Top Navigation Bar */}
        <div className="sticky top-0 z-40 bg-[#F5F6F2]/95 backdrop-blur-md border-b border-[#DCE3E8]/60">
          <TopNavbar onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        </div>

        {/* Dynamic Tab Content Area (extra bottom padding on mobile for fixed bottom nav) */}
        <main className="flex-1 p-3.5 sm:p-5 lg:p-8 pb-24 lg:pb-8 max-w-[1600px] w-full mx-auto">
          {renderActiveTab()}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (< lg) */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[#252A30]/98 backdrop-blur-md border-t border-[#353C46] px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-6px_24px_rgba(0,0,0,0.18)]"
        aria-label="Mobile admin navigation"
      >
        <div className="grid grid-cols-5 gap-1 max-w-md mx-auto">
          {mobileQuickTabs.map((item) => {
            const isActive =
              currentTab === item.id ||
              (item.id === 'dashboard' && currentTab === 'overview');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCurrentTab(item.id)}
                className={`relative flex flex-col items-center justify-center py-1.5 rounded-xl transition-all active:scale-95 ${
                  isActive
                    ? 'text-[#FFD447] bg-white/10'
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
            className="flex flex-col items-center justify-center py-1.5 rounded-xl text-[#A0AEC0] hover:text-white transition-all active:scale-95"
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
          className={`fixed bottom-20 lg:bottom-5 left-3 right-3 sm:left-auto sm:right-5 z-50 sm:max-w-sm sm:w-full rounded-2xl p-4 shadow-2xl border-2 backdrop-blur-md animate-fade-in ${
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
  );
};

export default function App() {
  return (
    <GymProvider>
      <MainLayout />
    </GymProvider>
  );
}
