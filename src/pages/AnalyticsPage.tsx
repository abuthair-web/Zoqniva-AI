import React, { useMemo, useState } from 'react';
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
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  Inbox,
  Megaphone,
  Send,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';

const RANGE_LABELS: Record<'today' | '7d' | '30d', string> = {
  today: 'Today',
  '7d': '7 Days',
  '30d': '30 Days',
};

export function AnalyticsPage() {
  const {
    campaigns,
    teamMembers,
    automationRules,
    conversations,
    messages,
    dateRange,
    setDateRange,
  } = useApp();

  const [showDetailed, setShowDetailed] = useState(false);

  const activitySeries = useMemo(() => {
    if (messages.length === 0 && conversations.length === 0) return [];

    const now = new Date();
    const days = dateRange === 'today' ? 1 : dateRange === '7d' ? 7 : 30;
    const buckets: Array<{
      key: string;
      date: string;
      inbound: number;
      outbound: number;
      delivered: number;
      resolved: number;
      failed: number;
    }> = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      buckets.push({
        key,
        date: label,
        inbound: 0,
        outbound: 0,
        delivered: 0,
        resolved: 0,
        failed: 0,
      });
    }

    const bucketMap = new Map(buckets.map((b) => [b.key, b]));
    for (const msg of messages) {
      const key = msg.createdAt.slice(0, 10);
      const bucket = bucketMap.get(key);
      if (!bucket) continue;
      if (msg.direction === 'inbound') bucket.inbound += 1;
      if (msg.direction === 'outbound') {
        bucket.outbound += 1;
        if (msg.deliveryStatus === 'delivered' || msg.deliveryStatus === 'read') {
          bucket.delivered += 1;
        }
        if (msg.deliveryStatus === 'failed') {
          bucket.failed += 1;
        }
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

  const keyStats = useMemo(() => {
    const outbound = messages.filter((m) => m.direction === 'outbound');
    const delivered = outbound.filter((m) => ['delivered', 'read'].includes(m.deliveryStatus)).length;
    const failed = outbound.filter((m) => m.deliveryStatus === 'failed').length;
    const activeThreads = conversations.filter((c) => c.status !== 'resolved').length;
    const completedCampaigns = campaigns.filter((c) => c.metrics.sent > 0);
    const totalCampaignSent = completedCampaigns.reduce((s, c) => s + c.metrics.sent, 0);
    const totalCampaignRead = completedCampaigns.reduce((s, c) => s + c.metrics.read, 0);
    const campaignReadRate =
      totalCampaignSent > 0 ? Math.round((totalCampaignRead / totalCampaignSent) * 100) : 0;

    return {
      messagesSent: outbound.length,
      messagesDelivered: delivered,
      failedMessages: failed,
      activeConversations: activeThreads,
      campaignReadRate,
      completedCampaignCount: completedCampaigns.length,
    };
  }, [messages, conversations, campaigns]);

  const deliveryTotals = useMemo(() => {
    const outbound = messages.filter((m) => m.direction === 'outbound');
    return [
      { stage: 'Sent', count: outbound.length },
      {
        stage: 'Delivered',
        count: outbound.filter((m) => ['delivered', 'read'].includes(m.deliveryStatus)).length,
      },
      {
        stage: 'Read',
        count: outbound.filter((m) => m.deliveryStatus === 'read').length,
      },
      {
        stage: 'Failed',
        count: outbound.filter((m) => m.deliveryStatus === 'failed').length,
      },
    ];
  }, [messages]);

  const handleExportAnalyticsCsv = () => {
    const rows = [
      ['Period', 'Inbound', 'Outbound', 'Delivered', 'Resolved', 'Failed'],
      ...activitySeries.map((r) => [
        r.date,
        r.inbound,
        r.outbound,
        r.delivered,
        r.resolved,
        r.failed,
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zoqniva-analytics-${dateRange}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const primaryCards = [
    {
      label: 'Messages Sent',
      value: keyStats.messagesSent,
      helper: 'Total replies and updates sent by your team',
      icon: Send,
      tone: 'blue',
    },
    {
      label: 'Messages Delivered',
      value: keyStats.messagesDelivered,
      helper: 'Confirmed delivered to customer phones',
      icon: CheckCircle2,
      tone: 'blue',
    },
    {
      label: 'Failed Messages',
      value: keyStats.failedMessages,
      helper: keyStats.failedMessages > 0 ? 'Needs attention or WhatsApp connection' : 'No delivery issues',
      icon: AlertTriangle,
      tone: keyStats.failedMessages > 0 ? 'crimson' : 'blue',
    },
    {
      label: 'Active Conversations',
      value: keyStats.activeConversations,
      helper: 'Open or waiting customer chats right now',
      icon: Inbox,
      tone: 'blue',
    },
    {
      label: 'Campaign Results',
      value: `${keyStats.campaignReadRate}% read`,
      helper: `${keyStats.completedCampaignCount} completed campaign${keyStats.completedCampaignCount === 1 ? '' : 's'}`,
      icon: Megaphone,
      tone: 'gold',
    },
  ] as const;

  return (
    <div className="p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8 max-w-[1440px] mx-auto space-y-6">
      {/* Header + Simple Date Filter (Today / 7 Days / 30 Days) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-[2px] w-5 bg-[#F4B942]" />
            <span className="text-xs font-semibold text-[#2563EB]">Business Results</span>
          </div>
          <h2 className="font-display text-2xl font-bold text-[#0F172A] tracking-tight mt-0.5">
            Analytics
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Track message delivery, open conversations, and campaign performance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white border border-[#E2E8F0]">
            {(['today', '7d', '30d'] as const).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setDateRange(range)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  dateRange === range
                    ? 'bg-[#2563EB] text-white'
                    : 'text-slate-600 hover:text-[#0F172A]'
                }`}
              >
                {RANGE_LABELS[range]}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={activitySeries.length === 0}
            onClick={handleExportAnalyticsCsv}
            className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-[#2563EB]" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* 5 Key Plain-Language Metrics First */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {primaryCards.map((card) => {
          const Icon = card.icon;
          const iconClass =
            card.tone === 'crimson'
              ? 'bg-rose-50 text-[#E11D48]'
              : card.tone === 'gold'
              ? 'bg-amber-50 text-amber-700'
              : 'bg-[#EFF6FF] text-[#2563EB]';
          return (
            <div
              key={card.label}
              className="rounded-2xl border border-[#E2E8F0] bg-white p-4 flex flex-col justify-between gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-600">{card.label}</span>
                <div className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <p className="font-display text-2xl font-bold text-[#0F172A] tabular-nums">
                {card.value}
              </p>
              <p className="text-[11px] text-slate-500 leading-snug">{card.helper}</p>
            </div>
          );
        })}
      </div>

      {/* 1 Clean Primary Chart */}
      <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="font-display text-base font-bold text-[#0F172A]">
              Customer Replies &amp; Outgoing Messages ({RANGE_LABELS[dateRange]})
            </h3>
            <p className="text-xs text-slate-500">
              See how many messages your business sent compared to incoming customer replies.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-[#2563EB]" /> Sent by Team
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-[#F4B942]" /> Customer Replies
            </span>
          </div>
        </div>
        {activitySeries.length === 0 ? (
          <div className="h-64 rounded-xl border border-dashed border-[#E2E8F0] bg-[#F8FAFC] flex flex-col items-center justify-center text-center px-6 space-y-2">
            <Inbox className="h-7 w-7 text-slate-400" />
            <p className="font-display text-sm font-bold text-[#0F172A]">No analytics data yet.</p>
            <p className="text-xs text-slate-500 max-w-md">
              Message volume, delivery confirmations, and conversation trends will appear here automatically once customer messages or campaigns are recorded.
            </p>
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activitySeries}>
                <defs>
                  <linearGradient id="anOutGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="outbound" name="Sent by Team" stroke="#2563EB" strokeWidth={2} fill="url(#anOutGrad)" />
                <Area type="monotone" dataKey="inbound" name="Customer Replies" stroke="#F4B942" strokeWidth={2} fillOpacity={0} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Progressive Disclosure: Detailed Analytics */}
      <div className="rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden">
        <button
          type="button"
          onClick={() => setShowDetailed((s) => !s)}
          className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-[#F8FAFC] transition-colors cursor-pointer"
        >
          <div>
            <h3 className="font-display text-sm font-bold text-[#0F172A]">Detailed Analytics</h3>
            <p className="text-xs text-slate-500">
              Delivery breakdown, team workload, and individual campaign numbers
            </p>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-slate-500 transition-transform ${
              showDetailed ? 'rotate-180' : ''
            }`}
          />
        </button>

        {showDetailed && (
          <div className="p-5 pt-2 border-t border-[#E2E8F0] space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <h4 className="font-display text-sm font-bold text-[#0F172A]">
                  Message Delivery Breakdown
                </h4>
                <p className="text-xs text-slate-500 mb-3">
                  Based on outgoing messages recorded in this workspace
                </p>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={deliveryTotals} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                      <YAxis
                        dataKey="stage"
                        type="category"
                        tick={{ fontSize: 12, fill: '#0F172A', fontWeight: 600 }}
                        axisLine={false}
                        tickLine={false}
                        width={76}
                      />
                      <Tooltip />
                      <Bar dataKey="count" name="Messages" fill="#2563EB" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <h4 className="font-display text-sm font-bold text-[#0F172A] mb-3">
                  Team Workload
                </h4>
                {teamMembers.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4">No team members listed yet.</p>
                ) : (
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#E2E8F0] text-slate-500">
                        <th className="py-2 font-semibold">Team Member</th>
                        <th className="py-2 font-semibold">Role</th>
                        <th className="py-2 font-semibold text-right">Assigned</th>
                        <th className="py-2 font-semibold text-right">Resolved Today</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {teamMembers.map((m) => {
                        const assignedCount = conversations.filter((c) => c.assignedToId === m.id).length;
                        return (
                          <tr key={m.id}>
                            <td className="py-2.5 font-semibold text-[#0F172A]">{m.fullName}</td>
                            <td className="py-2.5 capitalize text-slate-600">{m.role}</td>
                            <td className="py-2.5 text-right font-mono tabular-nums">{assignedCount}</td>
                            <td className="py-2.5 text-right font-mono tabular-nums text-[#2563EB]">
                              {m.resolvedToday}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
              <h4 className="font-display text-sm font-bold text-[#0F172A] mb-3">
                Campaign &amp; Automation Breakdown
              </h4>
              <div className="space-y-2.5 text-xs">
                {campaigns.length === 0 ? (
                  <p className="text-slate-500 py-2">No broadcast campaigns created yet.</p>
                ) : (
                  campaigns.map((cp) => (
                    <div
                      key={cp.id}
                      className="flex items-center justify-between py-2 border-b border-[#E2E8F0]"
                    >
                      <div>
                        <p className="font-semibold text-[#0F172A]">{cp.name}</p>
                        <p className="text-[11px] text-slate-500 capitalize">{cp.status}</p>
                      </div>
                      <div className="text-right font-mono tabular-nums">
                        <p className="font-semibold text-[#2563EB]">
                          {cp.metrics.delivered} / {cp.metrics.eligible} delivered
                        </p>
                        <p className="text-[11px] text-slate-500">{cp.metrics.read} read</p>
                      </div>
                    </div>
                  ))
                )}
                <div className="pt-1 flex items-center justify-between text-slate-600">
                  <span>Total Automated Actions Triggered</span>
                  <strong className="font-mono text-[#0F172A] tabular-nums">
                    {automationRules.reduce((s, r) => s + r.executionCount, 0)}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
