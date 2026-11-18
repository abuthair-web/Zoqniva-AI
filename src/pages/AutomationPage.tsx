import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  MessageSquarePlus,
  Plus,
  Settings2,
  Tag,
  Trash2,
  UserCheck,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import type { AutomationRule, AutomationRuleType } from '@/types/crm';

const RULE_LIBRARY_META: Record<
  AutomationRuleType,
  { friendlyTitle: string; whenLabel: string; doesLabel: string }
> = {
  welcome_message: {
    friendlyTitle: 'Welcome Reply',
    whenLabel: 'When a customer messages you for the first time',
    doesLabel: 'Sends a friendly welcome greeting automatically',
  },
  keyword_reply: {
    friendlyTitle: 'Frequently Asked Questions',
    whenLabel: 'When a customer asks about orders, invoices, or delivery',
    doesLabel: 'Replies right away with helpful next steps',
  },
  business_hours: {
    friendlyTitle: 'Business Hours Schedule',
    whenLabel: 'Every time a new message arrives',
    doesLabel: 'Checks whether your shop or support team is open',
  },
  out_of_office: {
    friendlyTitle: 'Outside Business Hours Reply',
    whenLabel: 'When a customer messages while your team is closed',
    doesLabel: 'Lets them know when your team will reply',
  },
  auto_tagging: {
    friendlyTitle: 'Automatic Customer Grouping',
    whenLabel: 'When a message mentions refunds, billing, or VAT',
    doesLabel: 'Organizes the customer into the matching group',
  },
  conversation_assignment: {
    friendlyTitle: 'Assign New Chats Automatically',
    whenLabel: 'When a new unassigned chat arrives',
    doesLabel: 'Assigns the chat to a team member so nothing is missed',
  },
  human_handoff: {
    friendlyTitle: 'Transfer to Human Agent',
    whenLabel: 'When a customer asks for a manager, agent, or human',
    doesLabel: 'Pauses automated replies and alerts your team',
  },
};

