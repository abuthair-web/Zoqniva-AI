export type LogCategory =
  | 'webhook_verify'
  | 'webhook_inbound'
  | 'outgoing_submit'
  | 'status_update'
  | 'connection_check'
  | 'permission_error'
  | 'meta_api_error'
  | 'duplicate_event'
  | 'invalid_request';

export type LogLevel = 'info' | 'warn' | 'error';

const SENSITIVE_KEY_PATTERN =
  /token|secret|authorization|password|apikey|api_key|signature|verify_token|body|message_text|content/i;

function sanitizeValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    if (typeof value === 'string') {
      return `[REDACTED len=${value.length}]`;
    }
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    if (value.startsWith('Bearer ')) return 'Bearer [REDACTED]';
    if (value.startsWith('EAAG') || value.startsWith('EAA')) return '[REDACTED_META_TOKEN]';
    return value.length > 240 ? `${value.slice(0, 240)}...` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(key, item));
  }
  if (typeof value === 'object') {
    return sanitizeContext(value as Record<string, unknown>);
  }
  return value;
}

export function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    out[k] = sanitizeValue(k, v);
  }
  return out;
}

export function maskPhone(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  const trimmed = phone.trim();
  if (trimmed.length <= 4) return '****';
  return `***${trimmed.slice(-4)}`;
}

export function logEvent(
  category: LogCategory,
  level: LogLevel,
  message: string,
  context: Record<string, unknown> = {}
): void {
  const entry = {
    ts: new Date().toISOString(),
    category,
    level,
    message,
    ...sanitizeContext(context),
  };

  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.info(JSON.stringify(entry));
  }
}
