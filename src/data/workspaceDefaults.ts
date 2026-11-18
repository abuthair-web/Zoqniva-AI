import type { BusinessHoursDay, BusinessProfile } from '@/types/crm';

export const EMPTY_BUSINESS_PROFILE: BusinessProfile = {
  id: '',
  name: 'Your Business',
  slug: 'workspace',
  industry: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  website: '',
  whatsappDisplayName: '',
  whatsappPhoneE164: '',
  metaPhoneNumberId: '',
  metaWabaId: '',
  metaConnectionState: 'not_connected',
  metaLastError: undefined,
  messagingMode: 'test',
  testAllowlist: [],
  graphApiVersion: 'v21.0',
  verifiedName: undefined,
  qualityRating: 'unknown',
  webhookVerifiedAt: undefined,
};

export const DEFAULT_BUSINESS_HOURS: BusinessHoursDay[] = [
  { day: 'Monday', enabled: true, open: '09:00', close: '18:00' },
  { day: 'Tuesday', enabled: true, open: '09:00', close: '18:00' },
  { day: 'Wednesday', enabled: true, open: '09:00', close: '18:00' },
  { day: 'Thursday', enabled: true, open: '09:00', close: '18:00' },
  { day: 'Friday', enabled: true, open: '09:00', close: '18:00' },
  { day: 'Saturday', enabled: false, open: '10:00', close: '14:00' },
  { day: 'Sunday', enabled: false, open: '10:00', close: '14:00' },
];
