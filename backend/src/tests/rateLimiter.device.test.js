/**
 * Tests for per-device rate limiting middleware
 */

const request = require('supertest');
const express = require('express');
const { moderateDeviceLimiter, strictDeviceLimiter } = require('../middleware/rateLimiter.device');

describe('Per-Device Rate Limiter', () => {
  let app;
  let deviceHeaders;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    deviceHeaders = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'accept-language': 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate, br',
      'accept': 'application/json'
    };
  });

  test('should generate consistent device fingerprint', async () => {
    app.get('/test', moderateDeviceLimiter, (req, res) => {
      res.json({ fingerprint: req.deviceFingerprint });
    });

    const response1 = await request(app)
      .get('/test')
      .set(deviceHeaders);

    const response2 = await request(app)
      .get('/test')
      .set(deviceHeaders);

    expect(response1.body.fingerprint).toBeDefined();
    expect(response1.body.fingerprint).toBe(response2.body.fingerprint);
  });

  test('should allow requests within device limit', async () => {
    let requestCount = 0;
    
    app.get('/test', moderateDeviceLimiter, (req, res) => {
      requestCount++;
      res.json({ count: requestCount });
    });

    for (let i = 0; i < 10; i++) {
      const response = await request(app)
        .get('/test')
        .set(deviceHeaders);
      
      expect(response.status).toBe(200);
    }
  });

  test('should block requests exceeding device limit', async () => {
    let requestCount = 0;
    
    app.get('/test', strictDeviceLimiter, (req, res) => {
      requestCount++;
      res.json({ count: requestCount });
    });

    const responses = [];
    for (let i = 0; i < 10; i++) {
      const response = await request(app)
        .get('/test')
        .set(deviceHeaders);
      responses.push(response);
    }

    // First 5 should succeed
    for (let i = 0; i < 5; i++) {
      expect(responses[i].status).toBe(200);
    }

    // Remaining should be rate limited
    for (let i = 5; i < 10; i++) {
      expect(responses[i].status).toBe(429);
      expect(responses[i].body.error).toBeDefined();
    }
  });

  test('should treat different user agents as different devices', async () => {
    let requestCount = 0;
    
    app.get('/test', strictDeviceLimiter, (req, res) => {
      requestCount++;
      res.json({ count: requestCount });
    });

    const headers1 = { ...deviceHeaders };
    const headers2 = { ...deviceHeaders, 'user-agent': 'Different User Agent' };

    // Exhaust limit for device 1
    for (let i = 0; i < 5; i++) {
      await request(app).get('/test').set(headers1);
    }

    // Device 1 should be rate limited
    let response = await request(app).get('/test').set(headers1);
    expect(response.status).toBe(429);

    // Device 2 should still work
    response = await request(app).get('/test').set(headers2);
    expect(response.status).toBe(200);
  });

  test('should enforce per-user limit across all devices', async () => {
    let requestCount = 0;
    
    app.get('/test', strictDeviceLimiter, (req, res) => {
      requestCount++;
      res.json({ count: requestCount });
    });

    const userId = 'test-user-123';
    const headers1 = { ...deviceHeaders, 'X-User-Id': userId };
    const headers2 = { ...deviceHeaders, 'user-agent': 'Different', 'X-User-Id': userId };

    // Make requests from device 1
    for (let i = 0; i < 3; i++) {
      await request(app).get('/test').set(headers1);
    }

    // Make requests from device 2
    for (let i = 0; i < 3; i++) {
      await request(app).get('/test').set(headers2);
    }

    // Total 6 requests for same user should exceed per-user limit
    let response = await request(app).get('/test').set(headers1);
    expect(response.status).toBe(429);
  });
});
