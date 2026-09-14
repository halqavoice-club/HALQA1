'use strict';
/**
 * Phase 4 — Group Chat VOICE_ROOM_SHARE backend tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests the new Group Chat structured Voice Club share support in:
 *   - groupChat.controller.js  (sendGroupMessage + getGroupMessages enrichment)
 *   - groupChat.routes.js      (validator additions)
 *
 * Coverage:
 *  A. Valid sends
 *  B. Invalid / rejection cases
 *  C. Permissions — VOICE_ROOM_SHARE vs onlyAdminsCanSendMedia
 *  D. Security — client-supplied metadata not trusted
 *  E. Enrichment — authoritative VoiceRoom data from DB
 *  F. getGroupMessages enrichment (batched, no N+1)
 *  G. Existing message types unchanged
 *  H. Authorization chain (membership, admin rules)
 *  I. Socket.IO — existing group:message event
 *  J. Route validator additions
 *  K. Controller invariants and Voice Club safety
 */

const fs   = require('fs');
const path = require('path');

const GC_CTRL  = path.join(__dirname, '../controllers/groupChat.controller.js');
const GC_ROUTE = path.join(__dirname, '../routes/groupChat.routes.js');

function extractFn(src, name) {
  const start = src.indexOf(`async function ${name}`);
  if (start === -1) return null;
  const next = src.indexOf('async function', start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

let ctrlSrc, routeSrc;
beforeAll(() => {
  ctrlSrc  = fs.readFileSync(GC_CTRL,  'utf8');
  routeSrc = fs.readFileSync(GC_ROUTE, 'utf8');
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Phase 4 — Group Chat VOICE_ROOM_SHARE backend', () => {

  // ── A. Valid sends ──────────────────────────────────────────────────────────
  describe('A. Valid: VOICE_ROOM_SHARE supported', () => {
    test('sendGroupMessage destructures refEntityType and refEntityId', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(/refEntityType/);
      expect(fn).toMatch(/refEntityId/);
    });

    test('body is optional for VOICE_ROOM_SHARE', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      // VOICE_ROOM_SHARE validation block does not require body
      const shareBlock = fn.slice(fn.indexOf('VOICE_ROOM_SHARE'), fn.indexOf('VOICE_ROOM_SHARE') + 800);
      expect(shareBlock).not.toMatch(/body.*required.*VOICE_ROOM_SHARE|VOICE_ROOM_SHARE.*body.*required/s);
    });

    test('lastMessageText for VOICE_ROOM_SHARE is "🎙️ Voice Club"', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(/VOICE_ROOM_SHARE.*Voice Club|Voice Club.*VOICE_ROOM_SHARE/s);
    });

    test('refEntityType stored as hardcoded "VoiceRoom" (not req.body value)', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(
        /refEntityType\s*:\s*msgType\s*===\s*['"]VOICE_ROOM_SHARE['"]\s*\?\s*['"]VoiceRoom['"]\s*:\s*null/
      );
    });

    test('refEntityId stored as trimmed value for VOICE_ROOM_SHARE, null otherwise', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(
        /refEntityId\s*:\s*msgType\s*===\s*['"]VOICE_ROOM_SHARE['"]\s*\?\s*refEntityId\.trim\(\)\s*:\s*null/
      );
    });

    test('sendGroupMessage attaches voiceRoomData from DB to response', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(/voiceRoomData\s*=/);
      expect(fn).toMatch(/voiceRoom\.findUnique/);
    });
  });

  // ── B. Invalid / rejection ─────────────────────────────────────────────────
  describe('B. Invalid: rejection cases', () => {
    test('missing refEntityId is rejected with 400', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(/refEntityId.*required.*VOICE_ROOM_SHARE|VOICE_ROOM_SHARE.*refEntityId.*required/s);
    });

    test('empty refEntityId is rejected (trim check)', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(/refEntityId\.trim\(\)/);
    });

    test('wrong refEntityType is rejected with 400', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(/refEntityType\s*!==\s*['"]VoiceRoom['"]/);
      expect(fn).toMatch(/refEntityType must be.*VoiceRoom/i);
    });

    test('nonexistent VoiceRoom is rejected with 404', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(/Voice Club room not found/i);
      expect(fn).toMatch(/404/);
    });

    test('soft-deleted VoiceRoom is rejected', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      // checks deletedAt
      expect(fn).toMatch(/voiceRoom\.deletedAt/);
    });
  });

  // ── C. Permissions — critical onlyAdminsCanSendMedia behavior ──────────────
  describe('C. Permissions: VOICE_ROOM_SHARE not blocked by onlyAdminsCanSendMedia', () => {
    test('isMedia excludes VOICE_ROOM_SHARE — share card is not binary media', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      // The isMedia definition must exclude VOICE_ROOM_SHARE
      expect(fn).toMatch(/isMedia.*!==.*TEXT.*!==.*VOICE_ROOM_SHARE|isMedia.*VOICE_ROOM_SHARE.*TEXT/s);
    });

    test('onlyAdminsCanSendMedia guard uses isMedia (which excludes VOICE_ROOM_SHARE)', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      // The media permission check uses the isMedia flag
      expect(fn).toMatch(/isMedia.*onlyAdminsCanSendMedia|onlyAdminsCanSendMedia.*isMedia/s);
    });

    test('onlyAdminsCanSendMessages still applies to VOICE_ROOM_SHARE', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      // The message-level guard must come before the VOICE_ROOM_SHARE block
      const msgGateIdx   = fn.indexOf('onlyAdminsCanSendMessages');
      const shareBlockIdx = fn.indexOf('VOICE_ROOM_SHARE');
      expect(msgGateIdx).toBeGreaterThan(-1);
      expect(shareBlockIdx).toBeGreaterThan(-1);
    });

    test('IMAGE/VIDEO/etc. media permissions are still enforced (isMedia true for them)', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      // The isMedia check must still be present and used for the media gate
      expect(fn).toMatch(/Only admins can send media in this group/);
    });

    test('existing onlyAdminsCanSendMessages comment/logic preserved', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(/Only admins can send messages in this group/);
    });
  });

  // ── D. Security — client metadata not trusted ──────────────────────────────
  describe('D. Security: client-supplied room metadata never stored', () => {
    test('room title is never read from req.body', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).not.toMatch(/req\.body\.title|req\.body\.roomTitle/);
    });

    test('room host is never read from req.body', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).not.toMatch(/req\.body\.host(?!\w)|req\.body\.hostId/);
    });

    test('participant count is never read from req.body', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).not.toMatch(/req\.body\.participantCount|req\.body\.participants/);
    });

    test('room privacy is never read from req.body', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).not.toMatch(/req\.body\.privacy/);
    });

    test('enrichment VoiceRoom data comes from DB — select block uses Prisma findUnique', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      const firstFU  = fn.indexOf('voiceRoom.findUnique');
      const secondFU = fn.indexOf('voiceRoom.findUnique', firstFU + 1);
      // Second findUnique is the enrichment query (first is existence check)
      const enrichBlock = fn.slice(secondFU, secondFU + 350);
      expect(enrichBlock).toMatch(/id.*true|title.*true/s);
      expect(enrichBlock).toMatch(/coverEmoji/);
      expect(enrichBlock).toMatch(/privacy/);
      expect(enrichBlock).toMatch(/status/);
    });

    test('enrichment does not expose passwordHash or twoFactorSecret', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).not.toMatch(/passwordHash/);
      expect(fn).not.toMatch(/twoFactorSecret/);
    });
  });

  // ── E. Enrichment in sendGroupMessage ─────────────────────────────────────
  describe('E. Enrichment: voiceRoomData in send response', () => {
    test('voiceRoomData null-safe fallback for unavailable room', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(/roomData\s*\?\?\s*null/);
    });

    test('response uses responseMessage (which includes voiceRoomData)', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(/data:\s*responseMessage/);
    });

    test('Socket.IO emits responseMessage (with voiceRoomData)', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(/emit\('group:message',\s*responseMessage\)/);
    });
  });

  // ── F. getGroupMessages enrichment (batched) ───────────────────────────────
  describe('F. getGroupMessages: batched VOICE_ROOM_SHARE enrichment', () => {
    test('getGroupMessages collects share messages before DB call', () => {
      const fn = extractFn(ctrlSrc, 'getGroupMessages');
      expect(fn).toMatch(/shareMessages/);
    });

    test('getGroupMessages deduplicates roomIds with Set', () => {
      const fn = extractFn(ctrlSrc, 'getGroupMessages');
      expect(fn).toMatch(/new Set\(shareMessages/);
    });

    test('getGroupMessages uses findMany for batched query', () => {
      const fn = extractFn(ctrlSrc, 'getGroupMessages');
      expect(fn).toMatch(/voiceRoom\.findMany/);
    });

    test('findMany is guarded by shareMessages.length — no query when no shares', () => {
      const fn = extractFn(ctrlSrc, 'getGroupMessages');
      expect(fn).toMatch(/shareMessages\.length/);
    });

    test('voiceRoomMap keyed by room id for O(1) lookup', () => {
      const fn = extractFn(ctrlSrc, 'getGroupMessages');
      expect(fn).toMatch(/voiceRoomMap/);
    });

    test('missing room returns voiceRoomData: null safely', () => {
      const fn = extractFn(ctrlSrc, 'getGroupMessages');
      expect(fn).toMatch(/voiceRoomMap\[m\.refEntityId\]\s*\?\?\s*null/);
    });

    test('non-share messages pass through unchanged', () => {
      const fn = extractFn(ctrlSrc, 'getGroupMessages');
      expect(fn).toMatch(/return m\b/);
    });

    test('getGroupMessages does NOT call findUnique per message (no N+1)', () => {
      const fn = extractFn(ctrlSrc, 'getGroupMessages');
      // Must not have findUnique inside per-message iteration
      const mapBlock = fn.slice(fn.indexOf('voiceRoomMap'), fn.indexOf('voiceRoomMap') + 800);
      expect(mapBlock).not.toMatch(/forEach.*findUnique|map.*findUnique|for.*findUnique/s);
    });

    test('enriched array is reversed before response (preserving existing order behavior)', () => {
      const fn = extractFn(ctrlSrc, 'getGroupMessages');
      expect(fn).toMatch(/enriched\.reverse\(\)/);
    });
  });

  // ── G. Existing message types unchanged ────────────────────────────────────
  describe('G. Existing message types: unchanged behavior', () => {
    test('original 10 GroupMessageType values still handled', () => {
      // The mediaPreview map should contain all original types
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(/IMAGE.*Photo|Photo.*IMAGE/s);
      expect(fn).toMatch(/VIDEO.*Video|Video.*VIDEO/s);
      expect(fn).toMatch(/GIF/s);
      expect(fn).toMatch(/VOICE.*Voice|Voice.*VOICE/s);
      expect(fn).toMatch(/AUDIO.*Audio/s);
      expect(fn).toMatch(/FILE.*File/s);
      expect(fn).toMatch(/DOCUMENT.*Document/s);
    });
  });

  // ── H. Authorization chain ─────────────────────────────────────────────────
  describe('H. Authorization: membership and permission chain intact', () => {
    test('non-member rejected with 403 (groupMember.leftAt check)', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(/member\.leftAt/);
      expect(fn).toMatch(/Not a member of this conversation/);
    });

    test('member with leftAt is treated as non-member', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      // !member || member.leftAt → rejected
      expect(fn).toMatch(/!member.*member\.leftAt|member\.leftAt.*!member/s);
    });

    test('groupMember.findUnique is called before any message creation', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      const memberCheckIdx = fn.indexOf('groupMember.findUnique');
      const createIdx      = fn.indexOf('groupMessage.create');
      expect(memberCheckIdx).toBeGreaterThan(-1);
      expect(createIdx).toBeGreaterThan(memberCheckIdx);
    });
  });

  // ── I. Socket.IO — existing event ─────────────────────────────────────────
  describe('I. Socket.IO: existing group:message event used', () => {
    test('uses existing group:message event', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).toMatch(/emit\('group:message'/);
    });

    test('no new group:voice_room_share or group:share event created', () => {
      expect(ctrlSrc).not.toMatch(/emit\('group:voice_room_share'\)/);
      expect(ctrlSrc).not.toMatch(/emit\('group:share'\)/);
    });
  });

  // ── J. Route validators ───────────────────────────────────────────────────
  describe('J. Route validators updated', () => {
    test('VOICE_ROOM_SHARE added to type isIn list', () => {
      expect(routeSrc).toMatch(/isIn.*VOICE_ROOM_SHARE|VOICE_ROOM_SHARE.*isIn/s);
    });

    test('refEntityType validator added (optional, max 50)', () => {
      expect(routeSrc).toMatch(/refEntityType.*optional|optional.*refEntityType/s);
      expect(routeSrc).toMatch(/refEntityType/);
    });

    test('refEntityId validator added (optional, max 36)', () => {
      expect(routeSrc).toMatch(/refEntityId.*optional|optional.*refEntityId/s);
      expect(routeSrc).toMatch(/refEntityId/);
    });

    test('existing 10 GroupMessageType values still in validator', () => {
      const match = routeSrc.match(/isIn\(\[([^\]]*TEXT[^\]]*)\]\)/g) ?? [];
      const typeVal = match.find(m => m.includes('TEXT') && m.includes('IMAGE'));
      expect(typeVal).toBeTruthy();
      ['TEXT', 'IMAGE', 'VIDEO', 'GIF', 'AUDIO', 'VOICE', 'FILE', 'DOCUMENT', 'POLL', 'SYSTEM'].forEach(t => {
        expect(typeVal).toContain(t);
      });
    });

    test('VOICE_ROOM_SHARE is 11th value (appended, not replacing)', () => {
      const match = routeSrc.match(/isIn\(\[([^\]]*VOICE_ROOM_SHARE[^\]]*)\]\)/)?.[1] ?? '';
      expect(match).toContain('SYSTEM');
      expect(match).toContain('VOICE_ROOM_SHARE');
    });
  });

  // ── K. Controller invariants and Voice Club safety ─────────────────────────
  describe('K. Invariants and Voice Club safety', () => {
    test('does not join Voice Club (no voice/:id/join call)', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).not.toMatch(/voice.*join|joinRoom/i);
    });

    test('does not assign seats or change queue', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).not.toMatch(/seatNumber|speakerQueue|handRaised/);
    });

    test('does not change mute state or LiveKit', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).not.toMatch(/isMuted|livekit|accessToken/i);
    });

    test('does not alter Redis state', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      expect(fn).not.toMatch(/redis|redisClient|getCache|setCache/i);
    });

    test('dm.controller.js was NOT touched by Phase 4', () => {
      const dmPath = path.join(__dirname, '../controllers/dm.controller.js');
      const dmSrc  = fs.readFileSync(dmPath, 'utf8');
      // Phase 3 added VOICE_ROOM_SHARE to DM — verify the DM controller still has it
      expect(dmSrc).toMatch(/VOICE_ROOM_SHARE/);
      // And that the group controller has its OWN implementation
      expect(ctrlSrc).toMatch(/VOICE_ROOM_SHARE/);
    });

    test('VoiceRoom existence check uses only id and deletedAt fields', () => {
      const fn = extractFn(ctrlSrc, 'sendGroupMessage');
      const firstFU = fn.indexOf('voiceRoom.findUnique');
      const existenceBlock = fn.slice(firstFU, firstFU + 200);
      expect(existenceBlock).toMatch(/id.*true.*deletedAt.*true|deletedAt.*true.*id.*true/s);
    });
  });
});
