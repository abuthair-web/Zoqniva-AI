import { supabase } from '@/lib/supabase';
import type { Conversation, StaffRole, TeamMember } from '@/types/crm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AdminDirectoryMemberPayload {
  userId: string;
  businessId: string;
  fullName: string;
  email: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: string;
}

export interface FetchTeamMembersResult {
  ok: boolean;
  members: TeamMember[];
  error: string | null;
}

async function extractEdgeErrorMessage(error: unknown): Promise<string | null> {
  if (!error || typeof error !== 'object') return null;
  const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const parsed = await ctx.json();
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        const msg = (parsed as { error?: unknown }).error;
        if (typeof msg === 'string' && msg.trim()) return msg.trim();
      }
    } catch {
      // Ignore JSON parsing failure on non-JSON error responses
    }
  }
  const msg = (error as { message?: unknown }).message;
  return typeof msg === 'string' && msg.trim() ? msg.trim() : null;
}

function buildConversationStats(
  userId: string,
  conversations: Conversation[]
): { activeConversations: number; resolvedToday: number } {
  let activeConversations = 0;
  let resolvedToday = 0;
  for (const cv of conversations) {
    if (cv.assignedToId === userId) {
      if (cv.status === 'resolved') {
        resolvedToday += 1;
      } else {
        activeConversations += 1;
      }
    }
  }
  return { activeConversations, resolvedToday };
}

/**
 * Fetches basic workspace staff memberships (business_members + RLS-permitted profiles)
 * without invoking any Edge Function. Safe for global workspace load across all CRM pages.
 */
export async function fetchBasicWorkspaceTeamMembers(params: {
  businessId: string;
  currentUserId: string;
  currentUserEmail?: string;
  currentUserFullName?: string;
  conversations?: Conversation[];
}): Promise<FetchTeamMembersResult & { isActiveAdmin: boolean }> {
  if (!supabase || !UUID_REGEX.test(params.businessId)) {
    return {
      ok: false,
      members: [],
      error: 'Supabase workspace is not configured.',
      isActiveAdmin: false,
    };
  }

  const client = supabase;
  const convList = params.conversations ?? [];

  // 1. Fetch business_members using actual existing columns (no FK join to profiles)
  const { data: memberRows, error: memberErr } = await client
    .from('business_members')
    .select('business_id, user_id, role, is_active, created_at')
    .eq('business_id', params.businessId)
    .order('created_at', { ascending: true });

  if (memberErr) {
    return {
      ok: false,
      members: [],
      error: `Unable to load business team memberships: ${memberErr.message}`,
      isActiveAdmin: false,
    };
  }

  const rows = (memberRows ?? []) as Array<Record<string, unknown>>;
  const userIds = Array.from(
    new Set(
      rows
        .map((r) => (typeof r.user_id === 'string' ? r.user_id : ''))
        .filter((id) => UUID_REGEX.test(id))
    )
  );

  // 2. Separately fetch public.profiles names by matching profiles.id -> business_members.user_id, where RLS permits
  const profilesMap = new Map<string, { fullName?: string }>();
  if (userIds.length > 0) {
    const { data: profileRows, error: profilesErr } = await client
      .from('profiles')
      .select('id, full_name, role')
      .in('id', userIds);

    if (!profilesErr && Array.isArray(profileRows)) {
      for (const p of profileRows as Array<Record<string, unknown>>) {
        const pid = typeof p.id === 'string' ? p.id : '';
        if (pid) {
          const cleanName = typeof p.full_name === 'string' ? p.full_name.trim() : '';
          profilesMap.set(pid, { fullName: cleanName || undefined });
        }
      }
    }
  }

  const members: TeamMember[] = rows.map((m) => {
    const uid = String(m.user_id ?? '');
    const isSelf = uid === params.currentUserId;
    const profile = profilesMap.get(uid);
    const stats = buildConversationStats(uid, convList);
    const resolvedRole: StaffRole = m.role === 'admin' ? 'admin' : 'agent';

    return {
      id: uid,
      fullName:
        profile?.fullName ||
        (isSelf && params.currentUserFullName ? params.currentUserFullName : '') ||
        'Team Member',
      email: isSelf && params.currentUserEmail ? params.currentUserEmail : '',
      role: resolvedRole,
      status: m.is_active === false ? 'suspended' : 'active',
      jobTitle: '',
      activeConversations: stats.activeConversations,
      resolvedToday: stats.resolvedToday,
    };
  });

  const callerRow = rows.find(
    (m) => String(m.user_id ?? '') === params.currentUserId && m.is_active === true
  );
  const isActiveAdmin = callerRow?.role === 'admin';

  return {
    ok: true,
    members,
    error: null,
    isActiveAdmin,
  };
}

/**
 * On-demand administrator directory fetch.
 * Calls the `team-members` Edge Function ONLY for verified active business admins
 * when viewing Team Management or Settings -> Team.
 */
export async function fetchAdminTeamDirectory(params: {
  businessId: string;
  currentUserId: string;
  currentUserRole: StaffRole;
  currentUserEmail?: string;
  currentUserFullName?: string;
  conversations?: Conversation[];
}): Promise<FetchTeamMembersResult> {
  const basic = await fetchBasicWorkspaceTeamMembers({
    businessId: params.businessId,
    currentUserId: params.currentUserId,
    currentUserEmail: params.currentUserEmail,
    currentUserFullName: params.currentUserFullName,
    conversations: params.conversations,
  });

  if (!basic.ok) {
    return { ok: false, members: basic.members, error: basic.error };
  }

  const isAdmin =
    basic.isActiveAdmin ||
    (basic.members.length === 0 && params.currentUserRole === 'admin');

  if (!isAdmin || !supabase) {
    return { ok: true, members: basic.members, error: null };
  }

  const convList = params.conversations ?? [];

  try {
    const { data, error } = await supabase.functions.invoke('team-members', {
      body: { businessId: params.businessId },
    });

    if (error) {
      const rawMsg = await extractEdgeErrorMessage(error);
      const isTransportOrMissing =
        !rawMsg ||
        rawMsg.toLowerCase().includes('failed to send a request') ||
        rawMsg.toLowerCase().includes('fetch') ||
        rawMsg.toLowerCase().includes('cors');

      return {
        ok: false,
        members: basic.members,
        error: isTransportOrMissing
          ? 'The team-members Edge Function is not deployed or unreachable. Showing workspace membership roster without team emails.'
          : `Could not load administrator team directory: ${rawMsg}`,
      };
    }

    const payload = (data ?? {}) as {
      ok?: boolean;
      error?: string;
      members?: AdminDirectoryMemberPayload[];
    };

    if (!payload.ok || !Array.isArray(payload.members)) {
      return {
        ok: false,
        members: basic.members,
        error: payload.error || 'Team directory endpoint returned an unexpected response.',
      };
    }

    const enrichedMembers: TeamMember[] = payload.members.map((m) => {
      const stats = buildConversationStats(m.userId, convList);
      return {
        id: m.userId,
        fullName: m.fullName || 'Team Member',
        email: m.email || '',
        role: m.role === 'admin' ? 'admin' : 'agent',
        status: m.isActive ? 'active' : 'suspended',
        jobTitle: '',
        activeConversations: stats.activeConversations,
        resolvedToday: stats.resolvedToday,
      };
    });

    return {
      ok: true,
      members: enrichedMembers,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      members: basic.members,
      error:
        err instanceof Error
          ? `Could not load administrator team directory: ${err.message}`
          : 'Could not load administrator team directory.',
    };
  }
}
