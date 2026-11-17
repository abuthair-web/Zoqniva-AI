import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CheckSquare,
  ChevronDown,
  Download,
  Edit3,
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
  normalizePhoneE164,
  parseContactsCsv,
  type ParsedCsvRow,
} from '@/lib/phone';
import type { Contact } from '@/types/crm';

const QUICK_ADD_DRAFT_KEY = 'zoqniva_quick_add_contact_draft';

export function ContactsPage() {
  const {
    currentUser,
    contacts,
    tags,
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
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkTagId, setBulkTagId] = useState<string>('');
  const [page, setPage] = useState(1);

  // Side Drawers & Modals
  const [formDrawerOpen, setFormDrawerOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  // Contact Form State (preserves unfinished quick-add values)
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formCountry, setFormCountry] = useState('');
  const [formOptIn, setFormOptIn] = useState(true);
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');

  // CSV Import State
  const [csvText, setCsvText] = useState('');
  const [csvPreviewRows, setCsvPreviewRows] = useState<ParsedCsvRow[]>([]);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);

  useEffect(() => {
    const state = location.state as { openAdd?: boolean } | null;
    if (state?.openAdd) {
      openAddDrawer();
    }
  }, [location.state]);

  // Persist unfinished quick-add draft
  useEffect(() => {
    if (formDrawerOpen && !editingContact) {
      localStorage.setItem(
        QUICK_ADD_DRAFT_KEY,
        JSON.stringify({ formName, formPhone, formEmail, formNotes })
      );
    }
  }, [formDrawerOpen, editingContact, formName, formPhone, formEmail, formNotes]);

  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return contacts.filter((c) => {
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
  }, [contacts, searchQuery, segmentFilter, tagFilter]);

  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / pageSize));
  const paginatedContacts = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    return filteredContacts.slice(start, start + pageSize);
  }, [filteredContacts, page, totalPages]);

  const openAddDrawer = () => {
    setEditingContact(null);
    try {
      const saved = JSON.parse(localStorage.getItem(QUICK_ADD_DRAFT_KEY) || 'null');
      setFormName(saved?.formName ?? '');
      setFormPhone(saved?.formPhone ?? '');
      setFormEmail(saved?.formEmail ?? '');
      setFormNotes(saved?.formNotes ?? '');
    } catch {
      setFormName('');
      setFormPhone('');
      setFormEmail('');
      setFormNotes('');
    }
    setFormCompany('');
    setFormCity('');
    setFormCountry('');
    setFormOptIn(true);
    setFormTags([]);
    setShowOptionalFields(false);
    setFormError(null);
    setFormDrawerOpen(true);
  };

  const openEditDrawer = (c: Contact) => {
    setEditingContact(c);
    setFormName(c.fullName);
    setFormPhone(c.phoneE164);
    setFormEmail(c.email);
    setFormCompany(c.company);
    setFormCity(c.city);
    setFormCountry(c.country);
    setFormOptIn(c.marketingOptIn);
    setFormTags(c.tagIds);
    setFormNotes(c.notes);
    setShowOptionalFields(true);
    setFormError(null);
    setFormDrawerOpen(true);
  };

  const handleSaveContact = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formName.trim()) {
      setFormError('Please enter the customer name.');
      return;
    }

    if (editingContact) {
      const res = updateContact(editingContact.id, {
        fullName: formName.trim(),
        phoneE164: formPhone,
        email: formEmail.trim(),
        company: formCompany.trim(),
        city: formCity.trim(),
        country: formCountry.trim(),
        marketingOptIn: formOptIn,
        tagIds: formTags,
        notes: formNotes.trim(),
      });
      if (!res.ok) {
        setFormError(res.error ?? 'Could not save customer.');
        return;
      }
    } else {
      const res = addContact({
        fullName: formName,
        phone: formPhone,
        email: formEmail,
        company: formCompany,
        city: formCity,
        country: formCountry,
        marketingOptIn: formOptIn,
        tagIds: formTags,
        notes: formNotes,
      });
      if (!res.ok) {
        setFormError(res.error ?? 'Could not add customer.');
        return;
      }
      localStorage.removeItem(QUICK_ADD_DRAFT_KEY);
    }
    setFormDrawerOpen(false);
  };

  const handleCreateInlineTag = () => {
    if (!newTagName.trim()) return;
    const created = createTag(newTagName, '#2563EB');
    if (!formTags.includes(created.id)) {
      setFormTags((prev) => [...prev, created.id]);
    }
    setNewTagName('');
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = paginatedContacts.map((c) => c.id);
    const allSelected = pageIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const handleApplyBulkTag = () => {
    if (!bulkTagId || selectedIds.length === 0) return;
    bulkTagContacts(selectedIds, bulkTagId);
    setBulkTagId('');
    setSelectedIds([]);
  };

  const handleExportCsv = () => {
    const rows = [
      ['Full Name', 'WhatsApp Number', 'Email', 'Company', 'City', 'Country', 'Opted In', 'Groups'],
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
    a.download = `zoqniva-customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleParseCsv = (raw: string) => {
    setCsvText(raw);
    setImportFeedback(null);
    const existing = new Set(contacts.map((c) => c.phoneE164));
    setCsvPreviewRows(parseContactsCsv(raw, existing));
  };

  const handleConfirmCsvImport = () => {
    const valid = csvPreviewRows.filter((r) => !r.error && r.normalizedPhone);
    if (valid.length === 0) return;
    const count = importContactsBatch(
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
    setImportFeedback(`Added ${count} customers to your directory.`);
    setCsvPreviewRows([]);
    setCsvText('');
  };

  const normalizedPhonePreview = formPhone ? normalizePhoneE164(formPhone) : null;
  const duplicateMatch =
    normalizedPhonePreview &&
    contacts.find(
      (c) => c.phoneE164 === normalizedPhonePreview && c.id !== editingContact?.id
    );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1440px] mx-auto space-y-6 pb-20 lg:pb-8">
      {/* Header — One Clear Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-[2px] w-5 bg-[#F4B942]" />
            <span className="text-xs font-semibold text-[#2563EB]">Customer Directory</span>
          </div>
          <h2 className="font-display text-2xl font-bold text-[#0F172A] tracking-tight mt-0.5">
            Contacts
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {contacts.length} customers · Automatic phone verification and duplicate protection
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setImportFeedback(null);
              setImportModalOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5 text-[#2563EB]" />
            <span>Import Contacts</span>
          </button>
          {contacts.length > 0 && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-slate-500" />
              <span>Export</span>
            </button>
          )}
          <button
            type="button"
            onClick={openAddDrawer}
            className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer shadow-2xs"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Add Customer</span>
          </button>
        </div>
      </div>

      {contacts.length === 0 ? (
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-10 text-center shadow-2xs">
          <div className="h-12 w-12 rounded-2xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center mx-auto mb-4">
            <UserPlus className="h-6 w-6" />
          </div>
          <h3 className="font-display text-lg font-bold text-[#0F172A]">No customers added yet.</h3>
          <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto leading-relaxed">
            Add your first customer manually or import a CSV spreadsheet with international phone
            numbers to start organizing your directory.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={openAddDrawer}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Add Customer</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setImportFeedback(null);
                setImportModalOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-4 py-2.5 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5 text-[#2563EB]" />
              <span>Import Contacts</span>
            </button>
          </div>
        </div>
      ) : (
        <>

      {/* Search & Simple Filters */}
      <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4 space-y-3 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search by customer name or phone number..."
              className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-9 pr-3 py-2 text-xs text-[#0F172A] focus:border-[#2563EB] focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by customer group"
              value={tagFilter}
              onChange={(e) => {
                setTagFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-medium text-[#0F172A] cursor-pointer"
            >
              <option value="all">All Customer Groups</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setShowMoreFilters((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <span>Additional Filters</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showMoreFilters ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        </div>

        {showMoreFilters && (
          <div className="pt-2 border-t border-[#E2E8F0] flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500 font-medium">WhatsApp Updates:</span>
            {(
              [
                { key: 'all', label: 'Everyone' },
                { key: 'opted_in', label: 'Agreed to Updates' },
                { key: 'opted_out', label: 'Opted Out' },
              ] as const
            ).map((seg) => (
              <button
                key={seg.key}
                type="button"
                onClick={() => {
                  setSegmentFilter(seg.key);
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-lg font-medium cursor-pointer ${
                  segmentFilter === seg.key
                    ? 'bg-[#2563EB] text-white'
                    : 'bg-[#F8FAFC] text-slate-600 hover:bg-slate-100'
                }`}
              >
                {seg.label}
              </button>
            ))}
          </div>
        )}

        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#EFF6FF] border border-[#2563EB]/20 px-4 py-2.5 text-xs">
            <span className="font-semibold text-[#2563EB] tabular-nums">
              {selectedIds.length} customer{selectedIds.length > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2">
              <select
                value={bulkTagId}
                onChange={(e) => setBulkTagId(e.target.value)}
                className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">Add to group...</option>
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
                Apply Group
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-slate-600 hover:text-[#0F172A] px-2 cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Cards (Zero Horizontal Table Scroll on Phones) */}
      <div className="grid grid-cols-1 gap-3 md:hidden">
        {paginatedContacts.map((c) => {
          const contactTags = tags.filter((t) => c.tagIds.includes(t.id));
          return (
            <div
              key={c.id}
              onClick={() => openEditDrawer(c)}
              className="rounded-2xl border border-[#E2E8F0] bg-white p-4 space-y-2.5 cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-[#0F172A]">{c.fullName}</p>
                  <p className="text-xs font-mono text-slate-600 mt-0.5">
                    {formatPhoneDisplay(c.phoneE164)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openOrCreateConversationForContact(c.id);
                    navigate('/app/inbox');
                  }}
                  className="p-2 rounded-xl bg-[#EFF6FF] text-[#2563EB]"
                  aria-label="Message customer"
                >
                  <MessageSquare className="h-4 w-4" />
                </button>
              </div>
              {contactTags.length > 0 && (
                <p className="text-xs text-[#2563EB]">{contactTags.map((t) => t.name).join(' · ')}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Clean Desktop Directory Table */}
      <div className="hidden md:block rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all customers on page"
                    checked={
                      paginatedContacts.length > 0 &&
                      paginatedContacts.every((c) => selectedIds.includes(c.id))
                    }
                    onChange={toggleSelectAllOnPage}
                    className="rounded border-slate-300 text-[#2563EB]"
                  />
                </th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">WhatsApp Number</th>
                <th className="py-3 px-4">Groups</th>
                <th className="py-3 px-4">Updates</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {paginatedContacts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    No customers match your search.
                  </td>
                </tr>
              ) : (
                paginatedContacts.map((c) => {
                  const contactTags = tags.filter((t) => c.tagIds.includes(t.id));
                  return (
                    <tr
                      key={c.id}
                      onClick={() => openEditDrawer(c)}
                      className="hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(c.id)}
                          onChange={(e) => {
                            setSelectedIds((prev) =>
                              e.target.checked
                                ? [...prev, c.id]
                                : prev.filter((id) => id !== c.id)
                            );
                          }}
                          className="rounded border-slate-300 text-[#2563EB]"
                        />
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-[#0F172A]">{c.fullName}</p>
                        {c.company && <p className="text-[11px] text-slate-500">{c.company}</p>}
                      </td>
                      <td className="py-3 px-4 font-mono text-[#0F172A] tabular-nums">
                        {formatPhoneDisplay(c.phoneE164)}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {contactTags.length > 0 ? contactTags.map((t) => t.name).join(' · ') : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-semibold ${
                            c.marketingOptIn ? 'text-emerald-700' : 'text-[#E11D48]'
                          }`}
                        >
                          {c.marketingOptIn ? 'Subscribed' : 'Opted out'}
                        </span>
                      </td>
                      <td
                        className="py-3 px-4 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              openOrCreateConversationForContact(c.id);
                              navigate('/app/inbox');
                            }}
                            title="Chat on WhatsApp"
                            className="p-1.5 rounded-lg text-[#2563EB] hover:bg-[#EFF6FF] cursor-pointer"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditDrawer(c)}
                            title="Edit customer"
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-[#0F172A] cursor-pointer"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          {currentUser?.role === 'admin' && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(c)}
                              title="Remove customer"
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-[#E11D48] cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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

        {/* Clean Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between text-xs text-slate-600">
            <span className="tabular-nums">
              Page {Math.min(page, totalPages)} of {totalPages} ({filteredContacts.length} total)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 font-medium disabled:opacity-50 cursor-pointer"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 font-medium disabled:opacity-50 cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
        </>
      )}

      {/* Quick-Add / Edit Customer Side Drawer */}
      {formDrawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex justify-end"
          onClick={() => setFormDrawerOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white h-full shadow-2xl border-l border-[#E2E8F0] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#0F172A]">
                  {editingContact ? 'Edit Customer' : 'Add Customer'}
                </h3>
                <p className="text-xs text-slate-500">
                  {editingContact
                    ? 'Update details or jump straight to chat'
                    : 'Only name and WhatsApp number are required'}
                </p>
              </div>
              <button type="button" onClick={() => setFormDrawerOpen(false)}>
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            <form
              onSubmit={handleSaveContact}
              className="flex-1 overflow-y-auto p-6 space-y-4 text-xs"
            >
              {formError && (
                <div className="rounded-xl border border-[#E11D48]/30 bg-rose-50 px-3.5 py-2.5 text-[#E11D48]">
                  {formError}
                </div>
              )}

              <div>
                <label className="block font-semibold text-[#0F172A] mb-1.5">
                  Customer Name *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Customer full name"
                  className="w-full rounded-xl border border-[#E2E8F0] px-3.5 py-2.5 text-sm focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#0F172A] mb-1.5">
                  WhatsApp Number *
                </label>
                <input
                  type="text"
                  required
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="+1 555 000 0000"
                  className="w-full rounded-xl border border-[#E2E8F0] px-3.5 py-2.5 text-sm font-mono focus:border-[#2563EB] focus:outline-none"
                />
                {formPhone && (
                  <p className="mt-1.5 text-[11px]">
                    {duplicateMatch ? (
                      <span className="text-[#E11D48] font-medium">
                        Already saved as {duplicateMatch.fullName}
                      </span>
                    ) : normalizedPhonePreview ? (
                      <span className="text-emerald-700 font-medium">
                        Valid number: {normalizedPhonePreview}
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        Include country code (for example +971 or +1)
                      </span>
                    )}
                  </p>
                )}
              </div>

              {/* Progressive Disclosure for Optional Details */}
              <div className="pt-2 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowOptionalFields((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] cursor-pointer"
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${
                      showOptionalFields ? 'rotate-180' : ''
                    }`}
                  />
                  <span>
                    {showOptionalFields ? 'Hide additional details' : 'Add email, groups, or notes'}
                  </span>
                </button>

                {showOptionalFields && (
                  <div className="mt-4 space-y-3.5">
                    <div>
                      <label className="block font-semibold text-[#0F172A] mb-1">Email</label>
                      <input
                        type="email"
                        value={formEmail}
                        onChange={(e) => setFormEmail(e.target.value)}
                        placeholder="name@company.com"
                        className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-[#0F172A] mb-1">Company</label>
                        <input
                          type="text"
                          value={formCompany}
                          onChange={(e) => setFormCompany(e.target.value)}
                          className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-[#0F172A] mb-1">City</label>
                        <input
                          type="text"
                          value={formCity}
                          onChange={(e) => setFormCity(e.target.value)}
                          className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2"
                        />
                      </div>
                    </div>

                    <label className="flex items-center gap-2 pt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formOptIn}
                        onChange={(e) => setFormOptIn(e.target.checked)}
                        className="rounded border-slate-300 text-[#2563EB]"
                      />
                      <span className="font-medium text-[#0F172A]">
                        Agreed to receive broadcast messages
                      </span>
                    </label>

                    <div>
                      <label className="block font-semibold text-[#0F172A] mb-1.5">
                        Customer Groups
                      </label>
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
                              className={`px-2.5 py-1 rounded-lg border font-medium cursor-pointer ${
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
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newTagName}
                          onChange={(e) => setNewTagName(e.target.value)}
                          placeholder="New group name..."
                          className="flex-1 rounded-lg border border-[#E2E8F0] px-2.5 py-1.5"
                        />
                        <button
                          type="button"
                          onClick={handleCreateInlineTag}
                          className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 font-semibold text-[#0F172A] cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5 inline" /> Add
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block font-semibold text-[#0F172A] mb-1">Notes</label>
                      <textarea
                        rows={3}
                        value={formNotes}
                        onChange={(e) => setFormNotes(e.target.value)}
                        placeholder="Delivery preferences or context..."
                        className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 flex items-center justify-between gap-2 border-t border-[#E2E8F0]">
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
                    className="rounded-xl border border-[#E2E8F0] px-4 py-2 font-semibold text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={Boolean(duplicateMatch)}
                    className="rounded-xl bg-[#2563EB] px-4 py-2 font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 cursor-pointer"
                  >
                    {editingContact ? 'Save Changes' : 'Add Customer'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-base font-bold text-[#0F172A]">Remove Customer</h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Remove <strong>{deleteTarget.fullName}</strong> ({deleteTarget.phoneE164}) and their
              chat history from your directory?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-[#E2E8F0] px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteContact(deleteTarget.id);
                  setDeleteTarget(null);
                }}
                className="rounded-xl bg-[#E11D48] px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer"
              >
                Remove Customer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Guided CSV Import Modal */}
      {importModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          onClick={() => setImportModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-[#E2E8F0] bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#0F172A]">
                  Import Customer List (CSV)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Columns match automatically, and duplicate numbers are skipped safely.
                </p>
              </div>
              <button type="button" onClick={() => setImportModalOpen(false)}>
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {importFeedback && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-emerald-800 font-medium">
                  {importFeedback}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2 font-semibold text-[#0F172A] hover:bg-slate-100 cursor-pointer">
                  <Upload className="h-3.5 w-3.5 text-[#2563EB]" />
                  <span>Upload CSV File</span>
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

                <span className="text-[11px] text-slate-500">
                  Header row supported: Name, Phone, Email, Opt In
                </span>
              </div>

              <textarea
                rows={4}
                value={csvText}
                onChange={(e) => handleParseCsv(e.target.value)}
                placeholder="Or paste rows here: Name, Phone, Email"
                className="w-full rounded-xl border border-[#E2E8F0] p-3 font-mono text-[11px] focus:border-[#2563EB] focus:outline-none"
              />

              {csvPreviewRows.length > 0 && (
                <div>
                  <p className="font-semibold text-[#0F172A] mb-2">
                    {csvPreviewRows.filter((r) => !r.error).length} ready to add ·{' '}
                    {csvPreviewRows.filter((r) => Boolean(r.error)).length} skipped
                  </p>
                  <div className="border border-[#E2E8F0] rounded-xl overflow-hidden">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                        <tr>
                          <th className="p-2.5">Customer</th>
                          <th className="p-2.5">Phone</th>
                          <th className="p-2.5">Check</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E8F0]">
                        {csvPreviewRows.map((row) => (
                          <tr key={row.rowIndex}>
                            <td className="p-2.5 font-medium">{row.fullName || '—'}</td>
                            <td className="p-2.5 font-mono">{row.normalizedPhone || row.rawPhone}</td>
                            <td className="p-2.5">
                              {row.error ? (
                                <span className="text-[#E11D48] font-medium">
                                  {row.isDuplicate
                                    ? 'Already in your directory'
                                    : 'Needs valid country code & phone'}
                                </span>
                              ) : (
                                <span className="text-emerald-700 font-medium">Ready to add</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-[#E2E8F0] bg-[#F8FAFC] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                disabled={csvPreviewRows.filter((r) => !r.error).length === 0}
                onClick={handleConfirmCsvImport}
                className="rounded-xl bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 cursor-pointer"
              >
                <CheckSquare className="h-3.5 w-3.5 inline mr-1.5" />
                Add Valid Customers
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
