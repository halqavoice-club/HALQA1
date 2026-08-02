/**
 * Live Class — Zod input validation schemas
 *
 * Validates create and update live class request bodies.
 * Returns HTTP 400 on failure; calls next() on success (body unchanged).
 */

const { z } = require('zod');
const { validateZod } = require('./voice.validator');

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createLiveClassSchema = z.object({
  classId: z.string().min(1, 'classId is required'),
  title: z.string().min(1, 'Title is required').max(100, 'Title must be at most 100 characters').trim(),
  description: z.string().max(500, 'Description must be at most 500 characters').optional(),
  duration: z
    .union([
      z.number().int().min(1, 'duration must be a positive integer'),
      z.null(),
    ])
    .optional(),
  maxParticipants: z.number().int().min(1).max(1000).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  teacherId: z.string().uuid('teacherId must be a valid UUID').optional(),
}).passthrough();

const updateLiveClassSchema = z.object({
  title: z.string().min(1, 'Title cannot be empty').max(100, 'Title must be at most 100 characters').trim().optional(),
  description: z.string().max(500, 'Description must be at most 500 characters').optional(),
  duration: z
    .union([
      z.number().int().min(1, 'duration must be a positive integer'),
      z.null(),
    ])
    .optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  chatEnabled: z.boolean().optional(),
  handRaiseEnabled: z.boolean().optional(),
  quranPanelEnabled: z.boolean().optional(),
  whiteboardEnabled: z.boolean().optional(),
  screenShareEnabled: z.boolean().optional(),
  isOpenMic: z.boolean().optional(),
  maxParticipants: z.number().int().min(1).max(1000).optional(),
}).passthrough();

module.exports = {
  validateZod,
  createLiveClassSchema,
  updateLiveClassSchema,
};
