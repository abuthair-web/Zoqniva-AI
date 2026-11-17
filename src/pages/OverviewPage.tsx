import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
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
  Sparkles,
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
      messagesSent: outboundMsgs.length,
      messagesDelivered: deliveredMsgs,
      activeCampaigns,
      failedMsgs,
      handoffCount: conversations.filter((c) => c.humanHandoffRequested).length,
      expiredWindows,
    };
  }, [contacts, conversations, messages, campaigns]);

  // Build real chart points exclusively from real messages & conversations
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
          : `${contacts.filter((c) => c.marketingOptIn).length} opted in for broadcasts`,
      icon: Users,
      tone: 'blue',
    },
    {
      label: 'Active Conversations',
      value: stats.activeConversations.toString(),
      subtext:
        stats.handoffCount > 0
          ? `${stats.handoffCount} waiting for a person`
          : 'Open & pending customer chats',
      icon: Inbox,
      tone: stats.handoffCount > 0 ? 'crimson' : 'blue',
    },
    {
      label: 'Messages Sent',
      value: stats.messagesSent.toString(),
      subtext:
        stats.failedMsgs > 0
          ? `${stats.failedMsgs} failed delivery`
          : 'Outbound messages sent',
      icon: Send,
      tone: stats.failedMsgs > 0 ? 'crimson' : 'blue',
    },
    {
      label: 'Messages Delivered',
      value: stats.messagesDelivered.toString(),
      subtext: 'Confirmed by Meta WhatsApp',
      icon: CheckCircle2,
      tone: 'blue',
    },
    {
      label: 'Active Campaigns',
      value: stats.activeCampaigns.toString(),
      subtext: `${campaigns.length} total campaign${campaigns.length === 1 ? '' : 's'}`,
      icon: Megaphone,
      tone: 'gold',
    },
  ] as const;

  return (
    <div className="p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8 max-w-[1440px] mx-auto space-y-6">
      {/* Header + Focused Quick Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="h-[2px] w-5 bg-[#F4B942]" />
            <span className="text-xs font-semibold text-[#2563EB]">Workspace Overview</span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Daily summary of your customer chats, contacts, broadcasts, and WhatsApp connection.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate('/app/broadcasts', { state: { openWizard: true } })}
            className="inline-flex items-center gap-2 rounded-xl bg-[#E11D48] px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
          >
            <Megaphone className="h-3.5 w-3.5" />
            <span>New Broadcast</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/app/inbox')}
            className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>Open Team Inbox</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/app/contacts', { state: { openAdd: true } })}
            className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UserPlus className="h-3.5 w-3.5 text-[#2563EB]" />
            <span>Add Customer</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/app/automation')}
            className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 text-[#F4B942]" />
            <span>Create Automation</span>
          </button>
        </div>
      </div>

      {/* 5 Essential KPI Cards */}
      <section aria-label="Primary KPIs" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          const iconStyle =
            card.tone === 'crimson'
              ? 'bg-rose-50 text-[#E11D48]'
              : card.tone === 'gold'
              ? 'bg-amber-50 text-amber-700'
              : 'bg-[#EFF6FF] text-[#2563EB]';
          return (
            <motion.div
              key={card.label}
              whileHover={{ y: -2 }}
              transition={{ duration: 0.16 }}
              className="rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-2xs hover:shadow-luxury transition-shadow flex flex-col justify-between"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500 truncate">{card.label}</span>
                <div className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 ${iconStyle}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <p className="font-display text-2xl font-bold text-[#0F172A] tabular-nums">
                  {card.value}
                </p>
                <p className="text-[11px] text-slate-500 mt-1 truncate">{card.subtext}</p>
              </div>
            </motion.div>
          );
        })}
      </section>

      {/* Activity Section + Setup Checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {hasActivity ? (
          <>
            <div className="lg:col-span-5 rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-2xs">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="font-display text-base font-bold text-[#0F172A]">
                    Messaging Activity ({RANGE_LABELS[dateRange]})
                  </h2>
                  <p className="text-xs text-slate-500">Replies sent vs customer messages</p>
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

              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={activitySeries} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                    <defs>
                      <linearGradient id="zoqOutboundGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563EB" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="zoqInboundGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F4B942" stopOpacity={0.2} />
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

            <div className="lg:col-span-4 rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-2xs">
              <div className="mb-4">
                <h2 className="font-display text-base font-bold text-[#0F172A]">
                  Resolved Conversations
                </h2>
                <p className="text-xs text-slate-500">New customer chats vs resolved</p>
              </div>
              <div className="h-60 w-full">
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
          <div className="lg:col-span-9 rounded-2xl border border-[#E2E8F0] bg-white p-8 flex flex-col items-center justify-center text-center shadow-2xs min-h-[280px]">
            <div className="h-12 w-12 rounded-2xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center mb-4">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h2 className="font-display text-lg font-bold text-[#0F172A]">
              No activity yet. Connect your WhatsApp account to start receiving conversations.
            </h2>
            <p className="text-xs text-slate-500 mt-1.5 max-w-md leading-relaxed">
              Once your WhatsApp Business number is connected and messages begin arriving, live
              volume trends and resolution metrics will appear here automatically.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/app/settings')}
                className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
              >
                <Settings className="h-3.5 w-3.5" />
                <span>Connect WhatsApp</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => navigate('/app/contacts', { state: { openAdd: true } })}
                className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-4 py-2.5 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
              >
                <UserPlus className="h-3.5 w-3.5 text-[#2563EB]" />
                <span>Add Your First Customer</span>
              </button>
            </div>
          </div>
        )}

        {/* Quick Checklist */}
        <div className="lg:col-span-3 rounded-2xl border border-[#F4B942]/60 bg-gradient-to-b from-amber-50/40 via-white to-white p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center">
                <Sparkles className="h-4 w-4" />
              </div>
              <h2 className="font-display text-sm font-bold text-[#0F172A]">Quick Checklist</h2>
            </div>

            <div className="space-y-3 text-xs">
              <div className="rounded-xl border border-[#E2E8F0] bg-white p-3">
                <p className="font-semibold text-[#0F172A]">WhatsApp Status</p>
                <p className="text-slate-600 mt-0.5 leading-relaxed">
                  {business.metaConnectionState === 'connected'
                    ? 'Connected and ready for live customer messages.'
                    : 'Connect your WhatsApp Business number in Settings when ready.'}
                </p>
              </div>
              <div className="rounded-xl border border-[#E2E8F0] bg-white p-3">
                <p className="font-semibold text-[#0F172A]">Chats Needing a Template</p>
                <p className="text-slate-600 mt-0.5 leading-relaxed">
                  {stats.expiredWindows} open chat{stats.expiredWindows === 1 ? '' : 's'} past the 24-hour window.
                </p>
              </div>
              <div className="rounded-xl border border-[#E2E8F0] bg-white p-3">
                <p className="font-semibold text-[#0F172A]">Customers Waiting for Staff</p>
                <p className="text-slate-600 mt-0.5 leading-relaxed">
                  {stats.handoffCount} chat{stats.handoffCount === 1 ? '' : 's'} flagged for a human team member.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/app/ai-assistant')}
            className="mt-4 w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#F4B942]/70 bg-amber-50/70 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100/70 transition-colors cursor-pointer"
          >
            <span>Open AI Assistant</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Bottom 3-Column Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Conversations */}
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 flex flex-col shadow-2xs">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold text-[#0F172A]">
              Recent Customer Chats
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
              <p className="font-semibold text-[#0F172A]">No conversations yet.</p>
              <p className="mt-1">Customer chats appear here once WhatsApp is connected.</p>
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
                    className="w-full text-left py-3 first:pt-0 last:pb-0 hover:bg-[#F8FAFC] -mx-2 px-2 rounded-xl transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#0F172A] truncate">
                        {contact?.fullName ?? 'Unknown Customer'}
                      </span>
                      <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                        {formatRelativeTime(conv.lastMessageAt)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 truncate mt-0.5">
                      {conv.lastMessagePreview}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                      <span className="capitalize">{conv.status}</span>
                      <span aria-hidden="true">·</span>
                      <span>{assignee ? assignee.fullName : 'Unassigned'}</span>
                      {conv.unreadCount > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-[#E11D48]">
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

        {/* Recent Broadcasts */}
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 flex flex-col shadow-2xs">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold text-[#0F172A]">Recent Broadcasts</h2>
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
              <p className="font-semibold text-[#0F172A]">No campaigns yet.</p>
              <p className="mt-1">Create a broadcast once your contacts and templates are ready.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#E2E8F0] flex-1">
              {campaigns.slice(0, 3).map((cmp) => (
                <div key={cmp.id} className="py-3 first:pt-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[#0F172A] truncate">{cmp.name}</p>
                    <span className="text-[11px] font-medium text-slate-500 capitalize shrink-0">
                      {cmp.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500 tabular-nums">
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

          <div className="mt-4 pt-3 border-t border-[#E2E8F0] flex items-center justify-between text-xs">
            <span className="text-slate-600 flex items-center gap-1.5">
              <AlertCircle
                className={`h-3.5 w-3.5 ${
                  business.metaConnectionState === 'connected'
                    ? 'text-emerald-600'
                    : 'text-[#F4B942]'
                }`}
              />
              WhatsApp Connection
            </span>
            <button
              type="button"
              onClick={() => navigate('/app/settings')}
              className="font-semibold text-[#2563EB] hover:underline cursor-pointer"
            >
              {business.metaConnectionState === 'connected' ? 'Connected' : 'Set Up →'}
            </button>
          </div>
        </div>

        {/* Team Activity */}
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 flex flex-col shadow-2xs">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold text-[#0F172A]">Team Activity</h2>
            <button
              type="button"
              onClick={() => navigate('/app/team')}
              className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
            >
              View Team
            </button>
          </div>

          {teamMembers.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-8 text-center text-xs text-slate-500">
              <p className="font-semibold text-[#0F172A]">No team members listed yet.</p>
              <p className="mt-1">Invite staff members from Team Management.</p>
            </div>
          ) : (
            <div className="space-y-3 flex-1">
              {teamMembers.map((member) => {
                const assignedCount = conversations.filter((c) => c.assignedToId === member.id).length;
                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between gap-3 py-2 border-b border-[#E2E8F0] last:border-0"
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
