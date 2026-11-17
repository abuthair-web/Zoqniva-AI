import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronDown,
  Inbox,
  Lock,
  Megaphone,
  Menu,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { useApp } from '@/context/AppContext';

const HERO_CORE_IMG = '/src/assets/images/hero_ai_core_1794684776928.jpg';

const FEATURE_CARDS = [
  {
    id: 'inbox',
    title: 'Unified Team Inbox',
    summary:
      'Collaborate across shared WhatsApp numbers with conversation ownership, internal notes, and automatic 24-hour window enforcement.',
    accent: 'blue',
    icon: Inbox,
    detail:
      'Agents filter queues by All, Mine, Unassigned, Open, Pending, or Resolved. When a customer service window expires, Zoqniva AI locks free-form replies and prompts approved Meta templates automatically.',
  },
  {
    id: 'automation',
    title: 'AI-Powered Automation',
    summary:
      'Combine keyword rules, business hours routing, and sandbox-tested AI knowledge replies with instant human handoff.',
    accent: 'gold',
    icon: Bot,
    detail:
      'Configure welcome greetings, out-of-office messages, and auto-tagging while keeping AI outbound replies strictly human-gated until your provider and policy are verified.',
  },
  {
    id: 'crm',
    title: 'Smart CRM',
    summary:
      'Store normalized E.164 international contacts, segment audiences with custom tags, track marketing opt-in, and import CSVs safely.',
    accent: 'blue',
    icon: Users,
    detail:
      'Built-in duplicate phone detection, bulk tagging, consent audit timestamps, and one-click thread creation straight from any customer record.',
  },
  {
    id: 'broadcasts',
    title: 'Broadcast Campaigns',
    summary:
      'Build 3-step WhatsApp template campaigns with variable mapping, consent exclusions, and delivery reporting.',
    accent: 'crimson',
    icon: Megaphone,
    detail:
      'Every campaign distinguishes Selected, Eligible, Submitted, Sent, Delivered, Read, Failed, and Skipped recipients—backed by real Meta webhook delivery confirmations.',
  },
  {
    id: 'analytics',
    title: 'Business Analytics',
    summary:
      'Monitor message volume, delivery breakdowns, staff workload balance, and rule execution trends in real time.',
    accent: 'blue',
    icon: BarChart3,
    detail:
      'Filter across Today, 7-day, and 30-day windows and export structured CSV reports backed directly by your PostgreSQL database records.',
  },
] as const;

const FAQ_ITEMS = [
  {
    q: 'How does Zoqniva AI connect to WhatsApp?',
    a: 'Zoqniva AI integrates directly with the official Meta WhatsApp Cloud API via Supabase Edge Functions. Access tokens and app secrets remain strictly on the server—never exposed in browser code.',
  },
  {
    q: 'How is the WhatsApp 24-hour customer service window enforced?',
    a: 'Each conversation tracks the timestamp of the last inbound customer message. Once 24 hours elapse, free-form text replies are disabled in the Team Inbox and agents are guided to send an approved WhatsApp message template.',
  },
  {
    q: 'How does real-time message delivery tracking work?',
    a: 'Outbound messages are dispatched through your Supabase Edge Function to Meta Graph API and tracked honestly as queued, sent, delivered, read, or failed based on real webhook updates.',
  },
  {
    q: 'How are Admin and Agent permissions enforced?',
    a: 'Permissions are enforced both in the interface and at the PostgreSQL database level using Supabase Row Level Security (RLS) policies separating Administrator configuration from Agent inbox workflows.',
  },
];

