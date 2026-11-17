/**
 * Normalizes a phone string into strict E.164 international format (+[1-9][0-9]{6,14}).
 * Returns null when the number cannot be normalized to a valid E.164 number.
 */
export function normalizePhoneE164(raw: string, defaultCountryCode = '1'): string | null {
  const cleaned = raw.trim().replace(/[\s\-().]/g, '');
  if (!cleaned) return null;

  let normalized = cleaned;
  if (normalized.startsWith('00')) {
    normalized = '+' + normalized.slice(2);
  } else if (!normalized.startsWith('+')) {
    const digitsOnly = normalized.replace(/\D/g, '');
    if (digitsOnly.length === 10 && defaultCountryCode) {
      normalized = `+${defaultCountryCode}${digitsOnly}`;
    } else if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
      normalized = `+${digitsOnly}`;
    } else {
      return null;
    }
  }

  // Validate strict E.164 pattern
  if (/^\+[1-9][0-9]{6,14}$/.test(normalized)) {
    return normalized;
  }
  return null;
}

export function formatPhoneDisplay(e164: string): string {
  if (!e164.startsWith('+')) return e164;
  if (e164.startsWith('+1') && e164.length === 12) {
    return `+1 (${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
  }
  if (e164.startsWith('+971') && e164.length === 13) {
    return `+971 ${e164.slice(4, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}`;
  }
  if (e164.startsWith('+44') && e164.length === 13) {
    return `+44 ${e164.slice(3, 7)} ${e164.slice(7)}`;
  }
  return e164;
}

export function getWindowStatus(windowExpiresAt: string): {
  isOpen: boolean;
  label: string;
  remainingHours: number;
} {
  const expiresMs = new Date(windowExpiresAt).getTime();
  const diffMs = expiresMs - Date.now();
  if (Number.isNaN(expiresMs) || diffMs <= 0) {
    return {
      isOpen: false,
      label: '24h window closed · Template required',
      remainingHours: 0,
    };
  }
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return {
    isOpen: true,
    label: hours > 0 ? `${hours}h ${mins}m left in 24h window` : `${mins}m left in 24h window`,
    remainingHours: Math.max(1, hours),
  };
}

export function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export interface ParsedCsvRow {
  rowIndex: number;
  fullName: string;
  rawPhone: string;
  normalizedPhone: string | null;
  email: string;
  company: string;
  city: string;
  country: string;
  marketingOptIn: boolean;
  isDuplicate: boolean;
  error?: string;
}

export function parseContactsCsv(
  csvText: string,
  existingPhones: Set<string>
): ParsedCsvRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const splitLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const findIdx = (candidates: string[]) =>
    headers.findIndex((h) => candidates.some((c) => h.includes(c)));

  const nameIdx = findIdx(['name', 'fullname', 'customer']);
  const phoneIdx = findIdx(['phone', 'mobile', 'whatsapp', 'tel']);
  const emailIdx = findIdx(['email', 'mail']);
  const companyIdx = findIdx(['company', 'org', 'business']);
  const cityIdx = findIdx(['city', 'town']);
  const countryIdx = findIdx(['country', 'nation']);
  const optInIdx = findIdx(['optin', 'marketing', 'consent']);

  const seenInCsv = new Set<string>();

  return lines.slice(1).map((line, index) => {
    const cols = splitLine(line);
    const fullName = nameIdx >= 0 ? cols[nameIdx] ?? '' : cols[0] ?? '';
    const rawPhone = phoneIdx >= 0 ? cols[phoneIdx] ?? '' : cols[1] ?? '';
    const normalizedPhone = normalizePhoneE164(rawPhone);
    const email = emailIdx >= 0 ? cols[emailIdx] ?? '' : '';
    const company = companyIdx >= 0 ? cols[companyIdx] ?? '' : '';
    const city = cityIdx >= 0 ? cols[cityIdx] ?? '' : '';
    const country = countryIdx >= 0 ? cols[countryIdx] ?? '' : '';
    const rawOpt = optInIdx >= 0 ? (cols[optInIdx] ?? '').toLowerCase() : 'true';
    const marketingOptIn = ['true', 'yes', '1', 'y', 'opted_in'].includes(rawOpt);

    const isDuplicate = Boolean(
      normalizedPhone && (existingPhones.has(normalizedPhone) || seenInCsv.has(normalizedPhone))
    );
    if (normalizedPhone) seenInCsv.add(normalizedPhone);

    let error: string | undefined;
    if (!fullName.trim()) error = 'Missing full name';
    else if (!normalizedPhone) error = 'Invalid international phone format';
    else if (isDuplicate) error = 'Duplicate phone number';

    return {
      rowIndex: index + 2,
      fullName: fullName.trim(),
      rawPhone,
      normalizedPhone,
      email,
      company,
      city,
      country,
      marketingOptIn,
      isDuplicate,
      error,
    };
  });
}
