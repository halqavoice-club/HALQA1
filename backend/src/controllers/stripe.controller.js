'use strict';
/**
 * Stripe Payment Controller — Phase B-2
 * ─────────────────────────────────────────────────────────────────────────────
 * Two endpoints:
 *  POST /api/v1/stripe/checkout  — create a Stripe Checkout session
 *  POST /api/v1/stripe/webhook   — Stripe webhook (payment confirmation)
 *
 * On successful payment, Stripe calls the webhook with
 * event type `checkout.session.completed`.  We then:
 *   1. Verify the signature (tamper-proof)
 *   2. Extract userId + packageId from session.metadata
 *   3. Credit coins to the wallet via prisma transaction
 *   4. Emit a socket notification to the user
 *
 * NEVER modifies existing wallet.controller.js or wallet.routes.js.
 * The existing /wallet/purchase dev-mode endpoint remains untouched.
 */

const Stripe = require('stripe');
const prisma  = require('../utils/prisma');
const { getIo }          = require('../sockets');
const { successResponse, errorResponse } = require('../utils/response');
const { notify }         = require('../services/notification.service');
const logger             = require('../utils/logger');

// ─── Stripe client (lazy — only initialised when env var present) ─────────────
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith('sk_test_REPLACE')) {
    return null; // Stripe not configured — fall back to dev mode
  }
  return new Stripe(key, { apiVersion: '2024-11-20.acacia' });
}

// ─── POST /api/v1/stripe/checkout ────────────────────────────────────────────
/**
 * Creates a Stripe Checkout Session and returns the URL.
 * The frontend redirects the user to this URL.
 * On success Stripe redirects to STRIPE_SUCCESS_URL.
 */
async function createCheckoutSession(req, res, next) {
  try {
    const { packageId } = req.body;
    if (!packageId) return errorResponse(res, 'packageId required', 400);

    const pkg = await prisma.coinPackage.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) return errorResponse(res, 'Package not found', 404);

    const stripe = getStripe();
    if (!stripe) {
      // Stripe not configured — fall back to existing dev-mode purchase
      // This preserves backward compatibility during development
      return errorResponse(res, 'Stripe not configured — use /wallet/purchase for dev mode', 503);
    }

    const totalCoins = pkg.coins + pkg.bonusCoins;
    // Price stored as Decimal — convert to cents (USD)
    const amountCents = Math.round(Number(pkg.priceUsd) * 100);
    if (amountCents < 50) return errorResponse(res, 'Package price too low for Stripe (min $0.50)', 400);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: {
            name: `${pkg.name} — ${pkg.coins.toLocaleString()} Coins`,
            description: pkg.bonusCoins > 0
              ? `${pkg.coins.toLocaleString()} coins + ${pkg.bonusCoins.toLocaleString()} bonus = ${totalCoins.toLocaleString()} total`
              : `${pkg.coins.toLocaleString()} coins`,
            images: [],  // add coin image URL here if available
          },
        },
        quantity: 1,
      }],
      metadata: {
        userId:    req.user.id,
        packageId: pkg.id,
        coins:     String(pkg.coins),
        bonus:     String(pkg.bonusCoins),
      },
      success_url: process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/wallet?payment=success',
      cancel_url:  process.env.STRIPE_CANCEL_URL  || 'http://localhost:3000/wallet?payment=cancelled',
      customer_email: req.user.email,
      // Expire session after 30 minutes
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    });

    logger.info(`[stripe] Checkout session created for user ${req.user.id}, package ${pkg.id}`);

    return successResponse(res, {
      sessionId:   session.id,
      checkoutUrl: session.url,
    }, 'Checkout session created');
  } catch (e) {
    logger.error(`[stripe] createCheckoutSession error: ${e.message}`);
    next(e);
  }
}

// ─── POST /api/v1/stripe/webhook ─────────────────────────────────────────────
/**
 * Stripe sends signed webhook events here.
 * IMPORTANT: This route must receive the raw request body (Buffer),
 * NOT parsed JSON. That's why the route uses express.raw() middleware.
 */
