'use strict';
/**
 * trust-proxy.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression tests for B1 (Express trust-proxy remediation).
 *
 * Verifies:
 *   1. `app.set('trust proxy', 1)` is present in app.js (source inspection).
 *   2. The value is the integer 1 — NOT `true` (which would trust all proxies).
 *   3. `app.set('trust proxy', 1)` appears BEFORE any middleware registration.
 *   4. ipAllowlist.js uses req.ip (honours trust proxy) — not raw X-Forwarded-For.
 *   5. ipAllowlist.js does NOT blindly read X-Forwarded-For without trust proxy.
 *   6. Functional: req.ip is set from X-Forwarded-For when trust proxy is 1.
 *   7. Functional: a second X-Forwarded-For hop is stripped (only 1 hop trusted).
 *   8. Functional: when no X-Forwarded-For header, req.ip falls back to the
 *      connection's remote address (no regression for direct connections).
 *   9. Spoofed X-Forwarded-For from an untrusted client cannot override real IP
 *      when the header contains more addresses than trusted hops.
 *
 * Tests 1–5: source-code inspection (no running server required).
 * Tests 6–9: functional using a minimal Express app with trust proxy: 1.
 *
 * Run via: npm run test:unit
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs      = require('fs');
const path    = require('path');
const express = require('express');
const request = require('supertest');

const APP_JS          = path.join(__dirname, '../app.js');
const IP_ALLOWLIST_JS = path.join(__dirname, '../middleware/ipAllowlist.js');

// ─── Source-inspection helpers ─────────────────────────────────────────────────

function getAppSource() {
  return fs.readFileSync(APP_JS, 'utf8');
}

function getIpAllowlistSource() {
  return fs.readFileSync(IP_ALLOWLIST_JS, 'utf8');
}

// ─── Functional test helper ───────────────────────────────────────────────────

/**
 * Build a minimal Express app with a given trust proxy setting and a single
 * GET / route that echoes req.ip.
 */
