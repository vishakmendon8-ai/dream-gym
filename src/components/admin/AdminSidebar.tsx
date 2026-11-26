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
  MonitorPlay, 
  CalendarDays, 
  BarChart3, 
  Settings, 
  ChevronRight
} from 'lucide-react';

export const AdminSidebar: React.FC = () => {
  const { currentTab, setCurrentTab } = useGym();

  const navItems: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'members', label: 'Members', icon: <Users className="w-4 h-4" /> },
    { id: 'plans', label: 'Membership Plans', icon: <Layers className="w-4 h-4" /> },
    { id: 'subscriptions', label: 'Subscriptions', icon: <CalendarCheck className="w-4 h-4" /> },
    { id: 'payments', label: 'Payments', icon: <CreditCard className="w-4 h-4" /> },
    { id: 'biometric', label: 'Biometric', icon: <Fingerprint className="w-4 h-4" /> },
    { id: 'access-monitor', label: 'Access Monitor', icon: <MonitorPlay className="w-4 h-4" /> },
    { id: 'attendance', label: 'Attendance', icon: <CalendarDays className="w-4 h-4" /> },
    { id: 'reports', label: 'Reports', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <aside className="w-[240px] shrink-0 bg-[#252A30] text-white flex flex-col justify-between p-4 min-h-screen select-none border-r border-[#313740]">
      <div className="space-y-6">
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-2 pt-2">
          <div className="w-11 h-11 rounded-xl bg-black overflow-hidden flex items-center justify-center shadow-md ring-1 ring-[#FFD447]/35 shrink-0">
            <img src="/logo.png" alt="Dream Gym Logo" className="w-full h-full object-cover" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="font-black text-xl tracking-tight text-white">Dream <span className="text-[#FFD447]">Gym</span></span>
            </div>
            <p className="text-[11px] text-[#84909A] font-semibold mt-1 tracking-wide">Admin Panel</p>
          </div>
        </div>

        {/* Navigation List */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all btn-jelly-nav group ${
                  isActive
                    ? 'bg-gradient-to-r from-[#FFD447] to-[#F5C62F] text-[#252A30] shadow-[0_4px_16px_rgba(255,212,71,0.35)] scale-[1.01]'
                    : 'text-[#A0AEC0] hover:text-white hover:bg-[#2D333B]'
                }`}
              >
                <span className={`shrink-0 transition-transform group-hover:scale-110 ${isActive ? 'text-[#252A30]' : 'text-[#84909A] group-hover:text-[#FFD447]'}`}>
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Facility Footer Card */}
      <div className="pt-3 border-t border-[#313740]">
        <button 
          onClick={() => setCurrentTab('settings')}
          className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#2D333B] hover:bg-[#353C46] border border-[#3E4550] transition-colors text-left group"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-black overflow-hidden flex items-center justify-center shrink-0 ring-1 ring-[#FFD447]/30">
              <img src="/logo.png" alt="Dream Gym" className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate leading-tight">
                Dream Gym
              </p>
              <p className="text-[10px] text-[#84909A] truncate">
                Fitness Centre
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-[#84909A] group-hover:text-white transition-colors shrink-0" />
        </button>
      </div>
    </aside>
  );
};
