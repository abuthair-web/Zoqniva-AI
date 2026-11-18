import type {
  MessageTemplate,
  TemplateApprovalStatus,
  TemplateCategory,
  TemplateComponent,
} from '@/types/crm';

export function normalizeTemplateCategory(raw: unknown): TemplateCategory {
  const upper = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (upper === 'MARKETING') return 'MARKETING';
  if (upper === 'AUTHENTICATION') return 'AUTHENTICATION';
  return 'UTILITY';
}

/**
 * Normalizes database `status` (lowercase) or `approval_status` (uppercase)
 * to the frontend's canonical TemplateApprovalStatus without collapsing
 * valid or unrecognized Meta statuses into Local Draft.
 */
export function normalizeTemplateStatus(
  rawStatus: unknown,
  hasMetaTemplateId = false
): TemplateApprovalStatus {
  const clean = typeof rawStatus === 'string' ? rawStatus.trim().toUpperCase() : '';

  if (clean === 'APPROVED' || clean === 'ACTIVE') return 'APPROVED';
  if (clean === 'PENDING' || clean === 'IN_APPEAL' || clean === 'PENDING_DELETION') return 'PENDING';
  if (clean === 'REJECTED') return 'REJECTED';
  if (clean === 'PAUSED') return 'PAUSED';
  if (clean === 'DISABLED' || clean === 'LIMIT_EXCEEDED') return 'DISABLED';
  if (clean === 'DRAFT') return 'DRAFT';

  // Never downgrade a Meta-linked or non-empty unrecognized status into DRAFT
  if (hasMetaTemplateId || clean.length > 0) {
    return 'PENDING';
  }
  return 'DRAFT';
}

export function coerceComponentsArray(raw: unknown): TemplateComponent[] {
  if (Array.isArray(raw)) {
    return raw.filter(
      (item): item is TemplateComponent =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    );
  }
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is TemplateComponent =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item)
        );
      }
    } catch {
      return [];
    }
  }
  return [];
}

export function findTemplateComponent(
  components: TemplateComponent[],
  targetType: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
): TemplateComponent | undefined {
  return components.find(
    (comp) => String(comp.type ?? '').trim().toUpperCase() === targetType
  );
}

export function countTemplateVariables(text: string): number {
  if (!text) return 0;
  const matches = text.match(/\{\{[^}]+\}\}/g) ?? [];
  return new Set(matches.map((m) => m.trim())).size;
}

export function parseTemplateComponents(
  rawComponents: unknown,
  legacy?: {
    headerType?: unknown;
    headerText?: unknown;
    bodyText?: unknown;
    footerText?: unknown;
    buttons?: unknown;
    variablesCount?: unknown;
  }
): {
  components: TemplateComponent[];
  headerType: MessageTemplate['headerType'];
  headerText?: string;
  bodyText: string;
  footerText?: string;
  buttons: MessageTemplate['buttons'];
  variablesCount: number;
} {
  const components = coerceComponentsArray(rawComponents);

  const headerComp = findTemplateComponent(components, 'HEADER');
  const bodyComp = findTemplateComponent(components, 'BODY');
  const footerComp = findTemplateComponent(components, 'FOOTER');
  const buttonsComp = findTemplateComponent(components, 'BUTTONS');

  // Header
  const rawHeaderFmt = String(
    headerComp?.format ?? (headerComp?.text ? 'TEXT' : legacy?.headerType ?? 'NONE')
  )
    .trim()
    .toUpperCase();
  const headerType: MessageTemplate['headerType'] =
    rawHeaderFmt === 'TEXT' ||
    rawHeaderFmt === 'IMAGE' ||
    rawHeaderFmt === 'DOCUMENT' ||
    rawHeaderFmt === 'VIDEO' ||
    rawHeaderFmt === 'LOCATION'
      ? rawHeaderFmt
      : 'NONE';

  const compHeaderText = typeof headerComp?.text === 'string' ? headerComp.text : undefined;
  const legacyHeaderText =
    typeof legacy?.headerText === 'string' && legacy.headerText.length > 0
      ? legacy.headerText
      : undefined;
  const headerText = compHeaderText ?? legacyHeaderText;

  // Body (never substitute template name as fake body content)
  const compBodyText = typeof bodyComp?.text === 'string' ? bodyComp.text : undefined;
  const legacyBodyText = typeof legacy?.bodyText === 'string' ? legacy.bodyText : '';
  const bodyText = compBodyText !== undefined ? compBodyText : legacyBodyText;

  // Footer
  const compFooterText = typeof footerComp?.text === 'string' ? footerComp.text : undefined;
  const legacyFooterText =
    typeof legacy?.footerText === 'string' && legacy.footerText.length > 0
      ? legacy.footerText
      : undefined;
  const footerText = compFooterText ?? legacyFooterText;

  // Buttons
  const rawButtons = Array.isArray(buttonsComp?.buttons)
    ? buttonsComp.buttons
    : Array.isArray(legacy?.buttons)
    ? (legacy.buttons as Array<Record<string, unknown>>)
    : [];

  const buttons: MessageTemplate['buttons'] = rawButtons
    .filter((b) => Boolean(b) && typeof b === 'object')
    .map((b) => {
      const rawBtnType = String(b.type ?? 'QUICK_REPLY').trim().toUpperCase();
      const btnType: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' =
        rawBtnType === 'URL' || rawBtnType === 'PHONE_NUMBER' ? rawBtnType : 'QUICK_REPLY';
      const val =
        typeof b.value === 'string'
          ? b.value
          : typeof b.url === 'string'
          ? b.url
          : typeof b.phone_number === 'string'
          ? b.phone_number
          : undefined;
      return {
        type: btnType,
        text: String(b.text ?? '').trim() || btnType,
        value: val,
      };
    });

  const computedVars = countTemplateVariables(bodyText);
  const variablesCount =
    computedVars > 0
      ? computedVars
      : typeof legacy?.variablesCount === 'number' && !Number.isNaN(legacy.variablesCount)
      ? legacy.variablesCount
      : 0;

  return {
    components,
    headerType,
    headerText,
    bodyText,
    footerText,
    buttons,
    variablesCount,
  };
}

