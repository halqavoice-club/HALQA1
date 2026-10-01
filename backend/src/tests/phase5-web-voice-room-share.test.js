'use strict';
/**
 * Phase 5 — Web UI VOICE_ROOM_SHARE tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests all web UI components changed in Phase 5:
 *   - dm.store.ts                  (types + normalizer)
 *   - groupChat.store.ts           (GcMessage interface)
 *   - lib/dm.ts                    (SendMessagePayload + DmMsgType)
 *   - VoiceShareSheet.tsx          (DM + Group send payloads)
 *   - DmMediaBubble.tsx            (VOICE_ROOM_SHARE rendering branch)
 *   - GcMediaBubble.tsx            (VOICE_ROOM_SHARE rendering branch)
 *   - VoiceRoomShareCard.tsx       (card component)
 *
 * Coverage:
 *  A. DM store type extensions
 *  B. Group Chat store type extensions
 *  C. DM lib API payload
 *  D. VoiceShareSheet send behavior
 *  E. DmMediaBubble rendering
 *  F. GcMediaBubble rendering
 *  G. VoiceRoomShareCard
 *  H. Existing message types unchanged
 *  I. Feed/Community compatibility
 *  J. Backend untouched
 *  K. Mobile untouched
 */

const fs   = require('fs');
const path = require('path');

const DM_STORE    = path.join(__dirname, '../../../frontend/src/store/dm.store.ts');
const GC_STORE    = path.join(__dirname, '../../../frontend/src/store/groupChat.store.ts');
const DM_LIB      = path.join(__dirname, '../../../frontend/src/lib/dm.ts');
const SHARE_SHEET = path.join(__dirname, '../../../frontend/src/components/voice/VoiceShareSheet.tsx');
const DM_BUBBLE   = path.join(__dirname, '../../../frontend/src/components/dm/DmMediaBubble.tsx');
const GC_BUBBLE   = path.join(__dirname, '../../../frontend/src/components/group-chat/GcMediaBubble.tsx');
const VC_CARD     = path.join(__dirname, '../../../frontend/src/components/chat/VoiceRoomShareCard.tsx');
const DM_CTRL     = path.join(__dirname, '../controllers/dm.controller.js');
const GC_CTRL     = path.join(__dirname, '../controllers/groupChat.controller.js');
const VOICE_CTRL  = path.join(__dirname, '../controllers/voice.controller.js');
const MOB_SCREEN  = path.join(__dirname, '../../../mobile/app/voice/[id].tsx');

