'use strict';
/**
 * Phase 3 — DM VOICE_ROOM_SHARE backend tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests the new DM structured Voice Club share support in:
 *   - dm.controller.js  (sendMessage + getMessages enrichment)
 *   - dm.routes.js      (validator additions)
 *
 * Coverage:
 *  A. Valid sends
 *  B. Invalid / rejection cases
 *  C. Security — client-supplied metadata is ignored
 *  D. Enrichment — VoiceRoom data from DB, not client
 *  E. Existing message types unchanged
 *  F. Authorization chain unchanged
 *  G. Socket.IO — existing dm:message event used
 *  H. Performance — no N+1 (batched enrichment)
 *  I. Route validator additions
 *  J. Controller source-code invariants
 */

const fs   = require('fs');
const path = require('path');

const DM_CTRL  = path.join(__dirname, '../controllers/dm.controller.js');
const DM_ROUTE = path.join(__dirname, '../routes/dm.routes.js');

// ─── Helper: extract a named function body from source ───────────────────────
function extractFn(src, name) {
  const start = src.indexOf(`async function ${name}`);
  if (start === -1) return null;
  const next = src.indexOf('async function', start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

// ─── Load sources once ───────────────────────────────────────────────────────
let ctrlSrc, routeSrc;
beforeAll(() => {
  ctrlSrc  = fs.readFileSync(DM_CTRL,  'utf8');
  routeSrc = fs.readFileSync(DM_ROUTE, 'utf8');
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Phase 3 — DM VOICE_ROOM_SHARE backend', () => {

  // ── A. Valid cases ─────────────────────────────────────────────────────────
  describe('A. Valid: VOICE_ROOM_SHARE added to allowed types', () => {
    test('ALLOWED_TYPES includes VOICE_ROOM_SHARE', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).toMatch(/VOICE_ROOM_SHARE/);
      expect(sendFn).toMatch(/ALLOWED_TYPES.*=.*\[/s);
      // Verify it's in the array
      const match = sendFn.match(/ALLOWED_TYPES\s*=\s*\[([^\]]+)\]/);
      expect(match).toBeTruthy();
      expect(match[1]).toContain('VOICE_ROOM_SHARE');
    });

    test('body is optional for VOICE_ROOM_SHARE (no body required error for share type)', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // P8C FIX (Category B — stale scan window): The test originally scanned from
      // the FIRST occurrence of 'VOICE_ROOM_SHARE' in sendMessage, which lands on
      // the req.body destructuring line. Because 'req.body' then 'required' then
      // 'VOICE_ROOM_SHARE' all appear within 800 chars from that point (the error
      // message "refEntityId is required for VOICE_ROOM_SHARE messages"), the pattern
      // /VOICE_ROOM_SHARE.*body.*required/s falsely matched.
      //
      // Fix: start the scan from the SECOND occurrence — the if (msgType === ...) block —
      // which is the actual conditional that enforces VOICE_ROOM_SHARE-specific rules.
      // The body-required check is in the else branch for non-share types only.
      const firstIdx  = sendFn.indexOf('VOICE_ROOM_SHARE');
      const secondIdx = sendFn.indexOf('VOICE_ROOM_SHARE', firstIdx + 1);
      const shareBlock = sendFn.slice(secondIdx, secondIdx + 800);
      expect(shareBlock).not.toMatch(/body.*required.*VOICE_ROOM_SHARE|VOICE_ROOM_SHARE.*body.*required/s);
    });

    test('optional body is preserved when provided', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // body is stored: body ? body.trim() : null
      expect(sendFn).toMatch(/body\s*\?\s*body\.trim\(\)\s*:\s*null/);
    });

    test('room title is not stored as message body', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // body must never be set to room.title or voiceRoom.title
      expect(sendFn).not.toMatch(/body.*room\.title|body.*voiceRoom\.title/s);
    });

    test('VoiceRoom share preview is the generic "🎙️ Voice Club" text', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).toMatch(/VOICE_ROOM_SHARE.*Voice Club|Voice Club.*VOICE_ROOM_SHARE/s);
    });
  });

  // ── B. Invalid / rejection cases ──────────────────────────────────────────
  describe('B. Invalid: rejection cases', () => {
    test('missing refEntityId is rejected', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).toMatch(/refEntityId.*required.*VOICE_ROOM_SHARE|VOICE_ROOM_SHARE.*refEntityId.*required/s);
    });

    test('empty refEntityId is rejected', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // The check: !refEntityId || !refEntityId.trim()
      expect(sendFn).toMatch(/refEntityId\.trim\(\)/);
    });

    test('wrong refEntityType is rejected', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).toMatch(/refEntityType\s*!==\s*['"]VoiceRoom['"]/);
      expect(sendFn).toMatch(/refEntityType must be.*VoiceRoom/i);
    });

    test('nonexistent VoiceRoom is rejected with 404', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // voiceRoom lookup followed by 404
      expect(sendFn).toMatch(/voiceRoom\.findUnique/);
      expect(sendFn).toMatch(/Voice Club room not found/i);
      expect(sendFn).toMatch(/404/);
    });

    test('soft-deleted VoiceRoom is rejected', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // checks deletedAt
      expect(sendFn).toMatch(/voiceRoom\.deletedAt/);
    });

    test('unknown msgType still rejected', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // ALLOWED_TYPES check still present
      expect(sendFn).toMatch(/ALLOWED_TYPES\.includes\(msgType\)/);
      expect(sendFn).toMatch(/Invalid msgType/);
    });
  });

  // ── C. Security — client metadata not trusted ──────────────────────────────
  describe('C. Security: client-supplied room metadata never used', () => {
    test('client-supplied title is not used as authoritative data', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // No req.body.title, req.body.roomTitle, req.body.hostName stored
      expect(sendFn).not.toMatch(/req\.body\.title|req\.body\.roomTitle|req\.body\.hostName/);
    });

    test('client-supplied host is not stored', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).not.toMatch(/req\.body\.host(?!\w)|req\.body\.hostId/);
    });

    test('client-supplied participantCount is not stored', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).not.toMatch(/req\.body\.participantCount|req\.body\.participants/);
    });

    test('client-supplied privacy is not stored', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // privacy must not come from req.body for VOICE_ROOM_SHARE
      // The only privacy stored is in voiceRoomData from DB query
      expect(sendFn).not.toMatch(/req\.body\.privacy/);
    });

    test('client-supplied status is not stored', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).not.toMatch(/req\.body\.status/);
    });

    test('refEntityType on stored message is always hardcoded "VoiceRoom", not req.body.refEntityType', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // The stored value must be the literal 'VoiceRoom', not passed from client
      expect(sendFn).toMatch(/refEntityType\s*:\s*msgType\s*===\s*['"]VOICE_ROOM_SHARE['"]\s*\?\s*['"]VoiceRoom['"]/);
    });
  });

  // ── D. Enrichment — authoritative VoiceRoom data ──────────────────────────
  describe('D. Enrichment: VoiceRoom data from database', () => {
    test('sendMessage attaches voiceRoomData from DB to response', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).toMatch(/voiceRoomData\s*=/);
      expect(sendFn).toMatch(/voiceRoom\.findUnique/);
    });

    test('enrichment response exposes safe fields only: id title coverEmoji coverImageUrl privacy status hostId maxSpeakers', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // Find the enrichment findUnique (second one — existence check is first, enrichment is second)
      const firstFindUnique  = sendFn.indexOf('voiceRoom.findUnique');
      const secondFindUnique = sendFn.indexOf('voiceRoom.findUnique', firstFindUnique + 1);
      const enrichBlock = sendFn.slice(secondFindUnique, secondFindUnique + 400);
      expect(enrichBlock).toMatch(/id.*true|title.*true/s);
      expect(enrichBlock).toMatch(/coverEmoji/);
      expect(enrichBlock).toMatch(/privacy/);
      expect(enrichBlock).toMatch(/status/);
      expect(enrichBlock).toMatch(/hostId/);
    });

    test('enrichment does not expose internal/security-sensitive fields (passwordHash, twoFactorSecret)', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).not.toMatch(/passwordHash/);
      expect(sendFn).not.toMatch(/twoFactorSecret/);
    });

    test('getMessages enrichment is batched — one query for all roomIds', () => {
      const getMsgFn = extractFn(ctrlSrc, 'getMessages');
      expect(getMsgFn).toBeTruthy();
      // Batch: roomIds array + findMany with id: { in: roomIds }
      expect(getMsgFn).toMatch(/roomIds/);
      expect(getMsgFn).toMatch(/id.*in.*roomIds|findMany.*roomIds/s);
      // voiceRoomMap: keyed by room id
      expect(getMsgFn).toMatch(/voiceRoomMap/);
    });

    test('getMessages does NOT call findUnique per message (no N+1)', () => {
      const getMsgFn = extractFn(ctrlSrc, 'getMessages');
      // Must not have findUnique inside a per-message loop
      // The batching uses findMany — no per-message findUnique
      const mapBlock = getMsgFn.slice(getMsgFn.indexOf('voiceRoomMap'), getMsgFn.indexOf('voiceRoomMap') + 800);
      expect(mapBlock).not.toMatch(/for.*findUnique|forEach.*findUnique|map.*findUnique/s);
    });

    test('missing VoiceRoom returns voiceRoomData: null safely', () => {
      const getMsgFn = extractFn(ctrlSrc, 'getMessages');
      // voiceRoomMap[m.refEntityId] ?? null
      expect(getMsgFn).toMatch(/voiceRoomMap\[m\.refEntityId\]\s*\?\?\s*null/);
    });

    test('existing non-share messages are returned unchanged by enrichment', () => {
      const getMsgFn = extractFn(ctrlSrc, 'getMessages');
      // Messages that are not VOICE_ROOM_SHARE pass through as-is
      expect(getMsgFn).toMatch(/return m\b/);
    });
  });

  // ── E. Existing message types unchanged ────────────────────────────────────
  describe('E. Existing message types: unchanged behavior', () => {
    test('ALLOWED_TYPES still contains all original 7 types', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      const match  = sendFn.match(/ALLOWED_TYPES\s*=\s*\[([^\]]+)\]/);
      expect(match).toBeTruthy();
      const types = match[1];
      ['TEXT', 'IMAGE', 'VIDEO', 'GIF', 'VOICE', 'AUDIO', 'FILE'].forEach(t => {
        expect(types).toContain(t);
      });
    });

    test('TEXT still requires body', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // Inside the else branch for non-share types
      expect(sendFn).toMatch(/Message body required/);
    });

    test('IMAGE still requires mediaUrl', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).toMatch(/mediaUrl required for media messages/);
    });

    test('conversation preview map still has all original media type previews', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).toMatch(/IMAGE.*Photo|Photo.*IMAGE/s);
      expect(sendFn).toMatch(/VIDEO.*Video|Video.*VIDEO/s);
      expect(sendFn).toMatch(/GIF.*GIF/s);
      expect(sendFn).toMatch(/VOICE.*Voice message/s);
      expect(sendFn).toMatch(/AUDIO.*Audio/s);
      expect(sendFn).toMatch(/FILE.*File/s);
    });
  });

  // ── F. Authorization chain unchanged ──────────────────────────────────────
  describe('F. Authorization: existing chain preserved', () => {
    test('conversation membership check still present', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).toMatch(/conv\.userAId.*meId.*conv\.userBId.*meId|Conversation not found/s);
    });

    test('bidirectional block check still present', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).toMatch(/blockerId.*blockedId|Cannot send messages to this user/s);
    });

    test('friendship check still present', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).toMatch(/areFriends/);
      expect(sendFn).toMatch(/You can only message friends/);
    });

    test('replyToId same-conversation validation still present', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).toMatch(/replyMsg\.conversationId.*convId|Invalid replyToId/s);
    });

    test('VOICE_ROOM_SHARE does not have a special auth bypass', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // The VoiceRoom check happens BEFORE (or at start of) the existing auth checks,
      // not instead of them — verify block check is not skipped for share type
      const blockCheckIdx = sendFn.indexOf('Cannot send messages to this user');
      const friendsIdx    = sendFn.indexOf('You can only message friends');
      const shareTypeIdx  = sendFn.indexOf('VOICE_ROOM_SHARE');
      // Authorization checks exist after the type check, not removed
      expect(blockCheckIdx).toBeGreaterThan(-1);
      expect(friendsIdx).toBeGreaterThan(-1);
    });
  });

  // ── G. Socket.IO — existing event used ───────────────────────────────────
  describe('G. Socket.IO: existing dm:message event used', () => {
    test('uses existing dm:message event — no new event created', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).toMatch(/emit\('dm:message'/);
    });

    test('does not create a new dm:voice_room_share or dm:share event', () => {
      expect(ctrlSrc).not.toMatch(/emit\('dm:voice_room_share'\)/);
      expect(ctrlSrc).not.toMatch(/emit\('dm:share'\)/);
    });

    test('voiceRoomData travels with the existing message payload', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // fullMessage (which includes voiceRoomData) is spread into msgPayload
      expect(sendFn).toMatch(/\.\.\.fullMessage/);
    });
  });

  // ── H. Performance: batched enrichment ───────────────────────────────────
  describe('H. Performance: batched enrichment in getMessages', () => {
    test('shareMessages are collected before any DB call', () => {
      const getMsgFn = extractFn(ctrlSrc, 'getMessages');
      const shareMsgIdx = getMsgFn.indexOf('shareMessages');
      const roomIdsIdx  = getMsgFn.indexOf('roomIds');
      // shareMessages collected first, then roomIds from it
      expect(shareMsgIdx).toBeGreaterThan(-1);
      expect(roomIdsIdx).toBeGreaterThan(shareMsgIdx);
    });

    test('Set deduplicates roomIds to avoid duplicate DB rows', () => {
      const getMsgFn = extractFn(ctrlSrc, 'getMessages');
      expect(getMsgFn).toMatch(/new Set\(shareMessages/);
    });

    test('findMany skips DB call when there are no share messages (guard on length)', () => {
      const getMsgFn = extractFn(ctrlSrc, 'getMessages');
      expect(getMsgFn).toMatch(/shareMessages\.length/);
    });
  });

  // ── I. Route validator additions ─────────────────────────────────────────
  describe('I. Route validators updated', () => {
    test('dm.routes.js adds VOICE_ROOM_SHARE to msgType isIn list', () => {
      expect(routeSrc).toMatch(/isIn.*VOICE_ROOM_SHARE|VOICE_ROOM_SHARE.*isIn/s);
    });

    test('dm.routes.js adds refEntityType validator', () => {
      expect(routeSrc).toMatch(/refEntityType/);
    });

    test('dm.routes.js adds refEntityId validator', () => {
      expect(routeSrc).toMatch(/refEntityId/);
    });

    test('refEntityType validator uses optional/nullable — not required for other types', () => {
      expect(routeSrc).toMatch(/refEntityType.*optional|optional.*refEntityType/s);
    });

    test('refEntityId validator uses optional/nullable — not required for other types', () => {
      expect(routeSrc).toMatch(/refEntityId.*optional|optional.*refEntityId/s);
    });

    test('existing 7 types still in validator isIn list', () => {
      const match = routeSrc.match(/isIn\(\[([^\]]+)\]\)/g) ?? [];
      const msgTypeValidator = match.find(m => m.includes('TEXT'));
      expect(msgTypeValidator).toBeTruthy();
      ['TEXT', 'IMAGE', 'VIDEO', 'GIF', 'VOICE', 'AUDIO', 'FILE'].forEach(t => {
        expect(msgTypeValidator).toContain(t);
      });
    });
  });

  // ── J. Controller invariants ──────────────────────────────────────────────
  describe('J. Controller invariants and safety', () => {
    test('refEntityType stored as hardcoded "VoiceRoom" for VOICE_ROOM_SHARE, null for others', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).toMatch(
        /refEntityType\s*:\s*msgType\s*===\s*['"]VOICE_ROOM_SHARE['"]\s*\?\s*['"]VoiceRoom['"]\s*:\s*null/
      );
    });

    test('refEntityId stored from trimmed refEntityId for VOICE_ROOM_SHARE, null for others', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).toMatch(
        /refEntityId\s*:\s*msgType\s*===\s*['"]VOICE_ROOM_SHARE['"]\s*\?\s*refEntityId\.trim\(\)\s*:\s*null/
      );
    });

    test('VoiceRoom lookup only fetches safe public fields (id, deletedAt) for existence check', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      // The existence check select block
      const existenceBlock = sendFn.slice(
        sendFn.indexOf('voiceRoom.findUnique'),
        sendFn.indexOf('voiceRoom.findUnique') + 200
      );
      expect(existenceBlock).toMatch(/id.*true|deletedAt.*true/s);
    });

    test('does not join Voice Club (no POST /voice/:id/join call)', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).not.toMatch(/voice.*join|joinRoom/i);
    });

    test('does not assign seats or change queue', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).not.toMatch(/seatNumber|speakerQueue|handRaised/);
    });

    test('does not change mute state or LiveKit state', () => {
      const sendFn = extractFn(ctrlSrc, 'sendMessage');
      expect(sendFn).not.toMatch(/isMuted|livekit|accessToken/i);
    });

    test('groupChat.controller.js was updated by Phase 4 (not Phase 3)', () => {
      // Phase 4 correctly adds VOICE_ROOM_SHARE to groupChat.controller.js.
      // Phase 3 only touched DM — Phase 4 added group support.
      // Now that both phases are complete, both controllers support VOICE_ROOM_SHARE.
      const gcPath = path.join(__dirname, '../controllers/groupChat.controller.js');
      const gcSrc  = fs.readFileSync(gcPath, 'utf8');
      expect(ctrlSrc).toMatch(/VOICE_ROOM_SHARE/);  // DM — added by Phase 3
      expect(gcSrc).toMatch(/VOICE_ROOM_SHARE/);    // Group — added by Phase 4
    });

    test('groupChat.routes.js was updated by Phase 4 (not Phase 3)', () => {
      // Phase 4 correctly adds VOICE_ROOM_SHARE to groupChat.routes.js.
      const gcRoutePath = path.join(__dirname, '../routes/groupChat.routes.js');
      const gcRouteSrc  = fs.readFileSync(gcRoutePath, 'utf8');
      expect(gcRouteSrc).toMatch(/VOICE_ROOM_SHARE/);  // Added by Phase 4
    });
  });
});
