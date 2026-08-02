/**
 * Tests for API versioning middleware
 */

const request = require('supertest');
const express = require('express');
const { middleware: apiVersionMiddleware, v1, v2, guard, getApiVersion } = require('../middleware/apiVersion');

describe('API Versioning Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('URL-based versioning', () => {
    test('should detect version from URL path', async () => {
      app.use('/api', apiVersionMiddleware);
      app.get('/api/v1/test', (req, res) => {
        res.json({ version: req.apiVersion });
      });

      const response = await request(app).get('/api/v1/test');

      expect(response.status).toBe(200);
      expect(response.body.version).toBe('v1');
    });

    test('should detect v2 from URL path', async () => {
      app.use('/api', apiVersionMiddleware);
      app.get('/api/v2/test', (req, res) => {
        res.json({ version: req.apiVersion });
      });

      const response = await request(app).get('/api/v2/test');

      expect(response.status).toBe(200);
      expect(response.body.version).toBe('v2');
    });
  });

  describe('Header-based versioning', () => {
    test('should detect version from Accept-Version header', async () => {
      app.use('/api', apiVersionMiddleware);
      app.get('/api/test', (req, res) => {
        res.json({ version: req.apiVersion });
      });

      const response = await request(app)
        .get('/api/test')
        .set('Accept-Version', 'v2');

      expect(response.status).toBe(200);
      expect(response.body.version).toBe('v2');
    });

    test('should prefer URL version over header version', async () => {
      app.use('/api', apiVersionMiddleware);
      app.get('/api/v1/test', (req, res) => {
        res.json({ version: req.apiVersion });
      });

      const response = await request(app)
        .get('/api/v1/test')
        .set('Accept-Version', 'v2');

      expect(response.body.version).toBe('v1');
    });
  });

  describe('Version guards', () => {
    test('should allow request for allowed version', async () => {
      app.get('/test', guard(['v1', 'v2']), (req, res) => {
        req.apiVersion = 'v1';
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/test')
        .set('Accept-Version', 'v1');

      expect(response.status).toBe(200);
    });

    test('should reject request for disallowed version', async () => {
      app.get('/test', guard(['v1']), (req, res) => {
        req.apiVersion = 'v2';
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/test')
        .set('Accept-Version', 'v2');

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('should reject request with no version', async () => {
      app.get('/test', guard(['v1']), (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/test');

      expect(response.status).toBe(400);
    });
  });

  describe('Deprecation warnings', () => {
    test('should add deprecation header for deprecated version', async () => {
      app.use('/api', apiVersionMiddleware);
      app.get('/api/v1/test', v1, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/api/v1/test');

      expect(response.headers['deprecation']).toBe('true');
    });

    test('should not add deprecation header for current version', async () => {
      app.use('/api', apiVersionMiddleware);
      app.get('/api/v2/test', v2, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/api/v2/test');

      expect(response.headers['deprecation']).toBeUndefined();
    });
  });

  describe('getApiVersion', () => {
    test('should extract version from URL path', () => {
      const req = { path: '/api/v1/users' };
      const version = getApiVersion(req);

      expect(version).toBe('v1');
    });

    test('should extract version from header', () => {
      const req = { path: '/api/users', headers: { 'accept-version': 'v2' } };
      const version = getApiVersion(req);

      expect(version).toBe('v2');
    });

    test('should return null when no version found', () => {
      const req = { path: '/api/users', headers: {} };
      const version = getApiVersion(req);

      expect(version).toBeNull();
    });
  });

  describe('Migration helpers', () => {
    test('should provide migration information', () => {
      const { getMigrationInfo } = require('../middleware/apiVersion');
      const info = getMigrationInfo('v1', 'v2');

      expect(info).toBeDefined();
      expect(info.from).toBe('v1');
      expect(info.to).toBe('v2');
    });
  });

  describe('Compatibility matrix', () => {
    test('should check version compatibility', () => {
      const { isCompatible } = require('../middleware/apiVersion');

      expect(isCompatible('v1', 'v1')).toBe(true);
      expect(isCompatible('v2', 'v2')).toBe(true);
      expect(isCompatible('v1', 'v2')).toBe(false);
    });
  });
});
