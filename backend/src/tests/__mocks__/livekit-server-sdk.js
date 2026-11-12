'use strict';
/**
 * LiveKit Server SDK Mock for Jest CJS Environment
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides minimal CommonJS mock of livekit-server-sdk@2.6.1 (ESM-only package)
 * to unblock Jest unit tests that import controllers using livekitService.js.
 *
 * This mock:
 *  - Prevents ESM parse errors in Jest's CJS environment
 *  - Does NOT make real LiveKit API calls
 *  - Fails loudly on unexpected method calls via Proxy traps
 *  - Preserves per-suite custom mocks (suite-level jest.mock takes precedence)
 *
 * Production code is UNAFFECTED — this file is only loaded by Jest via
 * moduleNameMapper when running unit tests.
 */

/**
 * Mock AccessToken matching livekit-server-sdk API shape.
 * Used by livekitService.js for token generation.
 */
class MockAccessToken {
  constructor(apiKey, apiSecret, options) {
    this._apiKey = apiKey;
    this._apiSecret = apiSecret;
    this._options = options || {};
    this._grant = null;
  }

  addGrant(grant) {
    if (!grant || typeof grant !== 'object') {
      throw new Error('[MockAccessToken] addGrant requires a grant object');
    }
    this._grant = grant;
  }

  async toJwt() {
    if (!this._grant) {
      throw new Error('[MockAccessToken] toJwt called before addGrant');
    }
    // Return deterministic mock token for test assertions
    return `mock.livekit.token.${Date.now()}`;
  }
}

/**
 * Mock RoomServiceClient matching livekit-server-sdk API shape.
 * Used by livekitService.js for SFU operations (evict, revoke publish).
 */
class MockRoomServiceClient {
  constructor(host, apiKey, apiSecret) {
    this._host = host;
    this._apiKey = apiKey;
    this._apiSecret = apiSecret;
  }

  /**
   * PH17-002: removeParticipant (SFU eviction on kick/ban)
   */
  async removeParticipant(roomName, identity) {
    if (!roomName || !identity) {
      throw new Error('[MockRoomServiceClient] removeParticipant requires roomName and identity');
    }
    // Best-effort mock: always succeeds, logs nothing (silent success)
    return Promise.resolve({ /* empty response */ });
  }

  /**
   * PH17-003/PH22-003: updateParticipant (revoke canPublish capability)
   */
  async updateParticipant(roomName, identity, metadata, permission) {
    if (!roomName || !identity) {
      throw new Error('[MockRoomServiceClient] updateParticipant requires roomName and identity');
    }
    // Best-effort mock: always succeeds
    return Promise.resolve({ /* empty response */ });
  }
}

// Fail-loud Proxy for unexpected exports
const handler = {
  get(target, prop) {
    if (prop in target) return target[prop];
    throw new Error(
      `[livekit-server-sdk MOCK] Unexpected export access: "${String(prop)}". ` +
      `Unit tests must mock or stub any additional SDK exports they require.`
    );
  }
};

module.exports = new Proxy(
  {
    AccessToken: MockAccessToken,
    RoomServiceClient: MockRoomServiceClient,
  },
  handler
);
