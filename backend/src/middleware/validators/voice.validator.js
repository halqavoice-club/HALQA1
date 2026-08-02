/**
 * Voice Room — Zod input validation schemas
 *
 * Usage: add validateZod(schema) before the controller in a route definition.
 * On failure: returns HTTP 400 with { success: false, message, errors: [...] }
 * On success: calls next() — request body is NOT replaced so controllers receive
 * the original body unchanged (Requirement 4.5).
 */

const { z } = require('zod');
const { errorResponse } = require('../../utils/response');

// ─── Generic Zod middleware factory ──────────────────────────────────────────
function validateZod(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Zod v4 uses result.error.issues (v3 used result.error.errors)
      const issues = result.error.issues ?? result.error.errors ?? [];
      const errors = issues.map((e) => ({
        field: e.path.join('.') || 'body',
        message: e.message,
      }));
      return errorResponse(res, 'Validation failed', 400, errors);
    }
    next();
  };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createRoomSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100, 'Title must be at most 100 characters').trim(),
  description: z.string().max(500, 'Description must be at most 500 characters').optional(),
  privacy: z.enum(['PUBLIC', 'PRIVATE', 'INVITE_ONLY']).optional(),
  maxSpeakers: z.number().int().min(2, 'maxSpeakers must be at least 2').max(50, 'maxSpeakers must be at most 50').optional(),
}).passthrough(); // allow extra fields through unchanged

const updateRoomSchema = z.object({
  title: z.string().min(1, 'Title cannot be empty').max(100, 'Title must be at most 100 characters').trim().optional(),
  description: z.string().max(500, 'Description must be at most 500 characters').optional(),
  privacy: z.enum(['PUBLIC', 'PRIVATE', 'INVITE_ONLY']).optional(),
  maxSpeakers: z.number().int().min(2, 'maxSpeakers must be at least 2').max(50, 'maxSpeakers must be at most 50').optional(),
  topic: z.string().optional(),
  coverEmoji: z.string().optional(),
  coverImageUrl: z.string().nullable().optional(),
  commentsEnabled: z.boolean().optional(),
  slowMode: z.boolean().optional(),
  messageType: z.enum(['all', 'followers', 'none']).optional(),
  reactionsEnabled: z.boolean().optional(),
}).passthrough();

const sendMessageSchema = z.object({
  body: z.string().min(1, 'Message body is required').max(2000, 'Message must be at most 2000 characters').trim(),
}).passthrough();

module.exports = {
  validateZod,
  createRoomSchema,
  updateRoomSchema,
  sendMessageSchema,
};
