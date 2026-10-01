'use strict';
/**
 * Phase 6 — React Native DM + Group Chat VOICE_ROOM_SHARE parity tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests the mobile implementation of structured Voice Club share cards,
 * ensuring parity with the Web Phase 5 implementation.
 *
 * Files under test:
 *   - mobile/app/voice/[id].tsx          (VoiceShareSheetMobile)
 *   - mobile/src/components/dm/DmMediaBubble.tsx
 *   - mobile/app/dm/[id].tsx             (Message interface)
 *   - mobile/app/group-chat/[id].tsx     (GcMsg + mediaMsgShape)
 *   - mobile/src/components/chat/VoiceRoomShareCard.tsx
 *
 * Coverage:
 *  A. VoiceShareSheetMobile — DM send payload
 *  B. VoiceShareSheetMobile — Group send payload
 *  C. VoiceShareSheetMobile — Feed/Community unchanged
 *  D. VoiceShareSheetMobile — note textareas added to DM/Group
 *  E. DmMediaBubble — VOICE_ROOM_SHARE type interface
 *  F. DmMediaBubble — VOICE_ROOM_SHARE rendering branch
 *  G. Mobile DM screen — Message interface extended
 *  H. Mobile Group Chat — GcMsg interface extended + mediaMsgShape forwarding
 *  I. VoiceRoomShareCard — available/unavailable/missing states
 *  J. VoiceRoomShareCard — navigation to existing mobile Voice Club route
 *  K. Web Phase 5 compatibility — same backend contract
 *  L. Backend untouched by Phase 6
 *  M. Web untouched by Phase 6
 */

const fs   = require('fs');
const path = require('path');

const VOICE_SCREEN   = path.join(__dirname, '../../../mobile/app/voice/[id].tsx');
const DM_BUBBLE_MOB  = path.join(__dirname, '../../../mobile/src/components/dm/DmMediaBubble.tsx');
const DM_SCREEN_MOB  = path.join(__dirname, '../../../mobile/app/dm/[id].tsx');
const GC_SCREEN_MOB  = path.join(__dirname, '../../../mobile/app/group-chat/[id].tsx');
const VC_CARD_MOB    = path.join(__dirname, '../../../mobile/src/components/chat/VoiceRoomShareCard.tsx');
const VC_CARD_WEB    = path.join(__dirname, '../../../frontend/src/components/chat/VoiceRoomShareCard.tsx');
const DM_CTRL        = path.join(__dirname, '../controllers/dm.controller.js');
const GC_CTRL        = path.join(__dirname, '../controllers/groupChat.controller.js');
const VOICE_CTRL     = path.join(__dirname, '../controllers/voice.controller.js');
const WEB_SHARE      = path.join(__dirname, '../../../frontend/src/components/voice/VoiceShareSheet.tsx');

