'use strict';
/**
 * Jest manual mock for livekit-server-sdk
 * The real SDK uses ESM (export syntax) which Jest cannot parse in CJS mode.
 * This mock provides the minimum interface used by livekit.controller.js.
 */

class AccessToken {
  constructor(_apiKey, _apiSecret, _opts) {
    this.grants = [];
  }
  addGrant(grant) {
    this.grants.push(grant);
  }
  async toJwt() {
    return 'mock.livekit.jwt.token';
  }
}

module.exports = { AccessToken };
