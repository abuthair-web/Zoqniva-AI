import { describe, expect, it } from 'vitest';
import {
  buildComponentsFromDraftFields,
  countTemplateVariables,
  mapDbTemplateRow,
  normalizeTemplateCategory,
  normalizeTemplateStatus,
  parseTemplateComponents,
  renderTemplateBodyWithPlaceholders,
  renderTemplateHeaderTextWithPlaceholders,
} from '@/lib/templates';

describe('WhatsApp Templates normalization, JSONB component parsing & preview rendering', () => {
  it('maps real lowercase and uppercase Meta statuses accurately without collapsing to DRAFT', () => {
    expect(normalizeTemplateStatus('approved', true)).toBe('APPROVED');
    expect(normalizeTemplateStatus('APPROVED', true)).toBe('APPROVED');
    expect(normalizeTemplateStatus('active', true)).toBe('APPROVED');
    expect(normalizeTemplateStatus('pending', true)).toBe('PENDING');
    expect(normalizeTemplateStatus('rejected', true)).toBe('REJECTED');
    expect(normalizeTemplateStatus('paused', true)).toBe('PAUSED');
    expect(normalizeTemplateStatus('disabled', true)).toBe('DISABLED');
    expect(normalizeTemplateStatus('draft', false)).toBe('DRAFT');
    // Unrecognized status on Meta-linked template must never become Local Draft
    expect(normalizeTemplateStatus('UNKNOWN_META_STATE', true)).toBe('PENDING');
    expect(normalizeTemplateStatus(null, true)).toBe('PENDING');
    expect(normalizeTemplateStatus(null, false)).toBe('DRAFT');
  });

  it('normalizes template categories safely', () => {
    expect(normalizeTemplateCategory('marketing')).toBe('MARKETING');
    expect(normalizeTemplateCategory('AUTHENTICATION')).toBe('AUTHENTICATION');
    expect(normalizeTemplateCategory('utility')).toBe('UTILITY');
    expect(normalizeTemplateCategory('')).toBe('UTILITY');
  });

  it('maps synced Meta template rows with JSONB components (hello_world & marketing)', () => {
    const helloWorldRow = {
      id: '11111111-1111-4111-8111-111111111111',
      business_id: '22222222-2222-4222-8222-222222222222',
      meta_template_id: '987654321012345',
      name: 'hello_world',
      language: 'en_US',
      category: 'UTILITY',
      status: 'approved',
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Hello World' },
        {
          type: 'BODY',
          text: 'Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API.',
        },
        { type: 'FOOTER', text: 'WhatsApp Business Platform sample message' },
      ],
      updated_at: '2026-05-01T10:00:00Z',
    };

    const mapped = mapDbTemplateRow(helloWorldRow);
    expect(mapped.approvalStatus).toBe('APPROVED');
    expect(mapped.isLocalDraft).toBe(false);
    expect(mapped.metaTemplateId).toBe('987654321012345');
    expect(mapped.headerType).toBe('TEXT');
    expect(mapped.headerText).toBe('Hello World');
    expect(mapped.bodyText).toContain('Welcome and congratulations');
    expect(mapped.footerText).toBe('WhatsApp Business Platform sample message');
    expect(mapped.lastSyncedAt).toBe('2026-05-01T10:00:00Z');
  });

  it('never fabricates body content from template name when JSONB components are empty', () => {
    const emptyCompRow = {
      id: '11111111-1111-4111-8111-111111111112',
      meta_template_id: '555666777',
      name: 'zoqniva_demo_welcome_v1',
      language: 'en',
      category: 'MARKETING',
      status: 'approved',
      components: [],
    };

    const mapped = mapDbTemplateRow(emptyCompRow);
    expect(mapped.approvalStatus).toBe('APPROVED');
    expect(mapped.isLocalDraft).toBe(false);
    expect(mapped.bodyText).toBe('');
    expect(mapped.bodyText).not.toContain('zoqniva_demo_welcome_v1');
  });

  it('renders positional and named Meta template placeholders using Meta examples or readable fallbacks', () => {
    const components = [
      {
        type: 'HEADER',
        format: 'TEXT',
        text: 'Order {{1}} Update',
        example: { header_text: ['#4082'] },
      },
      {
        type: 'BODY',
        text: 'Hi {{1}}, your package for {{2}} arrives on {{delivery_date}}.',
        example: {
          body_text: [['Amina']],
          body_text_named_params: [{ param_name: 'delivery_date', example: 'Friday' }],
        },
      },
    ];

    expect(countTemplateVariables(components[1].text!)).toBe(3);
    expect(renderTemplateHeaderTextWithPlaceholders(components[0].text!, components)).toBe(
      'Order #4082 Update'
    );
    expect(renderTemplateBodyWithPlaceholders(components[1].text!, components)).toBe(
      'Hi Amina, your package for [Sample 2] arrives on Friday.'
    );
  });

  it('parses JSON-stringified components and builds Meta-compatible draft component arrays', () => {
    const built = buildComponentsFromDraftFields({
      headerType: 'TEXT',
      headerText: 'Special Offer',
      bodyText: 'Hello {{1}}, save 20% today.',
      footerText: 'Reply STOP to opt out',
      buttons: [
        { type: 'URL', text: 'Shop Now', value: 'https://example.com' },
        { type: 'QUICK_REPLY', text: 'Not interested' },
      ],
    });

    const parsed = parseTemplateComponents(JSON.stringify(built));
    expect(parsed.headerType).toBe('TEXT');
    expect(parsed.headerText).toBe('Special Offer');
    expect(parsed.bodyText).toBe('Hello {{1}}, save 20% today.');
    expect(parsed.footerText).toBe('Reply STOP to opt out');
    expect(parsed.buttons).toHaveLength(2);
    expect(parsed.buttons[0]).toEqual({
      type: 'URL',
      text: 'Shop Now',
      value: 'https://example.com',
    });
    expect(parsed.variablesCount).toBe(1);
  });
});
