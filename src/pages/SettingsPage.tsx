import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Users,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { normalizePhoneE164 } from '@/lib/phone';
import type { MessagingMode } from '@/types/crm';

type SettingsTab = 'business' | 'whatsapp' | 'team' | 'notifications' | 'advanced';

export function SettingsPage() {
  const navigate = useNavigate();
  const {
    currentUser,
    isSupabaseReady,
    business,
    teamMembers,
    webhookEvents,
    webhookCallbackUrl,
    webhookSecretsReady,
    updateBusinessProfile,
    verifyMetaConnection,
    saveWhatsAppConfig,
    refreshWebhookDiagnostics,
    businessHours,
    updateBusinessHours,
    auditLogs,
  } = useApp();

  const [tab, setTab] = useState<SettingsTab>('whatsapp');
  const [bizName, setBizName] = useState(business.name);
  const [bizIndustry, setBizIndustry] = useState(business.industry);
  const [bizTimezone, setBizTimezone] = useState(business.timezone);
  const [bizWebsite, setBizWebsite] = useState(business.website);
  const [bizSavedMsg, setBizSavedMsg] = useState<string | null>(null);

  const [phoneNumberId, setPhoneNumberId] = useState(business.metaPhoneNumberId);
  const [wabaId, setWabaId] = useState(business.metaWabaId);
  const [messagingMode, setMessagingMode] = useState<MessagingMode>(business.messagingMode);
  const [allowlistText, setAllowlistText] = useState(business.testAllowlist.join(', '));
  const [verifyMsg, setVerifyMsg] = useState<{
    ok: boolean;
    text: string;
    diagnostic?: string;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [showTechnicalApi, setShowTechnicalApi] = useState(false);

  const [notifPrefs, setNotifPrefs] = useState({
    newConversation: true,
    assignedMention: true,
    failedAlert: true,
    campaignDigest: false,
  });

  useEffect(() => {
    setBizName(business.name);
    setBizIndustry(business.industry);
    setBizTimezone(business.timezone);
    setBizWebsite(business.website);
    setPhoneNumberId(business.metaPhoneNumberId);
    setWabaId(business.metaWabaId);
    setMessagingMode(business.messagingMode);
    setAllowlistText(business.testAllowlist.join(', '));
  }, [business]);

  const isAdmin = currentUser?.role === 'admin';

  const handleSaveBusiness = (e: React.FormEvent) => {
    e.preventDefault();
    updateBusinessProfile({
      name: bizName,
      industry: bizIndustry,
      timezone: bizTimezone,
      website: bizWebsite,
    });
    setBizSavedMsg('Business profile saved.');
  };

  const parseAllowlistInput = (): string[] =>
    allowlistText
      .split(/[\n,;]+/)
      .map((s) => normalizePhoneE164(s.trim()))
      .filter((v): v is string => Boolean(v));

  const handleVerifyMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    const parsedAllowlist = parseAllowlistInput();
    const res = await verifyMetaConnection(phoneNumberId, wabaId, {
      messagingMode,
      testAllowlist: parsedAllowlist,
    });
    setVerifyMsg({ ok: res.ok, text: res.message, diagnostic: res.diagnostic });
    setVerifying(false);
  };

  const handleSaveMessagingMode = async () => {
    setSavingMode(true);
    const parsedAllowlist = parseAllowlistInput();
    const res = await saveWhatsAppConfig({
      messagingMode,
      testAllowlist: parsedAllowlist,
      phoneNumberId,
      wabaId,
    });
    setVerifyMsg({ ok: res.ok, text: res.message });
    setSavingMode(false);
  };

  const handleCopyWebhook = async () => {
    if (!webhookCallbackUrl) return;
    try {
      await navigator.clipboard.writeText(webhookCallbackUrl);
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    } catch {
      // Clipboard fallback ignored cleanly
    }
  };

  const metaStatusMeta = {
    not_connected: {
      label: 'Not Connected Yet',
      desc: 'Your WhatsApp Business number is not connected yet. Follow the quick setup guide below when you are ready to send live messages.',
      color: 'text-slate-700 border-[#E2E8F0] bg-[#F8FAFC]',
    },
    configuration_required: {
      label: 'Setup Needed Before Live Messaging',
      desc: 'You can browse and test everything safely right now. To send real WhatsApp messages to customers, connect your Meta Business account in Technical / API Settings below.',
      color: 'text-amber-900 border-amber-200 bg-amber-50',
    },
    connected: {
      label: 'Connected & Ready',
      desc: 'Your official WhatsApp Business account is verified and ready to send and receive customer messages.',
      color: 'text-emerald-900 border-emerald-200 bg-emerald-50',
    },
    connection_error: {
      label: 'Connection Needs Attention',
      desc: business.metaLastError || 'There was a problem checking your WhatsApp connection.',
      color: 'text-[#E11D48] border-rose-200 bg-rose-50',
    },
  }[business.metaConnectionState];

  const tabs: Array<{
    key: SettingsTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { key: 'business', label: 'Business Profile', icon: Building2 },
    { key: 'whatsapp', label: 'WhatsApp Connection', icon: MessageCircle },
    { key: 'team', label: 'Team & Access', icon: Users },
    { key: 'notifications', label: 'Notifications', icon: Bell },
    { key: 'advanced', label: 'Advanced Settings', icon: Sliders },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8 max-w-[1440px] mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span className="h-[2px] w-5 bg-[#F4B942]" />
          <span className="text-xs font-semibold text-[#2563EB]">Workspace Setup</span>
        </div>
        <h2 className="font-display text-2xl font-bold text-[#0F172A] tracking-tight mt-0.5">
          Settings
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Update your business details, WhatsApp connection, team access, and notification preferences.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* 5 Clean Settings Sections */}
        <nav className="lg:w-60 shrink-0 flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#EFF6FF] text-[#2563EB]'
                    : 'text-slate-600 hover:bg-white hover:text-[#0F172A]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Active Panel */}
        <div className="flex-1 rounded-2xl border border-[#E2E8F0] bg-white p-5 sm:p-6 text-xs">
          {/* 1. Business Profile */}
          {tab === 'business' && (
            <form onSubmit={handleSaveBusiness} className="space-y-4 max-w-lg">
              <div>
                <h3 className="font-display text-base font-bold text-[#0F172A]">Business Profile</h3>
                <p className="text-slate-500 mt-0.5">
                  Shown across your team workspace and used as default schedule timezone.
                </p>
              </div>
              {bizSavedMsg && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-emerald-800">
                  {bizSavedMsg}
                </div>
              )}
              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Business Name</label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                  className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 focus:border-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Industry</label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={bizIndustry}
                  onChange={(e) => setBizIndustry(e.target.value)}
                  className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 focus:border-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">
                  Business Timezone
                </label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={bizTimezone}
                  onChange={(e) => setBizTimezone(e.target.value)}
                  className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 focus:border-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Website</label>
                <input
                  type="url"
                  disabled={!isAdmin}
                  value={bizWebsite}
                  onChange={(e) => setBizWebsite(e.target.value)}
                  className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 focus:border-[#2563EB] focus:outline-none"
                />
              </div>
              {isAdmin && (
                <button
                  type="submit"
                  className="rounded-xl bg-[#2563EB] px-4 py-2.5 font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                >
                  Save Business Profile
                </button>
              )}
            </form>
          )}

          {/* 2. WhatsApp Connection */}
          {tab === 'whatsapp' && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h3 className="font-display text-base font-bold text-[#0F172A]">
                  WhatsApp Connection
                </h3>
                <p className="text-slate-500 mt-1">
                  Connect your official WhatsApp Business number so your team can send and receive real customer messages.
                </p>
              </div>

              <div className={`rounded-2xl border p-4 ${metaStatusMeta.color}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    {business.metaConnectionState === 'connected' ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                    <span>{metaStatusMeta.label}</span>
                  </div>
                  <span
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                      business.messagingMode === 'test'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-emerald-100 text-emerald-900'
                    }`}
                  >
                    {business.messagingMode === 'test' ? 'Test Mode (Allowlist Only)' : 'Live Mode'}
                  </span>
                </div>
                <p className="mt-1.5 leading-relaxed">{metaStatusMeta.desc}</p>
                {business.metaConnectionState === 'connected' && (
                  <div className="mt-3 pt-2.5 border-t border-emerald-200/70 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-emerald-900">
                    {business.whatsappPhoneE164 && business.whatsappPhoneE164 !== '+10000000000' && (
                      <span>
                        Number: <strong className="font-mono">{business.whatsappPhoneE164}</strong>
                      </span>
                    )}
                    {business.verifiedName && (
                      <span>
                        Verified Name: <strong>{business.verifiedName}</strong>
                      </span>
                    )}
                    <span>
                      Quality: <strong className="capitalize">{business.qualityRating || 'unknown'}</strong>
                    </span>
                    <span>
                      Webhook:{' '}
                      <strong>
                        {business.webhookVerifiedAt
                          ? `Verified (${new Date(business.webhookVerifiedAt).toLocaleDateString()})`
                          : 'Awaiting first Meta webhook event'}
                      </strong>
                    </span>
                  </div>
                )}
              </div>

              {/* Plain-language 3-step guide */}
              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-3">
                <p className="font-semibold text-[#0F172A]">How to connect WhatsApp in 3 steps</p>
                <ol className="space-y-2 text-slate-600 list-decimal pl-4">
                  <li>
                    Sign in to your <strong>Meta Business Account</strong> and copy your WhatsApp Phone Number ID and Business Account ID.
                  </li>
                  <li>
                    Open <strong>Technical / API Settings</strong> below to paste those IDs, set your Test Allowlist, and verify the connection.
                  </li>
                  <li>
                    Configure your Meta Webhook Callback URL below and keep your WhatsApp tokens stored securely in Supabase Secrets — never in the browser.
                  </li>
                </ol>
              </div>

              {/* Technical / API Settings Collapsible Section */}
              <div className="rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowTechnicalApi((s) => !s)}
                  className="w-full px-4 py-3.5 flex items-center justify-between font-semibold text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
                >
                  <span>Technical / API Settings (Meta Cloud API &amp; Webhook Setup)</span>
                  <ChevronDown
                    className={`h-4 w-4 text-slate-400 transition-transform ${
                      showTechnicalApi ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {showTechnicalApi && (
                  <div className="p-4 pt-3 border-t border-[#E2E8F0] space-y-5">
                    {verifyMsg && (
                      <div
                        className={`rounded-xl border px-4 py-3 space-y-1 ${
                          verifyMsg.ok
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                            : 'border-rose-200 bg-rose-50 text-[#E11D48]'
                        }`}
                      >
                        <p className="font-semibold">{verifyMsg.text}</p>
                        {isAdmin && verifyMsg.diagnostic && (
                          <p className="text-[11px] font-mono opacity-85">{verifyMsg.diagnostic}</p>
                        )}
                      </div>
                    )}

                    <form onSubmit={handleVerifyMeta} className="space-y-4 max-w-lg">
                      <div>
                        <label className="block font-semibold text-[#0F172A] mb-1">
                          Meta Phone Number ID
                        </label>
                        <input
                          type="text"
                          disabled={!isAdmin}
                          value={phoneNumberId}
                          onChange={(e) => setPhoneNumberId(e.target.value)}
                          placeholder="e.g., 389104521094821"
                          className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-[#0F172A] mb-1">
                          WhatsApp Business Account (WABA) ID
                        </label>
                        <input
                          type="text"
                          disabled={!isAdmin}
                          value={wabaId}
                          onChange={(e) => setWabaId(e.target.value)}
                          placeholder="e.g., 192837465564738"
                          className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2 font-mono"
                        />
                      </div>

                      {isAdmin && (
                        <button
                          type="submit"
                          disabled={verifying}
                          className="rounded-xl bg-[#2563EB] px-4 py-2.5 font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 cursor-pointer"
                        >
                          {verifying ? 'Checking Connection...' : 'Test WhatsApp Connection'}
                        </button>
                      )}
                    </form>

                    {/* Test Mode vs Live Mode Safety Guardrails */}
                    <div className="pt-4 border-t border-[#E2E8F0] space-y-3 max-w-lg">
                      <div className="flex items-center gap-2 font-semibold text-[#0F172A]">
                        <ShieldCheck className="h-4 w-4 text-[#2563EB]" />
                        <span>Messaging Mode &amp; Test Allowlist</span>
                      </div>
                      <p className="text-slate-600 leading-relaxed">
                        In <strong>Test Mode</strong>, 1-to-1 replies only send to phone numbers listed below, and bulk broadcasts and auto-replies stay disabled.
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {(
                          [
                            {
                              value: 'test' as const,
                              title: 'Test Mode (Recommended)',
                              desc: 'Only allowlisted test numbers',
                            },
                            {
                              value: 'live' as const,
                              title: 'Live Mode',
                              desc: 'Any opted-in / open-window customer',
                            },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            disabled={!isAdmin}
                            onClick={() => setMessagingMode(opt.value)}
                            className={`rounded-xl border p-3 text-left cursor-pointer disabled:opacity-60 ${
                              messagingMode === opt.value
                                ? 'border-[#2563EB] bg-[#EFF6FF]/60'
                                : 'border-[#E2E8F0] hover:bg-[#F8FAFC]'
                            }`}
                          >
                            <p className="font-semibold text-[#0F172A]">{opt.title}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">{opt.desc}</p>
                          </button>
                        ))}
                      </div>

                      <div>
                        <label className="block font-semibold text-[#0F172A] mb-1">
                          Authorized Test Phone Numbers (E.164, comma-separated)
                        </label>
                        <textarea
                          rows={2}
                          disabled={!isAdmin}
                          value={allowlistText}
                          onChange={(e) => setAllowlistText(e.target.value)}
                          placeholder="+15551234567, +971501234567"
                          className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2 font-mono"
                        />
                      </div>

                      {isAdmin && (
                        <button
                          type="button"
                          disabled={savingMode}
                          onClick={handleSaveMessagingMode}
                          className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2 font-semibold text-[#0F172A] hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                        >
                          {savingMode ? 'Saving Mode...' : 'Save Messaging Mode'}
                        </button>
                      )}
                    </div>

                    {/* Meta Webhook Callback URL & Diagnostics */}
                    <div className="pt-4 border-t border-[#E2E8F0] space-y-3">
                      <p className="font-semibold text-[#0F172A]">Meta Webhook Callback URL</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={webhookCallbackUrl || 'Set VITE_SUPABASE_URL to generate callback URL'}
                          className="flex-1 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 font-mono text-[11px] text-slate-700"
                        />
                        {webhookCallbackUrl && (
                          <button
                            type="button"
                            onClick={handleCopyWebhook}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 font-semibold text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
                          >
                            {copiedWebhook ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      {isAdmin && (
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-[#0F172A]">
                              Recent Webhook Events
                            </span>
                            <button
                              type="button"
                              onClick={() => void refreshWebhookDiagnostics()}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:underline cursor-pointer"
                            >
                              <RefreshCw className="h-3 w-3" />
                              <span>Refresh</span>
                            </button>
                          </div>
                          {webhookEvents.length === 0 ? (
                            <p className="text-[11px] text-slate-500">
                              No webhook events received yet. Verify your callback URL and subscribe to the{' '}
                              <code>messages</code> field in Meta App Dashboard.
                            </p>
                          ) : (
                            <div className="rounded-xl border border-[#E2E8F0] divide-y divide-[#E2E8F0] max-h-48 overflow-y-auto">
                              {webhookEvents.slice(0, 6).map((ev) => (
                                <div
                                  key={ev.id}
                                  className="px-3 py-2 flex items-center justify-between gap-3 text-[11px]"
                                >
                                  <div className="min-w-0">
                                    <span className="font-semibold text-[#0F172A]">
                                      {ev.signatureValid ? 'Signed' : 'Invalid Sig'} ·{' '}
                                      {ev.processed ? 'Processed' : 'Pending/Error'}
                                    </span>
                                    {ev.processingError && (
                                      <p className="text-[#E11D48] truncate">{ev.processingError}</p>
                                    )}
                                  </div>
                                  <span className="font-mono text-slate-400 shrink-0">
                                    {new Date(ev.receivedAt).toLocaleTimeString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="pt-4 border-t border-[#E2E8F0] space-y-2">
                      <p className="font-semibold text-[#0F172A]">Server Setup Checklist</p>
                      <ul className="list-disc pl-5 space-y-1 text-slate-600">
                        <li>
                          Backend Database Env:{' '}
                          <strong className={isSupabaseReady ? 'text-emerald-700' : 'text-[#E11D48]'}>
                            {isSupabaseReady ? 'Configured' : 'Missing VITE_SUPABASE_URL / PUBLISHABLE_KEY'}
                          </strong>
                        </li>
                        <li>
                          Apply SQL migrations <code>001</code>, <code>002</code>, and{' '}
                          <code>003_whatsapp_messaging_engine.sql</code>.
                        </li>
                        <li>
                          Deploy <code>whatsapp-webhook --no-verify-jwt</code>,{' '}
                          <code>whatsapp-send-message</code>, and <code>whatsapp-connection-check</code>.
                        </li>
                        <li>
                          Configure Supabase Secrets: <code>META_ACCESS_TOKEN</code>,{' '}
                          <code>META_APP_SECRET</code>, <code>META_APP_ID</code>,{' '}
                          <code>META_WABA_ID</code>, <code>META_PHONE_NUMBER_ID</code>,{' '}
                          <code>META_WEBHOOK_VERIFY_TOKEN</code>.
                          {webhookSecretsReady !== null && (
                            <span className="ml-1.5 font-semibold">
                              ({webhookSecretsReady ? 'Webhook secrets ready' : 'Webhook secrets missing'})
                            </span>
                          )}
                        </li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. Team & Access */}
          {tab === 'team' && (
            <div className="space-y-5 max-w-2xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-bold text-[#0F172A]">
                    Team &amp; Access
                  </h3>
                  <p className="text-slate-500 mt-0.5">
                    Currently {teamMembers.length} team member{teamMembers.length === 1 ? '' : 's'} in this workspace.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/app/team')}
                  className="rounded-xl bg-[#2563EB] px-4 py-2.5 font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                >
                  Manage Team Members
                </button>
              </div>

              {teamMembers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#E2E8F0] bg-[#F8FAFC] p-6 text-center text-slate-500">
                  No team members listed yet.
                </div>
              ) : (
                <div className="rounded-2xl border border-[#E2E8F0] divide-y divide-[#E2E8F0]">
                  {teamMembers.map((m) => (
                    <div key={m.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[#0F172A]">{m.fullName}</p>
                        <p className="text-[11px] text-slate-500">{m.email}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold capitalize text-[#0F172A]">{m.role}</p>
                        <p className="text-[11px] capitalize text-slate-500">
                          {m.status === 'suspended' ? 'Paused' : m.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 4. Notifications */}
          {tab === 'notifications' && (
            <div className="space-y-4 max-w-lg">
              <div>
                <h3 className="font-display text-base font-bold text-[#0F172A]">Notifications</h3>
                <p className="text-slate-500 mt-0.5">
                  Choose which alerts you want to see in your workspace.
                </p>
              </div>
              {(
                [
                  { key: 'newConversation', label: 'When a new customer message arrives unassigned' },
                  { key: 'assignedMention', label: 'When a conversation is assigned or handed off to you' },
                  { key: 'failedAlert', label: 'When a WhatsApp message fails to deliver' },
                  { key: 'campaignDigest', label: 'Daily broadcast summary' },
                ] as const
              ).map((item) => (
                <label
                  key={item.key}
                  className="flex items-center justify-between p-3.5 rounded-xl border border-[#E2E8F0] hover:bg-[#F8FAFC] cursor-pointer"
                >
                  <span className="font-medium text-[#0F172A]">{item.label}</span>
                  <input
                    type="checkbox"
                    checked={notifPrefs[item.key]}
                    onChange={(e) =>
                      setNotifPrefs((p) => ({ ...p, [item.key]: e.target.checked }))
                    }
                    className="h-4 w-4 accent-[#2563EB]"
                  />
                </label>
              ))}
            </div>
          )}

          {/* 5. Advanced Settings (Business Hours + Audit Logs + Account Info) */}
          {tab === 'advanced' && (
            <div className="space-y-6 max-w-2xl">
              {/* Business Hours */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-display text-base font-bold text-[#0F172A]">
                    Opening &amp; Support Hours
                  </h3>
                  <p className="text-slate-500 mt-0.5">
                    Used by your Business Hours and Outside-Hours automations.
                  </p>
                </div>
                <div className="divide-y divide-[#E2E8F0] border border-[#E2E8F0] rounded-2xl overflow-hidden">
                  {businessHours.map((row, idx) => (
                    <div
                      key={row.day}
                      className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                    >
                      <label className="flex items-center gap-2.5 font-semibold text-[#0F172A] w-32">
                        <input
                          type="checkbox"
                          disabled={!isAdmin}
                          checked={row.enabled}
                          onChange={(e) => {
                            const next = [...businessHours];
                            next[idx] = { ...row, enabled: e.target.checked };
                            updateBusinessHours(next);
                          }}
                          className="accent-[#2563EB]"
                        />
                        <span>{row.day}</span>
                      </label>

                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          disabled={!isAdmin || !row.enabled}
                          value={row.open}
                          onChange={(e) => {
                            const next = [...businessHours];
                            next[idx] = { ...row, open: e.target.value };
                            updateBusinessHours(next);
                          }}
                          className="rounded-lg border border-[#E2E8F0] px-2.5 py-1"
                        />
                        <span className="text-slate-400">to</span>
                        <input
                          type="time"
                          disabled={!isAdmin || !row.enabled}
                          value={row.close}
                          onChange={(e) => {
                            const next = [...businessHours];
                            next[idx] = { ...row, close: e.target.value };
                            updateBusinessHours(next);
                          }}
                          className="rounded-lg border border-[#E2E8F0] px-2.5 py-1"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Your Account */}
              <div className="space-y-3 pt-4 border-t border-[#E2E8F0]">
                <h4 className="font-display text-sm font-bold text-[#0F172A]">Your Account</h4>
                <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Name</span>
                    <strong className="text-[#0F172A]">{currentUser?.fullName}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Email</span>
                    <strong className="text-[#0F172A]">{currentUser?.email}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Role</span>
                    <strong className="capitalize text-[#2563EB]">{currentUser?.role}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Backend Connection</span>
                    <strong className="text-[#0F172A]">
                      {isSupabaseReady ? 'Connected to Supabase' : 'Setup Required'}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Recent Activity Log */}
              <div className="space-y-3 pt-4 border-t border-[#E2E8F0]">
                <h4 className="font-display text-sm font-bold text-[#0F172A]">
                  Recent Security &amp; Activity Log
                </h4>
                {auditLogs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#E2E8F0] bg-[#F8FAFC] p-6 text-center text-slate-500">
                    No activity recorded yet.
                  </div>
                ) : (
                  <div className="border border-[#E2E8F0] rounded-2xl divide-y divide-[#E2E8F0]">
                    {auditLogs.slice(0, 8).map((log) => (
                      <div key={log.id} className="p-3.5 flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-[#0F172A]">
                            {log.action} · <span className="text-[#2563EB]">{log.actorName}</span>
                          </p>
                          <p className="text-slate-600 mt-0.5">{log.details}</p>
                        </div>
                        <span className="text-[11px] font-mono text-slate-400 shrink-0">
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
