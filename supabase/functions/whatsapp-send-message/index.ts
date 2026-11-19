// Supabase Edge Function: Send One-to-One Official WhatsApp Cloud API Message
// Standalone single-file build for Supabase Dashboard -> Edge Functions -> Via Editor.
// Keep "Enforce JWT Verification" ENABLED (default) when deploying.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_GRAPH_VERSION = /^v(1[89]|2[0-9])\.0$/;
const DEFAULT_GRAPH_VERSION = 'v25.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function resolveGraphApiVersion(requested?: string | null): string {
  const envVer = Deno.env.get('META_GRAPH_API_VERSION')?.trim();
  if (envVer && VALID_GRAPH_VERSION.test(envVer)) return envVer;
  const candidate = requested?.trim();
  if (candidate && VALID_GRAPH_VERSION.test(candidate)) return candidate;
  return DEFAULT_GRAPH_VERSION;
}

function normalizeWaId(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15 || digits.startsWith('0')) return null;
  return digits;
}

function normalizePhoneToE164(raw: string): string | null {
  const waId = normalizeWaId(raw);
  return waId ? `+${waId}` : null;
}

function maskPhone(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  const trimmed = phone.trim();
  return trimmed.length <= 4 ? '****' : `***${trimmed.slice(-4)}`;
}

const SENSITIVE_KEY_PATTERN =
  /token|secret|authorization|password|apikey|api_key|signature|verify_token|body|message_text|content/i;

function logEvent(
  category: 'outgoing_submit' | 'permission_error' | 'meta_api_error' | 'duplicate_event' | 'persistence_error',
  level: 'info' | 'warn' | 'error',
  message: string,
  context: Record<string, unknown> = {}
): void {
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    sanitized[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : v;
  }
  const entry = { ts: new Date().toISOString(), category, level, message, ...sanitized };
  if (level === 'error') console.error(JSON.stringify(entry));
  else if (level === 'warn') console.warn(JSON.stringify(entry));
  else console.info(JSON.stringify(entry));
}

function classifyMetaError(httpStatus: number, metaPayload: Record<string, unknown> | null) {
  const errObj = (metaPayload?.error as Record<string, unknown> | undefined) ?? {};
  const numericCode = errObj.code !== undefined ? String(errObj.code) : '';
  const subcode = errObj.error_subcode !== undefined ? String(errObj.error_subcode) : '';
  const rawMessage = typeof errObj.message === 'string' ? errObj.message : 'Meta Graph API request failed';

  if (numericCode === '190') {
    return {
      code: 'META_TOKEN_EXPIRED',
      httpStatus: 401,
      userMessage: 'WhatsApp API token has expired or is invalid. Ask an admin to rotate the server token.',
      diagnosticMessage: `Meta OAuth error 190${subcode ? `/${subcode}` : ''}: ${rawMessage}`,
    };
  }
  if (numericCode === '10' || numericCode === '200') {
    return {
      code: 'META_PERMISSION_DENIED',
      httpStatus: 403,
      userMessage: 'Meta app lacks permission for this WhatsApp Business number.',
      diagnosticMessage: `Meta permission error ${numericCode}: ${rawMessage}`,
    };
  }
  if (numericCode === '100') {
    return {
      code: 'META_INVALID_IDENTIFIER',
      httpStatus: 400,
      userMessage: 'The Phone Number ID or template parameters are invalid.',
      diagnosticMessage: `Meta invalid parameter 100: ${rawMessage}`,
    };
  }
  if (numericCode === '131030') {
    return {
      code: 'META_TEST_RECIPIENT_NOT_ALLOWED',
      httpStatus: 400,
      userMessage: 'Recipient phone number is not in Meta’s allowed test recipient list.',
      diagnosticMessage: `Meta sandbox error 131030: ${rawMessage}`,
    };
  }
  if (numericCode === '131047') {
    return {
      code: 'META_REENGAGEMENT_REQUIRED',
      httpStatus: 400,
      userMessage: 'More than 24 hours have passed since the customer replied. Send an approved template instead.',
      diagnosticMessage: `Meta 24h window error 131047: ${rawMessage}`,
    };
  }
  if (numericCode === '131026') {
    return {
      code: 'META_RECIPIENT_UNDELIVERABLE',
      httpStatus: 400,
      userMessage: 'This phone number could not receive the WhatsApp message.',
      diagnosticMessage: `Meta undeliverable 131026: ${rawMessage}`,
    };
  }
  if (numericCode === '130429' || numericCode === '80007') {
    return {
      code: 'META_RATE_LIMITED',
      httpStatus: 429,
      userMessage: 'WhatsApp rate limit reached temporarily. Wait a moment before trying again.',
      diagnosticMessage: `Meta rate limit ${numericCode}: ${rawMessage}`,
    };
  }

  return {
    code: numericCode ? `META_${numericCode}` : `META_HTTP_${httpStatus}`,
    httpStatus: httpStatus >= 400 && httpStatus < 500 ? 400 : 502,
    userMessage: 'WhatsApp could not accept this message right now.',
    diagnosticMessage: `Meta HTTP ${httpStatus}: ${rawMessage}`,
  };
}

