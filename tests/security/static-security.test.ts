import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = path.resolve(__dirname, '../..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const FUNCTIONS_DIR = path.join(ROOT_DIR, 'supabase', 'functions');

function collectFiles(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

describe('Static Security & Schema Regression Suite (CI-Safe)', () => {
  it('contains zero service-role keys, Meta tokens, or server secrets in src/', () => {
    const srcFiles = collectFiles(SRC_DIR, ['.ts', '.tsx', '.js', '.jsx']);
    expect(srcFiles.length).toBeGreaterThan(0);

    const forbiddenPatterns: Array<{ name: string; regex: RegExp }> = [
      { name: 'SUPABASE_SERVICE_ROLE_KEY in frontend', regex: /SUPABASE_SERVICE_ROLE_KEY/ },
      { name: 'VITE_SUPABASE_SERVICE_ROLE_KEY', regex: /VITE_.*SERVICE_ROLE/i },
      { name: 'VITE_META_ACCESS_TOKEN', regex: /VITE_META_ACCESS_TOKEN/i },
      { name: 'VITE_META_APP_SECRET', regex: /VITE_META_APP_SECRET/i },
      { name: 'Hardcoded Meta Graph token (EAAG...)', regex: /['"`]EAAG[A-Za-z0-9]{20,}['"`]/ },
      { name: 'Hardcoded Supabase service_role JWT claim', regex: /"role"\s*:\s*"service_role"/ },
    ];

    const violations: string[] = [];
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const rule of forbiddenPatterns) {
        if (rule.regex.test(content)) {
          violations.push(`${path.relative(ROOT_DIR, file)}: matched ${rule.name}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('contains zero leaked secrets in production dist/ bundle (when built)', () => {
    const distFiles = collectFiles(DIST_DIR, ['.js', '.html', '.css']);
    if (distFiles.length === 0) {
      // Build artifacts may not exist before npm run build; static src/ check still protects CI
      return;
    }

    const violations: string[] = [];
    for (const file of distFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (/SUPABASE_SERVICE_ROLE_KEY/.test(content)) {
        violations.push(`${path.relative(ROOT_DIR, file)}: references SUPABASE_SERVICE_ROLE_KEY`);
      }
      if (/EAAG[A-Za-z0-9]{25,}/.test(content)) {
        violations.push(`${path.relative(ROOT_DIR, file)}: contains Meta EAAG token`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('never queries nonexistent business_members.status or profiles.email columns in frontend', () => {
    const srcFiles = collectFiles(SRC_DIR, ['.ts', '.tsx']);
    const violations: string[] = [];

    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const rel = path.relative(ROOT_DIR, file);

      if (/from\(\s*['"]business_members['"]\s*\)[\s\S]{0,180}\.select\(\s*['"][^'"]*\bstatus\b[^'"]*['"]\s*\)/.test(content)) {
        violations.push(`${rel}: selects nonexistent business_members.status`);
      }
      if (/from\(\s*['"]business_members['"]\s*\)[\s\S]{0,180}profiles\(/.test(content)) {
        violations.push(`${rel}: assumes nonexistent FK join business_members -> profiles(...)`);
      }
      if (/from\(\s*['"]profiles['"]\s*\)[\s\S]{0,140}\.select\(\s*['"][^'"]*\bemail\b[^'"]*['"]\s*\)/.test(content)) {
        violations.push(`${rel}: selects nonexistent profiles.email`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps TemplatesPage independent from team-members Edge Function calls', () => {
    const templatesPage = fs.readFileSync(path.join(SRC_DIR, 'pages', 'TemplatesPage.tsx'), 'utf8');
    expect(templatesPage).not.toContain('team-members');
    expect(templatesPage).not.toContain('loadTeamDirectory');
  });

  it('enforces server-side auth, is_active checks, CORS preflight, and webhook HMAC verification in Edge Functions', () => {
    const protectedFns = [
      'whatsapp-connection-check',
      'whatsapp-send-message',
      'sync-templates',
      'team-members',
      'campaign-preflight',
    ];

    for (const fnName of protectedFns) {
      const fnPath = path.join(FUNCTIONS_DIR, fnName, 'index.ts');
      const code = fs.readFileSync(fnPath, 'utf8');

      expect(code, `${fnName} must handle OPTIONS CORS preflight`).toMatch(/req\.method\s*===\s*['"]OPTIONS['"]/);
      expect(code, `${fnName} must authenticate JWT via auth.getUser`).toContain('auth.getUser');
      expect(code, `${fnName} must check business_members.is_active`).toContain('is_active');
      expect(
        /from\(\s*['"]business_members['"]\s*\)[\s\S]{0,180}\.select\(\s*['"][^'"]*\bstatus\b[^'"]*['"]\s*\)/.test(code),
        `${fnName} must not select nonexistent business_members.status`
      ).toBe(false);
    }

    const campaignPreflightCode = fs
      .readFileSync(path.join(FUNCTIONS_DIR, 'campaign-preflight', 'index.ts'), 'utf8')
      .replace(/\/\/.*$/gm, '');
    expect(campaignPreflightCode).not.toContain('graph.facebook.com');
    expect(campaignPreflightCode).not.toContain('whatsapp-send-message');

    const webhookCode = fs.readFileSync(path.join(FUNCTIONS_DIR, 'whatsapp-webhook', 'index.ts'), 'utf8');
    expect(webhookCode).toContain('verifyWebhookSignature');
    expect(webhookCode).toContain('x-hub-signature-256');
    expect(webhookCode).toContain('META_WEBHOOK_VERIFY_TOKEN');

    const sendFnCode = fs.readFileSync(path.join(FUNCTIONS_DIR, 'whatsapp-send-message', 'index.ts'), 'utf8');
    expect(sendFnCode).not.toMatch(/\bapproval_status\b/);
    expect(sendFnCode).toContain("select('id, business_id, meta_template_id, name, language, category, status, components')");
  });

  it('keeps .env.example and .env.test.example free of real credentials', () => {
    for (const envFile of ['.env.example', '.env.test.example']) {
      const content = fs.readFileSync(path.join(ROOT_DIR, envFile), 'utf8');
      expect(content).not.toMatch(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}/);
      expect(content).not.toMatch(/EAAG[A-Za-z0-9]{20,}/);
    }
  });
});
