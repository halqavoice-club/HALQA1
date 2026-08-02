'use strict';
/**
 * Jest manual mock for the 'stripe' npm package.
 * Prevents real network calls in tests while providing the interface
 * used by stripe.controller.js.
 */

class StripeMock {
  constructor(_key, _opts) {}

  get checkout() {
    return {
      sessions: {
        create: jest.fn().mockResolvedValue({
          id:  'cs_test_mock_session',
          url: 'https://checkout.stripe.com/test',
        }),
      },
    };
  }

  get webhooks() {
    return {
      // constructEvent is called when STRIPE_WEBHOOK_SECRET is set.
      // In tests we leave the secret unset → dev mode (no signature check),
      // so this mock is a safety net for production-mode tests.
      constructEvent: jest.fn((body, sig, secret) => {
        try {
          const payload = Buffer.isBuffer(body) ? body.toString() : body;
          return typeof payload === 'string' ? JSON.parse(payload) : payload;
        } catch {
          throw new Error('Invalid webhook payload');
        }
      }),
    };
  }
}

module.exports = StripeMock;
