import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  Download,
  Edit3,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import {
  formatPhoneDisplay,
  formatRelativeTime,
  normalizePhoneE164,
  parseContactsCsv,
  type ParsedCsvRow,
} from '@/lib/phone';
import { tableHasConfirmedColumn } from '@/services/crmPersistenceService';
import type { Contact } from '@/types/crm';

const QUICK_ADD_DRAFT_KEY = 'zoqniva_quick_add_contact_draft';

const COUNTRY_CODES = [
  { code: '1', label: 'US / CA (+1)' },
  { code: '91', label: 'IN (+91)' },
  { code: '971', label: 'AE (+971)' },
  { code: '44', label: 'UK (+44)' },
  { code: '966', label: 'SA (+966)' },
  { code: '65', label: 'SG (+65)' },
  { code: '61', label: 'AU (+61)' },
  { code: '', label: 'Full (+Code)' },
];

type SortOption = 'name_asc' | 'name_desc' | 'newest' | 'oldest';

export function ContactsPage() {
  const {
    contacts,
    conversations,
    tags,
    workspaceLoading,
    addContact,
    updateContact,
    deleteContact,
    bulkTagContacts,
    importContactsBatch,
    createTag,
    openOrCreateConversationForContact,
  } = useApp();

  const navigate = useNavigate();
  const location = useLocation();

  const [searchQuery, setSearchQuery] = useState('');
  const [segmentFilter, setSegmentFilter] = useState<'all' | 'opted_in' | 'opted_out'>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkTagId, setBulkTagId] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<12 | 25 | 50>(12);

  // Side Drawer (Single Contact | Bulk Upload tabs)
  const [formDrawerOpen, setFormDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'single' | 'bulk'>('single');
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [showCustomParams, setShowCustomParams] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);

  // Contact Form State — marketing consent MUST default to false on creation
  const [formName, setFormName] = useState('');
  const [countryCode, setCountryCode] = useState('1');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formCountry, setFormCountry] = useState('');
  const [formOptIn, setFormOptIn] = useState(false);
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const [savingContact, setSavingContact] = useState(false);
  const [deletingContact, setDeletingContact] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [actionBanner, setActionBanner] = useState<{ ok: boolean; text: string } | null>(null);

  // CSV Bulk Upload State
  const [csvText, setCsvText] = useState('');
  const [csvPreviewRows, setCsvPreviewRows] = useState<ParsedCsvRow[]>([]);
  const [importFeedback, setImportFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const supportsCityColumn = tableHasConfirmedColumn('contacts', 'city');

  useEffect(() => {
    const state = location.state as { openAdd?: boolean } | null;
    if (state?.openAdd) {
      openAddDrawer('single');
    }
  }, [location.state]);

  // Persist unfinished quick-add draft
  useEffect(() => {
    if (formDrawerOpen && drawerTab === 'single' && !editingContact) {
      localStorage.setItem(
        QUICK_ADD_DRAFT_KEY,
        JSON.stringify({ formName, formPhone, countryCode, formEmail, formNotes })
      );
    }
  }, [formDrawerOpen, drawerTab, editingContact, formName, formPhone, countryCode, formEmail, formNotes]);

  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = contacts.filter((c) => {
      if (segmentFilter === 'opted_in' && !c.marketingOptIn) return false;
      if (segmentFilter === 'opted_out' && c.marketingOptIn) return false;
      if (tagFilter !== 'all' && !c.tagIds.includes(tagFilter)) return false;

      if (!q) return true;
      return (
        c.fullName.toLowerCase().includes(q) ||
        c.phoneE164.includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q)
      );
    });

    return list.sort((a, b) => {
      if (sortBy === 'name_asc') return a.fullName.localeCompare(b.fullName);
      if (sortBy === 'name_desc') return b.fullName.localeCompare(a.fullName);
      if (sortBy === 'oldest') {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [contacts, searchQuery, segmentFilter, tagFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedContacts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredContacts.slice(start, start + pageSize);
  }, [filteredContacts, currentPage, pageSize]);

  const openAddDrawer = (initialTab: 'single' | 'bulk' = 'single') => {
    setEditingContact(null);
    setDrawerTab(initialTab);
    setImportFeedback(null);
    try {
      const saved = JSON.parse(localStorage.getItem(QUICK_ADD_DRAFT_KEY) || 'null');
      setFormName(saved?.formName ?? '');
      setFormPhone(saved?.formPhone ?? '');
      setCountryCode(saved?.countryCode ?? '1');
      setFormEmail(saved?.formEmail ?? '');
      setFormNotes(saved?.formNotes ?? '');
    } catch {
      setFormName('');
      setFormPhone('');
      setCountryCode('1');
      setFormEmail('');
      setFormNotes('');
    }
    setFormCompany('');
    setFormCity('');
    setFormCountry('');
    // Explicit requirement: never auto-enable marketing consent on new contact creation
    setFormOptIn(false);
    setFormTags([]);
    setShowCustomParams(false);
    setFormError(null);
    setFormDrawerOpen(true);
  };

  const openEditDrawer = (c: Contact) => {
    setEditingContact(c);
    setDrawerTab('single');
    setFormName(c.fullName);
    setCountryCode('');
    setFormPhone(c.phoneE164);
    setFormEmail(c.email);
    setFormCompany(c.company);
    setFormCity(c.city);
    setFormCountry(c.country);
    setFormOptIn(c.marketingOptIn);
    setFormTags(c.tagIds);
    setFormNotes(c.notes);
    setShowCustomParams(true);
    setFormError(null);
    setFormDrawerOpen(true);
  };

  const normalizedPhonePreview = useMemo(() => {
    if (!formPhone.trim()) return null;
    if (formPhone.trim().startsWith('+') || !countryCode) {
      return normalizePhoneE164(formPhone);
    }
    const digits = formPhone.replace(/\D/g, '').replace(/^0+/, '');
    if (!digits) return null;
    return normalizePhoneE164(`+${countryCode}${digits}`, countryCode);
  }, [formPhone, countryCode]);

  const duplicateMatch = useMemo(
    () =>
      normalizedPhonePreview
        ? contacts.find(
            (c) => c.phoneE164 === normalizedPhonePreview && c.id !== editingContact?.id
          )
        : undefined,
    [normalizedPhonePreview, contacts, editingContact?.id]
  );

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingContact) return;
    setFormError(null);

    if (!formName.trim()) {
      setFormError('Please enter the contact full name.');
      return;
    }

    const finalPhone = normalizedPhonePreview ?? formPhone;
    setSavingContact(true);

    try {
      if (editingContact) {
        const res = await updateContact(editingContact.id, {
          fullName: formName.trim(),
          phoneE164: finalPhone,
          email: formEmail.trim(),
          company: formCompany.trim(),
          ...(supportsCityColumn ? { city: formCity.trim() } : {}),
          country: formCountry.trim(),
          marketingOptIn: formOptIn,
          tagIds: formTags,
          notes: formNotes.trim(),
        });
        if (!res.ok) {
          setFormError(res.error ?? 'Could not save contact changes.');
          return;
        }
        setFormDrawerOpen(false);
        setActionBanner({
          ok: true,
          text: `Saved changes for ${res.contact?.fullName ?? formName.trim()}.`,
        });
      } else {
        const res = await addContact({
          fullName: formName,
          phone: finalPhone,
          email: formEmail,
          company: formCompany,
          ...(supportsCityColumn ? { city: formCity } : {}),
          country: formCountry,
          marketingOptIn: formOptIn,
          tagIds: formTags,
          notes: formNotes,
        });
        if (!res.ok || !res.contact) {
          // Retain all entered form details on error
          setFormError(res.error ?? 'Could not add contact.');
          return;
        }
        localStorage.removeItem(QUICK_ADD_DRAFT_KEY);
        setFormDrawerOpen(false);
        setActionBanner({
          ok: true,
          text: res.warning
            ? `Saved ${res.contact.fullName} (${res.contact.phoneE164}). ${res.warning}`
            : `Saved ${res.contact.fullName} (${res.contact.phoneE164}) to Supabase.`,
        });
      }
    } finally {
      setSavingContact(false);
    }
  };

  const handleCreateInlineTag = async () => {
    if (!newTagName.trim() || creatingTag) return;
    setCreatingTag(true);
    setFormError(null);
    try {
      const res = await createTag(newTagName, '#2563EB');
      if (!res.ok || !res.tag) {
        setFormError(res.error ?? 'Could not create tag in Supabase.');
        return;
      }
      if (!formTags.includes(res.tag.id)) {
        setFormTags((prev) => [...prev, res.tag!.id]);
      }
      setNewTagName('');
    } finally {
      setCreatingTag(false);
    }
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = paginatedContacts.map((c) => c.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const handleApplyBulkTag = async () => {
    if (!bulkTagId || selectedIds.length === 0) return;
    const res = await bulkTagContacts(selectedIds, bulkTagId);
    if (!res.ok) {
      setActionBanner({ ok: false, text: res.error ?? 'Could not apply tag to contacts.' });
      return;
    }
    const count = selectedIds.length;
    setBulkTagId('');
    setSelectedIds([]);
    setActionBanner({
      ok: true,
      text: `Applied tag to ${count} contact${count === 1 ? '' : 's'}.`,
    });
  };

  const handleExportCsv = () => {
    const rows = [
      ['Full Name', 'WhatsApp Number', 'Email', 'Company', 'City', 'Country', 'Marketing Opt-In', 'Tags'],
      ...filteredContacts.map((c) => [
        c.fullName,
        c.phoneE164,
        c.email,
        c.company,
        c.city,
        c.country,
        c.marketingOptIn ? 'Yes' : 'No',
        c.tagIds.map((tid) => tags.find((t) => t.id === tid)?.name ?? '').filter(Boolean).join('; '),
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zoqniva-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleParseCsv = (raw: string) => {
    setCsvText(raw);
    setImportFeedback(null);
    const existing = new Set(contacts.map((c) => c.phoneE164));
    const parsed = parseContactsCsv(raw, existing);
    // Ensure CSV rows without explicit opt-in column do NOT auto-opt-in
    const hasOptInHeader =
      raw.split(/\r?\n/)[0]?.toLowerCase().match(/(optin|opt_in|opt in|marketing|consent)/) !== null;
    setCsvPreviewRows(
      hasOptInHeader ? parsed : parsed.map((row) => ({ ...row, marketingOptIn: false }))
    );
  };

  const handleConfirmCsvImport = async () => {
    const valid = csvPreviewRows.filter((r) => !r.error && r.normalizedPhone);
    if (valid.length === 0 || importingCsv) return;
    setImportingCsv(true);
    setImportFeedback(null);
    try {
      const res = await importContactsBatch(
        valid.map((v) => ({
          fullName: v.fullName,
          phoneE164: v.normalizedPhone!,
          email: v.email,
          company: v.company,
          city: v.city,
          country: v.country,
          marketingOptIn: v.marketingOptIn,
        }))
      );
      if (!res.ok) {
        setImportFeedback({
          ok: false,
          text: res.error ?? 'Could not import contacts to Supabase.',
        });
        return;
      }
      setImportFeedback({
        ok: true,
        text: `Saved ${res.importedCount} contact${res.importedCount === 1 ? '' : 's'} to Supabase.`,
      });
      setCsvPreviewRows([]);
      setCsvText('');
    } finally {
      setImportingCsv(false);
    }
  };

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  return (
    <div className="p-4 sm:p-6 pb-20 lg:pb-8 max-w-[1520px] mx-auto space-y-5">
      {/* Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-xl font-bold text-[#0F172A] tracking-tight">
              Contacts
            </h2>
            <span className="text-xs font-medium text-slate-500 tabular-nums">
              {contacts.length} total
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage WhatsApp customers, explicit broadcast consent, and audience tags.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openAddDrawer('bulk')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5 text-[#2563EB]" />
            <span>Import CSV</span>
          </button>

          {contacts.length > 0 && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-slate-500" />
              <span>Export</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => openAddDrawer('single')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Contact</span>
          </button>
        </div>
      </div>

      {actionBanner && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs flex items-center justify-between gap-2 ${
            actionBanner.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-[#E11D48]/30 bg-rose-50 text-[#E11D48]'
          }`}
        >
          <span className="flex items-center gap-2 font-medium">
            {actionBanner.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {actionBanner.text}
          </span>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            className="cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {workspaceLoading && contacts.length === 0 ? (
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-12 text-center space-y-2.5">
          <Loader2 className="h-6 w-6 text-[#2563EB] animate-spin mx-auto" />
          <p className="text-xs font-medium text-slate-500">Loading contacts directory...</p>
        </div>
      ) : contacts.length === 0 ? (
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-10 text-center space-y-3">
          <div className="h-12 w-12 rounded-xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center mx-auto">
            <UserPlus className="h-6 w-6" />
          </div>
          <h3 className="font-display text-base font-bold text-[#0F172A]">No contacts yet</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            Add your first contact manually or upload a CSV file with international phone numbers in E.164 format.
          </p>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => openAddDrawer('single')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Contact</span>
            </button>
            <button
              type="button"
              onClick={() => openAddDrawer('bulk')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5 text-[#2563EB]" />
              <span>Bulk Upload CSV</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Filter, Sort & Search Controls */}
          <div className="rounded-xl border border-[#E2E8F0] bg-white p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Sort contacts"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1.5 text-xs font-medium text-[#0F172A] cursor-pointer"
              >
                <option value="newest">Sort: Newest First</option>
                <option value="oldest">Sort: Oldest First</option>
                <option value="name_asc">Sort: Name (A–Z)</option>
                <option value="name_desc">Sort: Name (Z–A)</option>
              </select>

              <select
                aria-label="Filter by tag"
                value={tagFilter}
                onChange={(e) => {
                  setTagFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1.5 text-xs font-medium text-[#0F172A] cursor-pointer"
              >
                <option value="all">All Tags</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              <div className="inline-flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-0.5">
                {(
                  [
                    { key: 'all', label: 'All' },
                    { key: 'opted_in', label: 'Opted In' },
                    { key: 'opted_out', label: 'Not Opted In' },
                  ] as const
                ).map((seg) => (
                  <button
                    key={seg.key}
                    type="button"
                    onClick={() => {
                      setSegmentFilter(seg.key);
                      setPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                      segmentFilter === seg.key
                        ? 'bg-white text-[#2563EB] shadow-2xs font-semibold'
                        : 'text-slate-600 hover:text-[#0F172A]'
                    }`}
                  >
                    {seg.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative w-full lg:w-72">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by name, phone, or email..."
                className="w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-8 pr-3 py-1.5 text-xs focus:border-[#2563EB] focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          {/* Bulk Selection Toolbar */}
          {selectedIds.length > 0 && (
            <div className="rounded-xl border border-[#2563EB]/30 bg-[#EFF6FF]/60 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-[#0F172A] tabular-nums">
                {selectedIds.length} contact{selectedIds.length === 1 ? '' : 's'} selected
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={bulkTagId}
                  onChange={(e) => setBulkTagId(e.target.value)}
                  className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="">Apply tag...</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!bulkTagId}
                  onClick={handleApplyBulkTag}
                  className="rounded-lg bg-[#2563EB] px-3 py-1.5 font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 cursor-pointer"
                >
                  Apply Tag
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="text-slate-600 hover:underline px-2 cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2.5">
            {paginatedContacts.length === 0 ? (
              <div className="rounded-xl border border-[#E2E8F0] bg-white p-8 text-center text-xs text-slate-500">
                No contacts match your current filter.
              </div>
            ) : (
              paginatedContacts.map((c) => {
                const contactTags = c.tagIds
                  .map((tid) => tags.find((t) => t.id === tid)?.name)
                  .filter(Boolean);
                const conv = conversations.find((cv) => cv.contactId === c.id);
                const lastTouch = c.lastContactedAt || conv?.lastMessageAt;
                return (
                  <div
                    key={c.id}
                    className="rounded-xl border border-[#E2E8F0] bg-white p-4 space-y-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-[#EFF6FF] text-[#2563EB] font-bold text-xs flex items-center justify-center shrink-0">
                          {getInitials(c.fullName)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[#0F172A] text-sm truncate">
                            {c.fullName}
                          </p>
                          <p className="font-mono text-slate-500 truncate">
                            {formatPhoneDisplay(c.phoneE164)}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`font-semibold text-[11px] shrink-0 ${
                          c.marketingOptIn ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        {c.marketingOptIn ? 'Opted In' : 'Not Opted In'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-2 border-t border-[#E2E8F0]">
                      <span>{contactTags.length > 0 ? contactTags.join(', ') : 'No tags'}</span>
                      <span className="tabular-nums">
                        {lastTouch ? `Active ${formatRelativeTime(lastTouch)}` : 'No messages yet'}
                      </span>
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          openOrCreateConversationForContact(c.id);
                          navigate('/app/inbox');
                        }}
                        className="font-semibold text-[#2563EB] cursor-pointer"
                      >
                        Message
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditDrawer(c)}
                        className="font-semibold text-slate-700 cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(c)}
                        className="font-semibold text-[#E11D48] cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Contacts Table */}
          <div className="hidden md:block rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4 w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all contacts on page"
                        checked={
                          paginatedContacts.length > 0 &&
                          paginatedContacts.every((c) => selectedIds.includes(c.id))
                        }
                        onChange={toggleSelectAllOnPage}
                        className="rounded border-slate-300 accent-[#2563EB]"
                      />
                    </th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4">WhatsApp Number</th>
                    <th className="py-3 px-4">Tags</th>
                    <th className="py-3 px-4">WhatsApp Status</th>
                    <th className="py-3 px-4">Marketing Opt-In</th>
                    <th className="py-3 px-4">Last Interaction</th>
                    <th className="py-3 px-4">Created</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-xs">
                  {paginatedContacts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-500">
                        No contacts match your current search or filter.
                      </td>
                    </tr>
                  ) : (
                    paginatedContacts.map((c) => {
                      const contactTagNames = c.tagIds
                        .map((tid) => tags.find((t) => t.id === tid)?.name)
                        .filter((v): v is string => Boolean(v));
                      const conv = conversations.find((cv) => cv.contactId === c.id);
                      const lastTouch = c.lastContactedAt || conv?.lastMessageAt;
                      const isWhatsAppActive = Boolean(conv || c.lastContactedAt);

                      return (
                        <tr key={c.id} className="hover:bg-[#F8FAFC] transition-colors">
                          <td className="py-3 px-4">
                            <input
                              type="checkbox"
                              aria-label={`Select ${c.fullName}`}
                              checked={selectedIds.includes(c.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedIds((p) => [...p, c.id]);
                                } else {
                                  setSelectedIds((p) => p.filter((id) => id !== c.id));
                                }
                              }}
                              className="rounded border-slate-300 accent-[#2563EB]"
                            />
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <div className="h-8 w-8 rounded-full bg-[#EFF6FF] text-[#2563EB] font-bold text-[11px] flex items-center justify-center shrink-0">
                                {getInitials(c.fullName)}
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-[#0F172A] truncate">
                                  {c.fullName}
                                </p>
                                {(c.company || c.email) && (
                                  <p className="text-[11px] text-slate-500 truncate">
                                    {c.company || c.email}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono text-[#0F172A] tabular-nums whitespace-nowrap">
                            {formatPhoneDisplay(c.phoneE164)}
                          </td>
                          <td className="py-3 px-4">
                            {contactTagNames.length === 0 ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              <span className="text-slate-700 font-medium">
                                {contactTagNames.slice(0, 2).join(' · ')}
                                {contactTagNames.length > 2 && (
                                  <span className="text-slate-400"> +{contactTagNames.length - 2}</span>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1.5 font-medium ${
                                isWhatsAppActive ? 'text-emerald-700' : 'text-slate-500'
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  isWhatsAppActive ? 'bg-emerald-600' : 'bg-slate-400'
                                }`}
                              />
                              {isWhatsAppActive ? 'Messaged' : 'Not verified'}
                            </span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`font-semibold ${
                                c.marketingOptIn ? 'text-emerald-700' : 'text-slate-500'
                              }`}
                            >
                              {c.marketingOptIn ? 'Opted In' : 'Not Opted In'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-500 tabular-nums whitespace-nowrap">
                            {lastTouch ? formatRelativeTime(lastTouch) : '—'}
                          </td>
                          <td className="py-3 px-4 text-slate-500 tabular-nums whitespace-nowrap">
                            {new Date(c.createdAt).toLocaleDateString('en-GB', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  openOrCreateConversationForContact(c.id);
                                  navigate('/app/inbox');
                                }}
                                title="Open in Inbox"
                                className="p-1.5 rounded-md text-[#2563EB] hover:bg-[#EFF6FF] cursor-pointer"
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditDrawer(c)}
                                title="Edit contact"
                                className="p-1.5 rounded-md text-slate-500 hover:bg-[#F1F5F9] hover:text-[#0F172A] cursor-pointer"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(c)}
                                title="Delete contact"
                                className="p-1.5 rounded-md text-slate-400 hover:bg-rose-50 hover:text-[#E11D48] cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer Pagination with Page Size Selector */}
            <div className="px-4 py-3 border-t border-[#E2E8F0] bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
              <span className="tabular-nums">
                {selectedIds.length} of {paginatedContacts.length} row(s) selected ·{' '}
                {filteredContacts.length} total
              </span>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span>Rows per page</span>
                  <select
                    aria-label="Rows per page"
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value) as 12 | 25 | 50);
                      setPage(1);
                    }}
                    className="rounded-md border border-[#E2E8F0] bg-white px-2 py-1 text-xs font-medium cursor-pointer"
                  >
                    <option value={12}>12</option>
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
                    className="rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 font-medium hover:bg-[#F1F5F9] disabled:opacity-50 cursor-pointer"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 font-medium hover:bg-[#F1F5F9] disabled:opacity-50 cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Right Slide-Over Drawer: Single Contact | Bulk Upload */}
      {formDrawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex justify-end"
          onClick={() => setFormDrawerOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white h-full shadow-2xl border-l border-[#E2E8F0] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[#0F172A]">
                {editingContact ? 'Edit Contact' : 'Add Contact'}
              </h3>
              <button
                type="button"
                onClick={() => setFormDrawerOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:bg-[#F1F5F9] hover:text-[#0F172A] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!editingContact && (
              <div className="px-5 pt-3">
                <div className="grid grid-cols-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setDrawerTab('single')}
                    className={`py-1.5 rounded-md font-semibold cursor-pointer transition-colors ${
                      drawerTab === 'single'
                        ? 'bg-white text-[#2563EB] shadow-2xs border border-[#E2E8F0]'
                        : 'text-slate-600 hover:text-[#0F172A]'
                    }`}
                  >
                    Single Contact
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerTab('bulk')}
                    className={`py-1.5 rounded-md font-semibold cursor-pointer transition-colors ${
                      drawerTab === 'bulk'
                        ? 'bg-white text-[#2563EB] shadow-2xs border border-[#E2E8F0]'
                        : 'text-slate-600 hover:text-[#0F172A]'
                    }`}
                  >
                    Bulk Upload
                  </button>
                </div>
              </div>
            )}

            {drawerTab === 'single' ? (
              <form
                onSubmit={handleSaveContact}
                className="flex-1 overflow-y-auto p-5 space-y-4 text-xs"
              >
                {formError && (
                  <div className="rounded-lg border border-[#E11D48]/30 bg-rose-50 px-3 py-2.5 text-[#E11D48]">
                    {formError}
                  </div>
                )}

                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">
                    Name <span className="text-[#E11D48]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Enter full name"
                    className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">
                    WhatsApp Number <span className="text-[#E11D48]">*</span>
                  </label>
                  <div className="flex rounded-lg border border-[#E2E8F0] overflow-hidden focus-within:border-[#2563EB]">
                    <select
                      aria-label="Country code"
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="bg-[#F8FAFC] border-r border-[#E2E8F0] px-2.5 py-2 text-xs font-medium text-[#0F172A] focus:outline-none"
                    >
                      {COUNTRY_CODES.map((c) => (
                        <option key={c.label} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      required
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder={countryCode ? '555 000 0000' : '+1 555 000 0000'}
                      className="flex-1 px-3 py-2 text-sm font-mono focus:outline-none"
                    />
                  </div>
                  {formPhone && (
                    <p className="mt-1 text-[11px]">
                      {duplicateMatch ? (
                        <span className="text-[#E11D48] font-medium">
                          Duplicate number: already saved as {duplicateMatch.fullName}
                        </span>
                      ) : normalizedPhonePreview ? (
                        <span className="text-emerald-700 font-medium">
                          E.164 normalized: {normalizedPhonePreview}
                        </span>
                      ) : (
                        <span className="text-slate-500">
                          Enter a valid international number (7–15 digits)
                        </span>
                      )}
                    </p>
                  )}
                </div>

                {/* Contact Tags */}
                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1.5">
                    Contact Tags
                  </label>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {tags.map((t) => {
                        const active = formTags.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() =>
                              setFormTags((prev) =>
                                active ? prev.filter((x) => x !== t.id) : [...prev, t.id]
                              )
                            }
                            className={`px-2.5 py-1 rounded-md border font-medium cursor-pointer ${
                              active
                                ? 'bg-[#EFF6FF] border-[#2563EB] text-[#2563EB]'
                                : 'bg-[#F8FAFC] border-[#E2E8F0] text-slate-600'
                            }`}
                          >
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      placeholder="Create new tag..."
                      className="flex-1 rounded-lg border border-[#E2E8F0] px-2.5 py-1.5"
                    />
                    <button
                      type="button"
                      disabled={creatingTag || !newTagName.trim()}
                      onClick={handleCreateInlineTag}
                      className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 font-semibold text-[#0F172A] hover:bg-[#F1F5F9] disabled:opacity-50 cursor-pointer"
                    >
                      {creatingTag ? (
                        <Loader2 className="h-3.5 w-3.5 inline animate-spin" />
                      ) : (
                        <>
                          <Plus className="h-3.5 w-3.5 inline" /> Add
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Collapsed Custom Parameters & Additional Info by default */}
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
                  <button
                    type="button"
                    onClick={() => setShowCustomParams((v) => !v)}
                    className="w-full px-3 py-2.5 flex items-center justify-between font-semibold text-[#0F172A] cursor-pointer"
                  >
                    <span>Custom Parameters &amp; Notes</span>
                    <ChevronDown
                      className={`h-4 w-4 text-slate-400 transition-transform ${
                        showCustomParams ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {showCustomParams && (
                    <div className="p-3 pt-2 border-t border-[#E2E8F0] space-y-3 bg-white rounded-b-lg">
                      <div>
                        <label className="block font-semibold text-[#0F172A] mb-1">Email</label>
                        <input
                          type="email"
                          value={formEmail}
                          onChange={(e) => setFormEmail(e.target.value)}
                          placeholder="name@company.com"
                          className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2"
                        />
                      </div>
                      <div className={supportsCityColumn ? 'grid grid-cols-2 gap-2.5' : ''}>
                        <div>
                          <label className="block font-semibold text-[#0F172A] mb-1">Company</label>
                          <input
                            type="text"
                            value={formCompany}
                            onChange={(e) => setFormCompany(e.target.value)}
                            className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2"
                          />
                        </div>
                        {supportsCityColumn && (
                          <div>
                            <label className="block font-semibold text-[#0F172A] mb-1">City</label>
                            <input
                              type="text"
                              value={formCity}
                              onChange={(e) => setFormCity(e.target.value)}
                              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2"
                            />
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block font-semibold text-[#0F172A] mb-1">Notes</label>
                        <textarea
                          rows={2}
                          value={formNotes}
                          onChange={(e) => setFormNotes(e.target.value)}
                          placeholder="Customer preferences or internal context..."
                          className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Explicit Marketing Consent Checkbox — defaults to false */}
                <label className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formOptIn}
                    onChange={(e) => setFormOptIn(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 accent-[#2563EB]"
                  />
                  <span>
                    <span className="block font-semibold text-[#0F172A]">
                      Explicit Marketing Opt-In
                    </span>
                    <span className="block text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                      Enable only if this contact explicitly agreed to receive WhatsApp broadcast campaigns.
                    </span>
                  </span>
                </label>

                <div className="pt-3 flex items-center justify-between gap-2 border-t border-[#E2E8F0]">
                  {editingContact ? (
                    <button
                      type="button"
                      onClick={() => {
                        openOrCreateConversationForContact(editingContact.id);
                        setFormDrawerOpen(false);
                        navigate('/app/inbox');
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Open Chat
                    </button>
                  ) : (
                    <span />
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFormDrawerOpen(false)}
                      className="rounded-lg border border-[#E2E8F0] px-3.5 py-2 font-semibold text-slate-700 hover:bg-[#F1F5F9] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingContact || Boolean(duplicateMatch)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 cursor-pointer"
                    >
                      {savingContact && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>
                        {savingContact
                          ? 'Saving...'
                          : editingContact
                          ? 'Save Changes'
                          : 'Add Contact'}
                      </span>
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              /* Bulk Upload Tab inside Right Drawer */
              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
                {importFeedback && (
                  <div
                    className={`rounded-lg border px-3 py-2.5 font-medium ${
                      importFeedback.ok
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-[#E11D48]/30 bg-rose-50 text-[#E11D48]'
                    }`}
                  >
                    {importFeedback.text}
                  </div>
                )}

                <div className="rounded-lg border border-dashed border-[#E2E8F0] bg-[#F8FAFC] p-4 text-center space-y-2.5">
                  <Upload className="h-5 w-5 text-[#2563EB] mx-auto" />
                  <p className="font-semibold text-[#0F172A]">Upload CSV contact list</p>
                  <p className="text-[11px] text-slate-500">
                    Supported columns: Name, Phone, Email, Company, Opt In. Contacts without an explicit Opt-In column default to Not Opted In.
                  </p>
                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 font-semibold text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer">
                    <span>Choose CSV File</span>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => handleParseCsv(String(reader.result ?? ''));
                        reader.readAsText(file);
                      }}
                    />
                  </label>
                </div>

                <div>
                  <label className="block font-semibold text-[#0F172A] mb-1">
                    Or paste CSV rows directly
                  </label>
                  <textarea
                    rows={4}
                    value={csvText}
                    onChange={(e) => handleParseCsv(e.target.value)}
                    placeholder="Name, Phone, Email&#10;Jane Doe, +15551234567, jane@example.com"
                    className="w-full rounded-lg border border-[#E2E8F0] p-2.5 font-mono text-[11px] focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                {csvPreviewRows.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-semibold text-[#0F172A] tabular-nums">
                      {csvPreviewRows.filter((r) => !r.error).length} valid ·{' '}
                      {csvPreviewRows.filter((r) => Boolean(r.error)).length} skipped
                    </p>
                    <div className="border border-[#E2E8F0] rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                      <table className="w-full text-left border-collapse text-[11px]">
                        <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                          <tr>
                            <th className="p-2">Name</th>
                            <th className="p-2">Phone</th>
                            <th className="p-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8F0]">
                          {csvPreviewRows.map((row) => (
                            <tr key={row.rowIndex}>
                              <td className="p-2 font-medium truncate max-w-[110px]">
                                {row.fullName || '—'}
                              </td>
                              <td className="p-2 font-mono">{row.normalizedPhone || row.rawPhone}</td>
                              <td className="p-2">
                                {row.error ? (
                                  <span className="text-[#E11D48] font-medium">
                                    {row.isDuplicate ? 'Duplicate' : 'Invalid phone'}
                                  </span>
                                ) : (
                                  <span className="text-emerald-700 font-medium">Ready</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-[#E2E8F0] flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setFormDrawerOpen(false)}
                    className="rounded-lg border border-[#E2E8F0] px-3.5 py-2 font-semibold text-slate-700 cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    disabled={importingCsv || csvPreviewRows.filter((r) => !r.error).length === 0}
                    onClick={handleConfirmCsvImport}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 cursor-pointer"
                  >
                    {importingCsv ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckSquare className="h-3.5 w-3.5" />
                    )}
                    <span>{importingCsv ? 'Importing...' : 'Import Valid Rows'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          onClick={() => !deletingContact && setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-luxury-hover"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-base font-bold text-[#0F172A]">Delete Contact</h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Remove <strong>{deleteTarget.fullName}</strong> ({deleteTarget.phoneE164}) and their
              conversation history from your workspace?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deletingContact}
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-[#E2E8F0] px-3.5 py-2 text-xs font-semibold text-slate-700 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingContact}
                onClick={async () => {
                  const target = deleteTarget;
                  if (!target) return;
                  setDeletingContact(true);
                  try {
                    const res = await deleteContact(target.id);
                    setDeleteTarget(null);
                    if (!res.ok) {
                      setActionBanner({
                        ok: false,
                        text: res.error ?? 'Could not delete contact in Supabase.',
                      });
                    } else {
                      setActionBanner({
                        ok: true,
                        text: `Deleted ${target.fullName} (${target.phoneE164}).`,
                      });
                    }
                  } finally {
                    setDeletingContact(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#E11D48] px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                {deletingContact && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{deletingContact ? 'Deleting...' : 'Delete Contact'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