export function mapDbTemplateRow(row: Record<string, unknown>): MessageTemplate {
  const metaTemplateId =
    row.meta_template_id !== undefined &&
    row.meta_template_id !== null &&
    String(row.meta_template_id).trim() !== ''
      ? String(row.meta_template_id).trim()
      : null;

  const rawStatus = row.status ?? row.approval_status;
  const approvalStatus = normalizeTemplateStatus(rawStatus, Boolean(metaTemplateId));
  const category = normalizeTemplateCategory(row.category);

  const parsed = parseTemplateComponents(row.components, {
    headerType: row.header_type,
    headerText: row.header_text,
    bodyText: row.body_text,
    footerText: row.footer_text,
    buttons: row.buttons,
    variablesCount: row.variables_count !== undefined ? Number(row.variables_count) : undefined,
  });

  const updatedAt = row.updated_at ? String(row.updated_at) : undefined;
  const explicitLastSynced = row.last_synced_at ? String(row.last_synced_at) : undefined;
  // Use last_synced_at if column exists, otherwise updated_at ONLY when template is genuinely Meta-linked
  const lastSyncedAt = explicitLastSynced ?? (metaTemplateId ? updatedAt : undefined);

  return {
    id: String(row.id),
    metaTemplateId,
    name: String(row.name ?? ''),
    category,
    language: String(row.language ?? 'en_US'),
    headerType: parsed.headerType,
    headerText: parsed.headerText,
    bodyText: parsed.bodyText,
    footerText: parsed.footerText,
    buttons: parsed.buttons,
    components: parsed.components,
    variablesCount: parsed.variablesCount,
    approvalStatus,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : undefined,
    lastSyncedAt,
    updatedAt,
    isLocalDraft: approvalStatus === 'DRAFT' && !metaTemplateId,
  };
}

export function buildComponentsFromDraftFields(input: {
  headerType?: MessageTemplate['headerType'];
  headerText?: string;
  bodyText: string;
  footerText?: string;
  buttons?: MessageTemplate['buttons'];
}): TemplateComponent[] {
  const components: TemplateComponent[] = [];

  if (input.headerType && input.headerType !== 'NONE') {
    if (input.headerType === 'TEXT' && input.headerText?.trim()) {
      components.push({
        type: 'HEADER',
        format: 'TEXT',
        text: input.headerText.trim(),
      });
    } else if (input.headerType !== 'TEXT') {
      components.push({
        type: 'HEADER',
        format: input.headerType,
      });
    }
  } else if (input.headerText?.trim()) {
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: input.headerText.trim(),
    });
  }

  if (input.bodyText.trim()) {
    components.push({
      type: 'BODY',
      text: input.bodyText.trim(),
    });
  }

  if (input.footerText?.trim()) {
    components.push({
      type: 'FOOTER',
      text: input.footerText.trim(),
    });
  }

  if (input.buttons && input.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: input.buttons.map((b) => ({
        type: b.type,
        text: b.text,
        ...(b.type === 'URL' && b.value ? { url: b.value } : {}),
        ...(b.type === 'PHONE_NUMBER' && b.value ? { phone_number: b.value } : {}),
      })),
    });
  }

  return components;
}

/**
 * Formats body text for preview without mutating the saved template.
 * Uses Meta example values if available on components; otherwise renders readable placeholders.
 */
export function renderTemplateBodyWithPlaceholders(
  bodyText: string,
  components?: TemplateComponent[]
): string {
  if (!bodyText) return '';

  const bodyComp = components ? findTemplateComponent(components, 'BODY') : undefined;
  const positionalExamples = Array.isArray(bodyComp?.example?.body_text?.[0])
    ? bodyComp.example.body_text[0]
    : [];
  const namedExamples = Array.isArray(bodyComp?.example?.body_text_named_params)
    ? bodyComp.example.body_text_named_params
    : [];

  return bodyText.replace(/\{\{([^}]+)\}\}/g, (_match, rawToken: string) => {
    const token = rawToken.trim();
    if (/^\d+$/.test(token)) {
      const idx = Number(token) - 1;
      const sample = positionalExamples[idx];
      if (typeof sample === 'string' && sample.trim().length > 0) {
        return sample;
      }
      return `[Sample ${token}]`;
    }
    const namedMatch = namedExamples.find(
      (entry) => String(entry.param_name ?? '').trim().toLowerCase() === token.toLowerCase()
    );
    if (namedMatch?.example && String(namedMatch.example).trim().length > 0) {
      return String(namedMatch.example);
    }
    return `[${token}]`;
  });
}

export function renderTemplateHeaderTextWithPlaceholders(
  headerText: string,
  components?: TemplateComponent[]
): string {
  if (!headerText) return '';
  const headerComp = components ? findTemplateComponent(components, 'HEADER') : undefined;
  const headerExamples = Array.isArray(headerComp?.example?.header_text)
    ? headerComp.example.header_text
    : [];

  return headerText.replace(/\{\{([^}]+)\}\}/g, (_match, rawToken: string) => {
    const token = rawToken.trim();
    if (/^\d+$/.test(token)) {
      const idx = Number(token) - 1;
      const sample = headerExamples[idx];
      if (typeof sample === 'string' && sample.trim().length > 0) {
        return sample;
      }
      return `[Header ${token}]`;
    }
    return `[${token}]`;
  });
}