export function HomePage() {
  const { isAuthenticated } = useApp();
  const navigate = useNavigate();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeFeatureId, setActiveFeatureId] = useState<string>('inbox');
  const [previewTab, setPreviewTab] = useState<'overview' | 'inbox' | 'automation'>('overview');
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);
  const [heroImgError, setHeroImgError] = useState(false);

  const selectedFeature =
    FEATURE_CARDS.find((f) => f.id === activeFeatureId) ?? FEATURE_CARDS[0];

  const primaryDestination = isAuthenticated ? '/app' : '/login';

  const scrollToSection = (id: string) => {
    setMobileMenuOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-white text-[#0F172A]">
      {/* Sticky White Header — 3-Zone Contract */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#E2E8F0]">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <Link to="/" className="shrink-0 whitespace-nowrap">
            <BrandLogo size="sm" />
          </Link>

          <nav className="hidden lg:flex items-center gap-7 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => scrollToSection('product')}
              className="hover:text-[#2563EB] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Product
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('features')}
              className="hover:text-[#2563EB] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Features
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('solutions')}
              className="hover:text-[#2563EB] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Solutions
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('pricing')}
              className="hover:text-[#2563EB] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Architecture
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('resources')}
              className="hover:text-[#2563EB] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Resources
            </button>
          </nav>

          <div className="hidden lg:flex items-center gap-4 shrink-0">
            <Link
              to={primaryDestination}
              className="text-sm font-semibold text-[#0F172A] hover:text-[#2563EB] transition-colors whitespace-nowrap shrink-0"
            >
              {isAuthenticated ? 'Open Workspace' : 'Sign In'}
            </Link>
            <button
              type="button"
              onClick={() => navigate(primaryDestination)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#E11D48] px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              <span>Get Started</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="lg:hidden p-2 rounded-lg border border-[#E2E8F0] text-[#0F172A]"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-[#E2E8F0] bg-white px-4 py-4 space-y-2">
            {[
              { id: 'product', label: 'Product' },
              { id: 'features', label: 'Features' },
              { id: 'solutions', label: 'Solutions' },
              { id: 'pricing', label: 'Architecture' },
              { id: 'resources', label: 'Resources' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id)}
                className="block w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-[#F8FAFC]"
              >
                {item.label}
              </button>
            ))}
            <div className="pt-3 border-t border-[#E2E8F0] flex flex-col gap-2">
              <Link
                to={primaryDestination}
                className="w-full text-center rounded-lg border border-[#E2E8F0] py-2.5 text-sm font-semibold text-[#0F172A]"
              >
                {isAuthenticated ? 'Open Workspace' : 'Sign In'}
              </Link>
              <button
                type="button"
                onClick={() => navigate(primaryDestination)}
                className="w-full rounded-lg bg-[#E11D48] py-2.5 text-sm font-semibold text-white"
              >
                Get Started
              </button>
            </div>
          </div>
        )}
      </header>

      {/* HERO SECTION */}
      <section className="relative overflow-hidden bg-white pt-12 pb-16 lg:pt-20 lg:pb-24">
        <div className="pointer-events-none absolute top-0 right-0 w-[640px] h-[640px] rounded-full bg-[#EFF6FF]/60 blur-3xl opacity-65" />

        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-10 items-center">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-6 space-y-6"
            >
              <div className="flex items-center gap-3">
                <span className="h-[2px] w-8 bg-[#F4B942] rounded-full" />
                <span className="text-xs font-semibold tracking-wide text-[#2563EB]">
                  AI-Powered Business Communication
                </span>
              </div>

              <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.5rem] font-extrabold tracking-tight text-[#0F172A] leading-[1.08] [text-wrap:balance]">
                Every Conversation.
                <br />
                One <span className="text-[#2563EB]">Intelligent</span>{' '}
                <span className="text-[#E11D48]">Workspace.</span>
              </h1>

              <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl">
                Manage customer conversations, automate WhatsApp workflows, engage your audience,
                and grow your business with Zoqniva AI.
              </p>

              <div className="flex flex-wrap items-center gap-3.5 pt-1">
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.99 }}
                  type="button"
                  onClick={() => navigate(primaryDestination)}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#E11D48] px-6 py-3.5 text-sm font-semibold text-white hover:bg-rose-700 transition-colors shadow-sm whitespace-nowrap cursor-pointer"
                >
                  <span>Get Started</span>
                  <ArrowRight className="h-4 w-4" />
                </motion.button>

                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.99 }}
                  type="button"
                  onClick={() => scrollToSection('product')}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#2563EB] bg-white px-6 py-3.5 text-sm font-semibold text-[#2563EB] hover:bg-[#EFF6FF] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>Explore Platform</span>
                </motion.button>
              </div>

              <div className="pt-6 border-t border-[#E2E8F0] flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                <span className="font-medium text-[#0F172A]">
                  Intelligent Conversations. Seamless Automation.
                </span>
                <span aria-hidden="true" className="text-[#F4B942]">
                  •
                </span>
                <span>Official Meta WhatsApp Cloud API Ready</span>
                <span aria-hidden="true" className="text-[#F4B942]">
                  •
                </span>
                <span>Developed by Noor Labs</span>
              </div>
            </motion.div>

            {/* Right Column — 3D Luminous AI Core Showcase */}
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-6 relative flex items-center justify-center"
            >
              <div className="relative w-full max-w-[520px] aspect-square rounded-3xl bg-white border border-[#E2E8F0]/80 shadow-luxury p-4 sm:p-6 flex items-center justify-center overflow-hidden">
                <div className="pointer-events-none absolute top-4 left-4 h-6 w-6 border-t-2 border-l-2 border-[#F4B942]/70 rounded-tl-lg" />
                <div className="pointer-events-none absolute bottom-4 right-4 h-6 w-6 border-b-2 border-r-2 border-[#F4B942]/70 rounded-br-lg" />

                {!heroImgError ? (
                  <img
                    src={HERO_CORE_IMG}
                    alt="Zoqniva AI luminous blue glass communication core with gold orbital rings"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgError(true)}
                    className="w-full h-full object-contain rounded-2xl"
                  />
                ) : (
                  <div className="w-full h-full rounded-2xl bg-gradient-to-br from-[#EFF6FF] to-white flex flex-col items-center justify-center p-8 text-center">
                    <Sparkles className="h-12 w-12 text-[#2563EB] mb-3" />
                    <p className="font-display text-lg font-bold text-[#0F172A]">
                      Zoqniva AI Communication Core
                    </p>
                  </div>
                )}

                <motion.div
                  animate={{ y: [0, -5, 0] }}
                  transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                  className="hidden sm:flex items-center gap-2.5 absolute top-7 left-7 rounded-xl bg-white/95 backdrop-blur-md border border-[#E2E8F0] px-3.5 py-2.5 shadow-luxury"
                >
                  <div className="h-7 w-7 rounded-lg bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center">
                    <MessageSquare className="h-3.5 w-3.5" />
                  </div>
                  <div className="text-left">
                    <p className="text-[11px] font-bold text-[#0F172A] leading-tight">
                      24h Window Guard
                    </p>
                    <p className="text-[10px] text-slate-500">Policy-verified templates</p>
                  </div>
                </motion.div>

                <motion.div
                  animate={{ y: [0, 5, 0] }}
                  transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                  className="hidden sm:flex items-center gap-2.5 absolute bottom-7 left-7 rounded-xl bg-white/95 backdrop-blur-md border border-[#E2E8F0] px-3.5 py-2.5 shadow-luxury"
                >
                  <div className="h-7 w-7 rounded-lg bg-amber-50 text-[#F4B942] flex items-center justify-center">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <div className="text-left">
                    <p className="text-[11px] font-bold text-[#0F172A] leading-tight">
                      AI Handoff Engine
                    </p>
                    <p className="text-[10px] text-slate-500">Human-gated escalation</p>
                  </div>
                </motion.div>

                <motion.div
                  animate={{ y: [0, -4, 0] }}
                  transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="hidden sm:flex items-center gap-2.5 absolute top-8 right-7 rounded-xl bg-white/95 backdrop-blur-md border border-[#E2E8F0] px-3.5 py-2.5 shadow-luxury"
                >
                  <div className="h-7 w-7 rounded-lg bg-rose-50 text-[#E11D48] flex items-center justify-center">
                    <ShieldCheck className="h-3.5 w-3.5" />
                  </div>
                  <div className="text-left">
                    <p className="text-[11px] font-bold text-[#0F172A] leading-tight">
                      Supabase RLS
                    </p>
                    <p className="text-[10px] text-slate-500">Admin &amp; Agent isolation</p>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CORE INTERACTIVE FEATURE CARDS */}
      <section id="features" className="py-16 lg:py-20 bg-[#F8FAFC] border-y border-[#E2E8F0]">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold text-[#2563EB] tracking-wide">
                Core Platform Modules
              </p>
              <h2 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-[#0F172A] tracking-tight [text-wrap:balance]">
                Engineered for teams running high-trust WhatsApp operations
              </h2>
            </div>
            <p className="text-xs text-slate-500 max-w-sm">
              Select any capability below to inspect how Zoqniva AI handles live customer
              operations.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {FEATURE_CARDS.map((card) => {
              const Icon = card.icon;
              const isSelected = activeFeatureId === card.id;
              return (
                <motion.button
                  key={card.id}
                  type="button"
                  whileHover={{ y: -2 }}
                  onClick={() => setActiveFeatureId(card.id)}
                  className={`text-left rounded-2xl p-5 border transition-all cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'bg-white border-[#2563EB] shadow-luxury'
                      : 'bg-gradient-to-b from-[#EFF6FF]/65 to-white border-[#E2E8F0] hover:border-[#2563EB]/40'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div
                        className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                          card.accent === 'gold'
                            ? 'bg-amber-50 text-amber-700'
                            : card.accent === 'crimson'
                            ? 'bg-rose-50 text-[#E11D48]'
                            : 'bg-[#EFF6FF] text-[#2563EB]'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      {isSelected && (
                        <span className="h-2 w-2 rounded-full bg-[#E11D48]" aria-hidden="true" />
                      )}
                    </div>
                    <h3 className="font-display text-base font-bold text-[#0F172A]">
                      {card.title}
                    </h3>
                    <p className="mt-2 text-xs text-slate-600 leading-relaxed">{card.summary}</p>
                  </div>
                </motion.button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-1.5 max-w-3xl">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#2563EB]">
                <span className="h-[2px] w-5 bg-[#F4B942]" />
                <span>{selectedFeature.title}</span>
              </div>
              <p className="text-sm text-[#0F172A] leading-relaxed">{selectedFeature.detail}</p>
            </div>
            <button
              type="button"
              onClick={() => navigate(primaryDestination)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Open Workspace</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* WORKSPACE ARCHITECTURE PREVIEW (Zero Fictional Data) */}
      <section id="product" className="py-16 lg:py-24 bg-white">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-[#2563EB] tracking-wide">
                Workspace Architecture
              </p>
              <h2 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-[#0F172A] tracking-tight">
                Inside the Zoqniva AI Command Center
              </h2>
            </div>

            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
              {(
                [
                  { key: 'overview', label: 'Control Center' },
                  { key: 'inbox', label: 'Team Inbox' },
                  { key: 'automation', label: 'Automation' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setPreviewTab(tab.key)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    previewTab === tab.key
                      ? 'bg-white text-[#2563EB] shadow-2xs border border-[#E2E8F0]'
                      : 'text-slate-600 hover:text-[#0F172A]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] shadow-luxury overflow-hidden">
            <div className="h-11 bg-white border-b border-[#E2E8F0] px-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#E11D48]/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#F4B942]/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#2563EB]/70" />
                <span className="ml-3 text-[11px] font-mono text-slate-400">
                  zoqniva.app/app/{previewTab === 'overview' ? '' : previewTab}
                </span>
              </div>
              <button
                type="button"
                onClick={() => navigate(primaryDestination)}
                className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
              >
                Open App →
              </button>
            </div>

            <div className="p-6 sm:p-8 bg-[#F8FAFC]">
              {previewTab === 'overview' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-3">
                    <p className="text-xs font-bold text-[#0F172A]">
                      Real Database-Backed Telemetry
                    </p>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Every dashboard KPI, delivery breakdown, and team workload counter queries
                      your live Supabase PostgreSQL tables directly—starting cleanly at zero until
                      real customer activity arrives.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                      {[
                        { label: 'Contacts', desc: 'E.164 verified' },
                        { label: 'Inbox Threads', desc: '24h window guard' },
                        { label: 'Broadcasts', desc: '3-step wizard' },
                        { label: 'Meta Cloud API', desc: 'Server-side secrets' },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3"
                        >
                          <p className="text-xs font-bold text-[#0F172A]">{item.label}</p>
                          <p className="text-[11px] text-[#2563EB] mt-0.5">{item.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#F4B942]/60 bg-white p-5">
                    <div className="flex items-center gap-2 text-xs font-bold text-[#0F172A]">
                      <Sparkles className="h-4 w-4 text-[#F4B942]" />
                      <span>AI Insights Layer</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                      Highlights conversations with expired 24-hour windows, pending human handoffs,
                      and knowledge base configuration without modifying customer state automatically.
                    </p>
                  </div>
                </div>
              )}

              {previewTab === 'inbox' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 space-y-2.5">
                    <p className="text-xs font-bold text-[#0F172A]">Queue Organization</p>
                    {[
                      'All Active Conversations',
                      'Assigned to Me',
                      'Unassigned Queue',
                      'Resolved Threads',
                    ].map((row, idx) => (
                      <div
                        key={row}
                        className={`rounded-lg p-3 text-xs border ${
                          idx === 0
                            ? 'border-[#2563EB] bg-[#EFF6FF]/60 font-semibold text-[#0F172A]'
                            : 'border-[#E2E8F0] text-slate-600'
                        }`}
                      >
                        {row}
                      </div>
                    ))}
                  </div>
                  <div className="md:col-span-2 rounded-xl border border-[#E2E8F0] bg-white p-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2.5 text-xs">
                      <span className="font-bold text-[#0F172A]">Shared Agent Thread</span>
                      <span className="text-emerald-700 font-medium">24h reply window tracking</span>
                    </div>
                    <div className="space-y-2.5 text-xs">
                      <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-slate-600">
                        Inbound WhatsApp messages arrive via Supabase Edge Function webhook and
                        update conversation status in real time.
                      </div>
                      <div className="rounded-xl border border-[#F4B942]/60 bg-amber-50 p-3 text-amber-950">
                        <span className="flex items-center gap-1 font-semibold text-[11px] mb-0.5">
                          <Lock className="h-3 w-3" /> Private Team Notes
                        </span>
                        Staff collaborate inside internal thread notes without exposing messages to
                        customers.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {previewTab === 'automation' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    {
                      title: 'Welcome Greeting',
                      desc: 'Greets first-time inbound threads automatically when configured.',
                    },
                    {
                      title: 'Automatic Grouping',
                      desc: 'Organizes conversations based on customer keywords you choose.',
                    },
                    {
                      title: 'Human Handoff Escalation',
                      desc: 'Halts automated replies immediately whenever a human agent is requested.',
                    },
                  ].map((item) => (
                    <div
                      key={item.title}
                      className="rounded-xl border border-[#E2E8F0] bg-white p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <Workflow className="h-4 w-4 text-[#2563EB]" />
                        <span className="text-[11px] font-semibold text-[#2563EB]">Rule Engine</span>
                      </div>
                      <p className="font-display text-sm font-bold text-[#0F172A]">{item.title}</p>
                      <p className="text-xs text-slate-600">{item.desc}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* SOLUTIONS & WORKFLOWS */}
      <section id="solutions" className="py-16 lg:py-20 bg-[#F8FAFC] border-t border-[#E2E8F0]">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold text-[#2563EB]">Operational Workflows</p>
            <h2 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-[#0F172A] tracking-tight">
              Built around real WhatsApp compliance and team accountability
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                num: '01.',
                title: 'Inbound Triage & Window Protection',
                copy: 'Conversations automatically display remaining 24-hour customer service time. Once expired, free-form messages lock cleanly and agents select approved Meta templates.',
              },
              {
                num: '02.',
                title: 'Consent-First Broadcast Queues',
                copy: 'Contacts opted out of marketing are excluded automatically during the 3-step broadcast wizard, keeping campaigns compliant and auditable.',
              },
              {
                num: '03.',
                title: 'Human-Gated AI Assistance',
                copy: 'Test knowledge-base replies inside the AI Sandbox without touching live customers. Escalation keywords pause automation and surface threads in Team Inbox.',
              },
            ].map((wf) => (
              <div key={wf.num} className="rounded-2xl border border-[#E2E8F0] bg-white p-6">
                <span className="font-mono text-sm font-bold text-[#F4B942]">{wf.num}</span>
                <h3 className="mt-2 font-display text-lg font-bold text-[#0F172A]">{wf.title}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{wf.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ARCHITECTURE & DEPLOYMENT */}
      <section id="pricing" className="py-16 lg:py-20 bg-white border-t border-[#E2E8F0]">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-[#E2E8F0] bg-gradient-to-br from-[#EFF6FF]/60 via-white to-white p-8 lg:p-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="h-[2px] w-6 bg-[#F4B942]" />
                <span className="text-xs font-semibold text-[#2563EB]">
                  Deployment &amp; Licensing Transparency
                </span>
              </div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0F172A] tracking-tight">
                Ready for static edge hosting and your own Supabase &amp; Meta Cloud API stack
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                This foundation is architected for a single business with multiple staff members and
                modularized for multi-tenant SaaS expansion. Deploy the frontend on static hosts
                with Supabase PostgreSQL, Auth, Realtime, and Edge Functions handling Meta webhooks
                securely.
              </p>
            </div>

            <div className="lg:col-span-5 rounded-2xl border border-[#E2E8F0] bg-white p-6 space-y-3 shadow-luxury">
              <p className="font-display text-base font-bold text-[#0F172A]">
                Included Architecture Stack
              </p>
              <ul className="space-y-2.5 text-xs text-slate-700">
                {[
                  '16-table PostgreSQL schema with Row Level Security',
                  'Supabase Edge Functions for Meta Graph API & Webhooks',
                  'Admin & Agent role-based workspace access',
                  'No paid VPS, Redis, or always-on Node server required',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#2563EB] shrink-0 mt-0.5" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <div className="pt-3">
                <button
                  type="button"
                  onClick={() => navigate(primaryDestination)}
                  className="w-full rounded-xl bg-[#E11D48] py-3 text-xs font-semibold text-white hover:bg-rose-700 transition-colors cursor-pointer"
                >
                  Open Zoqniva AI Workspace
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* RESOURCES / FAQ */}
      <section id="resources" className="py-16 lg:py-20 bg-[#F8FAFC] border-t border-[#E2E8F0]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="text-center">
            <p className="text-xs font-semibold text-[#2563EB]">Resources &amp; Questions</p>
            <h2 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-[#0F172A]">
              Technical &amp; Operational FAQ
            </h2>
          </div>

          <div className="space-y-3">
            {FAQ_ITEMS.map((item, idx) => {
              const isOpen = openFaqIdx === idx;
              return (
                <div
                  key={item.q}
                  className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                    className="w-full px-5 py-4 text-left flex items-center justify-between gap-4 cursor-pointer"
                  >
                    <span className="font-display text-sm font-bold text-[#0F172A]">{item.q}</span>
                    <ChevronDown
                      className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${
                        isOpen ? 'rotate-180 text-[#2563EB]' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-4 text-xs text-slate-600 leading-relaxed border-t border-[#E2E8F0]/70 pt-3">
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-white border-t border-[#E2E8F0] py-10">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <BrandLogo size="sm" />
            <p className="text-xs text-slate-500">
              Intelligent Conversations. Seamless Automation. · Developed by Noor Labs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-xs font-medium text-slate-600">
            <button type="button" onClick={() => scrollToSection('features')} className="hover:text-[#2563EB] cursor-pointer">
              Features
            </button>
            <button type="button" onClick={() => scrollToSection('product')} className="hover:text-[#2563EB] cursor-pointer">
              Product
            </button>
            <button type="button" onClick={() => scrollToSection('resources')} className="hover:text-[#2563EB] cursor-pointer">
              FAQ
            </button>
            <Link to={primaryDestination} className="font-semibold text-[#2563EB] hover:underline">
              {isAuthenticated ? 'Go to Dashboard' : 'Sign In'}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
