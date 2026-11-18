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

export async function fetchBusinessTeamMembers(params: {
  businessId: string;
  currentUserId: string;
  currentUserRole: StaffRole;
  currentUserEmail?: string;
  currentUserFullName?: string;
  conversations?: Conversation[];
}): Promise<FetchTeamMembersResult> {
  if (!supabase || !UUID_REGEX.test(params.businessId)) {
    return {
      ok: false,
      members: [],
      error: 'Supabase workspace is not configured.',
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

  const baseMembers: TeamMember[] = rows.map((m) => {
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

  // 3. Verify caller is an active business administrator before requesting Auth emails via backend Edge Function
  const callerRow = rows.find(
    (m) => String(m.user_id ?? '') === params.currentUserId && m.is_active === true
  );
  const isActiveAdmin =
    callerRow?.role === 'admin' ||
    (callerRow === undefined && params.currentUserRole === 'admin');

  if (!isActiveAdmin) {
    return {
      ok: true,
      members: baseMembers,
      error: null,
    };
  }

  // 4. For active administrators, call secure backend endpoint to retrieve authorized team details + Auth emails
  try {
    const { data, error } = await client.functions.invoke('team-members', {
      body: { businessId: params.businessId },
    });

    if (error) {
      const serverMsg = await extractEdgeErrorMessage(error);
      return {
        ok: false,
        members: baseMembers,
        error: serverMsg
          ? `Could not load administrator team directory: ${serverMsg}`
          : `Could not load administrator team directory (${(error as Error).message || 'Edge Function unavailable'}).`,
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
        members: baseMembers,
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
      members: baseMembers,
      error:
        err instanceof Error
          ? `Could not load administrator team directory: ${err.message}`
          : 'Could not load administrator team directory.',
    };
  }
}
