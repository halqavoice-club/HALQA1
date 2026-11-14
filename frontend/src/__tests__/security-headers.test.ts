/**
 * @jest-environment node
 */
/**
 * security-headers.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AUDIT-043-SEC regression tests — frontend security-header configuration.
 *
 * Verifies:
 *   • Permissions-Policy is set exclusively in proxy.ts (single source).
 *   • The policy includes camera=*, microphone=*, display-capture=* for LiveKit.
 *   • next.config.js does NOT contain a duplicate headers() that sets
 *     Permissions-Policy (the deduplication fix — duplicate caused conflicting
 *     values in production; browsers take the intersection, so camera=() would
 *     win over camera=*, breaking LiveKit camera access).
 *   • nginx.conf does NOT set Permissions-Policy (same conflict reason).
 *   • CSP is present in Report-Only mode in proxy.ts (not yet enforcing).
 *   • No enforcing Content-Security-Policy header is emitted (expected — staged
 *     rollout: Report-Only first, then promote after reviewing violations).
 *   • Other required security headers are present (X-Frame-Options,
 *     X-Content-Type-Options, Referrer-Policy, HSTS).
 *
 * Test strategy: source-code inspection via fs.readFileSync — no running server
 * required. Mirrors the pattern used by quiz-socket-auth.test.js.
 *
 * Run via: npm test (frontend Jest)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs   from 'fs'
import * as path from 'path'

// __dirname = frontend/src/__tests__
const FRONTEND_ROOT   = path.join(__dirname, '../..')          // frontend/
const REPO_ROOT       = path.join(__dirname, '../../..')       // repo root
const PROXY_TS        = path.join(FRONTEND_ROOT, 'src/proxy.ts')
const NEXT_CONFIG_JS  = path.join(FRONTEND_ROOT, 'next.config.js')
const NGINX_CONF      = path.join(REPO_ROOT, 'nginx/nginx.conf')

describe('AUDIT-043-SEC: Frontend security header configuration', () => {

  let proxySrc      : string
  let nextConfigSrc : string
  let nginxSrc      : string

  beforeAll(() => {
    proxySrc      = fs.readFileSync(PROXY_TS, 'utf-8')
    nextConfigSrc = fs.readFileSync(NEXT_CONFIG_JS, 'utf-8')
    nginxSrc      = fs.readFileSync(NGINX_CONF, 'utf-8')
  })

  // ── 1. Permissions-Policy: single source in proxy.ts ─────────────────

  test("1a. proxy.ts sets Permissions-Policy header", () => {
    expect(proxySrc).toContain("Permissions-Policy");
  });

  test('1b. Permissions-Policy includes camera=* (required for LiveKit camera)', () => {
    // Extract the policy value line (accept either single or double quotes)
    const policyMatch = proxySrc.match(
      /['"]Permissions-Policy['"]\s*:\s*['"]([^'"]+)['"]/,
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch![1]).toMatch(/camera=\*/);
  });

  test("1c. Permissions-Policy includes microphone=* (required for LiveKit audio)", () => {
    // Extract the policy value line (accept either single or double quotes)
    const policyMatch = proxySrc.match(
      /['"]Permissions-Policy['"]\s*:\s*['"]([^'"]+)['"]/,
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch![1]).toMatch(/microphone=\*/);
  });

  test("1d. Permissions-Policy includes display-capture=* (required for screen sharing)", () => {
    // Extract the policy value line (accept either single or double quotes)
    const policyMatch = proxySrc.match(
      /['"]Permissions-Policy['"]\s*:\s*['"]([^'"]+)['"]/,
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch![1]).toMatch(/display-capture=\*/);
  });

  test("1e. Permissions-Policy denies geolocation (not used by HALQA)", () => {
    // Extract the policy value line (accept either single or double quotes)
    const policyMatch = proxySrc.match(
      /['"]Permissions-Policy['"]\s*:\s*['"]([^'"]+)['"]/,
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch![1]).toMatch(/geolocation=\(\)/);
  });

  // ── 2. Deduplication: next.config.js must NOT set Permissions-Policy ──────
  //
  // The old next.config.js had an async headers() that set Permissions-Policy.
  // Combined with proxy.ts, this produced two conflicting headers.
  // Browsers take the intersection — camera=() (most restrictive) would win,
  // blocking LiveKit camera even though camera=* was intended.

  test('2a. next.config.js does NOT contain an async headers() function', () => {
    // Strip comments before checking to avoid false positives
    const codeOnly = nextConfigSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(codeOnly).not.toMatch(/async\s+headers\s*\(\s*\)/)
  })

  test('2b. next.config.js does NOT set Permissions-Policy in executable code', () => {
    const codeOnly = nextConfigSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(codeOnly).not.toMatch(/Permissions-Policy/)
  })

  // ── 3. Deduplication: nginx.conf must NOT set Permissions-Policy ──────────
  //
  // The old nginx.conf set camera=(), microphone=(self) which conflicted with
  // proxy.ts camera=*, microphone=*. Removed in AUDIT-043-SEC fix.

  test('3. nginx.conf does NOT have an active add_header Permissions-Policy directive', () => {
    // Only check for uncommented add_header lines — comments are fine
    const nginxLines = nginxSrc.split('\n')
    const activeDirectives = nginxLines.filter(line => {
      const trimmed = line.trimStart()
      // Line is active only if it starts with add_header (not #)
      return trimmed.startsWith('add_header') && trimmed.includes('Permissions-Policy')
    })
    expect(activeDirectives).toHaveLength(0)
  })

  // ── 4. CSP: Report-Only mode preserved ───────────────────────────────────

  test('4a. proxy.ts sets Content-Security-Policy-Report-Only (monitoring mode)', () => {
    expect(proxySrc).toContain('Content-Security-Policy-Report-Only')
  })

  test('4b. proxy.ts does NOT set enforcing Content-Security-Policy yet', () => {
    // Only executable code (not comments) — strip comments first
    const codeOnly = proxySrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    // The key must not appear as a quoted string (header name) in non-comment code
    // Allow 'Content-Security-Policy-Report-Only' but not plain 'Content-Security-Policy'
    // Match the standalone enforcing CSP key specifically
    const enforcingCsp = codeOnly.match(/'Content-Security-Policy'(?!-Report-Only)/)
    expect(enforcingCsp).toBeNull()
  })

  test('4c. Report-Only CSP includes connect-src with wss: (WebSocket/Socket.IO/LiveKit)', () => {
    expect(proxySrc).toMatch(/connect-src[\s\S]*?wss:/)
  })

  test('4d. Report-Only CSP includes script-src with accounts.google.com (Google OAuth)', () => {
    expect(proxySrc).toMatch(/script-src[\s\S]*?accounts\.google\.com/)
  })

  // ── 5. Other required security headers are present in proxy.ts ────────

  test("5a. X-Frame-Options: SAMEORIGIN is set (clickjacking protection)", () => {
    expect(proxySrc).toContain("X-Frame-Options");
    expect(proxySrc).toMatch(/SAMEORIGIN/);
  });

  test("5b. X-Content-Type-Options: nosniff is set (MIME sniffing protection)", () => {
    expect(proxySrc).toContain("X-Content-Type-Options");
    expect(proxySrc).toMatch(/nosniff/);
  });

  test("5c. Referrer-Policy is set", () => {
    expect(proxySrc).toContain("Referrer-Policy");
  });

  test("5d. X-XSS-Protection is set (legacy browser protection)", () => {
    expect(proxySrc).toContain("X-XSS-Protection");
  });

  // ── 6. applySecurityHeaders is called on every response path ──────────────

  test('6. applySecurityHeaders() is called in all response branches', () => {
    // Count calls — must be at least 3 (public routes, root redirect, authenticated routes)
    const callCount = (proxySrc.match(/applySecurityHeaders\(response\)/g) || []).length
    expect(callCount).toBeGreaterThanOrEqual(3)
  })

  // ── 7. nginx.conf retains other security headers (no regression) ──────────

  test('7a. nginx.conf still sets X-Frame-Options', () => {
    const nginxLines = nginxSrc.split('\n')
    const active = nginxLines.filter(l => l.trimStart().startsWith('add_header') && l.includes('X-Frame-Options'))
    expect(active.length).toBeGreaterThan(0)
  })

  test('7b. nginx.conf still sets X-Content-Type-Options', () => {
    const nginxLines = nginxSrc.split('\n')
    const active = nginxLines.filter(l => l.trimStart().startsWith('add_header') && l.includes('X-Content-Type-Options'))
    expect(active.length).toBeGreaterThan(0)
  })

  test('7c. nginx.conf still sets Strict-Transport-Security', () => {
    const nginxLines = nginxSrc.split('\n')
    const active = nginxLines.filter(l => l.trimStart().startsWith('add_header') && l.includes('Strict-Transport-Security'))
    expect(active.length).toBeGreaterThan(0)
  })
})
