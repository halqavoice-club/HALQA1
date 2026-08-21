/**
 * PK Validator Middleware
 * Zod-based validation for PK API endpoints.
 * Follows the exact same pattern as gift.validator.js.
 */

'use strict';

const { z } = require('zod');
const { errorResponse } = require('../../utils/response');

/**
 * Validate request body against a Zod schema.
 * Returns a middleware that responds with 400 on failure.
 */
function validateZod(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const msg = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return errorResponse(res, msg, 400);
    }
    req.body = result.data;
    next();
  };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createMatchSchema = z.object({
  sideBUserId:     z.string().uuid('sideBUserId must be a valid UUID'),
  type:            z.enum(['ONE_V_ONE', 'ROOM_V_ROOM', 'TEAM_V_TEAM', 'CLUB_V_CLUB', 'TOURNAMENT']).optional(),
  durationSeconds: z.number().int().min(60).max(600).optional(),
  seasonId:        z.string().uuid().optional().nullable(),
  tournamentId:    z.string().uuid().optional().nullable(),
  roomIdA:         z.string().optional().nullable(),
  roomIdB:         z.string().optional().nullable(),
  idempotencyKey:  z.string().optional(),
});

const sendInvitationSchema = z.object({
  receiverId:      z.string().uuid('receiverId must be a valid UUID'),
  type:            z.enum(['ONE_V_ONE', 'ROOM_V_ROOM', 'TEAM_V_TEAM', 'CLUB_V_CLUB']).optional(),
  durationSeconds: z.number().int().min(60).max(600).optional(),
  teamSize:        z.number().int().min(1).max(5).optional(),
  message:         z.string().max(280).optional().nullable(),
});

const joinQueueSchema = z.object({
  type:            z.enum(['ONE_V_ONE', 'ROOM_V_ROOM', 'TEAM_V_TEAM']).optional(),
  durationSeconds: z.number().int().min(60).max(600).optional(),
  teamSize:        z.number().int().min(1).max(5).optional(),
  lang:            z.string().max(10).optional().nullable(),
  region:          z.string().max(40).optional().nullable(),
});

const voteSchema = z.object({
  side: z.enum(['A', 'B']),
});

module.exports = {
  validateZod,
  createMatchSchema,
  sendInvitationSchema,
  joinQueueSchema,
  voteSchema,
};
