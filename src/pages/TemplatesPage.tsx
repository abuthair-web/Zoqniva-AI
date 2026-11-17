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
  UTILITY: 'Customer Updates',
  MARKETING: 'Promotions & Offers',
  AUTHENTICATION: 'Security Codes',
};

const STATUS_LABELS: Record<TemplateApprovalStatus, { label: string; color: string; note: string }> = {
  APPROVED: {
    label: 'Ready to Send',
    color: 'text-emerald-700',
    note: 'Approved by Meta. Ready to use in Broadcasts and Team Inbox.',
  },
  PENDING: {
    label: 'Under Review',
    color: 'text-amber-700',
    note: 'Waiting for Meta review. Cannot be sent to customers until approved.',
  },
  DRAFT: {
    label: 'Saved Draft',
    color: 'text-slate-600',
    note: 'Draft saved locally. Not yet approved by Meta for live sending.',
  },
  REJECTED: {
    label: 'Needs Changes',
    color: 'text-[#E11D48]',
    note: 'Not approved by Meta. Update the wording and resubmit.',
  },
  PAUSED: {
    label: 'Paused',
    color: 'text-amber-700',
    note: 'Temporarily paused by Meta quality controls and cannot be sent right now.',
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
    bodyText:
      'Hello {{1}}, your order {{2}} is packed and scheduled for delivery on {{3}}.',
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
    label: 'Back in Stock Offer',
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
  const [previewTemplate, setPreviewTemplate] = useState<MessageTemplate | null>(
    templates[0] ?? null
  );
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

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return templates.filter((t) => {
      if (statusFilter !== 'ALL' && t.approvalStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        formatReadableName(t.name).toLowerCase().includes(q) ||
        t.bodyText.toLowerCase().includes(q) ||
        CATEGORY_LABELS[t.category].toLowerCase().includes(q)
      );
    });
  }, [templates, searchQuery, statusFilter]);

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
    <div className="p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8 max-w-[1440px] mx-auto space-y-6">
      {/* Page Header — 1 Primary Action */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-[2px] w-5 bg-[#F4B942]" />
            <span className="text-xs font-semibold text-[#2563EB]">Approved WhatsApp Messages</span>
          </div>
          <h2 className="font-display text-2xl font-bold text-[#0F172A] tracking-tight mt-0.5">
            Message Templates
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Pre-approved WhatsApp messages for broadcasts and reaching customers outside the 24-hour reply window.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={syncing || !isMetaConnected}
            onClick={handleMetaSync}
            title={
              !isMetaConnected
                ? 'Connect Meta WhatsApp in Settings to sync live templates'
                : 'Sync templates from your Meta WhatsApp Business account'
            }
            className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-[#2563EB] ${syncing ? 'animate-spin' : ''}`} />
            <span>Sync Templates</span>
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={openCreateDrawer}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] shadow-2xs cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create Template</span>
            </button>
          )}
        </div>
      </div>

      {syncMessage && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs flex items-center justify-between gap-3 ${
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
        <div className="rounded-2xl border border-dashed border-[#E2E8F0] bg-white px-6 py-14 text-center space-y-4">
          <div className="h-12 w-12 rounded-2xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center mx-auto">
            <FileText className="h-6 w-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="font-display text-base font-bold text-[#0F172A]">
              No message templates available.
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              {isMetaConnected
                ? 'Sync approved templates from your Meta WhatsApp Business account or create a draft message.'
                : 'Meta WhatsApp connection is required to sync live approved templates. You can connect WhatsApp in Settings or prepare a draft.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              disabled={syncing || !isMetaConnected}
              onClick={handleMetaSync}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              <span>Sync Templates</span>
            </button>
            {!isMetaConnected && (
              <button
                type="button"
                onClick={() => navigate('/app/settings')}
                className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-4 py-2.5 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
              >
                <Settings className="h-4 w-4 text-[#2563EB]" />
                <span>Connect WhatsApp</span>
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={openCreateDrawer}
                className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-4 py-2.5 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
              >
                <Plus className="h-4 w-4 text-[#2563EB]" />
                <span>Create Draft</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Search & Plain-Language Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search templates by title or message text..."
                className="w-full rounded-xl border border-[#E2E8F0] bg-white pl-9 pr-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
              />
            </div>

            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white border border-[#E2E8F0] overflow-x-auto">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'APPROVED', label: 'Ready to Send' },
                  { id: 'PENDING', label: 'Under Review' },
                  { id: 'DRAFT', label: 'Drafts' },
                  { id: 'REJECTED', label: 'Needs Changes' },
                ] as const
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setStatusFilter(st.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                    statusFilter === st.id
                      ? 'bg-[#2563EB] text-white'
                      : 'text-slate-600 hover:text-[#0F172A]'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {/* Split Layout: Clean Template Cards + Live Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 rounded-2xl border border-[#E2E8F0] bg-white divide-y divide-[#E2E8F0] overflow-hidden">
              {filteredTemplates.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No templates match your current filter.
                </div>
              ) : (
            filteredTemplates.map((tpl) => {
              const active = previewTemplate?.id === tpl.id;
              const statusInfo = STATUS_LABELS[tpl.approvalStatus];
              return (
                <div
                  key={tpl.id}
                  onClick={() => setPreviewTemplate(tpl)}
                  className={`p-4 sm:p-5 cursor-pointer transition-colors ${
                    active ? 'bg-[#EFF6FF]/60' : 'hover:bg-[#F8FAFC]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-8 w-8 rounded-lg bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center shrink-0">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-display text-sm font-bold text-[#0F172A] truncate">
                          {formatReadableName(tpl.name)}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {CATEGORY_LABELS[tpl.category]}
                          {tpl.variablesCount > 0 && ` · ${tpl.variablesCount} custom detail${tpl.variablesCount === 1 ? '' : 's'}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-xs font-semibold ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                      {isAdmin && tpl.approvalStatus === 'DRAFT' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditDrawer(tpl);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
                        >
                          <Edit3 className="h-3 w-3 text-[#2563EB]" />
                          Edit Draft
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 mt-3 line-clamp-2 leading-relaxed">
                    {tpl.bodyText}
                  </p>
                </div>
              );
            })
          )}
        </div>

        {/* Live Customer Preview Panel */}
        <div className="lg:col-span-5 rounded-2xl border border-[#E2E8F0] bg-white p-5 h-fit lg:sticky lg:top-20 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-[#2563EB]" />
              <h3 className="font-display text-sm font-bold text-[#0F172A]">
                How Customers Will See It
              </h3>
            </div>
            {previewTemplate && isAdmin && previewTemplate.approvalStatus === 'DRAFT' && (
              <button
                type="button"
                onClick={() => openEditDrawer(previewTemplate)}
                className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
              >
                Edit Draft
              </button>
            )}
          </div>

          {previewTemplate ? (
            <div className="space-y-4">
              {/* Honest approval status notice */}
              <div
                className={`rounded-xl border px-3.5 py-2.5 text-xs flex items-start gap-2.5 ${
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
                    {STATUS_LABELS[previewTemplate.approvalStatus].label}
                  </p>
                  <p className="text-[11px] mt-0.5">
                    {STATUS_LABELS[previewTemplate.approvalStatus].note}
                  </p>
                </div>
              </div>

              {/* WhatsApp Message Preview */}
              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 space-y-2 shadow-2xs max-w-sm">
                  {previewTemplate.headerText && (
                    <p className="text-xs font-bold text-[#0F172A]">
                      {previewTemplate.headerText}
                    </p>
                  )}
                  <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
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
                          className="text-center py-1.5 rounded-lg bg-[#EFF6FF] text-xs font-semibold text-[#2563EB]"
                        >
                          {b.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  Placeholders like {'{{1}}'} are filled automatically with customer details when sending.
                </p>
              </div>

              {/* Expandable Technical Details */}
              <details className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2.5 text-xs">
                <summary className="font-semibold text-[#0F172A] cursor-pointer flex items-center justify-between">
                  <span>Technical Details</span>
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                </summary>
                <div className="mt-3 space-y-1.5 text-[11px] text-slate-600 border-t border-[#E2E8F0] pt-2.5">
                  <div className="flex justify-between">
                    <span>Meta Template ID</span>
                    <span className="font-mono text-[#0F172A]">{previewTemplate.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Meta Category</span>
                    <span className="font-mono text-[#0F172A]">{previewTemplate.category}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Language Code</span>
                    <span className="font-mono text-[#0F172A]">{previewTemplate.language}</span>
                  </div>
                  {previewTemplate.lastSyncedAt && (
                    <div className="flex justify-between">
                      <span>Last Synced</span>
                      <span>{formatRelativeTime(previewTemplate.lastSyncedAt)}</span>
                    </div>
                  )}
                </div>
              </details>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Select a template from the list to preview it.</p>
          )}
        </div>
      </div>
        </>
      )}

      {/* Create / Edit Template Side Drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex justify-end"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="w-full max-w-lg h-full bg-white border-l border-[#E2E8F0] shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#0F172A]">
                  {editingDraft ? 'Edit Template Draft' : 'Create Message Template'}
                </h3>
                <p className="text-xs text-slate-500">
                  Saved as a draft so you can review it before submitting to Meta.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-[#F8FAFC] cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTemplate} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {formError && (
                <div className="rounded-xl border border-[#E11D48]/30 bg-rose-50 px-3.5 py-2.5 text-[#E11D48]">
                  {formError}
                </div>
              )}

              {/* Quick Starter Templates (only when creating new) */}
              {!editingDraft && (
                <div>
                  <p className="font-semibold text-[#0F172A] mb-2 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[#F4B942]" />
                    Start from a common layout (optional)
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
                  className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">
                  What is this message for?
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as TemplateCategory)}
                  className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 bg-white focus:border-[#2563EB] focus:outline-none"
                >
                  <option value="UTILITY">Customer Updates (Orders, Appointments, Invoices)</option>
                  <option value="MARKETING">Promotions &amp; Offers (Restocks, Sales)</option>
                  <option value="AUTHENTICATION">Security Codes (One-Time Passwords)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-[#0F172A]">Message Text *</label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => insertPlaceholder('{{1}}')}
                      className="text-[11px] font-semibold text-[#2563EB] hover:underline cursor-pointer"
                    >
                      + Customer Name
                    </button>
                    <span className="text-slate-300">·</span>
                    <button
                      type="button"
                      onClick={() => insertPlaceholder('{{2}}')}
                      className="text-[11px] font-semibold text-[#2563EB] hover:underline cursor-pointer"
                    >
                      + Order / Detail
                    </button>
                  </div>
                </div>
                <textarea
                  rows={4}
                  required
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 leading-relaxed focus:border-[#2563EB] focus:outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Use {'{{1}}'}, {'{{2}}'} for personalized details like names or order numbers.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">
                    Bold Heading (Optional)
                  </label>
                  <input
                    type="text"
                    value={headerText}
                    onChange={(e) => setHeaderText(e.target.value)}
                    placeholder="Order Update"
                    className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">
                    Small Footer Note (Optional)
                  </label>
                  <input
                    type="text"
                    value={footerText}
                    onChange={(e) => setFooterText(e.target.value)}
                    placeholder="Reply STOP to opt out"
                    className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>

              {/* Live Drawer Preview */}
              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                <p className="text-[11px] font-semibold text-slate-500 mb-2">Live Preview</p>
                <div className="rounded-xl border border-[#E2E8F0] bg-white p-3 space-y-1.5">
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

              {/* Expandable Technical Details */}
              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]">
                <button
                  type="button"
                  onClick={() => setShowTechnical((s) => !s)}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between font-semibold text-[#0F172A] cursor-pointer"
                >
                  <span>Technical Details (Meta ID &amp; Language)</span>
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
                        Meta Template ID (lowercase_underscore)
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
                  className="rounded-xl border border-[#E2E8F0] px-4 py-2.5 font-semibold text-slate-700 hover:bg-[#F8FAFC] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#2563EB] px-4 py-2.5 font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                >
                  {editingDraft ? 'Save Draft Changes' : 'Save Draft'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
