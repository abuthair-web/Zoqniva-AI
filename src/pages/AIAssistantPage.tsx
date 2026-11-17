import React, { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Bot,
  ChevronDown,
  MessageCircle,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { formatRelativeTime } from '@/lib/phone';

const SAMPLE_TEST_QUESTIONS = [
  'Do you deliver tomorrow morning?',
  'What is your return policy?',
  'I want to speak to a human manager.',
];

export function AIAssistantPage() {
  const {
    currentUser,
    business,
    aiConfig,
    updateAiConfig,
    aiKnowledge,
    addAiKnowledgeItem,
    deleteAiKnowledgeItem,
    aiLogs,
    runAiSandboxTest,
  } = useApp();

  const [kbTitle, setKbTitle] = useState('');
  const [kbCategory, setKbCategory] = useState('Shipping');
  const [kbContent, setKbContent] = useState('');
  const [addFaqOpen, setAddFaqOpen] = useState(false);
  const [testPrompt, setTestPrompt] = useState('');
  const [handoffInput, setHandoffInput] = useState(aiConfig.handoffKeywords.join(', '));
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isAdmin = currentUser?.role === 'admin';
  const canAuthorizeLive =
    aiConfig.provider !== 'unconfigured' && business.metaConnectionState === 'connected';
  const liveActive = aiConfig.enabled && aiConfig.autoReplyAuthorized && canAuthorizeLive;

  const handleAddKb = (e: React.FormEvent) => {
    e.preventDefault();
    if (!kbTitle.trim() || !kbContent.trim()) return;
    addAiKnowledgeItem({
      title: kbTitle.trim(),
      category: kbCategory.trim() || 'General',
      content: kbContent.trim(),
    });
    setKbTitle('');
    setKbContent('');
    setAddFaqOpen(false);
  };

  const handleRunTest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPrompt.trim()) return;
    runAiSandboxTest(testPrompt.trim());
    setTestPrompt('');
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8 max-w-[1440px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-[2px] w-5 bg-[#F4B942]" />
            <span className="text-xs font-semibold text-amber-700">Guided Customer Assistant</span>
          </div>
          <h2 className="font-display text-2xl font-bold text-[#0F172A] tracking-tight mt-0.5">
            AI Assistant
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Teach the assistant your business policies, choose when it steps aside for a human, and test replies safely.
          </p>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-[#E2E8F0] bg-white px-4 py-2.5 self-start">
          <Bot className="h-4 w-4 text-[#F4B942]" />
          <span className="text-xs font-semibold text-[#0F172A]">
            Live Auto-Reply:
          </span>
          <button
            type="button"
            disabled={!isAdmin || !canAuthorizeLive}
            onClick={() =>
              updateAiConfig({
                enabled: !aiConfig.enabled,
                autoReplyAuthorized: !aiConfig.enabled,
              })
            }
            className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 ${
              liveActive
                ? 'bg-[#2563EB] text-white'
                : 'bg-[#F8FAFC] border border-[#E2E8F0] text-slate-600'
            }`}
          >
            {liveActive ? 'Active' : 'Paused'}
          </button>
        </div>
      </div>

      {/* Honest Plain-Language Safety Notice */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 flex items-start gap-3 text-xs text-amber-950">
        <AlertTriangle className="h-4 w-4 text-[#F4B942] shrink-0 mt-0.5" />
        <p>
          {liveActive ? (
            <>
              <strong>Live AI Auto-Reply is active:</strong> The assistant replies using only the
              business information below and hands off immediately whenever a customer asks for a person.
            </>
          ) : (
            <>
              <strong>AI Auto-Reply Paused:</strong> The AI assistant is currently paused and will not
              send automatic replies to live customers until both an AI service connection and your
              WhatsApp account are set up. You can still add business info and test replies in the sandbox below.
            </>
          )}
        </p>
      </div>

      {/* Two-Column Guided Setup + Test Conversation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Cols: Plain-Language 3-Part Setup */}
        <div className="lg:col-span-7 space-y-6">
          {/* 1. What Business Info It Can Use */}
          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-[#2563EB]" />
                  <h3 className="font-display text-sm font-bold text-[#0F172A]">
                    1. Business Information the Assistant Can Share
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Add FAQs, delivery times, or policies so the assistant gives accurate answers.
                </p>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setAddFaqOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Business Info</span>
                </button>
              )}
            </div>

            {addFaqOpen && isAdmin && (
              <form
                onSubmit={handleAddKb}
                className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-3 text-xs"
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="text"
                    required
                    value={kbTitle}
                    onChange={(e) => setKbTitle(e.target.value)}
                    placeholder="Topic (e.g., Store Opening Hours)"
                    className="sm:col-span-2 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                  />
                  <input
                    type="text"
                    value={kbCategory}
                    onChange={(e) => setKbCategory(e.target.value)}
                    placeholder="Topic Group"
                    className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <textarea
                  rows={2}
                  required
                  value={kbContent}
                  onChange={(e) => setKbContent(e.target.value)}
                  placeholder="Write the exact answer customers should receive..."
                  className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setAddFaqOpen(false)}
                    className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 font-semibold text-slate-600 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[#2563EB] px-3.5 py-1.5 font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                  >
                    Save Info
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-2.5">
              {aiKnowledge.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#E2E8F0] bg-[#F8FAFC] p-5 text-center text-xs text-slate-500">
                  No business information added yet. Add your store hours, shipping, or return policies so the assistant can reference them accurately.
                </div>
              ) : (
                aiKnowledge.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-[#0F172A]">{item.title}</p>
                        <p className="text-[11px] text-[#2563EB] font-medium">{item.category}</p>
                      </div>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => deleteAiKnowledgeItem(item.id)}
                          className="text-slate-400 hover:text-[#E11D48] cursor-pointer p-1"
                          aria-label="Delete business info"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-slate-600 mt-1.5 leading-relaxed">{item.content}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 2. Assistant Style & Transfer to Human */}
          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 space-y-4 text-xs">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#2563EB]" />
              <h3 className="font-display text-sm font-bold text-[#0F172A]">
                2. How It Sounds &amp; When It Transfers to a Person
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Assistant Name</label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={aiConfig.assistantName}
                  onChange={(e) => updateAiConfig({ assistantName: e.target.value })}
                  className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Reply Style</label>
                <select
                  disabled={!isAdmin}
                  value={aiConfig.tone}
                  onChange={(e) =>
                    updateAiConfig({
                      tone: e.target.value as 'professional' | 'friendly' | 'concise',
                    })
                  }
                  className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2 bg-white focus:border-[#2563EB] focus:outline-none"
                >
                  <option value="professional">Polite &amp; Professional</option>
                  <option value="friendly">Warm &amp; Friendly</option>
                  <option value="concise">Short &amp; Direct</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-[#0F172A] mb-1">
                Transfer to a Human Agent Immediately If Customer Mentions:
              </label>
              <input
                type="text"
                disabled={!isAdmin}
                value={handoffInput}
                onChange={(e) => {
                  setHandoffInput(e.target.value);
                  updateAiConfig({
                    handoffKeywords: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  });
                }}
                placeholder="agent, human, manager, refund"
                className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2 focus:border-[#2563EB] focus:outline-none"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Separate words with commas. When matched, the AI pauses and notifies your staff in Team Inbox.
              </p>
            </div>

            {/* Expandable Advanced Settings (Provider + System Prompt) */}
            <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]">
              <button
                type="button"
                onClick={() => setShowAdvanced((s) => !s)}
                className="w-full px-3.5 py-2.5 flex items-center justify-between font-semibold text-[#0F172A] cursor-pointer"
              >
                <span>Advanced Settings (AI Service &amp; Custom Instructions)</span>
                <ChevronDown
                  className={`h-4 w-4 text-slate-400 transition-transform ${
                    showAdvanced ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {showAdvanced && (
                <div className="px-3.5 pb-3.5 pt-2 border-t border-[#E2E8F0] space-y-3">
                  <div>
                    <label className="block font-semibold text-[#0F172A] mb-1">
                      Server AI Connection
                    </label>
                    <select
                      disabled={!isAdmin}
                      value={aiConfig.provider}
                      onChange={(e) =>
                        updateAiConfig({
                          provider: e.target.value as 'unconfigured' | 'gemini_edge' | 'openai_edge',
                        })
                      }
                      className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 bg-white"
                    >
                      <option value="unconfigured">Not Configured</option>
                      <option value="gemini_edge">Gemini Server Connection</option>
                      <option value="openai_edge">OpenAI Server Connection</option>
                    </select>
                    <p className="text-[11px] text-slate-500 mt-1">
                      API keys are stored securely on the server, never inside the browser.
                    </p>
                  </div>

                  <div>
                    <label className="block font-semibold text-[#0F172A] mb-1">
                      Custom Guiding Instructions
                    </label>
                    <textarea
                      rows={3}
                      disabled={!isAdmin}
                      value={aiConfig.systemInstructions}
                      onChange={(e) => updateAiConfig({ systemInstructions: e.target.value })}
                      className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 leading-relaxed"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right 5 Cols: Prominent Test Conversation Panel */}
        <div className="lg:col-span-5 rounded-2xl border border-[#E2E8F0] bg-white p-5 flex flex-col gap-4 h-fit lg:sticky lg:top-20">
          <div>
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-[#2563EB]" />
              <h3 className="font-display text-sm font-bold text-[#0F172A]">
                Test Conversation
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Try asking a question as a customer to check how your assistant responds. Nothing is sent to WhatsApp.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_TEST_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => runAiSandboxTest(q)}
                className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-[#2563EB] hover:text-[#2563EB] cursor-pointer"
              >
                <Sparkles className="h-3 w-3 inline mr-1 text-[#F4B942]" />
                {q}
              </button>
            ))}
          </div>

          <form onSubmit={handleRunTest} className="flex gap-2">
            <input
              type="text"
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              placeholder="Type a sample customer question..."
              className="flex-1 rounded-xl border border-[#E2E8F0] px-3 py-2.5 text-xs focus:border-[#2563EB] focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-xl bg-[#0F172A] px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="h-3.5 w-3.5" />
              Test
            </button>
          </form>

          <div className="space-y-3 overflow-y-auto max-h-[420px]">
            {aiLogs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#E2E8F0] bg-[#F8FAFC] p-5 text-center text-xs text-slate-500">
                No test messages yet. Try asking one of the sample questions above or enter your own.
              </div>
            ) : (
              aiLogs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-xl border border-[#E2E8F0] p-3.5 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span
                      className={`font-semibold ${
                        log.outcome === 'handoff_triggered'
                          ? 'text-[#E11D48]'
                          : 'text-[#2563EB]'
                      }`}
                    >
                      {log.outcome === 'handoff_triggered'
                        ? 'Transferred to Human Agent'
                        : 'Sample Assistant Reply'}
                    </span>
                    <span>{formatRelativeTime(log.timestamp)}</span>
                  </div>
                  <p className="font-medium text-[#0F172A]">Customer: &ldquo;{log.customerPrompt}&rdquo;</p>
                  <p className="text-slate-700 bg-[#F8FAFC] rounded-lg p-2.5 leading-relaxed">
                    {log.generatedReply}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