export function AutomationPage() {
  const {
    currentUser,
    business,
    automationRules,
    teamMembers,
    tags,
    createAutomationRule,
    toggleAutomationRule,
    updateAutomationRule,
    deleteAutomationRule,
  } = useApp();

  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [editResponse, setEditResponse] = useState('');
  const [editKeywords, setEditKeywords] = useState('');
  const [editAssignee, setEditAssignee] = useState('');
  const [editTagName, setEditTagName] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newRuleType, setNewRuleType] = useState<AutomationRuleType>('welcome_message');
  const [newRuleName, setNewRuleName] = useState('');
  const [newResponse, setNewResponse] = useState('');
  const [newKeywords, setNewKeywords] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newEnabled, setNewEnabled] = useState(true);

  const isAdmin = currentUser?.role === 'admin';

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
    setEditResponse(rule.responseText ?? '');
    setEditKeywords(rule.keywords?.join(', ') ?? '');
    setEditAssignee(rule.assignToMemberId ?? teamMembers[0]?.id ?? '');
    setEditTagName(rule.tagName ?? tags[0]?.name ?? 'Billing Review');
    setEditEnabled(rule.isEnabled);
    setShowAdvanced(false);
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
          ? `Add group: ${editTagName}`
          : editingRule.actionSummary,
    });
    setEditingRule(null);
  };

  const openCreateDrawer = () => {
    setNewRuleType('welcome_message');
    setNewRuleName(RULE_LIBRARY_META.welcome_message.friendlyTitle);
    setNewResponse('');
    setNewKeywords('');
    setNewAssignee(teamMembers[0]?.id ?? '');
    setNewTagName(tags[0]?.name ?? '');
    setNewEnabled(true);
    setCreateOpen(true);
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
      actionSummary = `Add group: ${newTagName.trim()}`;
    }

    createAutomationRule({
      name: newRuleName.trim() || meta.friendlyTitle,
      ruleType: newRuleType,
      description: meta.doesLabel,
      isEnabled: newEnabled,
      triggerSummary: kwList.length > 0 ? `Keywords: ${kwList.join(', ')}` : meta.whenLabel,
      actionSummary,
      keywords: newRuleType === 'keyword_reply' || newRuleType === 'auto_tagging' || newRuleType === 'human_handoff' ? kwList : undefined,
      responseText:
        newRuleType === 'welcome_message' || newRuleType === 'keyword_reply' || newRuleType === 'out_of_office' || newRuleType === 'human_handoff'
          ? newResponse.trim()
          : undefined,
      assignToMemberId: newRuleType === 'conversation_assignment' ? newAssignee || null : undefined,
      tagName: newRuleType === 'auto_tagging' ? newTagName.trim() || undefined : undefined,
    });
    setCreateOpen(false);
  };

  const activeCount = automationRules.filter((r) => r.isEnabled).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8 max-w-[1440px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-[2px] w-5 bg-[#F4B942]" />
            <span className="text-xs font-semibold text-[#2563EB]">Automatic Replies &amp; Routing</span>
          </div>
          <h2 className="font-display text-2xl font-bold text-[#0F172A] tracking-tight mt-0.5">
            Automation Library
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Create WhatsApp helpers for greetings, common questions, business hours, and team routing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start">
          {automationRules.length > 0 && (
            <div className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2.5 text-xs flex items-center gap-2.5">
              <CheckCircle2 className="h-4 w-4 text-[#2563EB]" />
              <span className="text-slate-600">
                <strong className="text-[#0F172A] tabular-nums">{activeCount}</strong> of{' '}
                <strong className="text-[#0F172A] tabular-nums">{automationRules.length}</strong>{' '}
                automations turned on
              </span>
            </div>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={openCreateDrawer}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] shadow-2xs cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create Automation</span>
            </button>
          )}
        </div>
      </div>

      {/* Plain-Language Status Banner */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-3 flex items-start gap-3 text-xs text-slate-600">
        <AlertCircle className="h-4 w-4 text-[#F4B942] shrink-0 mt-0.5" />
        <p>
          {business.messagingMode === 'test'
            ? 'Test Mode is active: automated replies are disabled so only manual 1-to-1 messages to allowlisted test numbers are sent.'
            : business.metaConnectionState === 'connected'
            ? 'Your WhatsApp connection is active. Note: automated webhook replies remain paused until enabled in a future automation rollout.'
            : 'Your rules are saved safely. Automatic replies will stay paused until you finish connecting your WhatsApp number in Settings.'}
        </p>
      </div>

      {automationRules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E2E8F0] bg-white px-6 py-14 text-center space-y-4">
          <div className="h-12 w-12 rounded-2xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center mx-auto">
            <Workflow className="h-6 w-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="font-display text-base font-bold text-[#0F172A]">
              No automations created yet.
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Set up welcome replies, keyword responses, outside-hours messages, or automatic chat assignment when you are ready.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={openCreateDrawer}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create Automation</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {automationRules.map((rule) => {
          const Icon = ruleIcon(rule.ruleType);
          const meta = RULE_LIBRARY_META[rule.ruleType];
          return (
            <div
              key={rule.id}
              className="rounded-2xl border border-[#E2E8F0] bg-white p-5 flex flex-col justify-between gap-4 hover:shadow-luxury transition-shadow"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                        rule.isEnabled
                          ? 'bg-[#EFF6FF] text-[#2563EB]'
                          : 'bg-[#F8FAFC] text-slate-400'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-display text-sm font-bold text-[#0F172A] truncate">
                        {meta?.friendlyTitle || rule.name}
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        <span className={rule.isEnabled ? 'text-emerald-700 font-semibold' : ''}>
                          {rule.isEnabled ? 'Active' : 'Paused'}
                        </span>
                        {rule.executionCount > 0 && (
                          <span className="tabular-nums"> · Used {rule.executionCount} times</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!isAdmin}
                    onClick={() => toggleAutomationRule(rule.id)}
                    aria-label={`Toggle ${meta?.friendlyTitle || rule.name}`}
                    className={`w-10 h-6 rounded-full p-0.5 transition-colors shrink-0 cursor-pointer disabled:opacity-50 ${
                      rule.isEnabled ? 'bg-[#2563EB]' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`block h-5 w-5 rounded-full bg-white shadow-xs transition-transform ${
                        rule.isEnabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="mt-4 space-y-2 text-xs">
                  <p className="text-slate-600 leading-relaxed">
                    <strong className="text-[#0F172A]">When:</strong> {meta?.whenLabel}
                  </p>
                  <p className="text-slate-600 leading-relaxed">
                    <strong className="text-[#0F172A]">Action:</strong> {rule.actionSummary}
                  </p>
                </div>

                {rule.responseText && (
                  <div className="mt-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-3 text-[11px] text-slate-700 line-clamp-2">
                    &ldquo;{rule.responseText}&rdquo;
                  </div>
                )}
              </div>

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => openEditor(rule)}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] py-2.5 text-xs font-semibold text-[#0F172A] hover:bg-[#EFF6FF] hover:border-[#2563EB]/40 transition-colors cursor-pointer"
                >
                  <Settings2 className="h-3.5 w-3.5 text-[#2563EB]" />
                  <span>{rule.isEnabled ? 'Customize' : 'Set Up'}</span>
                </button>
              )}
            </div>
          );
        })}
        </div>
      )}

      {/* Guided Side Drawer */}
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

            <form onSubmit={handleSaveRule} className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
              {/* Step 1: Turn on / off */}
              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-[#0F172A]">Turn on this automation</p>
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
              </div>

              {/* Plain-language questions */}
              {editingRule.ruleType === 'conversation_assignment' && (
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1.5">
                    1. Who should receive new unassigned chats?
                  </label>
                  <select
                    value={editAssignee}
                    onChange={(e) => setEditAssignee(e.target.value)}
                    className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 bg-white focus:border-[#2563EB] focus:outline-none"
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
                  <label className="block font-semibold text-[#0F172A] mb-1.5">
                    1. Which customer group should be applied?
                  </label>
                  <select
                    value={editTagName}
                    onChange={(e) => setEditTagName(e.target.value)}
                    className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 bg-white focus:border-[#2563EB] focus:outline-none"
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
                <div className="space-y-3">
                  <div>
                    <label className="block font-semibold text-[#0F172A] mb-1.5">
                      What message should customers receive?
                    </label>
                    <textarea
                      rows={4}
                      value={editResponse}
                      onChange={(e) => setEditResponse(e.target.value)}
                      className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 leading-relaxed focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>

                  {/* Understandable Live Preview */}
                  <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                    <p className="text-[11px] font-semibold text-slate-500 mb-1.5">
                      Customer Preview
                    </p>
                    <div className="rounded-xl border border-[#E2E8F0] bg-white p-3 text-slate-800 leading-relaxed">
                      {editResponse.trim() || 'No reply message entered yet.'}
                    </div>
                  </div>
                </div>
              )}

              {/* Expandable Advanced Options */}
              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((s) => !s)}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between font-semibold text-[#0F172A] cursor-pointer"
                >
                  <span>Advanced Options</span>
                  <ChevronDown
                    className={`h-4 w-4 text-slate-400 transition-transform ${
                      showAdvanced ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {showAdvanced && (
                  <div className="px-3.5 pb-3.5 pt-2 border-t border-[#E2E8F0] space-y-3">
                    {editingRule.keywords !== undefined && (
                      <div>
                        <label className="block font-semibold text-[#0F172A] mb-1">
                          Trigger words (comma-separated)
                        </label>
                        <input
                          type="text"
                          value={editKeywords}
                          onChange={(e) => setEditKeywords(e.target.value)}
                          placeholder="track, invoice, shipping"
                          className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2"
                        />
                        <p className="text-[11px] text-slate-500 mt-1">
                          Rule triggers whenever a customer message contains any of these words.
                        </p>
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
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 font-semibold text-[#E11D48] hover:bg-rose-100 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete</span>
                  </button>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setEditingRule(null)}
                    className="rounded-xl border border-[#E2E8F0] px-4 py-2.5 font-semibold text-slate-700 hover:bg-[#F8FAFC] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-[#2563EB] px-4 py-2.5 font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                  >
                    {editEnabled ? 'Save & Activate' : 'Save Rule'}
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
                  Create Automation
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Choose when this automation runs and how it responds.
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
                <label className="block font-semibold text-[#0F172A] mb-1.5">
                  Automation Type
                </label>
                <select
                  value={newRuleType}
                  onChange={(e) => {
                    const nextType = e.target.value as AutomationRuleType;
                    setNewRuleType(nextType);
                    setNewRuleName(RULE_LIBRARY_META[nextType].friendlyTitle);
                  }}
                  className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 bg-white focus:border-[#2563EB] focus:outline-none"
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
                <label className="block font-semibold text-[#0F172A] mb-1.5">Rule Name</label>
                <input
                  type="text"
                  required
                  value={newRuleName}
                  onChange={(e) => setNewRuleName(e.target.value)}
                  placeholder="Rule name"
                  className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              {(newRuleType === 'keyword_reply' ||
                newRuleType === 'auto_tagging' ||
                newRuleType === 'human_handoff') && (
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1.5">
                    Trigger Words (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={newKeywords}
                    onChange={(e) => setNewKeywords(e.target.value)}
                    placeholder="e.g., hours, shipping, invoice"
                    className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              )}

              {newRuleType === 'conversation_assignment' && (
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1.5">
                    Assign Chats To
                  </label>
                  {teamMembers.length === 0 ? (
                    <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-slate-500">
                      Invite team members in Team Management first to assign chats automatically.
                    </p>
                  ) : (
                    <select
                      value={newAssignee}
                      onChange={(e) => setNewAssignee(e.target.value)}
                      className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 bg-white focus:border-[#2563EB] focus:outline-none"
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
                  <label className="block font-semibold text-[#0F172A] mb-1.5">
                    Customer Group Name
                  </label>
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="e.g., Order Support"
                    className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              )}

              {(newRuleType === 'welcome_message' ||
                newRuleType === 'keyword_reply' ||
                newRuleType === 'out_of_office' ||
                newRuleType === 'human_handoff') && (
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1.5">
                    Reply Message *
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={newResponse}
                    onChange={(e) => setNewResponse(e.target.value)}
                    placeholder="Write the automatic WhatsApp reply customers will receive..."
                    className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 leading-relaxed focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              )}

              <label className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 flex items-center justify-between cursor-pointer">
                <div>
                  <p className="font-semibold text-[#0F172A]">Activate immediately</p>
                  <p className="text-[11px] text-slate-500">
                    Runs once WhatsApp is connected.
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
                  className="rounded-xl border border-[#E2E8F0] px-4 py-2.5 font-semibold text-slate-700 hover:bg-[#F8FAFC] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#2563EB] px-4 py-2.5 font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                >
                  Save Automation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
