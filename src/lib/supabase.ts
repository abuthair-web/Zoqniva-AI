import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey = import.meta.env
  .VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const hasRealValue = (val?: string): boolean => {
  if (!val) return false;
  const trimmed = val.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.includes('YOUR_PROJECT_REF') &&
    !trimmed.includes('YOUR_SUPABASE_PUBLISHABLE_KEY')
  );
};

const isValidHttpUrl = (val?: string): boolean => {
  if (!val) return false;
  try {
    const parsed = new URL(val.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

export const isSupabaseConfigured: boolean =
  hasRealValue(supabaseUrl) &&
  isValidHttpUrl(supabaseUrl) &&
  hasRealValue(supabasePublishableKey);

export const supabaseConfigError: string | null = isSupabaseConfigured
  ? null
  : !hasRealValue(supabaseUrl) || !isValidHttpUrl(supabaseUrl)
  ? 'Missing or invalid VITE_SUPABASE_URL environment variable.'
  : 'Missing VITE_SUPABASE_PUBLISHABLE_KEY environment variable.';

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!.trim(), supabasePublishableKey!.trim(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;
