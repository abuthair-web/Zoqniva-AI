import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Inbox,
  Megaphone,
  MessageSquare,
  Plus,
  Send,
  Settings,
  UserPlus,
  Users,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { formatRelativeTime, getWindowStatus } from '@/lib/phone';

const RANGE_LABELS: Record<'today' | '7d' | '30d', string> = {
  today: 'Today',
  '7d': '7 Days',
  '30d': '30 Days',
};

export function OverviewPage() {
  const navigate = useNavigate();
  const {
    business,
    contacts,
    conversations,
    messages,
    campaigns,
    teamMembers,
    dateRange,
    setSelectedConversationId,
  } = useApp();

  const stats = useMemo(() => {
    const activeConvs = conversations.filter((c) => c.status !== 'resolved').length;
    const unreadConvs = conversations.filter((c) => c.unreadCount > 0).length;
    const outboundMsgs = messages.filter((m) => m.direction === 'outbound');
    const deliveredMsgs = outboundMsgs.filter(
      (m) => m.deliveryStatus === 'delivered' || m.deliveryStatus === 'read'
    ).length;
    const failedMsgs = outboundMsgs.filter((m) => m.deliveryStatus === 'failed').length;
    const activeCampaigns = campaigns.filter(
      (c) => c.status === 'running' || c.status === 'scheduled'
    ).length;

    const expiredWindows = conversations.filter(
      (c) => c.status !== 'resolved' && !getWindowStatus(c.windowExpiresAt).isOpen
    ).length;

    return {
      totalContacts: contacts.length,
      activeConversations: activeConvs,
      unreadConversations: unreadConvs,
      messagesSent: outboundMsgs.length,
      messagesDelivered: deliveredMsgs,
      activeCampaigns,
      failedMsgs,
      handoffCount: conversations.filter((c) => c.humanHandoffRequested).length,
      expiredWindows,
    };
  }, [contacts, conversations, messages, campaigns]);

  const activitySeries = useMemo(() => {
    if (messages.length === 0 && conversations.length === 0) return [];

    const now = new Date();
    const buckets: Array<{
      key: string;
      date: string;
      inbound: number;
      outbound: number;
      resolved: number;
      failed: number;
    }> = [];

    const days = dateRange === 'today' ? 1 : dateRange === '7d' ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      buckets.push({ key, date: label, inbound: 0, outbound: 0, resolved: 0, failed: 0 });
    }

    const bucketMap = new Map(buckets.map((b) => [b.key, b]));
    for (const msg of messages) {
      const key = msg.createdAt.slice(0, 10);
      const bucket = bucketMap.get(key);
      if (!bucket) continue;
      if (msg.direction === 'inbound') bucket.inbound += 1;
      if (msg.direction === 'outbound') {
        bucket.outbound += 1;
        if (msg.deliveryStatus === 'failed') bucket.failed += 1;
      }
    }

    for (const conv of conversations) {
      if (conv.status === 'resolved') {
        const key = conv.lastMessageAt.slice(0, 10);
        const bucket = bucketMap.get(key);
        if (bucket) bucket.resolved += 1;
      }
    }

    return buckets;
  }, [messages, conversations, dateRange]);

  const hasActivity = activitySeries.length > 0;

  const kpiCards = [
    {
      label: 'Total Contacts',
      value: stats.totalContacts.toString(),
      subtext:
        stats.totalContacts === 0
          ? 'No contacts added yet'
          : `${contacts.filter((c) => c.marketingOptIn).length} opted in for campaigns`,
      icon: Users,
      tone: 'blue' as const,
      to: '/app/contacts',
    },
    {
      label: 'Open Conversations',
      value: stats.activeConversations.toString(),
      subtext:
        stats.unreadConversations > 0
          ? `${stats.unreadConversations} unread conversation${stats.unreadConversations === 1 ? '' : 's'}`
          : stats.handoffCount > 0
          ? `${stats.handoffCount} flagged for staff`
          : 'Open & pending threads',
      icon: Inbox,
      tone: stats.unreadConversations > 0 || stats.handoffCount > 0 ? ('crimson' as const) : ('blue' as const),
      to: '/app/inbox',
    },
    {
      label: 'Messages Sent',
      value: stats.messagesSent.toString(),
      subtext:
        stats.failedMsgs > 0
          ? `${stats.failedMsgs} failed delivery`
          : 'Outbound WhatsApp replies',
      icon: Send,
      tone: stats.failedMsgs > 0 ? ('crimson' as const) : ('blue' as const),
      to: '/app/analytics',
    },
    {
      label: 'Messages Delivered',
      value: stats.messagesDelivered.toString(),
      subtext: 'Confirmed by Meta webhook',
      icon: CheckCircle2,
      tone: 'emerald' as const,
      to: '/app/analytics',
    },
    {
      label: 'Campaigns',
      value: campaigns.length.toString(),
      subtext:
        stats.activeCampaigns > 0
          ? `${stats.activeCampaigns} scheduled or sending`
          : `${campaigns.filter((c) => c.status === 'draft').length} saved draft${campaigns.filter((c) => c.status === 'draft').length === 1 ? '' : 's'}`,
      icon: Megaphone,
      tone: 'gold' as const,
      to: '/app/broadcasts',
    },
  ];

  return (
    <div className="p-4 sm:p-6 pb-20 lg:pb-8 max-w-[1520px] mx-auto space-y-5">
      {/* Compact Workspace Action Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-[#0F172A] tracking-tight">
            Workspace Overview
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time snapshot of customer conversations, contacts, delivery health, and WhatsApp status.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/app/inbox')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] transition-colors whitespace-nowrap cursor-pointer"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>Open Inbox</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/app/contacts', { state: { openAdd: true } })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] transition-colors whitespace-nowrap cursor-pointer"
          >
            <UserPlus className="h-3.5 w-3.5 text-[#2563EB]" />
            <span>Add Contact</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/app/broadcasts', { state: { openWizard: true } })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#E11D48] px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Megaphone className="h-3.5 w-3.5" />
            <span>New Campaign</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/app/automation')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 text-[#F4B942]" />
            <span>Automation</span>
          </button>
        </div>
      </div>

      {/* Clickable Operational KPI Strip */}
      <section aria-label="Primary KPIs" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          const iconStyle =
            card.tone === 'crimson'
              ? 'bg-rose-50 text-[#E11D48]'
              : card.tone === 'gold'
              ? 'bg-amber-50 text-amber-700'
              : card.tone === 'emerald'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-[#EFF6FF] text-[#2563EB]';

          return (
            <button
              key={card.label}
              type="button"
              onClick={() => navigate(card.to)}
              className="text-left rounded-xl border border-[#E2E8F0] bg-white p-4 hover:border-slate-300 hover:bg-[#F8FAFC] transition-colors flex flex-col justify-between cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2 w-full">
                <span className="text-xs font-medium text-slate-500 truncate">{card.label}</span>
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${iconStyle}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <p className="font-display text-2xl font-bold text-[#0F172A] tabular-nums">
                  {card.value}
                </p>
                <p className="text-[11px] text-slate-500 mt-1 truncate">{card.subtext}</p>
              </div>
            </button>
          );
        })}
      </section>

      {/* Activity Charts + WhatsApp Connection Readiness */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {hasActivity ? (
          <>
            <div className="lg:col-span-5 rounded-xl border border-[#E2E8F0] bg-white p-5">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="font-display text-sm font-bold text-[#0F172A]">
                    Messaging Activity ({RANGE_LABELS[dateRange]})
                  </h2>
                  <p className="text-xs text-slate-500">Outbound replies vs inbound messages</p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-600">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-xs bg-[#2563EB]" /> Out
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-xs bg-[#F4B942]" /> In
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-xs bg-[#E11D48]" /> Fail
                  </span>
                </div>
              </div>

              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={activitySeries} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                    <defs>
                      <linearGradient id="zoqOutboundGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563EB" stopOpacity={0.16} />
                        <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="zoqInboundGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F4B942" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#F4B942" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="outbound"
                      name="Sent"
                      stroke="#2563EB"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#zoqOutboundGrad)"
                    />
                    <Area
                      type="monotone"
                      dataKey="inbound"
                      name="Received"
                      stroke="#F4B942"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#zoqInboundGrad)"
                    />
                    <Area
                      type="monotone"
                      dataKey="failed"
                      name="Failed"
                      stroke="#E11D48"
                      strokeWidth={1.75}
                      fillOpacity={0}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="lg:col-span-4 rounded-xl border border-[#E2E8F0] bg-white p-5">
              <div className="mb-4">
                <h2 className="font-display text-sm font-bold text-[#0F172A]">
                  Resolved Conversations
                </h2>
                <p className="text-xs text-slate-500">Incoming threads vs resolved</p>
              </div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activitySeries} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Bar dataKey="inbound" name="New Chats" fill="#2563EB" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="resolved" name="Resolved" fill="#F4B942" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        ) : (
          <div className="lg:col-span-9 rounded-xl border border-[#E2E8F0] bg-white p-8 flex flex-col items-center justify-center text-center min-h-[260px]">
            <div className="h-11 w-11 rounded-xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center mb-3.5">
              <MessageSquare className="h-5 w-5" />
            </div>
            <h2 className="font-display text-base font-bold text-[#0F172A]">
              No messaging activity recorded yet
            </h2>
            <p className="text-xs text-slate-500 mt-1 max-w-md leading-relaxed">
              Connect your official WhatsApp Cloud API number in Settings and add contacts to start tracking live messages and delivery confirmations.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => navigate('/app/settings')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
              >
                <Settings className="h-3.5 w-3.5" />
                <span>WhatsApp Setup</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => navigate('/app/contacts', { state: { openAdd: true } })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
              >
                <UserPlus className="h-3.5 w-3.5 text-[#2563EB]" />
                <span>Add Contact</span>
              </button>
            </div>
          </div>
        )}

        {/* Workspace Operations & Status Card */}
        <div className="lg:col-span-3 rounded-xl border border-[#E2E8F0] bg-white p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-sm font-bold text-[#0F172A]">Workspace Status</h2>
              <span
                className={`text-[11px] font-semibold ${
                  business.metaConnectionState === 'connected' ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {business.metaConnectionState === 'connected' ? 'Connected' : 'Setup Needed'}
              </span>
            </div>

            <div className="divide-y divide-[#E2E8F0] text-xs">
              <div className="py-2.5 first:pt-0">
                <p className="font-semibold text-[#0F172A]">WhatsApp Cloud API</p>
                <p className="text-slate-500 mt-0.5 leading-relaxed">
                  {business.metaConnectionState === 'connected'
                    ? `${business.messagingMode === 'test' ? 'Test Mode (Allowlist only)' : 'Live Mode'} · ${
                        business.whatsappPhoneE164 || 'Number verified'
                      }`
                    : 'Enter Phone Number ID and WABA ID in Settings to connect.'}
                </p>
              </div>
              <div className="py-2.5">
                <p className="font-semibold text-[#0F172A]">24-Hour Reply Windows</p>
                <p className="text-slate-500 mt-0.5 leading-relaxed">
                  {stats.expiredWindows} open chat{stats.expiredWindows === 1 ? '' : 's'} require an approved template.
                </p>
              </div>
              <div className="py-2.5 last:pb-0">
                <p className="font-semibold text-[#0F172A]">Human Handoffs</p>
                <p className="text-slate-500 mt-0.5 leading-relaxed">
                  {stats.handoffCount} conversation{stats.handoffCount === 1 ? '' : 's'} flagged for staff follow-up.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/app/settings')}
            className="mt-4 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] transition-colors cursor-pointer"
          >
            <span>Open WhatsApp Settings</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-[#2563EB]" />
          </button>
        </div>
      </div>

      {/* Bottom Operational Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent Conversations */}
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="font-display text-sm font-bold text-[#0F172A]">
              Recent Conversations
            </h2>
            <button
              type="button"
              onClick={() => navigate('/app/inbox')}
              className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
            >
              Open Inbox
            </button>
          </div>

          {conversations.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-8 text-center text-xs text-slate-500">
              <p className="font-semibold text-[#0F172A]">No conversations yet</p>
              <p className="mt-1">Customer threads appear here once WhatsApp messages arrive.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#E2E8F0] flex-1">
              {conversations.slice(0, 4).map((conv) => {
                const contact = contacts.find((c) => c.id === conv.contactId);
                const assignee = teamMembers.find((m) => m.id === conv.assignedToId);
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => {
                      setSelectedConversationId(conv.id);
                      navigate('/app/inbox');
                    }}
                    className="w-full text-left py-2.5 first:pt-0 last:pb-0 hover:bg-[#F8FAFC] -mx-2 px-2 rounded-lg transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#0F172A] truncate">
                        {contact?.fullName ?? 'Unknown Contact'}
                      </span>
                      <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                        {formatRelativeTime(conv.lastMessageAt)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 truncate mt-0.5">
                      {conv.lastMessagePreview}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400">
                      <span className="capitalize">{conv.status}</span>
                      <span aria-hidden="true">·</span>
                      <span>{assignee ? assignee.fullName : 'Unassigned'}</span>
                      {conv.unreadCount > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-[#E11D48] tabular-nums">
                            {conv.unreadCount} unread
                          </span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Campaigns */}
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="font-display text-sm font-bold text-[#0F172A]">Recent Campaigns</h2>
            <button
              type="button"
              onClick={() => navigate('/app/broadcasts')}
              className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
            >
              View All
            </button>
          </div>

          {campaigns.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-8 text-center text-xs text-slate-500">
              <p className="font-semibold text-[#0F172A]">No campaigns created yet</p>
              <p className="mt-1">Prepare campaign drafts once templates and opted-in contacts are ready.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#E2E8F0] flex-1">
              {campaigns.slice(0, 3).map((cmp) => (
                <div key={cmp.id} className="py-2.5 first:pt-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[#0F172A] truncate">{cmp.name}</p>
                    <span className="text-[11px] font-medium text-slate-500 capitalize shrink-0">
                      {cmp.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 tabular-nums">
                    <span>Eligible: {cmp.metrics.eligible}</span>
                    <span aria-hidden="true">·</span>
                    <span>Delivered: {cmp.metrics.delivered}</span>
                    <span aria-hidden="true">·</span>
                    <span>Read: {cmp.metrics.read}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3.5 pt-3 border-t border-[#E2E8F0] flex items-center justify-between text-xs">
            <span className="text-slate-600 flex items-center gap-1.5">
              <AlertCircle
                className={`h-3.5 w-3.5 ${
                  business.metaConnectionState === 'connected' ? 'text-emerald-600' : 'text-[#F4B942]'
                }`}
              />
              WhatsApp Mode
            </span>
            <span className="font-semibold text-[#0F172A]">
              {business.messagingMode === 'test' ? 'Test Mode' : 'Live Mode'}
            </span>
          </div>
        </div>

        {/* Team Workload */}
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="font-display text-sm font-bold text-[#0F172A]">Team Workload</h2>
            <button
              type="button"
              onClick={() => navigate('/app/team')}
              className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
            >
              Manage Team
            </button>
          </div>

          {teamMembers.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-8 text-center text-xs text-slate-500">
              <p className="font-semibold text-[#0F172A]">No team members loaded</p>
              <p className="mt-1">Open Team Members to view staff assignments.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#E2E8F0] flex-1">
              {teamMembers.slice(0, 5).map((member) => {
                const assignedCount = conversations.filter((c) => c.assignedToId === member.id).length;
                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#0F172A] truncate">
                        {member.fullName}
                      </p>
                      <p className="text-[11px] text-slate-500 capitalize">
                        {member.role} · {member.status === 'suspended' ? 'Paused' : member.status}
                      </p>
                    </div>
                    <div className="text-right text-xs tabular-nums shrink-0">
                      <p className="font-mono font-semibold text-[#2563EB]">
                        {assignedCount} active
                      </p>
                      <p className="text-[11px] text-slate-400">{member.resolvedToday} resolved</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
