'use strict';
/**
 * livekitService.js — Shared LiveKit RoomServiceClient factory
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
 */

const { RoomServiceClient } = require('livekit-server-sdk');

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

module.exports = { getLivekitRoomService };
