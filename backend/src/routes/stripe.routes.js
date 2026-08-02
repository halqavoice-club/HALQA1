'use strict';
/**
 * Stripe Routes — Phase B-2
 * Mounted at /api/v1/stripe
 * New file — does NOT modify wallet.routes.js
 */
const router = require('express').Router();
const express = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { createCheckoutSession, handleWebhook } = require('../controllers/stripe.controller');

// ─── Webhook — MUST use raw body (before any JSON parsing) ───────────────────
// Stripe signature verification requires the raw Buffer, not parsed JSON.
// express.raw() is applied ONLY to this route.
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  handleWebhook
);

// ─── All other routes require authentication ──────────────────────────────────
router.use(authenticate);

// ─── Create Checkout Session ──────────────────────────────────────────────────
router.post(
  '/checkout',
  [body('packageId').notEmpty().withMessage('packageId required')],
  validate,
  createCheckoutSession
);

module.exports = router;
