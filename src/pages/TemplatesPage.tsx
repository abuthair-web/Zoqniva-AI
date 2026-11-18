import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Edit3,
  Eye,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { formatRelativeTime } from '@/lib/phone';
import type { MessageTemplate, TemplateApprovalStatus, TemplateCategory } from '@/types/crm';

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  UTILITY: 'Utility',
  MARKETING: 'Marketing',
  AUTHENTICATION: 'Authentication',
};

const STATUS_META: Record<
  TemplateApprovalStatus,
  { label: string; textClass: string; note: string }
> = {
  APPROVED: {
    label: 'Approved',
    textClass: 'text-emerald-700',
    note: 'Approved by Meta. Ready to use in Team Inbox and Campaigns.',
  },
  PENDING: {
    label: 'Pending',
    textClass: 'text-amber-700',
    note: 'Pending Meta review. Cannot be sent to customers until approved.',
  },
  DRAFT: {
    label: 'Local Draft',
    textClass: 'text-slate-600',
    note: 'Saved locally as a draft. Create/submit in Meta Business Manager to approve for sending.',
  },
  REJECTED: {
    label: 'Rejected',
    textClass: 'text-[#E11D48]',
    note: 'Rejected by Meta. Review wording and adjust before resubmitting.',
  },
  PAUSED: {
    label: 'Paused',
    textClass: 'text-amber-700',
    note: 'Paused by Meta quality controls.',
  },
};

const STARTER_LAYOUTS: Array<{
  id: string;
  label: string;
  slug: string;
  category: TemplateCategory;
  headerText: string;
  bodyText: string;
  footerText: string;
}> = [
  {
    id: 'order',
    label: 'Order Update',
    slug: 'order_status_update',
    category: 'UTILITY',
    headerText: 'Order Update',
    bodyText: 'Hello {{1}}, your order {{2}} is packed and scheduled for delivery on {{3}}.',
    footerText: 'Reply here if you have any questions.',
  },
  {
    id: 'appointment',
    label: 'Appointment Reminder',
    slug: 'appointment_reminder_check',
    category: 'UTILITY',
    headerText: 'Appointment Reminder',
    bodyText:
      'Hi {{1}}, this is a friendly reminder for your upcoming visit on {{2}}. Let us know if you need to reschedule.',
    footerText: 'Thank you for choosing us.',
  },
  {
    id: 'restock',
    label: 'Back in Stock',
    slug: 'back_in_stock_alert',
    category: 'MARKETING',
    headerText: 'Back in Stock',
    bodyText:
      'Hi {{1}}, good news — {{2}} is available again! Reply YES if you would like us to reserve yours.',
    footerText: 'Reply STOP to opt out of promotional messages.',
  },
];

