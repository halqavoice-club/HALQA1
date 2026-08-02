/**
 * Tests for response caching middleware
 */

const request = require('supertest');
const express = require('express');
const { shortCache, mediumCache, longCache, noCache, privateCache } = require('../middleware/cache');

describe('Response Caching Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('shortCache', () => {
    test('should set Cache-Control header with 5 minute max-age', async () => {
      app.get('/test', shortCache, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/test');

      expect(response.headers['cache-control']).toContain('max-age=300');
      expect(response.headers['cache-control']).toContain('public');
    });

    test('should set ETag header', async () => {
      app.get('/test', shortCache, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/test');

      expect(response.headers['etag']).toBeDefined();
      expect(response.headers['etag']).toMatch(/^".*"$/);
    });

    test('should set Last-Modified header', async () => {
      app.get('/test', shortCache, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/test');

      expect(response.headers['last-modified']).toBeDefined();
    });
  });

  describe('mediumCache', () => {
    test('should set Cache-Control header with 1 hour max-age', async () => {
      app.get('/test', mediumCache, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/test');

      expect(response.headers['cache-control']).toContain('max-age=3600');
      expect(response.headers['cache-control']).toContain('s-maxage=3600');
      expect(response.headers['cache-control']).toContain('stale-while-revalidate=600');
    });
  });

  describe('longCache', () => {
    test('should set Cache-Control header with 1 day max-age', async () => {
      app.get('/test', longCache, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/test');

      expect(response.headers['cache-control']).toContain('max-age=86400');
      expect(response.headers['cache-control']).toContain('stale-if-error=86400');
    });
  });

  describe('noCache', () => {
    test('should set no-store and no-cache directives', async () => {
      app.get('/test', noCache, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/test');

      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['cache-control']).toContain('no-cache');
    });
  });

  describe('privateCache', () => {
    test('should set private directive', async () => {
      app.get('/test', privateCache, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/test');

      expect(response.headers['cache-control']).toContain('private');
      expect(response.headers['cache-control']).toContain('must-revalidate');
    });
  });

  describe('generateETag', () => {
    test('should generate consistent ETag for same body', () => {
      const { generateETag } = require('../middleware/cache');
      const body = { data: 'test' };

      const etag1 = generateETag(body);
      const etag2 = generateETag(body);

      expect(etag1).toBe(etag2);
    });

    test('should generate different ETags for different bodies', () => {
      const { generateETag } = require('../middleware/cache');
      const body1 = { data: 'test1' };
      const body2 = { data: 'test2' };

      const etag1 = generateETag(body1);
      const etag2 = generateETag(body2);

      expect(etag1).not.toBe(etag2);
    });

    test('should return null for null body', () => {
      const { generateETag } = require('../middleware/cache');
      const etag = generateETag(null);

      expect(etag).toBeNull();
    });
  });

  describe('parseCacheControl', () => {
    test('should parse cache control options correctly', () => {
      const { parseCacheControl } = require('../middleware/cache');
      const options = {
        maxAge: 300,
        public: true,
        mustRevalidate: true
      };

      const result = parseCacheControl(options);

      expect(result).toContain('max-age=300');
      expect(result).toContain('public');
      expect(result).toContain('must-revalidate');
    });
  });
});
