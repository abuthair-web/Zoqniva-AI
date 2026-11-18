import React, { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import type { StaffRole, TeamMember } from '@/types/crm';

export function TeamMembersPage() {
  const {
    currentUser,
    teamMembers,
    teamMembersLoading,
    teamMembersError,
    refreshTeamMembers,
    inviteTeamMember,
    updateTeamMemberRole,
    toggleTeamMemberStatus,
    removeTeamMember,
  } = useApp();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('agent');
  const [showPermissions, setShowPermissions] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<TeamMember | null>(null);

  const isAdmin = currentUser?.role === 'admin';

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim()) return;
    inviteTeamMember(fullName, email, role, role === 'admin' ? 'Team Admin' : 'Support Agent');
    setFullName('');
    setEmail('');
    setRole('agent');
    setInviteOpen(false);
  };

  const statusMeta = (status: TeamMember['status']) => {
    if (status === 'active') return { label: 'Active', color: 'text-emerald-700' };
    if (status === 'invited') return { label: 'Invited', color: 'text-[#2563EB]' };
    return { label: 'Paused', color: 'text-[#E11D48]' };
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8 max-w-[1440px] mx-auto space-y-6">
      {/* Header — 1 Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-[2px] w-5 bg-[#F4B942]" />
            <span className="text-xs font-semibold text-[#2563EB]">Staff &amp; Access</span>
          </div>
          <h2 className="font-display text-2xl font-bold text-[#0F172A] tracking-tight mt-0.5">
            Team Management
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Invite staff members to reply to customer chats or help manage your workspace.
          </p>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] shadow-2xs self-start cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Invite Team Member</span>
          </button>
        )}
      </div>

      {teamMembersError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-rose-900">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-[#E11D48] shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-[#0F172A]">Unable to load full team directory</p>
              <p className="text-rose-800 mt-0.5">{teamMembersError}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={teamMembersLoading}
            onClick={() => void refreshTeamMembers()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3.5 py-2 font-semibold text-[#0F172A] hover:bg-rose-100/50 disabled:opacity-60 self-start sm:self-center cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${teamMembersLoading ? 'animate-spin' : ''}`} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {teamMembersLoading && teamMembers.length === 0 ? (
        <div className="rounded-2xl border border-[#E2E8F0] bg-white px-6 py-14 text-center space-y-3">
          <Loader2 className="h-6 w-6 text-[#2563EB] animate-spin mx-auto" />
          <p className="text-xs font-medium text-slate-500">Loading workspace team members...</p>
        </div>
      ) : teamMembers.length === 0 && !teamMembersError ? (
        <div className="rounded-2xl border border-dashed border-[#E2E8F0] bg-white px-6 py-14 text-center space-y-4">
          <div className="h-12 w-12 rounded-2xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center mx-auto">
            <Users className="h-6 w-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="font-display text-base font-bold text-[#0F172A]">
              No team members added yet.
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Authorized staff accounts for your workspace will appear here. Invite agents or admins to collaborate in Team Inbox.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Invite Team Member</span>
            </button>
          )}
        </div>
      ) : teamMembers.length === 0 ? null : (
        <>
          {/* Team Members: Mobile Cards */}
          <div className="md:hidden space-y-3">
            {teamMembers.map((member) => {
              const st = statusMeta(member.status);
              const isSelf = member.id === currentUser?.id;
              return (
                <div
                  key={member.id}
                  className="rounded-2xl border border-[#E2E8F0] bg-white p-4 space-y-3 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#0F172A] text-sm truncate">
                        {member.fullName} {isSelf && <span className="text-slate-400">(You)</span>}
                      </p>
                      <p className="text-slate-500 truncate">{member.email || '—'}</p>
                    </div>
                    <span className={`font-semibold shrink-0 ${st.color}`}>{st.label}</span>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
                    <div>
                      {isAdmin && !isSelf ? (
                        <select
                          value={member.role}
                          onChange={(e) => updateTeamMemberRole(member.id, e.target.value as StaffRole)}
                          className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-medium capitalize"
                        >
                          <option value="admin">Admin</option>
                          <option value="agent">Agent</option>
                        </select>
                      ) : (
                        <span className="capitalize font-semibold text-[#0F172A]">{member.role}</span>
                      )}
                    </div>

                    {isAdmin && !isSelf && (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => toggleTeamMemberStatus(member.id)}
                          className="font-semibold text-[#2563EB] cursor-pointer"
                        >
                          {member.status === 'active' ? 'Pause' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(member)}
                          className="font-semibold text-[#E11D48] cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Team Table: Desktop */}
          <div className="hidden md:block rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3.5 px-5">Team Member</th>
                    <th className="py-3.5 px-5">Role</th>
                    <th className="py-3.5 px-5">Status</th>
                    <th className="py-3.5 px-5 text-right">Assigned Chats</th>
                    <th className="py-3.5 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-xs">
                  {teamMembers.map((member) => {
                    const st = statusMeta(member.status);
                    const isSelf = member.id === currentUser?.id;
                    return (
                      <tr key={member.id} className="hover:bg-[#F8FAFC]">
                        <td className="py-3.5 px-5">
                          <p className="font-semibold text-[#0F172A]">
                            {member.fullName}{' '}
                            {isSelf && <span className="text-[11px] text-slate-400 font-normal">(You)</span>}
                          </p>
                          <p className="text-[11px] text-slate-500">{member.email || '—'}</p>
                        </td>
                        <td className="py-3.5 px-5">
                          {isAdmin && !isSelf ? (
                            <select
                              value={member.role}
                              onChange={(e) =>
                                updateTeamMemberRole(member.id, e.target.value as StaffRole)
                              }
                              className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-xs font-medium capitalize"
                            >
                              <option value="admin">Admin</option>
                              <option value="agent">Agent</option>
                            </select>
                          ) : (
                            <span className="capitalize font-semibold text-[#0F172A]">{member.role}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-5">
                          <span className={`font-semibold ${st.color}`}>{st.label}</span>
                        </td>
                        <td className="py-3.5 px-5 text-right font-mono tabular-nums">
                          {member.activeConversations}
                        </td>
                        <td className="py-3.5 px-5 text-right">
                          {isAdmin && !isSelf ? (
                            <div className="inline-flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => toggleTeamMemberStatus(member.id)}
                                className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
                              >
                                {member.status === 'active' ? 'Pause' : 'Activate'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmRemove(member)}
                                className="text-slate-400 hover:text-[#E11D48] cursor-pointer"
                                aria-label={`Remove ${member.fullName}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Expandable Advanced Permissions */}
      <div className="rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden">
        <button
          type="button"
          onClick={() => setShowPermissions((s) => !s)}
          className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-[#F8FAFC] transition-colors cursor-pointer"
        >
          <div>
            <h3 className="font-display text-sm font-bold text-[#0F172A]">Advanced Permissions</h3>
            <p className="text-xs text-slate-500">
              See what Admins and Agents can access across your workspace
            </p>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-slate-500 transition-transform ${
              showPermissions ? 'rotate-180' : ''
            }`}
          />
        </button>

        {showPermissions && (
          <div className="p-5 pt-3 border-t border-[#E2E8F0] grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="h-4 w-4 text-[#2563EB]" />
                <h4 className="font-display text-sm font-bold text-[#0F172A]">Admin</h4>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Full control over team invitations, WhatsApp settings, message templates, broadcast campaigns, customer deletion, and workspace preferences.
              </p>
            </div>

            <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
              <div className="flex items-center gap-2 mb-2">
                <UserCheck className="h-4 w-4 text-[#F4B942]" />
                <h4 className="font-display text-sm font-bold text-[#0F172A]">Agent</h4>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Can reply to assigned or unassigned chats in Team Inbox, write internal team notes, organize customer groups, and view templates.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Invite Drawer */}
      {inviteOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex justify-end"
          onClick={() => setInviteOpen(false)}
        >
          <div
            className="w-full max-w-md h-full bg-white border-l border-[#E2E8F0] shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[#2563EB]" />
                <h3 className="font-display text-base font-bold text-[#0F172A]">
                  Invite Team Member
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-[#F8FAFC] cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleInvite} className="p-5 space-y-4 text-xs flex-1">
              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Staff member full name"
                  className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 focus:border-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@yourbusiness.com"
                  className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2.5 focus:border-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#0F172A] mb-1.5">Access Role</label>
                <div className="grid grid-cols-2 gap-2.5">
                  {(
                    [
                      { value: 'agent', title: 'Agent', desc: 'Replies to chats & manages customers' },
                      { value: 'admin', title: 'Admin', desc: 'Full workspace & campaign access' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRole(opt.value)}
                      className={`text-left rounded-xl border p-3 transition-colors cursor-pointer ${
                        role === opt.value
                          ? 'border-[#2563EB] bg-[#EFF6FF]'
                          : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <p className="font-semibold text-[#0F172A]">{opt.title}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  className="rounded-xl border border-[#E2E8F0] px-4 py-2.5 font-semibold text-slate-700 hover:bg-[#F8FAFC] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#2563EB] px-4 py-2.5 font-semibold text-white hover:bg-[#1D4ED8] cursor-pointer"
                >
                  Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Remove Confirmation Modal */}
      {confirmRemove && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          onClick={() => setConfirmRemove(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-xl space-y-4 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="font-display text-base font-bold text-[#0F172A]">
                Remove team member?
              </h3>
              <p className="text-slate-600 mt-1 leading-relaxed">
                <strong>{confirmRemove.fullName}</strong> will lose access to this workspace. You can re-invite them later anytime.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRemove(null)}
                className="rounded-xl border border-[#E2E8F0] px-4 py-2 font-semibold text-slate-700 cursor-pointer"
              >
                Keep Member
              </button>
              <button
                type="button"
                onClick={() => {
                  removeTeamMember(confirmRemove.id);
                  setConfirmRemove(null);
                }}
                className="rounded-xl bg-[#E11D48] px-4 py-2 font-semibold text-white hover:bg-rose-700 cursor-pointer"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