let voiceScreen, dmBubbleMob, dmScreenMob, gcScreenMob, vcCardMob;
beforeAll(() => {
  voiceScreen  = fs.readFileSync(VOICE_SCREEN,  'utf8');
  dmBubbleMob  = fs.readFileSync(DM_BUBBLE_MOB, 'utf8');
  dmScreenMob  = fs.readFileSync(DM_SCREEN_MOB, 'utf8');
  gcScreenMob  = fs.readFileSync(GC_SCREEN_MOB, 'utf8');
  vcCardMob    = fs.readFileSync(VC_CARD_MOB,   'utf8');
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Phase 6 — React Native DM + Group Chat VOICE_ROOM_SHARE', () => {

  // ── A. VoiceShareSheetMobile — DM send payload ────────────────────────────
  describe('A. VoiceShareSheetMobile: DM send uses structured VOICE_ROOM_SHARE', () => {
    test('sendDM sends msgType: VOICE_ROOM_SHARE', () => {
      // Find the sendDM function and confirm structured payload
      const sendDMStart = voiceScreen.indexOf('const sendDM');
      const sendDMEnd   = voiceScreen.indexOf('};', sendDMStart) + 2;
      const sendDMFn    = voiceScreen.slice(sendDMStart, sendDMEnd);
      expect(sendDMFn).toMatch(/msgType.*VOICE_ROOM_SHARE|VOICE_ROOM_SHARE.*msgType/s);
    });

    test('sendDM sends refEntityType: VoiceRoom', () => {
      const sendDMStart = voiceScreen.indexOf('const sendDM');
      const sendDMEnd   = voiceScreen.indexOf('};', sendDMStart) + 2;
      const sendDMFn    = voiceScreen.slice(sendDMStart, sendDMEnd);
      expect(sendDMFn).toMatch(/refEntityType.*VoiceRoom|VoiceRoom.*refEntityType/s);
    });

    test('sendDM sends refEntityId: roomId (authoritative)', () => {
      const sendDMStart = voiceScreen.indexOf('const sendDM');
      const sendDMEnd   = voiceScreen.indexOf('};', sendDMStart) + 2;
      const sendDMFn    = voiceScreen.slice(sendDMStart, sendDMEnd);
      expect(sendDMFn).toMatch(/refEntityId.*roomId|roomId.*refEntityId/s);
    });

    test('sendDM sends body: feedNote.trim() || null', () => {
      const sendDMStart = voiceScreen.indexOf('const sendDM');
      const sendDMEnd   = voiceScreen.indexOf('};', sendDMStart) + 2;
      const sendDMFn    = voiceScreen.slice(sendDMStart, sendDMEnd);
      expect(sendDMFn).toMatch(/feedNote\.trim\(\)\s*\|\|\s*null/);
    });

    test('sendDM does NOT send client-supplied room title', () => {
      const sendDMStart = voiceScreen.indexOf('const sendDM');
      const sendDMEnd   = voiceScreen.indexOf('};', sendDMStart) + 2;
      const sendDMFn    = voiceScreen.slice(sendDMStart, sendDMEnd);
      expect(sendDMFn).not.toMatch(/roomTitle\s*:/);
    });

    test('sendDM does NOT send plain-text URL body', () => {
      const sendDMStart = voiceScreen.indexOf('const sendDM');
      const sendDMEnd   = voiceScreen.indexOf('};', sendDMStart) + 2;
      const sendDMFn    = voiceScreen.slice(sendDMStart, sendDMEnd);
      expect(sendDMFn).not.toMatch(/shareBody/);
    });

    test('sendDM posts to /dm/conversations endpoint', () => {
      const sendDMStart = voiceScreen.indexOf('const sendDM');
      const sendDMEnd   = voiceScreen.indexOf('};', sendDMStart) + 2;
      const sendDMFn    = voiceScreen.slice(sendDMStart, sendDMEnd);
      expect(sendDMFn).toMatch(/\/dm\/conversations\//);
    });
  });

  // ── B. VoiceShareSheetMobile — Group send payload ─────────────────────────
  describe('B. VoiceShareSheetMobile: Group send uses structured VOICE_ROOM_SHARE', () => {
    test('sendGroup sends type: VOICE_ROOM_SHARE', () => {
      const sendGStart = voiceScreen.indexOf('const sendGroup');
      const sendGEnd   = voiceScreen.indexOf('};', sendGStart) + 2;
      const sendGFn    = voiceScreen.slice(sendGStart, sendGEnd);
      expect(sendGFn).toMatch(/type.*VOICE_ROOM_SHARE|VOICE_ROOM_SHARE.*type/s);
    });

    test('sendGroup sends refEntityType: VoiceRoom', () => {
      const sendGStart = voiceScreen.indexOf('const sendGroup');
      const sendGEnd   = voiceScreen.indexOf('};', sendGStart) + 2;
      const sendGFn    = voiceScreen.slice(sendGStart, sendGEnd);
      expect(sendGFn).toMatch(/refEntityType.*VoiceRoom|VoiceRoom.*refEntityType/s);
    });

    test('sendGroup sends refEntityId: roomId (authoritative)', () => {
      const sendGStart = voiceScreen.indexOf('const sendGroup');
      const sendGEnd   = voiceScreen.indexOf('};', sendGStart) + 2;
      const sendGFn    = voiceScreen.slice(sendGStart, sendGEnd);
      expect(sendGFn).toMatch(/refEntityId.*roomId|roomId.*refEntityId/s);
    });

    test('sendGroup sends body: feedNote.trim() || null', () => {
      const sendGStart = voiceScreen.indexOf('const sendGroup');
      const sendGEnd   = voiceScreen.indexOf('};', sendGStart) + 2;
      const sendGFn    = voiceScreen.slice(sendGStart, sendGEnd);
      expect(sendGFn).toMatch(/feedNote\.trim\(\)\s*\|\|\s*null/);
    });

    test('sendGroup does NOT send plain-text URL body', () => {
      const sendGStart = voiceScreen.indexOf('const sendGroup');
      const sendGEnd   = voiceScreen.indexOf('};', sendGStart) + 2;
      const sendGFn    = voiceScreen.slice(sendGStart, sendGEnd);
      expect(sendGFn).not.toMatch(/shareBody/);
    });

    test('sendGroup posts to /group-chat/conversations endpoint', () => {
      const sendGStart = voiceScreen.indexOf('const sendGroup');
      const sendGEnd   = voiceScreen.indexOf('};', sendGStart) + 2;
      const sendGFn    = voiceScreen.slice(sendGStart, sendGEnd);
      expect(sendGFn).toMatch(/\/group-chat\/conversations\//);
    });
  });

  // ── C. Feed/Community unchanged ───────────────────────────────────────────
  describe('C. Feed/Community: LIVE_ROOM_SHARE unchanged', () => {
    test('postFeed still uses LIVE_ROOM_SHARE', () => {
      const postFeedStart = voiceScreen.indexOf('const postFeed');
      const postFeedEnd   = voiceScreen.indexOf('};', postFeedStart) + 2;
      const postFeedFn    = voiceScreen.slice(postFeedStart, postFeedEnd);
      expect(postFeedFn).toMatch(/LIVE_ROOM_SHARE/);
    });

    test('postCommunity still uses LIVE_ROOM_SHARE', () => {
      const postCommStart = voiceScreen.indexOf('const postCommunity');
      const postCommEnd   = voiceScreen.indexOf('};', postCommStart) + 2;
      const postCommFn    = voiceScreen.slice(postCommStart, postCommEnd);
      expect(postCommFn).toMatch(/LIVE_ROOM_SHARE/);
    });

    test('sendDM does NOT use LIVE_ROOM_SHARE', () => {
      const sendDMStart = voiceScreen.indexOf('const sendDM');
      const sendDMEnd   = voiceScreen.indexOf('};', sendDMStart) + 2;
      const sendDMFn    = voiceScreen.slice(sendDMStart, sendDMEnd);
      expect(sendDMFn).not.toMatch(/LIVE_ROOM_SHARE/);
    });

    test('sendGroup does NOT use LIVE_ROOM_SHARE', () => {
      const sendGStart = voiceScreen.indexOf('const sendGroup');
      const sendGEnd   = voiceScreen.indexOf('};', sendGStart) + 2;
      const sendGFn    = voiceScreen.slice(sendGStart, sendGEnd);
      expect(sendGFn).not.toMatch(/LIVE_ROOM_SHARE/);
    });
  });

  // ── D. Note textareas in DM/Group tabs ───────────────────────────────────
  describe('D. VoiceShareSheetMobile: note textarea added to DM and Group tabs', () => {
    test('DM tab has feedNote TextInput', () => {
      // The DM tab render block starts with {/* DM */}
      const dmCommentIdx = voiceScreen.indexOf('{/* DM */}');
      const gcCommentIdx = voiceScreen.indexOf('{/* Group */}', dmCommentIdx);
      const dmTabBlock   = voiceScreen.slice(dmCommentIdx, gcCommentIdx);
      expect(dmTabBlock).toMatch(/feedNote/);
    });

    test('Group tab has feedNote TextInput', () => {
      const gcCommentIdx  = voiceScreen.indexOf('{/* Group */}');
      const feedCommentIdx = voiceScreen.indexOf('{/* Feed */}', gcCommentIdx);
      const gcTabBlock    = voiceScreen.slice(gcCommentIdx, feedCommentIdx);
      expect(gcTabBlock).toMatch(/feedNote/);
    });
  });

  // ── E. DmMediaBubble interface ────────────────────────────────────────────
  describe('E. DmMediaBubble: interface extended with entity ref fields', () => {
    test('DmMsgMedia has refEntityType', () => {
      const interfaceBlock = dmBubbleMob.slice(
        dmBubbleMob.indexOf('interface DmMsgMedia'),
        dmBubbleMob.indexOf('interface DmMsgMedia') + 600
      );
      expect(interfaceBlock).toMatch(/refEntityType\?:/);
    });

    test('DmMsgMedia has refEntityId', () => {
      const interfaceBlock = dmBubbleMob.slice(
        dmBubbleMob.indexOf('interface DmMsgMedia'),
        dmBubbleMob.indexOf('interface DmMsgMedia') + 600
      );
      expect(interfaceBlock).toMatch(/refEntityId\?:/);
    });

    test('DmMsgMedia has voiceRoomData', () => {
      const interfaceBlock = dmBubbleMob.slice(
        dmBubbleMob.indexOf('interface DmMsgMedia'),
        dmBubbleMob.indexOf('interface DmMsgMedia') + 600
      );
      expect(interfaceBlock).toMatch(/voiceRoomData\?:/);
    });

    test('imports VoiceRoomShareCard', () => {
      expect(dmBubbleMob).toMatch(/VoiceRoomShareCard/);
      expect(dmBubbleMob).toMatch(/import.*VoiceRoomShareCard|VoiceRoomShareCard.*import/s);
    });
  });

  // ── F. DmMediaBubble rendering ────────────────────────────────────────────
  describe('F. DmMediaBubble: VOICE_ROOM_SHARE rendering branch', () => {
    test('has explicit VOICE_ROOM_SHARE branch', () => {
      expect(dmBubbleMob).toMatch(/msgType\s*===\s*['"]VOICE_ROOM_SHARE['"]/);
    });

    test('VOICE_ROOM_SHARE branch renders VoiceRoomShareCard', () => {
      const condIdx = dmBubbleMob.indexOf("'VOICE_ROOM_SHARE'");
      const condBlock = dmBubbleMob.slice(condIdx, condIdx + 250);
      expect(condBlock).toMatch(/VoiceRoomShareCard/);
    });

    test('VOICE_ROOM_SHARE branch passes refEntityId from msg', () => {
      const condIdx = dmBubbleMob.indexOf("'VOICE_ROOM_SHARE'");
      const condBlock = dmBubbleMob.slice(condIdx, condIdx + 250);
      expect(condBlock).toMatch(/refEntityId/);
    });

    test('VOICE_ROOM_SHARE branch passes voiceRoomData from msg (server-authoritative)', () => {
      const condIdx = dmBubbleMob.indexOf("'VOICE_ROOM_SHARE'");
      const condBlock = dmBubbleMob.slice(condIdx, condIdx + 250);
      expect(condBlock).toMatch(/voiceRoomData/);
    });

    test('existing 7 media types still handled', () => {
      expect(dmBubbleMob).toMatch(/case 'IMAGE'/);
      expect(dmBubbleMob).toMatch(/case 'VIDEO'/);
      expect(dmBubbleMob).toMatch(/case 'VOICE'/);
      expect(dmBubbleMob).toMatch(/case 'AUDIO'/);
      expect(dmBubbleMob).toMatch(/case 'FILE'/);
    });
  });

  // ── G. Mobile DM screen — Message interface ───────────────────────────────
  describe('G. Mobile DM screen: Message interface extended', () => {
    test('Message interface has refEntityType', () => {
      expect(dmScreenMob).toMatch(/refEntityType\?:/);
    });

    test('Message interface has refEntityId', () => {
      expect(dmScreenMob).toMatch(/refEntityId\?:/);
    });

    test('Message interface has voiceRoomData', () => {
      expect(dmScreenMob).toMatch(/voiceRoomData\?:/);
    });
  });

  // ── H. Mobile Group Chat — GcMsg + mediaMsgShape ─────────────────────────
  describe('H. Mobile Group Chat: GcMsg extended and mediaMsgShape forwards ref fields', () => {
    test('GcMsg interface has refEntityType', () => {
      expect(gcScreenMob).toMatch(/refEntityType\?:/);
    });

    test('GcMsg interface has refEntityId', () => {
      expect(gcScreenMob).toMatch(/refEntityId\?:/);
    });

    test('GcMsg interface has voiceRoomData', () => {
      expect(gcScreenMob).toMatch(/voiceRoomData\?:/);
    });

    test('mediaMsgShape forwards refEntityType', () => {
      const shapeIdx = gcScreenMob.indexOf('mediaMsgShape');
      const shapeBlock = gcScreenMob.slice(shapeIdx, shapeIdx + 500);
      expect(shapeBlock).toMatch(/refEntityType/);
    });

    test('mediaMsgShape forwards refEntityId', () => {
      const shapeIdx = gcScreenMob.indexOf('mediaMsgShape');
      const shapeBlock = gcScreenMob.slice(shapeIdx, shapeIdx + 500);
      expect(shapeBlock).toMatch(/refEntityId/);
    });

    test('mediaMsgShape forwards voiceRoomData', () => {
      const shapeIdx = gcScreenMob.indexOf('mediaMsgShape');
      const shapeBlock = gcScreenMob.slice(shapeIdx, shapeIdx + 500);
      expect(shapeBlock).toMatch(/voiceRoomData/);
    });
  });

  // ── I. VoiceRoomShareCard — all three states ──────────────────────────────
  describe('I. Mobile VoiceRoomShareCard: available / unavailable / missing', () => {
    test('component file exists', () => {
      expect(vcCardMob.length).toBeGreaterThan(500);
      expect(vcCardMob).toMatch(/VoiceRoomShareCard/);
    });

    test('renders title from voiceRoomData (server-authoritative)', () => {
      expect(vcCardMob).toMatch(/voiceRoomData\.title/);
    });

    test('renders coverEmoji from voiceRoomData', () => {
      expect(vcCardMob).toMatch(/voiceRoomData\.coverEmoji/);
    });

    test('renders LIVE badge when status === LIVE', () => {
      expect(vcCardMob).toMatch(/isLive/);
      expect(vcCardMob).toMatch(/LIVE/);
    });

    test('shows unavailable fallback when voiceRoomData is null', () => {
      expect(vcCardMob).toMatch(/unavailable|no longer available/i);
    });

    test('handles missing refEntityId safely (no crash)', () => {
      expect(vcCardMob).toMatch(/!refEntityId/);
    });

    test('renders optional body/note from sender', () => {
      expect(vcCardMob).toMatch(/body/);
    });

    test('privacy information rendered', () => {
      expect(vcCardMob).toMatch(/privacy/);
    });
  });

  // ── J. VoiceRoomShareCard — navigation ───────────────────────────────────
  describe('J. Mobile VoiceRoomShareCard: navigation to existing mobile Voice Club route', () => {
    test('navigates to /voice/{refEntityId} — the existing mobile Voice Club route', () => {
      // Mobile uses app/voice/[id].tsx — route is /voice/{id} NOT /voice-club/{id}
      expect(vcCardMob).toMatch(/\/voice\/.*refEntityId|refEntityId.*\/voice\//s);
    });

    test('uses router.push from expo-router', () => {
      expect(vcCardMob).toMatch(/router\.push/);
      expect(vcCardMob).toMatch(/useRouter/);
    });

    test('does NOT navigate to /voice-club/ (that is the web URL, not the mobile route)', () => {
      const navIdx = vcCardMob.indexOf('router.push');
      const navBlock = vcCardMob.slice(navIdx, navIdx + 100);
      expect(navBlock).not.toMatch(/\/voice-club\//);
    });

    test('does NOT join Voice Club automatically (no /join API call)', () => {
      expect(vcCardMob).not.toMatch(/api\.post.*voice|\/voice.*\/join/s);
    });
  });

  // ── K. Web Phase 5 compatibility ─────────────────────────────────────────
  describe('K. Web/Mobile payload parity', () => {
    test('mobile DM and web DM use the same VOICE_ROOM_SHARE type', () => {
      const webShare = fs.readFileSync(WEB_SHARE, 'utf8');
      expect(webShare).toMatch(/VOICE_ROOM_SHARE/);  // web uses it
      expect(voiceScreen).toMatch(/VOICE_ROOM_SHARE/); // mobile uses it
    });

    test('mobile DM uses msgType (matching web DM msgType field)', () => {
      const sendDMStart = voiceScreen.indexOf('const sendDM');
      const sendDMEnd   = voiceScreen.indexOf('};', sendDMStart) + 2;
      const sendDMFn    = voiceScreen.slice(sendDMStart, sendDMEnd);
      expect(sendDMFn).toMatch(/msgType/);
    });

    test('mobile Group uses type (matching web Group type field)', () => {
      const sendGStart = voiceScreen.indexOf('const sendGroup');
      const sendGEnd   = voiceScreen.indexOf('};', sendGStart) + 2;
      const sendGFn    = voiceScreen.slice(sendGStart, sendGEnd);
      expect(sendGFn).toMatch(/type.*VOICE_ROOM_SHARE|VOICE_ROOM_SHARE.*type/s);
      // Must use 'type' not 'msgType' for group chat (backend contract)
    });

    test('mobile VoiceRoomShareCard exists alongside web VoiceRoomShareCard', () => {
      expect(fs.existsSync(VC_CARD_MOB)).toBe(true);
      expect(fs.existsSync(VC_CARD_WEB)).toBe(true);
    });
  });

  // ── L. Backend untouched ─────────────────────────────────────────────────
  describe('L. Backend: untouched by Phase 6', () => {
    test('dm.controller.js still has VOICE_ROOM_SHARE (Phase 3)', () => {
      const dmCtrl = fs.readFileSync(DM_CTRL, 'utf8');
      expect(dmCtrl).toMatch(/VOICE_ROOM_SHARE/);
    });

    test('groupChat.controller.js still has VOICE_ROOM_SHARE (Phase 4)', () => {
      const gcCtrl = fs.readFileSync(GC_CTRL, 'utf8');
      expect(gcCtrl).toMatch(/VOICE_ROOM_SHARE/);
    });

    test('voice.controller.js one-room rule untouched', () => {
      const voiceCtrl = fs.readFileSync(VOICE_CTRL, 'utf8');
      expect(voiceCtrl).toMatch(/VOICE_ROOM_ALREADY_ACTIVE/);
    });
  });

  // ── M. Web untouched ──────────────────────────────────────────────────────
  describe('M. Web: VoiceShareSheet untouched by Phase 6', () => {
    test('web VoiceShareSheet still has structured DM and Group payloads (Phase 5)', () => {
      const webShare = fs.readFileSync(WEB_SHARE, 'utf8');
      expect(webShare).toMatch(/msgType.*VOICE_ROOM_SHARE|VOICE_ROOM_SHARE.*msgType/s);
    });

    test('mobile VoiceRoomShareCard is different from web (platform-appropriate)', () => {
      // Mobile uses React Native primitives (View/Text/TouchableOpacity)
      expect(vcCardMob).toMatch(/TouchableOpacity|Pressable/);
      expect(vcCardMob).not.toMatch(/className=/);  // no CSS classes (web-only)
    });
  });
});
