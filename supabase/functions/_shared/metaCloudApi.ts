import { logEvent, maskPhone } from './logger.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function jsonResponse(
  body: Record<string, unknown>,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export interface MetaRuntimeConfig {
  appId: string;
  appSecret: string;
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  webhookVerifyToken: string;
  graphApiVersion: string;
}

const VALID_GRAPH_VERSION = /^v(1[89]|2[0-9])\.0$/;
const DEFAULT_GRAPH_VERSION = 'v25.0';

export function resolveGraphApiVersion(requested?: string | null): string {
  const envVer = Deno.env.get('META_GRAPH_API_VERSION')?.trim();
  if (envVer && VALID_GRAPH_VERSION.test(envVer)) return envVer;
  const candidate = requested?.trim();
  if (candidate && VALID_GRAPH_VERSION.test(candidate)) return candidate;
  return DEFAULT_GRAPH_VERSION;
}

export function getMetaRuntimeConfig(overrides?: {
  phoneNumberId?: string | null;
  wabaId?: string | null;
  graphApiVersion?: string | null;
}): MetaRuntimeConfig {
  const accessToken =
    Deno.env.get('META_ACCESS_TOKEN')?.trim() ||
    Deno.env.get('META_WHATSAPP_ACCESS_TOKEN')?.trim() ||
    '';

  return {
    appId: Deno.env.get('META_APP_ID')?.trim() ?? '',
    appSecret: Deno.env.get('META_APP_SECRET')?.trim() ?? '',
    accessToken,
    wabaId: overrides?.wabaId?.trim() || Deno.env.get('META_WABA_ID')?.trim() || '',
    phoneNumberId:
      overrides?.phoneNumberId?.trim() ||
      Deno.env.get('META_PHONE_NUMBER_ID')?.trim() ||
      '',
    webhookVerifyToken: Deno.env.get('META_WEBHOOK_VERIFY_TOKEN')?.trim() ?? '',
    graphApiVersion: resolveGraphApiVersion(overrides?.graphApiVersion),
  };
}

export function normalizeWaId(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15 || digits.startsWith('0')) {
    return null;
  }
  return digits;
}

export function normalizePhoneToE164(raw: string): string | null {
  const waId = normalizeWaId(raw);
  if (!waId) return null;
  return `+${waId}`;
}

export type CanonicalDeliveryStatus =
  | 'pending'
  | 'queued'
  | 'submitted'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'internal';

