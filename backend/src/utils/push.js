'use strict';
/**
 * Push Notification Utility — Firebase Cloud Messaging (FCM)
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends push notifications to mobile devices via FCM HTTP v1 API.
 *
 * Setup:
 *   1. Go to Firebase Console → Project Settings → Service Accounts
 *   2. Generate a new private key → download JSON file
 *   3. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *      in your .env file (or base64-encode the JSON as FIREBASE_SERVICE_ACCOUNT_JSON)
 *
 * Environment variables:
 *   FIREBASE_PROJECT_ID      — Firebase project ID
 *   FIREBASE_CLIENT_EMAIL    — Service account email
 *   FIREBASE_PRIVATE_KEY     — Service account private key (replace \n with actual newlines)
 *
 *   OR:
 *   FIREBASE_SERVICE_ACCOUNT_JSON — base64-encoded full service account JSON
 *
 * If Firebase is not configured, sendPush() is a no-op (graceful degradation).
 * In-app notifications via Socket.IO continue to work regardless.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const logger = require('./logger');

// ─── Firebase Admin client (lazy-initialised) ─────────────────────────────────
let _messaging = null;
let _initialized = false;
let _initFailed  = false;

function getMessaging() {
  if (_initialized) return _messaging;
  if (_initFailed)  return null;

  try {
    const admin = require('firebase-admin');

    // Avoid double-initialisation if module is required multiple times
    const app = admin.apps.length
      ? admin.apps[0]
      : (() => {
          let credential;

          // Option 1: full service account JSON (base64-encoded)
          const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
          if (saJson) {
            const parsed = JSON.parse(Buffer.from(saJson, 'base64').toString('utf8'));
            credential   = admin.credential.cert(parsed);
          }
          // Option 2: individual env vars
          else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            credential = admin.credential.cert({
              projectId:   process.env.FIREBASE_PROJECT_ID,
              clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
              // Private key in .env often has literal \n — convert to real newlines
              privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            });
          } else {
            logger.warn('[push] Firebase not configured — push notifications disabled. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.');
            _initFailed = true;
            _initialized = true;
            return null;
          }

          return admin.initializeApp({ credential });
        })();

    if (!app) { _initFailed = true; _initialized = true; return null; }

    _messaging   = admin.messaging();
    _initialized = true;
    logger.info('[push] ✅ Firebase Admin initialized — push notifications enabled');
    return _messaging;

  } catch (err) {
    logger.warn(`[push] Firebase Admin initialization failed: ${err.message} — push notifications disabled`);
    _initFailed  = true;
    _initialized = true;
    return null;
  }
}

// ─── Notification type → icon mapping ────────────────────────────────────────
// Maps NotificationType enum values to Android notification channel IDs.
// These channel IDs should be created in the mobile app (expo-notifications config).
function getChannelId(type) {
  const SOCIAL_TYPES = ['FOLLOW','LIKE','COMMENT','COMMENT_REPLY','FRIEND_REQUEST',
    'FRIEND_ACCEPTED','COMMUNITY_JOIN','COMMUNITY_INVITE','MENTION',
    'GIFT_RECEIVED','TIP_RECEIVED','NEW_SUBSCRIBER'];

  if (SOCIAL_TYPES.includes(type)) return 'social';
  if (['ATTENDANCE','GRADE','BEHAVIOR'].includes(type)) return 'education';
  if (['LIVE_CLASS_START','VOICE_ROOM_LIVE'].includes(type)) return 'live';
  if (type === 'COINS_PURCHASED') return 'wallet';
  return 'general';
}

/**
 * Send a push notification to a single device token.
 * Returns true on success, false on any failure (non-throwing).
 *
 * @param {string} fcmToken   — device FCM registration token
 * @param {object} payload    — { title, body, data?, type? }
 */
async function sendPush(fcmToken, { title, body, data = {}, type = 'SYSTEM' }) {
  if (!fcmToken) return false;

  const messaging = getMessaging();
  if (!messaging) return false; // Firebase not configured — silent no-op

  try {
    const message = {
      token: fcmToken,
      notification: { title, body },
      data: {
        // All data values must be strings for FCM
        type:  String(type),
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v ?? '')])
        )
      },
      android: {
        notification: {
          channelId: getChannelId(type),
          priority:  'high',
          sound:     'default',
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'content-available': 1
          }
        }
      }
    };

    await messaging.send(message);
    logger.debug(`[push] Sent "${type}" to token ...${fcmToken.slice(-8)}`);
    return true;

  } catch (err) {
    // Token invalid or expired — caller should clear the fcmToken from DB
    if (err.code === 'messaging/registration-token-not-registered' ||
        err.code === 'messaging/invalid-registration-token') {
      logger.debug(`[push] Token expired/invalid for ...${fcmToken.slice(-8)} — should be cleared`);
      return 'EXPIRED';
    }
    logger.warn(`[push] Failed to send notification: ${err.message}`);
    return false;
  }
}

/**
 * Send push to multiple device tokens (up to 500 per FCM batch).
 * Invalid tokens are returned so the caller can clear them.
 *
 * @param {string[]} tokens
 * @param {object}   payload
 * @returns {{ sent: number, failed: number, expiredTokens: string[] }}
 */
async function sendPushMulti(tokens, payload) {
  if (!tokens || !tokens.length) return { sent: 0, failed: 0, expiredTokens: [] };

  const messaging = getMessaging();
  if (!messaging) return { sent: 0, failed: 0, expiredTokens: [] };

  const results = await Promise.allSettled(
    tokens.map(token => sendPush(token, payload))
  );

  let sent = 0;
  let failed = 0;
  const expiredTokens = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      if (r.value === true)       sent++;
      else if (r.value === 'EXPIRED') { expiredTokens.push(tokens[i]); failed++; }
      else                            failed++;
    } else {
      failed++;
    }
  });

  return { sent, failed, expiredTokens };
}

module.exports = { sendPush, sendPushMulti, getMessaging };
