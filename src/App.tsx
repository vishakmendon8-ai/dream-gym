import React from 'react';
import { GymProvider, useGym } from './context/GymContext';
import { AdminSidebar } from './components/admin/AdminSidebar';
import { TopNavbar } from './components/admin/TopNavbar';
import { DashboardOverview } from './components/admin/DashboardOverview';
import { MembersView } from './components/admin/MembersView';
import { PlansView } from './components/admin/PlansView';
import { SubscriptionsView } from './components/admin/SubscriptionsView';
import { PaymentsView } from './components/admin/PaymentsView';
import { BiometricView } from './components/admin/BiometricView';
import { AccessMonitorView } from './components/admin/AccessMonitorView';
import { AttendanceView } from './components/admin/AttendanceView';
import { ReportsView } from './components/admin/ReportsView';
import { SettingsView } from './components/admin/SettingsView';
import { AddMemberModal } from './components/admin/AddMemberModal';
import { MemberApp } from './components/member/MemberApp';

import { CheckCircle2, XCircle, X } from 'lucide-react';

const MainLayout: React.FC = () => {
  const {
    activeView,
    currentTab,
    setIsAddMemberOpen,
    liveScanBanner,
    dismissLiveScanBanner,
  } = useGym();

  // If URL, hash, or state is set to Member App, render the Member App
  const isMember = activeView === 'member' || 
    (typeof window !== 'undefined' && (
      window.location.pathname.toLowerCase().includes('/member') ||
      window.location.search.toLowerCase().includes('member') ||
      window.location.hash.toLowerCase().includes('member')
    ));

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
      case 'access-monitor':
        return <AccessMonitorView />;
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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F5F6F2] text-[#252A30] font-sans antialiased selection:bg-[#FFD447] selection:text-[#252A30]">
      {/* Fixed Deep Graphite Left Sidebar */}
      <AdminSidebar />

      {/* Main Viewport: Scrollable Cloud White Workspace */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-y-auto">
        {/* Top Navigation Bar with View Switcher */}
        <div className="sticky top-0 z-40 bg-[#F5F6F2]/90 backdrop-blur-md border-b border-[#DCE3E8]/60">
          <TopNavbar />
        </div>

        {/* Dynamic Tab Content Area */}
        <main className="flex-1 p-6 lg:p-8 max-w-[1600px] w-full mx-auto">
          {renderActiveTab()}
        </main>
      </div>

      {/* Global Add Member Modal */}
      <AddMemberModal />

      {/* Global Live Secureye Biometric Scan Verdict Toast */}
      {liveScanBanner && (
        <div
          className={`fixed bottom-5 right-5 z-50 max-w-sm w-full rounded-2xl p-4 shadow-2xl border-2 backdrop-blur-md animate-fade-in ${
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