async function dispatchMetaMessage(params: {
  graphApiVersion: string;
  phoneNumberId: string;
  accessToken: string;
  recipientWaId: string;
  messageType: 'text' | 'template';
  body?: string;
  templateName?: string;
  language?: string;
  templateParameters?: string[];
}) {
  const {
    graphApiVersion,
    phoneNumberId,
    accessToken,
    recipientWaId,
    messageType,
    body,
    templateName,
    language = 'en_US',
    templateParameters,
  } = params;

  const metaPayload =
    messageType === 'template'
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipientWaId,
          type: 'template',
          template: {
            name: templateName,
            language: { code: language },
            ...(templateParameters && templateParameters.length > 0
              ? {
                  components: [
                    {
                      type: 'body',
                      parameters: templateParameters.map((val) => ({
                        type: 'text',
                        text: val,
                      })),
                    },
                  ],
                }
              : {}),
          },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipientWaId,
          type: 'text',
          text: {
            preview_url: false,
            body: body ?? '',
          },
        };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(
      `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metaPayload),
        signal: controller.signal,
      }
    );

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const messagesArr = Array.isArray(json.messages) ? (json.messages as Array<Record<string, unknown>>) : [];
    const metaMessageId = typeof messagesArr[0]?.id === 'string' ? messagesArr[0].id : undefined;

    if (!res.ok || !metaMessageId) {
      const classified = classifyMetaError(res.status, json);
      logEvent('meta_api_error', 'error', 'Meta send rejected', {
        code: classified.code,
        recipient: maskPhone(recipientWaId),
        messageType,
      });
      return {
        ok: false as const,
        uncertain: false,
        httpStatus: classified.httpStatus,
        errorCode: classified.code,
        userMessage: classified.userMessage,
        diagnosticMessage: classified.diagnosticMessage,
        rawResponse: json,
      };
    }

    logEvent('outgoing_submit', 'info', 'Message accepted by Meta Cloud API', {
      metaMessageId,
      recipient: maskPhone(recipientWaId),
      messageType,
    });

    return {
      ok: true as const,
      uncertain: false,
      httpStatus: 200,
      metaMessageId,
      rawResponse: json,
    };
  } catch (err) {
    // NEVER blindly retry a timed-out or interrupted POST to Meta to avoid duplicate WhatsApp messages
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    logEvent('meta_api_error', 'error', 'Meta send network failure/timeout', {
      isAbort,
      recipient: maskPhone(recipientWaId),
    });
    return {
      ok: false as const,
      uncertain: true,
      httpStatus: 504,
      errorCode: isAbort ? 'META_REQUEST_TIMEOUT' : 'META_NETWORK_ERROR',
      userMessage: isAbort
        ? 'Timed out waiting for WhatsApp confirmation. Check delivery status before creating a new request to avoid duplicate customer messages.'
        : 'Network interruption while communicating with WhatsApp Cloud API. Verify delivery status before retrying.',
      diagnosticMessage: (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

interface TemplateButtonRecord {
  type?: unknown;
  text?: unknown;
  url?: unknown;
  phone_number?: unknown;
  example?: unknown;
}

interface TemplateComponentRecord {
  type?: unknown;
  format?: unknown;
  text?: unknown;
  buttons?: unknown;
}

const SUPPORTED_COMPONENT_TYPES = new Set(['HEADER', 'BODY', 'FOOTER', 'BUTTONS']);
const SUPPORTED_STATIC_BUTTON_TYPES = new Set(['QUICK_REPLY', 'PHONE_NUMBER', 'URL', 'VOICE_CALL']);

function coerceTemplateComponents(raw: unknown): TemplateComponentRecord[] {
  if (Array.isArray(raw)) {
    return raw.filter(
      (item): item is TemplateComponentRecord =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    );
  }
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is TemplateComponentRecord =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item)
        );
      }
    } catch {
      return [];
    }
  }
  return [];
}

function renderTemplateTextFromComponents(params: {
  templateName: string;
  language: string;
  components: TemplateComponentRecord[];
  sanitizedParameters?: string[];
}): string {
  const headerComp = params.components.find(
    (c) => String(c.type ?? '').trim().toUpperCase() === 'HEADER'
  );
  const bodyComp = params.components.find(
    (c) => String(c.type ?? '').trim().toUpperCase() === 'BODY'
  );
  const footerComp = params.components.find(
    (c) => String(c.type ?? '').trim().toUpperCase() === 'FOOTER'
  );

  const headerText =
    headerComp &&
    String(headerComp.format ?? (headerComp.text ? 'TEXT' : '')).trim().toUpperCase() === 'TEXT' &&
    typeof headerComp.text === 'string'
      ? headerComp.text.trim()
      : '';

  let bodyText = typeof bodyComp?.text === 'string' ? bodyComp.text.trim() : '';
  if (bodyText && params.sanitizedParameters && params.sanitizedParameters.length > 0) {
    bodyText = bodyText.replace(/\{\{(\d+)\}\}/g, (match, rawIdx: string) => {
      const idx = Number(rawIdx) - 1;
      return idx >= 0 && idx < params.sanitizedParameters!.length
        ? params.sanitizedParameters![idx]
        : match;
    });
  }

  const footerText = typeof footerComp?.text === 'string' ? footerComp.text.trim() : '';

  const sections = [headerText, bodyText, footerText].filter((part) => part.length > 0);
  if (sections.length > 0) {
    return sections.join('\n\n').slice(0, 4096);
  }

  return `[WhatsApp Template: ${params.templateName} (${params.language})]`;
}

function validateTemplateComponentsAndParams(params: {
  templateName: string;
  language: string;
  components: unknown;
  providedParameters?: string[];
}):
  | { ok: true; sanitizedParameters?: string[]; renderedBody: string }
  | { ok: false; code: string; error: string } {
  const components = coerceTemplateComponents(params.components);
  const rawParams = Array.isArray(params.providedParameters)
    ? params.providedParameters.map((v) => String(v))
    : [];

  // 1. Reject unsupported top-level component types (e.g., CAROUSEL, LIMITED_TIME_OFFER)
  for (const comp of components) {
    const compType = String(comp.type ?? '').trim().toUpperCase();
    if (!compType || !SUPPORTED_COMPONENT_TYPES.has(compType)) {
      return {
        ok: false,
        code: 'TEMPLATE_UNSUPPORTED_COMPONENT',
        error: `Template "${params.templateName}" contains an unsupported component type ("${compType || 'UNKNOWN'}") and cannot be sent by this endpoint.`,
      };
    }

    if (compType === 'HEADER') {
      const headerFormat = String(comp.format ?? (comp.text ? 'TEXT' : 'NONE'))
        .trim()
        .toUpperCase();

      if (headerFormat !== 'NONE' && headerFormat !== 'TEXT') {
        return {
          ok: false,
          code: 'TEMPLATE_UNSUPPORTED_COMPONENT',
          error: `Template "${params.templateName}" uses a ${headerFormat} header component, which is not supported for sending yet.`,
        };
      }

      if (
        headerFormat === 'TEXT' &&
        typeof comp.text === 'string' &&
        /\{\{[^}]+\}\}/.test(comp.text)
      ) {
        return {
          ok: false,
          code: 'TEMPLATE_UNSUPPORTED_COMPONENT',
          error: `Template "${params.templateName}" requires dynamic header parameters, which are not supported for sending yet.`,
        };
      }
    }

    if (compType === 'BUTTONS' && Array.isArray(comp.buttons)) {
      for (const rawBtn of comp.buttons as TemplateButtonRecord[]) {
        if (!rawBtn || typeof rawBtn !== 'object') continue;
        const btnType = String(rawBtn.type ?? '').trim().toUpperCase();
        if (!SUPPORTED_STATIC_BUTTON_TYPES.has(btnType)) {
          return {
            ok: false,
            code: 'TEMPLATE_UNSUPPORTED_COMPONENT',
            error: `Template "${params.templateName}" includes an unsupported interactive button type ("${btnType || 'UNKNOWN'}") that requires send-time parameters.`,
          };
        }
        if (
          btnType === 'URL' &&
          typeof rawBtn.url === 'string' &&
          /\{\{[^}]+\}\}/.test(rawBtn.url)
        ) {
          return {
            ok: false,
            code: 'TEMPLATE_UNSUPPORTED_COMPONENT',
            error: `Template "${params.templateName}" contains a dynamic URL button parameter, which is not supported for sending yet.`,
          };
        }
      }
    }
  }

  // 2. Validate BODY component parameters against Meta placeholders
  const bodyComp = components.find(
    (c) => String(c.type ?? '').trim().toUpperCase() === 'BODY'
  );

  let sanitizedParameters: string[] | undefined = undefined;

  if (bodyComp && typeof bodyComp.text === 'string') {
    const matches = Array.from(bodyComp.text.matchAll(/\{\{([^}]+)\}\}/g));
    const tokens = matches.map((m) => String(m[1] ?? '').trim()).filter(Boolean);
    const nonNumericTokens = tokens.filter((t) => !/^\d+$/.test(t));

    if (nonNumericTokens.length > 0) {
      return {
        ok: false,
        code: 'TEMPLATE_UNSUPPORTED_COMPONENT',
        error: `Template "${params.templateName}" uses named body parameters ({{${nonNumericTokens[0]}}}), which are not supported for sending yet.`,
      };
    }

    const numericIndices = tokens
      .map((t) => Number(t))
      .filter((n) => Number.isInteger(n) && n > 0);
    const requiredBodyParams = numericIndices.length > 0 ? Math.max(...numericIndices) : 0;

    if (requiredBodyParams > 0) {
      if (rawParams.length < requiredBodyParams) {
        return {
          ok: false,
          code: 'TEMPLATE_PARAMETERS_MISSING',
          error: `Template "${params.templateName}" requires ${requiredBodyParams} body parameter(s), but ${rawParams.length} were provided.`,
        };
      }
      if (rawParams.length > requiredBodyParams) {
        return {
          ok: false,
          code: 'TEMPLATE_PARAMETERS_MISMATCH',
          error: `Template "${params.templateName}" accepts ${requiredBodyParams} body parameter(s), but ${rawParams.length} were provided.`,
        };
      }
      for (let i = 0; i < rawParams.length; i++) {
        const val = rawParams[i].trim();
        if (!val) {
          return {
            ok: false,
            code: 'TEMPLATE_PARAMETER_EMPTY',
            error: `Template parameter #${i + 1} cannot be empty.`,
          };
        }
        if (val.length > 1024) {
          return {
            ok: false,
            code: 'TEMPLATE_PARAMETER_TOO_LONG',
            error: `Template parameter #${i + 1} exceeds WhatsApp's 1,024-character limit.`,
          };
        }
      }
      sanitizedParameters = rawParams.map((v) => v.trim());
    } else if (rawParams.length > 0) {
      return {
        ok: false,
        code: 'TEMPLATE_PARAMETERS_UNEXPECTED',
        error: `Template "${params.templateName}" does not accept body parameters.`,
      };
    }
  } else if (rawParams.length > 0) {
    for (let i = 0; i < rawParams.length; i++) {
      const val = rawParams[i].trim();
      if (!val) {
        return {
          ok: false,
          code: 'TEMPLATE_PARAMETER_EMPTY',
          error: `Template parameter #${i + 1} cannot be empty.`,
        };
      }
      if (val.length > 1024) {
        return {
          ok: false,
          code: 'TEMPLATE_PARAMETER_TOO_LONG',
          error: `Template parameter #${i + 1} exceeds WhatsApp's 1,024-character limit.`,
        };
      }
    }
    sanitizedParameters = rawParams.map((v) => v.trim());
  }

  const renderedBody = renderTemplateTextFromComponents({
    templateName: params.templateName,
    language: params.language,
    components,
    sanitizedParameters,
  });

  return { ok: true, sanitizedParameters, renderedBody };
}