const DELIVERY_RANK: Record<string, number> = {
  pending: 0,
  queued: 0,
  submitted: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

export function shouldAdvanceStatus(
  currentStatus: string,
  incomingStatus: string
): boolean {
  if (currentStatus === 'internal') return false;

  if (incomingStatus === 'failed') {
    // Never downgrade delivered/read to failed from out-of-order delivery
    return (DELIVERY_RANK[currentStatus] ?? -1) < 3 && currentStatus !== 'failed';
  }

  const incomingRank = DELIVERY_RANK[incomingStatus];
  if (incomingRank === undefined) return false;

  if (currentStatus === 'failed') {
    // Allow recovery only if Meta subsequently confirms sent/delivered/read
    return incomingRank >= 2;
  }

  const currentRank = DELIVERY_RANK[currentStatus] ?? -1;
  return incomingRank > currentRank;
}

export interface ClassifiedMetaError {
  code: string;
  httpStatus: number;
  userMessage: string;
  diagnosticMessage: string;
}

export function classifyMetaError(
  httpStatus: number,
  metaPayload: Record<string, unknown> | null
): ClassifiedMetaError {
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
      userMessage: 'The Phone Number ID or WhatsApp Business Account ID is invalid.',
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

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): Promise<boolean> {
  if (!appSecret || !signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const providedHex = signatureHeader.slice(7).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(providedHex)) {
    return false;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expectedHex = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return constantTimeEqualHex(providedHex, expectedHex);
}

async function fetchMetaWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 12000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface MetaConnectionCheckResult {
  ok: boolean;
  status: 'not_connected' | 'connecting' | 'connected' | 'error';
  phoneNumberId?: string;
  wabaId?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: 'green' | 'yellow' | 'red' | 'unknown';
  codeVerificationStatus?: string;
  errorCode?: string;
  userMessage?: string;
  diagnosticMessage?: string;
}

function normalizeQualityRating(raw?: string | null): 'green' | 'yellow' | 'red' | 'unknown' {
  const lower = (raw ?? '').toLowerCase();
  if (lower === 'green' || lower === 'yellow' || lower === 'red') return lower;
  return 'unknown';
}

export async function verifyMetaConnection(
  config: MetaRuntimeConfig
): Promise<MetaConnectionCheckResult> {
  if (!config.accessToken || !config.phoneNumberId || !config.wabaId) {
    return {
      ok: false,
      status: 'not_connected',
      errorCode: 'META_SECRETS_MISSING',
      userMessage:
        'Meta access token, Phone Number ID, and WABA ID must all be configured before verifying.',
      diagnosticMessage: 'Missing one or more of META_ACCESS_TOKEN, phoneNumberId, wabaId.',
    };
  }

  try {
    const phoneUrl =
      `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(config.phoneNumberId)}` +
      `?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`;

    const phoneRes = await fetchMetaWithTimeout(phoneUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    });

    const phoneJson = (await phoneRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!phoneRes.ok) {
      const classified = classifyMetaError(phoneRes.status, phoneJson);
      logEvent('meta_api_error', 'error', 'Phone number verification failed', {
        code: classified.code,
        diagnosticMessage: classified.diagnosticMessage,
      });
      return {
        ok: false,
        status: 'error',
        errorCode: classified.code,
        userMessage: classified.userMessage,
        diagnosticMessage: classified.diagnosticMessage,
      };
    }

    // Verify WABA accessibility
    const wabaUrl =
      `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(config.wabaId)}` +
      `?fields=id,name`;
    const wabaRes = await fetchMetaWithTimeout(wabaUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    });
    const wabaJson = (await wabaRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!wabaRes.ok) {
      const classified = classifyMetaError(wabaRes.status, wabaJson);
      logEvent('meta_api_error', 'error', 'WABA verification failed', {
        code: classified.code,
        diagnosticMessage: classified.diagnosticMessage,
      });
      return {
        ok: false,
        status: 'error',
        errorCode: classified.code,
        userMessage: classified.userMessage,
        diagnosticMessage: classified.diagnosticMessage,
      };
    }

    const displayPhone = normalizePhoneToE164(String(phoneJson.display_phone_number ?? '')) ?? undefined;
    const verifiedName = typeof phoneJson.verified_name === 'string'
      ? phoneJson.verified_name
      : typeof wabaJson.name === 'string'
      ? wabaJson.name
      : undefined;

    logEvent('connection_check', 'info', 'Meta WhatsApp connection verified', {
      phoneNumberId: config.phoneNumberId,
      wabaId: config.wabaId,
      qualityRating: phoneJson.quality_rating,
    });

    return {
      ok: true,
      status: 'connected',
      phoneNumberId: String(phoneJson.id ?? config.phoneNumberId),
      wabaId: String(wabaJson.id ?? config.wabaId),
      displayPhoneNumber: displayPhone,
      verifiedName,
      qualityRating: normalizeQualityRating(
        typeof phoneJson.quality_rating === 'string' ? phoneJson.quality_rating : null
      ),
      codeVerificationStatus:
        typeof phoneJson.code_verification_status === 'string'
          ? phoneJson.code_verification_status
          : undefined,
    };
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    return {
      ok: false,
      status: 'error',
      errorCode: isAbort ? 'META_TIMEOUT' : 'META_NETWORK_ERROR',
      userMessage: isAbort
        ? 'Timed out waiting for Meta Cloud API. Please try again.'
        : 'Could not reach Meta Cloud API right now.',
      diagnosticMessage: (err as Error).message,
    };
  }
}

export interface SendMetaMessageResult {
  ok: boolean;
  metaMessageId?: string;
  errorCode?: string;
  httpStatus: number;
  userMessage?: string;
  diagnosticMessage?: string;
  rawResponse?: Record<string, unknown>;
}

export async function sendMetaWhatsAppMessage(params: {
  config: MetaRuntimeConfig;
  recipientWaId: string;
  messageType: 'text' | 'template';
  body?: string;
  templateName?: string;
  language?: string;
  templateParameters?: string[];
}): Promise<SendMetaMessageResult> {
  const { config, recipientWaId, messageType, body, templateName, language = 'en_US', templateParameters } = params;

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

  try {
    const res = await fetchMetaWithTimeout(
      `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metaPayload),
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
        ok: false,
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
      ok: true,
      httpStatus: 200,
      metaMessageId,
      rawResponse: json,
    };
  } catch (err) {
    // Never blindly retry a timed-out POST to Meta to avoid duplicate WhatsApp deliveries
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    logEvent('meta_api_error', 'error', 'Meta send network failure/timeout', {
      isAbort,
      recipient: maskPhone(recipientWaId),
    });
    return {
      ok: false,
      httpStatus: 504,
      errorCode: isAbort ? 'META_REQUEST_TIMEOUT' : 'META_NETWORK_ERROR',
      userMessage: isAbort
        ? 'Timed out waiting for WhatsApp confirmation. Check status before retrying to avoid duplicates.'
        : 'Network error communicating with WhatsApp Cloud API.',
      diagnosticMessage: (err as Error).message,
    };
  }
}
