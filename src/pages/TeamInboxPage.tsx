import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Inbox,
  Info,
  Lock,
  MoreVertical,
  Paperclip,
  Phone,
  RefreshCw,
  Search,
  Send,
  Settings,
  Smile,
  Tag as TagIcon,
  UserCheck,
  X,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { formatPhoneDisplay, formatRelativeTime, getWindowStatus } from '@/lib/phone';
import type { DeliveryStatus } from '@/types/crm';

const COMMON_EMOJIS = ['👋', '✅', '📦', '🙏', '✨', '📄', '🕒', '💬'];

export function TeamInboxPage() {
  const navigate = useNavigate();
  const {
    currentUser,
    business,
    contacts,
    tags,
    teamMembers,
    conversations,
    messages,
    templates,
    selectedConversationId,
    setSelectedConversationId,
    preferredInboxFilter,
    setPreferredInboxFilter,
    lastAssignedMemberId,
    sendMessage,
    retryFailedMessage,
    markConversationRead,
    assignConversation,
    updateConversationStatus,
    toggleHumanHandoff,
    updateContact,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [composerMode, setComposerMode] = useState<'reply' | 'internal_note'>('reply');
  const [draftText, setDraftText] = useState('');
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [attachmentType, setAttachmentType] = useState<'image' | 'document'>('document');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [showDetailsDrawer, setShowDetailsDrawer] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [noteInput, setNoteInput] = useState('');

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return conversations
      .filter((conv) => {
        if (
          currentUser?.role === 'agent' &&
          conv.assignedToId !== null &&
          conv.assignedToId !== currentUser.id
        ) {
          return false;
        }

        if (preferredInboxFilter === 'mine' && conv.assignedToId !== currentUser?.id) return false;
        if (preferredInboxFilter === 'unassigned' && conv.assignedToId !== null) return false;
        if (preferredInboxFilter === 'open' && conv.status !== 'open') return false;
        if (preferredInboxFilter === 'pending' && conv.status !== 'pending') return false;
        if (preferredInboxFilter === 'resolved' && conv.status !== 'resolved') return false;

        if (!q) return true;
        const ct = contacts.find((c) => c.id === conv.contactId);
        return (
          ct?.fullName.toLowerCase().includes(q) ||
          ct?.phoneE164.includes(q) ||
          conv.lastMessagePreview.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  }, [conversations, preferredInboxFilter, searchQuery, currentUser, contacts]);

  const activeConversation = useMemo(
    () =>
      conversations.find((c) => c.id === selectedConversationId) ??
      filteredConversations[0] ??
      null,
    [conversations, selectedConversationId, filteredConversations]
  );

  const activeContact = useMemo(
    () => contacts.find((c) => c.id === activeConversation?.contactId) ?? null,
    [contacts, activeConversation]
  );

  const activeMessages = useMemo(
    () =>
      activeConversation
        ? messages
            .filter((m) => m.conversationId === activeConversation.id)
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        : [],
    [messages, activeConversation]
  );

  const windowStatus = useMemo(
    () =>
      activeConversation
        ? getWindowStatus(activeConversation.windowExpiresAt)
        : { isOpen: false, label: '', remainingHours: 0 },
    [activeConversation]
  );

  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.approvalStatus === 'APPROVED'),
    [templates]
  );

  const handleSelectConversation = (convId: string) => {
    setSelectedConversationId(convId);
    markConversationRead(convId);
    setSendError(null);
    setMobileView('chat');
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConversation) return;
    setSendError(null);

    const msgType =
      composerMode === 'internal_note'
        ? 'internal_note'
        : attachmentName
        ? attachmentType
        : 'text';

    const res = await sendMessage({
      conversationId: activeConversation.id,
      body: draftText || (attachmentName ? `Sent attachment: ${attachmentName}` : ''),
      messageType: msgType,
      mediaFilename: attachmentName ?? undefined,
    });

    if (!res.ok) {
      setSendError(res.error ?? 'Could not send message.');
      return;
    }

    setDraftText('');
    setAttachmentName(null);
  };

  const handleSendTemplate = async () => {
    if (!activeConversation || !selectedTemplateId) return;
    const tpl = approvedTemplates.find((t) => t.id === selectedTemplateId);
    if (!tpl) return;
    setSendError(null);

    const renderedBody = tpl.bodyText.replace(
      /\{\{1\}\}/g,
      activeContact?.fullName.split(' ')[0] ?? 'Customer'
    );

    const res = await sendMessage({
      conversationId: activeConversation.id,
      body: renderedBody,
      messageType: 'template',
      templateName: tpl.name,
    });

    if (!res.ok) {
      setSendError(res.error ?? 'Could not send template.');
    } else {
      setTemplateModalOpen(false);
      setSelectedTemplateId('');
    }
  };

  const handleSaveContactNote = () => {
    if (!activeContact || !noteInput.trim()) return;
    const combined = activeContact.notes
      ? `${activeContact.notes}\n• ${noteInput.trim()}`
      : `• ${noteInput.trim()}`;
    updateContact(activeContact.id, { notes: combined });
    setNoteInput('');
  };

  const toggleContactTag = (tagId: string) => {
    if (!activeContact) return;
    const exists = activeContact.tagIds.includes(tagId);
    const next = exists
      ? activeContact.tagIds.filter((t) => t !== tagId)
      : [...activeContact.tagIds, tagId];
    updateContact(activeContact.id, { tagIds: next });
  };

  const renderDeliveryIndicator = (status: DeliveryStatus) => {
    switch (status) {
      case 'read':
        return <CheckCheck className="h-3.5 w-3.5 text-[#2563EB]" aria-label="Read" />;
      case 'delivered':
        return <CheckCheck className="h-3.5 w-3.5 text-slate-400" aria-label="Delivered" />;
      case 'sent':
        return <Check className="h-3.5 w-3.5 text-slate-400" aria-label="Sent" />;
      case 'queued':
        return <Clock className="h-3.5 w-3.5 text-[#F4B942]" aria-label="Queued" />;
      case 'failed':
        return <AlertTriangle className="h-3.5 w-3.5 text-[#E11D48]" aria-label="Failed" />;
      default:
        return null;
    }
  };

  if (conversations.length === 0) {
    return (
      <div className="h-[calc(100vh-4rem)] flex items-center justify-center p-6 pb-20 lg:pb-6">
        <div className="max-w-md w-full rounded-2xl border border-[#E2E8F0] bg-white p-8 text-center shadow-2xs">
          <div className="h-12 w-12 rounded-2xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center mx-auto mb-4">
            <Inbox className="h-6 w-6" />
          </div>
          <h2 className="font-display text-lg font-bold text-[#0F172A]">No conversations yet.</h2>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Your customer conversations will appear here once WhatsApp is connected.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            {business.metaConnectionState !== 'connected' && (
              <button
                type="button"
                onClick={() => navigate('/app/settings')}
                className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
              >
                <Settings className="h-3.5 w-3.5" />
                <span>Connect WhatsApp</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/app/contacts')}
              className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-4 py-2.5 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
            >
              <span>View Contacts</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex bg-white overflow-hidden pb-14 lg:pb-0">
      {/* LEFT PANEL: Simple Conversation List */}
      <section
        aria-label="Conversations List"
        className={`${
          mobileView === 'list' ? 'flex' : 'hidden'
        } md:flex flex-col w-full md:w-80 lg:w-[330px] border-r border-[#E2E8F0] bg-white shrink-0`}
      >
        <div className="p-3.5 border-b border-[#E2E8F0] space-y-2.5">
          <div className="relative">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search customers or chats..."
              className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-9 pr-3 py-2 text-xs text-[#0F172A] placeholder:text-slate-400 focus:border-[#2563EB] focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1">
              {(
                [
                  { key: 'all', label: 'All' },
                  { key: 'mine', label: 'Mine' },
                  { key: 'unassigned', label: 'Unassigned' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setPreferredInboxFilter(opt.key)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
                    preferredInboxFilter === opt.key
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#F8FAFC] text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <select
              aria-label="More conversation filters"
              value={
                ['open', 'pending', 'resolved'].includes(preferredInboxFilter)
                  ? preferredInboxFilter
                  : ''
              }
              onChange={(e) => {
                if (e.target.value) {
                  setPreferredInboxFilter(
                    e.target.value as 'open' | 'pending' | 'resolved'
                  );
                } else {
                  setPreferredInboxFilter('all');
                }
              }}
              className="rounded-lg border border-[#E2E8F0] bg-white px-2 py-1 text-[11px] font-medium text-slate-600 cursor-pointer"
            >
              <option value="">Status...</option>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#E2E8F0]">
          {filteredConversations.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-xs font-semibold text-[#0F172A]">No matching conversations</p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setPreferredInboxFilter('all');
                }}
                className="mt-2 text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
              >
                Show all chats
              </button>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const contact = contacts.find((c) => c.id === conv.contactId);
              const assignee = teamMembers.find((m) => m.id === conv.assignedToId);
              const isSelected = activeConversation?.id === conv.id;

              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => handleSelectConversation(conv.id)}
                  className={`w-full text-left px-4 py-3.5 transition-colors cursor-pointer ${
                    isSelected ? 'bg-[#EFF6FF]/70' : 'hover:bg-[#F8FAFC]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[#0F172A] truncate">
                      {contact?.fullName ?? 'Unknown Customer'}
                    </span>
                    <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                      {formatRelativeTime(conv.lastMessageAt)}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 truncate mt-1">
                    {conv.lastMessagePreview}
                  </p>

                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="truncate">
                      {assignee ? assignee.fullName.split(' ')[0] : 'Unassigned'} ·{' '}
                      <span className="capitalize">{conv.status}</span>
                    </span>
                    {conv.unreadCount > 0 && (
                      <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-[#E11D48] px-1.5 text-[11px] font-bold text-white tabular-nums shrink-0">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* CENTER PANEL: Clean Chat Area */}
      <section
        aria-label="Conversation Thread"
        className={`${
          mobileView === 'chat' ? 'flex' : 'hidden'
        } md:flex flex-1 flex-col min-w-0 bg-[#F8FAFC]`}
      >
        {!activeConversation || !activeContact ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div>
              <p className="font-display text-base font-bold text-[#0F172A]">Select a chat</p>
              <p className="text-xs text-slate-500 mt-1">
                Pick a customer on the left to read messages and reply.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-white border-b border-[#E2E8F0] px-4 py-3 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobileView('list')}
                  className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-[#F8FAFC]"
                  aria-label="Back to chats"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>

                <div className="h-9 w-9 rounded-xl bg-[#EFF6FF] text-[#2563EB] font-bold text-xs flex items-center justify-center shrink-0">
                  {activeContact.fullName
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </div>

                <div className="min-w-0">
                  <h2 className="font-display text-sm font-bold text-[#0F172A] truncate">
                    {activeContact.fullName}
                  </h2>
                  <p className="text-xs text-slate-500 truncate">
                    <span className="font-mono">{formatPhoneDisplay(activeContact.phoneE164)}</span>
                    {' · '}
                    <span
                      className={
                        windowStatus.isOpen ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'
                      }
                    >
                      {windowStatus.isOpen ? 'Reply window open' : 'Template required to reply'}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <select
                  aria-label="Assign staff member"
                  value={activeConversation.assignedToId ?? ''}
                  onChange={(e) =>
                    assignConversation(activeConversation.id, e.target.value || null)
                  }
                  className="hidden sm:block rounded-xl border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] cursor-pointer"
                >
                  <option value="">Unassigned</option>
                  {teamMembers
                    .filter((m) => m.status === 'active')
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.fullName}
                        {lastAssignedMemberId === m.id && !activeConversation.assignedToId
                          ? ' (Recent)'
                          : ''}
                      </option>
                    ))}
                </select>

                <button
                  type="button"
                  onClick={() =>
                    updateConversationStatus(
                      activeConversation.id,
                      activeConversation.status === 'resolved' ? 'open' : 'resolved'
                    )
                  }
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                    activeConversation.status === 'resolved'
                      ? 'border border-[#E2E8F0] bg-white text-[#0F172A] hover:bg-[#F8FAFC]'
                      : 'bg-[#2563EB] text-white hover:bg-[#1D4ED8]'
                  }`}
                >
                  {activeConversation.status === 'resolved' ? 'Reopen' : 'Resolve'}
                </button>

                <button
                  type="button"
                  onClick={() => setShowDetailsDrawer((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold cursor-pointer ${
                    showDetailsDrawer
                      ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]'
                      : 'border-[#E2E8F0] bg-white text-slate-700 hover:bg-[#F8FAFC]'
                  }`}
                >
                  <Info className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Details</span>
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOverflowOpen((o) => !o)}
                    className="p-1.5 rounded-xl border border-[#E2E8F0] bg-white text-slate-600 hover:bg-[#F8FAFC] cursor-pointer"
                    aria-label="More chat options"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {overflowOpen && (
                    <div className="absolute right-0 mt-2 w-52 rounded-xl border border-[#E2E8F0] bg-white shadow-luxury-hover z-30 p-1.5 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          toggleHumanHandoff(
                            activeConversation.id,
                            !activeConversation.humanHandoffRequested
                          );
                          setOverflowOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F8FAFC] flex items-center gap-2 cursor-pointer"
                      >
                        <UserCheck className="h-3.5 w-3.5 text-[#2563EB]" />
                        <span>
                          {activeConversation.humanHandoffRequested
                            ? 'Clear Human Handoff'
                            : 'Flag for Human Handoff'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setComposerMode(
                            composerMode === 'internal_note' ? 'reply' : 'internal_note'
                          );
                          setOverflowOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F8FAFC] flex items-center gap-2 cursor-pointer"
                      >
                        <Lock className="h-3.5 w-3.5 text-amber-600" />
                        <span>
                          {composerMode === 'internal_note'
                            ? 'Switch to Customer Reply'
                            : 'Write Internal Note'}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {business.metaConnectionState !== 'connected' && (
              <div className="bg-amber-50/90 border-b border-amber-200 px-4 py-2 text-xs text-amber-950">
                WhatsApp is not connected yet — connect your account in Settings before sending live replies.
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
              {activeMessages.map((msg) => {
                const isInternal = msg.direction === 'internal';
                const isInbound = msg.direction === 'inbound';

                if (isInternal) {
                  return (
                    <div key={msg.id} className="flex justify-center">
                      <div className="max-w-lg w-full rounded-xl border border-[#F4B942]/60 bg-amber-50/90 px-4 py-2.5 text-xs text-amber-950">
                        <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-amber-800 mb-1">
                          <span className="flex items-center gap-1.5">
                            <Lock className="h-3 w-3" />
                            Team Note · {msg.senderName}
                          </span>
                          <span className="tabular-nums">{formatRelativeTime(msg.createdAt)}</span>
                        </div>
                        <p className="leading-relaxed">{msg.body}</p>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'}`}
                  >
                    <div
                      className={`max-w-[85%] sm:max-w-[68%] rounded-2xl px-4 py-2.5 text-sm shadow-2xs ${
                        isInbound
                          ? 'bg-white border border-[#E2E8F0] text-[#0F172A] rounded-tl-xs'
                          : msg.deliveryStatus === 'failed'
                          ? 'bg-rose-50 border border-[#E11D48]/40 text-[#0F172A] rounded-tr-xs'
                          : 'bg-[#EFF6FF] border border-[#2563EB]/20 text-[#0F172A] rounded-tr-xs'
                      }`}
                    >
                      {msg.templateName && (
                        <p className="text-[11px] font-medium text-[#2563EB] mb-1">
                          Template: {msg.templateName.replace(/_/g, ' ')}
                        </p>
                      )}
                      {msg.mediaFilename && (
                        <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-white/80 border border-[#E2E8F0] px-2.5 py-1.5 text-xs text-[#0F172A]">
                          <FileText className="h-3.5 w-3.5 text-[#2563EB] shrink-0" />
                          <span className="truncate font-medium">{msg.mediaFilename}</span>
                        </div>
                      )}
                      <p className="whitespace-pre-wrap leading-relaxed text-[13px]">{msg.body}</p>

                      <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[11px] text-slate-400 tabular-nums">
                        <span>
                          {new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {!isInbound && renderDeliveryIndicator(msg.deliveryStatus)}
                      </div>
                    </div>

                    {msg.deliveryStatus === 'failed' && (
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-[#E11D48]">
                        <span>Not delivered — WhatsApp connection required</span>
                        <button
                          type="button"
                          onClick={() => retryFailedMessage(msg.id)}
                          className="inline-flex items-center gap-1 font-semibold underline cursor-pointer"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Retry
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="bg-white border-t border-[#E2E8F0] p-3 sm:p-4 shrink-0">
              {!windowStatus.isOpen && composerMode === 'reply' && (
                <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-amber-950">
                    It has been more than 24 hours since the customer replied. Choose an approved
                    template to reach out again.
                  </span>
                  <button
                    type="button"
                    onClick={() => setTemplateModalOpen(true)}
                    className="rounded-xl bg-[#2563EB] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] whitespace-nowrap cursor-pointer"
                  >
                    Choose Template
                  </button>
                </div>
              )}

              {sendError && (
                <div className="mb-2.5 rounded-xl border border-[#E11D48]/30 bg-rose-50 px-3 py-2 text-xs text-[#E11D48] flex items-center justify-between">
                  <span>{sendError}</span>
                  <button type="button" onClick={() => setSendError(null)}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {composerMode === 'internal_note' && (
                <div className="mb-2 flex items-center justify-between text-xs text-amber-800 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5" /> Writing an internal team note (customer cannot
                    see this)
                  </span>
                  <button
                    type="button"
                    onClick={() => setComposerMode('reply')}
                    className="text-[#2563EB] hover:underline cursor-pointer"
                  >
                    Back to Reply
                  </button>
                </div>
              )}

              {attachmentName && (
                <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-xs text-[#0F172A]">
                  <Paperclip className="h-3.5 w-3.5 text-[#2563EB]" />
                  <span>{attachmentName}</span>
                  <button type="button" onClick={() => setAttachmentName(null)}>
                    <X className="h-3.5 w-3.5 text-slate-400 hover:text-[#E11D48]" />
                  </button>
                </div>
              )}

              <form onSubmit={handleSend} className="flex items-end gap-2">
                <div className="flex items-center gap-1 pb-1.5">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setEmojiOpen((o) => !o)}
                      className="p-2 rounded-xl text-slate-500 hover:bg-[#F8FAFC] hover:text-[#0F172A] cursor-pointer"
                      title="Emoji"
                    >
                      <Smile className="h-4 w-4" />
                    </button>
                    {emojiOpen && (
                      <div className="absolute bottom-11 left-0 z-20 rounded-xl border border-[#E2E8F0] bg-white p-2 shadow-lg flex items-center gap-1">
                        {COMMON_EMOJIS.map((em) => (
                          <button
                            key={em}
                            type="button"
                            onClick={() => {
                              setDraftText((t) => t + em);
                              setEmojiOpen(false);
                            }}
                            className="p-1.5 rounded hover:bg-[#F8FAFC] text-base cursor-pointer"
                          >
                            {em}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <label
                    className="p-2 rounded-xl text-slate-500 hover:bg-[#F8FAFC] hover:text-[#0F172A] cursor-pointer"
                    title="Attach file"
                  >
                    <Paperclip className="h-4 w-4" />
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,.pdf,.doc,.docx"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setAttachmentName(file.name);
                          setAttachmentType(file.type.startsWith('image/') ? 'image' : 'document');
                        }
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => setTemplateModalOpen(true)}
                    className="p-2 rounded-xl text-slate-500 hover:bg-[#F8FAFC] hover:text-[#2563EB] cursor-pointer"
                    title="Send template"
                  >
                    <FileText className="h-4 w-4" />
                  </button>
                </div>

                <input
                  type="text"
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  disabled={composerMode === 'reply' && !windowStatus.isOpen}
                  placeholder={
                    composerMode === 'internal_note'
                      ? 'Add an internal note for your team...'
                      : windowStatus.isOpen
                      ? 'Type a message...'
                      : 'Choose a template above to message this customer'
                  }
                  className={`flex-1 rounded-xl border px-3.5 py-2.5 text-sm focus:outline-none ${
                    composerMode === 'internal_note'
                      ? 'border-[#F4B942]/60 bg-amber-50/40'
                      : 'border-[#E2E8F0] bg-[#F8FAFC] focus:border-[#2563EB] focus:bg-white disabled:opacity-60'
                  }`}
                />

                <button
                  type="submit"
                  disabled={
                    (!draftText.trim() && !attachmentName) ||
                    (composerMode === 'reply' && !windowStatus.isOpen)
                  }
                  className="h-10 px-4 rounded-xl bg-[#2563EB] text-white text-xs font-semibold hover:bg-[#1D4ED8] disabled:opacity-45 transition-colors inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">
                    {composerMode === 'internal_note' ? 'Save Note' : 'Send Message'}
                  </span>
                </button>
              </form>
            </div>
          </>
        )}
      </section>

      {/* RIGHT DRAWER: Collapsible Customer Details */}
      {showDetailsDrawer && activeContact && activeConversation && (
        <aside
          aria-label="Customer Details"
          className="fixed inset-y-0 right-0 z-40 w-80 border-l border-[#E2E8F0] bg-white shadow-xl lg:static lg:shadow-none flex flex-col overflow-y-auto shrink-0"
        >
          <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-bold text-[#0F172A]">Customer Details</h3>
              <p className="text-xs text-slate-500">{activeContact.company || 'Customer'}</p>
            </div>
            <button type="button" onClick={() => setShowDetailsDrawer(false)}>
              <X className="h-4 w-4 text-slate-500" />
            </button>
          </div>

          <div className="p-4 border-b border-[#E2E8F0] space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500 flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" /> Phone
              </span>
              <span className="font-mono font-medium text-[#0F172A]">
                {activeContact.phoneE164}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">Email</span>
              <span className="text-[#0F172A] truncate">{activeContact.email || '—'}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">Updates Opt-In</span>
              <span
                className={`font-semibold ${
                  activeContact.marketingOptIn ? 'text-emerald-700' : 'text-[#E11D48]'
                }`}
              >
                {activeContact.marketingOptIn ? 'Yes' : 'Opted out'}
              </span>
            </div>
          </div>

          <div className="p-4 border-b border-[#E2E8F0]">
            <p className="text-xs font-bold text-[#0F172A] flex items-center gap-1.5 mb-2.5">
              <TagIcon className="h-3.5 w-3.5 text-[#2563EB]" /> Groups
            </p>
            {tags.length === 0 ? (
              <p className="text-xs text-slate-500">No groups created yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const selected = activeContact.tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleContactTag(tag.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border cursor-pointer ${
                        selected
                          ? 'bg-[#EFF6FF] border-[#2563EB] text-[#2563EB]'
                          : 'bg-[#F8FAFC] border-[#E2E8F0] text-slate-600'
                      }`}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="p-4 space-y-3 text-xs">
            <p className="font-bold text-[#0F172A]">Notes</p>
            <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-slate-700 whitespace-pre-wrap leading-relaxed min-h-[72px]">
              {activeContact.notes || 'No notes yet.'}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="Add quick note..."
                className="flex-1 rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={handleSaveContactNote}
                className="rounded-lg bg-[#0F172A] px-3 py-1.5 font-semibold text-white cursor-pointer"
              >
                Add
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Template Picker Modal */}
      {templateModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          onClick={() => setTemplateModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-[#E2E8F0] bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#0F172A]">
                  Choose Approved Template
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Send a pre-approved message to restart the conversation
                </p>
              </div>
              <button type="button" onClick={() => setTemplateModalOpen(false)}>
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>

            <div className="p-5 space-y-3 max-h-96 overflow-y-auto">
              {approvedTemplates.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">
                  No approved templates available yet. Sync your templates from Meta in Message
                  Templates.
                </p>
              ) : (
                approvedTemplates.map((tpl) => {
                  const isSelected = selectedTemplateId === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(tpl.id)}
                      className={`w-full text-left rounded-xl border p-3.5 transition-colors cursor-pointer ${
                        isSelected
                          ? 'border-[#2563EB] bg-[#EFF6FF]/60'
                          : 'border-[#E2E8F0] hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <p className="text-xs font-bold text-[#0F172A]">
                        {tpl.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </p>
                      <p className="text-xs text-slate-700 mt-1 leading-relaxed">{tpl.bodyText}</p>
                    </button>
                  );
                })
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-[#E2E8F0] flex items-center justify-end gap-2 bg-[#F8FAFC]">
              <button
                type="button"
                onClick={() => setTemplateModalOpen(false)}
                className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!selectedTemplateId}
                onClick={handleSendTemplate}
                className="rounded-xl bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 cursor-pointer"
              >
                Send Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
