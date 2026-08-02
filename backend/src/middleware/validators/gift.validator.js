/**
 * Gift — Zod input validation schemas
 *
 * Validates sendGift and sendGiftToAll request bodies.
 * Returns HTTP 400 on failure; calls next() on success (body unchanged).
 */

const { z } = require('zod');
const { validateZod } = require('./voice.validator');

// ─── Schemas ──────────────────────────────────────────────────────────────────

// Send a gift to a specific receiver
const sendGiftSchema = z.object({
  giftId: z.string().uuid('giftId must be a valid UUID'),
  receiverId: z.string().uuid('receiverId must be a valid UUID'),
  count: z.number().int().min(1, 'count must be at least 1').max(100, 'count must be at most 100').optional(),
  idempotencyKey: z.string().optional(),
}).passthrough();

// Send a gift to all speakers/host in the room
const sendGiftToAllSchema = z.object({
  giftId: z.string().uuid('giftId must be a valid UUID'),
  count: z.number().int().min(1, 'count must be at least 1').max(100, 'count must be at most 100').optional(),
  idempotencyKey: z.string().optional(),
}).passthrough();

module.exports = {
  validateZod,
  sendGiftSchema,
  sendGiftToAllSchema,
};
