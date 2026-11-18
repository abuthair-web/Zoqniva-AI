import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Edit3,
  GitBranch,
  Layers,
  MessageSquarePlus,
  Plus,
  Search,
  Settings2,
  Tag,
  Trash2,
  UserCheck,
  Users,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import type { AutomationRule, AutomationRuleType } from '@/types/crm';

type AutomationSection =
  | 'overview'
  | 'default_responses'
  | 'working_hours'
  | 'keyword_actions'
  | 'quick_replies'
  | 'flows_workflows';

interface QuickReplyItem {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  category: string;
}

const QUICK_REPLIES_STORAGE_KEY = 'zoqniva_quick_replies';

const RULE_LIBRARY_META: Record<
  AutomationRuleType,
  { friendlyTitle: string; whenLabel: string; doesLabel: string }
> = {
  welcome_message: {
    friendlyTitle: 'Welcome Response',
    whenLabel: 'When a customer messages you for the first time',
    doesLabel: 'Sends a greeting message automatically',
  },
  keyword_reply: {
    friendlyTitle: 'Keyword Reply',
    whenLabel: 'When a message matches configured trigger words',
    doesLabel: 'Sends a prepared response automatically',
  },
  business_hours: {
    friendlyTitle: 'Working Hours Check',
    whenLabel: 'Every time an inbound message arrives',
    doesLabel: 'Evaluates whether the business is currently open',
  },
  out_of_office: {
    friendlyTitle: 'After-Hours Reply',
    whenLabel: 'When a customer messages outside working hours',
    doesLabel: 'Replies with your expected response schedule',
  },
  auto_tagging: {
    friendlyTitle: 'Auto Tagging',
    whenLabel: 'When a message contains specified topic keywords',
    doesLabel: 'Adds a matching contact tag for filtering',
  },
  conversation_assignment: {
    friendlyTitle: 'Auto Assign Agent',
    whenLabel: 'When a new unassigned conversation arrives',
    doesLabel: 'Assigns the conversation to a selected team member',
  },
  human_handoff: {
    friendlyTitle: 'Human Handoff Escalation',
    whenLabel: 'When a customer requests an agent or manager',
    doesLabel: 'Flags the conversation for human follow-up',
  },
};