function buildIdempotentResponse(
  existingMsg: Record<string, unknown>,
  clientRequestId: string
): Response {
  const status = String(existingMsg.delivery_status ?? '').trim().toLowerCase();

  logEvent('duplicate_event', status === 'failed' || status === 'pending' ? 'warn' : 'info', 'Handled duplicate clientRequestId', {
    messageId: existingMsg.id,
    clientRequestId,
    deliveryStatus: status || 'unknown',
  });

  // Confirmed Meta-accepted message states: safe idempotent replay without re-sending to Meta
  if (status === 'submitted' || status === 'sent' || status === 'delivered' || status === 'read') {
    return jsonResponse(
      {
        ok: true,
        idempotentReplay: true,
        code: 'IDEMPOTENT_REPLAY',
        deliveryStatus: status,
        metaMessageId: existingMsg.meta_message_id ?? null,
        message: existingMsg,
      },
      200
    );
  }

  // Failed request: NEVER report ok: true
  if (status === 'failed') {
    return jsonResponse(
      {
        ok: false,
        idempotentReplay: true,
        code: 'IDEMPOTENT_REQUEST_FAILED',
        deliveryStatus: 'failed',
        metaMessageId: existingMsg.meta_message_id ?? null,
        error:
          'A previous send attempt with this clientRequestId failed. Review the error and send with a new clientRequestId if you intend to retry.',
        originalErrorCode: existingMsg.error_code ?? null,
        originalErrorMessage: existingMsg.error_message ?? null,
        message: existingMsg,
      },
      409
    );
  }

  // Pending / in-flight / timed-out uncertain request: NEVER trigger duplicate send and NEVER report confirmed sent
  if (status === 'pending') {
    return jsonResponse(
      {
        ok: false,
        idempotentReplay: true,
        code: 'IDEMPOTENT_REQUEST_IN_PROGRESS',
        deliveryStatus: 'pending',
        reconciliationRequired: Boolean(existingMsg.error_code),
        doNotResend: true,
        metaMessageId: existingMsg.meta_message_id ?? null,
        error:
          'A send attempt with this clientRequestId is still pending or awaiting confirmation. Do not resend to avoid duplicate customer messages.',
        message: existingMsg,
      },
      409
    );
  }

  return jsonResponse(
    {
      ok: false,
      idempotentReplay: true,
      code: 'IDEMPOTENT_REQUEST_CONFLICT',
      deliveryStatus: status || 'unknown',
      metaMessageId: existingMsg.meta_message_id ?? null,
      error: 'A message record with this clientRequestId already exists in a non-replayable state.',
      message: existingMsg,
    },
    409
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method Not Allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResponse({ ok: false, error: 'Server configuration error' }, 500);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Authenticate caller
    const { data: userRes, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userRes.user) {
      return jsonResponse({ ok: false, error: 'Invalid or expired user session' }, 401);
    }
    const callerId = userRes.user.id;

    // 2. Parse & validate request payload (strictly 1-to-1 text or template; no bulk/campaigns)
    const payload = (await req.json().catch(() => ({}))) as {
      conversationId?: string;
      messageType?: string;
      body?: string;
      templateName?: string;
      language?: string;
      templateParameters?: string[];
      clientRequestId?: string;
    };

    const conversationId = String(payload.conversationId ?? '').trim();
    const messageType = String(payload.messageType ?? 'text').trim();
    const rawFreeformBody = typeof payload.body === 'string' ? payload.body.trim() : '';
    const templateName = payload.templateName ? String(payload.templateName).trim() : undefined;
    const clientRequestId = payload.clientRequestId ? String(payload.clientRequestId).trim() : undefined;

    if (!UUID_REGEX.test(conversationId)) {
      return jsonResponse({ ok: false, code: 'INVALID_CONVERSATION_ID', error: 'Invalid conversation ID.' }, 400);
    }

    if (messageType !== 'text' && messageType !== 'template') {
      return jsonResponse(
        {
          ok: false,
          code: 'UNSUPPORTED_MESSAGE_TYPE',
          error: 'Only 1-to-1 text replies and approved template messages are supported.',
        },
        400
      );
    }

    // Only free-form text messages require payload.body; template content comes strictly from Meta template components JSONB
    if (messageType === 'text') {
      if (!rawFreeformBody) {
        return jsonResponse({ ok: false, code: 'EMPTY_MESSAGE', error: 'Message text cannot be empty.' }, 400);
      }
      if (rawFreeformBody.length > 4096) {
        return jsonResponse(
          { ok: false, code: 'MESSAGE_TOO_LONG', error: 'WhatsApp messages cannot exceed 4,096 characters.' },
          400
        );
      }
    }

    if (clientRequestId && clientRequestId.length > 128) {
      return jsonResponse({ ok: false, code: 'INVALID_CLIENT_REQUEST_ID', error: 'Invalid client request ID.' }, 400);
    }

    if (messageType === 'template' && !templateName) {
      return jsonResponse(
        { ok: false, code: 'TEMPLATE_REQUIRED', error: 'Template name is required for template messages.' },
        400
      );
    }

    // 3. Load target conversation & contact
    const { data: conversation, error: convErr } = await serviceClient
      .from('conversations')
      .select(
        'id, business_id, assigned_to, window_expires_at, contact:contacts(id, full_name, phone_e164, wa_id, marketing_opt_in, opted_out_at)'
      )
      .eq('id', conversationId)
      .maybeSingle();

    if (convErr || !conversation) {
      return jsonResponse({ ok: false, code: 'CONVERSATION_NOT_FOUND', error: 'Conversation not found.' }, 404);
    }

    const businessId = String(conversation.business_id);

    // 4. Verify active business membership & authorization (admin or assigned/unassigned agent)
    const { data: membership, error: membershipErr } = await serviceClient
      .from('business_members')
      .select('role, is_active')
      .eq('business_id', businessId)
      .eq('user_id', callerId)
      .eq('is_active', true)
      .maybeSingle();

    if (membershipErr) {
      logEvent('permission_error', 'error', 'Failed to verify business membership', {
        callerId,
        businessId,
        error: membershipErr.message,
      });
      return jsonResponse(
        { ok: false, code: 'MEMBERSHIP_CHECK_FAILED', error: 'Failed to verify workspace permissions.' },
        500
      );
    }

    if (
      !membership ||
      membership.is_active !== true ||
      (membership.role !== 'admin' && membership.role !== 'agent')
    ) {
      logEvent('permission_error', 'warn', 'Unauthorized send attempt', { callerId, businessId });
      return jsonResponse({ ok: false, code: 'FORBIDDEN', error: 'You are not authorized for this workspace.' }, 403);
    }

    if (membership.role === 'agent' && conversation.assigned_to !== null && conversation.assigned_to !== callerId) {
      logEvent('permission_error', 'warn', 'Agent attempted send on conversation assigned to another user', {
        callerId,
        conversationId,
      });
      return jsonResponse(
        { ok: false, code: 'CONVERSATION_ASSIGNED_TO_OTHER', error: 'This conversation is assigned to another team member.' },
        403
      );
    }

    // 5. Idempotency check (strict handling for submitted, pending, and failed records)
    if (clientRequestId) {
      const { data: existingMsg, error: existingMsgErr } = await serviceClient
        .from('messages')
        .select('*')
        .eq('business_id', businessId)
        .eq('client_request_id', clientRequestId)
        .maybeSingle();

      if (existingMsgErr) {
        logEvent('persistence_error', 'error', 'Failed idempotency lookup on messages', {
          businessId,
          clientRequestId,
          error: existingMsgErr.message,
        });
        return jsonResponse(
          {
            ok: false,
            code: 'IDEMPOTENCY_CHECK_FAILED',
            error: 'Could not verify request idempotency state. Wait and verify before retrying.',
          },
          500
        );
      }

      if (existingMsg) {
        return buildIdempotentResponse(existingMsg as Record<string, unknown>, clientRequestId);
      }
    }

    // 6. Load business WhatsApp account & runtime Meta credentials
    const { data: waAccount } = await serviceClient
      .from('whatsapp_accounts')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const accessToken =
      Deno.env.get('META_ACCESS_TOKEN')?.trim() ||
      Deno.env.get('META_WHATSAPP_ACCESS_TOKEN')?.trim() ||
      '';
    const rawAccountPhoneId = String(
      waAccount?.phone_number_id ?? waAccount?.meta_phone_number_id ?? ''
    ).trim();
    const phoneNumberId =
      (rawAccountPhoneId && rawAccountPhoneId !== 'unconfigured' ? rawAccountPhoneId : '') ||
      Deno.env.get('META_PHONE_NUMBER_ID')?.trim() ||
      '';
    const graphApiVersion = resolveGraphApiVersion(
      waAccount?.graph_api_version ? String(waAccount.graph_api_version) : undefined
    );

    if (!accessToken || !phoneNumberId) {
      return jsonResponse(
        {
          ok: false,
          code: 'META_NOT_CONFIGURED',
          error: 'Meta WhatsApp Cloud API credentials are not configured on the server.',
        },
        422
      );
    }

    const accountConnStatus = waAccount?.connection_status ?? waAccount?.status;
    if (!waAccount || accountConnStatus !== 'connected') {
      return jsonResponse(
        {
          ok: false,
          code: 'WHATSAPP_NOT_CONNECTED',
          error: 'Verify your WhatsApp connection in Settings before sending live messages.',
        },
        400
      );
    }

    // 7. Normalize recipient phone / wa_id
    const contactObj = Array.isArray(conversation.contact)
      ? (conversation.contact[0] as Record<string, unknown> | undefined)
      : (conversation.contact as Record<string, unknown> | undefined);

    if (!contactObj?.phone_e164) {
      return jsonResponse({ ok: false, code: 'CONTACT_MISSING_PHONE', error: 'Customer phone number is missing.' }, 400);
    }

    const recipientE164 = normalizePhoneToE164(String(contactObj.phone_e164));
    const recipientWaId = normalizeWaId(String(contactObj.wa_id || contactObj.phone_e164));
    if (!recipientE164 || !recipientWaId) {
      return jsonResponse({ ok: false, code: 'INVALID_RECIPIENT_PHONE', error: 'Customer phone number is not valid E.164.' }, 400);
    }

    // 8. Enforce Test Mode Allowlist server-side
    const messagingMode = waAccount.messaging_mode === 'live' ? 'live' : 'test';
    if (messagingMode === 'test') {
      const allowlist = Array.isArray(waAccount.test_allowlist)
        ? waAccount.test_allowlist
            .map((p) => normalizePhoneToE164(String(p)))
            .filter((p): p is string => Boolean(p))
        : [];

      if (!allowlist.includes(recipientE164)) {
        logEvent('permission_error', 'warn', 'Blocked outbound send in Test Mode (not allowlisted)', {
          businessId,
          recipient: maskPhone(recipientE164),
        });
        return jsonResponse(
          {
            ok: false,
            code: 'TEST_MODE_RECIPIENT_NOT_ALLOWED',
            error:
              'Test Mode is active. Add this customer phone number to your Test Allowlist in Settings before sending.',
          },
          403
        );
      }
    }

    // 9. Enforce 24-hour customer service window for free-form text replies
    const windowExpiresMs = conversation.window_expires_at
      ? new Date(String(conversation.window_expires_at)).getTime()
      : 0;
    const windowOpen = !Number.isNaN(windowExpiresMs) && windowExpiresMs > Date.now();

    if (messageType === 'text' && !windowOpen) {
      return jsonResponse(
        {
          ok: false,
          code: 'WINDOW_EXPIRED',
          error:
            'The 24-hour customer service window has closed. Send an approved WhatsApp template message to re-engage.',
        },
        400
      );
    }

    // 10. Validate approved template against real public.templates schema (status, components, meta_template_id)
    let resolvedLanguage = payload.language ? String(payload.language).trim() : 'en_US';
    let validatedTemplateParameters: string[] | undefined = undefined;
    let storedMessageBody = rawFreeformBody;

    if (messageType === 'template') {
      const { data: tplRows, error: tplErr } = await serviceClient
        .from('templates')
        .select('id, business_id, meta_template_id, name, language, category, status, components')
        .eq('business_id', businessId)
        .eq('name', templateName!);

      if (tplErr) {
        logEvent('meta_api_error', 'error', 'Failed to query public.templates for template send', {
          businessId,
          templateName,
          errorCode: tplErr.code,
          error: tplErr.message,
        });
        return jsonResponse(
          {
            ok: false,
            code: 'TEMPLATE_LOOKUP_FAILED',
            error: `Unable to verify WhatsApp template approval status: ${tplErr.message}`,
          },
          500
        );
      }

      const matchingRows = Array.isArray(tplRows)
        ? (tplRows as Array<Record<string, unknown>>)
        : [];

      const requestedLang = payload.language ? String(payload.language).trim() : '';
      let tplRow: Record<string, unknown> | undefined;

      if (requestedLang) {
        tplRow = matchingRows.find(
          (row) => String(row.language ?? '').trim().toLowerCase() === requestedLang.toLowerCase()
        );
      } else {
        tplRow =
          matchingRows.find(
            (row) => String(row.status ?? '').trim().toLowerCase() === 'approved'
          ) ?? matchingRows[0];
      }

      if (!tplRow) {
        return jsonResponse(
          {
            ok: false,
            code: 'TEMPLATE_NOT_FOUND',
            error: requestedLang
              ? `WhatsApp template "${templateName}" (${requestedLang}) was not found in this workspace. Sync templates from Meta and try again.`
              : `WhatsApp template "${templateName}" was not found in this workspace. Sync templates from Meta and try again.`,
          },
          404
        );
      }

      const normalizedStatus = String(tplRow.status ?? '').trim().toLowerCase();
      if (normalizedStatus !== 'approved') {
        const statusResponses: Record<string, { code: string; error: string }> = {
          pending: {
            code: 'TEMPLATE_PENDING',
            error: `Template "${templateName}" is still pending Meta approval and cannot be sent yet.`,
          },
          rejected: {
            code: 'TEMPLATE_REJECTED',
            error: `Template "${templateName}" was rejected by Meta and cannot be sent.`,
          },
          paused: {
            code: 'TEMPLATE_PAUSED',
            error: `Template "${templateName}" is paused by Meta and cannot be sent.`,
          },
          disabled: {
            code: 'TEMPLATE_DISABLED',
            error: `Template "${templateName}" is disabled in Meta and cannot be sent.`,
          },
          draft: {
            code: 'TEMPLATE_NOT_APPROVED',
            error: `Template "${templateName}" is a local draft and has not been approved by Meta.`,
          },
        };

        const denial = statusResponses[normalizedStatus] ?? {
          code: 'TEMPLATE_NOT_APPROVED',
          error: `Selected template "${templateName}" is not approved in your Meta WhatsApp Business account (status: ${normalizedStatus || 'unknown'}).`,
        };

        logEvent('permission_error', 'warn', 'Blocked unapproved template send attempt', {
          businessId,
          templateName,
          templateStatus: normalizedStatus || 'unknown',
        });

        return jsonResponse(
          {
            ok: false,
            code: denial.code,
            error: denial.error,
          },
          400
        );
      }

      const metaTemplateId = String(tplRow.meta_template_id ?? '').trim();
      if (!metaTemplateId) {
        return jsonResponse(
          {
            ok: false,
            code: 'TEMPLATE_NOT_SYNCED_WITH_META',
            error: `Template "${templateName}" is missing a verified Meta template ID. Sync templates from Meta before sending.`,
          },
          400
        );
      }

      resolvedLanguage = String(tplRow.language ?? resolvedLanguage).trim() || 'en_US';

      // Enforce customer opt-out and marketing consent restrictions on business-initiated templates
      const normalizedCategory = String(tplRow.category ?? '').trim().toUpperCase();
      if (contactObj.opted_out_at) {
        return jsonResponse(
          {
            ok: false,
            code: 'CONTACT_OPTED_OUT',
            error: 'This customer has opted out of outbound WhatsApp template messages.',
          },
          400
        );
      }
      if (normalizedCategory === 'MARKETING' && !contactObj.marketing_opt_in) {
        return jsonResponse(
          {
            ok: false,
            code: 'CONTACT_OPTED_OUT',
            error: 'This customer has not opted in to marketing template messages.',
          },
          400
        );
      }

      const paramCheck = validateTemplateComponentsAndParams({
        templateName: String(tplRow.name ?? templateName),
        language: resolvedLanguage,
        components: tplRow.components,
        providedParameters: Array.isArray(payload.templateParameters)
          ? payload.templateParameters.map(String)
          : undefined,
      });

      if (!paramCheck.ok) {
        return jsonResponse(
          {
            ok: false,
            code: paramCheck.code,
            error: paramCheck.error,
          },
          400
        );
      }

      validatedTemplateParameters = paramCheck.sanitizedParameters;
      // Canonical template body derived strictly from verified Meta components JSONB
      storedMessageBody = paramCheck.renderedBody;
    }

    // 11. Create pending message record before calling Meta Graph API
    const { data: createdMsg, error: insErr } = await serviceClient
      .from('messages')
      .insert({
        business_id: businessId,
        conversation_id: conversationId,
        sender_type: 'agent',
        sender_profile_id: callerId,
        direction: 'outbound',
        message_type: messageType,
        body: storedMessageBody,
        template_name: messageType === 'template' ? templateName : null,
        client_request_id: clientRequestId ?? null,
        delivery_status: 'pending',
      })
      .select('*')
      .single();

    if (insErr) {
      if (insErr.code === '23505' && clientRequestId) {
        const { data: raceMsg, error: raceErr } = await serviceClient
          .from('messages')
          .select('*')
          .eq('business_id', businessId)
          .eq('client_request_id', clientRequestId)
          .maybeSingle();

        if (!raceErr && raceMsg) {
          return buildIdempotentResponse(raceMsg as Record<string, unknown>, clientRequestId);
        }

        return jsonResponse(
          {
            ok: false,
            idempotentReplay: true,
            code: 'IDEMPOTENT_CONFLICT_UNRESOLVED',
            error:
              'A concurrent request with this clientRequestId already exists, and its current state could not be loaded. Check message history before retrying.',
          },
          409
        );
      }
      return jsonResponse({ ok: false, code: 'MESSAGE_CREATE_FAILED', error: insErr.message }, 500);
    }

    await serviceClient.from('message_events').insert({
      business_id: businessId,
      message_id: createdMsg.id,
      event_type: 'pending',
      raw_payload: { client_request_id: clientRequestId ?? null },
    });

    // 12. Dispatch to Official Meta WhatsApp Cloud API
    const metaResult = await dispatchMetaMessage({
      graphApiVersion,
      phoneNumberId,
      accessToken,
      recipientWaId,
      messageType: messageType as 'text' | 'template',
      body: messageType === 'text' ? storedMessageBody : undefined,
      templateName,
      language: resolvedLanguage,
      templateParameters: validatedTemplateParameters,
    });

    const nowIso = new Date().toISOString();

    if (!metaResult.ok || !metaResult.metaMessageId) {
      // If the Meta POST timed out / dropped mid-flight, keep status as 'pending' (uncertain) to block blind retries
      if (metaResult.uncertain) {
        const { data: uncertainMsg, error: uncertainUpdErr } = await serviceClient
          .from('messages')
          .update({
            last_status_at: nowIso,
            error_code: metaResult.errorCode ?? 'META_REQUEST_TIMEOUT',
            error_message: metaResult.userMessage ?? metaResult.diagnosticMessage ?? 'Uncertain Meta delivery state.',
          })
          .eq('id', createdMsg.id)
          .select('*')
          .single();

        if (uncertainUpdErr) {
          logEvent('persistence_error', 'error', 'Failed recording uncertain Meta timeout state on message', {
            businessId,
            messageId: createdMsg.id,
            error: uncertainUpdErr.message,
          });
        }

        return jsonResponse(
          {
            ok: false,
            code: metaResult.errorCode ?? 'META_REQUEST_TIMEOUT',
            deliveryStatus: 'pending',
            reconciliationRequired: true,
            doNotResend: true,
            messageId: createdMsg.id,
            error: metaResult.userMessage,
            diagnostic: metaResult.diagnosticMessage,
            message: uncertainMsg ?? createdMsg,
          },
          metaResult.httpStatus
        );
      }

      const { data: failedMsg, error: failUpdErr } = await serviceClient
        .from('messages')
        .update({
          delivery_status: 'failed',
          failed_at: nowIso,
          last_status_at: nowIso,
          error_code: metaResult.errorCode ?? 'META_SEND_FAILED',
          error_message: metaResult.userMessage ?? metaResult.diagnosticMessage ?? 'Meta rejected message.',
        })
        .eq('id', createdMsg.id)
        .select('*')
        .single();

      if (failUpdErr) {
        logEvent('persistence_error', 'error', 'Failed updating rejected message to failed status', {
          businessId,
          messageId: createdMsg.id,
          error: failUpdErr.message,
        });
      }

      await serviceClient.from('message_events').insert({
        business_id: businessId,
        message_id: createdMsg.id,
        event_type: 'failed',
        raw_payload: metaResult.rawResponse ?? {
          code: metaResult.errorCode,
          diagnostic: metaResult.diagnosticMessage,
        },
      });

      return jsonResponse(
        {
          ok: false,
          code: metaResult.errorCode ?? 'META_SEND_FAILED',
          deliveryStatus: 'failed',
          error: metaResult.userMessage ?? 'WhatsApp could not send this message.',
          diagnostic: metaResult.diagnosticMessage,
          message: failedMsg ?? createdMsg,
        },
        metaResult.httpStatus
      );
    }

    // 13. Meta accepted message -> explicitly verify DB update to 'submitted'
    const { data: submittedMsg, error: submitUpdateErr } = await serviceClient
      .from('messages')
      .update({
        delivery_status: 'submitted',
        meta_message_id: metaResult.metaMessageId,
        submitted_at: nowIso,
        last_status_at: nowIso,
        error_code: null,
        error_message: null,
      })
      .eq('id', createdMsg.id)
      .select('*')
      .single();

    if (submitUpdateErr || !submittedMsg) {
      logEvent('persistence_error', 'error', 'Meta accepted message but messages DB update failed (reconciliation required)', {
        businessId,
        conversationId,
        messageId: createdMsg.id,
        metaMessageId: metaResult.metaMessageId,
        clientRequestId: clientRequestId ?? null,
        errorCode: submitUpdateErr?.code ?? 'NO_ROW_RETURNED',
        error: submitUpdateErr?.message ?? 'messages update returned no row',
      });

      // Best-effort audit trail in message_events so meta_message_id is preserved for reconciliation
      await serviceClient
        .from('message_events')
        .insert({
          business_id: businessId,
          message_id: createdMsg.id,
          event_type: 'submitted',
          raw_payload: {
            reconciliation_required: true,
            meta_message_id: metaResult.metaMessageId,
            db_update_error: submitUpdateErr?.message ?? 'messages update returned no row',
            meta_response: metaResult.rawResponse ?? null,
          },
        })
        .then(({ error: evtErr }) => {
          if (evtErr) {
            logEvent('persistence_error', 'error', 'Fallback message_events reconciliation insert also failed', {
              businessId,
              messageId: createdMsg.id,
              metaMessageId: metaResult.metaMessageId,
              error: evtErr.message,
            });
          }
        });

      return jsonResponse(
        {
          ok: false,
          code: 'PERSISTENCE_RECONCILIATION_REQUIRED',
          reconciliationRequired: true,
          metaAccepted: true,
          doNotResend: true,
          deliveryStatus: 'pending',
          messageId: createdMsg.id,
          metaMessageId: metaResult.metaMessageId,
          error:
            'WhatsApp accepted this message, but recording the confirmation in Supabase failed. Do NOT resend this message; reconcile the pending record using metaMessageId and messageId.',
          diagnostic: submitUpdateErr?.message ?? 'messages UPDATE returned no row',
          message: createdMsg,
        },
        500
      );
    }

    const { error: eventErr } = await serviceClient.from('message_events').insert({
      business_id: businessId,
      message_id: createdMsg.id,
      event_type: 'submitted',
      raw_payload: metaResult.rawResponse ?? { meta_message_id: metaResult.metaMessageId },
    });
    if (eventErr) {
      logEvent('persistence_error', 'warn', 'Non-fatal message_events submitted insert failure', {
        businessId,
        messageId: createdMsg.id,
        error: eventErr.message,
      });
    }

    const { error: convUpdErr } = await serviceClient
      .from('conversations')
      .update({
        last_message_preview: storedMessageBody.slice(0, 140),
        last_message_at: nowIso,
        unread_count: 0,
      })
      .eq('id', conversationId);
    if (convUpdErr) {
      logEvent('persistence_error', 'warn', 'Non-fatal conversations preview update failure', {
        businessId,
        conversationId,
        error: convUpdErr.message,
      });
    }

    const { error: contactUpdErr } = await serviceClient
      .from('contacts')
      .update({ last_contacted_at: nowIso })
      .eq('id', String(contactObj.id));
    if (contactUpdErr) {
      logEvent('persistence_error', 'warn', 'Non-fatal contacts last_contacted_at update failure', {
        businessId,
        contactId: contactObj.id,
        error: contactUpdErr.message,
      });
    }

    return jsonResponse({
      ok: true,
      deliveryStatus: 'submitted',
      metaMessageId: metaResult.metaMessageId,
      message: submittedMsg,
    });
  } catch (err) {
    logEvent('meta_api_error', 'error', 'Unhandled exception in whatsapp-send-message', {
      error: (err as Error).message,
    });
    return jsonResponse({ ok: false, error: 'Unexpected error while sending message.' }, 500);
  }
});
