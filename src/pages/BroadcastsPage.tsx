import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileText,
  Loader2,
  Megaphone,
  Pause,
  Play,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import type { Campaign, CampaignStatus, TemplateCategory } from '@/types/crm';

const DRAFT_STORAGE_KEY = 'zoqniva_broadcast_composer_draft';

const HUMAN_VAR_LABELS: Record<string, string> = {
  '1': 'Customer Name',
  '2': 'Order or Offer Detail',
  '3': 'Courier or Reference',
  '4': 'Estimated Date or Time',
};

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  UTILITY: 'Utility',
  MARKETING: 'Marketing',
  AUTHENTICATION: 'Authentication',
};

type WizardStage = 1 | 2 | 3;

export function BroadcastsPage() {
  const {
    currentUser,
    business,
    campaigns,
    templates,
    tags,
    contacts,
    recentTemplateIds,
    createCampaign,
    duplicateCampaign,
    updateCampaignStatus,
  } = useApp();

  const location = useLocation();
  const isAdmin = currentUser?.role === 'admin';

  const [viewMode, setViewMode] = useState<'list' | 'compose'>('list');
  const [statusFilter, setStatusFilter] = useState<'all' | CampaignStatus>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'name' | 'audience'>('newest');
  const [searchCampaign, setSearchCampaign] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 25 | 50>(10);

  const [reportCampaign, setReportCampaign] = useState<Campaign | null>(null);
  const [bannerFeedback, setBannerFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);

  const approvedTemplates = useMemo(() => {
    const approved = templates.filter((t) => t.approvalStatus === 'APPROVED');
    return approved.sort((a, b) => {
      const aIdx = recentTemplateIds.indexOf(a.id);
      const bIdx = recentTemplateIds.indexOf(b.id);
      if (aIdx === -1 && bIdx === -1) return 0;
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
  }, [templates, recentTemplateIds]);

  const savedDraft = useMemo(() => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  // Stage 1: Choose Template -> Stage 2: Choose Audience -> Stage 3: Review & Schedule
  const [wizardStage, setWizardStage] = useState<WizardStage>(
    savedDraft?.wizardStage === 2 || savedDraft?.wizardStage === 3 ? savedDraft.wizardStage : 1
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    savedDraft?.selectedTemplateId || approvedTemplates[0]?.id || ''
  );
  const [templateSearch, setTemplateSearch] = useState('');
  const [varMapping, setVarMapping] = useState<Record<string, string>>(
    savedDraft?.varMapping ?? {}
  );

  const [audienceMode, setAudienceMode] = useState<'all' | 'groups' | 'specific'>(
    savedDraft?.audienceMode ?? 'all'
  );
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(savedDraft?.selectedTagIds ?? []);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>(
    savedDraft?.selectedContactIds ?? []
  );
  const [contactSearch, setContactSearch] = useState('');
  const [showExcludedDetails, setShowExcludedDetails] = useState(false);

  const [scheduleMode, setScheduleMode] = useState<'immediate' | 'scheduled'>(
    savedDraft?.scheduleMode ?? 'immediate'
  );
  const [scheduledFor, setScheduledFor] = useState<string>(
    savedDraft?.scheduledFor ??
      new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16)
  );
  const [customName, setCustomName] = useState<string>(savedDraft?.customName ?? '');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const state = location.state as { openWizard?: boolean } | null;
    if (state?.openWizard && isAdmin) {
      setWizardStage(1);
      setViewMode('compose');
    }
  }, [location.state, isAdmin]);

  useEffect(() => {
    if (viewMode === 'compose') {
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({
          wizardStage,
          audienceMode,
          selectedTagIds,
          selectedContactIds,
          selectedTemplateId,
          varMapping,
          scheduleMode,
          scheduledFor,
          customName,
        })
      );
    }
  }, [
    viewMode,
    wizardStage,
    audienceMode,
    selectedTagIds,
    selectedContactIds,
    selectedTemplateId,
    varMapping,
    scheduleMode,
    scheduledFor,
    customName,
  ]);

  const selectedTemplate = useMemo(
    () =>
      approvedTemplates.find((t) => t.id === selectedTemplateId) ?? approvedTemplates[0] ?? null,
    [approvedTemplates, selectedTemplateId]
  );

  const filteredTemplatesForWizard = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return approvedTemplates;
    return approvedTemplates.filter(
      (t) => t.name.toLowerCase().includes(q) || t.bodyText.toLowerCase().includes(q)
    );
  }, [approvedTemplates, templateSearch]);

  const audienceStats = useMemo(() => {
    let matched = contacts;
    if (audienceMode === 'groups') {
      matched =
        selectedTagIds.length === 0
          ? []
          : contacts.filter((c) => c.tagIds.some((tid) => selectedTagIds.includes(tid)));
    } else if (audienceMode === 'specific') {
      matched = contacts.filter((c) => selectedContactIds.includes(c.id));
    }

    const eligible = matched.filter(
      (c) => c.marketingOptIn && /^\+[1-9][0-9]{6,14}$/.test(c.phoneE164)
    );
    const optedOutCount = matched.filter((c) => !c.marketingOptIn).length;
    const invalidPhoneCount = matched.length - eligible.length - optedOutCount;

    return {
      selectedCount: matched.length,
      eligibleCount: eligible.length,
      skippedCount: matched.length - eligible.length,
      optedOutCount,
      invalidPhoneCount,
    };
  }, [contacts, audienceMode, selectedTagIds, selectedContactIds]);

  const autoCampaignName = useMemo(() => {
    const groupPart =
      audienceMode === 'all'
        ? 'All Opted-In Contacts'
        : audienceMode === 'groups' && selectedTagIds.length > 0
        ? tags
            .filter((t) => selectedTagIds.includes(t.id))
            .map((t) => t.name)
            .slice(0, 2)
            .join(' & ')
        : 'Selected Contacts';
    const tplLabel = selectedTemplate
      ? selectedTemplate.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : 'Campaign';
    const dateLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${groupPart} · ${tplLabel} (${dateLabel})`;
  }, [audienceMode, selectedTagIds, tags, selectedTemplate]);

  const renderedPreview = useMemo(() => {
    if (!selectedTemplate) return '';
    let text = selectedTemplate.bodyText;
    for (let i = 1; i <= selectedTemplate.variablesCount; i++) {
      const val = varMapping[String(i)]?.trim() || `[Detail ${i}]`;
      text = text.replace(new RegExp(`\\{\\{${i}\\}\\}`, 'g'), val);
    }
    return text;
  }, [selectedTemplate, varMapping]);

  const filteredContactsForPicker = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    return contacts.filter(
      (c) =>
        !q ||
        c.fullName.toLowerCase().includes(q) ||
        c.phoneE164.includes(q) ||
        c.company.toLowerCase().includes(q)
    );
  }, [contacts, contactSearch]);

  const filteredCampaigns = useMemo(() => {
    const q = searchCampaign.trim().toLowerCase();
    const list = campaigns.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q);
    });

    return list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'audience') return b.metrics.eligible - a.metrics.eligible;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [campaigns, statusFilter, searchCampaign, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredCampaigns.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedCampaigns = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCampaigns.slice(start, start + pageSize);
  }, [filteredCampaigns, currentPage, pageSize]);

  const formatTemplateTitle = (slug: string) =>
    slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const handleOpenNewWizard = () => {
    setWizardStage(1);
    setConsentConfirmed(false);
    setComposeError(null);
    setViewMode('compose');
  };

  const dispatchDisabledReason =
    business.messagingMode === 'test'
      ? 'Test Mode is active — bulk campaign dispatch is disabled. Confirming saves this campaign as a draft.'
      : business.metaConnectionState !== 'connected'
      ? 'WhatsApp is not connected — confirming saves this campaign as a draft only.'
      : null;

  const handleSubmitBroadcast = async (asDraft: boolean) => {
    if (submitting || !selectedTemplate) return;
    if (!asDraft && (!consentConfirmed || audienceStats.eligibleCount === 0)) return;

    setComposeError(null);
    setSubmitting(true);

    try {
      const res = await createCampaign({
        name: customName.trim() || autoCampaignName,
        templateId: selectedTemplate.id,
        audienceMode,
        targetTagIds: audienceMode === 'groups' ? selectedTagIds : [],
        targetContactIds: audienceMode === 'specific' ? selectedContactIds : undefined,
        variableMapping: varMapping,
        scheduleMode: asDraft ? 'draft' : scheduleMode,
        scheduledFor:
          !asDraft && scheduleMode === 'scheduled'
            ? new Date(scheduledFor).toISOString()
            : undefined,
        selectedCount: audienceStats.selectedCount,
        eligibleCount: audienceStats.eligibleCount,
        skippedCount: audienceStats.skippedCount,
      });

      if (!res.ok || !res.campaign) {
        // Keep composer open and retain all entered campaign details on error
        setComposeError(res.error ?? 'Could not save campaign draft in Supabase.');
        return;
      }

      const created = res.campaign;
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      setCustomName('');
      setConsentConfirmed(false);
      setWizardStage(1);
      setViewMode('list');

      if (created.status === 'draft') {
        setBannerFeedback({
          ok: true,
          text: `Saved "${created.name}" as a draft in Supabase (${created.metrics.eligible} opted-in recipient${
            created.metrics.eligible === 1 ? '' : 's'
          }). No WhatsApp messages were sent.`,
        });
      } else {
        setBannerFeedback({
          ok: true,
          text:
            created.status === 'scheduled' && created.scheduledFor
              ? `Scheduled "${created.name}" in Supabase for ${new Date(created.scheduledFor).toLocaleString()}.`
              : `Saved campaign "${created.name}" in Supabase.`,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDuplicate = async (id: string) => {
    const res = await duplicateCampaign(id);
    if (!res.ok || !res.campaign) {
      setBannerFeedback({
        ok: false,
        text: res.error ?? 'Could not duplicate campaign in Supabase.',
      });
      return;
    }
    setBannerFeedback({
      ok: true,
      text: `Created draft copy "${res.campaign.name}" in Supabase.`,
    });
  };

  const handleUpdateCampaignStatus = async (id: string, status: CampaignStatus) => {
    const res = await updateCampaignStatus(id, status);
    if (!res.ok) {
      setBannerFeedback({
        ok: false,
        text: res.error ?? 'Could not update campaign status in Supabase.',
      });
    }
  };

  if (viewMode === 'compose') {
    const stages: Array<{
      num: WizardStage;
      title: string;
      subtitle: string;
      icon: React.ComponentType<{ className?: string }>;
    }> = [
      {
        num: 1,
        title: 'Choose Template',
        subtitle: selectedTemplate ? formatTemplateTitle(selectedTemplate.name) : 'Approved Meta template',
        icon: FileText,
      },
      {
        num: 2,
        title: 'Choose Audience',
        subtitle: `${audienceStats.eligibleCount} eligible contact${audienceStats.eligibleCount === 1 ? '' : 's'}`,
        icon: Users,
      },
      {
        num: 3,
        title: 'Review & Schedule',
        subtitle: scheduleMode === 'scheduled' ? 'Schedule time' : 'Confirm draft',
        icon: Calendar,
      },
    ];

    const canAccessStage2 = Boolean(selectedTemplate);
    const canAccessStage3 = Boolean(selectedTemplate) && audienceStats.eligibleCount > 0;

    return (
      <div className="p-4 sm:p-6 pb-20 lg:pb-8 max-w-[1440px] mx-auto space-y-5">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Campaigns</span>
            </button>
            <div>
              <h2 className="font-display text-lg font-bold text-[#0F172A]">Create Campaign</h2>
              <p className="text-xs text-slate-500">
                Stage {wizardStage} of 3 · {stages[wizardStage - 1].title}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleSubmitBroadcast(true)}
            disabled={submitting || !selectedTemplate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>{submitting ? 'Saving Draft...' : 'Save as Draft'}</span>
          </button>
        </div>

        {composeError && (
          <div className="rounded-xl border border-[#E11D48]/30 bg-rose-50 px-4 py-3 text-xs text-[#E11D48] flex items-start justify-between gap-3">
            <span className="flex items-start gap-2 font-medium">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{composeError}</span>
            </span>
            <button
              type="button"
              onClick={() => setComposeError(null)}
              className="cursor-pointer shrink-0"
              aria-label="Dismiss error"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Two-Column Wizard: Persistent Left Stage Rail + Active Stage Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Persistent Left Stage Navigation Rail */}
          <aside className="lg:col-span-3 rounded-xl border border-[#E2E8F0] bg-white p-3 space-y-1.5 lg:sticky lg:top-20">
            <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Campaign Setup
            </p>
            {stages.map((st) => {
              const Icon = st.icon;
              const isActive = wizardStage === st.num;
              const isDone = wizardStage > st.num;
              const canJump =
                st.num === 1 ||
                (st.num === 2 && canAccessStage2) ||
                (st.num === 3 && canAccessStage3);

              return (
                <button
                  key={st.num}
                  type="button"
                  disabled={!canJump}
                  onClick={() => canJump && setWizardStage(st.num)}
                  className={`w-full text-left rounded-lg px-3 py-2.5 flex items-start gap-3 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    isActive
                      ? 'bg-[#EFF6FF] text-[#2563EB]'
                      : 'hover:bg-[#F8FAFC] text-[#0F172A]'
                  }`}
                >
                  <span
                    className={`h-6 w-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5 tabular-nums ${
                      isActive
                        ? 'bg-[#2563EB] text-white'
                        : isDone
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#F1F5F9] text-slate-600'
                    }`}
                  >
                    {isDone ? <Check className="h-3.5 w-3.5" /> : st.num}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{st.title}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">{st.subtitle}</p>
                  </div>
                </button>
              );
            })}
          </aside>

          {/* Active Stage Workspace */}
          <div className="lg:col-span-9 rounded-xl border border-[#E2E8F0] bg-white p-5 sm:p-6 space-y-5">
            {/* STAGE 1: CHOOSE TEMPLATE */}
            {wizardStage === 1 && (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="font-display text-base font-bold text-[#0F172A]">
                      1. Choose Approved Template
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Only Meta-approved templates can be used in outbound WhatsApp campaigns.
                    </p>
                  </div>

                  <div className="relative w-full sm:w-64">
                    <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={templateSearch}
                      onChange={(e) => setTemplateSearch(e.target.value)}
                      placeholder="Search approved templates..."
                      className="w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-8 pr-3 py-1.5 text-xs focus:border-[#2563EB] focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                {approvedTemplates.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#E2E8F0] bg-[#F8FAFC] p-8 text-center text-xs text-slate-500 space-y-2">
                    <p className="font-semibold text-[#0F172A]">No approved templates found</p>
                    <p>
                      Connect your WhatsApp account in Settings and sync approved templates from Meta before creating a campaign.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    <div className="lg:col-span-7 space-y-3">
                      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        {filteredTemplatesForWizard.map((tpl) => {
                          const selected = selectedTemplate?.id === tpl.id;
                          return (
                            <button
                              key={tpl.id}
                              type="button"
                              onClick={() => setSelectedTemplateId(tpl.id)}
                              className={`w-full text-left rounded-lg border p-3.5 transition-colors cursor-pointer ${
                                selected
                                  ? 'border-[#2563EB] bg-[#EFF6FF]/60'
                                  : 'border-[#E2E8F0] hover:bg-[#F8FAFC]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-[#0F172A]">
                                  {formatTemplateTitle(tpl.name)}
                                </span>
                                <span className="text-[11px] font-medium text-slate-500">
                                  {CATEGORY_LABELS[tpl.category]} · {tpl.language}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                                {tpl.bodyText}
                              </p>
                            </button>
                          );
                        })}
                      </div>

                      {selectedTemplate && selectedTemplate.variablesCount > 0 && (
                        <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-2.5">
                          <p className="text-xs font-bold text-[#0F172A]">
                            Fill Template Variables
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {Array.from(
                              { length: selectedTemplate.variablesCount },
                              (_, idx) => String(idx + 1)
                            ).map((key) => (
                              <div key={key}>
                                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                  {'{{'}{key}{'}}'} {HUMAN_VAR_LABELS[key] ?? `Variable ${key}`}
                                </label>
                                <input
                                  type="text"
                                  value={varMapping[key] ?? ''}
                                  onChange={(e) =>
                                    setVarMapping((p) => ({ ...p, [key]: e.target.value }))
                                  }
                                  placeholder={`Sample for {{${key}}}`}
                                  className="w-full rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-xs focus:border-[#2563EB] focus:outline-none"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Live WhatsApp Bubble Preview */}
                    <div className="lg:col-span-5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                      <p className="text-xs font-bold text-[#0F172A] mb-2.5">Message Preview</p>
                      <div className="rounded-xl border border-[#E2E8F0] bg-white p-3.5 space-y-2">
                        {selectedTemplate?.headerText && (
                          <p className="text-xs font-bold text-[#0F172A]">
                            {selectedTemplate.headerText}
                          </p>
                        )}
                        <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                          {renderedPreview}
                        </p>
                        {selectedTemplate?.footerText && (
                          <p className="text-[11px] text-slate-400">{selectedTemplate.footerText}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-[#E2E8F0] flex justify-end">
                  <button
                    type="button"
                    disabled={!canAccessStage2}
                    onClick={() => setWizardStage(2)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-45 cursor-pointer"
                  >
                    <span>Next: Choose Audience</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            )}

            {/* STAGE 2: CHOOSE AUDIENCE */}
            {wizardStage === 2 && (
              <>
                <div>
                  <h3 className="font-display text-base font-bold text-[#0F172A]">
                    2. Choose Audience
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Only contacts with explicit Marketing Opt-In and valid E.164 WhatsApp numbers are eligible.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(
                    [
                      {
                        key: 'all',
                        title: 'All Opted-In Contacts',
                        desc: 'Every contact with marketing consent',
                      },
                      {
                        key: 'groups',
                        title: 'Filter by Tags',
                        desc: 'Target one or more contact tags',
                      },
                      {
                        key: 'specific',
                        title: 'Select Specific Contacts',
                        desc: 'Pick individual recipients manually',
                      },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setAudienceMode(opt.key)}
                      className={`text-left rounded-lg border p-3.5 transition-colors cursor-pointer ${
                        audienceMode === opt.key
                          ? 'border-[#2563EB] bg-[#EFF6FF]/60'
                          : 'border-[#E2E8F0] hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <p className="text-xs font-bold text-[#0F172A]">{opt.title}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>

                {audienceMode === 'groups' && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-[#0F172A]">Select Contact Tags</p>
                    {tags.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        No tags created yet. Add tags in Contacts first.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {tags.map((t) => {
                          const active = selectedTagIds.includes(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() =>
                                setSelectedTagIds((prev) =>
                                  active ? prev.filter((x) => x !== t.id) : [...prev, t.id]
                                )
                              }
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                                active
                                  ? 'bg-[#2563EB] border-[#2563EB] text-white'
                                  : 'bg-[#F8FAFC] border-[#E2E8F0] text-slate-700 hover:bg-[#F1F5F9]'
                              }`}
                            >
                              {t.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {audienceMode === 'specific' && (
                  <div className="space-y-2.5">
                    <div className="relative max-w-sm">
                      <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={contactSearch}
                        onChange={(e) => setContactSearch(e.target.value)}
                        placeholder="Search contacts..."
                        className="w-full rounded-lg border border-[#E2E8F0] pl-8 pr-3 py-1.5 text-xs focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto border border-[#E2E8F0] rounded-lg divide-y divide-[#E2E8F0]">
                      {filteredContactsForPicker.map((c) => {
                        const checked = selectedContactIds.includes(c.id);
                        return (
                          <label
                            key={c.id}
                            className="px-3.5 py-2 flex items-center justify-between gap-3 text-xs hover:bg-[#F8FAFC] cursor-pointer"
                          >
                            <span className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setSelectedContactIds((prev) =>
                                    checked ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                                  )
                                }
                                className="rounded border-slate-300 accent-[#2563EB]"
                              />
                              <span className="font-medium text-[#0F172A] truncate">
                                {c.fullName}
                              </span>
                            </span>
                            <span className="text-[11px] font-mono text-slate-500 shrink-0">
                              {c.phoneE164} · {c.marketingOptIn ? 'Opted In' : 'Not Opted In'}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Audience Eligibility Summary */}
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-500">Eligible Opted-In Recipients</p>
                    <p className="font-display text-2xl font-bold text-[#2563EB] tabular-nums">
                      {audienceStats.eligibleCount}
                    </p>
                  </div>

                  {audienceStats.skippedCount > 0 && (
                    <div className="text-right text-xs">
                      <button
                        type="button"
                        onClick={() => setShowExcludedDetails((v) => !v)}
                        className="font-semibold text-slate-600 hover:text-[#0F172A] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <span className="tabular-nums">
                          {audienceStats.skippedCount} automatically excluded
                        </span>
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${
                            showExcludedDetails ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                      {showExcludedDetails && (
                        <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                          {audienceStats.optedOutCount} not opted in ·{' '}
                          {audienceStats.invalidPhoneCount} invalid phone
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-[#E2E8F0] flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setWizardStage(1)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Back</span>
                  </button>
                  <button
                    type="button"
                    disabled={!canAccessStage3}
                    onClick={() => setWizardStage(3)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-45 cursor-pointer"
                  >
                    <span>Next: Review &amp; Schedule</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            )}

            {/* STAGE 3: REVIEW & SCHEDULE */}
            {wizardStage === 3 && (
              <>
                <div>
                  <h3 className="font-display text-base font-bold text-[#0F172A]">
                    3. Review &amp; Schedule
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Review audience size, campaign schedule ({business.timezone}), and template content.
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  <div className="lg:col-span-7 space-y-4 text-xs">
                    <div>
                      <label className="block font-semibold text-[#0F172A] mb-1">
                        Campaign Name
                      </label>
                      <input
                        type="text"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        placeholder={autoCampaignName}
                        className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                      <div>
                        <p className="text-[11px] text-slate-500">Eligible Audience</p>
                        <p className="font-semibold text-[#0F172A] mt-0.5 tabular-nums">
                          {audienceStats.eligibleCount} contact{audienceStats.eligibleCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500">Template</p>
                        <p className="font-semibold text-[#0F172A] mt-0.5 truncate">
                          {selectedTemplate ? formatTemplateTitle(selectedTemplate.name) : '—'}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setScheduleMode('immediate')}
                        className={`rounded-lg border p-3 text-left cursor-pointer ${
                          scheduleMode === 'immediate'
                            ? 'border-[#2563EB] bg-[#EFF6FF]/60'
                            : 'border-[#E2E8F0] hover:bg-[#F8FAFC]'
                        }`}
                      >
                        <p className="font-bold text-[#0F172A]">Immediate</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Ready upon confirmation
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setScheduleMode('scheduled')}
                        className={`rounded-lg border p-3 text-left cursor-pointer ${
                          scheduleMode === 'scheduled'
                            ? 'border-[#2563EB] bg-[#EFF6FF]/60'
                            : 'border-[#E2E8F0] hover:bg-[#F8FAFC]'
                        }`}
                      >
                        <p className="font-bold text-[#0F172A] flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-[#2563EB]" />
                          Schedule for Later
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Timezone: {business.timezone}
                        </p>
                      </button>
                    </div>

                    {scheduleMode === 'scheduled' && (
                      <div>
                        <label className="block font-semibold text-[#0F172A] mb-1">
                          Scheduled Time ({business.timezone})
                        </label>
                        <input
                          type="datetime-local"
                          value={scheduledFor}
                          onChange={(e) => setScheduledFor(e.target.value)}
                          className="rounded-lg border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>
                    )}

                    {dispatchDisabledReason && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-amber-900 flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>{dispatchDisabledReason}</span>
                      </div>
                    )}

                    <label className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={consentConfirmed}
                        onChange={(e) => setConsentConfirmed(e.target.checked)}
                        className="mt-0.5 rounded border-slate-300 accent-[#2563EB]"
                      />
                      <span className="font-medium text-[#0F172A] leading-relaxed">
                        I confirm these {audienceStats.eligibleCount} recipients explicitly opted in to receive WhatsApp messages from {business.name}.
                      </span>
                    </label>
                  </div>

                  {/* Final Preview + Save/Confirm */}
                  <div className="lg:col-span-5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 flex flex-col justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold text-[#0F172A] mb-2.5">Final Message Preview</p>
                      <div className="rounded-xl border border-[#E2E8F0] bg-white p-3.5 space-y-2">
                        {selectedTemplate?.headerText && (
                          <p className="text-xs font-bold text-[#0F172A]">
                            {selectedTemplate.headerText}
                          </p>
                        )}
                        <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                          {renderedPreview}
                        </p>
                        {selectedTemplate?.footerText && (
                          <p className="text-[11px] text-slate-400">{selectedTemplate.footerText}</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <button
                        type="button"
                        disabled={
                          submitting ||
                          !selectedTemplate ||
                          !consentConfirmed ||
                          audienceStats.eligibleCount === 0
                        }
                        onClick={() => handleSubmitBroadcast(false)}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#E11D48] py-2.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-45 transition-colors cursor-pointer"
                      >
                        {submitting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Megaphone className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {submitting
                            ? 'Saving to Supabase...'
                            : dispatchDisabledReason
                            ? 'Save Campaign Draft'
                            : scheduleMode === 'scheduled'
                            ? 'Schedule Campaign'
                            : 'Save Campaign Draft'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setWizardStage(2)}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        <span>Back to Audience</span>
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 pb-20 lg:pb-8 max-w-[1520px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-xl font-bold text-[#0F172A] tracking-tight">
              Campaigns
            </h2>
            <span className="text-xs font-medium text-slate-500 tabular-nums">
              {campaigns.length} total
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Plan WhatsApp template broadcasts for opted-in contacts and inspect delivery analytics.
          </p>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={handleOpenNewWizard}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#E11D48] px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 whitespace-nowrap self-start cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Campaign</span>
          </button>
        )}
      </div>

      {/* Honest Test Mode / Dispatch Readiness Notice */}
      {dispatchDisabledReason && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-950 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-[#F4B942] shrink-0" />
          <span>{dispatchDisabledReason}</span>
        </div>
      )}

      {bannerFeedback && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs flex items-center justify-between gap-2 ${
            bannerFeedback.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-[#E11D48]/30 bg-rose-50 text-[#E11D48]'
          }`}
        >
          <span className="flex items-center gap-2 font-medium">
            {bannerFeedback.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {bannerFeedback.text}
          </span>
          <button type="button" onClick={() => setBannerFeedback(null)} className="cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-10 text-center space-y-3">
          <div className="h-12 w-12 rounded-xl bg-rose-50 text-[#E11D48] flex items-center justify-center mx-auto">
            <Megaphone className="h-6 w-6" />
          </div>
          <h3 className="font-display text-base font-bold text-[#0F172A]">No campaigns yet</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            Create a campaign draft in three stages: choose an approved template, select opted-in contacts, and review schedule details.
          </p>
          {isAdmin && (
            <button
              type="button"
              onClick={handleOpenNewWizard}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#E11D48] px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create Campaign</span>
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Filter, Sort & Search Toolbar */}
          <div className="rounded-xl border border-[#E2E8F0] bg-white p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as 'all' | CampaignStatus);
                  setPage(1);
                }}
                className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1.5 text-xs font-medium text-[#0F172A] cursor-pointer"
              >
                <option value="all">Filter by Status: All</option>
                <option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option>
                <option value="running">Running</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>

              <select
                aria-label="Sort campaigns"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'newest' | 'name' | 'audience')}
                className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1.5 text-xs font-medium text-[#0F172A] cursor-pointer"
              >
                <option value="newest">Sort: Newest First</option>
                <option value="name">Sort: Name (A–Z)</option>
                <option value="audience">Sort: Audience Size</option>
              </select>
            </div>

            <div className="relative w-full lg:w-72">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchCampaign}
                onChange={(e) => {
                  setSearchCampaign(e.target.value);
                  setPage(1);
                }}
                placeholder="Search campaigns..."
                className="w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-8 pr-3 py-1.5 text-xs focus:border-[#2563EB] focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          {/* Mobile Cards */}
          <div className="grid grid-cols-1 gap-2.5 md:hidden">
            {paginatedCampaigns.map((cmp) => (
              <div key={cmp.id} className="rounded-xl border border-[#E2E8F0] bg-white p-4 space-y-2.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[#0F172A]">{cmp.name}</p>
                    <p className="text-[11px] text-slate-500 capitalize mt-0.5">
                      {cmp.status} · {new Date(cmp.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="font-mono font-semibold text-[#2563EB] tabular-nums">
                    {cmp.metrics.eligible} audience
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0] text-slate-600 tabular-nums">
                  <span>
                    Delivered: {cmp.metrics.delivered} · Read: {cmp.metrics.read}
                  </span>
                  <div className="flex items-center gap-3">
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleDuplicate(cmp.id)}
                        className="font-semibold text-slate-600 cursor-pointer"
                      >
                        Duplicate
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setReportCampaign(cmp)}
                      className="font-semibold text-[#2563EB] cursor-pointer"
                    >
                      Report
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Campaigns Table */}
          <div className="hidden md:block rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Campaign Name</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Audience</th>
                    <th className="py-3 px-4 text-right">Sent</th>
                    <th className="py-3 px-4 text-right">Delivered</th>
                    <th className="py-3 px-4 text-right">Read</th>
                    <th className="py-3 px-4 text-right">Failed</th>
                    <th className="py-3 px-4">Created Date</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-xs">
                  {paginatedCampaigns.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-500">
                        No campaigns match your current filter.
                      </td>
                    </tr>
                  ) : (
                    paginatedCampaigns.map((cmp) => {
                      const tpl = templates.find((t) => t.id === cmp.templateId);
                      return (
                        <tr key={cmp.id} className="hover:bg-[#F8FAFC] transition-colors">
                          <td className="py-3 px-4">
                            <p className="font-semibold text-[#0F172A]">{cmp.name}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {tpl ? formatTemplateTitle(tpl.name) : 'Template'}
                            </p>
                          </td>
                          <td className="py-3 px-4 capitalize font-medium text-slate-700">
                            {cmp.status}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-[#0F172A]">
                            {cmp.metrics.eligible}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                            {cmp.metrics.sent}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700">
                            {cmp.metrics.delivered}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-[#2563EB]">
                            {cmp.metrics.read}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-[#E11D48]">
                            {cmp.metrics.failed}
                          </td>
                          <td className="py-3 px-4 text-slate-500 tabular-nums whitespace-nowrap">
                            {new Date(cmp.createdAt).toLocaleDateString('en-GB', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setReportCampaign(cmp)}
                                title="View analytics"
                                className="inline-flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
                              >
                                <BarChart2 className="h-3 w-3 text-[#2563EB]" />
                                Analytics
                              </button>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleDuplicate(cmp.id)}
                                  title="Duplicate campaign"
                                  className="p-1.5 rounded-md border border-[#E2E8F0] bg-white text-slate-600 hover:bg-[#F1F5F9] cursor-pointer"
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                              )}
                              {isAdmin && cmp.status === 'scheduled' && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateCampaignStatus(cmp.id, 'paused')}
                                  title="Pause"
                                  className="p-1.5 rounded-md border border-[#E2E8F0] text-slate-600 hover:bg-[#F1F5F9] cursor-pointer"
                                >
                                  <Pause className="h-3 w-3" />
                                </button>
                              )}
                              {isAdmin && cmp.status === 'paused' && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateCampaignStatus(cmp.id, 'scheduled')}
                                  title="Resume"
                                  className="p-1.5 rounded-md border border-[#E2E8F0] text-[#2563EB] hover:bg-[#EFF6FF] cursor-pointer"
                                >
                                  <Play className="h-3 w-3" />
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

            {/* Pagination Footer */}
            <div className="px-4 py-3 border-t border-[#E2E8F0] bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
              <span className="tabular-nums">{filteredCampaigns.length} campaign(s)</span>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span>Rows per page</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value) as 10 | 25 | 50);
                      setPage(1);
                    }}
                    className="rounded-md border border-[#E2E8F0] bg-white px-2 py-1 text-xs cursor-pointer"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 font-medium disabled:opacity-50 cursor-pointer"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 font-medium disabled:opacity-50 cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Campaign Analytics Modal */}
      {reportCampaign && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          onClick={() => setReportCampaign(null)}
        >
          <div
            className="w-full max-w-xl rounded-xl border border-[#E2E8F0] bg-white shadow-luxury-hover overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div>
                <h3 className="font-display text-sm font-bold text-[#0F172A]">
                  {reportCampaign.name}
                </h3>
                <p className="text-xs text-slate-500 capitalize">
                  Status: {reportCampaign.status}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReportCampaign(null)}
                className="cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>

            <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(
                [
                  { label: 'Selected', value: reportCampaign.metrics.selected, color: 'text-[#0F172A]' },
                  { label: 'Eligible', value: reportCampaign.metrics.eligible, color: 'text-[#2563EB]' },
                  { label: 'Sent', value: reportCampaign.metrics.sent, color: 'text-[#0F172A]' },
                  { label: 'Delivered', value: reportCampaign.metrics.delivered, color: 'text-emerald-700' },
                  { label: 'Read', value: reportCampaign.metrics.read, color: 'text-[#2563EB]' },
                  { label: 'Failed', value: reportCampaign.metrics.failed, color: 'text-[#E11D48]' },
                  { label: 'Skipped', value: reportCampaign.metrics.skipped, color: 'text-amber-700' },
                  { label: 'Submitted', value: reportCampaign.metrics.submitted, color: 'text-slate-600' },
                ] as const
              ).map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3"
                >
                  <p className="text-[11px] text-slate-500">{stat.label}</p>
                  <p className={`font-display text-xl font-bold tabular-nums mt-1 ${stat.color}`}>
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
