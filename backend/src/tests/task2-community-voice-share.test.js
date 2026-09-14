'use strict';
/**
 * TASK 2 — Community Destination in Voice Club Share Sheet
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies the Community sharing tab on both web (VoiceShareSheet.tsx) and
 * mobile (VoiceShareSheetMobile inside mobile/app/voice/[id].tsx).
 *
 * Key contracts:
 *   • GET /communities/mine fetches the user's joined communities
 *   • POST /posts with { type:'LIVE_ROOM_SHARE', refEntityType:'VoiceRoom',
 *       refEntityId, communityId, body, visibility:'PUBLIC' }
 *   • Authorization delegated entirely to backend (no client-side bypass)
 *   • Existing DM / Group / Feed / Copy tabs are untouched
 *   • Normal TEXT posts remain unchanged
 *   • Voice Club seat/queue/mute/one-room systems untouched
 */

const fs   = require('fs');
const path = require('path');

// ─── File paths ───────────────────────────────────────────────────────────────
const WEB_SHARE   = path.join(__dirname, '../../../frontend/src/components/voice/VoiceShareSheet.tsx');
const MOB_SCREEN  = path.join(__dirname, '../../../mobile/app/voice/[id].tsx');
const POST_CTRL   = path.join(__dirname, '../controllers/post.controller.js');
const COMM_CTRL   = path.join(__dirname, '../controllers/community.controller.js');
const COMM_ROUTES = path.join(__dirname, '../routes/community.routes.js');
const VOICE_CTRL  = path.join(__dirname, '../controllers/voice.controller.js');

