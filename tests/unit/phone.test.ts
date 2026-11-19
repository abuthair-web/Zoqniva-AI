import { describe, expect, it } from 'vitest';
import {
  formatPhoneDisplay,
  getWindowStatus,
  normalizePhoneE164,
  parseContactsCsv,
} from '@/lib/phone';

describe('Phone normalization, 24h window & CSV parsing', () => {
  it('normalizes valid E.164 and formatted phone numbers', () => {
    expect(normalizePhoneE164('+1 (555) 123-4567')).toBe('+15551234567');
    expect(normalizePhoneE164('00971 50 123 4567')).toBe('+971501234567');
    expect(normalizePhoneE164('5551234567')).toBe('+15551234567');
    expect(normalizePhoneE164('919876543210')).toBe('+919876543210');
  });

  it('rejects invalid phone numbers that fail E.164 constraints', () => {
    expect(normalizePhoneE164('')).toBeNull();
    expect(normalizePhoneE164('   ')).toBeNull();
    expect(normalizePhoneE164('123')).toBeNull();
    expect(normalizePhoneE164('+0123456789')).toBeNull();
    expect(normalizePhoneE164('not-a-phone')).toBeNull();
    expect(normalizePhoneE164('+123456789012345678')).toBeNull();
  });

  it('formats common E.164 numbers cleanly for display', () => {
    expect(formatPhoneDisplay('+15551234567')).toBe('+1 (555) 123-4567');
    expect(formatPhoneDisplay('+971501234567')).toBe('+971 50 123 4567');
    expect(formatPhoneDisplay('+447911123456')).toBe('+44 7911 123456');
  });

  it('accurately evaluates open and expired 24-hour WhatsApp service windows', () => {
    const futureIso = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const pastIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const openState = getWindowStatus(futureIso);
    expect(openState.isOpen).toBe(true);
    expect(openState.remainingHours).toBeGreaterThanOrEqual(2);

    const closedState = getWindowStatus(pastIso);
    expect(closedState.isOpen).toBe(false);
    expect(closedState.remainingHours).toBe(0);

    const invalidState = getWindowStatus('invalid-date');
    expect(invalidState.isOpen).toBe(false);
  });

  it('parses CSV contacts, flags invalid phones, missing names, and duplicates', () => {
    const csv = [
      'Full Name,Phone,Email,Company,City,Country,OptIn',
      'Amina Hassan,+971501112233,amina@example.com,"Acme, LLC",Dubai,UAE,true',
      'Duplicate Existing,+15551234567,dup@example.com,Co,NYC,US,yes',
      'Duplicate In CSV,+971501112233,dup2@example.com,Co,Dubai,UAE,false',
      ',+447911123456,noname@example.com,Co,London,UK,true',
      'Bad Phone,123,bad@example.com,Co,LA,US,false',
    ].join('\n');

    const parsed = parseContactsCsv(csv, new Set(['+15551234567']));
    expect(parsed).toHaveLength(5);

    expect(parsed[0]).toMatchObject({
      fullName: 'Amina Hassan',
      normalizedPhone: '+971501112233',
      company: 'Acme, LLC',
      marketingOptIn: true,
      isDuplicate: false,
      error: undefined,
    });

    expect(parsed[1].isDuplicate).toBe(true);
    expect(parsed[1].error).toBe('Duplicate phone number');

    expect(parsed[2].isDuplicate).toBe(true);
    expect(parsed[2].marketingOptIn).toBe(false);
    expect(parsed[2].error).toBe('Duplicate phone number');

    expect(parsed[3].error).toBe('Missing full name');
    expect(parsed[4].error).toBe('Invalid international phone format');
  });
});