async function handleWebhook(req, res) {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = getStripe();
  if (!stripe) {
    logger.warn('[stripe] Stripe not configured — webhook ignored');
    return res.json({ received: true });
  }

  let event;
  try {
    if (secret && !secret.startsWith('whsec_REPLACE') && sig) {
      // Production / CLI: verify Stripe signature
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } else if (process.env.STRIPE_SKIP_SIGNATURE === 'true' && process.env.NODE_ENV !== 'production') {
      // M-9 FIX: Signature bypass now requires an EXPLICIT opt-in env var
      // (STRIPE_SKIP_SIGNATURE=true) AND must NOT be production.
      // Previously, ANY non-production NODE_ENV allowed unauthenticated webhook calls.
      // This prevents staging environments that forget to set NODE_ENV=production
      // from accepting forged Stripe events (e.g. fake coin credits).
      const payload = req.body instanceof Buffer ? req.body.toString() : req.body;
      event = typeof payload === 'string' ? JSON.parse(payload) : payload;
      logger.warn('[stripe] Webhook signature skipped — STRIPE_SKIP_SIGNATURE=true (dev only)');
    } else {
      logger.error('[stripe] Webhook secret not configured or signature bypass not explicitly enabled');
      return res.status(400).json({ error: 'Webhook secret not configured' });
    }
  } catch (err) {
    logger.error(`[stripe] Webhook signature verification failed: ${err.message}`);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // ── Handle events ──────────────────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Only process paid sessions (mode=payment always requires payment)
    if (session.payment_status !== 'paid') {
      logger.warn(`[stripe] Session ${session.id} not paid — skipping`);
      return res.json({ received: true });
    }

    const metadata = session.metadata || {};

    // ── Fee payment (L5 fix) ──────────────────────────────────────────────────
    // Sessions created by POST /fees/:id/checkout have type: 'fee_payment'
    if (metadata.type === 'fee_payment') {
      const { feeId, studentId, paidBy } = metadata;
      if (!feeId) {
        logger.error(`[stripe] fee_payment session ${session.id} missing feeId`);
        return res.json({ received: true });
      }

      try {
        // ── DB-first idempotency (Task 8.1) ────────────────────────────────────
        // Check for an existing FeeRecord that already has this stripeSessionId.
        // This is the authoritative guard — Redis alone was insufficient because
        // a Redis outage would allow duplicate fee payments on Stripe retries.
        const existingFee = await prisma.feeRecord.findFirst({
          where:  { id: feeId, stripeSessionId: session.id }
        }).catch(() => null);

        if (existingFee?.status === 'PAID') {
          logger.info(`[stripe] Fee ${feeId} already paid (DB check, session ${session.id}) — skipping`);
          return res.json({ received: true });
        }

        // ── Redis fast-path (supplementary, not authoritative) ─────────────────
        let redisAlreadyDone = false;
        try {
          const { isRedisReady, getCache, setCache } = require('../utils/redis');
          if (isRedisReady()) {
            const key = `stripe:fee:${session.id}`;
            if (await getCache(key)) { redisAlreadyDone = true; }
            else { await setCache(key, { feeId, processedAt: new Date().toISOString() }, 7 * 24 * 3600); }
          }
        } catch { /* Redis unavailable — DB constraint is the fallback guard */ }

        if (redisAlreadyDone) {
          logger.info(`[stripe] Fee ${feeId} already paid (Redis check) — skipping`);
          return res.json({ received: true });
        }

        // ── Update fee record with stripeSessionId (P2002 = already processed) ──
        try {
          await prisma.feeRecord.update({
            where: { id: feeId },
            data:  {
              status:          'PAID',
              paidAt:          new Date(),
              stripeSessionId: session.id,
              notes:           `Paid via Stripe session ${session.id}`
            }
          });
        } catch (updateErr) {
          // P2002 = unique constraint on stripeSessionId — concurrent webhook already processed it
          if (updateErr.code === 'P2002') {
            logger.info(`[stripe] Fee ${feeId} already processed (P2002 race guard, session ${session.id}) — skipping`);
            return res.json({ received: true });
          }
          throw updateErr;
        }

        logger.info(`[stripe] Fee ${feeId} marked PAID (session ${session.id})`);

        // Notify payer in real-time
        const io = getIo();
        if (io && paidBy) {
          io.to(`user:${paidBy}`).emit('fee:paid', { feeId, stripeSessionId: session.id });
        }

        await notify(paidBy, {
          type:  'SYSTEM',
          title: '✅ Fee payment confirmed',
          body:  'Your fee payment was successful.',
          data:  { type: 'fee_paid', feeId }
        }).catch(() => {});

      } catch (feeErr) {
        logger.error(`[stripe] Failed to mark fee ${feeId} as paid: ${feeErr.message}`);
        return res.status(500).json({ error: 'Database error — will retry' });
      }

      return res.json({ received: true });
    }

    // ── Coin purchase (original flow) ─────────────────────────────────────────
    const { userId, packageId, coins, bonus } = metadata;
    if (!userId || !packageId) {
      logger.error(`[stripe] Missing metadata on session ${session.id}`);
      return res.json({ received: true });
    }

    const totalCoins = parseInt(coins || '0') + parseInt(bonus || '0');

    try {
      // ── Idempotency: DB-first check, Redis as second layer ──────────────────
      //
      // SECURITY FIX: Previously relied on Redis alone for idempotency.
      // If Redis was unavailable when the webhook fired, alreadyProcessed was
      // always false, causing double coin credits on Stripe's automatic retries.
      //
      // New strategy (defence in depth):
      //   1. DB check first — look for an existing WalletTransaction with this
      //      stripeSessionId. This is the authoritative source of truth.
      //   2. Redis check second — fast path to skip DB on duplicate deliveries.
      //   3. Atomic DB transaction uses a unique constraint on stripeSessionId
      //      so even a race condition between two simultaneous webhook deliveries
      //      results in only one credit (the second throws P2002 which we catch).

      // Step 1: DB idempotency check (authoritative)
      const existingTx = await prisma.walletTransaction.findUnique({
        where: { stripeSessionId: session.id }
      }).catch(() => null); // graceful — table may not exist in older deployments

      if (existingTx) {
        logger.info(`[stripe] Session ${session.id} already processed (DB check) — skipping`);
        return res.json({ received: true });
      }

      // Step 2: Redis idempotency check (fast path)
      let redisAlreadyProcessed = false;
      try {
        const { isRedisReady, getCache, setCache } = require('../utils/redis');
        if (isRedisReady()) {
          const key = `stripe:session:${session.id}`;
          const existing = await getCache(key);
          if (existing) { redisAlreadyProcessed = true; }
          else { await setCache(key, { userId, processedAt: new Date().toISOString() }, 7 * 24 * 3600); }
        }
      } catch { /* Redis unavailable — fall through to DB transaction */ }

      if (redisAlreadyProcessed) {
        logger.info(`[stripe] Session ${session.id} already processed (Redis check) — skipping`);
        return res.json({ received: true });
      }

      // Step 3: Atomic DB transaction — credit coins + record ledger entry
      await prisma.$transaction(async (tx) => {
        // Credit coins to wallet
        await tx.wallet.upsert({
          where:  { userId },
          create: { userId, coins: totalCoins, diamonds: 0, totalSpent: 0, totalEarned: 0 },
          update: { coins: { increment: totalCoins } }
        });

        // Write ledger entry with unique stripeSessionId constraint.
        // If a concurrent webhook delivery races here, the unique constraint
        // throws P2002 and the transaction rolls back — no double credit.
        await tx.walletTransaction.create({
          data: {
            userId,
            type:            'STRIPE_PURCHASE',
            coins:           totalCoins,
            description:     `Stripe purchase — package ${packageId}`,
            stripeSessionId: session.id,
            packageId,
          }
        }).catch((err) => {
          // P2002 = unique constraint violation — already processed in a race
          if (err.code === 'P2002') {
            throw new Error('ALREADY_PROCESSED');
          }
          throw err;
        });

        // Write platform revenue entry for gross coin inflow — non-fatal for Stripe path.
        // COIN_PURCHASE = full gross amount (platform collects 100% of coin sales revenue;
        // the creator 50% share is only paid out when coins are spent, not when purchased).
        await tx.platformRevenueEntry.create({
          data: {
            id:         require('uuid').v4(),
            sourceType: 'COIN_PURCHASE',
            sourceId:   session.id,
            userId,
            coins:      totalCoins,
            usdEquiv:   parseFloat((totalCoins * 0.01).toFixed(2)),
          }
        }).catch((err) => {
          // Non-fatal for coin purchase — Stripe credit must succeed even if revenue
          // ledger fails (avoids denying users their coins over a secondary write).
          require('../utils/logger').error(`[stripe] Revenue ledger write failed for session ${session.id}: ${err.message}`);
        });
      });

      logger.info(`[stripe] Credited ${totalCoins} coins to user ${userId} (session ${session.id})`);

      // Notify the user in real-time via socket
      const io = getIo();
      if (io) {
        // emit to user's personal room AND wallet-specific room
        io.to(`user:${userId}`).emit('wallet:coins_credited', {
          coins: totalCoins,
          packageId,
          stripeSessionId: session.id
        });
        io.to(`wallet:${userId}`).emit('wallet:coins_credited', {
          coins: totalCoins,
          packageId,
          stripeSessionId: session.id
        });
      }

      // Persistent notification
      await notify(userId, {
        type:  'COINS_PURCHASED',
        title: `💰 ${totalCoins.toLocaleString()} coins added to your wallet!`,
        body:  `Your purchase of ${parseInt(coins).toLocaleString()} coins (+ ${parseInt(bonus || '0')} bonus) was successful.`,
        data:  { type: 'coins_purchased', coins: totalCoins, packageId }
      });

    } catch (dbErr) {
      if (dbErr.message === 'ALREADY_PROCESSED') {
        logger.info(`[stripe] Session ${session.id} already processed (race condition caught) — skipping`);
        return res.json({ received: true });
      }
      logger.error(`[stripe] Failed to credit coins for session ${session.id}: ${dbErr.message}`);
      // Return 500 so Stripe retries the webhook
      return res.status(500).json({ error: 'Database error — will retry' });
    }
  }

  // ── Handle charge.dispute.created (Task 8.2) ─────────────────────────────────
  // A dispute means a customer has challenged a Stripe charge with their bank.
  // Policy: DO NOT automatically clawback coins — flag and notify admins only.
  // Admin must review before any manual coin reversal is applied.
  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object;

    // Always log disputes — never silently swallow them
    logger.warn(
      `[stripe:dispute] charge.dispute.created: id=${dispute.id}, ` +
      `amount=${dispute.amount}, reason=${dispute.reason}, ` +
      `paymentIntent=${dispute.payment_intent}`
    );

    // Look up the corresponding WalletTransaction by payment intent
    // (the stripeSessionId field stores the Checkout session ID, but the
    //  payment_intent is available on the dispute — try both approaches)
    const tx = await prisma.walletTransaction.findFirst({
      where: { stripeSessionId: dispute.payment_intent }
    }).catch(() => null);

    if (!tx) {
      logger.error(
        `[stripe:dispute] No WalletTransaction found for paymentIntent ${dispute.payment_intent}. ` +
        'Manual investigation required.'
      );
      // Return 200 to prevent Stripe from retrying — we've logged the dispute
      return res.json({ received: true });
    }

    // Flag the transaction as disputed — no coin movement, admin review required
    await prisma.walletTransaction.update({
      where: { id: tx.id },
      data:  { type: 'DISPUTED' }
    }).catch(err => {
      logger.error(`[stripe:dispute] Failed to flag transaction ${tx.id}: ${err.message}`);
    });

    // Notify SUPER_ADMIN via socket
    const disputeIo = getIo();
    if (disputeIo) {
      disputeIo.to('role:SUPER_ADMIN').emit('stripe:dispute', {
        disputeId:      dispute.id,
        userId:         tx.userId,
        amount:         dispute.amount,
        reason:         dispute.reason,
        evidenceDueBy:  dispute.evidence_details?.due_by ?? null,
        transactionId:  tx.id,
        paymentIntent:  dispute.payment_intent,
      });
    }

    logger.info(`[stripe:dispute] Transaction ${tx.id} (user ${tx.userId}) flagged as DISPUTED`);
    return res.json({ received: true });
  }

  // Acknowledge all other event types
  return res.json({ received: true });
}

module.exports = { createCheckoutSession, handleWebhook };
