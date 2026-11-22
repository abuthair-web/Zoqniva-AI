import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  FileText,
  Loader2,
  Lock,
  Megaphone,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import {
  EXCLUSION_REASON_LABELS,
  type CampaignExclusionReason,
  type CampaignGuardianReport,
  type CampaignSnapshotResult,
} from '@/services/campaignEngineService';
import type { Campaign, CampaignStatus, TemplateCategory } from '@/types/crm';

const DRAFT_STORAGE_KEY = 'zoqniva_broadcast_composer_draft';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    validateCampaignPreflight,
    createCampaign,
    updateCampaign,
    createCampaignSnapshot,
    duplicateCampaign,
    updateCampaignStatus,
  } = useApp();

  const location = useLocation();
  const isAdmin = currentUser?.role === 'admin';

  const savedDraft = useMemo(() => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const [viewMode, setViewMode] = useState<'list' | 'compose'>(
    savedDraft?.inCompose === true && isAdmin ? 'compose' : 'list'
  );
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

  // Persisted Supabase Draft & Phase 1 Frozen Snapshot state
  const [savedCampaignId, setSavedCampaignId] = useState<string | null>(
    typeof savedDraft?.savedCampaignId === 'string' && UUID_REGEX.test(savedDraft.savedCampaignId)
      ? savedDraft.savedCampaignId
      : null
  );
  const [savedDraftDirty, setSavedDraftDirty] = useState<boolean>(
    typeof savedDraft?.savedDraftDirty === 'boolean'
      ? savedDraft.savedDraftDirty
      : !(typeof savedDraft?.savedCampaignId === 'string' && UUID_REGEX.test(savedDraft.savedCampaignId))
  );
  const [draftSaveSuccess, setDraftSaveSuccess] = useState<{
    id: string;
    name: string;
    status: string;
  } | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotResult, setSnapshotResult] = useState<CampaignSnapshotResult | null>(null);
  const [snapshotError, setSnapshotError] = useState<{
    code?: string;
    httpStatus?: number;
    message: string;
    migrationPending?: boolean;
  } | null>(null);
  const [pendingSnapshotKey, setPendingSnapshotKey] = useState<string | null>(null);

  // Campaign Guardian & Server-Verified Preflight state (Phase 1)
  const [guardianReport, setGuardianReport] = useState<CampaignGuardianReport | null>(null);
  const [validatingPreflight, setValidatingPreflight] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const validationSeqRef = useRef(0);

  const markDraftDirty = useCallback(() => {
    setSavedDraftDirty(true);
    setDraftSaveSuccess(null);
    setSnapshotResult(null);
    setSnapshotError(null);
    setPendingSnapshotKey(null);
  }, []);

  useEffect(() => {
    const state = location.state as { openWizard?: boolean } | null;
    if (state?.openWizard && isAdmin) {
      setWizardStage(1);
      setViewMode('compose');
    }
  }, [location.state, isAdmin]);

  useEffect(() => {
    if (viewMode === 'compose') {
      try {
        localStorage.setItem(
          DRAFT_STORAGE_KEY,
          JSON.stringify({
            inCompose: true,
            wizardStage,
            audienceMode,
            selectedTagIds,
            selectedContactIds,
            selectedTemplateId,
            varMapping,
            scheduleMode,
            scheduledFor,
            customName,
            savedCampaignId,
            savedDraftDirty,
          })
        );
      } catch {
        // Ignore storage quota issues
      }
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
    savedCampaignId,
    savedDraftDirty,
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

  const runDbPreflight = useCallback(async () => {
    if (!selectedTemplate?.id) {
      setGuardianReport(null);
      setPreflightError(null);
      return;
    }

    const seq = ++validationSeqRef.current;
    setValidatingPreflight(true);
    setPreflightError(null);

    try {
      const report = await validateCampaignPreflight({
        campaignId: savedCampaignId && UUID_REGEX.test(savedCampaignId) ? savedCampaignId : undefined,
        templateId: selectedTemplate.id,
        audienceFilter: {
          mode: audienceMode,
          tagIds: audienceMode === 'groups' ? selectedTagIds : [],
          contactIds: audienceMode === 'specific' ? selectedContactIds : [],
        },
        variableMapping: varMapping,
        scheduleMode: wizardStage === 3 ? scheduleMode : 'draft',
        scheduledAt:
          wizardStage === 3 && scheduleMode === 'scheduled' && scheduledFor
            ? (() => {
                const dt = new Date(scheduledFor);
                return Number.isNaN(dt.getTime()) ? scheduledFor : dt.toISOString();
              })()
            : null,
      });

      if (seq !== validationSeqRef.current) return;
      setGuardianReport(report);
      if (report.error) {
        setPreflightError(report.error);
      } else if (!report.serverVerified) {
        setPreflightError(
          'Audience and preflight rules could not be verified by the campaign-preflight Edge Function.'
        );
      }
    } catch (err) {
      if (seq !== validationSeqRef.current) return;
      setGuardianReport(null);
      setPreflightError(
        err instanceof Error
          ? err.message
          : 'Could not reach the campaign-preflight Edge Function.'
      );
    } finally {
      if (seq === validationSeqRef.current) {
        setValidatingPreflight(false);
      }
    }
  }, [
    savedCampaignId,
    selectedTemplate?.id,
    validateCampaignPreflight,
    audienceMode,
    selectedTagIds,
    selectedContactIds,
    varMapping,
    wizardStage,
    scheduleMode,
    scheduledFor,
  ]);

  // Automatically re-validate via campaign-preflight whenever Stage 2 or Stage 3 is active or refreshed
  useEffect(() => {
    if (viewMode !== 'compose' || (wizardStage !== 2 && wizardStage !== 3)) return;
    if (!selectedTemplate?.id) return;

    const timer = window.setTimeout(() => {
      void runDbPreflight();
    }, 180);

    return () => window.clearTimeout(timer);
  }, [viewMode, wizardStage, selectedTemplate?.id, runDbPreflight]);

  const isServerVerifiedAudience = Boolean(
    guardianReport?.serverVerified === true && guardianReport.audience?.ok === true
  );

  const effectiveAudience = useMemo(() => {
    if (isServerVerifiedAudience && guardianReport) {
      return {
        selectedCount: guardianReport.audience.totalMatched,
        eligibleCount: guardianReport.audience.eligibleCount,
        skippedCount: guardianReport.audience.excludedCount,
        groupedExclusions: guardianReport.audience.groupedExclusions,
        verifiedFromServer: true,
        localEstimateSelected: audienceStats.selectedCount,
        localEstimateEligible: audienceStats.eligibleCount,
      };
    }
    return {
      selectedCount: null as number | null,
      eligibleCount: null as number | null,
      skippedCount: 0,
      groupedExclusions: {
        opted_out: 0,
        no_explicit_consent: 0,
        invalid_phone: 0,
        duplicate_phone: 0,
        contact_not_in_business: 0,
      } as Record<CampaignExclusionReason, number>,
      verifiedFromServer: false,
      localEstimateSelected: audienceStats.selectedCount,
      localEstimateEligible: audienceStats.eligibleCount,
    };
  }, [isServerVerifiedAudience, guardianReport, audienceStats]);

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
    setSelectedTemplateId(approvedTemplates[0]?.id || '');
    setVarMapping({});
    setAudienceMode('all');
    setSelectedTagIds([]);
    setSelectedContactIds([]);
    setScheduleMode('immediate');
    setCustomName('');
    setConsentConfirmed(false);
    setSavedCampaignId(null);
    setSavedDraftDirty(true);
    setDraftSaveSuccess(null);
    setSnapshotResult(null);
    setSnapshotError(null);
    setPendingSnapshotKey(null);
    setGuardianReport(null);
    setPreflightError(null);
    setComposeError(null);
    setViewMode('compose');
  };

  const handleEditExistingCampaign = (cmp: Campaign) => {
    setSavedCampaignId(UUID_REGEX.test(cmp.id) ? cmp.id : null);
    setSavedDraftDirty(false);
    setDraftSaveSuccess({ id: cmp.id, name: cmp.name, status: cmp.status });
    setSelectedTemplateId(cmp.templateId || approvedTemplates[0]?.id || '');
    setVarMapping(cmp.variableMapping ?? {});
    setAudienceMode(cmp.audienceMode ?? 'all');
    setSelectedTagIds(cmp.targetTagIds ?? []);
    setSelectedContactIds(cmp.targetContactIds ?? []);
    setCustomName(cmp.name);
    if (cmp.scheduledFor) {
      const dt = new Date(cmp.scheduledFor);
      setScheduleMode('scheduled');
      if (!Number.isNaN(dt.getTime())) {
        setScheduledFor(dt.toISOString().slice(0, 16));
      }
    } else {
      setScheduleMode('immediate');
    }
    setConsentConfirmed(false);
    setSnapshotResult(null);
    setSnapshotError(null);
    setPendingSnapshotKey(null);
    setGuardianReport(null);
    setPreflightError(null);
    setComposeError(null);
    setWizardStage(2);
    setViewMode('compose');
  };

  const handleExitComposer = () => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ ...parsed, inCompose: false }));
      }
    } catch {
      // ignore
    }
    setViewMode('list');
  };

  const dispatchDisabledReason =
    business.messagingMode === 'test'
      ? 'Test Mode is active — Phase 1 bulk campaign dispatch is disabled. Draft saving and frozen snapshot creation never send WhatsApp messages.'
      : business.metaConnectionState !== 'connected'
      ? 'WhatsApp is not connected — Phase 1 bulk campaign dispatch is disabled. You can save drafts only.'
      : 'Phase 1 Campaign Foundation — bulk campaign dispatch is disabled in both Test Mode and Live Mode. Saving drafts and creating frozen snapshots never send WhatsApp messages.';

  /**
   * Save as Draft (persists to public.campaigns via awaited INSERT or UPDATE + read-back).
   * NEVER creates a frozen snapshot and NEVER dispatches any WhatsApp message.
   */
  const handleSaveDraft = async (opts?: { exitAfterSave?: boolean }) => {
    if (submitting || !selectedTemplate) return;

    setComposeError(null);
    setSnapshotError(null);
    setSubmitting(true);

    try {
      const payload = {
        name: customName.trim() || autoCampaignName,
        templateId: selectedTemplate.id,
        audienceMode,
        targetTagIds: audienceMode === 'groups' ? selectedTagIds : [],
        targetContactIds: audienceMode === 'specific' ? selectedContactIds : [],
        variableMapping: varMapping,
        scheduleMode: 'draft' as const,
        scheduledFor:
          scheduleMode === 'scheduled' && scheduledFor
            ? (() => {
                const dt = new Date(scheduledFor);
                return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString();
              })()
            : undefined,
        selectedCount: effectiveAudience.selectedCount ?? 0,
        eligibleCount: effectiveAudience.eligibleCount ?? 0,
        skippedCount: effectiveAudience.skippedCount,
      };

      const res =
        savedCampaignId && UUID_REGEX.test(savedCampaignId)
          ? await updateCampaign({ campaignId: savedCampaignId, ...payload })
          : await createCampaign(payload);

      if (!res.ok || !res.campaign || !UUID_REGEX.test(res.campaign.id)) {
        // Keep composer open and retain all entered campaign details on error
        setComposeError(
          res.error ?? 'Could not persist campaign draft in Supabase. Your inputs were preserved.'
        );
        return;
      }

      const persisted = res.campaign;
      setSavedCampaignId(persisted.id);
      setSavedDraftDirty(false);
      setPendingSnapshotKey(null);
      setSnapshotResult(null);
      setDraftSaveSuccess({
        id: persisted.id,
        name: persisted.name,
        status: persisted.status,
      });

      if (opts?.exitAfterSave) {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        setViewMode('list');
        setBannerFeedback({
          ok: true,
          text: `Saved draft "${persisted.name}" in Supabase (ID: ${persisted.id.slice(
            0,
            8
          )}…). No snapshot created and no WhatsApp messages were sent.`,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Explicit Phase 1 action: Create Frozen Snapshot via campaign-preflight Edge Function.
   * Requires an already-saved, clean Supabase campaign draft ID and a verified passing preflight.
   * NEVER sends any WhatsApp messages.
   */
  const handleCreateSnapshot = async () => {
    if (
      snapshotLoading ||
      submitting ||
      validatingPreflight ||
      !savedCampaignId ||
      !UUID_REGEX.test(savedCampaignId) ||
      savedDraftDirty ||
      !consentConfirmed ||
      !guardianReport?.serverVerified ||
      !guardianReport.ok ||
      guardianReport.migrationPending
    ) {
      return;
    }

    setSnapshotError(null);
    setComposeError(null);
    setSnapshotLoading(true);

    // Reuse the same idempotencyKey ONLY for retries of this exact user-initiated attempt
    const idempotencyKey = pendingSnapshotKey ?? crypto.randomUUID();
    setPendingSnapshotKey(idempotencyKey);

    try {
      const res = await createCampaignSnapshot({
        campaignId: savedCampaignId,
        idempotencyKey,
      });

      if (res.guardian) {
        setGuardianReport(res.guardian);
      }

      if (!res.ok) {
        setSnapshotError({
          code: res.code,
          httpStatus: res.httpStatus,
          message:
            res.error ??
            'Could not create frozen campaign snapshot via campaign-preflight.',
          migrationPending: res.migrationPending,
        });

        // Deterministic validation/auth/migration rejections should get a fresh key after user fixes them;
        // transient network/500/502/504 errors keep pendingSnapshotKey so a retry reuses the same key.
        const isTransientRetryable =
          res.code === 'EDGE_FUNCTION_UNAVAILABLE' ||
          res.httpStatus === 500 ||
          res.httpStatus === 502 ||
          res.httpStatus === 504;
        if (!isTransientRetryable) {
          setPendingSnapshotKey(null);
        }
        return;
      }

      setSnapshotResult(res);
      // Clear key on completion so a future NEW user-initiated snapshot gets a fresh UUID
      setPendingSnapshotKey(null);
    } catch (err) {
      setSnapshotError({
        code: 'EDGE_FUNCTION_UNAVAILABLE',
        message:
          err instanceof Error
            ? err.message
            : 'Network error while calling campaign-preflight to create snapshot.',
      });
    } finally {
      setSnapshotLoading(false);
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
        subtitle: validatingPreflight
          ? 'Validating via server...'
          : effectiveAudience.verifiedFromServer && effectiveAudience.eligibleCount !== null
          ? `${effectiveAudience.eligibleCount} eligible contact${
              effectiveAudience.eligibleCount === 1 ? '' : 's'
            }`
          : 'Not verified',
        icon: Users,
      },
      {
        num: 3,
        title: 'Review & Snapshot',
        subtitle: savedCampaignId && !savedDraftDirty ? 'Draft saved' : 'Save draft & verify',
        icon: Calendar,
      },
    ];

    const canAccessStage2 = Boolean(selectedTemplate);
    const canAccessStage3 =
      Boolean(selectedTemplate) &&
      effectiveAudience.verifiedFromServer &&
      (effectiveAudience.eligibleCount ?? 0) > 0;

    return (
      <div className="p-4 sm:p-6 pb-20 lg:pb-8 max-w-[1440px] mx-auto space-y-5">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleExitComposer}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Campaigns</span>
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold text-[#0F172A]">
                  {savedCampaignId ? 'Edit Campaign Draft' : 'Create Campaign'}
                </h2>
                {savedCampaignId && (
                  <span className="text-[11px] font-mono text-slate-500">
                    #{savedCampaignId.slice(0, 8)}
                    {savedDraftDirty ? ' · Unsaved changes' : ' · Saved in Supabase'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Stage {wizardStage} of 3 · {stages[wizardStage - 1].title}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleSaveDraft()}
            disabled={submitting || !selectedTemplate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>
              {submitting
                ? 'Saving Draft...'
                : savedCampaignId
                ? 'Update Saved Draft'
                : 'Save as Draft'}
            </span>
          </button>
        </div>

        {draftSaveSuccess && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                Persisted draft &ldquo;{draftSaveSuccess.name}&rdquo; in Supabase (ID:{' '}
                <span className="font-mono">{draftSaveSuccess.id.slice(0, 8)}</span>). No snapshot
                created and no WhatsApp messages were sent.
              </span>
            </span>
            <button
              type="button"
              onClick={() => setDraftSaveSuccess(null)}
              className="cursor-pointer shrink-0"
              aria-label="Dismiss save confirmation"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

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
                              onClick={() => {
                                setSelectedTemplateId(tpl.id);
                                markDraftDirty();
                              }}
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
                                  onChange={(e) => {
                                    setVarMapping((p) => ({ ...p, [key]: e.target.value }));
                                    markDraftDirty();
                                  }}
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
                      onClick={() => {
                        setAudienceMode(opt.key);
                        markDraftDirty();
                      }}
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
                              onClick={() => {
                                setSelectedTagIds((prev) =>
                                  active ? prev.filter((x) => x !== t.id) : [...prev, t.id]
                                );
                                markDraftDirty();
                              }}
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
                                onChange={() => {
                                  setSelectedContactIds((prev) =>
                                    checked ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                                  );
                                  markDraftDirty();
                                }}
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

                {/* Audience Eligibility Summary (Server-Verified via campaign-preflight) */}
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs text-slate-500">Eligible Opted-In Recipients</p>
                        {validatingPreflight ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB]">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Validating via campaign-preflight...
                          </span>
                        ) : effectiveAudience.verifiedFromServer ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Verified by campaign-preflight
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#E11D48]">
                            <AlertCircle className="h-3 w-3" />
                            Not Verified
                          </span>
                        )}
                      </div>
                      <div className="flex items-baseline gap-2.5 mt-0.5">
                        {effectiveAudience.verifiedFromServer &&
                        effectiveAudience.eligibleCount !== null ? (
                          <>
                            <p className="font-display text-2xl font-bold text-[#2563EB] tabular-nums">
                              {effectiveAudience.eligibleCount}
                            </p>
                            <span className="text-xs text-slate-500 tabular-nums">
                              of {effectiveAudience.selectedCount ?? 0} matched in Supabase
                            </span>
                          </>
                        ) : (
                          <>
                            <p className="font-display text-2xl font-bold text-slate-400 tabular-nums">
                              —
                            </p>
                            <span className="text-xs text-slate-500">
                              {validatingPreflight
                                ? 'Waiting for server-verified count...'
                                : 'Server verification required before continuing'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void runDbPreflight()}
                        disabled={validatingPreflight}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#0F172A] hover:bg-[#F1F5F9] disabled:opacity-50 cursor-pointer"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${validatingPreflight ? 'animate-spin' : ''}`}
                        />
                        <span>Re-validate</span>
                      </button>

                      {effectiveAudience.verifiedFromServer &&
                        effectiveAudience.skippedCount > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowExcludedDetails((v) => !v)}
                            className="text-xs font-semibold text-slate-600 hover:text-[#0F172A] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <span className="tabular-nums">
                              {effectiveAudience.skippedCount} automatically excluded
                            </span>
                            <ChevronDown
                              className={`h-3.5 w-3.5 transition-transform ${
                                showExcludedDetails ? 'rotate-180' : ''
                              }`}
                            />
                          </button>
                        )}
                    </div>
                  </div>

                  {showExcludedDetails &&
                    effectiveAudience.verifiedFromServer &&
                    effectiveAudience.skippedCount > 0 && (
                      <div className="pt-2.5 border-t border-[#E2E8F0] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px]">
                        {(
                          Object.entries(effectiveAudience.groupedExclusions) as Array<
                            [CampaignExclusionReason, number]
                          >
                        )
                          .filter(([, count]) => count > 0)
                          .map(([reason, count]) => (
                            <div
                              key={reason}
                              className="flex items-center justify-between rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1.5"
                            >
                              <span className="text-slate-600">
                                {EXCLUSION_REASON_LABELS[reason]}
                              </span>
                              <span className="font-semibold text-[#0F172A] tabular-nums">
                                {count}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}

                  {guardianReport?.serverVerified &&
                    guardianReport.messagingMode === 'test' &&
                    (effectiveAudience.eligibleCount ?? 0) > 0 && (
                      <div className="pt-2 border-t border-[#E2E8F0] text-[11px] text-amber-800 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          Test Mode allowlist check: {guardianReport.eligibleInTestAllowlist} of{' '}
                          {effectiveAudience.eligibleCount} eligible contact
                          {effectiveAudience.eligibleCount === 1 ? '' : 's'} are in your Test Mode
                          allowlist. Bulk dispatch remains disabled in Test Mode.
                        </span>
                      </div>
                    )}

                  {guardianReport?.serverVerified && guardianReport.migrationPending && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 flex items-start gap-2">
                      <Database className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-700" />
                      <span>
                        <strong>Phase 1 SQL installation pending:</strong>{' '}
                        <code className="font-mono">campaign_runs</code> and snapshot RPCs are not
                        installed in Supabase yet. Read-only audience validation and Save as Draft
                        work normally; creating a frozen snapshot will remain disabled until the
                        reviewed Phase 1 SQL is applied.
                      </span>
                    </div>
                  )}

                  {preflightError && (
                    <div className="rounded-md border border-[#E11D48]/30 bg-rose-50 px-3 py-2.5 text-[11px] text-[#E11D48] space-y-1">
                      <div className="flex items-start gap-2 font-semibold">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>
                          Server preflight verification failed
                          {guardianReport?.httpStatus ? ` (HTTP ${guardianReport.httpStatus})` : ''}
                          {guardianReport?.errorCode ? ` · ${guardianReport.errorCode}` : ''}
                        </span>
                      </div>
                      <p className="pl-5 text-rose-800">{preflightError}</p>
                    </div>
                  )}

                  {guardianReport?.serverVerified &&
                    guardianReport.audience?.invalidTagIds &&
                    guardianReport.audience.invalidTagIds.length > 0 && (
                      <div className="rounded-md border border-[#E11D48]/30 bg-rose-50 px-3 py-2 text-[11px] text-[#E11D48] flex items-start gap-2">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>
                          {guardianReport.audience.invalidTagIds.length} selected tag
                          {guardianReport.audience.invalidTagIds.length === 1 ? '' : 's'} could not
                          be verified in the active workspace and were ignored.
                        </span>
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

            {/* STAGE 3: REVIEW & SNAPSHOT */}
            {wizardStage === 3 && (
              <>
                <div>
                  <h3 className="font-display text-base font-bold text-[#0F172A]">
                    3. Review, Save Draft &amp; Frozen Snapshot
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Review server-verified audience eligibility, save your draft in Supabase, and
                    optionally create a frozen Phase 1 snapshot ({business.timezone}).
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
                        onChange={(e) => {
                          setCustomName(e.target.value);
                          markDraftDirty();
                        }}
                        placeholder={autoCampaignName}
                        className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                      <div>
                        <p className="text-[11px] text-slate-500">Eligible Audience</p>
                        {effectiveAudience.verifiedFromServer &&
                        effectiveAudience.eligibleCount !== null ? (
                          <p className="font-semibold text-[#0F172A] mt-0.5 tabular-nums">
                            {effectiveAudience.eligibleCount} contact
                            {effectiveAudience.eligibleCount === 1 ? '' : 's'}
                            {effectiveAudience.skippedCount > 0 && (
                              <span className="text-slate-500 font-normal">
                                {' '}
                                ({effectiveAudience.skippedCount} excluded)
                              </span>
                            )}
                          </p>
                        ) : (
                          <p className="font-semibold text-[#E11D48] mt-0.5">Not Verified</p>
                        )}
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500">Template</p>
                        <p className="font-semibold text-[#0F172A] mt-0.5 truncate">
                          {selectedTemplate ? formatTemplateTitle(selectedTemplate.name) : '—'}
                        </p>
                      </div>
                    </div>

                    {/* Campaign Guardian Preflight Summary */}
                    <div className="rounded-lg border border-[#E2E8F0] bg-white p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {guardianReport?.serverVerified && guardianReport.ok ? (
                            <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                          ) : (
                            <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                          )}
                          <p className="font-bold text-[#0F172A]">Campaign Guardian Preflight</p>
                          {guardianReport?.serverVerified ? (
                            <span className="text-[10px] font-semibold text-emerald-700">
                              · Verified by campaign-preflight
                            </span>
                          ) : !validatingPreflight ? (
                            <span className="text-[10px] font-semibold text-[#E11D48]">
                              · Not Verified
                            </span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => void runDbPreflight()}
                          disabled={validatingPreflight}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:underline disabled:opacity-50 cursor-pointer"
                        >
                          <RefreshCw
                            className={`h-3 w-3 ${validatingPreflight ? 'animate-spin' : ''}`}
                          />
                          <span>{validatingPreflight ? 'Checking...' : 'Re-check'}</span>
                        </button>
                      </div>

                      {validatingPreflight && !guardianReport ? (
                        <div className="flex items-center gap-2 py-2 text-[11px] text-slate-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2563EB]" />
                          <span>
                            Verifying admin permissions, Meta template approval, WhatsApp account,
                            and opted-in contacts via campaign-preflight...
                          </span>
                        </div>
                      ) : guardianReport ? (
                        <div className="space-y-1.5">
                          {guardianReport.checks.map((chk) => (
                            <div
                              key={chk.code}
                              className="flex items-start gap-2 rounded-md bg-[#F8FAFC] px-2.5 py-1.5 text-[11px]"
                            >
                              {chk.status === 'pass' ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                              ) : chk.status === 'warn' ? (
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                              ) : (
                                <AlertCircle className="h-3.5 w-3.5 text-[#E11D48] shrink-0 mt-0.5" />
                              )}
                              <div className="min-w-0">
                                <span className="font-semibold text-[#0F172A]">{chk.label}: </span>
                                <span
                                  className={
                                    chk.status === 'fail' ? 'text-[#E11D48]' : 'text-slate-600'
                                  }
                                >
                                  {chk.message}
                                </span>
                              </div>
                            </div>
                          ))}

                          {effectiveAudience.verifiedFromServer &&
                            effectiveAudience.skippedCount > 0 && (
                              <div className="pt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                                {(
                                  Object.entries(effectiveAudience.groupedExclusions) as Array<
                                    [CampaignExclusionReason, number]
                                  >
                                )
                                  .filter(([, count]) => count > 0)
                                  .map(([reason, count]) => (
                                    <span
                                      key={reason}
                                      className="rounded border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-slate-600 tabular-nums"
                                    >
                                      {EXCLUSION_REASON_LABELS[reason]}: <strong>{count}</strong>
                                    </span>
                                  ))}
                              </div>
                            )}
                        </div>
                      ) : preflightError ? (
                        <p className="text-[11px] text-[#E11D48]">{preflightError}</p>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setScheduleMode('immediate');
                          markDraftDirty();
                        }}
                        className={`rounded-lg border p-3 text-left cursor-pointer ${
                          scheduleMode === 'immediate'
                            ? 'border-[#2563EB] bg-[#EFF6FF]/60'
                            : 'border-[#E2E8F0] hover:bg-[#F8FAFC]'
                        }`}
                      >
                        <p className="font-bold text-[#0F172A]">Immediate (Phase 1 Draft)</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          No bulk send in Phase 1
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setScheduleMode('scheduled');
                          markDraftDirty();
                        }}
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
                          onChange={(e) => {
                            setScheduledFor(e.target.value);
                            markDraftDirty();
                          }}
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
                        I confirm these{' '}
                        {effectiveAudience.verifiedFromServer &&
                        effectiveAudience.eligibleCount !== null
                          ? effectiveAudience.eligibleCount
                          : 'server-verified'}{' '}
                        recipients explicitly opted in to receive WhatsApp messages from{' '}
                        {business.name}.
                      </span>
                    </label>
                  </div>

                  {/* Final Preview + Distinct Draft Save & Frozen Snapshot Actions */}
                  <div className="lg:col-span-5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 flex flex-col justify-between gap-4">
                    <div className="space-y-3">
                      <p className="text-xs font-bold text-[#0F172A]">Final Message Preview</p>
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
                          <p className="text-[11px] text-slate-400">
                            {selectedTemplate.footerText}
                          </p>
                        )}
                      </div>

                      {/* Frozen Snapshot Result Banner */}
                      {snapshotResult?.ok && (
                        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-[11px] text-emerald-950 space-y-1">
                          <div className="flex items-center gap-1.5 font-bold text-emerald-900">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                            <span>
                              {snapshotResult.replayed
                                ? 'Idempotent Snapshot Replay Returned'
                                : 'Frozen Snapshot Created (No Messages Sent)'}
                            </span>
                          </div>
                          <p className="font-mono text-[10px] text-emerald-800 break-all">
                            Run #{snapshotResult.runNumber ?? 1} · ID: {snapshotResult.runId}
                          </p>
                          <p className="tabular-nums">
                            Status: <strong className="uppercase">{snapshotResult.status ?? 'validated'}</strong> ·{' '}
                            <strong>{snapshotResult.eligibleCount ?? 0}</strong> eligible,{' '}
                            <strong>{snapshotResult.excludedCount ?? 0}</strong> excluded.
                          </p>
                        </div>
                      )}

                      {/* Frozen Snapshot Error Banner */}
                      {snapshotError && (
                        <div className="rounded-lg border border-[#E11D48]/30 bg-rose-50 p-3 text-[11px] text-[#E11D48] space-y-1">
                          <div className="flex items-start gap-1.5 font-bold">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>
                              Snapshot rejected
                              {snapshotError.httpStatus ? ` (HTTP ${snapshotError.httpStatus})` : ''}
                              {snapshotError.code ? ` · ${snapshotError.code}` : ''}
                            </span>
                          </div>
                          <p className="pl-5 text-rose-900">{snapshotError.message}</p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2.5 pt-2 border-t border-[#E2E8F0]">
                      {/* Step A: Save Draft to public.campaigns (never creates snapshot, never sends) */}
                      <button
                        type="button"
                        disabled={submitting || !selectedTemplate}
                        onClick={() => void handleSaveDraft()}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563EB] py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-45 transition-colors cursor-pointer"
                      >
                        {submitting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FileText className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {submitting
                            ? 'Saving Draft to Supabase...'
                            : savedCampaignId && !savedDraftDirty
                            ? 'Draft Saved in Supabase'
                            : savedCampaignId
                            ? 'Update Saved Draft'
                            : 'Save as Draft'}
                        </span>
                      </button>

                      {/* Step B: Explicit Create Frozen Snapshot (only after persisted clean draft + verified preflight + migration ready) */}
                      <button
                        type="button"
                        disabled={
                          snapshotLoading ||
                          submitting ||
                          validatingPreflight ||
                          !savedCampaignId ||
                          savedDraftDirty ||
                          !consentConfirmed ||
                          !guardianReport?.serverVerified ||
                          !guardianReport.ok ||
                          guardianReport.migrationPending
                        }
                        onClick={() => void handleCreateSnapshot()}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F172A] py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-45 transition-colors cursor-pointer"
                      >
                        {snapshotLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Lock className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {snapshotLoading
                            ? 'Creating Frozen Snapshot...'
                            : 'Create Frozen Snapshot (No Send)'}
                        </span>
                      </button>

                      {/* Honest prerequisite hint when Snapshot button is locked */}
                      {(!savedCampaignId || savedDraftDirty) && (
                        <p className="text-[11px] text-slate-500 leading-snug">
                          Save your draft to Supabase first. Frozen snapshot reads the persisted
                          campaign record directly on the server.
                        </p>
                      )}
                      {savedCampaignId &&
                        !savedDraftDirty &&
                        guardianReport?.migrationPending && (
                          <p className="text-[11px] text-amber-800 leading-snug">
                            Frozen snapshot is disabled until the reviewed Phase 1 SQL tables and
                            RPCs are installed in Supabase.
                          </p>
                        )}

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
                    {isAdmin && cmp.status === 'draft' && (
                      <button
                        type="button"
                        onClick={() => handleEditExistingCampaign(cmp)}
                        className="font-semibold text-[#0F172A] cursor-pointer"
                      >
                        Edit
                      </button>
                    )}
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
                              {isAdmin && cmp.status === 'draft' && (
                                <button
                                  type="button"
                                  onClick={() => handleEditExistingCampaign(cmp)}
                                  title="Edit draft & run preflight"
                                  className="inline-flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
                                >
                                  <Pencil className="h-3 w-3 text-slate-600" />
                                  Edit
                                </button>
                              )}
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
