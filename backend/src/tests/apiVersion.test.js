/**
 * Tests for API versioning middleware
 *
 * Fix log (pre-existing failures):
 *   - extractVersion regex updated: was /^\/api\/(v\d+)\//, now /\/(v\d+)\//
 *     so it matches mounted paths like /v1/test (after Express strips /api prefix).
 *   - guard tests: req.apiVersion must be set BEFORE guard runs (by apiVersionMiddleware).
 *   - v1/v2 deprecation tests: apiVersionMiddleware must run before v1/v2 guard.
 *   - getApiVersion is now exported as alias for extractVersion.
 *   - getMigrationInfo and isCompatible added to exports.
 */

const request = require('supertest');
const express = require('express');
const {
  middleware: apiVersionMiddleware,
  v1, v2,
  guard,
  getApiVersion,
  getMigrationInfo,
  isCompatible
} = require('../middleware/apiVersion');

describe('API Versioning Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  // ── URL-based versioning ────────────────────────────────────────────────────
  describe('URL-based versioning', () => {
    test('should detect v1 from URL path', async () => {
      // apiVersionMiddleware mounted at /api — Express strips /api prefix,
      // so req.path becomes /v1/test inside the middleware.
      app.use('/api', apiVersionMiddleware);
      app.get('/api/v1/test', (req, res) => res.json({ version: req.apiVersion }));

      const response = await request(app).get('/api/v1/test');
      expect(response.status).toBe(200);
      expect(response.body.version).toBe('v1');
    });

    test('should detect v2 from URL path', async () => {
      app.use('/api', apiVersionMiddleware);
      app.get('/api/v2/test', (req, res) => res.json({ version: req.apiVersion }));

      const response = await request(app).get('/api/v2/test');
      expect(response.status).toBe(200);
      expect(response.body.version).toBe('v2');
    });
  });

  // ── Header-based versioning ─────────────────────────────────────────────────
  describe('Header-based versioning', () => {
    test('should detect version from Accept-Version header', async () => {
      app.use('/api', apiVersionMiddleware);
      app.get('/api/test', (req, res) => res.json({ version: req.apiVersion }));

      const response = await request(app)
        .get('/api/test')
        .set('Accept-Version', 'v2');

      expect(response.status).toBe(200);
      expect(response.body.version).toBe('v2');
    });

    test('should prefer URL version over header version', async () => {
      app.use('/api', apiVersionMiddleware);
      app.get('/api/v1/test', (req, res) => res.json({ version: req.apiVersion }));

      const response = await request(app)
        .get('/api/v1/test')
        .set('Accept-Version', 'v2');

      // URL wins over header
      expect(response.body.version).toBe('v1');
    });
  });

  // ── Version guards ──────────────────────────────────────────────────────────
  describe('Version guards', () => {
    test('should allow request for allowed version', async () => {
      // apiVersionMiddleware sets req.apiVersion, then guard checks it
      app.use('/api', apiVersionMiddleware);
      app.get('/api/v1/test', guard(['v1', 'v2']), (req, res) => res.json({ success: true }));

      const response = await request(app).get('/api/v1/test');
      expect(response.status).toBe(200);
    });

    test('should reject request for disallowed version', async () => {
      // Mount middleware so req.apiVersion is set to v2 (from URL)
      app.use('/api', apiVersionMiddleware);
      // Guard only allows v1 — v2 request should get 400
      app.get('/api/v2/test', guard(['v1']), (req, res) => res.json({ success: true }));

      const response = await request(app).get('/api/v2/test');
      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('should reject request when no version resolves to non-allowed', async () => {
      // No middleware — req.apiVersion is undefined, guard(['v1']) should reject
      app.get('/test', guard(['v1']), (req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');
      // undefined apiVersion not in ['v1']
      expect(response.status).toBe(400);
    });
  });

  // ── Deprecation warnings ────────────────────────────────────────────────────
  describe('Deprecation warnings', () => {
    test('should add deprecation header for deprecated version (v1)', async () => {
      // apiVersionMiddleware must set isDeprecated before v1 guard
      app.use('/api', apiVersionMiddleware);
      app.get('/api/v1/test', v1, (req, res) => res.json({ success: true }));

      const response = await request(app).get('/api/v1/test');

      expect(response.headers['deprecation']).toBe('true');
    });

    test('should not add deprecation header for current version (v2)', async () => {
      app.use('/api', apiVersionMiddleware);
      app.get('/api/v2/test', v2, (req, res) => res.json({ success: true }));

      const response = await request(app).get('/api/v2/test');

      expect(response.headers['deprecation']).toBeUndefined();
    });
  });

  // ── getApiVersion (alias for extractVersion) ────────────────────────────────
  describe('getApiVersion', () => {
    test('should extract version from URL path', () => {
      const req = { path: '/v1/users', headers: {} };
      expect(getApiVersion(req)).toBe('v1');
    });

    test('should extract version from Accept-Version header', () => {
      const req = { path: '/users', headers: { 'accept-version': 'v2' } };
      expect(getApiVersion(req)).toBe('v2');
    });

    test('should return default (v1) when no version found', () => {
      const req = { path: '/users', headers: {} };
      // defaults to v1
      expect(getApiVersion(req)).toBe('v1');
    });
  });

  // ── getMigrationInfo ────────────────────────────────────────────────────────
  describe('getMigrationInfo', () => {
    test('should provide migration information', () => {
      const info = getMigrationInfo('v1', 'v2');
      expect(info).toBeDefined();
      expect(info.from).toBe('v1');
      expect(info.to).toBe('v2');
    });
  });

  // ── isCompatible ────────────────────────────────────────────────────────────
  describe('isCompatible', () => {
    test('should check version compatibility', () => {
      expect(isCompatible('v1', 'v1')).toBe(true);
      expect(isCompatible('v2', 'v2')).toBe(true);
      expect(isCompatible('v1', 'v2')).toBe(false);
    });
  });
});