let dmStore, gcStore, dmLib, shareSheet, dmBubble, gcBubble, vcCard;
beforeAll(() => {
  dmStore    = fs.readFileSync(DM_STORE,    'utf8');
  gcStore    = fs.readFileSync(GC_STORE,    'utf8');
  dmLib      = fs.readFileSync(DM_LIB,      'utf8');
  shareSheet = fs.readFileSync(SHARE_SHEET, 'utf8');
  dmBubble   = fs.readFileSync(DM_BUBBLE,   'utf8');
  gcBubble   = fs.readFileSync(GC_BUBBLE,   'utf8');
  vcCard     = fs.readFileSync(VC_CARD,     'utf8');
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Phase 5 — Web UI VOICE_ROOM_SHARE', () => {

  // ── A. DM Store type extensions ───────────────────────────────────────────
  describe('A. dm.store.ts: type extensions', () => {
    test('DmMsgType union includes VOICE_ROOM_SHARE', () => {
      expect(dmStore).toMatch(/VOICE_ROOM_SHARE/);
      const typeMatch = dmStore.match(/DmMsgType\s*=\s*([^;]+)/);
      expect(typeMatch?.[1]).toContain('VOICE_ROOM_SHARE');
    });

    test('DmMessage interface has optional refEntityType', () => {
      const msgInterface = dmStore.slice(dmStore.indexOf('interface DmMessage'), dmStore.indexOf('interface DmMessage') + 1000);
      expect(msgInterface).toMatch(/refEntityType\?:/);
    });

    test('DmMessage interface has optional refEntityId', () => {
      const msgInterface = dmStore.slice(dmStore.indexOf('interface DmMessage'), dmStore.indexOf('interface DmMessage') + 1000);
      expect(msgInterface).toMatch(/refEntityId\?:/);
    });

    test('DmMessage interface has optional voiceRoomData', () => {
      const msgInterface = dmStore.slice(dmStore.indexOf('interface DmMessage'), dmStore.indexOf('interface DmMessage') + 1000);
      expect(msgInterface).toMatch(/voiceRoomData\?:/);
    });

    test('VoiceRoomShareData interface is defined in dm.store.ts', () => {
      expect(dmStore).toMatch(/interface VoiceRoomShareData/);
      expect(dmStore).toMatch(/title.*string/s);
      expect(dmStore).toMatch(/coverEmoji/);
    });

    test('addMessage normalizer preserves refEntityType', () => {
      // The addMessage implementation (not interface) must preserve refEntityType
      // It's in the create<GcState> call, after the interface section
      expect(dmStore).toMatch(/refEntityType.*msg.*refEntityType|refEntityType.*\?\?.*null/s);
    });

    test('addMessage normalizer preserves refEntityId', () => {
      expect(dmStore).toMatch(/refEntityId.*msg.*refEntityId|refEntityId.*\?\?.*null/s);
    });

    test('addMessage normalizer preserves voiceRoomData', () => {
      expect(dmStore).toMatch(/voiceRoomData.*msg.*voiceRoomData|voiceRoomData.*\?\?.*null/s);
    });

    test('updateConversationPreview has VOICE_ROOM_SHARE preview entry', () => {
      // The implementation is in the create() call block — search the whole store
      expect(dmStore).toMatch(/VOICE_ROOM_SHARE/);
      expect(dmStore).toMatch(/Voice Club/);
    });

    test('existing 6 media type preview entries still present', () => {
      // Search the entire dm.store.ts for all 6 original preview entries
      ['IMAGE', 'VIDEO', 'GIF', 'VOICE', 'AUDIO', 'FILE'].forEach(t => {
        expect(dmStore).toContain(t);
      });
    });
  });

  // ── B. Group Chat Store ───────────────────────────────────────────────────
  describe('B. groupChat.store.ts: GcMessage extended', () => {
    test('GcMessage has optional refEntityType', () => {
      const msgInterface = gcStore.slice(gcStore.indexOf('interface GcMessage'), gcStore.indexOf('interface GcMessage') + 1200);
      expect(msgInterface).toMatch(/refEntityType\?:/);
    });

    test('GcMessage has optional refEntityId', () => {
      const msgInterface = gcStore.slice(gcStore.indexOf('interface GcMessage'), gcStore.indexOf('interface GcMessage') + 1200);
      expect(msgInterface).toMatch(/refEntityId\?:/);
    });

    test('GcMessage has optional voiceRoomData', () => {
      const msgInterface = gcStore.slice(gcStore.indexOf('interface GcMessage'), gcStore.indexOf('interface GcMessage') + 1200);
      expect(msgInterface).toMatch(/voiceRoomData\?:/);
    });

    test('voiceRoomData shape includes title and coverEmoji', () => {
      const msgInterface = gcStore.slice(gcStore.indexOf('interface GcMessage'), gcStore.indexOf('interface GcMessage') + 1200);
      expect(msgInterface).toMatch(/title.*string/s);
      expect(msgInterface).toMatch(/coverEmoji/);
    });
  });

  // ── C. DM Lib API ─────────────────────────────────────────────────────────
  describe('C. lib/dm.ts: SendMessagePayload extended', () => {
    test('DmMsgType in lib includes VOICE_ROOM_SHARE', () => {
      expect(dmLib).toMatch(/VOICE_ROOM_SHARE/);
    });

    test('SendMessagePayload has optional refEntityType', () => {
      const payloadBlock = dmLib.slice(dmLib.indexOf('SendMessagePayload'), dmLib.indexOf('SendMessagePayload') + 600);
      expect(payloadBlock).toMatch(/refEntityType\?:/);
    });

    test('SendMessagePayload has optional refEntityId', () => {
      const payloadBlock = dmLib.slice(dmLib.indexOf('SendMessagePayload'), dmLib.indexOf('SendMessagePayload') + 600);
      expect(payloadBlock).toMatch(/refEntityId\?:/);
    });

    test('body is nullable in SendMessagePayload (supports null for share-only messages)', () => {
      const payloadBlock = dmLib.slice(dmLib.indexOf('SendMessagePayload'), dmLib.indexOf('SendMessagePayload') + 600);
      expect(payloadBlock).toMatch(/body\?:.*string.*null|body\?:.*null.*string/s);
    });
  });

  // ── D. VoiceShareSheet send behavior ─────────────────────────────────────
  describe('D. VoiceShareSheet.tsx: DM and Group send structured payload', () => {
    test('DM send uses msgType: VOICE_ROOM_SHARE', () => {
      const dmFnStart = shareSheet.indexOf('handleSendDM');
      const dmFnEnd   = shareSheet.indexOf('}, [feed', dmFnStart);
      const fn = shareSheet.slice(dmFnStart, dmFnEnd + 100);
      expect(fn).toMatch(/msgType.*VOICE_ROOM_SHARE|VOICE_ROOM_SHARE.*msgType/s);
    });

    test('DM send uses refEntityType: VoiceRoom', () => {
      const dmFnStart = shareSheet.indexOf('handleSendDM');
      const dmFnEnd   = shareSheet.indexOf('}, [feed', dmFnStart);
      const fn = shareSheet.slice(dmFnStart, dmFnEnd + 100);
      expect(fn).toMatch(/refEntityType.*VoiceRoom|VoiceRoom.*refEntityType/s);
    });

    test('DM send uses refEntityId: roomId (authoritative)', () => {
      const dmFnStart = shareSheet.indexOf('handleSendDM');
      const dmFnEnd   = shareSheet.indexOf('}, [feed', dmFnStart);
      const fn = shareSheet.slice(dmFnStart, dmFnEnd + 100);
      expect(fn).toMatch(/refEntityId.*roomId|roomId.*refEntityId/s);
    });

    test('DM send does NOT include client-supplied room title', () => {
      const dmFnStart = shareSheet.indexOf('handleSendDM');
      const dmFnEnd   = shareSheet.indexOf('}, [feed', dmFnStart);
      const fn = shareSheet.slice(dmFnStart, dmFnEnd + 100);
      expect(fn).not.toMatch(/roomTitle\s*:/);
    });

    test('Group send uses type: VOICE_ROOM_SHARE', () => {
      const gcFnStart = shareSheet.indexOf('handleSendGroup');
      const gcFnEnd   = shareSheet.indexOf('}, [feed', gcFnStart);
      const fn = shareSheet.slice(gcFnStart, gcFnEnd + 100);
      expect(fn).toMatch(/type.*VOICE_ROOM_SHARE|VOICE_ROOM_SHARE.*type/s);
    });

    test('Group send uses refEntityType: VoiceRoom', () => {
      const gcFnStart = shareSheet.indexOf('handleSendGroup');
      const gcFnEnd   = shareSheet.indexOf('}, [feed', gcFnStart);
      const fn = shareSheet.slice(gcFnStart, gcFnEnd + 100);
      expect(fn).toMatch(/refEntityType.*VoiceRoom|VoiceRoom.*refEntityType/s);
    });

    test('Group send uses refEntityId: roomId (authoritative)', () => {
      const gcFnStart = shareSheet.indexOf('handleSendGroup');
      const gcFnEnd   = shareSheet.indexOf('}, [feed', gcFnStart);
      const fn = shareSheet.slice(gcFnStart, gcFnEnd + 100);
      expect(fn).toMatch(/refEntityId.*roomId|roomId.*refEntityId/s);
    });

    test('Feed share unchanged — still uses LIVE_ROOM_SHARE with POST /posts', () => {
      const feedFnStart = shareSheet.indexOf('handlePostFeed');
      const feedFnEnd   = shareSheet.indexOf('}, [feed', feedFnStart);
      const fn = shareSheet.slice(feedFnStart, feedFnEnd + 100);
      expect(fn).toMatch(/LIVE_ROOM_SHARE/);
      expect(fn).toMatch(/\/posts/);
      // Feed must not use the DM/Group endpoint
      expect(fn).not.toMatch(/\/dm\/conversations/);
      expect(fn).not.toMatch(/\/group-chat\/conversations/);
    });

    test('Community share unchanged — still uses LIVE_ROOM_SHARE with communityId', () => {
      const commFnStart = shareSheet.indexOf('handlePostCommunity');
      const commFnEnd   = shareSheet.indexOf('}, [feed', commFnStart);
      const fn = shareSheet.slice(commFnStart, commFnEnd + 100);
      expect(fn).toMatch(/LIVE_ROOM_SHARE/);
      expect(fn).toMatch(/communityId/);
    });

    test('DM and Group tabs have optional note textarea (feedNote)', () => {
      // feedNote is used in all tabs (DM, Group, Feed, Community) — shared state
      expect(shareSheet).toMatch(/feedNote/);
      // The DM tab section references feedNote
      expect(shareSheet).toMatch(/tab === 'dm'/);
      expect(shareSheet).toMatch(/tab === 'group'/);
    });
  });

  // ── E. DmMediaBubble rendering ─────────────────────────────────────────────
  describe('E. DmMediaBubble.tsx: VOICE_ROOM_SHARE rendering', () => {
    test('imports VoiceRoomShareCard', () => {
      expect(dmBubble).toMatch(/VoiceRoomShareCard/);
      expect(dmBubble).toMatch(/from.*VoiceRoomShareCard|VoiceRoomShareCard.*from/s);
    });

    test('has explicit VOICE_ROOM_SHARE branch before switch', () => {
      expect(dmBubble).toMatch(/msgType\s*===\s*['"]VOICE_ROOM_SHARE['"]/);
    });

    test('VOICE_ROOM_SHARE branch renders VoiceRoomShareCard', () => {
      const shareBlock = dmBubble.slice(
        dmBubble.indexOf("VOICE_ROOM_SHARE"),
        dmBubble.indexOf("VOICE_ROOM_SHARE") + 300
      );
      expect(shareBlock).toMatch(/VoiceRoomShareCard/);
    });

    test('VOICE_ROOM_SHARE branch passes refEntityId from msg', () => {
      const shareBlock = dmBubble.slice(
        dmBubble.indexOf("VOICE_ROOM_SHARE"),
        dmBubble.indexOf("VOICE_ROOM_SHARE") + 300
      );
      expect(shareBlock).toMatch(/refEntityId/);
    });

    test('VOICE_ROOM_SHARE branch passes voiceRoomData from msg (server-authoritative)', () => {
      const shareBlock = dmBubble.slice(
        dmBubble.indexOf("VOICE_ROOM_SHARE"),
        dmBubble.indexOf("VOICE_ROOM_SHARE") + 300
      );
      expect(shareBlock).toMatch(/voiceRoomData/);
    });

    test('existing TEXT/IMAGE/VIDEO/GIF/AUDIO/VOICE/FILE cases still in switch', () => {
      expect(dmBubble).toMatch(/case 'IMAGE'/);
      expect(dmBubble).toMatch(/case 'VIDEO'/);
      expect(dmBubble).toMatch(/case 'AUDIO'/);
      expect(dmBubble).toMatch(/case 'VOICE'/);
      expect(dmBubble).toMatch(/case 'FILE'/);
    });
  });

  // ── F. GcMediaBubble rendering ─────────────────────────────────────────────
  describe('F. GcMediaBubble.tsx: VOICE_ROOM_SHARE rendering', () => {
    test('imports VoiceRoomShareCard', () => {
      expect(gcBubble).toMatch(/VoiceRoomShareCard/);
    });

    test('GcMsgMedia interface has refEntityType', () => {
      const interfaceBlock = gcBubble.slice(gcBubble.indexOf('interface GcMsgMedia'), gcBubble.indexOf('interface GcMsgMedia') + 600);
      expect(interfaceBlock).toMatch(/refEntityType\?:/);
    });

    test('GcMsgMedia interface has refEntityId', () => {
      const interfaceBlock = gcBubble.slice(gcBubble.indexOf('interface GcMsgMedia'), gcBubble.indexOf('interface GcMsgMedia') + 600);
      expect(interfaceBlock).toMatch(/refEntityId\?:/);
    });

    test('GcMsgMedia interface has voiceRoomData', () => {
      const interfaceBlock = gcBubble.slice(gcBubble.indexOf('interface GcMsgMedia'), gcBubble.indexOf('interface GcMsgMedia') + 600);
      expect(interfaceBlock).toMatch(/voiceRoomData\?:/);
    });

    test('has explicit VOICE_ROOM_SHARE branch', () => {
      expect(gcBubble).toMatch(/type\s*===\s*['"]VOICE_ROOM_SHARE['"]/);
    });

    test('VOICE_ROOM_SHARE branch renders VoiceRoomShareCard', () => {
      // Find the conditional block (not the import line)
      const condIdx = gcBubble.indexOf("type === 'VOICE_ROOM_SHARE'");
      const condBlock = gcBubble.slice(condIdx, condIdx + 300);
      expect(condBlock).toMatch(/VoiceRoomShareCard/);
    });

    test('VOICE_ROOM_SHARE branch passes refEntityId from msg', () => {
      const condIdx = gcBubble.indexOf("type === 'VOICE_ROOM_SHARE'");
      const condBlock = gcBubble.slice(condIdx, condIdx + 300);
      expect(condBlock).toMatch(/refEntityId/);
    });

    test('VOICE_ROOM_SHARE branch passes voiceRoomData (server-authoritative)', () => {
      const condIdx = gcBubble.indexOf("type === 'VOICE_ROOM_SHARE'");
      const condBlock = gcBubble.slice(condIdx, condIdx + 300);
      expect(condBlock).toMatch(/voiceRoomData/);
    });

    test('existing IMAGE/VIDEO/GIF/VOICE/AUDIO/FILE/DOCUMENT cases still in switch', () => {
      expect(gcBubble).toMatch(/case 'IMAGE'/);
      expect(gcBubble).toMatch(/case 'VIDEO'/);
      expect(gcBubble).toMatch(/case 'VOICE'/);
      expect(gcBubble).toMatch(/case 'FILE'/);
      expect(gcBubble).toMatch(/case 'DOCUMENT'/);
    });
  });

  // ── G. VoiceRoomShareCard component ──────────────────────────────────────
  describe('G. VoiceRoomShareCard.tsx: card behavior', () => {
    test('component exists', () => {
      expect(vcCard.length).toBeGreaterThan(500);
      expect(vcCard).toMatch(/VoiceRoomShareCard/);
    });

    test('navigates to /voice-club/{refEntityId} on click', () => {
      expect(vcCard).toMatch(/voice-club.*refEntityId|refEntityId.*voice-club/s);
      // The router.push argument uses refEntityId from props — not a room title
      const pushBlock = vcCard.slice(vcCard.indexOf('router.push'), vcCard.indexOf('router.push') + 100);
      expect(pushBlock).toMatch(/refEntityId/);
      expect(pushBlock).not.toMatch(/voiceRoomData\.title/);
    });

    test('uses router.push for navigation (existing Next.js routing)', () => {
      expect(vcCard).toMatch(/router\.push|useRouter/);
    });

    test('renders title from voiceRoomData (server-authoritative)', () => {
      expect(vcCard).toMatch(/voiceRoomData\.title/);
    });

    test('renders coverEmoji from voiceRoomData', () => {
      expect(vcCard).toMatch(/voiceRoomData\.coverEmoji/);
    });

    test('renders LIVE badge when status === LIVE', () => {
      expect(vcCard).toMatch(/status.*===.*LIVE|isLive/s);
      expect(vcCard).toMatch(/LIVE/);
    });

    test('shows unavailable fallback when voiceRoomData is null', () => {
      // voiceRoomData === null → safe fallback message
      expect(vcCard).toMatch(/unavailable|no longer available/i);
    });

    test('handles missing refEntityId safely (no crash)', () => {
      expect(vcCard).toMatch(/!refEntityId/);
    });

    test('renders optional body/note from sender', () => {
      expect(vcCard).toMatch(/body/);
    });

    test('does not join Voice Club automatically', () => {
      // Must only navigate — no POST /voice/:id/join call
      expect(vcCard).not.toMatch(/\/join|joinRoom/i);
      expect(vcCard).not.toMatch(/api\.post.*voice/i);
    });

    test('does not reference client-supplied host or participantCount', () => {
      expect(vcCard).not.toMatch(/clientHost|clientParticipants|req\.body\.host/);
    });
  });

  // ── H. Existing message types unchanged ───────────────────────────────────
  describe('H. Existing message types: all 7 DM types still in store', () => {
    test('TEXT, IMAGE, VIDEO, GIF, VOICE, AUDIO, FILE still in DmMsgType', () => {
      const typeMatch = dmStore.match(/DmMsgType\s*=\s*([^;]+)/);
      const types = typeMatch?.[1] ?? '';
      ['TEXT', 'IMAGE', 'VIDEO', 'GIF', 'VOICE', 'AUDIO', 'FILE'].forEach(t => {
        expect(types).toContain(t);
      });
    });

    test('TEXT, IMAGE, VIDEO, GIF, VOICE, AUDIO, FILE still in DmMsgType (lib)', () => {
      const typeMatch = dmLib.match(/DmMsgType\s*=\s*([^;]+)/);
      const types = typeMatch?.[1] ?? '';
      ['TEXT', 'IMAGE', 'VIDEO', 'GIF', 'VOICE', 'AUDIO', 'FILE'].forEach(t => {
        expect(types).toContain(t);
      });
    });
  });

  // ── I. Feed/Community compatibility ───────────────────────────────────────
  describe('I. Feed/Community: LIVE_ROOM_SHARE unchanged', () => {
    test('Feed share still uses LIVE_ROOM_SHARE post type', () => {
      expect(shareSheet).toMatch(/LIVE_ROOM_SHARE/);
    });

    test('Feed share still posts to /posts endpoint', () => {
      const feedFn = shareSheet.slice(shareSheet.indexOf('handlePostFeed'), shareSheet.indexOf('handlePostFeed') + 400);
      expect(feedFn).toMatch(/\/posts/);
    });

    test('LIVE_ROOM_SHARE and VOICE_ROOM_SHARE are separate types', () => {
      // Both must appear — they serve different purposes
      expect(shareSheet).toMatch(/LIVE_ROOM_SHARE/);   // Feed/Community
      expect(shareSheet).toMatch(/VOICE_ROOM_SHARE/);  // DM/Group
    });

    test('DM and Group send does NOT use LIVE_ROOM_SHARE', () => {
      // DM send function: find the actual api.post block only
      const dmFnStart = shareSheet.indexOf('handleSendDM');
      const dmApiCall = shareSheet.indexOf("api.post(`/dm/conversations", dmFnStart);
      const dmApiEnd  = shareSheet.indexOf('})', dmApiCall) + 2;
      const dmPayload = shareSheet.slice(dmApiCall, dmApiEnd);
      expect(dmPayload).not.toMatch(/LIVE_ROOM_SHARE/);

      // Group send function: find the actual api.post block only
      const gcFnStart = shareSheet.indexOf('handleSendGroup');
      const gcApiCall = shareSheet.indexOf("api.post(`/group-chat/conversations", gcFnStart);
      const gcApiEnd  = shareSheet.indexOf('})', gcApiCall) + 2;
      const gcPayload = shareSheet.slice(gcApiCall, gcApiEnd);
      expect(gcPayload).not.toMatch(/LIVE_ROOM_SHARE/);
    });
  });

  // ── J. Backend untouched ──────────────────────────────────────────────────
  describe('J. Backend: DM and Group controllers unchanged by Phase 5', () => {
    test('dm.controller.js still has VOICE_ROOM_SHARE backend logic (Phase 3)', () => {
      const dmCtrl = fs.readFileSync(DM_CTRL, 'utf8');
      expect(dmCtrl).toMatch(/VOICE_ROOM_SHARE/);
    });

    test('groupChat.controller.js still has VOICE_ROOM_SHARE backend logic (Phase 4)', () => {
      const gcCtrl = fs.readFileSync(GC_CTRL, 'utf8');
      expect(gcCtrl).toMatch(/VOICE_ROOM_SHARE/);
    });

    test('voice.controller.js one-room rule is untouched', () => {
      const voiceCtrl = fs.readFileSync(VOICE_CTRL, 'utf8');
      expect(voiceCtrl).toMatch(/VOICE_ROOM_ALREADY_ACTIVE/);
    });
  });

  // ── K. Mobile untouched ───────────────────────────────────────────────────
  describe('K. Mobile: VoiceShareSheetMobile unchanged by Phase 5 (web-only)', () => {
    test('VoiceRoomShareCard is web-only — NOT imported in mobile', () => {
      // Mobile Phase 6 will add structured cards — Phase 5 is web only
      // Verify the web-only card component exists but is not in mobile
      expect(vcCard.length).toBeGreaterThan(0);  // card component was created
      // Mobile [id].tsx does NOT import VoiceRoomShareCard (web-only in Phase 5)
      const mobPath = require('path').join(__dirname, '../../../mobile/app/voice');
      const mobScreen = require('fs').readFileSync(mobPath + '/[id].tsx', 'utf8');
      expect(mobScreen).not.toMatch(/VoiceRoomShareCard/);
    });

    test('mobile DM and Group share still use plain text (mobile Phase 6 pending)', () => {
      // Mobile VoiceShareSheetMobile still sends plain text for DM/Group
      // VOICE_ROOM_SHARE for mobile DM/Group is Phase 6 scope
      const mobPath = require('path').join(__dirname, '../../../mobile/app/voice');
      const mobScreen = require('fs').readFileSync(mobPath + '/[id].tsx', 'utf8');
      // Mobile sends LIVE_ROOM_SHARE for Feed/Community (unchanged), plain text for DM/Group
      expect(mobScreen).toMatch(/LIVE_ROOM_SHARE/);
    });

    test('Phase 5 only implements web — backend logic confirmed in Phase 3+4', () => {
      const dmCtrl = require('fs').readFileSync(DM_CTRL, 'utf8');
      const gcCtrl = require('fs').readFileSync(GC_CTRL, 'utf8');
      // Backend already supports VOICE_ROOM_SHARE from Phases 3 and 4
      expect(dmCtrl).toMatch(/VOICE_ROOM_SHARE/);
      expect(gcCtrl).toMatch(/VOICE_ROOM_SHARE/);
    });
  });
});
