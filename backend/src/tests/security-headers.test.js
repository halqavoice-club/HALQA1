'use strict';
/**
 * security-headers.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AUDIT-043-SEC regression tests — backend security-header configuration.
 *
 * Verifies:
 *   • helmet() is present and active on the backend Express app.
 *   • contentSecurityPolicy is NOT explicitly disabled in the helmet call
 *     (Helmet 7.x enables its default CSP when no option is passed).
 *   • crossOriginResourcePolicy override is present (needed for upload serving).
 *   • Backend does NOT set a Permissions-Policy header (it is a browser policy
 *     only relevant to HTML document responses served by the frontend).
 *
 * Test strategy: source-code inspection via fs.readFileSync — mirrors the
 * pattern used by super-admin-scope.test.js and quiz-socket-auth.test.js.
 *
 * Run via: npm run test:unit
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

const APP_JS        = path.join(__dirname, '../app.js');

describe('AUDIT-043-SEC: Backend security header configuration', () => {
  let src;

  beforeAll(() => {
    src = fs.readFileSync(APP_JS, 'utf8');
  });

  // ── 1. Helmet is present ───────────────────────────────────────────────────

  test('1. helmet() middleware is imported and applied to the Express app', () => {
    expect(src).toMatch(/require\('helmet'\)/);
    expect(src).toMatch(/app\.use\(helmet\(/);
  });

  // ── 2. CSP is not explicitly disabled ─────────────────────────────────────

  test('2. helmet() call does NOT explicitly disable contentSecurityPolicy', () => {
    // Extract the helmet() call block to avoid false positives from comments
    const helmetCallMatch = src.match(/app\.use\(helmet\(\{[\s\S]*?\}\)\)/);
    expect(helmetCallMatch).not.toBeNull();
    const helmetCallCode = helmetCallMatch[0];
    // contentSecurityPolicy: false would disable CSP on API responses — must not be present
    expect(helmetCallCode).not.toMatch(/contentSecurityPolicy\s*:\s*false/);
  });

  // ── 3. crossOriginResourcePolicy is present ────────────────────────────────

  test('3. helmet() sets crossOriginResourcePolicy: cross-origin (for upload serving)', () => {
    const helmetCallMatch = src.match(/app\.use\(helmet\(\{[\s\S]*?\}\)\)/);
    expect(helmetCallMatch).not.toBeNull();
    expect(helmetCallMatch[0]).toMatch(/crossOriginResourcePolicy/);
    expect(helmetCallMatch[0]).toMatch(/cross-origin/);
  });

  // ── 4. Backend does NOT set Permissions-Policy ────────────────────────────
  //
  // Permissions-Policy is a browser document policy — it is only meaningful
  // on HTML responses from the frontend. Setting it on JSON API responses
  // is harmless but confusing. The canonical source is frontend/src/middleware.ts.

  test('4. Backend Express app does not set a Permissions-Policy header', () => {
    // Strip comments from the search to avoid matching comment text
    const codeOnly = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(codeOnly).not.toMatch(/Permissions-Policy/);
  });

  // ── 5. X-Frame-Options fallback is present via Helmet default ─────────────

  test('5. X-Frame-Options is not explicitly disabled (Helmet default applies)', () => {
    const helmetCallMatch = src.match(/app\.use\(helmet\(\{[\s\S]*?\}\)\)/);
    expect(helmetCallMatch).not.toBeNull();
    expect(helmetCallMatch[0]).not.toMatch(/frameguard\s*:\s*false/);
  });
});
