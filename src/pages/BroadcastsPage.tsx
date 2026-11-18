import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BarChart2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileText,
  Image as ImageIcon,
  Megaphone,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  X,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import type { Campaign, CampaignStatus, TemplateCategory } from '@/types/crm';

const DRAFT_STORAGE_KEY = 'zoqniva_broadcast_composer_draft';

const HUMAN_VAR_LABELS: Record<string, string> = {
  '1': 'Customer Name',
  '2': 'Offer or Order Detail',
  '3': 'Courier or Reference',
  '4': 'Estimated Date or Time',
};

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  UTILITY: 'Customer Update',
  MARKETING: 'Promotion & Offer',
  AUTHENTICATION: 'Security Code',
};

type WizardStep = 1 | 2 | 3;

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
  const [reportCampaign, setReportCampaign] = useState<Campaign | null>(null);
  const [bannerFeedback, setBannerFeedback] = useState<string | null>(null);

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

  const [wizardStep, setWizardStep] = useState<WizardStep>(
    savedDraft?.wizardStep === 2 || savedDraft?.wizardStep === 3 ? savedDraft.wizardStep : 1
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

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    savedDraft?.selectedTemplateId || approvedTemplates[0]?.id || ''
  );
  const [varMapping, setVarMapping] = useState<Record<string, string>>(
    savedDraft?.varMapping ?? {}
  );

  const [scheduleMode, setScheduleMode] = useState<'immediate' | 'scheduled'>(
    savedDraft?.scheduleMode ?? 'immediate'
  );
  const [scheduledFor, setScheduledFor] = useState<string>(
    savedDraft?.scheduledFor ??
      new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16)
  );
  const [customName, setCustomName] = useState<string>(savedDraft?.customName ?? '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const state = location.state as { openWizard?: boolean } | null;
    if (state?.openWizard && isAdmin) {
      setWizardStep(1);
      setViewMode('compose');
    }
  }, [location.state, isAdmin]);

  // Persist unfinished wizard draft automatically
  useEffect(() => {
    if (viewMode === 'compose') {
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({
          wizardStep,
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
    wizardStep,
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

  // Audience calculation with automatic invalid & opted-out exclusion
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
        ? 'All Customers'
        : audienceMode === 'groups' && selectedTagIds.length > 0
        ? tags
            .filter((t) => selectedTagIds.includes(t.id))
            .map((t) => t.name)
            .slice(0, 2)
            .join(' & ')
        : 'Selected Customers';
    const tplLabel = selectedTemplate
      ? selectedTemplate.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : 'Broadcast';
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

  const filteredCampaigns = useMemo(
    () => campaigns.filter((c) => (statusFilter === 'all' ? true : c.status === statusFilter)),
    [campaigns, statusFilter]
  );

  const audienceSummaryLabel = useMemo(() => {
    if (audienceMode === 'all') return 'All eligible customers';
    if (audienceMode === 'groups') {
      const names = tags
        .filter((t) => selectedTagIds.includes(t.id))
        .map((t) => t.name);
      return names.length > 0 ? names.join(', ') : 'Customer groups';
    }
    return `${selectedContactIds.length} selected customer${selectedContactIds.length === 1 ? '' : 's'}`;
  }, [audienceMode, tags, selectedTagIds, selectedContactIds]);

  const canContinueStep1 = audienceStats.eligibleCount > 0;
  const canContinueStep2 = Boolean(selectedTemplate);

  const handleOpenNewWizard = () => {
    setWizardStep(1);
    setConsentConfirmed(false);
    setViewMode('compose');
  };

  const handleSubmitBroadcast = (asDraft: boolean) => {
    if (submitting || !selectedTemplate) return;
    if (!asDraft && (!consentConfirmed || audienceStats.eligibleCount === 0)) return;

    setSubmitting(true);
    const created = createCampaign({
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

    localStorage.removeItem(DRAFT_STORAGE_KEY);
    setCustomName('');
    setConsentConfirmed(false);
    setWizardStep(1);
    setSubmitting(false);
    setViewMode('list');

    if (asDraft) {
      setBannerFeedback(`Saved "${created.name}" as a draft.`);
    } else if (business.messagingMode === 'test') {
      setBannerFeedback(
        `Saved "${created.name}" as a draft. Bulk broadcasts are disabled while Test Mode is active in Settings.`
      );
    } else if (business.metaConnectionState !== 'connected') {
      setBannerFeedback(
        `Saved "${created.name}" (${created.metrics.eligible} ready to receive). Connect your WhatsApp account in Settings before live sending.`
      );
    } else {
      setBannerFeedback(
        scheduleMode === 'scheduled'
          ? `Scheduled "${created.name}" for ${new Date(scheduledFor).toLocaleString()}.`
          : `Queued "${created.name}" for sending.`
      );
    }
  };

  const handleDuplicate = (id: string) => {
    const copy = duplicateCampaign(id);
    if (copy) {
      setBannerFeedback(`Created editable copy "${copy.name}".`);
    }
  };

  const formatTemplateTitle = (slug: string) =>
    slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  if (viewMode === 'compose') {
    const steps: Array<{ num: WizardStep; title: string; subtitle: string }> = [
      {
        num: 1,
        title: 'Choose Audience',
        subtitle: `${audienceStats.eligibleCount} eligible`,
      },
      {
        num: 2,
        title: 'Select Template',
        subtitle: selectedTemplate ? formatTemplateTitle(selectedTemplate.name) : 'Pick a template',
      },
      {
        num: 3,
        title: 'Preview & Send',
        subtitle: scheduleMode === 'scheduled' ? 'Schedule' : 'Send now',
      },
    ];
    const trackWidthClass = wizardStep === 1 ? 'w-0' : wizardStep === 2 ? 'w-1/2' : 'w-full';
    const mobileBarClass = wizardStep === 1 ? 'w-1/3' : wizardStep === 2 ? 'w-2/3' : 'w-full';

    return (
      <div className="p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8 max-w-[1040px] mx-auto space-y-6">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Broadcasts</span>
            </button>
            <div>
              <h2 className="font-display text-xl font-bold text-[#0F172A]">New Broadcast</h2>
              <p className="text-xs text-slate-500">
                Step {wizardStep} of 3 · {steps[wizardStep - 1].title}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleSubmitBroadcast(true)}
            disabled={submitting || !selectedTemplate}
            className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer disabled:opacity-50"
          >
            Save as Draft
          </button>
        </div>

        {/* Multi-Step Visual Progress Indicator */}
        <nav
          aria-label="Broadcast creation progress"
          className="rounded-2xl border border-[#E2E8F0] bg-white px-4 py-5 sm:px-8 sm:py-5 shadow-2xs"
        >
          <div className="relative">
            {/* Background & Active Connector Track (Desktop/Tablet) */}
            <div
              aria-hidden="true"
              className="hidden sm:block absolute top-4 left-[16%] right-[16%] h-0.5 bg-[#E2E8F0]"
            >
              <div
                className={`h-full bg-[#2563EB] transition-all duration-300 ${trackWidthClass}`}
              />
            </div>

            <ol className="relative grid grid-cols-3 gap-2">
              {steps.map((st) => {
                const isActive = wizardStep === st.num;
                const isCompleted = wizardStep > st.num;
                const canJump =
                  st.num === 1 ||
                  (st.num === 2 && canContinueStep1) ||
                  (st.num === 3 && canContinueStep1 && canContinueStep2);

                return (
                  <li key={st.num} className="flex flex-col items-center text-center">
                    <button
                      type="button"
                      disabled={!canJump}
                      onClick={() => canJump && setWizardStep(st.num)}
                      aria-current={isActive ? 'step' : undefined}
                      className="group flex flex-col items-center gap-2 focus:outline-none cursor-pointer disabled:cursor-not-allowed"
                    >
                      <span
                        className={`relative z-10 h-8 w-8 rounded-full text-xs font-bold flex items-center justify-center transition-all tabular-nums ring-4 ring-white ${
                          isActive
                            ? 'bg-[#2563EB] text-white shadow-xs'
                            : isCompleted
                            ? 'bg-emerald-600 text-white'
                            : 'bg-[#F8FAFC] border border-[#E2E8F0] text-slate-500'
                        }`}
                      >
                        {isCompleted ? <Check className="h-4 w-4" /> : st.num}
                      </span>
                      <div>
                        <p
                          className={`text-xs font-semibold transition-colors ${
                            isActive
                              ? 'text-[#2563EB]'
                              : isCompleted
                              ? 'text-[#0F172A]'
                              : 'text-slate-400'
                          }`}
                        >
                          {st.num}. {st.title}
                        </p>
                        <p className="hidden sm:block text-[11px] text-slate-400 truncate max-w-[160px] mt-0.5">
                          {st.subtitle}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Mobile Compact Progress Bar */}
          <div className="sm:hidden mt-3 h-1.5 w-full rounded-full bg-[#F8FAFC] overflow-hidden">
            <div
              className={`h-full bg-[#2563EB] rounded-full transition-all duration-300 ${mobileBarClass}`}
            />
          </div>
        </nav>

        {/* STEP 1: CHOOSE CUSTOMERS */}
        {wizardStep === 1 && (
          <section className="rounded-2xl border border-[#E2E8F0] bg-white p-5 sm:p-6 space-y-5 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-lg font-bold text-[#0F172A]">
                  Who should receive this broadcast?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Customers who opted out of updates are skipped automatically.
                </p>
              </div>
              <div className="rounded-xl bg-[#EFF6FF] px-3.5 py-2 text-xs font-semibold text-[#2563EB] tabular-nums">
                {audienceStats.eligibleCount} ready to receive
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  key: 'all' as const,
                  title: 'All eligible customers',
                  desc: 'Everyone who agreed to WhatsApp updates',
                },
                {
                  key: 'groups' as const,
                  title: 'Customer groups',
                  desc: 'Pick one or more customer groups',
                },
                {
                  key: 'specific' as const,
                  title: 'Specific customers',
                  desc: 'Search and choose individuals',
                },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setAudienceMode(opt.key)}
                  className={`text-left rounded-xl border p-4 transition-all cursor-pointer ${
                    audienceMode === opt.key
                      ? 'border-[#2563EB] bg-[#EFF6FF]/60 shadow-2xs'
                      : 'border-[#E2E8F0] hover:bg-[#F8FAFC]'
                  }`}
                >
                  <p className="text-xs font-bold text-[#0F172A]">{opt.title}</p>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{opt.desc}</p>
                </button>
              ))}
            </div>

            {/* Progressive Disclosure: Group Picker */}
            {audienceMode === 'groups' && (
              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-2.5">
                <p className="text-xs font-semibold text-[#0F172A]">Select customer groups:</p>
                <div className="flex flex-wrap gap-2">
                  {tags.map((t) => {
                    const active = selectedTagIds.includes(t.id);
                    const count = contacts.filter(
                      (c) => c.tagIds.includes(t.id) && c.marketingOptIn
                    ).length;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() =>
                          setSelectedTagIds((prev) =>
                            active ? prev.filter((x) => x !== t.id) : [...prev, t.id]
                          )
                        }
                        className={`px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#2563EB] border-[#2563EB] text-white'
                            : 'bg-white border-[#E2E8F0] text-[#0F172A] hover:bg-slate-50'
                        }`}
                      >
                        {t.name} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Progressive Disclosure: Specific Customer Search */}
            {audienceMode === 'specific' && (
              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-3">
                <div className="relative max-w-sm">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    placeholder="Search customers by name or phone..."
                    className="w-full rounded-xl border border-[#E2E8F0] bg-white pl-8 pr-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white divide-y divide-[#E2E8F0]">
                  {filteredContactsForPicker.map((c) => {
                    const checked = selectedContactIds.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className="flex items-center justify-between px-3.5 py-2.5 text-xs hover:bg-[#F8FAFC] cursor-pointer"
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelectedContactIds((prev) =>
                                e.target.checked
                                  ? [...prev, c.id]
                                  : prev.filter((id) => id !== c.id)
                              )
                            }
                            className="rounded border-slate-300 accent-[#2563EB]"
                          />
                          <span className="font-semibold text-[#0F172A] truncate">
                            {c.fullName}
                          </span>
                          <span className="font-mono text-slate-400 hidden sm:inline">
                            {c.phoneE164}
                          </span>
                        </span>
                        <span
                          className={`text-[11px] font-medium shrink-0 ${
                            c.marketingOptIn ? 'text-emerald-700' : 'text-[#E11D48]'
                          }`}
                        >
                          {c.marketingOptIn ? 'Eligible' : 'Opted out'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Progressive Disclosure: Excluded Breakdown */}
            {audienceStats.skippedCount > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowExcludedDetails((s) => !s)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#0F172A] cursor-pointer"
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${
                      showExcludedDetails ? 'rotate-180' : ''
                    }`}
                  />
                  <span>
                    {audienceStats.skippedCount} customer
                    {audienceStats.skippedCount === 1 ? '' : 's'} excluded automatically — see why
                  </span>
                </button>
                {showExcludedDetails && (
                  <p className="mt-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2.5 text-xs text-slate-600">
                    {audienceStats.optedOutCount} opted out of marketing updates
                    {audienceStats.invalidPhoneCount > 0
                      ? ` · ${audienceStats.invalidPhoneCount} missing a valid phone number`
                      : ''}
                    .
                  </p>
                )}
              </div>
            )}

            <div className="pt-3 border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                {!canContinueStep1
                  ? 'Select at least one eligible customer or group to continue.'
                  : `Selected: ${audienceSummaryLabel}`}
              </p>
              <button
                type="button"
                disabled={!canContinueStep1}
                onClick={() => setWizardStep(2)}
                className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-45 cursor-pointer"
              >
                <span>Continue to Select Template</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </section>
        )}

        {/* STEP 2: CHOOSE MESSAGE */}
        {wizardStep === 2 && (
          <section className="rounded-2xl border border-[#E2E8F0] bg-white p-5 sm:p-6 space-y-5 shadow-2xs">
            <div>
              <h3 className="font-display text-lg font-bold text-[#0F172A]">
                Pick an approved WhatsApp message
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Recently used messages appear first. You can fill in personalized details below.
              </p>
            </div>

            {approvedTemplates.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
                No approved message templates are ready yet. Approve or sync a template in Message
                Templates first.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                {approvedTemplates.map((tpl, index) => {
                  const active = selectedTemplate?.id === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(tpl.id)}
                      className={`text-left rounded-xl border p-4 transition-all cursor-pointer flex flex-col justify-between ${
                        active
                          ? 'border-[#2563EB] bg-[#EFF6FF]/60 shadow-2xs'
                          : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-display text-xs font-bold text-[#0F172A]">
                            {formatTemplateTitle(tpl.name)}
                          </span>
                          {active && (
                            <span className="h-5 w-5 rounded-full bg-[#2563EB] text-white flex items-center justify-center shrink-0">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {index === 0 && recentTemplateIds.includes(tpl.id)
                            ? 'Recently used · '
                            : ''}
                          {CATEGORY_LABELS[tpl.category]}
                        </p>
                        <p className="text-xs text-slate-600 mt-2.5 line-clamp-3 leading-relaxed">
                          {tpl.bodyText}
                        </p>
                      </div>
                      {tpl.headerType !== 'NONE' && (
                        <div className="mt-3 pt-2 border-t border-[#E2E8F0] flex items-center gap-1.5 text-[11px] text-slate-500">
                          {tpl.headerType === 'IMAGE' ? (
                            <ImageIcon className="h-3.5 w-3.5 text-[#2563EB]" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 text-[#2563EB]" />
                          )}
                          <span>Includes {tpl.headerText || tpl.headerType.toLowerCase()}</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Progressive Disclosure: Personalize Details + Instant Preview */}
            {selectedTemplate && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-2">
                {selectedTemplate.variablesCount > 0 && (
                  <div className="lg:col-span-7 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-3">
                    <p className="text-xs font-semibold text-[#0F172A]">
                      Personalize message details
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {Array.from({ length: selectedTemplate.variablesCount }).map((_, idx) => {
                        const key = String(idx + 1);
                        return (
                          <div key={key}>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              {HUMAN_VAR_LABELS[key] ?? `Custom Detail ${key}`}
                            </label>
                            <input
                              type="text"
                              value={varMapping[key] ?? ''}
                              onChange={(e) =>
                                setVarMapping((prev) => ({ ...prev, [key]: e.target.value }))
                              }
                              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div
                  className={`${
                    selectedTemplate.variablesCount > 0 ? 'lg:col-span-5' : 'lg:col-span-12'
                  } rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4`}
                >
                  <p className="text-xs font-semibold text-[#0F172A] mb-2">Customer Preview</p>
                  <div className="rounded-xl border border-[#E2E8F0] bg-white p-3.5 shadow-2xs space-y-1.5">
                    {selectedTemplate.headerText && (
                      <p className="text-xs font-bold text-[#0F172A]">
                        {selectedTemplate.headerText}
                      </p>
                    )}
                    <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                      {renderedPreview}
                    </p>
                    {selectedTemplate.footerText && (
                      <p className="text-[11px] text-slate-400">{selectedTemplate.footerText}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setWizardStep(1)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-4 py-2.5 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back</span>
              </button>
              <button
                type="button"
                disabled={!canContinueStep2}
                onClick={() => setWizardStep(3)}
                className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-45 cursor-pointer"
              >
                <span>Continue to Preview &amp; Send</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </section>
        )}

        {/* STEP 3: PREVIEW & SEND */}
        {wizardStep === 3 && (
          <section className="rounded-2xl border border-[#E2E8F0] bg-white p-5 sm:p-6 space-y-5 shadow-2xs">
            <div>
              <h3 className="font-display text-lg font-bold text-[#0F172A]">
                Preview &amp; Send Broadcast
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Choose when to send, check the preview, and confirm customer consent.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 space-y-4">
                {/* Summary Card */}
                <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">Customers</span>
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      className="font-semibold text-[#2563EB] hover:underline cursor-pointer"
                    >
                      {audienceSummaryLabel} ({audienceStats.eligibleCount} ready)
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">Message</span>
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      className="font-semibold text-[#2563EB] hover:underline cursor-pointer"
                    >
                      {selectedTemplate ? formatTemplateTitle(selectedTemplate.name) : '—'}
                    </button>
                  </div>
                  {audienceStats.skippedCount > 0 && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Automatically excluded</span>
                      <span className="font-semibold text-[#E11D48] tabular-nums">
                        {audienceStats.skippedCount} opted-out / invalid
                      </span>
                    </div>
                  )}
                </div>

                {/* When to send */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setScheduleMode('immediate')}
                    className={`rounded-xl border p-3.5 text-left cursor-pointer ${
                      scheduleMode === 'immediate'
                        ? 'border-[#2563EB] bg-[#EFF6FF]/60'
                        : 'border-[#E2E8F0] hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <p className="text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
                      <Send className="h-3.5 w-3.5 text-[#2563EB]" />
                      Send Now
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Start sending right after you confirm
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScheduleMode('scheduled')}
                    className={`rounded-xl border p-3.5 text-left cursor-pointer ${
                      scheduleMode === 'scheduled'
                        ? 'border-[#2563EB] bg-[#EFF6FF]/60'
                        : 'border-[#E2E8F0] hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <p className="text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-[#2563EB]" />
                      Schedule for Later
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Pick a date &amp; time ({business.timezone})
                    </p>
                  </button>
                </div>

                {scheduleMode === 'scheduled' && (
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                      Sending Time ({business.timezone})
                    </label>
                    <input
                      type="datetime-local"
                      value={scheduledFor}
                      onChange={(e) => setScheduledFor(e.target.value)}
                      className="rounded-xl border border-[#E2E8F0] px-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                )}

                {/* Progressive Disclosure: Optional Campaign Name & Details */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#2563EB] cursor-pointer"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${
                        showAdvanced ? 'rotate-180' : ''
                      }`}
                    />
                    <span>Customize Campaign Name &amp; Messaging Notes</span>
                  </button>

                  {showAdvanced && (
                    <div className="mt-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-3 text-xs">
                      <div>
                        <label className="block font-semibold text-[#0F172A] mb-1">
                          Campaign Name (auto-named if left blank)
                        </label>
                        <input
                          type="text"
                          value={customName}
                          onChange={(e) => setCustomName(e.target.value)}
                          placeholder={autoCampaignName}
                          className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2"
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        WhatsApp template fees apply per conversation according to your Meta
                        Business Account region and message type (
                        {selectedTemplate ? CATEGORY_LABELS[selectedTemplate.category] : 'Update'}).
                      </p>
                    </div>
                  )}
                </div>

                {(business.metaConnectionState !== 'connected' || business.messagingMode === 'test') && (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                    {business.messagingMode === 'test'
                      ? 'Test Mode is active — bulk broadcasts are disabled so confirming saves this campaign as a draft only.'
                      : 'WhatsApp is not connected yet — confirming saves this broadcast as a draft so nothing is sent prematurely.'}
                  </p>
                )}

                {/* Required Consent Check */}
                <label className="flex items-start gap-2.5 rounded-xl border border-[#E2E8F0] bg-white p-3.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consentConfirmed}
                    onChange={(e) => setConsentConfirmed(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 accent-[#2563EB]"
                  />
                  <span className="text-xs font-medium text-[#0F172A] leading-relaxed">
                    I confirm these {audienceStats.eligibleCount} customers agreed to receive
                    WhatsApp updates from {business.name}.
                  </span>
                </label>
              </div>

              {/* Final Customer Preview + Primary Confirm Action */}
              <div className="lg:col-span-5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 flex flex-col justify-between gap-4">
                <div>
                  <p className="text-xs font-bold text-[#0F172A] mb-3">Final Message Preview</p>
                  <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-2xs space-y-2">
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
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#E11D48] py-3 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-45 transition-colors cursor-pointer shadow-xs"
                  >
                    <Megaphone className="h-4 w-4" />
                    <span>
                      {scheduleMode === 'scheduled'
                        ? 'Confirm & Schedule Broadcast'
                        : 'Send Broadcast Now'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white py-2.5 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Back to Choose Message</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8 max-w-[1440px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-[2px] w-5 bg-[#F4B942]" />
            <span className="text-xs font-semibold text-[#2563EB]">Outreach</span>
          </div>
          <h2 className="font-display text-2xl font-bold text-[#0F172A] tracking-tight mt-0.5">
            Broadcast Campaigns
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Send approved WhatsApp announcements to opted-in customers in three simple steps.
          </p>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={handleOpenNewWizard}
            className="inline-flex items-center gap-2 rounded-xl bg-[#E11D48] px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-700 whitespace-nowrap self-start cursor-pointer shadow-2xs"
          >
            <Plus className="h-4 w-4" />
            <span>New Broadcast</span>
          </button>
        )}
      </div>

      {bannerFeedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {bannerFeedback}
          </span>
          <button type="button" onClick={() => setBannerFeedback(null)} className="cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-10 text-center shadow-2xs">
          <div className="h-12 w-12 rounded-2xl bg-rose-50 text-[#E11D48] flex items-center justify-center mx-auto mb-4">
            <Megaphone className="h-6 w-6" />
          </div>
          <h3 className="font-display text-lg font-bold text-[#0F172A]">No campaigns yet.</h3>
          <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto leading-relaxed">
            Reach opted-in customers with approved WhatsApp messages in three guided steps: choose
            your audience, pick a template, and preview before sending.
          </p>
          {isAdmin && (
            <button
              type="button"
              onClick={handleOpenNewWizard}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#E11D48] px-5 py-2.5 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer shadow-2xs"
            >
              <Plus className="h-4 w-4" />
              <span>Create Your First Broadcast</span>
            </button>
          )}
        </div>
      ) : (
        <>
      {/* Status Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {(
          [
            { key: 'all', label: 'All' },
            { key: 'draft', label: 'Drafts' },
            { key: 'scheduled', label: 'Scheduled' },
            { key: 'running', label: 'Sending' },
            { key: 'paused', label: 'Paused' },
            { key: 'completed', label: 'Completed' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              statusFilter === tab.key
                ? 'bg-[#2563EB] text-white'
                : 'bg-white border border-[#E2E8F0] text-slate-600 hover:bg-[#F8FAFC]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Responsive Mobile Cards + Desktop Table */}
      <div className="grid grid-cols-1 gap-3 md:hidden">
        {filteredCampaigns.map((cmp) => (
          <div key={cmp.id} className="rounded-2xl border border-[#E2E8F0] bg-white p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-[#0F172A]">{cmp.name}</p>
                <p className="text-xs text-slate-500 capitalize mt-0.5">{cmp.status}</p>
              </div>
              <span className="text-xs font-semibold text-[#2563EB] tabular-nums">
                {cmp.metrics.eligible} ready
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-600 pt-2 border-t border-[#E2E8F0]">
              <span className="tabular-nums">
                Delivered: {cmp.metrics.delivered} · Read: {cmp.metrics.read}
              </span>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleDuplicate(cmp.id)}
                    className="text-xs font-semibold text-slate-600 cursor-pointer"
                  >
                    Duplicate
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setReportCampaign(cmp)}
                  className="text-xs font-semibold text-[#2563EB] cursor-pointer"
                >
                  Results
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Campaign</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Eligible</th>
                <th className="py-3 px-4 text-right">Delivered</th>
                <th className="py-3 px-4 text-right">Read</th>
                <th className="py-3 px-4 text-right">Failed</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {filteredCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    No campaigns in this view yet.
                  </td>
                </tr>
              ) : (
                filteredCampaigns.map((cmp) => {
                  const tpl = templates.find((t) => t.id === cmp.templateId);
                  return (
                    <tr key={cmp.id} className="hover:bg-[#F8FAFC] transition-colors">
                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-[#0F172A]">{cmp.name}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Message: {tpl ? formatTemplateTitle(tpl.name) : '—'}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 capitalize font-semibold text-slate-700">
                        {cmp.status}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#2563EB] font-semibold">
                        {cmp.metrics.eligible}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                        {cmp.metrics.delivered}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                        {cmp.metrics.read}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#E11D48]">
                        {cmp.metrics.failed}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setReportCampaign(cmp)}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-50 cursor-pointer"
                          >
                            <BarChart2 className="h-3 w-3 text-[#2563EB]" />
                            Results
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => handleDuplicate(cmp.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                              title="Duplicate campaign"
                            >
                              <Copy className="h-3 w-3" />
                              Duplicate
                            </button>
                          )}
                          {isAdmin && cmp.status === 'scheduled' && (
                            <button
                              type="button"
                              onClick={() => updateCampaignStatus(cmp.id, 'paused')}
                              className="p-1.5 rounded-lg border border-[#E2E8F0] text-slate-600 hover:bg-slate-50 cursor-pointer"
                              title="Pause"
                            >
                              <Pause className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {isAdmin && cmp.status === 'paused' && (
                            <button
                              type="button"
                              onClick={() => updateCampaignStatus(cmp.id, 'scheduled')}
                              className="p-1.5 rounded-lg border border-[#E2E8F0] text-[#2563EB] hover:bg-[#EFF6FF] cursor-pointer"
                              title="Resume"
                            >
                              <Play className="h-3.5 w-3.5" />
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

      {/* Campaign Results Modal */}
      {reportCampaign && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          onClick={() => setReportCampaign(null)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-[#E2E8F0] bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#0F172A]">
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
                  { label: 'Skipped (Opt-Out)', value: reportCampaign.metrics.skipped, color: 'text-amber-700' },
                  { label: 'Submitted', value: reportCampaign.metrics.submitted, color: 'text-slate-600' },
                ] as const
              ).map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3"
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
