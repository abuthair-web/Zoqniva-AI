import React, { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bot,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MoreHorizontal,
  Search,
  Settings,
  Users,
  UserSquare2,
  Workflow,
  X,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { useApp } from '@/context/AppContext';
import { formatRelativeTime } from '@/lib/phone';

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

const PAGE_TITLES: Record<string, { title: string; section: string }> = {
  '/app': { title: 'Overview', section: 'Daily Work' },
  '/app/inbox': { title: 'Team Inbox', section: 'Customer Chats' },
  '/app/contacts': { title: 'Customers', section: 'Customer List' },
  '/app/broadcasts': { title: 'Broadcasts', section: 'Outreach' },
  '/app/templates': { title: 'Message Templates', section: 'Outreach' },
  '/app/automation': { title: 'Automation', section: 'Automatic Replies' },
  '/app/ai-assistant': { title: 'AI Assistant', section: 'Guided Assistant' },
  '/app/analytics': { title: 'Analytics', section: 'Business Results' },
  '/app/team': { title: 'Team Management', section: 'Workspace' },
  '/app/settings': { title: 'Settings', section: 'Workspace Setup' },
};

const DATE_RANGE_LABELS: Record<'today' | '7d' | '30d', string> = {
  today: 'Today',
  '7d': '7D',
  '30d': '30D',
};

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function AppShell() {
  const {
    currentUser,
    logout,
    business,
    totalUnreadCount,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    contacts,
    conversations,
    templates,
    campaigns,
    setSelectedConversationId,
    dateRange,
    setDateRange,
  } = useApp();

  const location = useLocation();
  const navigate = useNavigate();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const navGroups: NavGroup[] = [
    {
      heading: 'Daily Work',
      items: [
        { label: 'Overview', to: '/app', icon: LayoutDashboard },
        { label: 'Team Inbox', to: '/app/inbox', icon: Inbox, badge: totalUnreadCount },
        { label: 'Customers', to: '/app/contacts', icon: UserSquare2 },
      ],
    },
    {
      heading: 'Outreach',
      items: [
        { label: 'Broadcasts', to: '/app/broadcasts', icon: Megaphone },
        { label: 'Message Templates', to: '/app/templates', icon: FileText },
      ],
    },
    {
      heading: 'Automation',
      items: [
        { label: 'Automation', to: '/app/automation', icon: Workflow },
        { label: 'AI Assistant', to: '/app/ai-assistant', icon: Bot },
      ],
    },
    {
      heading: 'Workspace',
      items: [
        { label: 'Analytics', to: '/app/analytics', icon: BarChart3 },
        { label: 'Team Management', to: '/app/team', icon: Users },
        { label: 'Settings', to: '/app/settings', icon: Settings },
      ],
    },
  ];

  const pageMeta = PAGE_TITLES[location.pathname] ?? {
    title: 'Workspace',
    section: 'Zoqniva AI',
  };

  const unreadNotifs = notifications.filter((n) => !n.read).length;
  const firstName = currentUser?.fullName.split(' ')[0] || 'Team';

  const connectionBadge = useMemo(() => {
    switch (business.metaConnectionState) {
      case 'connected':
        return {
          label: 'WhatsApp Connected',
          dotClass: 'bg-emerald-500',
          boxClass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        };
      case 'connection_error':
        return {
          label: 'Connection Error',
          dotClass: 'bg-[#E11D48]',
          boxClass: 'border-rose-200 bg-rose-50 text-[#E11D48]',
        };
      case 'configuration_required':
        return {
          label: 'WhatsApp Setup Needed',
          dotClass: 'bg-[#F4B942]',
          boxClass: 'border-amber-200 bg-amber-50 text-amber-900',
        };
      default:
        return {
          label: 'Not Connected',
          dotClass: 'bg-slate-400',
          boxClass: 'border-[#E2E8F0] bg-[#F8FAFC] text-slate-700',
        };
    }
  }, [business.metaConnectionState]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return { contacts: [], conversations: [], templates: [], campaigns: [] };
    return {
      contacts: contacts
        .filter(
          (c) =>
            c.fullName.toLowerCase().includes(q) ||
            c.phoneE164.includes(q) ||
            c.company.toLowerCase().includes(q)
        )
        .slice(0, 4),
      conversations: conversations
        .filter((cv) => {
          const ct = contacts.find((c) => c.id === cv.contactId);
          return (
            cv.lastMessagePreview.toLowerCase().includes(q) ||
            ct?.fullName.toLowerCase().includes(q)
          );
        })
        .slice(0, 4),
      templates: templates.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 3),
      campaigns: campaigns.filter((cp) => cp.name.toLowerCase().includes(q)).slice(0, 3),
    };
  }, [searchQuery, contacts, conversations, templates, campaigns]);

  const initials = (currentUser?.fullName || 'ZA')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const renderSidebarContent = (isMobile = false) => {
    const isCollapsed = !isMobile && sidebarCollapsed;
    return (
      <div className="flex h-full flex-col bg-white border-r border-[#E2E8F0]">
        {/* Brand Header */}
        <div className="h-16 px-4 flex items-center justify-between border-b border-[#E2E8F0] shrink-0">
          <button
            type="button"
            onClick={() => {
              navigate('/app');
              if (isMobile) setMobileDrawerOpen(false);
            }}
            className="text-left cursor-pointer"
          >
            <BrandLogo collapsed={isCollapsed} showTagline={!isCollapsed} />
          </button>
          {isMobile ? (
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(false)}
              className="p-2 rounded-lg text-slate-500 hover:bg-[#F8FAFC] hover:text-[#0F172A] cursor-pointer"
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSidebarCollapsed((s) => !s)}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-[#F8FAFC] hover:text-[#0F172A] transition-colors cursor-pointer"
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
          )}
        </div>

        {/* Grouped Navigation Links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Primary Sidebar">
          {navGroups.map((group) => (
            <div key={group.heading} className="space-y-1">
              {!isCollapsed && (
                <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  {group.heading}
                </p>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/app'}
                    onClick={() => isMobile && setMobileDrawerOpen(false)}
                    title={isCollapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      `group flex items-center justify-between rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all whitespace-nowrap ${
                        isActive
                          ? 'bg-[#EFF6FF] text-[#2563EB] font-semibold shadow-2xs'
                          : 'text-slate-600 hover:bg-[#F8FAFC] hover:text-[#0F172A]'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span className="flex items-center gap-3 min-w-0">
                          <Icon
                            className={`h-[18px] w-[18px] shrink-0 transition-colors ${
                              isActive
                                ? 'text-[#2563EB]'
                                : 'text-slate-400 group-hover:text-slate-600'
                            }`}
                          />
                          {!isCollapsed && <span className="truncate">{item.label}</span>}
                        </span>
                        {!isCollapsed && typeof item.badge === 'number' && item.badge > 0 && (
                          <span className="ml-2 inline-flex items-center justify-center rounded-md bg-[#E11D48] px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Bottom Profile & Sign Out */}
        <div className="p-3 border-t border-[#E2E8F0] space-y-2 shrink-0">
          {!isCollapsed && (
            <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-[#2563EB] text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[#0F172A] truncate">
                    {currentUser?.fullName}
                  </p>
                  <p className="text-[11px] text-slate-500 capitalize truncate">
                    {currentUser?.role} · {business.name}
                  </p>
                </div>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-600 hover:bg-rose-50 hover:text-[#E11D48] transition-colors cursor-pointer"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!isCollapsed && <span>Sign Out</span>}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 transition-all duration-200 ${
          sidebarCollapsed ? 'w-[76px]' : 'w-[256px]'
        } sticky top-0 h-screen z-30`}
      >
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Full Navigation Drawer */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-[1px]"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10">{renderSidebarContent(true)}</div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Compact Dashboard Header */}
        <header className="sticky top-0 z-20 h-14 lg:h-16 bg-white/95 backdrop-blur-md border-b border-[#E2E8F0] px-4 lg:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              className="lg:hidden p-1.5 rounded-lg text-slate-600 hover:bg-[#F8FAFC] cursor-pointer"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-500">
                <span className="font-medium text-[#2563EB] truncate">{business.name}</span>
                <span aria-hidden="true">/</span>
                <span className="truncate">{pageMeta.section}</span>
              </div>
              <h1 className="font-display text-base sm:text-lg font-bold text-[#0F172A] truncate leading-tight">
                {location.pathname === '/app'
                  ? `${getGreeting()}, ${firstName}`
                  : pageMeta.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Global Date Range Selector (Today / 7D / 30D) */}
            <div className="hidden xl:inline-flex items-center gap-1 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-0.5">
              <Calendar className="h-3.5 w-3.5 text-slate-400 ml-2 mr-1" />
              {(['today', '7d', '30d'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setDateRange(r)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                    dateRange === r
                      ? 'bg-white text-[#2563EB] shadow-2xs'
                      : 'text-slate-500 hover:text-[#0F172A]'
                  }`}
                >
                  {DATE_RANGE_LABELS[r]}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="hidden sm:flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-xs text-slate-500 hover:border-slate-300 hover:text-[#0F172A] transition-colors cursor-pointer"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">Search...</span>
            </button>

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="sm:hidden p-2 rounded-lg border border-[#E2E8F0] text-slate-600 hover:bg-[#F8FAFC] cursor-pointer"
              aria-label="Search"
            >
              <Search className="h-4 w-4" />
            </button>

            {/* WhatsApp Connection Status */}
            <button
              type="button"
              onClick={() => navigate('/app/settings')}
              className={`hidden md:inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${connectionBadge.boxClass}`}
            >
              <span className={`h-2 w-2 rounded-full ${connectionBadge.dotClass}`} />
              <span>{connectionBadge.label}</span>
            </button>

            {/* Notifications Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((o) => !o);
                  setProfileOpen(false);
                }}
                className="relative p-2 rounded-xl border border-[#E2E8F0] bg-white text-slate-600 hover:bg-[#F8FAFC] hover:text-[#0F172A] transition-colors cursor-pointer"
                aria-label="Notifications"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                {unreadNotifs > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-[#E11D48] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                    {unreadNotifs}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-[#E2E8F0] bg-white shadow-luxury-hover z-40 overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#E2E8F0] flex items-center justify-between">
                    <span className="text-xs font-bold text-[#0F172A]">Notifications</span>
                    {unreadNotifs > 0 && (
                      <button
                        type="button"
                        onClick={markAllNotificationsRead}
                        className="text-xs font-medium text-[#2563EB] hover:underline cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-[#E2E8F0]">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-8 text-center text-xs text-slate-500">
                        No notifications yet. Delivery alerts and chat assignments will appear here.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            markNotificationRead(n.id);
                            setNotifOpen(false);
                            if (n.linkTo) navigate(n.linkTo);
                          }}
                          className={`w-full text-left px-4 py-3 hover:bg-[#F8FAFC] transition-colors flex items-start gap-3 cursor-pointer ${
                            !n.read ? 'bg-[#EFF6FF]/50' : ''
                          }`}
                        >
                          <AlertTriangle
                            className={`h-4 w-4 shrink-0 mt-0.5 ${
                              n.severity === 'error'
                                ? 'text-[#E11D48]'
                                : n.severity === 'warning'
                                ? 'text-[#F4B942]'
                                : 'text-[#2563EB]'
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-[#0F172A] truncate">
                                {n.title}
                              </p>
                              <span className="text-[11px] text-slate-400 shrink-0">
                                {formatRelativeTime(n.createdAt)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">
                              {n.description}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* User Profile Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setProfileOpen((o) => !o);
                  setNotifOpen(false);
                }}
                className="flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-2.5 py-1.5 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
              >
                <div className="h-6 w-6 rounded-md bg-[#2563EB] text-white text-[11px] font-bold flex items-center justify-center">
                  {initials}
                </div>
                <span className="hidden md:inline text-xs font-semibold text-[#0F172A] whitespace-nowrap">
                  {currentUser?.fullName}
                </span>
              </button>

              {profileOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-[#E2E8F0] bg-white shadow-luxury-hover z-40 p-2">
                  <div className="px-3 py-2 border-b border-[#E2E8F0] mb-1">
                    <p className="text-xs font-bold text-[#0F172A]">{currentUser?.fullName}</p>
                    <p className="text-[11px] text-slate-500 truncate">{currentUser?.email}</p>
                    <p className="text-[11px] font-medium text-[#2563EB] capitalize truncate mt-0.5">
                      {currentUser?.role} · {business.name}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      navigate('/');
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-[#F8FAFC] flex items-center justify-between cursor-pointer"
                  >
                    <span>Public Website</span>
                    <ExternalLink className="h-3 w-3 text-slate-400" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      navigate('/app/settings');
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-[#F8FAFC] cursor-pointer"
                  >
                    Workspace Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      handleLogout();
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[#E11D48] hover:bg-rose-50 cursor-pointer"
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Active Page Viewport */}
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 h-14 bg-white border-t border-[#E2E8F0] z-30 grid grid-cols-5"
      >
        {[
          { label: 'Overview', to: '/app', icon: LayoutDashboard, end: true },
          { label: 'Inbox', to: '/app/inbox', icon: Inbox, badge: totalUnreadCount },
          { label: 'Customers', to: '/app/contacts', icon: UserSquare2 },
          { label: 'Broadcasts', to: '/app/broadcasts', icon: Megaphone },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                  isActive ? 'text-[#2563EB] font-semibold' : 'text-slate-500'
                }`
              }
            >
              <div className="relative">
                <Icon className="h-4 w-4" />
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 h-3.5 min-w-[14px] px-1 rounded-full bg-[#E11D48] text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                    {item.badge}
                  </span>
                )}
              </div>
              <span className="truncate max-w-full px-1">{item.label}</span>
            </NavLink>
          );
        })}

        <button
          type="button"
          onClick={() => setMobileDrawerOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-slate-500 hover:text-[#0F172A] cursor-pointer"
        >
          <MoreHorizontal className="h-4 w-4" />
          <span>More</span>
        </button>
      </nav>

      {/* Global Search Modal */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-start justify-center pt-20 px-4"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-[#E2E8F0] bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E2E8F0]">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search customers, phone numbers, messages, templates, campaigns..."
                className="flex-1 text-sm text-[#0F172A] placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="p-1 text-slate-400 hover:text-[#0F172A] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto p-3 space-y-4">
              {!searchQuery.trim() ? (
                <p className="text-xs text-slate-500 text-center py-6">
                  Type a customer name, phone number, template, or campaign name.
                </p>
              ) : (
                <>
                  {searchResults.contacts.length > 0 && (
                    <div>
                      <p className="px-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        Customers
                      </p>
                      {searchResults.contacts.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            navigate('/app/contacts');
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F8FAFC] flex items-center justify-between text-xs cursor-pointer"
                        >
                          <span className="font-semibold text-[#0F172A]">{c.fullName}</span>
                          <span className="font-mono text-slate-500">{c.phoneE164}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {searchResults.conversations.length > 0 && (
                    <div>
                      <p className="px-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        Conversations
                      </p>
                      {searchResults.conversations.map((cv) => {
                        const ct = contacts.find((c) => c.id === cv.contactId);
                        return (
                          <button
                            key={cv.id}
                            type="button"
                            onClick={() => {
                              setSelectedConversationId(cv.id);
                              setSearchOpen(false);
                              navigate('/app/inbox');
                            }}
                            className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F8FAFC] text-xs cursor-pointer"
                          >
                            <p className="font-semibold text-[#0F172A]">{ct?.fullName}</p>
                            <p className="text-slate-500 truncate">{cv.lastMessagePreview}</p>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {searchResults.templates.length > 0 && (
                    <div>
                      <p className="px-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        Templates
                      </p>
                      {searchResults.templates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            navigate('/app/templates');
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F8FAFC] text-xs flex items-center justify-between cursor-pointer"
                        >
                          <span className="font-mono text-[#0F172A]">{t.name}</span>
                          <span className="text-slate-500">{t.approvalStatus}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {searchResults.campaigns.length > 0 && (
                    <div>
                      <p className="px-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        Campaigns
                      </p>
                      {searchResults.campaigns.map((cp) => (
                        <button
                          key={cp.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            navigate('/app/broadcasts');
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F8FAFC] text-xs flex items-center justify-between cursor-pointer"
                        >
                          <span className="font-semibold text-[#0F172A]">{cp.name}</span>
                          <span className="text-slate-500 capitalize">{cp.status}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {searchResults.contacts.length === 0 &&
                    searchResults.conversations.length === 0 &&
                    searchResults.templates.length === 0 &&
                    searchResults.campaigns.length === 0 && (
                      <p className="text-xs text-slate-500 text-center py-6">
                        No matching records found for &ldquo;{searchQuery}&rdquo;.
                      </p>
                    )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
