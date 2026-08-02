/**
 * Marketplace — Zod input validation schemas
 *
 * Validates product create/update request bodies.
 * Returns HTTP 400 on failure; calls next() on success (body unchanged).
 */

const { z } = require('zod');
const { validateZod } = require('./voice.validator');

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createProductSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100, 'Title must be at most 100 characters').trim(),
  description: z.string().max(500, 'Description must be at most 500 characters').optional(),
  price: z
    .number()
    .positive('Price must be a positive number')
    .refine(
      (v) => Number.isFinite(v) && /^\d+(\.\d{1,2})?$/.test(String(Math.round(v * 100) / 100)),
      { message: 'Price must be a valid positive decimal with at most 2 decimal places' }
    ),
}).passthrough();

const updateProductSchema = z.object({
  title: z.string().min(1, 'Title cannot be empty').max(100, 'Title must be at most 100 characters').trim().optional(),
  description: z.string().max(500, 'Description must be at most 500 characters').optional(),
  price: z
    .number()
    .positive('Price must be a positive number')
    .refine(
      (v) => Number.isFinite(v) && /^\d+(\.\d{1,2})?$/.test(String(Math.round(v * 100) / 100)),
      { message: 'Price must be a valid positive decimal with at most 2 decimal places' }
    )
    .optional(),
}).passthrough();

module.exports = {
  validateZod,
  createProductSchema,
  updateProductSchema,
};