export function AutomationPage() {
  const {
    currentUser,
    business,
    automationRules,
    businessHours,
    updateBusinessHours,
    teamMembers,
    tags,
    createAutomationRule,
    toggleAutomationRule,
    updateAutomationRule,
    deleteAutomationRule,
  } = useApp();

  const isAdmin = currentUser?.role === 'admin';

  const [section, setSection] = useState<AutomationSection>('default_responses');
  const [keywordSearch, setKeywordSearch] = useState('');
  const [hoursSavedNotice, setHoursSavedNotice] = useState(false);

  // Quick Replies (persisted locally for agent reference)
  const [quickReplies, setQuickReplies] = useState<QuickReplyItem[]>(() => {
    try {
      const raw = localStorage.getItem(QUICK_REPLIES_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as QuickReplyItem[]) : [];
    } catch {
      return [];
    }
  });
  const [qrDrawerOpen, setQrDrawerOpen] = useState(false);
  const [qrShortcut, setQrShortcut] = useState('');
  const [qrTitle, setQrTitle] = useState('');
  const [qrCategory, setQrCategory] = useState('Support');
  const [qrBody, setQrBody] = useState('');
  const [copiedQrId, setCopiedQrId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(QUICK_REPLIES_STORAGE_KEY, JSON.stringify(quickReplies));
    } catch {
      // Ignore storage quota errors
    }
  }, [quickReplies]);

  // Edit / Create Automation Rule Drawers
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [editName, setEditName] = useState('');
  const [editResponse, setEditResponse] = useState('');
  const [editKeywords, setEditKeywords] = useState('');
  const [editAssignee, setEditAssignee] = useState('');
  const [editTagName, setEditTagName] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newRuleType, setNewRuleType] = useState<AutomationRuleType>('keyword_reply');
  const [newRuleName, setNewRuleName] = useState('');
  const [newResponse, setNewResponse] = useState('');
  const [newKeywords, setNewKeywords] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newEnabled, setNewEnabled] = useState(true);

  const openDaysSummary = useMemo(() => {
    const enabledDays = businessHours.filter((d) => d.enabled);
    if (enabledDays.length === 0) return 'No working hours configured';
    const first = enabledDays[0];
    return `${enabledDays.length} day${enabledDays.length === 1 ? '' : 's'} active (${first.open} – ${first.close} ${business.timezone})`;
  }, [businessHours, business.timezone]);

  const defaultResponseSlots = useMemo(() => {
    const findByType = (t: AutomationRuleType) =>
      automationRules.find((r) => r.ruleType === t);
    return [
      {
        key: 'welcome',
        ruleType: 'welcome_message' as AutomationRuleType,
        title: 'Welcome Response',
        desc: 'Send an automatic greeting when a customer messages your WhatsApp number for the first time.',
        rule: findByType('welcome_message'),
        supportedByRuleModel: true,
      },
      {
        key: 'after_hours',
        ruleType: 'out_of_office' as AutomationRuleType,
        title: 'After-Hours Reply',
        desc: 'Send a helpful away notice for messages received outside your configured working hours.',
        rule: findByType('out_of_office'),
        supportedByRuleModel: true,
      },
      {
        key: 'unavailable',
        ruleType: 'conversation_assignment' as AutomationRuleType,
        title: 'Auto-Assign / Agent Routing',
        desc: 'Route new unassigned chats automatically so an agent can respond promptly during working hours.',
        rule: findByType('conversation_assignment'),
        supportedByRuleModel: true,
      },
      {
        key: 'handoff',
        ruleType: 'human_handoff' as AutomationRuleType,
        title: 'Human Handoff Alert',
        desc: 'Escalate chats and pause automation immediately when a customer asks to speak with an agent.',
        rule: findByType('human_handoff'),
        supportedByRuleModel: true,
      },
    ];
  }, [automationRules]);

  const keywordActionRules = useMemo(() => {
    const q = keywordSearch.trim().toLowerCase();
    return automationRules.filter((r) => {
      const matchesType =
        r.ruleType === 'keyword_reply' ||
        r.ruleType === 'auto_tagging' ||
        r.ruleType === 'human_handoff' ||
        r.ruleType === 'conversation_assignment';
      if (!matchesType) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.triggerSummary.toLowerCase().includes(q) ||
        (r.keywords ?? []).some((k) => k.toLowerCase().includes(q)) ||
        (r.responseText ?? '').toLowerCase().includes(q)
      );
    });
  }, [automationRules, keywordSearch]);

  const activeCount = automationRules.filter((r) => r.isEnabled).length;

  const ruleIcon = (type: AutomationRuleType) => {
    switch (type) {
      case 'welcome_message':
        return MessageSquarePlus;
      case 'business_hours':
      case 'out_of_office':
        return Clock;
      case 'auto_tagging':
        return Tag;
      case 'conversation_assignment':
        return Users;
      case 'human_handoff':
        return UserCheck;
      default:
        return Workflow;
    }
  };

  const openEditor = (rule: AutomationRule) => {
    setEditingRule(rule);
    setEditName(rule.name);
    setEditResponse(rule.responseText ?? '');
    setEditKeywords(rule.keywords?.join(', ') ?? '');
    setEditAssignee(rule.assignToMemberId ?? teamMembers[0]?.id ?? '');
    setEditTagName(rule.tagName ?? tags[0]?.name ?? '');
    setEditEnabled(rule.isEnabled);
    setShowAdvanced(false);
  };

  const openCreateDrawer = (presetType: AutomationRuleType = 'keyword_reply') => {
    setNewRuleType(presetType);
    setNewRuleName(RULE_LIBRARY_META[presetType].friendlyTitle);
    setNewResponse('');
    setNewKeywords('');
    setNewAssignee(teamMembers[0]?.id ?? '');
    setNewTagName(tags[0]?.name ?? '');
    setNewEnabled(true);
    setCreateOpen(true);
  };

  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRule) return;
    const kwList = editKeywords
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const assignedMember = teamMembers.find((m) => m.id === editAssignee);

    updateAutomationRule(editingRule.id, {
      name: editName.trim() || editingRule.name,
      isEnabled: editEnabled,
      responseText: editResponse.trim() || undefined,
      keywords: kwList.length > 0 ? kwList : editingRule.keywords,
      assignToMemberId:
        editingRule.ruleType === 'conversation_assignment' ? editAssignee : editingRule.assignToMemberId,
      tagName: editingRule.ruleType === 'auto_tagging' ? editTagName : editingRule.tagName,
      triggerSummary:
        kwList.length > 0 ? `Keywords: ${kwList.join(', ')}` : editingRule.triggerSummary,
      actionSummary:
        editingRule.ruleType === 'conversation_assignment' && assignedMember
          ? `Assign to ${assignedMember.fullName}`
          : editingRule.ruleType === 'auto_tagging' && editTagName
          ? `Add tag: ${editTagName}`
          : editingRule.actionSummary,
    });
    setEditingRule(null);
  };

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    const meta = RULE_LIBRARY_META[newRuleType];
    const kwList = newKeywords
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const assignedMember = teamMembers.find((m) => m.id === newAssignee);

    let actionSummary = meta.doesLabel;
    if (newRuleType === 'conversation_assignment' && assignedMember) {
      actionSummary = `Assign to ${assignedMember.fullName}`;
    } else if (newRuleType === 'auto_tagging' && newTagName.trim()) {
      actionSummary = `Add tag: ${newTagName.trim()}`;
    }

    createAutomationRule({
      name: newRuleName.trim() || meta.friendlyTitle,
      ruleType: newRuleType,
      description: meta.doesLabel,
      isEnabled: newEnabled,
      triggerSummary: kwList.length > 0 ? `Keywords: ${kwList.join(', ')}` : meta.whenLabel,
      actionSummary,
      keywords:
        newRuleType === 'keyword_reply' ||
        newRuleType === 'auto_tagging' ||
        newRuleType === 'human_handoff'
          ? kwList
          : undefined,
      responseText:
        newRuleType === 'welcome_message' ||
        newRuleType === 'keyword_reply' ||
        newRuleType === 'out_of_office' ||
        newRuleType === 'human_handoff'
          ? newResponse.trim()
          : undefined,
      assignToMemberId: newRuleType === 'conversation_assignment' ? newAssignee || null : undefined,
      tagName: newRuleType === 'auto_tagging' ? newTagName.trim() || undefined : undefined,
    });
    setCreateOpen(false);
  };

  const handleAddQuickReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!qrTitle.trim() || !qrBody.trim()) return;
    const cleanShortcut = qrShortcut.trim().replace(/^\/+/, '').toLowerCase() || 'reply';
    setQuickReplies((prev) => [
      {
        id: `qr-${Date.now()}`,
        shortcut: `/${cleanShortcut}`,
        title: qrTitle.trim(),
        category: qrCategory.trim() || 'General',
        body: qrBody.trim(),
      },
      ...prev,
    ]);
    setQrShortcut('');
    setQrTitle('');
    setQrBody('');
    setQrDrawerOpen(false);
  };

  const handleCopyQuickReply = async (item: QuickReplyItem) => {
    try {
      await navigator.clipboard.writeText(item.body);
      setCopiedQrId(item.id);
      setTimeout(() => setCopiedQrId(null), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const navItems: Array<{
    key: AutomationSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { key: 'default_responses', label: 'Default Responses', icon: Zap },
    { key: 'working_hours', label: 'Working Hours', icon: Clock },
    { key: 'keyword_actions', label: 'Keyword Actions', icon: Tag },
    { key: 'quick_replies', label: 'Quick Replies', icon: BookOpen },
    { key: 'flows_workflows', label: 'Bot Flows & Workflows', icon: GitBranch },
    { key: 'overview', label: 'All Rules', icon: Layers },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8 max-w-[1440px] mx-auto space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-[#0F172A] tracking-tight">
            Automation
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Configure default greetings, working hours, keyword routing, and reusable quick replies.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <div className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-slate-600 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#2563EB]" />
            <span>
              <strong className="text-[#0F172A] tabular-nums">{activeCount}</strong> /{' '}
              <strong className="text-[#0F172A] tabular-nums">{automationRules.length}</strong> rules enabled
            </span>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => openCreateDrawer('keyword_reply')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create Rule</span>
            </button>
          )}
        </div>
      </div>

      {/* Honest Runtime Execution Notice */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-3 flex items-start gap-2.5 text-xs text-slate-600">
        <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <p>
          {business.messagingMode === 'test'
            ? 'Test Mode is active: automated WhatsApp replies are paused while sending is restricted to manual 1-to-1 messages to allowlisted test numbers.'
            : business.metaConnectionState === 'connected'
            ? 'Rules and working hours are saved cleanly. Server-side webhook automation execution remains paused until the backend webhook automation worker is enabled.'
            : 'Rules are saved safely in your workspace. Automated execution requires a verified WhatsApp Cloud API connection and backend webhook automation worker.'}
        </p>
      </div>

      {/* Two-Column Split: Sub-Nav Rail + Active Automation Panel */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Sub-Navigation Rail */}
        <nav className="w-full lg:w-56 shrink-0 flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]'
                    : 'text-slate-600 hover:bg-white hover:text-[#0F172A] border border-transparent'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Workspace Panel */}
        <div className="flex-1 w-full min-w-0 space-y-5">
          {/* SECTION 1: DEFAULT RESPONSES (Screenshot 9 pattern) */}
          {section === 'default_responses' && (
            <div className="space-y-5">
              {/* Top Setup Working Hours Banner */}
              <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-center shrink-0">
                    <Clock className="h-4 w-4 text-[#0F172A]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#0F172A]">Setup your working hours</p>
                    <p className="text-xs text-slate-500 truncate">{openDaysSummary}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSection('working_hours')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer shrink-0"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>Edit</span>
                </button>
              </div>

              <div>
                <h2 className="font-display text-base font-bold text-[#0F172A]">
                  Default Responses &amp; Routing
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure fallback greetings, outside-hours notices, and human handoff behavior.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {defaultResponseSlots.map((slot) => {
                  const rule = slot.rule;
                  const enabled = Boolean(rule?.isEnabled);
                  return (
                    <div
                      key={slot.key}
                      className="rounded-xl border border-[#E2E8F0] bg-white p-5 flex flex-col justify-between gap-4"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <button
                            type="button"
                            disabled={!isAdmin}
                            onClick={() => {
                              if (rule) {
                                toggleAutomationRule(rule.id);
                              } else {
                                openCreateDrawer(slot.ruleType);
                              }
                            }}
                            aria-label={`Toggle ${slot.title}`}
                            className={`w-10 h-6 rounded-full p-0.5 transition-colors cursor-pointer disabled:opacity-50 ${
                              enabled ? 'bg-emerald-600' : 'bg-slate-200'
                            }`}
                          >
                            <span
                              className={`block h-5 w-5 rounded-full bg-white shadow-xs transition-transform ${
                                enabled ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>

                          <span
                            className={`text-[11px] font-semibold ${
                              rule
                                ? enabled
                                  ? 'text-emerald-700'
                                  : 'text-slate-500'
                                : 'text-slate-400'
                            }`}
                          >
                            {rule ? (enabled ? 'Configured · Enabled' : 'Configured · Paused') : 'Not configured'}
                          </span>
                        </div>

                        <div>
                          <h3 className="font-display text-sm font-bold text-[#0F172A]">
                            {slot.title}
                          </h3>
                          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                            {slot.desc}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E2E8F0]">
                        <div className="flex-1 min-w-0 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-[11px] text-slate-600 truncate">
                          {rule?.responseText
                            ? rule.responseText
                            : rule?.actionSummary || 'No response configured yet'}
                        </div>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => (rule ? openEditor(rule) : openCreateDrawer(slot.ruleType))}
                            className="h-8 w-8 rounded-lg border border-[#E2E8F0] bg-white flex items-center justify-center text-slate-600 hover:bg-[#F8FAFC] hover:text-[#2563EB] cursor-pointer shrink-0"
                            aria-label={`Configure ${slot.title}`}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SECTION 2: WORKING HOURS */}
          {section === 'working_hours' && (
            <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-bold text-[#0F172A]">
                    Working Hours Management
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Define support availability in <strong className="text-[#0F172A]">{business.timezone}</strong> for after-hours reply rules.
                  </p>
                </div>
                {hoursSavedNotice && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                    <Check className="h-3.5 w-3.5" /> Saved
                  </span>
                )}
              </div>

              <div className="divide-y divide-[#E2E8F0] border border-[#E2E8F0] rounded-xl overflow-hidden text-xs">
                {businessHours.map((row, idx) => (
                  <div
                    key={row.day}
                    className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 bg-white"
                  >
                    <label className="flex items-center gap-2.5 font-semibold text-[#0F172A] w-36 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={!isAdmin}
                        checked={row.enabled}
                        onChange={(e) => {
                          const next = [...businessHours];
                          next[idx] = { ...row, enabled: e.target.checked };
                          updateBusinessHours(next);
                          setHoursSavedNotice(true);
                          setTimeout(() => setHoursSavedNotice(false), 1800);
                        }}
                        className="h-4 w-4 accent-[#2563EB]"
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
                          setHoursSavedNotice(true);
                          setTimeout(() => setHoursSavedNotice(false), 1800);
                        }}
                        className="rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 bg-white disabled:bg-[#F8FAFC] disabled:text-slate-400 tabular-nums"
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
                          setHoursSavedNotice(true);
                          setTimeout(() => setHoursSavedNotice(false), 1800);
                        }}
                        className="rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 bg-white disabled:bg-[#F8FAFC] disabled:text-slate-400 tabular-nums"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECTION 3: KEYWORD ACTIONS */}
          {section === 'keyword_actions' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={keywordSearch}
                    onChange={(e) => setKeywordSearch(e.target.value)}
                    placeholder="Search keyword or rule..."
                    className="w-full rounded-lg border border-[#E2E8F0] pl-9 pr-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => openCreateDrawer('keyword_reply')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer self-start sm:self-auto"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Keyword Action</span>
                  </button>
                )}
              </div>

              {keywordActionRules.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#E2E8F0] bg-white p-10 text-center space-y-2.5">
                  <Tag className="h-6 w-6 text-slate-400 mx-auto" />
                  <h3 className="font-display text-sm font-bold text-[#0F172A]">
                    No keyword actions configured
                  </h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Add keyword triggers to organize replies, tag inquiries automatically, or escalate specific requests to human agents.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-[#E2E8F0] bg-white divide-y divide-[#E2E8F0]">
                  {keywordActionRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-[#0F172A] text-sm">{rule.name}</p>
                          <span
                            className={`text-[11px] font-semibold ${
                              rule.isEnabled ? 'text-emerald-700' : 'text-slate-400'
                            }`}
                          >
                            · {rule.isEnabled ? 'Enabled' : 'Paused'}
                          </span>
                        </div>
                        <p className="text-slate-500">
                          <strong className="text-slate-700">Trigger:</strong> {rule.triggerSummary}
                        </p>
                        <p className="text-slate-500">
                          <strong className="text-slate-700">Action:</strong> {rule.actionSummary}
                        </p>
                      </div>

                      {isAdmin && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => toggleAutomationRule(rule.id)}
                            className="rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-[#F8FAFC] cursor-pointer"
                          >
                            {rule.isEnabled ? 'Pause' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditor(rule)}
                            className="rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 font-semibold text-[#2563EB] hover:bg-[#EFF6FF] cursor-pointer"
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SECTION 4: QUICK REPLIES */}
          {section === 'quick_replies' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-bold text-[#0F172A]">
                    Quick Replies Library
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Canned agent snippets saved locally in this browser for fast copy &amp; paste inside Team Inbox.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setQrDrawerOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>New Quick Reply</span>
                </button>
              </div>

              {quickReplies.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#E2E8F0] bg-white p-10 text-center space-y-2.5">
                  <BookOpen className="h-6 w-6 text-slate-400 mx-auto" />
                  <h3 className="font-display text-sm font-bold text-[#0F172A]">
                    No quick replies saved yet
                  </h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Create reusable answers for pricing, shipping updates, or greetings that agents can copy with one click.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {quickReplies.map((qr) => (
                    <div
                      key={qr.id}
                      className="rounded-xl border border-[#E2E8F0] bg-white p-4 space-y-3 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-mono text-[11px] font-semibold text-[#2563EB]">
                            {qr.shortcut}
                          </span>
                          <h3 className="font-semibold text-[#0F172A] text-sm mt-0.5">
                            {qr.title}
                          </h3>
                        </div>
                        <span className="text-[11px] text-slate-500">{qr.category}</span>
                      </div>
                      <p className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 text-slate-700 leading-relaxed whitespace-pre-wrap">
                        {qr.body}
                      </p>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyQuickReply(qr)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-[#F8FAFC] cursor-pointer"
                        >
                          {copiedQrId === qr.id ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-600" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Copy Text</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setQuickReplies((prev) => prev.filter((item) => item.id !== qr.id))
                          }
                          className="rounded-lg border border-rose-200 px-2.5 py-1.5 font-semibold text-[#E11D48] hover:bg-rose-50 cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SECTION 5: BOT FLOWS & WORKFLOWS (Explicit upcoming architecture) */}
          {section === 'flows_workflows' && (
            <div className="rounded-xl border border-[#E2E8F0] bg-white p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center shrink-0">
                  <Bot className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-base font-bold text-[#0F172A]">
                      Bot Flows &amp; Multi-Step Workflows
                    </h2>
                    <span className="text-[11px] font-semibold text-amber-700">
                      · Pending Server Execution Engine
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                    Visual multi-step conversation trees, webhook triggers, and delayed sequence follow-ups require a dedicated backend workflow execution worker in Supabase Edge Functions. You can configure single-step default responses, working hours, and keyword rules today using the tabs on the left.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 text-xs">
                <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-1.5">
                  <p className="font-semibold text-[#0F172A]">Interactive Bot Flows (Planned)</p>
                  <p className="text-slate-600 leading-relaxed">
                    Multi-turn WhatsApp button menus, lead qualification questions, and CRM field updates triggered by inbound webhooks.
                  </p>
                </div>
                <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-1.5">
                  <p className="font-semibold text-[#0F172A]">Event Sequences (Planned)</p>
                  <p className="text-slate-600 leading-relaxed">
                    Scheduled drip reminders and tag-triggered template follow-ups respecting opt-in consent and 24-hour customer service windows.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 6: ALL RULES OVERVIEW */}
          {section === 'overview' && (
            <>
              {automationRules.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-6 py-12 text-center space-y-3">
                  <Workflow className="h-7 w-7 text-[#2563EB] mx-auto" />
                  <div className="max-w-md mx-auto space-y-1">
                    <h3 className="font-display text-base font-bold text-[#0F172A]">
                      No automation rules created yet
                    </h3>
                    <p className="text-xs text-slate-500">
                      Configure default responses, keyword actions, or chat assignment rules when your workspace is ready.
                    </p>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => openCreateDrawer('welcome_message')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Create Automation Rule</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {automationRules.map((rule) => {
                    const Icon = ruleIcon(rule.ruleType);
                    const meta = RULE_LIBRARY_META[rule.ruleType];
                    return (
                      <div
                        key={rule.id}
                        className="rounded-xl border border-[#E2E8F0] bg-white p-5 flex flex-col justify-between gap-4"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                                  rule.isEnabled
                                    ? 'bg-[#EFF6FF] text-[#2563EB]'
                                    : 'bg-[#F8FAFC] text-slate-400'
                                }`}
                              >
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <h3 className="font-display text-sm font-bold text-[#0F172A] truncate">
                                  {rule.name || meta?.friendlyTitle}
                                </h3>
                                <p className="text-[11px] text-slate-500">
                                  <span
                                    className={
                                      rule.isEnabled ? 'text-emerald-700 font-semibold' : ''
                                    }
                                  >
                                    {rule.isEnabled ? 'Enabled' : 'Paused'}
                                  </span>
                                  {rule.executionCount > 0 && (
                                    <span className="tabular-nums">
                                      {' '}
                                      · Ran {rule.executionCount} times
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>

                            <button
                              type="button"
                              disabled={!isAdmin}
                              onClick={() => toggleAutomationRule(rule.id)}
                              aria-label={`Toggle ${rule.name}`}
                              className={`w-10 h-6 rounded-full p-0.5 transition-colors shrink-0 cursor-pointer disabled:opacity-50 ${
                                rule.isEnabled ? 'bg-emerald-600' : 'bg-slate-200'
                              }`}
                            >
                              <span
                                className={`block h-5 w-5 rounded-full bg-white shadow-xs transition-transform ${
                                  rule.isEnabled ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>

                          <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                            <p>
                              <strong className="text-[#0F172A]">When:</strong> {rule.triggerSummary}
                            </p>
                            <p>
                              <strong className="text-[#0F172A]">Action:</strong> {rule.actionSummary}
                            </p>
                          </div>

                          {rule.responseText && (
                            <div className="mt-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] p-2.5 text-[11px] text-slate-700 line-clamp-2">
                              &ldquo;{rule.responseText}&rdquo;
                            </div>
                          )}
                        </div>

                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => openEditor(rule)}
                            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#EFF6FF] hover:border-[#2563EB]/40 cursor-pointer"
                          >
                            <Settings2 className="h-3.5 w-3.5 text-[#2563EB]" />
                            <span>Configure</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Edit Automation Side Drawer */}
      {editingRule && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex justify-end"
          onClick={() => setEditingRule(null)}
        >
          <div
            className="w-full max-w-md h-full bg-white border-l border-[#E2E8F0] shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#0F172A]">
                  {RULE_LIBRARY_META[editingRule.ruleType]?.friendlyTitle || editingRule.name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {RULE_LIBRARY_META[editingRule.ruleType]?.whenLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingRule(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-[#F8FAFC] cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRule} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Rule Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <label className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 flex items-center justify-between cursor-pointer">
                <div>
                  <p className="font-semibold text-[#0F172A]">Enable rule</p>
                  <p className="text-[11px] text-slate-500">
                    {RULE_LIBRARY_META[editingRule.ruleType]?.doesLabel}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={editEnabled}
                  onChange={(e) => setEditEnabled(e.target.checked)}
                  className="h-4 w-4 accent-[#2563EB]"
                />
              </label>

              {editingRule.ruleType === 'conversation_assignment' && (
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">
                    Assign Unassigned Chats To
                  </label>
                  <select
                    value={editAssignee}
                    onChange={(e) => setEditAssignee(e.target.value)}
                    className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 bg-white focus:border-[#2563EB] focus:outline-none"
                  >
                    {teamMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.fullName} ({m.role})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {editingRule.ruleType === 'auto_tagging' && (
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">
                    Customer Tag to Apply
                  </label>
                  <select
                    value={editTagName}
                    onChange={(e) => setEditTagName(e.target.value)}
                    className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 bg-white focus:border-[#2563EB] focus:outline-none"
                  >
                    {tags.map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {editingRule.responseText !== undefined && (
                <div className="space-y-2.5">
                  <div>
                    <label className="block font-semibold text-[#0F172A] mb-1">
                      Automatic Reply Text
                    </label>
                    <textarea
                      rows={4}
                      value={editResponse}
                      onChange={(e) => setEditResponse(e.target.value)}
                      className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 leading-relaxed focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                  <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                    <p className="text-[11px] font-semibold text-slate-500 mb-1">Preview</p>
                    <div className="rounded-lg border border-[#E2E8F0] bg-white p-2.5 text-slate-800 leading-relaxed whitespace-pre-wrap">
                      {editResponse.trim() || 'No reply message entered yet.'}
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((s) => !s)}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between font-semibold text-[#0F172A] cursor-pointer"
                >
                  <span>Trigger Words &amp; Metadata</span>
                  <ChevronDown
                    className={`h-4 w-4 text-slate-400 transition-transform ${
                      showAdvanced ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {showAdvanced && (
                  <div className="px-3.5 pb-3.5 pt-2 border-t border-[#E2E8F0] space-y-2.5">
                    {editingRule.keywords !== undefined && (
                      <div>
                        <label className="block font-semibold text-[#0F172A] mb-1">
                          Keywords (comma-separated)
                        </label>
                        <input
                          type="text"
                          value={editKeywords}
                          onChange={(e) => setEditKeywords(e.target.value)}
                          placeholder="invoice, shipping, status"
                          className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2"
                        />
                      </div>
                    )}
                    <p className="text-[11px] text-slate-500">
                      Rule type: <span className="font-mono">{editingRule.ruleType}</span>
                    </p>
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center justify-between gap-2">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      deleteAutomationRule(editingRule.id);
                      setEditingRule(null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-semibold text-[#E11D48] hover:bg-rose-100 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete</span>
                  </button>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setEditingRule(null)}
                    className="rounded-lg border border-[#E2E8F0] px-4 py-2 font-semibold text-slate-700 hover:bg-[#F8FAFC] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[#2563EB] px-4 py-2 font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                  >
                    Save Rule
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Automation Side Drawer */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex justify-end"
          onClick={() => setCreateOpen(false)}
        >
          <div
            className="w-full max-w-md h-full bg-white border-l border-[#E2E8F0] shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#0F172A]">
                  Create Automation Rule
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure trigger conditions and response text.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-[#F8FAFC] cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateRule} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Rule Type</label>
                <select
                  value={newRuleType}
                  onChange={(e) => {
                    const nextType = e.target.value as AutomationRuleType;
                    setNewRuleType(nextType);
                    setNewRuleName(RULE_LIBRARY_META[nextType].friendlyTitle);
                  }}
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 bg-white focus:border-[#2563EB] focus:outline-none"
                >
                  {(Object.keys(RULE_LIBRARY_META) as AutomationRuleType[]).map((key) => (
                    <option key={key} value={key}>
                      {RULE_LIBRARY_META[key].friendlyTitle}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  {RULE_LIBRARY_META[newRuleType].whenLabel}
                </p>
              </div>

              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Rule Name *</label>
                <input
                  type="text"
                  required
                  value={newRuleName}
                  onChange={(e) => setNewRuleName(e.target.value)}
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              {(newRuleType === 'keyword_reply' ||
                newRuleType === 'auto_tagging' ||
                newRuleType === 'human_handoff') && (
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">
                    Trigger Words (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={newKeywords}
                    onChange={(e) => setNewKeywords(e.target.value)}
                    placeholder="e.g., pricing, invoice, agent"
                    className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              )}

              {newRuleType === 'conversation_assignment' && (
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">
                    Assign Chats To
                  </label>
                  {teamMembers.length === 0 ? (
                    <p className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-slate-500">
                      Add active team members first to assign conversations automatically.
                    </p>
                  ) : (
                    <select
                      value={newAssignee}
                      onChange={(e) => setNewAssignee(e.target.value)}
                      className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 bg-white focus:border-[#2563EB] focus:outline-none"
                    >
                      {teamMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.fullName} ({m.role})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {newRuleType === 'auto_tagging' && (
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">Tag Name</label>
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="e.g., Billing Support"
                    className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              )}

              {(newRuleType === 'welcome_message' ||
                newRuleType === 'keyword_reply' ||
                newRuleType === 'out_of_office' ||
                newRuleType === 'human_handoff') && (
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">Reply Message *</label>
                  <textarea
                    rows={4}
                    required
                    value={newResponse}
                    onChange={(e) => setNewResponse(e.target.value)}
                    placeholder="Enter the automated reply message..."
                    className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 leading-relaxed focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              )}

              <label className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 flex items-center justify-between cursor-pointer">
                <div>
                  <p className="font-semibold text-[#0F172A]">Enable rule immediately</p>
                  <p className="text-[11px] text-slate-500">
                    Saved in workspace configuration.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={newEnabled}
                  onChange={(e) => setNewEnabled(e.target.checked)}
                  className="h-4 w-4 accent-[#2563EB]"
                />
              </label>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg border border-[#E2E8F0] px-4 py-2 font-semibold text-slate-700 hover:bg-[#F8FAFC] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#2563EB] px-4 py-2 font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                >
                  Save Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Quick Reply Drawer */}
      {qrDrawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex justify-end"
          onClick={() => setQrDrawerOpen(false)}
        >
          <div
            className="w-full max-w-md h-full bg-white border-l border-[#E2E8F0] shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#0F172A]">
                  New Quick Reply
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Saved locally for fast agent reuse.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQrDrawerOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-[#F8FAFC] cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddQuickReply} className="p-5 space-y-4 text-xs flex-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">Shortcut</label>
                  <input
                    type="text"
                    value={qrShortcut}
                    onChange={(e) => setQrShortcut(e.target.value)}
                    placeholder="pricing"
                    className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 font-mono focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">Category</label>
                  <input
                    type="text"
                    value={qrCategory}
                    onChange={(e) => setQrCategory(e.target.value)}
                    placeholder="Support"
                    className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Title *</label>
                <input
                  type="text"
                  required
                  value={qrTitle}
                  onChange={(e) => setQrTitle(e.target.value)}
                  placeholder="Standard shipping timeline"
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Message Body *</label>
                <textarea
                  rows={5}
                  required
                  value={qrBody}
                  onChange={(e) => setQrBody(e.target.value)}
                  placeholder="Orders ship within 1–2 business days..."
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 leading-relaxed focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setQrDrawerOpen(false)}
                  className="rounded-lg border border-[#E2E8F0] px-4 py-2 font-semibold text-slate-700 hover:bg-[#F8FAFC] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#2563EB] px-4 py-2 font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                >
                  Save Quick Reply
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
