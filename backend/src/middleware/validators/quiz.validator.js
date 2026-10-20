'use strict';
/**
 * Quiz — Zod input validation schemas
 *
 * Follows the same pattern as liveClass.validator.js:
 *   - Zod schemas defined per endpoint
 *   - validateZod middleware re-exported from voice.validator.js
 *   - Returns HTTP 400 with structured errors on failure
 */
const { z } = require('zod');
const { validateZod } = require('./voice.validator');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uuidV4 = z.string().uuid('Must be a valid UUID v4');
const optionalText = (max = 2000) =>
  z.union([z.string().max(max).trim(), z.null()]).optional();
const isoDate = z
  .string()
  .min(1)
  .refine(v => !isNaN(new Date(v).getTime()), { message: 'Must be a valid ISO date string' })
  .optional();

// ─── createQuizSchema ─────────────────────────────────────────────────────────
// POST /api/v1/quizzes
const createQuizSchema = z.object({
  title:        z.string().min(1, 'Title is required').max(200, 'Title must be at most 200 characters').trim(),
  classId:      uuidV4,
  description:  optionalText(1000),
  timeLimitMin: z.number().int().min(1).max(180).optional().nullable(),
  openAt:       isoDate,
  closeAt:      isoDate,
});

// ─── updateQuizSchema ─────────────────────────────────────────────────────────
// PATCH /api/v1/quizzes/:id
const updateQuizSchema = z.object({
  title:        z.string().min(1).max(200).trim().optional(),
  description:  optionalText(1000),
  timeLimitMin: z.number().int().min(1).max(180).optional().nullable(),
  openAt:       isoDate,
  closeAt:      isoDate,
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided' });

// ─── addQuestionSchema ────────────────────────────────────────────────────────
// POST /api/v1/quizzes/:id/questions
const quizOptionSchema = z.object({
  text:      z.string().min(1, 'Option text is required').max(500).trim(),
  isCorrect: z.boolean(),
  position:  z.number().int().min(1).optional(),
});

const addQuestionSchema = z.object({
  prompt:       z.string().min(1, 'Question prompt is required').trim(),
  questionType: z.enum(['MULTIPLE_CHOICE', 'SHORT_ANSWER']),
  options:      z.array(quizOptionSchema).optional(),
  modelAnswer:  optionalText(2000),
  position:     z.number().int().min(1).optional(),
}).superRefine((data, ctx) => {
  if (data.questionType === 'MULTIPLE_CHOICE') {
    if (!data.options || data.options.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'MULTIPLE_CHOICE questions require at least 2 options' });
    } else {
      const correctCount = data.options.filter(o => o.isCorrect).length;
      if (correctCount !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'MULTIPLE_CHOICE questions must have exactly 1 correct option' });
      }
    }
  }
});

// ─── updateQuestionSchema ─────────────────────────────────────────────────────
// PATCH /api/v1/quizzes/:id/questions/:qid
const updateQuestionSchema = z.object({
  prompt:      z.string().min(1).trim().optional(),
  options:     z.array(quizOptionSchema).optional(),
  modelAnswer: optionalText(2000),
  position:    z.number().int().min(1).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided' });

// ─── submitAnswersSchema ──────────────────────────────────────────────────────
// POST /api/v1/quizzes/:id/submit
const answerItemSchema = z.object({
  questionId:       uuidV4,
  selectedOptionId: uuidV4.optional().nullable(),
  answerText:       z.string().max(5000).optional().nullable(),
});

const submitAnswersSchema = z.object({
  answers: z.array(answerItemSchema).min(1, 'At least one answer is required'),
});

// ─── updateFeedbackSchema ─────────────────────────────────────────────────────
// PATCH /api/v1/quizzes/:id/attempts/:aid
const updateFeedbackSchema = z.object({
  feedback: z.string().max(2000).trim(),
});

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  validateZod,
  createQuizSchema,
  updateQuizSchema,
  addQuestionSchema,
  updateQuestionSchema,
  submitAnswersSchema,
  updateFeedbackSchema,
};
