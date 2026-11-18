// Supabase Edge Function: Administrator Team Members Directory
// Standalone single-file build for Supabase Dashboard -> Edge Functions -> Via Editor.
// Keep "Enforce JWT Verification" ENABLED (default) when deploying.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function logEvent(
  category: 'team_members' | 'permission_error' | 'db_error',
  level: 'info' | 'warn' | 'error',
  message: string,
  context: Record<string, unknown> = {}
): void {
  const entry = { ts: new Date().toISOString(), category, level, message, ...context };
  if (level === 'error') console.error(JSON.stringify(entry));
  else if (level === 'warn') console.warn(JSON.stringify(entry));
  else console.info(JSON.stringify(entry));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method Not Allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse(
        { ok: false, errorCode: 'MISSING_AUTH', error: 'Missing Authorization header.' },
        401
      );
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return jsonResponse(
        { ok: false, errorCode: 'INVALID_AUTH', error: 'Invalid Authorization token.' },
        401
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResponse(
        { ok: false, errorCode: 'SERVER_CONFIG_MISSING', error: 'Supabase environment secrets missing.' },
        500
      );
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userRes, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userRes.user) {
      return jsonResponse(
        { ok: false, errorCode: 'UNAUTHORIZED', error: 'Unauthorized session.' },
        401
      );
    }

    const body = (await req.json().catch(() => ({}))) as { businessId?: unknown };
    const requestedBusinessId =
      typeof body.businessId === 'string' ? body.businessId.trim() : '';

    if (requestedBusinessId && !UUID_REGEX.test(requestedBusinessId)) {
      return jsonResponse(
        { ok: false, errorCode: 'INVALID_BUSINESS_ID', error: 'Invalid businessId format.' },
        400
      );
    }

    // 1. Strictly verify caller is an active business administrator in public.business_members
    let adminQuery = serviceClient
      .from('business_members')
      .select('business_id, user_id, role, is_active, created_at')
      .eq('user_id', userRes.user.id)
      .eq('is_active', true);

    if (requestedBusinessId) {
      adminQuery = adminQuery.eq('business_id', requestedBusinessId);
    }

    const { data: callerRows, error: callerErr } = await adminQuery;

    if (callerErr) {
      logEvent('db_error', 'error', 'Failed to verify caller business membership', {
        userId: userRes.user.id,
        errorCode: callerErr.code,
        error: callerErr.message,
      });
      return jsonResponse(
        {
          ok: false,
          errorCode: 'MEMBERSHIP_QUERY_FAILED',
          error: `Unable to verify administrator membership: ${callerErr.message}`,
        },
        500
      );
    }

    const activeAdmin = (callerRows ?? []).find(
      (m) => m.is_active === true && m.role === 'admin'
    );

    if (!activeAdmin) {
      logEvent('permission_error', 'warn', 'Non-admin or inactive user requested team directory', {
        userId: userRes.user.id,
        requestedBusinessId: requestedBusinessId || null,
      });
      return jsonResponse(
        {
          ok: false,
          errorCode: 'ADMIN_REQUIRED',
          error: 'Only active business administrators can view the full Team Members directory.',
        },
        403
      );
    }

    const businessId = String(activeAdmin.business_id);

    // 2. Load membership rows ONLY for the authorized business using actual schema columns
    const { data: memberRows, error: membersErr } = await serviceClient
      .from('business_members')
      .select('business_id, user_id, role, is_active, created_at')
      .eq('business_id', businessId)
      .order('created_at', { ascending: true });

    if (membersErr) {
      logEvent('db_error', 'error', 'Failed to query business_members directory', {
        businessId,
        errorCode: membersErr.code,
        error: membersErr.message,
      });
      return jsonResponse(
        {
          ok: false,
          errorCode: 'TEAM_MEMBERS_QUERY_FAILED',
          error: `Unable to load team memberships: ${membersErr.message}`,
        },
        500
      );
    }

    const rows = (memberRows ?? []) as Array<Record<string, unknown>>;
    const userIds = Array.from(
      new Set(
        rows
          .map((r) => (typeof r.user_id === 'string' ? r.user_id : ''))
          .filter((id) => UUID_REGEX.test(id))
      )
    );

    // 3. Separately fetch profile names from public.profiles (actual columns only; no email column)
    const profileMap = new Map<string, { fullName?: string; role?: string }>();
    if (userIds.length > 0) {
      const { data: profileRows, error: profilesErr } = await serviceClient
        .from('profiles')
        .select('id, full_name, role, created_at, updated_at')
        .in('id', userIds);

      if (profilesErr) {
        logEvent('db_error', 'warn', 'Failed to query public.profiles for team members', {
          businessId,
          errorCode: profilesErr.code,
          error: profilesErr.message,
        });
      } else if (Array.isArray(profileRows)) {
        for (const p of profileRows as Array<Record<string, unknown>>) {
          const pid = typeof p.id === 'string' ? p.id : '';
          if (pid) {
            const cleanName = typeof p.full_name === 'string' ? p.full_name.trim() : '';
            profileMap.set(pid, {
              fullName: cleanName || undefined,
              role: typeof p.role === 'string' ? p.role : undefined,
            });
          }
        }
      }
    }

    // 4. Fetch authorized emails & fallback names from Supabase Auth ONLY for members of this business
    const authUserMap = new Map<string, { email: string; fullName?: string }>();
    const BATCH_SIZE = 10;
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const chunk = userIds.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        chunk.map(async (uid) => {
          try {
            const { data, error } = await serviceClient.auth.admin.getUserById(uid);
            if (error || !data?.user) return null;
            const metaName =
              typeof data.user.user_metadata?.full_name === 'string'
                ? data.user.user_metadata.full_name.trim()
                : '';
            return {
              id: data.user.id,
              email: data.user.email ?? '',
              fullName: metaName || undefined,
            };
          } catch {
            return null;
          }
        })
      );

      for (const item of batchResults) {
        if (item) {
          authUserMap.set(item.id, { email: item.email, fullName: item.fullName });
        }
      }
    }

    // 5. Return ONLY authorized team-member fields scoped to this business
    const members = rows.map((m) => {
      const uid = String(m.user_id ?? '');
      const prof = profileMap.get(uid);
      const authInfo = authUserMap.get(uid);
      const email = authInfo?.email ?? '';
      const fallbackFromEmail = email ? email.split('@')[0] : '';
      const fullName = prof?.fullName || authInfo?.fullName || fallbackFromEmail || 'Team Member';

      return {
        userId: uid,
        businessId: String(m.business_id ?? businessId),
        fullName,
        email,
        role: m.role === 'admin' ? 'admin' : 'agent',
        isActive: m.is_active === true,
        createdAt: String(m.created_at ?? ''),
      };
    });

    return jsonResponse({
      ok: true,
      businessId,
      members,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    logEvent('team_members', 'error', 'Unhandled error in team-members function', { error: message });
    return jsonResponse(
      { ok: false, errorCode: 'INTERNAL_ERROR', error: message },
      500
    );
  }
});
