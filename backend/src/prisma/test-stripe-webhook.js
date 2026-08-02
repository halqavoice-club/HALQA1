/**
 * Local Stripe webhook simulator — development only
 * Simulates a successful checkout.session.completed event
 * so you can test the full coin-credit flow without Stripe CLI.
 *
 * Usage:
 *   node src/prisma/test-stripe-webhook.js <userId> <packageId>
 *
 * Example:
 *   node src/prisma/test-stripe-webhook.js abc123 dfde1f94-7fa9-11f1-903d-84a93ea9234c
 */
'use strict';
require('dotenv').config();
const http    = require('http');
const Stripe  = require('stripe');

const [,, userId, packageId] = process.argv;
if (!userId || !packageId) {
  console.error('Usage: node test-stripe-webhook.js <userId> <packageId>');
  process.exit(1);
}

const secretKey     = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (!secretKey || secretKey.includes('REPLACE')) {
  console.error('STRIPE_SECRET_KEY not set in .env');
  process.exit(1);
}
if (!webhookSecret || webhookSecret.includes('REPLACE')) {
  console.log('⚠️  STRIPE_WEBHOOK_SECRET not set — using unsigned test payload');
  console.log('   Webhook signature will NOT be verified (dev mode)');
}

const stripe = new Stripe(secretKey, { apiVersion: '2024-11-20.acacia' });

async function run() {
  try {
    // Build a fake checkout.session.completed event
    const fakeSession = {
      id:             'cs_test_fake_' + Date.now(),
      object:         'checkout.session',
      payment_status: 'paid',
      metadata: {
        userId,
        packageId,
        coins: '1000',
        bonus: '200',
      }
    };

    const payload = JSON.stringify({
      id:      'evt_test_' + Date.now(),
      type:    'checkout.session.completed',
      data:    { object: fakeSession },
    });

    // Sign the payload if webhook secret available
    let signature = 'test_no_signature';
    if (webhookSecret && !webhookSecret.includes('REPLACE')) {
      const timestamp  = Math.floor(Date.now() / 1000);
      const signedPayload = `${timestamp}.${payload}`;
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', webhookSecret.replace('whsec_', ''));
      hmac.update(signedPayload);
      const sig = hmac.digest('hex');
      signature = `t=${timestamp},v1=${sig}`;
    }

    const options = {
      host:   'localhost',
      port:   5000,
      path:   '/api/v1/stripe/webhook',
      method: 'POST',
      headers: {
        'Content-Type':       'application/json',
        'Content-Length':     Buffer.byteLength(payload),
        'stripe-signature':   signature,
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('✅ Webhook delivered successfully');
          console.log('   Check the user wallet — 1200 coins should be credited');
        } else {
          console.log('❌ Webhook failed (' + res.statusCode + '): ' + body);
        }
        process.exit(res.statusCode === 200 ? 0 : 1);
      });
    });

    req.on('error', e => { console.error('Request error:', e.message); process.exit(1); });
    req.write(payload);
    req.end();
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

run();
