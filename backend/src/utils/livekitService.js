'use strict';
/**
 * livekitService.js — Shared LiveKit RoomServiceClient factory + helpers
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralises RoomServiceClient construction so both voice.controller.js and
 * live-class.controller.js share the same credential/client pattern without
 * duplication.
 *
 * Returns null when LiveKit credentials are not configured.
 * A new client is created per call — the Twirp HTTP transport is stateless so
 * pooling is unnecessary. This matches the existing live-class pattern.
 *
 * Callers MUST treat a null return as "LiveKit not configured in this
 * environment" and skip the call gracefully. They must NOT throw or fail
 * the parent HTTP response when the client is null.
 *
 * PH17-002/003/004 FIX: Added sfuEvict() and sfuRevokePublish() helpers.
 * These wrap the LiveKit RoomServiceClient calls that enforce capability
 * changes at the SFU level — removing a participant or stripping their
 * canPublish permission — so the DB authorization state is reflected in
 * the SFU without waiting for the 1h token TTL to expire.
 *
 * Both helpers are best-effort: a LiveKit API failure is logged and swallowed.
 * The DB change and Socket.IO notification always persist regardless of whether
 * the SFU call succeeds. This matches the existing live-class kick pattern.
 */

const { RoomServiceClient } = require('livekit-server-sdk');
const logger = require('./logger');

/**
 * Returns a configured RoomServiceClient, or null if LiveKit env vars are absent.
 * @returns {import('livekit-server-sdk').RoomServiceClient | null}
 */
function getLivekitRoomService() {
  const url    = process.env.LIVEKIT_URL;
  const key    = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) return null;
  // Convert wss:// to https:// for the REST/Twirp API host
  const host = url.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
  return new RoomServiceClient(host, key, secret);
}

/**
 * PH17-002 FIX: Best-effort SFU eviction on kick/ban.
 *
 * Calls removeParticipant() so the user's existing LiveKit connection is
 * terminated immediately — their 1h token can no longer be used to rejoin
 * the SFU room after this call, because the SFU validates room membership
 * on every connection attempt.
 *
 * Best-effort: LiveKit API failures are logged and swallowed.
 * The DB kick/ban always persists regardless.
 *
 * @param {string} roomName  — LiveKit room name (= voice roomId or liveclass livekitRoomName)
 * @param {string} identity  — participant identity (= userId)
 * @param {string} logPrefix — e.g. '[voice]' or '[live-class]' for log context
 */
async function sfuEvict(roomName, identity, logPrefix = '[livekit]') {
  const svc = getLivekitRoomService();
  if (!svc) return; // LiveKit not configured — skip gracefully
  try {
    await svc.removeParticipant(roomName, identity);
    logger.info(`${logPrefix} SFU eviction succeeded for ${identity} in ${roomName}`);
  } catch (err) {
    logger.warn(`${logPrefix} SFU eviction failed for ${identity} in ${roomName}: ${err.message}`);
  }
}

/**
 * PH17-001/003/004 FIX + PHASE F2-A: SFU capability revocation with enforcement reporting.
 *
 * Calls updateParticipant() to set canPublish=false on the live SFU participant.
 * This means a demoted SPEAKER or muted AUDIENCE member cannot publish audio
 * even if their token still contains canPublish:true (issued before demotion).
 *
 * The SFU enforces the updated permission immediately — no reconnect required.
 * When the participant later gets promoted again, a fresh token request will
 * issue canPublish:true and updateParticipant() with canPublish:true restores it.
 *
 * PHASE F2-A: Now returns explicit enforcement status so callers can detect
 * SFU update failures and handle them appropriately (e.g., logging, monitoring,
 * or fallback enforcement via token revocation).
 *
 * @param {string}  roomName    — LiveKit room name
 * @param {string}  identity    — participant identity (= userId)
 * @param {boolean} canPublish  — true to restore, false to revoke
 * @param {string}  logPrefix   — log context prefix
 * @returns {Promise<{enforced: boolean, reason: string}>}
 *   - { enforced: true, reason: 'UPDATED' }         — SFU permission successfully changed
 *   - { enforced: true, reason: 'NOT_CONFIGURED' }  — LiveKit not configured (acceptable in dev)
 *   - { enforced: false, reason: 'NOT_FOUND' }      — Participant or room not found at SFU
 *   - { enforced: false, reason: 'TIMEOUT' }        — SFU API timeout
 *   - { enforced: false, reason: 'UPDATE_FAILED' }  — Other LiveKit SDK errors
 */
async function sfuRevokePublish(roomName, identity, canPublish, logPrefix = '[livekit]') {
  const svc = getLivekitRoomService();
  if (!svc) {
    // LiveKit not configured — acceptable in dev environments
    return { enforced: true, reason: 'NOT_CONFIGURED' };
  }

  try {
    await svc.updateParticipant(roomName, identity, undefined, {
      canPublish:     canPublish,
      canSubscribe:   true,
      canPublishData: canPublish,
    });
    logger.info(`${logPrefix} SFU canPublish=${canPublish} set for ${identity} in ${roomName}`);
    return { enforced: true, reason: 'UPDATED' };
  } catch (err) {
    // LiveKit SDK errors: participant not found, room not found, timeout, etc.
    const reason = err.message?.toLowerCase().includes('not found') ? 'NOT_FOUND'
                 : err.message?.toLowerCase().includes('timeout') ? 'TIMEOUT'
                 : 'UPDATE_FAILED';
    logger.warn(`${logPrefix} SFU updateParticipant failed for ${identity} in ${roomName}: ${err.message}`);
    return { enforced: false, reason };
  }
}

module.exports = { getLivekitRoomService, sfuEvict, sfuRevokePublish };
