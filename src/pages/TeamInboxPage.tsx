import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  MessageSquarePlus,
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

type InboxFilterType = 'all' | 'unread' | 'mine' | 'unassigned' | 'open' | 'pending' | 'resolved';

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
    loadOlderMessages,
    hasMoreMessagesMap,
    markConversationRead,
    assignConversation,
    updateConversationStatus,
    toggleHumanHandoff,
    updateContact,
    createTag,
    openOrCreateConversationForContact,
  } = useApp();

  const [inboxFilter, setInboxFilter] = useState<InboxFilterType>(preferredInboxFilter);
  const [searchQuery, setSearchQuery] = useState('');
  const [composerMode, setComposerMode] = useState<'reply' | 'internal_note'>('reply');
  const [draftText, setDraftText] = useState('');
  const draftsByConvRef = useRef<Record<string, string>>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const [emojiOpen, setEmojiOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [newChatModalOpen, setNewChatModalOpen] = useState(false);
  const [newChatSearch, setNewChatSearch] = useState('');

  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  // Desktop default open for 3-column commercial CRM feel when a conversation is active
  const [showDetailsDrawer, setShowDetailsDrawer] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1280 : true
  );
  const [overflowOpen, setOverflowOpen] = useState(false);

  // Right Panel Edit State
  const [noteInput, setNoteInput] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailEmail, setDetailEmail] = useState('');
  const [detailCompany, setDetailCompany] = useState('');
  const [detailCity, setDetailCity] = useState('');
  const [detailsFeedback, setDetailsFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const handleFilterChange = (next: InboxFilterType) => {
    setInboxFilter(next);
    if (next !== 'unread') {
      setPreferredInboxFilter(next);
    }
  };

  const unreadConversationCount = useMemo(
    () => conversations.filter((c) => c.unreadCount > 0).length,
    [conversations]
  );

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

        if (inboxFilter === 'unread' && conv.unreadCount <= 0) return false;
        if (inboxFilter === 'mine' && conv.assignedToId !== currentUser?.id) return false;
        if (inboxFilter === 'unassigned' && conv.assignedToId !== null) return false;
        if (inboxFilter === 'open' && conv.status !== 'open') return false;
        if (inboxFilter === 'pending' && conv.status !== 'pending') return false;
        if (inboxFilter === 'resolved' && conv.status !== 'resolved') return false;

        if (!q) return true;
        const ct = contacts.find((c) => c.id === conv.contactId);
        return (
          ct?.fullName.toLowerCase().includes(q) ||
          ct?.phoneE164.includes(q) ||
          conv.lastMessagePreview.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  }, [conversations, inboxFilter, searchQuery, currentUser, contacts]);

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

  // Restore per-conversation draft when switching conversations
  useEffect(() => {
    const convId = activeConversation?.id;
    if (!convId) {
      setDraftText('');
      return;
    }
    setDraftText(draftsByConvRef.current[convId] ?? '');
    setSendError(null);
    setDetailsFeedback(null);
    setEditingDetails(false);
  }, [activeConversation?.id]);

  // Keep detail edit inputs synced with activeContact
  useEffect(() => {
    if (activeContact) {
      setDetailEmail(activeContact.email || '');
      setDetailCompany(activeContact.company || '');
      setDetailCity(activeContact.city || '');
    }
  }, [activeContact]);

  // Scroll to bottom when new messages arrive in active conversation
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeConversation?.id, activeMessages.length]);

  const handleDraftChange = (val: string) => {
    setDraftText(val);
    if (activeConversation?.id) {
      draftsByConvRef.current[activeConversation.id] = val;
    }
  };

  const windowStatus = useMemo(
    () =>
      activeConversation
        ? getWindowStatus(activeConversation.windowExpiresAt)
        : { isOpen: false, label: '', remainingHours: 0 },
    [activeConversation]
  );

  const cswRingProgress = useMemo(() => {
    if (!windowStatus.isOpen) return 0;
    return Math.min(100, Math.max(8, Math.round((windowStatus.remainingHours / 24) * 100)));
  }, [windowStatus]);

  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.approvalStatus === 'APPROVED'),
    [templates]
  );

  const isContactAllowlisted = useMemo(() => {
    if (business.messagingMode !== 'test' || !activeContact) return true;
    return business.testAllowlist.includes(activeContact.phoneE164);
  }, [business.messagingMode, business.testAllowlist, activeContact]);

  const contactsForNewChat = useMemo(() => {
    const q = newChatSearch.trim().toLowerCase();
    return contacts
      .filter(
        (c) =>
          !q ||
          c.fullName.toLowerCase().includes(q) ||
          c.phoneE164.includes(q) ||
          c.company.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [contacts, newChatSearch]);

  const handleSelectConversation = (convId: string) => {
    setSelectedConversationId(convId);
    markConversationRead(convId);
    setSendError(null);
    setMobileView('chat');
  };

  const handleStartChatWithContact = (contactId: string) => {
    const convId = openOrCreateConversationForContact(contactId);
    setNewChatModalOpen(false);
    setNewChatSearch('');
    setSelectedConversationId(convId);
    setMobileView('chat');
  };

  const handleLoadOlder = async () => {
    if (!activeConversation || loadingOlder) return;
    setLoadingOlder(true);
    await loadOlderMessages(activeConversation.id);
    setLoadingOlder(false);
  };

  const submitCurrentMessage = async () => {
    if (!activeConversation || isSending || !draftText.trim()) return;
    setSendError(null);
    setIsSending(true);

    const msgType = composerMode === 'internal_note' ? 'internal_note' : 'text';
    const convId = activeConversation.id;

    try {
      const res = await sendMessage({
        conversationId: convId,
        body: draftText,
        messageType: msgType,
      });

      if (!res.ok) {
        setSendError(res.error ?? 'Could not send message.');
        return;
      }

      draftsByConvRef.current[convId] = '';
      setDraftText('');
    } finally {
      setIsSending(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitCurrentMessage();
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isSending && draftText.trim() && (composerMode === 'internal_note' || windowStatus.isOpen)) {
        void submitCurrentMessage();
      }
    }
  };

  const handleSendTemplate = async () => {
    if (!activeConversation || !selectedTemplateId || isSending) return;
    const tpl = approvedTemplates.find((t) => t.id === selectedTemplateId);
    if (!tpl) return;
    setSendError(null);
    setIsSending(true);

    try {
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
    } finally {
      setIsSending(false);
    }
  };

  const handleToggleOptIn = () => {
    if (!activeContact) return;
    const nextVal = !activeContact.marketingOptIn;
    const res = updateContact(activeContact.id, { marketingOptIn: nextVal });
    setDetailsFeedback(
      res.ok
        ? { ok: true, text: nextVal ? 'Marketing opt-in enabled.' : 'Marked as opted out.' }
        : { ok: false, text: res.error || 'Could not update marketing consent.' }
    );
  };

  const handleSaveCustomDetails = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeContact) return;
    const res = updateContact(activeContact.id, {
      email: detailEmail.trim(),
      company: detailCompany.trim(),
      city: detailCity.trim(),
    });
    if (res.ok) {
      setEditingDetails(false);
      setDetailsFeedback({ ok: true, text: 'Contact details saved.' });
    } else {
      setDetailsFeedback({ ok: false, text: res.error || 'Failed to save contact details.' });
    }
  };

  const handleSaveContactNote = () => {
    if (!activeContact || !noteInput.trim()) return;
    const combined = activeContact.notes
      ? `${activeContact.notes}\n• ${noteInput.trim()}`
      : `• ${noteInput.trim()}`;
    const res = updateContact(activeContact.id, { notes: combined });
    if (res.ok) {
      setNoteInput('');
      setDetailsFeedback({ ok: true, text: 'Comment added to contact.' });
    } else {
      setDetailsFeedback({ ok: false, text: res.error || 'Could not save comment.' });
    }
  };

  const toggleContactTag = (tagId: string) => {
    if (!activeContact) return;
    const exists = activeContact.tagIds.includes(tagId);
    const next = exists
      ? activeContact.tagIds.filter((t) => t !== tagId)
      : [...activeContact.tagIds, tagId];
    const res = updateContact(activeContact.id, { tagIds: next });
    if (!res.ok) {
      setDetailsFeedback({ ok: false, text: res.error || 'Could not update tags.' });
    }
  };

  const handleAddInlineTag = () => {
    if (!activeContact || !newTagInput.trim()) return;
    const created = createTag(newTagInput.trim(), '#2563EB');
    if (!activeContact.tagIds.includes(created.id)) {
      updateContact(activeContact.id, { tagIds: [...activeContact.tagIds, created.id] });
    }
    setNewTagInput('');
    setDetailsFeedback({ ok: true, text: `Tag "${created.name}" applied.` });
  };

  const renderDeliveryIndicator = (status: DeliveryStatus) => {
    switch (status) {
      case 'read':
        return (
          <span title="Read by customer" className="inline-flex items-center">
            <CheckCheck className="h-3.5 w-3.5 text-[#2563EB]" aria-label="Read" />
          </span>
        );
      case 'delivered':
        return (
          <span title="Delivered to customer phone" className="inline-flex items-center">
            <CheckCheck className="h-3.5 w-3.5 text-slate-400" aria-label="Delivered" />
          </span>
        );
      case 'sent':
        return (
          <span title="Sent by WhatsApp" className="inline-flex items-center">
            <Check className="h-3.5 w-3.5 text-slate-400" aria-label="Sent" />
          </span>
        );
      case 'submitted':
        return (
          <span
            title="Submitted to Meta Cloud API (awaiting webhook confirmation)"
            className="inline-flex items-center gap-1 text-[10px] text-slate-400"
          >
            <Clock className="h-3 w-3 text-[#2563EB]" aria-label="Submitted" />
            <span>Submitted</span>
          </span>
        );
      case 'pending':
      case 'queued':
        return (
          <span title="Sending..." className="inline-flex items-center gap-1 text-[10px] text-amber-600">
            <Clock className="h-3 w-3" aria-label="Sending" />
            <span>Sending</span>
          </span>
        );
      case 'failed':
        return (
          <span title="Delivery failed" className="inline-flex items-center">
            <AlertTriangle className="h-3.5 w-3.5 text-[#E11D48]" aria-label="Failed" />
          </span>
        );
      default:
        return null;
    }
  };

  const getInitials = (name?: string) =>
    (name || 'UC')
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col bg-white overflow-hidden pb-14 lg:pb-0">
      {/* Compact Channel & Status Strip */}
      <div className="h-11 border-b border-[#E2E8F0] px-4 flex items-center justify-between gap-3 bg-white shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="inline-flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1 text-xs font-semibold text-[#0F172A]">
            <span
              className={`h-2 w-2 rounded-full ${
                business.metaConnectionState === 'connected' ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            <span>WhatsApp Cloud API</span>
          </div>
          <span className="hidden sm:inline text-xs text-slate-500 truncate">
            {business.messagingMode === 'test'
              ? 'Test Mode · Allowlisted recipients only'
              : business.metaConnectionState === 'connected'
              ? business.whatsappPhoneE164 || 'Live messaging active'
              : 'Not connected yet'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setNewChatModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] transition-colors cursor-pointer shrink-0"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          <span>New Conversation</span>
        </button>
      </div>

      {/* Main 3-Column Inbox Workspace */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* LEFT COLUMN: Conversation List */}
        <section
          aria-label="Conversations List"
          className={`${
            mobileView === 'list' ? 'flex' : 'hidden'
          } md:flex flex-col w-full md:w-[320px] lg:w-[348px] border-r border-[#E2E8F0] bg-white shrink-0`}
        >
          <div className="p-3 border-b border-[#E2E8F0] space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name, phone, or message..."
                  className="w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-8 pr-3 py-1.5 text-xs text-[#0F172A] placeholder:text-slate-400 focus:border-[#2563EB] focus:bg-white focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setNewChatModalOpen(true)}
                title="Start a conversation"
                className="p-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer shrink-0"
              >
                <MessageSquarePlus className="h-3.5 w-3.5 text-[#2563EB]" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1 overflow-x-auto">
                {(
                  [
                    { key: 'all', label: 'All' },
                    {
                      key: 'unread',
                      label: unreadConversationCount > 0 ? `Unread (${unreadConversationCount})` : 'Unread',
                    },
                    { key: 'mine', label: 'Mine' },
                    { key: 'unassigned', label: 'Unassigned' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => handleFilterChange(opt.key)}
                    className={`px-2 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                      inboxFilter === opt.key
                        ? 'bg-[#EFF6FF] text-[#2563EB]'
                        : 'text-slate-600 hover:bg-[#F1F5F9]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <select
                aria-label="Filter by status"
                value={['open', 'pending', 'resolved'].includes(inboxFilter) ? inboxFilter : ''}
                onChange={(e) => {
                  if (e.target.value) {
                    handleFilterChange(e.target.value as 'open' | 'pending' | 'resolved');
                  } else {
                    handleFilterChange('all');
                  }
                }}
                className="rounded-md border border-[#E2E8F0] bg-white px-1.5 py-1 text-[11px] font-medium text-slate-600 cursor-pointer shrink-0"
              >
                <option value="">Status</option>
                <option value="open">Open</option>
                <option value="pending">Pending</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#E2E8F0]">
            {filteredConversations.length === 0 ? (
              <div className="p-6 text-center space-y-2">
                <p className="text-xs font-semibold text-[#0F172A]">
                  {conversations.length === 0 ? 'No conversations yet' : 'No matching conversations'}
                </p>
                <p className="text-[11px] text-slate-500">
                  {conversations.length === 0
                    ? 'Inbound WhatsApp messages or new outreach chats appear here.'
                    : 'Try clearing your search or status filter.'}
                </p>
                {conversations.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      handleFilterChange('all');
                    }}
                    className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
                  >
                    Reset filters
                  </button>
                )}
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
                    className={`w-full text-left px-3.5 py-3 transition-colors flex items-start gap-3 cursor-pointer ${
                      isSelected ? 'bg-[#EFF6FF]/70' : 'hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <div
                      className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        isSelected
                          ? 'bg-[#2563EB] text-white'
                          : 'bg-[#EFF6FF] text-[#2563EB]'
                      }`}
                    >
                      {getInitials(contact?.fullName)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-[#0F172A] truncate">
                          {contact?.fullName ?? 'Unknown Contact'}
                        </span>
                        <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                          {formatRelativeTime(conv.lastMessageAt)}
                        </span>
                      </div>

                      <p className="text-xs text-slate-600 truncate mt-0.5">
                        {conv.lastMessagePreview}
                      </p>

                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span className="truncate">
                          {assignee ? assignee.fullName.split(' ')[0] : 'Unassigned'}
                          {' · '}
                          <span
                            className={`capitalize ${
                              conv.status === 'resolved'
                                ? 'text-emerald-700 font-medium'
                                : conv.humanHandoffRequested
                                ? 'text-[#E11D48] font-medium'
                                : ''
                            }`}
                          >
                            {conv.humanHandoffRequested ? 'Handoff' : conv.status}
                          </span>
                        </span>
                        {conv.unreadCount > 0 && (
                          <span className="inline-flex h-4 min-w-[18px] items-center justify-center rounded-full bg-[#2563EB] px-1.5 text-[10px] font-bold text-white tabular-nums shrink-0">
                            {conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* CENTER COLUMN: Thread & Empty State */}
        <section
          aria-label="Conversation Thread"
          className={`${
            mobileView === 'chat' ? 'flex' : 'hidden'
          } md:flex flex-1 flex-col min-w-0 bg-[#F8FAFC]`}
        >
          {!activeConversation || !activeContact ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="max-w-md w-full text-center space-y-4">
                <div className="h-14 w-14 rounded-2xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center mx-auto">
                  <Inbox className="h-7 w-7" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="font-display text-lg font-bold text-[#0F172A]">
                    {conversations.length === 0 ? 'No conversations yet' : 'Select a conversation'}
                  </h2>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {conversations.length === 0
                      ? 'Customer conversations will appear here as soon as WhatsApp messages arrive or you start a conversation with an existing contact.'
                      : 'Choose a customer from the left list or start a new conversation.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                  {contacts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setNewChatModalOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" />
                      <span>Start a Conversation</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => navigate('/app/contacts')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
                  >
                    <span>View Contacts</span>
                  </button>
                  {business.metaConnectionState !== 'connected' && (
                    <button
                      type="button"
                      onClick={() => navigate('/app/settings')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-2 text-xs font-semibold text-[#2563EB] hover:bg-[#EFF6FF] cursor-pointer"
                    >
                      <Settings className="h-3.5 w-3.5" />
                      <span>Connect WhatsApp</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Active Chat Header */}
              <div className="bg-white border-b border-[#E2E8F0] px-4 py-2.5 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => setMobileView('list')}
                    className="md:hidden p-1.5 rounded-lg text-slate-600 hover:bg-[#F1F5F9] cursor-pointer"
                    aria-label="Back to conversations"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>

                  <div className="h-9 w-9 rounded-full bg-[#EFF6FF] text-[#2563EB] font-bold text-xs flex items-center justify-center shrink-0">
                    {getInitials(activeContact.fullName)}
                  </div>

                  <div className="min-w-0">
                    <h2 className="font-display text-sm font-bold text-[#0F172A] truncate">
                      {activeContact.fullName}
                    </h2>
                    <p className="text-[11px] text-slate-500 truncate">
                      <span className="font-mono">{formatPhoneDisplay(activeContact.phoneE164)}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Visual 24-hour CSW Countdown Indicator */}
                  <div
                    title={windowStatus.label}
                    className={`hidden sm:inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold tabular-nums ${
                      windowStatus.isOpen
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    <span className="relative h-3.5 w-3.5 shrink-0">
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 -rotate-90">
                        <circle
                          cx="10"
                          cy="10"
                          r="7"
                          fill="none"
                          stroke="currentColor"
                          strokeOpacity="0.2"
                          strokeWidth="2.5"
                        />
                        <circle
                          cx="10"
                          cy="10"
                          r="7"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeDasharray={`${(cswRingProgress / 100) * 44} 44`}
                        />
                      </svg>
                    </span>
                    <span>{windowStatus.isOpen ? `${windowStatus.remainingHours}h window` : '24h closed'}</span>
                  </div>

                  {/* Assigned Agent */}
                  <select
                    aria-label="Assign agent"
                    value={activeConversation.assignedToId ?? ''}
                    onChange={(e) =>
                      assignConversation(activeConversation.id, e.target.value || null)
                    }
                    className="hidden sm:block rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] cursor-pointer"
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

                  {/* Resolve / Reopen */}
                  <button
                    type="button"
                    onClick={() =>
                      updateConversationStatus(
                        activeConversation.id,
                        activeConversation.status === 'resolved' ? 'open' : 'resolved'
                      )
                    }
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                      activeConversation.status === 'resolved'
                        ? 'border border-[#E2E8F0] bg-white text-[#0F172A] hover:bg-[#F1F5F9]'
                        : 'bg-[#2563EB] text-white hover:bg-[#1D4ED8]'
                    }`}
                  >
                    {activeConversation.status === 'resolved' ? 'Reopen' : 'Mark Resolved'}
                  </button>

                  {/* Details Toggle */}
                  <button
                    type="button"
                    onClick={() => setShowDetailsDrawer((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold cursor-pointer ${
                      showDetailsDrawer
                        ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]'
                        : 'border-[#E2E8F0] bg-white text-slate-700 hover:bg-[#F1F5F9]'
                    }`}
                  >
                    <Info className="h-3.5 w-3.5" />
                    <span className="hidden lg:inline">Details</span>
                  </button>

                  {/* Overflow Menu */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setOverflowOpen((o) => !o)}
                      className="p-1.5 rounded-lg border border-[#E2E8F0] bg-white text-slate-600 hover:bg-[#F1F5F9] cursor-pointer"
                      aria-label="More options"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    {overflowOpen && (
                      <div className="absolute right-0 mt-1.5 w-52 rounded-xl border border-[#E2E8F0] bg-white shadow-luxury-hover z-30 p-1.5 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            toggleHumanHandoff(
                              activeConversation.id,
                              !activeConversation.humanHandoffRequested
                            );
                            setOverflowOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F1F5F9] flex items-center gap-2 cursor-pointer"
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
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F1F5F9] flex items-center gap-2 cursor-pointer"
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

              {/* Honest Connection / Test Mode Guardrails */}
              {business.metaConnectionState !== 'connected' ? (
                <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-950 flex items-center justify-between gap-2">
                  <span>
                    WhatsApp is not connected yet — verify your account in Settings before sending live replies.
                  </span>
                  {currentUser?.role === 'admin' && (
                    <button
                      type="button"
                      onClick={() => navigate('/app/settings')}
                      className="font-semibold text-[#2563EB] hover:underline shrink-0 cursor-pointer"
                    >
                      Settings
                    </button>
                  )}
                </div>
              ) : (
                business.messagingMode === 'test' &&
                !isContactAllowlisted && (
                  <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Test Mode is active: add{' '}
                      <span className="font-mono font-semibold">{activeContact.phoneE164}</span> to
                      your Test Allowlist in Settings before sending replies.
                    </span>
                    {currentUser?.role === 'admin' && (
                      <button
                        type="button"
                        onClick={() => navigate('/app/settings')}
                        className="font-semibold text-[#2563EB] hover:underline cursor-pointer"
                      >
                        Open Settings
                      </button>
                    )}
                  </div>
                )
              )}

              {/* Message Thread */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
                {hasMoreMessagesMap[activeConversation.id] && (
                  <div className="flex justify-center pb-2">
                    <button
                      type="button"
                      onClick={handleLoadOlder}
                      disabled={loadingOlder}
                      className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-[#F1F5F9] disabled:opacity-50 cursor-pointer"
                    >
                      {loadingOlder ? 'Loading earlier messages...' : 'Load older messages'}
                    </button>
                  </div>
                )}

                {activeMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <span className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-[11px] text-slate-500">
                      Conversation ready with {activeContact.fullName} ({activeContact.phoneE164})
                    </span>
                  </div>
                ) : (
                  activeMessages.map((msg) => {
                    const isInternal = msg.direction === 'internal';
                    const isInbound = msg.direction === 'inbound';

                    if (isInternal) {
                      return (
                        <div key={msg.id} className="flex justify-center">
                          <div className="max-w-lg w-full rounded-xl border border-[#F4B942]/60 bg-amber-50/90 px-4 py-2.5 text-xs text-amber-950">
                            <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-amber-800 mb-1">
                              <span className="flex items-center gap-1.5">
                                <Lock className="h-3 w-3" />
                                Internal Note · {msg.senderName}
                              </span>
                              <span className="tabular-nums">{formatRelativeTime(msg.createdAt)}</span>
                            </div>
                            <p className="leading-relaxed whitespace-pre-wrap">{msg.body}</p>
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
                          className={`max-w-[85%] sm:max-w-[68%] rounded-xl px-3.5 py-2.5 text-sm ${
                            isInbound
                              ? 'bg-white border border-[#E2E8F0] text-[#0F172A]'
                              : msg.deliveryStatus === 'failed'
                              ? 'bg-rose-50 border border-[#E11D48]/40 text-[#0F172A]'
                              : 'bg-[#EFF6FF] border border-[#2563EB]/20 text-[#0F172A]'
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

                          <div className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-slate-400 tabular-nums">
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
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#E11D48]">
                            <span>
                              {msg.errorMessage || 'Delivery failed'}
                              {currentUser?.role === 'admin' && msg.errorCode
                                ? ` (${msg.errorCode})`
                                : ''}
                            </span>
                            {!msg.metaMessageId && (
                              <button
                                type="button"
                                disabled={isSending}
                                onClick={() => void retryFailedMessage(msg.id)}
                                className="inline-flex items-center gap-1 font-semibold underline cursor-pointer disabled:opacity-50"
                              >
                                <RefreshCw className="h-3 w-3" />
                                Retry
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={threadEndRef} />
              </div>

              {/* Sticky Composer */}
              <div className="bg-white border-t border-[#E2E8F0] p-3 sm:px-4 sm:py-3 shrink-0">
                {!windowStatus.isOpen && composerMode === 'reply' && (
                  <div className="mb-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-amber-950">
                      24-hour customer service window is closed. Send an approved template to re-engage.
                    </span>
                    <button
                      type="button"
                      onClick={() => setTemplateModalOpen(true)}
                      className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] whitespace-nowrap cursor-pointer"
                    >
                      Choose Template
                    </button>
                  </div>
                )}

                {sendError && (
                  <div className="mb-2 rounded-lg border border-[#E11D48]/30 bg-rose-50 px-3 py-2 text-xs text-[#E11D48] flex items-center justify-between">
                    <span>{sendError}</span>
                    <button type="button" onClick={() => setSendError(null)} className="cursor-pointer">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {composerMode === 'internal_note' && (
                  <div className="mb-2 flex items-center justify-between text-xs text-amber-800 font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5" /> Internal team note (not sent to customer)
                    </span>
                    <button
                      type="button"
                      onClick={() => setComposerMode('reply')}
                      className="text-[#2563EB] hover:underline cursor-pointer"
                    >
                      Switch to Reply
                    </button>
                  </div>
                )}

                <form onSubmit={handleSend} className="flex items-end gap-2">
                  <div className="flex items-center gap-0.5 pb-1">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setEmojiOpen((o) => !o)}
                        className="p-2 rounded-lg text-slate-500 hover:bg-[#F1F5F9] hover:text-[#0F172A] cursor-pointer"
                        title="Insert emoji"
                      >
                        <Smile className="h-4 w-4" />
                      </button>
                      {emojiOpen && (
                        <div className="absolute bottom-11 left-0 z-20 rounded-xl border border-[#E2E8F0] bg-white p-1.5 shadow-luxury-hover flex items-center gap-1">
                          {COMMON_EMOJIS.map((em) => (
                            <button
                              key={em}
                              type="button"
                              onClick={() => {
                                handleDraftChange(draftText + em);
                                setEmojiOpen(false);
                                textareaRef.current?.focus();
                              }}
                              className="p-1.5 rounded hover:bg-[#F1F5F9] text-base cursor-pointer"
                            >
                              {em}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled
                      className="p-2 rounded-lg text-slate-300 cursor-not-allowed"
                      title="Media attachment uploads are not enabled yet"
                    >
                      <Paperclip className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setTemplateModalOpen(true)}
                      className="p-2 rounded-lg text-slate-500 hover:bg-[#F1F5F9] hover:text-[#2563EB] cursor-pointer"
                      title="Send approved template"
                    >
                      <FileText className="h-4 w-4" />
                    </button>
                  </div>

                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={draftText}
                    onChange={(e) => handleDraftChange(e.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    disabled={isSending || (composerMode === 'reply' && !windowStatus.isOpen)}
                    placeholder={
                      composerMode === 'internal_note'
                        ? 'Write an internal note for your team... (Enter to save)'
                        : windowStatus.isOpen
                        ? 'Type a reply... (Enter to send, Shift+Enter for new line)'
                        : 'Select an approved template above to message this contact'
                    }
                    className={`flex-1 resize-none rounded-lg border px-3 py-2 text-sm max-h-28 focus:outline-none ${
                      composerMode === 'internal_note'
                        ? 'border-[#F4B942]/60 bg-amber-50/40'
                        : 'border-[#E2E8F0] bg-[#F8FAFC] focus:border-[#2563EB] focus:bg-white disabled:opacity-60'
                    }`}
                  />

                  <button
                    type="submit"
                    disabled={
                      isSending ||
                      !draftText.trim() ||
                      (composerMode === 'reply' && !windowStatus.isOpen)
                    }
                    className="h-9 px-3.5 rounded-lg bg-[#2563EB] text-white text-xs font-semibold hover:bg-[#1D4ED8] disabled:opacity-45 transition-colors inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">
                      {isSending
                        ? 'Sending...'
                        : composerMode === 'internal_note'
                        ? 'Save Note'
                        : 'Send'}
                    </span>
                  </button>
                </form>
              </div>
            </>
          )}
        </section>

        {/* RIGHT COLUMN: Collapsible Contact Details Panel */}
        {showDetailsDrawer && activeContact && activeConversation && (
          <aside
            aria-label="Contact Details"
            className="fixed inset-y-0 right-0 z-40 w-80 border-l border-[#E2E8F0] bg-white shadow-xl lg:static lg:shadow-none flex flex-col overflow-y-auto shrink-0"
          >
            <div className="px-4 py-3 border-b border-[#E2E8F0] flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-[#0F172A]">Contact Details</h3>
              <button
                type="button"
                onClick={() => setShowDetailsDrawer(false)}
                className="p-1 rounded-md text-slate-400 hover:bg-[#F1F5F9] hover:text-[#0F172A] cursor-pointer"
                aria-label="Close details"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailsFeedback && (
              <div
                className={`mx-4 mt-3 rounded-lg border px-3 py-2 text-[11px] font-medium flex items-center justify-between gap-2 ${
                  detailsFeedback.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-[#E11D48]'
                }`}
              >
                <span>{detailsFeedback.text}</span>
                <button type="button" onClick={() => setDetailsFeedback(null)} className="cursor-pointer">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* Contact Identity */}
            <div className="p-4 border-b border-[#E2E8F0] space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-[#EFF6FF] text-[#2563EB] font-bold text-xs flex items-center justify-center shrink-0">
                  {getInitials(activeContact.fullName)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#0F172A] truncate">
                    {activeContact.fullName}
                  </p>
                  <p className="text-xs font-mono text-slate-500 truncate">
                    {activeContact.phoneE164}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 text-xs">
                <div>
                  <p className="font-medium text-[#0F172A]">Marketing Opt-In</p>
                  <p className="text-[11px] text-slate-500">
                    {activeContact.marketingOptIn ? 'Explicitly consented' : 'Not opted in'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleOptIn}
                  aria-label="Toggle Marketing Opt-In"
                  className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${
                    activeContact.marketingOptIn ? 'bg-emerald-600' : 'bg-slate-200'
                  }`}
                >
                  <span
                    className={`block h-4 w-4 rounded-full bg-white shadow-2xs transition-transform ${
                      activeContact.marketingOptIn ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Editable Custom Parameters / Contact Info */}
            <div className="p-4 border-b border-[#E2E8F0] space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <p className="font-bold text-[#0F172A]">Contact Attributes</p>
                <button
                  type="button"
                  onClick={() => setEditingDetails((v) => !v)}
                  className="text-[11px] font-semibold text-[#2563EB] hover:underline cursor-pointer"
                >
                  {editingDetails ? 'Cancel' : 'Edit'}
                </button>
              </div>

              {editingDetails ? (
                <form onSubmit={handleSaveCustomDetails} className="space-y-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">Email</label>
                    <input
                      type="email"
                      value={detailEmail}
                      onChange={(e) => setDetailEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="w-full rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">Company</label>
                    <input
                      type="text"
                      value={detailCompany}
                      onChange={(e) => setDetailCompany(e.target.value)}
                      placeholder="Company name"
                      className="w-full rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">City</label>
                    <input
                      type="text"
                      value={detailCity}
                      onChange={(e) => setDetailCity(e.target.value)}
                      placeholder="City"
                      className="w-full rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-[#2563EB] py-1.5 font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                  >
                    Save Attributes
                  </button>
                </form>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 flex items-center gap-1">
                      <Phone className="h-3 w-3" /> Phone
                    </span>
                    <span className="font-mono text-[#0F172A]">{activeContact.phoneE164}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">Email</span>
                    <span className="text-[#0F172A] truncate">{activeContact.email || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">Company</span>
                    <span className="text-[#0F172A] truncate">{activeContact.company || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">City</span>
                    <span className="text-[#0F172A] truncate">{activeContact.city || '—'}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Tags */}
            <div className="p-4 border-b border-[#E2E8F0] space-y-2.5 text-xs">
              <p className="font-bold text-[#0F172A] flex items-center gap-1.5">
                <TagIcon className="h-3.5 w-3.5 text-[#2563EB]" /> Tags
              </p>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => {
                    const selected = activeContact.tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleContactTag(tag.id)}
                        className={`px-2 py-1 rounded-md text-[11px] font-medium border cursor-pointer ${
                          selected
                            ? 'bg-[#EFF6FF] border-[#2563EB] text-[#2563EB]'
                            : 'bg-[#F8FAFC] border-[#E2E8F0] text-slate-600 hover:bg-[#F1F5F9]'
                        }`}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddInlineTag();
                    }
                  }}
                  placeholder="Add tag..."
                  className="flex-1 rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={handleAddInlineTag}
                  className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1.5 font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Comments / Notes */}
            <div className="p-4 border-b border-[#E2E8F0] space-y-2.5 text-xs">
              <p className="font-bold text-[#0F172A]">Comments &amp; Notes</p>
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 text-slate-700 whitespace-pre-wrap leading-relaxed min-h-[64px]">
                {activeContact.notes || 'No notes recorded yet.'}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveContactNote();
                    }
                  }}
                  placeholder="Add internal comment..."
                  className="flex-1 rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={handleSaveContactNote}
                  className="rounded-lg bg-[#0F172A] px-3 py-1.5 font-semibold text-white hover:bg-slate-800 cursor-pointer"
                >
                  Save
                </button>
              </div>
            </div>

            {/* Conversation Metadata */}
            <div className="p-4 space-y-1.5 text-[11px] text-slate-500">
              <p className="font-bold text-xs text-[#0F172A] mb-1">Conversation Info</p>
              <div className="flex justify-between">
                <span>Status</span>
                <span className="capitalize font-medium text-[#0F172A]">
                  {activeConversation.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span>24h Window</span>
                <span className="font-medium text-[#0F172A]">
                  {windowStatus.isOpen ? windowStatus.label : 'Closed'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Created</span>
                <span className="tabular-nums">
                  {new Date(activeContact.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Start New Conversation Picker Modal */}
      {newChatModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          onClick={() => setNewChatModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[#E2E8F0] bg-white shadow-luxury-hover overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3.5 border-b border-[#E2E8F0] flex items-center justify-between">
              <div>
                <h3 className="font-display text-sm font-bold text-[#0F172A]">
                  Start a New Conversation
                </h3>
                <p className="text-[11px] text-slate-500">
                  Select a contact to open their WhatsApp thread
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNewChatModalOpen(false)}
                className="p-1 text-slate-400 hover:text-[#0F172A] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3 border-b border-[#E2E8F0]">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={newChatSearch}
                  onChange={(e) => setNewChatSearch(e.target.value)}
                  placeholder="Search contacts by name or phone..."
                  className="w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-8 pr-3 py-2 text-xs focus:border-[#2563EB] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto divide-y divide-[#E2E8F0]">
              {contactsForNewChat.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 space-y-2">
                  <p>No contacts available matching your search.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setNewChatModalOpen(false);
                      navigate('/app/contacts', { state: { openAdd: true } });
                    }}
                    className="font-semibold text-[#2563EB] hover:underline cursor-pointer"
                  >
                    + Add a Contact
                  </button>
                </div>
              ) : (
                contactsForNewChat.map((ct) => (
                  <button
                    key={ct.id}
                    type="button"
                    onClick={() => handleStartChatWithContact(ct.id)}
                    className="w-full text-left px-4 py-2.5 hover:bg-[#F1F5F9] flex items-center justify-between gap-3 cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#0F172A] truncate">
                        {ct.fullName}
                      </p>
                      <p className="text-[11px] font-mono text-slate-500">{ct.phoneE164}</p>
                    </div>
                    <span className="text-[11px] font-semibold text-[#2563EB] shrink-0">
                      Open Chat
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Template Picker Modal */}
      {templateModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          onClick={() => setTemplateModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-[#E2E8F0] bg-white shadow-luxury-hover overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div>
                <h3 className="font-display text-sm font-bold text-[#0F172A]">
                  Choose Approved Template
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Send a pre-approved Meta WhatsApp template message
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTemplateModalOpen(false)}
                className="cursor-pointer"
              >
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>

            <div className="p-4 space-y-2.5 max-h-96 overflow-y-auto">
              {approvedTemplates.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">
                  No approved templates available yet. Sync your templates from Meta in Templates.
                </p>
              ) : (
                approvedTemplates.map((tpl) => {
                  const isSelected = selectedTemplateId === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(tpl.id)}
                      className={`w-full text-left rounded-lg border p-3 transition-colors cursor-pointer ${
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

            <div className="px-5 py-3 border-t border-[#E2E8F0] flex items-center justify-end gap-2 bg-[#F8FAFC]">
              <button
                type="button"
                onClick={() => setTemplateModalOpen(false)}
                className="rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!selectedTemplateId || isSending}
                onClick={handleSendTemplate}
                className="rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 cursor-pointer"
              >
                {isSending ? 'Sending...' : 'Send Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