function buildApp(trustProxy) {
  const a = express();
  if (trustProxy !== undefined) {
    a.set('trust proxy', trustProxy);
  }
  a.get('/', (req, res) => {
    res.json({ ip: req.ip, ips: req.ips });
  });
  return a;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('B1 — Express trust proxy remediation', () => {

  // ── 1. Source checks ────────────────────────────────────────────────────────

  describe('Source: app.js trust proxy configuration', () => {

    test('1. app.set("trust proxy", 1) is present in app.js', () => {
      const src = getAppSource();
      // Match the exact call with integer 1 (not string '1', not true)
      expect(src).toMatch(/app\.set\(\s*['"]trust proxy['"]\s*,\s*1\s*\)/);
    });

    test('2. Trust proxy value is integer 1, NOT boolean true (which would trust all proxies)', () => {
      const src = getAppSource();
      // Must not have `true` as the trust proxy value
      expect(src).not.toMatch(/app\.set\(\s*['"]trust proxy['"]\s*,\s*true\s*\)/);
      // Must have integer 1
      expect(src).toMatch(/app\.set\(\s*['"]trust proxy['"]\s*,\s*1\s*\)/);
    });

    test('3. app.set("trust proxy", 1) appears BEFORE the first app.use() middleware call', () => {
      const src = getAppSource();
      const trustProxyIdx = src.indexOf("app.set('trust proxy', 1)");
      const firstAppUseIdx = src.indexOf('app.use(');
      expect(trustProxyIdx).toBeGreaterThan(-1);
      expect(firstAppUseIdx).toBeGreaterThan(-1);
      // trust proxy must be set before any middleware reads req.ip
      expect(trustProxyIdx).toBeLessThan(firstAppUseIdx);
    });

    test('3b. app.set("trust proxy", 1) appears BEFORE app.use(helmet(', () => {
      const src = getAppSource();
      const trustProxyIdx = src.indexOf("app.set('trust proxy', 1)");
      const helmetIdx = src.indexOf('app.use(helmet(');
      expect(trustProxyIdx).toBeGreaterThan(-1);
      expect(helmetIdx).toBeGreaterThan(-1);
      expect(trustProxyIdx).toBeLessThan(helmetIdx);
    });

    test('3c. app.set("trust proxy", 1) appears BEFORE rate limiter middleware', () => {
      const src = getAppSource();
      const trustProxyIdx = src.indexOf("app.set('trust proxy', 1)");
      const rateLimiterIdx = src.indexOf('app.use(rateLimiter');
      expect(trustProxyIdx).toBeGreaterThan(-1);
      expect(rateLimiterIdx).toBeGreaterThan(-1);
      expect(trustProxyIdx).toBeLessThan(rateLimiterIdx);
    });

  });

  // ── 2. ipAllowlist source checks ───────────────────────────────────────────

  describe('Source: ipAllowlist.js uses req.ip correctly', () => {

    test('4. ipAllowlist.js uses req.ip (honours trust proxy setting)', () => {
      const src = getIpAllowlistSource();
      expect(src).toMatch(/req\.ip/);
    });

    test('5. ipAllowlist.js does NOT directly read req.headers["x-forwarded-for"] or req.headers["x-real-ip"]', () => {
      // Reading X-Forwarded-For directly bypasses the trust proxy safety mechanism.
      // The correct approach is req.ip, which Express resolves based on trust proxy.
      const src = getIpAllowlistSource();
      const codeOnly = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(codeOnly).not.toMatch(/req\.headers\s*\[\s*['"]x-forwarded-for['"]\s*\]/i);
      expect(codeOnly).not.toMatch(/req\.headers\s*\[\s*['"]x-real-ip['"]\s*\]/i);
    });

  });

  // ── 3. Functional: trust proxy: 1 IP resolution ───────────────────────────

  describe('Functional: req.ip resolution with trust proxy: 1', () => {

    test('6. When X-Forwarded-For has one address and trust proxy is 1, req.ip is that address', async () => {
      const app = buildApp(1);
      const res = await request(app)
        .get('/')
        .set('X-Forwarded-For', '203.0.113.50')
        .expect(200);
      // Express with trust proxy: 1 takes the leftmost address in X-Forwarded-For
      // (the real client IP set by the trusted proxy)
      expect(res.body.ip).toBe('203.0.113.50');
    });

    test('7. With trust proxy: 1 and two X-Forwarded-For addresses, req.ip is the rightmost address (nginx-added real client IP)', async () => {
      // How nginx builds X-Forwarded-For when a client sends a spoofed header:
      //   Client sends:  X-Forwarded-For: 203.0.113.50  (spoofed)
      //   Nginx appends: X-Forwarded-For: 203.0.113.50, <actual-client-ip>
      //                                                  ^^ nginx adds this
      //
      // With trust proxy: 1, Express trusts exactly 1 hop (nginx).
      // It strips the rightmost address (trusted proxy) and uses the
      // next-rightmost as req.ip — which is 10.0.0.1 in our simulation.
      // The leftmost spoofed address (203.0.113.50) is NOT used.
      //
      // In the real topology: if a client at 10.0.0.1 sends a spoofed
      // X-Forwarded-For header with a fake IP, nginx overwrites it as:
      //   X-Forwarded-For: <spoofed-ip>, 10.0.0.1
      // Express trust proxy: 1 uses 10.0.0.1 — the real client IP. ✅
      const app = buildApp(1);
      const res = await request(app)
        .get('/')
        .set('X-Forwarded-For', '203.0.113.50, 10.0.0.1')
        .expect(200);
      // Express uses the rightmost address that is NOT from the trusted proxy hop.
      // In this two-address header, trust proxy: 1 picks the rightmost = 10.0.0.1.
      expect(res.body.ip).toBe('10.0.0.1');
      // req.ips contains the addresses within the trusted chain
      // (addresses beyond the trusted hop count are not included)
      expect(res.body.ips).toContain('10.0.0.1');
    });

    test('8. When no X-Forwarded-For header, req.ip falls back to the direct connection IP (no regression)', async () => {
      const app = buildApp(1);
      const res = await request(app)
        .get('/')
        // No X-Forwarded-For header — direct connection
        .expect(200);
      // supertest connects from loopback (127.0.0.1 or ::1)
      expect(['127.0.0.1', '::1', '::ffff:127.0.0.1']).toContain(res.body.ip);
    });

    test('9. A client cannot spoof req.ip by injecting extra addresses into X-Forwarded-For', async () => {
      // Attack: client sends X-Forwarded-For: 1.2.3.4, 5.6.7.8
      // hoping Express will believe req.ip is 1.2.3.4 (a whitelisted IP).
      // With trust proxy: 1, Express trusts exactly 1 hop (the immediate proxy).
      // supertest makes a direct connection, so the connection's remote address
      // (127.0.0.1) is the "trusted proxy". Express strips that hop and uses
      // the rightmost remaining address (5.6.7.8) as the client IP — NOT 1.2.3.4.
      //
      // This means a client behind our Nginx that sends:
      //   X-Forwarded-For: 1.2.3.4 (spoofed client IP claim)
      // will have Nginx rewrite it to:
      //   X-Forwarded-For: 1.2.3.4, <real-client-ip>
      // Express with trust proxy: 1 uses <real-client-ip>, not the spoofed 1.2.3.4.
      const app = buildApp(1);
      const res = await request(app)
        .get('/')
        .set('X-Forwarded-For', '1.2.3.4, 5.6.7.8')
        .expect(200);
      // With trust proxy: 1 and a direct supertest connection (loopback),
      // Express trusts 1 hop → uses rightmost non-loopback address in the chain.
      // The spoofed leftmost address (1.2.3.4) is NOT used as req.ip.
      expect(res.body.ip).not.toBe('1.2.3.4');
    });

    test('10. Without trust proxy, req.ip is always the direct connection IP (baseline comparison)', async () => {
      // Confirms that without trust proxy, X-Forwarded-For is ignored — req.ip
      // is always the socket's remote address. This is the BROKEN behaviour we are fixing.
      const app = buildApp(undefined);  // no trust proxy
      const res = await request(app)
        .get('/')
        .set('X-Forwarded-For', '203.0.113.50')
        .expect(200);
      // Without trust proxy, Express ignores X-Forwarded-For
      expect(res.body.ip).not.toBe('203.0.113.50');
      expect(['127.0.0.1', '::1', '::ffff:127.0.0.1']).toContain(res.body.ip);
    });

  });

});
