import React from 'react';
import { useGym } from '../../context/GymContext';
import { AdminTab } from '../../types/gym';
export type { AdminTab } from '../../types/gym';
import { 
  LayoutDashboard, 
  Users, 
  Layers, 
  CalendarCheck, 
  CreditCard, 
  Fingerprint, 
  CalendarDays, 
  BarChart3, 
  Settings, 
  ChevronRight,
  X
} from 'lucide-react';

interface AdminSidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  mobileOpen = false,
  onCloseMobile,
}) => {
  const { currentTab, setCurrentTab, secureyeDevice } = useGym();
  const isDeviceOnline = secureyeDevice?.wsConnectionStatus === 'connected';

  const navItems: { id: AdminTab; label: string; icon: React.ReactNode; badge?: boolean }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'members', label: 'Members', icon: <Users className="w-4 h-4" /> },
    { id: 'plans', label: 'Membership Plans', icon: <Layers className="w-4 h-4" /> },
    { id: 'subscriptions', label: 'Subscriptions', icon: <CalendarCheck className="w-4 h-4" /> },
    { id: 'payments', label: 'Payments', icon: <CreditCard className="w-4 h-4" /> },
    { id: 'biometric', label: 'Biometric', icon: <Fingerprint className="w-4 h-4" />, badge: isDeviceOnline },
    { id: 'attendance', label: 'Attendance', icon: <CalendarDays className="w-4 h-4" /> },
    { id: 'reports', label: 'Reports', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  const handleSelectTab = (tab: AdminTab) => {
    setCurrentTab(tab);
    onCloseMobile?.();
  };

  const sidebarContent = (isDrawer: boolean) => (
    <aside
      className={`w-[250px] lg:w-[240px] shrink-0 bg-[#252A30] text-white flex flex-col justify-between p-4 h-full overflow-y-auto select-none border-r border-[#313740] ${
        isDrawer ? 'max-w-[84vw] shadow-2xl' : 'min-h-screen'
      }`}
    >
      <div className="space-y-6">
        {/* Brand Header */}
        <div className="flex items-center justify-between gap-2 px-2 pt-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-black overflow-hidden flex items-center justify-center shadow-md ring-1 ring-[#FFD447]/35 shrink-0">
              <img src="/logo.png" alt="Dream Gym Logo" className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-black text-lg tracking-tight text-white truncate">
                  Dream <span className="text-[#FFD447]">Gym</span>
                </span>
              </div>
              <p className="text-[11px] text-[#84909A] font-semibold mt-1 tracking-wide">
                Admin Panel
              </p>
            </div>
          </div>

          {isDrawer && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="p-2 rounded-xl bg-[#2D333B] text-white/80 hover:text-white hover:bg-[#353C46] transition-colors shrink-0"
              aria-label="Close navigation menu"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation List */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSelectTab(item.id)}
                className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all btn-jelly-nav group ${
                  isActive
                    ? 'bg-gradient-to-r from-[#FFD447] to-[#F5C62F] text-[#252A30] shadow-[0_4px_16px_rgba(255,212,71,0.35)] scale-[1.01]'
                    : 'text-[#A0AEC0] hover:text-white hover:bg-[#2D333B]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`shrink-0 transition-transform group-hover:scale-110 ${
                      isActive
                        ? 'text-[#252A30]'
                        : 'text-[#84909A] group-hover:text-[#FFD447]'
                    }`}
                  >
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge && (
                  <span className="w-2 h-2 rounded-full bg-[#36A875] shrink-0" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Facility Footer Card */}
      <div className="pt-3 mt-4 border-t border-[#313740]">
        <button
          onClick={() => handleSelectTab('settings')}
          className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#2D333B] hover:bg-[#353C46] border border-[#3E4550] transition-colors text-left group"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-black overflow-hidden flex items-center justify-center shrink-0 ring-1 ring-[#FFD447]/30">
              <img src="/logo.png" alt="Dream Gym" className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate leading-tight">Dream Gym</p>
              <p className="text-[10px] text-[#84909A] truncate">Fitness Centre</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-[#84909A] group-hover:text-white transition-colors shrink-0" />
        </button>
      </div>
    </aside>
  );

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center transition-opacity duration-200 ${
        mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* Backdrop */}
      <div
        onClick={onCloseMobile}
        className="fixed inset-0 bg-black/55 backdrop-blur-xs"
      />
      {/* Drawer Container aligned with 430px phone shell */}
      <div className="relative z-10 w-full max-w-[430px] h-full flex pointer-events-none">
        <div
          className={`pointer-events-auto relative h-full w-fit transform transition-transform duration-200 ease-out ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {sidebarContent(true)}
        </div>
      </div>
    </div>
  );
};
