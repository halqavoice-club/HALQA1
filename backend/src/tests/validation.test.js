/**
 * Tests for Zod validation schemas
 */

const { z } = require('zod');
const { validate, loginSchema, registerSchema, createSchoolSchema } = require('../utils/validation');

describe('Zod Validation Schemas', () => {
  describe('loginSchema', () => {
    test('should validate valid login data', () => {
      const validData = {
        email: 'test@example.com',
        password: 'SecurePass123!'
      };

      const result = loginSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should reject invalid email', () => {
      const invalidData = {
        email: 'invalid-email',
        password: 'SecurePass123!'
      };

      const result = loginSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should reject weak password', () => {
      // loginSchema uses min(1) only — login does not enforce complexity.
      // Password complexity is enforced at the route middleware level (auth.routes.js).
      // A blank/empty password should be rejected; a short one is valid for the schema.
      const invalidData = {
        email: 'test@example.com',
        password: ''  // empty string — the only case loginSchema rejects
      };

      const result = loginSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should reject missing fields', () => {
      const invalidData = {
        email: 'test@example.com'
      };

      const result = loginSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('registerSchema', () => {
    test('should validate valid registration data', () => {
      const validData = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890'
      };

      const result = registerSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should reject invalid phone format', () => {
      const invalidData = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe',
        phone: 'invalid-phone'
      };

      const result = registerSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should reject missing required fields', () => {
      const invalidData = {
        email: 'test@example.com',
        password: 'SecurePass123!'
      };

      const result = registerSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('createSchoolSchema', () => {
    test('should validate valid school data', () => {
      // createSchoolSchema requires: name, slug (lowercase-hyphen), type (enum)
      const validData = {
        name: 'Test School',
        slug: 'test-school',
        type: 'school',
        city: 'Test City',
        country: 'Test Country',
        phone: '+1234567890',
        email: 'school@example.com'
      };

      const result = createSchoolSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should reject missing required fields', () => {
      // Missing slug and type — both required
      const invalidData = {
        name: 'Test School'
      };

      const result = createSchoolSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('validate middleware', () => {
    let app;

    beforeEach(() => {
      app = require('express')();
      app.use(require('express').json());
    });

    test('should pass valid data through', async () => {
      app.post('/test', validate(loginSchema), (req, res) => {
        res.json({ success: true });
      });

      const response = await require('supertest')(app)
        .post('/test')
        .send({
          email: 'test@example.com',
          password: 'SecurePass123!'
        });

      expect(response.status).toBe(200);
    });

    test('should reject invalid data with 400', async () => {
      app.post('/test', validate(loginSchema), (req, res) => {
        res.json({ success: true });
      });

      const response = await require('supertest')(app)
        .post('/test')
        .send({
          email: 'invalid-email',
          password: 'SecurePass123!'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('VAL_001');
    });

    test('should handle async validation', async () => {
      const asyncSchema = z.object({
        email: z.string().email().refine(async (email) => {
          // Simulate async check
          await new Promise(resolve => setTimeout(resolve, 10));
          return !email.includes('blocked');
        }, { message: 'Email is blocked' })
      });

      app.post('/test', validate(asyncSchema), (req, res) => {
        res.json({ success: true });
      });

      const response = await require('supertest')(app)
        .post('/test')
        .send({
          email: 'blocked@example.com'
        });

      expect(response.status).toBe(400);
    });
  });
});