// Helper: extract a named async function body
function extractFunction(src, name) {
  const start = src.indexOf(`async function ${name}`);
  if (start === -1) return null;
  const next  = src.indexOf('async function', start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('TASK 2 — Community Voice Club Share', () => {

  // ── 1. Community API: GET /communities/mine ───────────────────────────────
  describe('Backend: GET /communities/mine', () => {
    let routesSrc, ctrlSrc;
    beforeAll(() => {
      routesSrc = fs.readFileSync(COMM_ROUTES, 'utf8');
      ctrlSrc   = fs.readFileSync(COMM_CTRL, 'utf8');
    });

    test('route GET /mine is registered in community.routes.js', () => {
      expect(routesSrc).toMatch(/router\.get\(['"]\/mine['"]/);
      expect(routesSrc).toMatch(/ctrl\.getMyCommunities/);
    });

    test('route requires authentication (router.use(authenticate) before /mine)', () => {
      // authenticate middleware is applied at router level (before all routes)
      const authIdx  = routesSrc.indexOf('router.use(authenticate)');
      const mineIdx  = routesSrc.indexOf("router.get('/mine'");
      expect(authIdx).toBeGreaterThan(-1);
      expect(mineIdx).toBeGreaterThan(authIdx);
    });

    test('getMyCommunities() queries communityMember by userId', () => {
      const fn = extractFunction(ctrlSrc, 'getMyCommunities');
      expect(fn).toBeTruthy();
      expect(fn).toMatch(/communityMember\.findMany/);
      expect(fn).toMatch(/userId.*req\.user\.id|req\.user\.id.*userId/s);
    });

    test('getMyCommunities() filters out deleted communities', () => {
      const fn = extractFunction(ctrlSrc, 'getMyCommunities');
      expect(fn).toMatch(/deletedAt/);
    });

    test('getMyCommunities() returns items array with community fields', () => {
      const fn = extractFunction(ctrlSrc, 'getMyCommunities');
      // Maps memberships to community data — returns the community objects
      expect(fn).toMatch(/m\.community|\.community/);
      expect(fn).toMatch(/successResponse/);
    });

    test('COMMUNITY_SELECT includes id, slug, name, avatarUrl, privacy, memberCount', () => {
      // These fields are needed by the share sheet UI
      expect(ctrlSrc).toMatch(/COMMUNITY_SELECT/);
      const selectBlock = ctrlSrc.slice(
        ctrlSrc.indexOf('COMMUNITY_SELECT'),
        ctrlSrc.indexOf('COMMUNITY_SELECT') + 400
      );
      expect(selectBlock).toMatch(/id.*true|true.*id/s);
      expect(selectBlock).toMatch(/name.*true|true.*name/s);
      expect(selectBlock).toMatch(/avatarUrl.*true|true.*avatarUrl/s);
      expect(selectBlock).toMatch(/privacy.*true|true.*privacy/s);
    });

    test('SUPER_ADMIN is blocked from creating/joining communities', () => {
      // The route file has denyIfSuperAdmin middleware
      expect(routesSrc).toMatch(/denyIfSuperAdmin/);
    });
  });

  // ── 2. Backend: POST /posts with communityId ──────────────────────────────
  describe('Backend: POST /posts communityId handling', () => {
    let src;
    beforeAll(() => { src = fs.readFileSync(POST_CTRL, 'utf8'); });

    test('createPost() destructures communityId from req.body', () => {
      const fn = extractFunction(src, 'createPost');
      expect(fn).toMatch(/communityId/);
    });

    test('communityId is stored on the post record', () => {
      const fn = extractFunction(src, 'createPost');
      // prisma.post.create data includes communityId
      expect(fn).toMatch(/communityId\s*:\s*communityId/);
    });

    test('private community posts emit to community socket room only', () => {
      // Socket emission checks community privacy before broadcasting
      const fn = extractFunction(src, 'createPost');
      expect(fn).toMatch(/PRIVATE.*INVITE_ONLY|community.*privacy/s);
      expect(fn).toMatch(/community:.*communityId/);
    });

    test('public community posts emit to both community room and feed:public', () => {
      const fn = extractFunction(src, 'createPost');
      expect(fn).toMatch(/feed:public/);
    });

    test('community privacy check is done on the DB record (not client-provided)', () => {
      const fn = extractFunction(src, 'createPost');
      // Backend fetches community from DB to check privacy
      expect(fn).toMatch(/prisma\.community\.findUnique.*communityId|findUnique.*community/s);
    });

    test('LIVE_ROOM_SHARE with communityId is allowed (no extra gate)', () => {
      // The LIVE_ROOM_SHARE validation only checks refEntityId — communityId is orthogonal
      const fn = extractFunction(src, 'createPost');
      // BUG-006 block: checks refEntityId
      const guardBlock = src.slice(src.indexOf('BUG-006 FIX'), src.indexOf('BUG-006 FIX') + 600);
      expect(guardBlock).toMatch(/refEntityId/);
      // Guard should NOT refuse communityId
      expect(guardBlock).not.toMatch(/communityId.*error|error.*communityId/s);
    });
  });

  // ── 3. Web VoiceShareSheet.tsx — Community tab ───────────────────────────
  describe('Web: VoiceShareSheet.tsx — Community tab', () => {
    let src;
    beforeAll(() => { src = fs.readFileSync(WEB_SHARE, 'utf8'); });

    test('Community tab is declared in tabs array', () => {
      expect(src).toMatch(/community.*Community|Community.*community/s);
      // Appears as a tab button
      expect(src).toMatch(/'community'/);
    });

    test('Community tab fetches GET /communities/mine', () => {
      expect(src).toMatch(/\/communities\/mine/);
    });

    test('community data query is enabled only when community tab is active', () => {
      // Query is gated by tab === 'community' to avoid fetching on sheet open
      expect(src).toMatch(/enabled.*community|community.*enabled/s);
    });

    test('handlePostCommunity sends type: LIVE_ROOM_SHARE', () => {
      const fnStart = src.indexOf('handlePostCommunity');
      const fnEnd   = src.indexOf('}, [', fnStart);
      const fn      = src.slice(fnStart, fnEnd + 50);
      expect(fn).toMatch(/type\s*:\s*['"]LIVE_ROOM_SHARE['"]/);
    });

    test('handlePostCommunity sends refEntityType: VoiceRoom', () => {
      const fnStart = src.indexOf('handlePostCommunity');
      const fnEnd   = src.indexOf('}, [', fnStart);
      const fn      = src.slice(fnStart, fnEnd + 50);
      expect(fn).toMatch(/refEntityType\s*:\s*['"]VoiceRoom['"]/);
    });

    test('handlePostCommunity sends refEntityId: roomId (authoritative)', () => {
      const fnStart = src.indexOf('handlePostCommunity');
      const fnEnd   = src.indexOf('}, [', fnStart);
      const fn      = src.slice(fnStart, fnEnd + 50);
      expect(fn).toMatch(/refEntityId\s*:\s*roomId/);
    });

    test('handlePostCommunity sends communityId: community.id', () => {
      const fnStart = src.indexOf('handlePostCommunity');
      const fnEnd   = src.indexOf('}, [', fnStart);
      const fn      = src.slice(fnStart, fnEnd + 50);
      expect(fn).toMatch(/communityId\s*:\s*community\.id/);
    });

    test('handlePostCommunity sends body: feedNote.trim() || null', () => {
      const fnStart = src.indexOf('handlePostCommunity');
      const fnEnd   = src.indexOf('}, [', fnStart);
      const fn      = src.slice(fnStart, fnEnd + 50);
      expect(fn).toMatch(/feedNote\.trim\(\)\s*\|\|\s*null/);
    });

    test('Community tab has a search input for filtering communities', () => {
      expect(src).toMatch(/search.*communities|communities.*search/si);
    });

    test('Community tab shows empty state when no communities exist', () => {
      expect(src).toMatch(/not a member of any communities|No communities found/i);
    });

    test('Community list renders community.name', () => {
      // Community items show name
      expect(src).toMatch(/community\.name/);
    });

    test('Community list renders community.avatarUrl', () => {
      expect(src).toMatch(/community\.avatarUrl/);
    });

    test('Community list renders privacy or member count', () => {
      expect(src).toMatch(/community\.privacy|community\._count|community\.memberCount/);
    });

    test('Community share does NOT include client-provided room title in payload', () => {
      const fnStart = src.indexOf('handlePostCommunity');
      const fnEnd   = src.indexOf('}, [', fnStart);
      const fn      = src.slice(fnStart, fnEnd + 50);
      // roomTitle must NOT appear in the api.post payload (only in UI display)
      expect(fn).not.toMatch(/roomTitle\s*:/);
    });

    test('Community posts to /posts endpoint', () => {
      const fnStart = src.indexOf('handlePostCommunity');
      const fnEnd   = src.indexOf('}, [', fnStart);
      const fn      = src.slice(fnStart, fnEnd + 100);
      expect(fn).toMatch(/api\.post\(['"]\/posts['"]/);
    });
  });

  // ── 4. Mobile VoiceShareSheetMobile — Community tab ──────────────────────
  describe('Mobile: VoiceShareSheetMobile — Community tab', () => {
    let src;
    beforeAll(() => { src = fs.readFileSync(MOB_SCREEN, 'utf8'); });

    test('VoiceShareSheetMobile has a community tab in TABS array', () => {
      expect(src).toMatch(/id.*community.*label.*Community|Community.*community/s);
    });

    test('mobile fetches /communities/mine', () => {
      expect(src).toMatch(/\/communities\/mine/);
    });

    test('mobile community query is gated by visible && tab', () => {
      // Only fetches when the community tab is open and modal is visible
      expect(src).toMatch(/enabled.*visible.*community|community.*visible/s);
    });

    test('postCommunity sends type: LIVE_ROOM_SHARE', () => {
      const fnStart = src.indexOf('const postCommunity');
      const fnEnd   = src.indexOf('};', fnStart) + 2;
      const fn      = src.slice(fnStart, fnEnd);
      expect(fn).toMatch(/type\s*:\s*['"]LIVE_ROOM_SHARE['"]/);
    });

    test('postCommunity sends refEntityType: VoiceRoom', () => {
      const fnStart = src.indexOf('const postCommunity');
      const fnEnd   = src.indexOf('};', fnStart) + 2;
      const fn      = src.slice(fnStart, fnEnd);
      expect(fn).toMatch(/refEntityType\s*:\s*['"]VoiceRoom['"]/);
    });

    test('postCommunity sends refEntityId: roomId (authoritative)', () => {
      const fnStart = src.indexOf('const postCommunity');
      const fnEnd   = src.indexOf('};', fnStart) + 2;
      const fn      = src.slice(fnStart, fnEnd);
      expect(fn).toMatch(/refEntityId\s*:\s*roomId/);
    });

    test('postCommunity sends communityId: community.id', () => {
      const fnStart = src.indexOf('const postCommunity');
      const fnEnd   = src.indexOf('};', fnStart) + 2;
      const fn      = src.slice(fnStart, fnEnd);
      expect(fn).toMatch(/communityId\s*:\s*community\.id/);
    });

    test('postCommunity sends body: feedNote.trim() || null', () => {
      const fnStart = src.indexOf('const postCommunity');
      const fnEnd   = src.indexOf('};', fnStart) + 2;
      const fn      = src.slice(fnStart, fnEnd);
      expect(fn).toMatch(/feedNote\.trim\(\)\s*\|\|\s*null/);
    });

    test('mobile community tab renders community items in a FlatList', () => {
      // Community items rendered via FlatList in community tab
      const commTab = src.slice(
        src.indexOf("tab === 'community'"),
        src.indexOf("tab === 'copy'")
      );
      expect(commTab).toMatch(/FlatList|filteredCommunities/);
    });

    test('mobile community tab has optional note TextInput', () => {
      const commTab = src.slice(
        src.indexOf("tab === 'community'"),
        src.indexOf("tab === 'copy'")
      );
      expect(commTab).toMatch(/feedInput|feedNote|Add a note/);
    });

    test('mobile community tab shows empty state', () => {
      expect(src).toMatch(/not a member of any communities|No communities found/i);
    });

    test('mobile vss StyleSheet is defined (not undefined)', () => {
      // vss must be defined as a StyleSheet constant in the file
      // Previously was referenced but never declared — this test guards regressions
      expect(src).toMatch(/const vss\s*=\s*StyleSheet\.create/);
    });

    test('vss.backdrop is defined', () => {
      // Use closing '});' after const vss as the end boundary
      const vssStart = src.indexOf('const vss');
      const vssEnd   = src.indexOf('});', vssStart) + 3;
      const vssBlock = src.slice(vssStart, vssEnd);
      expect(vssBlock).toMatch(/backdrop/);
    });

    test('vss.sheet is defined', () => {
      const vssStart = src.indexOf('const vss');
      const vssEnd   = src.indexOf('});', vssStart) + 3;
      const vssBlock = src.slice(vssStart, vssEnd);
      expect(vssBlock).toMatch(/sheet\s*:/);
    });

    test('vss.row is defined (used for community list rows)', () => {
      const vssStart = src.indexOf('const vss');
      const vssEnd   = src.indexOf('});', vssStart) + 3;
      const vssBlock = src.slice(vssStart, vssEnd);
      expect(vssBlock).toMatch(/row\s*:/);
    });

    test('vss.sendBtn is defined (used for Share button)', () => {
      const vssStart = src.indexOf('const vss');
      const vssEnd   = src.indexOf('});', vssStart) + 3;
      const vssBlock = src.slice(vssStart, vssEnd);
      expect(vssBlock).toMatch(/sendBtn\s*:/);
    });

    test('vss.postBtn is defined (used for community Share action)', () => {
      const vssStart = src.indexOf('const vss');
      const vssEnd   = src.indexOf('});', vssStart) + 3;
      const vssBlock = src.slice(vssStart, vssEnd);
      expect(vssBlock).toMatch(/postBtn\s*:/);
    });
  });

  // ── 5. Web/Mobile parity ─────────────────────────────────────────────────
  describe('Web/Mobile parity: same backend endpoint and payload', () => {
    let webSrc, mobSrc;
    beforeAll(() => {
      webSrc = fs.readFileSync(WEB_SHARE, 'utf8');
      mobSrc = fs.readFileSync(MOB_SCREEN, 'utf8');
    });

    test('both platforms use POST /posts for community share', () => {
      expect(webSrc).toMatch(/api\.post\(['"]\/posts['"]/);
      expect(mobSrc).toMatch(/api\.post\(['"]\/posts['"]/);
    });

    test('both platforms send LIVE_ROOM_SHARE type', () => {
      // web handlePostCommunity
      expect(webSrc).toMatch(/LIVE_ROOM_SHARE/);
      // mobile postCommunity
      expect(mobSrc).toMatch(/LIVE_ROOM_SHARE/);
    });

    test('both platforms send refEntityType: VoiceRoom', () => {
      expect(webSrc).toMatch(/VoiceRoom/);
      expect(mobSrc).toMatch(/VoiceRoom/);
    });

    test('both platforms send communityId in community share payload', () => {
      expect(webSrc).toMatch(/communityId\s*:\s*community\.id/);
      expect(mobSrc).toMatch(/communityId\s*:\s*community\.id/);
    });

    test('both platforms fetch communities from /communities/mine', () => {
      expect(webSrc).toMatch(/\/communities\/mine/);
      expect(mobSrc).toMatch(/\/communities\/mine/);
    });

    test('both platforms handle optional note (body: feedNote || null)', () => {
      expect(webSrc).toMatch(/feedNote/);
      expect(mobSrc).toMatch(/feedNote/);
    });

    test('both platforms show the Community tab label', () => {
      expect(webSrc).toMatch(/Community/);
      expect(mobSrc).toMatch(/Community/);
    });
  });

  // ── 6. Authorization: backend is authoritative ───────────────────────────
  describe('Authorization: backend enforces community access', () => {
    let commCtrlSrc, commRoutesSrc;
    beforeAll(() => {
      commCtrlSrc   = fs.readFileSync(COMM_CTRL, 'utf8');
      commRoutesSrc = fs.readFileSync(COMM_ROUTES, 'utf8');
    });

    test('community routes use authenticate middleware', () => {
      expect(commRoutesSrc).toMatch(/authenticate/);
    });

    test('getMyCommunities only returns communities the user is a member of', () => {
      const fn = extractFunction(commCtrlSrc, 'getMyCommunities');
      // Queries by userId — only returns user's own memberships
      expect(fn).toMatch(/userId.*req\.user\.id/s);
    });

    test('ban check exists in community controller', () => {
      // isUserBanned helper ensures banned users are blocked
      expect(commCtrlSrc).toMatch(/isUserBanned|isBanned/);
    });

    test('PRIVATE community join requires pending request (P0-1 fix)', () => {
      // P0-1 fix: PRIVATE join creates a pending JoinRequest
      expect(commCtrlSrc).toMatch(/PRIVATE.*JoinRequest|JoinRequest.*PRIVATE/s);
    });

    test('clients send only communityId — backend validates membership and privacy', () => {
      // The web share sheet does NOT send a membership token or role claim.
      // It sends only community.id — the backend does all authorization.
      const webSrc = fs.readFileSync(WEB_SHARE, 'utf8');
      const fnStart = webSrc.indexOf('handlePostCommunity');
      const fnEnd   = webSrc.indexOf('}, [', fnStart);
      const fn      = webSrc.slice(fnStart, fnEnd + 50);
      // No membership or role fields in payload
      expect(fn).not.toMatch(/myRole\s*:|role\s*:|membership\s*:/);
    });

    test('SUPER_ADMIN is blocked from community content actions', () => {
      // denyIfSuperAdmin is applied on community create and join routes
      expect(commRoutesSrc).toMatch(/denyIfSuperAdmin/);
      // Appears on at least 2 routes (create + join)
      const count = (commRoutesSrc.match(/denyIfSuperAdmin/g) || []).length;
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  // ── 7. Existing tabs are untouched ───────────────────────────────────────
  describe('Existing tabs: DM / Group / Feed / Copy unchanged', () => {
    let webSrc, mobSrc;
    beforeAll(() => {
      webSrc = fs.readFileSync(WEB_SHARE, 'utf8');
      mobSrc = fs.readFileSync(MOB_SCREEN, 'utf8');
    });

    test('web DM tab still uses /dm/conversations endpoint', () => {
      expect(webSrc).toMatch(/\/dm\/conversations/);
    });

    test('web Group tab still uses /group-chat/conversations endpoint', () => {
      expect(webSrc).toMatch(/\/group-chat\/conversations/);
    });

    test('web Feed tab still uses LIVE_ROOM_SHARE without communityId', () => {
      const fnStart = webSrc.indexOf('handlePostFeed');
      const fnEnd   = webSrc.indexOf('}, [feed', fnStart);
      const fn      = webSrc.slice(fnStart, fnEnd + 100);
      expect(fn).toMatch(/LIVE_ROOM_SHARE/);
      // Feed post must NOT include communityId
      expect(fn).not.toMatch(/communityId/);
    });

    test('web Copy tab writes to clipboard (not /posts)', () => {
      expect(webSrc).toMatch(/clipboard\.writeText|handleCopy/);
    });

    test('mobile DM tab still sends to /dm/conversations', () => {
      const fnStart = mobSrc.indexOf('const sendDM');
      const fnEnd   = mobSrc.indexOf('};', fnStart) + 2;
      const fn      = mobSrc.slice(fnStart, fnEnd);
      expect(fn).toMatch(/\/dm\/conversations\//);
    });

    test('mobile Group tab still sends to /group-chat/conversations', () => {
      const fnStart = mobSrc.indexOf('const sendGroup');
      const fnEnd   = mobSrc.indexOf('};', fnStart) + 2;
      const fn      = mobSrc.slice(fnStart, fnEnd);
      expect(fn).toMatch(/\/group-chat\/conversations\//);
    });

    test('mobile Feed tab still uses LIVE_ROOM_SHARE without communityId', () => {
      const fnStart = mobSrc.indexOf('const postFeed');
      const fnEnd   = mobSrc.indexOf('};', fnStart) + 2;
      const fn      = mobSrc.slice(fnStart, fnEnd);
      expect(fn).toMatch(/LIVE_ROOM_SHARE/);
      expect(fn).not.toMatch(/communityId/);
    });

    test('mobile Copy tab uses native Share.share', () => {
      const fnStart = mobSrc.indexOf('const nativeShare');
      const fnEnd   = mobSrc.indexOf('};', fnStart) + 2;
      const fn      = mobSrc.slice(fnStart, fnEnd);
      expect(fn).toMatch(/Share\.share/);
    });
  });

  // ── 8. Normal TEXT posts unchanged ───────────────────────────────────────
  describe('Existing: TEXT posts and community TEXT posts unaffected', () => {
    let src;
    beforeAll(() => { src = fs.readFileSync(POST_CTRL, 'utf8'); });

    test('createPost default type remains TEXT', () => {
      expect(src).toMatch(/type\s*=\s*['"]TEXT['"]/);
    });

    test('TEXT posts with communityId are allowed (existing community feed posts)', () => {
      // Community shares add communityId but TEXT community posts must also still work
      // communityId is accepted for any post type — no type restriction in createPost
      const fn = extractFunction(src, 'createPost');
      // communityId handling is NOT gated by type check
      const typeGateIdx  = fn.indexOf("type === 'LIVE_ROOM_SHARE'");
      const communityIdx = fn.indexOf('communityId:');
      // communityId write happens outside the LIVE_ROOM_SHARE gate
      expect(communityIdx).toBeGreaterThan(typeGateIdx);
    });

    test('getCommunityFeed route exists for community post retrieval', () => {
      const routesSrc = fs.readFileSync(COMM_ROUTES, 'utf8');
      expect(routesSrc).toMatch(/getCommunityFeed/);
    });
  });

  // ── 9. Voice Club systems untouched ──────────────────────────────────────
  describe('Voice Club: stage/queue/mute/one-room systems unchanged', () => {
    let voiceSrc;
    beforeAll(() => { voiceSrc = fs.readFileSync(VOICE_CTRL, 'utf8'); });

    test('joinRoom() one-room-at-a-time rule is intact', () => {
      const fn = extractFunction(voiceSrc, 'joinRoom');
      expect(fn).toMatch(/VOICE_ROOM_ALREADY_ACTIVE/);
    });

    test('joinRoom() ban check is intact', () => {
      const fn = extractFunction(voiceSrc, 'joinRoom');
      expect(fn).toMatch(/isBanned/);
    });

    test('leaveRoom() auto-sleep grace period is intact', () => {
      const fn = extractFunction(voiceSrc, 'leaveRoom');
      expect(fn).toMatch(/AUTO_SLEEP_GRACE_MS|5.*60.*1000/);
    });

    test('voice controller does NOT contain community share logic', () => {
      // Community sharing goes through post.controller — not voice controller
      expect(voiceSrc).not.toMatch(/communityId.*posts|posts.*communityId/);
      expect(voiceSrc).not.toMatch(/\/communities\/mine/);
    });

    test('voice controller does NOT contain createPost call', () => {
      expect(voiceSrc).not.toMatch(/createPost/);
    });
  });

  // ── 10. Task 2 implementation documented ─────────────────────────────────
  describe('Task 2: Community tab is implemented and documented', () => {
    test('web VoiceShareSheet.tsx documents Community endpoint', () => {
      const src = fs.readFileSync(WEB_SHARE, 'utf8');
      // Comment at top of file documents Community endpoint
      expect(src).toMatch(/GET.*communities\/mine|communities.*mine/i);
    });

    test('mobile VoiceShareSheetMobile has Community tab in TABS const', () => {
      const src = fs.readFileSync(MOB_SCREEN, 'utf8');
      // TABS array must include community entry
      const tabsStart = src.indexOf('const TABS');
      const tabsEnd   = src.indexOf('];', tabsStart);
      const tabsBlock = src.slice(tabsStart, tabsEnd);
      expect(tabsBlock).toMatch(/community/);
    });

    test('mobile vss StyleSheet exists and covers all share sheet keys', () => {
      const src = fs.readFileSync(MOB_SCREEN, 'utf8');
      expect(src).toMatch(/const vss\s*=\s*StyleSheet\.create/);
      const vssStart = src.indexOf('const vss');
      const vssEnd   = src.indexOf('});', vssStart) + 3;
      const vssBlock = src.slice(vssStart, vssEnd);
      // All keys referenced in the share sheet must be defined
      const requiredKeys = [
        'backdrop', 'sheet', 'handle', 'header', 'title', 'subtitle',
        'tabsScroll', 'tabsContent', 'tabBtn', 'tabBtnActive', 'tabTxt', 'tabTxtActive',
        'searchRow', 'searchInput', 'empty', 'row', 'avatar', 'name', 'meta',
        'sendBtn', 'sendBtnDisabled', 'sendBtnTxt',
        'feedLabel', 'feedInput', 'postBtn', 'postBtnDisabled', 'postBtnTxt',
        'linkBox', 'linkTxt', 'copyHint',
      ];
      for (const key of requiredKeys) {
        expect(vssBlock).toMatch(new RegExp(`${key}\\s*:`));
      }
    });
  });
});