function slugifyTemplateName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatReadableName(slug: string): string {
  return slug
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function TemplatesPage() {
  const navigate = useNavigate();
  const {
    currentUser,
    business,
    templates,
    createTemplateDraft,
    updateTemplateDraft,
    syncTemplatesFromMeta,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | TemplateApprovalStatus>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | TemplateCategory>('ALL');
  const [previewTemplate, setPreviewTemplate] = useState<MessageTemplate | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingDraft, setEditingDraft] = useState<MessageTemplate | null>(null);
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);

  // Draft form state
  const [displayTitle, setDisplayTitle] = useState('');
  const [technicalSlug, setTechnicalSlug] = useState('');
  const [category, setCategory] = useState<TemplateCategory>('UTILITY');
  const [language, setLanguage] = useState('en_US');
  const [headerText, setHeaderText] = useState('');
  const [bodyText, setBodyText] = useState('Hello {{1}}, your order {{2}} is confirmed.');
  const [footerText, setFooterText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const isAdmin = currentUser?.role === 'admin';
  const isMetaConnected = business.metaConnectionState === 'connected';

  const statusCounts = useMemo(
    () => ({
      ALL: templates.length,
      APPROVED: templates.filter((t) => t.approvalStatus === 'APPROVED').length,
      PENDING: templates.filter((t) => t.approvalStatus === 'PENDING').length,
      REJECTED: templates.filter((t) => t.approvalStatus === 'REJECTED').length,
      DRAFT: templates.filter((t) => t.approvalStatus === 'DRAFT').length,
    }),
    [templates]
  );

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return templates.filter((t) => {
      if (statusFilter !== 'ALL' && t.approvalStatus !== statusFilter) return false;
      if (categoryFilter !== 'ALL' && t.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        formatReadableName(t.name).toLowerCase().includes(q) ||
        t.bodyText.toLowerCase().includes(q)
      );
    });
  }, [templates, searchQuery, statusFilter, categoryFilter]);

  const handleMetaSync = async () => {
    setSyncing(true);
    const res = await syncTemplatesFromMeta();
    setSyncMessage({ ok: res.ok, text: res.message });
    setSyncing(false);
  };

  const openCreateDrawer = () => {
    setEditingDraft(null);
    setDisplayTitle('');
    setTechnicalSlug('');
    setCategory('UTILITY');
    setLanguage('en_US');
    setHeaderText('Order Update');
    setBodyText('Hello {{1}}, your order {{2}} is confirmed.');
    setFooterText('');
    setFormError(null);
    setShowTechnical(false);
    setDrawerOpen(true);
  };

  const openEditDrawer = (tpl: MessageTemplate) => {
    setEditingDraft(tpl);
    setDisplayTitle(formatReadableName(tpl.name));
    setTechnicalSlug(tpl.name);
    setCategory(tpl.category);
    setLanguage(tpl.language);
    setHeaderText(tpl.headerText ?? '');
    setBodyText(tpl.bodyText);
    setFooterText(tpl.footerText ?? '');
    setFormError(null);
    setShowTechnical(false);
    setDrawerOpen(true);
  };

  const applyStarter = (starter: (typeof STARTER_LAYOUTS)[number]) => {
    setDisplayTitle(starter.label);
    setTechnicalSlug(starter.slug);
    setCategory(starter.category);
    setHeaderText(starter.headerText);
    setBodyText(starter.bodyText);
    setFooterText(starter.footerText);
    setFormError(null);
  };

  const insertPlaceholder = (token: string) => {
    setBodyText((prev) => `${prev}${prev.endsWith(' ') || prev === '' ? '' : ' '}${token}`);
  };

  const handleSaveTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const cleanName = slugifyTemplateName(technicalSlug || displayTitle);
    if (!cleanName || !/^[a-z0-9_]+$/.test(cleanName)) {
      setFormError('Please enter a template title using letters or numbers.');
      return;
    }
    if (!bodyText.trim()) {
      setFormError('Please write the message text customers will see.');
      return;
    }
    const matches = bodyText.match(/\{\{\d+\}\}/g) ?? [];
    const variablesCount = new Set(matches).size;

    if (editingDraft) {
      updateTemplateDraft(editingDraft.id, {
        name: cleanName,
        category,
        language,
        headerType: headerText.trim() ? 'TEXT' : 'NONE',
        headerText: headerText.trim() || undefined,
        bodyText: bodyText.trim(),
        footerText: footerText.trim() || undefined,
        variablesCount,
      });
      setPreviewTemplate({
        ...editingDraft,
        name: cleanName,
        category,
        language,
        headerType: headerText.trim() ? 'TEXT' : 'NONE',
        headerText: headerText.trim() || undefined,
        bodyText: bodyText.trim(),
        footerText: footerText.trim() || undefined,
        variablesCount,
      });
    } else {
      const created = createTemplateDraft({
        name: cleanName,
        category,
        language,
        headerType: headerText.trim() ? 'TEXT' : 'NONE',
        headerText: headerText.trim() || undefined,
        bodyText: bodyText.trim(),
        footerText: footerText.trim() || undefined,
        buttons: [],
        variablesCount,
      });
      setPreviewTemplate(created);
    }

    setDrawerOpen(false);
  };

  const previewBodyWithSamples = (text: string) =>
    text
      .replace(/\{\{1\}\}/g, '[Customer Name]')
      .replace(/\{\{2\}\}/g, '[Order / Reference]')
      .replace(/\{\{3\}\}/g, '[Courier / Service]')
      .replace(/\{\{4\}\}/g, '[Date / Time]');

  return (
    <div className="p-4 sm:p-6 pb-20 lg:pb-8 max-w-[1520px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-xl font-bold text-[#0F172A] tracking-tight">
              Message Templates
            </h2>
            <span className="text-xs font-medium text-slate-500 tabular-nums">
              {templates.length} total
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Sync Meta-approved WhatsApp templates for campaigns and conversations outside the 24-hour window.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={syncing || !isMetaConnected}
            onClick={handleMetaSync}
            title={
              !isMetaConnected
                ? 'Connect Meta WhatsApp in Settings to sync live templates'
                : 'Sync templates from your Meta WhatsApp Business account'
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-[#2563EB] ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync from Meta'}</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={openCreateDrawer}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create Draft</span>
            </button>
          )}
        </div>
      </div>

      {syncMessage && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs flex items-center justify-between gap-3 ${
            syncMessage.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-950'
          }`}
        >
          <span>{syncMessage.text}</span>
          <button type="button" onClick={() => setSyncMessage(null)} className="cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {templates.length === 0 ? (
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-10 text-center space-y-3">
          <div className="h-12 w-12 rounded-xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center mx-auto">
            <FileText className="h-6 w-6" />
          </div>
          <h3 className="font-display text-base font-bold text-[#0F172A]">
            No message templates synced yet
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            {isMetaConnected
              ? 'Sync approved templates directly from your Meta WhatsApp Business account or prepare a local draft.'
              : 'Connect your Meta WhatsApp account in Settings to sync live templates, or create a local draft.'}
          </p>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              disabled={syncing || !isMetaConnected}
              onClick={handleMetaSync}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>Sync from Meta</span>
            </button>
            {!isMetaConnected && (
              <button
                type="button"
                onClick={() => navigate('/app/settings')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
              >
                <Settings className="h-3.5 w-3.5 text-[#2563EB]" />
                <span>Connect WhatsApp</span>
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={openCreateDrawer}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 text-[#2563EB]" />
                <span>Create Local Draft</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Status Tabs & Filter Bar */}
          <div className="rounded-xl border border-[#E2E8F0] bg-white p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-0.5 overflow-x-auto">
              {(
                [
                  { id: 'ALL', label: `All Templates (${statusCounts.ALL})` },
                  { id: 'APPROVED', label: `Approved (${statusCounts.APPROVED})` },
                  { id: 'PENDING', label: `Pending (${statusCounts.PENDING})` },
                  { id: 'REJECTED', label: `Rejected (${statusCounts.REJECTED})` },
                  { id: 'DRAFT', label: `Drafts (${statusCounts.DRAFT})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    statusFilter === tab.id
                      ? 'bg-white text-[#2563EB] shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-[#0F172A]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filter by category"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as 'ALL' | TemplateCategory)}
                className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1.5 text-xs font-medium text-[#0F172A] cursor-pointer"
              >
                <option value="ALL">All Categories</option>
                <option value="UTILITY">Utility</option>
                <option value="MARKETING">Marketing</option>
                <option value="AUTHENTICATION">Authentication</option>
              </select>

              <div className="relative flex-1 sm:w-64">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search templates..."
                  className="w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-8 pr-3 py-1.5 text-xs focus:border-[#2563EB] focus:bg-white focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2.5">
            {filteredTemplates.map((tpl) => {
              const st = STATUS_META[tpl.approvalStatus];
              return (
                <div
                  key={tpl.id}
                  onClick={() => setPreviewTemplate(tpl)}
                  className="rounded-xl border border-[#E2E8F0] bg-white p-4 space-y-2 text-xs cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[#0F172A]">
                        {formatReadableName(tpl.name)}
                      </p>
                      <p className="text-[11px] font-mono text-slate-400">{tpl.name}</p>
                    </div>
                    <span className={`font-semibold shrink-0 ${st.textClass}`}>{st.label}</span>
                  </div>
                  <p className="text-slate-600 line-clamp-2">{tpl.bodyText}</p>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-[#E2E8F0]">
                    <span>
                      {CATEGORY_LABELS[tpl.category]} · {tpl.language}
                    </span>
                    <span className="font-semibold text-[#2563EB]">Preview</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Compact Table */}
          <div className="hidden md:block rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Template Name</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Language</th>
                    <th className="py-3 px-4">Meta Status</th>
                    <th className="py-3 px-4">Variables</th>
                    <th className="py-3 px-4">Last Synced</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-xs">
                  {filteredTemplates.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500">
                        No templates match your current filter.
                      </td>
                    </tr>
                  ) : (
                    filteredTemplates.map((tpl) => {
                      const st = STATUS_META[tpl.approvalStatus];
                      const active = previewTemplate?.id === tpl.id;
                      return (
                        <tr
                          key={tpl.id}
                          onClick={() => setPreviewTemplate(tpl)}
                          className={`cursor-pointer transition-colors ${
                            active ? 'bg-[#EFF6FF]/60' : 'hover:bg-[#F8FAFC]'
                          }`}
                        >
                          <td className="py-3 px-4">
                            <p className="font-semibold text-[#0F172A]">
                              {formatReadableName(tpl.name)}
                            </p>
                            <p className="text-[11px] font-mono text-slate-400">{tpl.name}</p>
                          </td>
                          <td className="py-3 px-4 text-slate-700">
                            {CATEGORY_LABELS[tpl.category]}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-600">{tpl.language}</td>
                          <td className="py-3 px-4">
                            <span className={`font-semibold ${st.textClass}`}>{st.label}</span>
                          </td>
                          <td className="py-3 px-4 tabular-nums text-slate-600">
                            {tpl.variablesCount}
                          </td>
                          <td className="py-3 px-4 text-slate-500 tabular-nums">
                            {tpl.lastSyncedAt ? formatRelativeTime(tpl.lastSyncedAt) : 'Local draft'}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewTemplate(tpl);
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
                              >
                                <Eye className="h-3 w-3 text-[#2563EB]" />
                                Preview
                              </button>
                              {isAdmin && tpl.approvalStatus === 'DRAFT' && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditDrawer(tpl);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
                                >
                                  <Edit3 className="h-3 w-3 text-[#2563EB]" />
                                  Edit
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Right Slide-Over Template Preview Drawer */}
      {previewTemplate && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex justify-end"
          onClick={() => setPreviewTemplate(null)}
        >
          <div
            className="w-full max-w-md h-full bg-white border-l border-[#E2E8F0] shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="font-display text-base font-bold text-[#0F172A] truncate">
                  {formatReadableName(previewTemplate.name)}
                </h3>
                <p className="text-[11px] font-mono text-slate-500 truncate">
                  {previewTemplate.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewTemplate(null)}
                className="p-1.5 rounded-md text-slate-500 hover:bg-[#F1F5F9] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div
                className={`rounded-lg border px-3.5 py-2.5 flex items-start gap-2.5 ${
                  previewTemplate.approvalStatus === 'APPROVED'
                    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                    : previewTemplate.approvalStatus === 'PENDING'
                    ? 'border-amber-200 bg-amber-50/70 text-amber-950'
                    : previewTemplate.approvalStatus === 'REJECTED'
                    ? 'border-rose-200 bg-rose-50 text-[#E11D48]'
                    : 'border-[#E2E8F0] bg-[#F8FAFC] text-slate-700'
                }`}
              >
                {previewTemplate.approvalStatus === 'APPROVED' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                ) : previewTemplate.approvalStatus === 'PENDING' ? (
                  <Clock className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-semibold">
                    {STATUS_META[previewTemplate.approvalStatus].label}
                  </p>
                  <p className="text-[11px] mt-0.5">
                    {previewTemplate.rejectionReason ||
                      STATUS_META[previewTemplate.approvalStatus].note}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <p className="text-[11px] font-semibold text-slate-500 mb-2">
                  WhatsApp Message Preview
                </p>
                <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 space-y-2">
                  {previewTemplate.headerText && (
                    <p className="font-bold text-[#0F172A]">{previewTemplate.headerText}</p>
                  )}
                  <p className="text-slate-800 whitespace-pre-wrap leading-relaxed">
                    {previewBodyWithSamples(previewTemplate.bodyText)}
                  </p>
                  {previewTemplate.footerText && (
                    <p className="text-[11px] text-slate-400">{previewTemplate.footerText}</p>
                  )}
                  {previewTemplate.buttons.length > 0 && (
                    <div className="pt-2 border-t border-[#E2E8F0] space-y-1.5">
                      {previewTemplate.buttons.map((b, i) => (
                        <div
                          key={i}
                          className="text-center py-1.5 rounded-lg bg-[#EFF6FF] font-semibold text-[#2563EB]"
                        >
                          {b.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 space-y-2 text-[11px]">
                <p className="font-bold text-xs text-[#0F172A]">Metadata</p>
                <div className="flex justify-between">
                  <span className="text-slate-500">Category</span>
                  <span className="font-mono text-[#0F172A]">{previewTemplate.category}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Language</span>
                  <span className="font-mono text-[#0F172A]">{previewTemplate.language}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Variables</span>
                  <span className="tabular-nums text-[#0F172A]">
                    {previewTemplate.variablesCount}
                  </span>
                </div>
                {previewTemplate.lastSyncedAt && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Last Synced</span>
                    <span>{formatRelativeTime(previewTemplate.lastSyncedAt)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-[#E2E8F0] flex items-center justify-end gap-2 bg-[#F8FAFC]">
              {isAdmin && previewTemplate.approvalStatus === 'DRAFT' && (
                <button
                  type="button"
                  onClick={() => {
                    const tpl = previewTemplate;
                    setPreviewTemplate(null);
                    openEditDrawer(tpl);
                  }}
                  className="rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                >
                  Edit Draft
                </button>
              )}
              <button
                type="button"
                onClick={() => setPreviewTemplate(null)}
                className="rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Local Draft Drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex justify-end"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="w-full max-w-lg h-full bg-white border-l border-[#E2E8F0] shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#0F172A]">
                  {editingDraft ? 'Edit Local Template Draft' : 'Create Local Template Draft'}
                </h3>
                <p className="text-xs text-slate-500">
                  Saved locally as a draft. Live sending requires Meta approval via Sync from Meta.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-md text-slate-500 hover:bg-[#F1F5F9] cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTemplate} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {formError && (
                <div className="rounded-lg border border-[#E11D48]/30 bg-rose-50 px-3.5 py-2.5 text-[#E11D48]">
                  {formError}
                </div>
              )}

              {!editingDraft && (
                <div>
                  <p className="font-semibold text-[#0F172A] mb-2 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[#F4B942]" />
                    Starter Layouts
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {STARTER_LAYOUTS.map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => applyStarter(st)}
                        className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:border-[#2563EB] hover:bg-[#EFF6FF] cursor-pointer"
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">
                  Template Title *
                </label>
                <input
                  type="text"
                  required
                  value={displayTitle}
                  onChange={(e) => {
                    setDisplayTitle(e.target.value);
                    if (!editingDraft) {
                      setTechnicalSlug(slugifyTemplateName(e.target.value));
                    }
                  }}
                  placeholder="e.g., Order Shipped Update"
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as TemplateCategory)}
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 bg-white focus:border-[#2563EB] focus:outline-none"
                >
                  <option value="UTILITY">Utility (Orders, Appointments, Invoices)</option>
                  <option value="MARKETING">Marketing (Restocks, Promotions)</option>
                  <option value="AUTHENTICATION">Authentication (One-Time Codes)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-[#0F172A]">Body Text *</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => insertPlaceholder('{{1}}')}
                      className="text-[11px] font-semibold text-[#2563EB] hover:underline cursor-pointer"
                    >
                      + {'{{1}}'}
                    </button>
                    <button
                      type="button"
                      onClick={() => insertPlaceholder('{{2}}')}
                      className="text-[11px] font-semibold text-[#2563EB] hover:underline cursor-pointer"
                    >
                      + {'{{2}}'}
                    </button>
                  </div>
                </div>
                <textarea
                  rows={4}
                  required
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 leading-relaxed focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">
                    Header Text (Optional)
                  </label>
                  <input
                    type="text"
                    value={headerText}
                    onChange={(e) => setHeaderText(e.target.value)}
                    placeholder="Order Update"
                    className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">
                    Footer Note (Optional)
                  </label>
                  <input
                    type="text"
                    value={footerText}
                    onChange={(e) => setFooterText(e.target.value)}
                    placeholder="Reply STOP to opt out"
                    className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                <p className="text-[11px] font-semibold text-slate-500 mb-2">Live Preview</p>
                <div className="rounded-lg border border-[#E2E8F0] bg-white p-3 space-y-1.5">
                  {headerText.trim() && (
                    <p className="font-bold text-[#0F172A]">{headerText.trim()}</p>
                  )}
                  <p className="text-slate-800 whitespace-pre-wrap leading-relaxed">
                    {previewBodyWithSamples(bodyText)}
                  </p>
                  {footerText.trim() && (
                    <p className="text-[11px] text-slate-400">{footerText.trim()}</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
                <button
                  type="button"
                  onClick={() => setShowTechnical((s) => !s)}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between font-semibold text-[#0F172A] cursor-pointer"
                >
                  <span>Technical Details (Meta Slug &amp; Language)</span>
                  <ChevronDown
                    className={`h-4 w-4 text-slate-400 transition-transform ${
                      showTechnical ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {showTechnical && (
                  <div className="px-3.5 pb-3.5 pt-2 border-t border-[#E2E8F0] grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-[#0F172A] mb-1">
                        Meta Template Slug
                      </label>
                      <input
                        type="text"
                        value={technicalSlug}
                        onChange={(e) => setTechnicalSlug(e.target.value)}
                        placeholder="order_status_update"
                        className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-[#0F172A] mb-1">Language</label>
                      <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 font-mono"
                      >
                        <option value="en_US">English (en_US)</option>
                        <option value="ar">Arabic (ar)</option>
                        <option value="es">Spanish (es)</option>
                        <option value="fr">French (fr)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-lg border border-[#E2E8F0] px-3.5 py-2 font-semibold text-slate-700 hover:bg-[#F1F5F9] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#2563EB] px-4 py-2 font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                >
                  {editingDraft ? 'Save Draft Changes' : 'Save Local Draft'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
