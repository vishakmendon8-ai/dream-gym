import React, { useState } from 'react';
import { useGym } from '../../context/GymContext';
import { 
  Search, 
  Bell, 
  ChevronDown, 
  Shield, 
  Radio,
  Wifi,
  WifiOff,
  Menu
} from 'lucide-react';

interface TopNavbarProps {
  onOpenMobileMenu?: () => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({ onOpenMobileMenu }) => {
  const { 
    currentTab, 
    searchQuery, 
    setSearchQuery, 
    notifications, 
    adminProfile, 
    markNotificationRead, 
    clearNotifications, 
    setCurrentTab,
    secureyeDevice,
    biometricWsStreamStatus,
  } = useGym();
  
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const unreadCount = notifications.filter(n => !n.isRead).length;
  const isDeviceOnline = secureyeDevice?.wsConnectionStatus === 'connected';
  const isWsServerLive = biometricWsStreamStatus === 'connected';

  const tabTitles: Record<string, { title: string; subtitle: string }> = {
    'dashboard': { title: 'Dashboard', subtitle: 'Overview of your gym operations' },
    'overview': { title: 'Dashboard', subtitle: 'Overview of your gym operations' },
    'members': { title: 'Members', subtitle: 'Manage gym members, profiles & credentials' },
    'plans': { title: 'Membership Plans', subtitle: 'Configure access packages & promotional pricing' },
    'subscriptions': { title: 'Subscriptions', subtitle: 'Track active memberships, renewals & expiries' },
    'payments': { title: 'Payments', subtitle: 'Razorpay billing transactions & revenue records' },
    'biometric': { title: 'Biometric', subtitle: 'Live Secureye WebSocket terminal (SN 102026020002110) & member ID mapping' },
    'access-monitor': { title: 'Access Monitor', subtitle: 'Real-time Secureye WebSocket entrance monitor & verification' },
    'attendance': { title: 'Attendance', subtitle: 'Live biometric check-in logs & visitor history' },
    'reports': { title: 'Reports', subtitle: 'Export revenue, membership & retention metrics' },
    'settings': { title: 'Settings', subtitle: 'Facility preferences & turnstile parameters' },
  };

  const currentInfo = tabTitles[currentTab] || { title: 'Dashboard', subtitle: 'Overview of your gym operations' };

  return (
    <header className="w-full flex items-center justify-between gap-2.5 py-2.5 px-3.5 sm:px-6 sm:py-3 select-none bg-transparent">
      {/* Left: Mobile Menu Button + Page Title */}
      <div className="flex items-center gap-2.5 min-w-0">
        {onOpenMobileMenu && (
          <button
            type="button"
            onClick={onOpenMobileMenu}
            className="lg:hidden w-9 h-9 rounded-xl bg-[#252A30] text-[#FFD447] flex items-center justify-center shrink-0 shadow-xs active:scale-95 transition-transform"
            aria-label="Open admin menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        <div className="min-w-0">
          <h1 className="text-lg sm:text-2xl font-black text-[#252A30] tracking-tight leading-tight truncate">
            {currentInfo.title}
          </h1>
          <p className="hidden sm:block text-xs text-[#84909A] font-medium mt-0.5 truncate">
            {currentInfo.subtitle}
          </p>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Live Secureye WebSocket Status Pill */}
        <button
          type="button"
          onClick={() => setCurrentTab('biometric')}
          className={`px-2.5 sm:px-3 py-1.5 rounded-full border text-[10px] sm:text-[11px] font-black flex items-center gap-1.5 shadow-xs transition-all shrink-0 ${
            isDeviceOnline
              ? 'bg-[#36A875]/15 border-[#36A875]/40 text-[#237A54]'
              : isWsServerLive
              ? 'bg-[#FFF8E7] border-[#FFD447]/70 text-[#8A6112]'
              : 'bg-white border-[#DCE3E8] text-[#84909A] hover:border-[#FFD447]'
          }`}
          title="Open Secureye Biometric WebSocket Management"
        >
          {isDeviceOnline ? (
            <Wifi className="w-3.5 h-3.5 text-[#36A875]" />
          ) : isWsServerLive ? (
            <Radio className="w-3.5 h-3.5 text-[#E5A024] animate-pulse" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-[#DC5555]" />
          )}
          <span className="hidden sm:inline">
            {isDeviceOnline
              ? 'Secureye Online'
              : isWsServerLive
              ? 'WS Live • Awaiting Machine'
              : 'WS Connecting...'}
          </span>
          <span className="sm:hidden">
            {isDeviceOnline ? 'Online' : isWsServerLive ? 'WS Live' : 'WS Off'}
          </span>
        </button>

        {/* Global Search Pill (md+) */}
        <div className="relative hidden md:block">
          <Search className="w-4 h-4 text-[#84909A] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-44 lg:w-56 pl-9 pr-3 py-1.5 rounded-full bg-white/95 border border-[#DCE3E8] text-xs font-semibold text-[#252A30] placeholder:text-[#84909A] focus:outline-none focus:border-[#FFD447] focus:ring-2 focus:ring-[#FFD447]/30 shadow-xs transition-all"
          />
        </div>

        {/* Notification Bell with Badge */}
        <div className="relative">
          <button
            onClick={() => {
              setShowNotifications(!showNotifications);
              setShowProfileMenu(false);
            }}
            className="w-9 h-9 sm:w-8 sm:h-8 rounded-full bg-white border border-[#DCE3E8] flex items-center justify-center text-[#252A30] hover:border-[#FFD447] shadow-xs transition-all relative"
            title="Notifications"
          >
            <Bell className="w-4 h-4 text-[#252A30]" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#FFD447] text-[#252A30] font-black text-[9px] flex items-center justify-center shadow-xs border border-white">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-72 sm:w-80 max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl shadow-xl border border-[#DCE3E8] p-3 z-50 animate-fade-in text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-[#E9ECEF] mb-2 px-1">
                <span className="font-extrabold text-[#252A30]">Notifications ({unreadCount})</span>
                {unreadCount > 0 && (
                  <button 
                    onClick={clearNotifications}
                    className="text-[10px] font-bold text-[#84909A] hover:text-[#252A30]"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {notifications.slice(0, 5).map((n) => (
                  <div
                    key={n.id}
                    onClick={() => markNotificationRead(n.id)}
                    className={`p-2.5 rounded-xl cursor-pointer transition-all ${
                      n.isRead ? 'bg-[#F5F6F2]/60' : 'bg-[#FFF8E7] border border-[#FFD447]/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#252A30] truncate">{n.title}</span>
                      <span className="text-[10px] text-[#84909A] shrink-0">{n.time}</span>
                    </div>
                    <p className="text-[11px] text-[#84909A] mt-0.5 leading-snug">{n.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Admin Profile Pill */}
        <div className="relative">
          <button
            onClick={() => {
              setShowProfileMenu(!showProfileMenu);
              setShowNotifications(false);
            }}
            className="flex items-center gap-1.5 sm:gap-2 p-1 sm:pr-2.5 rounded-full bg-white border border-[#DCE3E8] hover:border-[#FFD447] shadow-xs transition-all group"
          >
            <img
              src={adminProfile.avatar}
              alt={adminProfile.name}
              className="w-7 h-7 rounded-full object-cover border border-[#DCE3E8]"
            />
            <span className="text-xs font-black text-[#252A30] hidden md:inline">{adminProfile.name}</span>
            <ChevronDown className="w-3.5 h-3.5 text-[#84909A] hidden sm:block group-hover:text-[#252A30] transition-colors" />
          </button>

          {showProfileMenu && (
            <div className="absolute right-0 mt-2 w-56 max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl shadow-xl border border-[#DCE3E8] p-2 z-50 animate-fade-in text-xs">
              <div className="px-3 py-2 border-b border-[#E9ECEF] mb-1">
                <p className="font-extrabold text-[#252A30]">{adminProfile.name}</p>
                <p className="text-[10px] text-[#84909A] truncate">{adminProfile.email}</p>
              </div>
              <button
                onClick={() => {
                  setCurrentTab('settings');
                  setShowProfileMenu(false);
                }}
                className="w-full px-3 py-2 text-left rounded-xl hover:bg-[#F5F6F2] font-semibold text-[#252A30] flex items-center gap-2"
              >
                <Shield className="w-3.5 h-3.5 text-[#84909A]" />
                <span>Admin Settings</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
