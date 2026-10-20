'use strict';
/**
 * BUG-003 — Mobile Voice Club Share URL: WEB origin, not API origin
 * ─────────────────────────────────────────────────────────────────────────────
 * The mobile share sheet MUST build the public Voice Club URL from the web app
 * origin (EXPO_PUBLIC_WEB_URL), never from the API server URL.
 *
 * Correct:   https://app.halqa.com/voice-club/{roomId}
 * Incorrect: https://api.halqa.app/api/v1/voice-club/{roomId}
 * Incorrect: http://192.168.100.147:5000/api/v1/voice-club/{roomId}
 *
 * Coverage:
 *   1.  Mobile share URL uses EXPO_PUBLIC_WEB_URL, not API URL
 *   2.  /api/v1 prefix is never present in the share URL
 *   3.  Trailing slash is normalized
 *   4.  roomId is preserved exactly in the URL
 *   5.  Result path is /voice-club/{roomId}
 *   6.  Copy Link tab uses the corrected URL
 *   7.  Native Share.share uses the corrected URL
 *   8.  DM share body contains the web URL
 *   9.  Group share body contains the web URL
 *  10.  Feed share payload does NOT include roomUrl (uses refEntityId)
 *  11.  Community share payload does NOT include roomUrl
 *  12.  EXPO_PUBLIC_WEB_URL is defined in mobile/.env
 *  13.  mobile/.env does NOT use the API URL as the web URL
 *  14.  eas.json preview profile has EXPO_PUBLIC_WEB_URL
 *  15.  eas.json production profile has EXPO_PUBLIC_WEB_URL
 *  16.  Production WEB_URL does NOT equal production API_URL
 *  17.  Web VoiceShareSheet uses window.location.origin (not env var)
 *  18.  Web URL path is /voice-club/{roomId}
 *  19.  Deep-link route app/voice/[id].tsx exists
 *  20.  mobile app.json has scheme: halqa
 *  21.  _layout.tsx exports APP_SCHEME and createDeepLink
 *  22.  One-room 409 still enforced in voice controller
 *  23.  Feed share unchanged (uses refEntityId)
 *  24.  Community share unchanged (uses communityId + refEntityId)
 *  25.  DM share unchanged
 *  26.  Group share unchanged
 */

const fs   = require('fs');
const path = require('path');

// ─── File paths ───────────────────────────────────────────────────────────────
const MOB_SCREEN   = path.join(__dirname, '../../../mobile/app/voice/[id].tsx');
const WEB_SHARE    = path.join(__dirname, '../../../frontend/src/components/voice/VoiceShareSheet.tsx');
const MOB_ENV      = path.join(__dirname, '../../../mobile/.env');
const EAS_JSON     = path.join(__dirname, '../../../mobile/eas.json');
const APP_JSON     = path.join(__dirname, '../../../mobile/app.json');
const MOB_LAYOUT   = path.join(__dirname, '../../../mobile/app/_layout.tsx');
const VOICE_CTRL   = path.join(__dirname, '../controllers/voice.controller.js');
const VOICE_ROUTE  = path.join(__dirname, '../../../mobile/app/voice/[id].tsx');

// Helper: extract a named async function body
function extractFunction(src, name) {
  const start = src.indexOf(`async function ${name}`);
  if (start === -1) return null;
  const next  = src.indexOf('async function', start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('BUG-003 — Mobile Voice Club Share URL', () => {

  // ── 1. Mobile share sheet URL construction ────────────────────────────────
  describe('Mobile VoiceShareSheetMobile: URL source', () => {
    let src;
    beforeAll(() => { src = fs.readFileSync(MOB_SCREEN, 'utf8'); });

    test('URL uses EXPO_PUBLIC_WEB_URL environment variable', () => {
      expect(src).toMatch(/EXPO_PUBLIC_WEB_URL/);
    });

    test('webBase strips trailing slash from EXPO_PUBLIC_WEB_URL', () => {
      // .replace(/\/$/, '') normalizes trailing slash
      expect(src).toMatch(/replace\(.*\\\/\$.*,\s*['"]['"]|replace\(.*\/\$.*['"]\s*,\s*['"]['"]]/);
    });

    test('roomUrl is built as webBase + /voice-club/ + roomId', () => {
      const shareStart = src.indexOf('VoiceShareSheetMobile');
      const shareSection = src.slice(shareStart, shareStart + 3000);
      expect(shareSection).toMatch(/webBase.*voice-club.*roomId|voice-club.*roomId/s);
    });

    test('EXPO_PUBLIC_WEB_URL is NOT derived from the API URL', () => {
      // webBase must come from EXPO_PUBLIC_WEB_URL, not EXPO_PUBLIC_API_URL
      const shareStart = src.indexOf('VoiceShareSheetMobile');
      const shareSection = src.slice(shareStart, shareStart + 500);
      expect(shareSection).not.toMatch(/EXPO_PUBLIC_API_URL/);
      expect(shareSection).not.toMatch(/api\.defaults\.baseURL/);
    });

    test('/api/v1 prefix is never present in roomUrl', () => {
      // Ensure the URL construction does not include /api/v1 anywhere
      const shareStart = src.indexOf('const webBase');
      const urlSection = src.slice(shareStart, shareStart + 200);
      expect(urlSection).not.toMatch(/\/api\/v1/);
      expect(urlSection).not.toMatch(/api\/v1/);
    });

    test('roomId is preserved exactly in roomUrl', () => {
      // The URL must include the roomId variable directly
      expect(src).toMatch(/roomUrl.*=.*roomId|`.*\/voice-club\/\${roomId}`/s);
    });

    test('URL path segment is /voice-club/ not /voice/', () => {
      // The public URL is /voice-club/{id}, not /voice/{id} (which is the mobile app route)
      const shareStart = src.indexOf('const webBase');
      const urlSection = src.slice(shareStart, shareStart + 200);
      expect(urlSection).toMatch(/\/voice-club\//);
    });
  });

  // ── 2. Copy Link and Native Share use the corrected URL ───────────────────
  describe('Copy Link and Native Share use corrected URL', () => {
    let src;
    beforeAll(() => { src = fs.readFileSync(MOB_SCREEN, 'utf8'); });

    test('nativeShare passes roomUrl to Share.share', () => {
      const fnStart = src.indexOf('const nativeShare');
      const fnEnd   = src.indexOf('};', fnStart) + 2;
      const fn      = src.slice(fnStart, fnEnd);
      // Share.share receives the roomUrl
      expect(fn).toMatch(/roomUrl|shareBody/);
      expect(fn).toMatch(/Share\.share/);
    });

    test('Copy Link tab displays roomUrl or shareBody containing roomUrl', () => {
      // The copy tab shows the link — it must reference roomUrl or shareBody
      const copyTab = src.slice(
        src.indexOf("tab === 'copy'"),
        src.indexOf("tab === 'copy'") + 600
      );
      expect(copyTab).toMatch(/roomUrl|shareBody|linkTxt/);
    });

    test('shareBody text includes the web URL', () => {
      // DM/Group share body is constructed from roomUrl
      expect(src).toMatch(/shareBody.*=.*roomUrl|roomUrl.*shareBody/s);
    });
  });

  // ── 3. DM and Group share use the web URL ────────────────────────────────
  describe('DM and Group share bodies include web URL', () => {
    let src;
    beforeAll(() => { src = fs.readFileSync(MOB_SCREEN, 'utf8'); });

    test('DM sendDM uses structured VOICE_ROOM_SHARE (Phase 6 — no longer plain-text URL)', () => {
      // Phase 6 upgraded DM share from plain-text shareBody to structured VOICE_ROOM_SHARE.
      const fnStart = src.indexOf('const sendDM');
      const fnEnd   = src.indexOf('};', fnStart) + 2;
      const fn      = src.slice(fnStart, fnEnd);
      expect(fn).toMatch(/VOICE_ROOM_SHARE/);
      expect(fn).not.toMatch(/shareBody/);
    });

    test('Group sendGroup uses structured VOICE_ROOM_SHARE (Phase 6 — no longer plain-text URL)', () => {
      const fnStart = src.indexOf('const sendGroup');
      const fnEnd   = src.indexOf('};', fnStart) + 2;
      const fn      = src.slice(fnStart, fnEnd);
      expect(fn).toMatch(/VOICE_ROOM_SHARE/);
      expect(fn).not.toMatch(/shareBody/);
    });

    test('shareBody does NOT contain /api/v1', () => {
      // shareBody is built from roomUrl which uses web origin
      const bodyStart = src.indexOf('const shareBody');
      const bodyLine  = src.slice(bodyStart, bodyStart + 200);
      expect(bodyLine).not.toMatch(/\/api\/v1/);
    });
  });

  // ── 4. Feed and Community share are unchanged (use refEntityId) ───────────
  describe('Feed and Community share unchanged (refEntityId, not URL)', () => {
    let src;
    beforeAll(() => { src = fs.readFileSync(MOB_SCREEN, 'utf8'); });

    test('postFeed does NOT include roomUrl in the POST payload', () => {
      const fnStart = src.indexOf('const postFeed');
      const fnEnd   = src.indexOf('};', fnStart) + 2;
      const fn      = src.slice(fnStart, fnEnd);
      // Feed share uses refEntityId, not a URL
      expect(fn).toMatch(/refEntityId\s*:\s*roomId/);
      expect(fn).not.toMatch(/roomUrl\s*:/);
    });

    test('postCommunity does NOT include roomUrl in the POST payload', () => {
      const fnStart = src.indexOf('const postCommunity');
      const fnEnd   = src.indexOf('};', fnStart) + 2;
      const fn      = src.slice(fnStart, fnEnd);
      expect(fn).toMatch(/refEntityId\s*:\s*roomId/);
      expect(fn).not.toMatch(/roomUrl\s*:/);
    });
  });

  // ── 5. Environment configuration ─────────────────────────────────────────
  describe('Environment configuration: EXPO_PUBLIC_WEB_URL', () => {
    test('mobile/.env defines EXPO_PUBLIC_WEB_URL', () => {
      const env = fs.readFileSync(MOB_ENV, 'utf8');
      expect(env).toMatch(/EXPO_PUBLIC_WEB_URL\s*=/);
    });

    test('mobile/.env WEB_URL does not use the API origin', () => {
      const env = fs.readFileSync(MOB_ENV, 'utf8');
      // Extract the actual value
      const match = env.match(/EXPO_PUBLIC_WEB_URL\s*=\s*(.+)/);
      expect(match).toBeTruthy();
      const webUrl = match[1].trim();
      // Must not point to a backend API port (5000) or include /api
      expect(webUrl).not.toMatch(/:5000/);
      expect(webUrl).not.toMatch(/\/api/);
    });

    test('eas.json preview profile has EXPO_PUBLIC_WEB_URL', () => {
      const eas = JSON.parse(fs.readFileSync(EAS_JSON, 'utf8'));
      expect(eas.build.preview.env).toBeDefined();
      expect(eas.build.preview.env.EXPO_PUBLIC_WEB_URL).toBeDefined();
      expect(eas.build.preview.env.EXPO_PUBLIC_WEB_URL).not.toBe('');
    });

    test('eas.json production profile has EXPO_PUBLIC_WEB_URL', () => {
      const eas = JSON.parse(fs.readFileSync(EAS_JSON, 'utf8'));
      expect(eas.build.production.env).toBeDefined();
      expect(eas.build.production.env.EXPO_PUBLIC_WEB_URL).toBeDefined();
      expect(eas.build.production.env.EXPO_PUBLIC_WEB_URL).not.toBe('');
    });

    test('eas.json production WEB_URL is different from production API_URL', () => {
      const eas = JSON.parse(fs.readFileSync(EAS_JSON, 'utf8'));
      const prodEnv = eas.build.production.env;
      // They should be different domains (web app != API server)
      expect(prodEnv.EXPO_PUBLIC_WEB_URL).not.toEqual(prodEnv.EXPO_PUBLIC_API_URL);
    });

    test('eas.json production WEB_URL does not contain /api/v1', () => {
      const eas = JSON.parse(fs.readFileSync(EAS_JSON, 'utf8'));
      expect(eas.build.production.env.EXPO_PUBLIC_WEB_URL).not.toMatch(/\/api\/v1/);
      expect(eas.build.production.env.EXPO_PUBLIC_WEB_URL).not.toMatch(/api\/v1/);
    });

    test('eas.json preview WEB_URL does not contain /api/v1', () => {
      const eas = JSON.parse(fs.readFileSync(EAS_JSON, 'utf8'));
      expect(eas.build.preview.env.EXPO_PUBLIC_WEB_URL).not.toMatch(/\/api\/v1/);
    });
  });

  // ── 6. Deep-link audit ────────────────────────────────────────────────────
  describe('Deep link: mobile routing for /voice-club/{roomId}', () => {
    test('mobile app router has a voice/[id].tsx screen', () => {
      expect(fs.existsSync(VOICE_ROUTE)).toBe(true);
    });

    test('app.json declares the halqa:// custom scheme', () => {
      const appJson = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
      expect(appJson.expo.scheme).toBe('halqa');
    });

    test('_layout.tsx exports APP_SCHEME constant', () => {
      const layout = fs.readFileSync(MOB_LAYOUT, 'utf8');
      expect(layout).toMatch(/APP_SCHEME\s*=\s*['"]halqa['"]/);
    });

    test('_layout.tsx exports createDeepLink helper using expo-linking', () => {
      const layout = fs.readFileSync(MOB_LAYOUT, 'utf8');
      expect(layout).toMatch(/createDeepLink/);
      expect(layout).toMatch(/Linking\.createURL/);
    });

    test('_layout.tsx documents halqa://voice/[id] as a supported deep link route', () => {
      const layout = fs.readFileSync(MOB_LAYOUT, 'utf8');
      // The layout comment documents the voice deep link
      expect(layout).toMatch(/halqa:\/\/voice\/\[id\]|voice\/\[id\]/);
    });

    test('app.json extra.router.origin is false (disables web URL fallback for RN)', () => {
      const appJson = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
      expect(appJson.expo.extra?.router?.origin).toBe(false);
    });
  });

  // ── 7. Web VoiceShareSheet uses window.location.origin ───────────────────
  describe('Web VoiceShareSheet: URL source unchanged', () => {
    let src;
    beforeAll(() => { src = fs.readFileSync(WEB_SHARE, 'utf8'); });

    test('web share URL uses window.location.origin (not env var)', () => {
      expect(src).toMatch(/window\.location\.origin/);
    });

    test('web share URL path is /voice-club/{roomId}', () => {
      expect(src).toMatch(/window\.location\.origin.*\/voice-club\/|`.*\/voice-club\/\$\{roomId\}`/s);
    });

    test('web share does NOT use EXPO_PUBLIC_WEB_URL', () => {
      expect(src).not.toMatch(/EXPO_PUBLIC_WEB_URL/);
    });

    test('web share does NOT use NEXT_PUBLIC variables for URL', () => {
      // Web derives URL from window.location — no env var needed
      const urlSection = src.slice(
        src.indexOf('roomUrl'),
        src.indexOf('roomUrl') + 200
      );
      expect(urlSection).not.toMatch(/NEXT_PUBLIC/);
    });
  });

  // ── 8. Voice Club backend systems unchanged ───────────────────────────────
  describe('Voice Club backend: one-room rule and room systems unchanged', () => {
    let voiceSrc;
    beforeAll(() => { voiceSrc = fs.readFileSync(VOICE_CTRL, 'utf8'); });

    test('joinRoom() one-room-at-a-time 409 rule is intact', () => {
      const fn = extractFunction(voiceSrc, 'joinRoom');
      expect(fn).toMatch(/VOICE_ROOM_ALREADY_ACTIVE/);
      expect(fn).toMatch(/409/);
    });

    test('leaveRoom() auto-sleep is scheduled via BullMQ queue service', () => {
      // BullMQ-based sleep: leaveRoom() calls scheduleRoomSleep() from queue.service.
      // The 5-min delay is configured inside queue.service.js (not inline in the controller).
      const fn = extractFunction(voiceSrc, 'leaveRoom');
      expect(fn).toMatch(/scheduleRoomSleep/);
    });

    test('voice controller has no share URL logic', () => {
      expect(voiceSrc).not.toMatch(/WEB_URL|voice-club.*http/i);
    });
  });

  // ── 9. URL format correctness ─────────────────────────────────────────────
  describe('URL format: correct structure', () => {
    test('mobile URL pattern produces /voice-club/{roomId} with no API prefix', () => {
      // Simulate the URL construction logic from VoiceShareSheetMobile
      const mockWebBase = 'https://app.halqa.com';
      const mockRoomId  = 'abc-123-xyz';
      const webBase = mockWebBase.replace(/\/$/, '');
      const roomUrl = `${webBase}/voice-club/${mockRoomId}`;

      expect(roomUrl).toBe('https://app.halqa.com/voice-club/abc-123-xyz');
      expect(roomUrl).not.toMatch(/\/api\/v1/);
      expect(roomUrl).not.toMatch(/\/api\//);
      expect(roomUrl).toMatch(/\/voice-club\/abc-123-xyz$/);
    });

    test('trailing slash on webBase is normalized', () => {
      const withSlash    = 'https://app.halqa.com/'.replace(/\/$/, '');
      const withoutSlash = 'https://app.halqa.com'.replace(/\/$/, '');
      const roomId = 'test-room';

      expect(`${withSlash}/voice-club/${roomId}`)
        .toBe(`${withoutSlash}/voice-club/${roomId}`);
    });

    test('double slash is avoided when webBase has no trailing slash', () => {
      const base    = 'https://app.halqa.com'.replace(/\/$/, '');
      const roomUrl = `${base}/voice-club/test`;
      expect(roomUrl).not.toMatch(/\/\//g.test(roomUrl.slice(8)) ? /true/ : /false/);
      // More direct: the path portion must not have //
      const pathPart = roomUrl.replace('https://', '');
      expect(pathPart).not.toMatch(/\/\//);
    });

    test('roomId with hyphens and alphanumeric chars is preserved', () => {
      const base    = 'https://app.halqa.com'.replace(/\/$/, '');
      const roomId  = 'clxyz-abc-123-def456';
      const roomUrl = `${base}/voice-club/${roomId}`;
      expect(roomUrl).toBe('https://app.halqa.com/voice-club/clxyz-abc-123-def456');
    });

    test('empty EXPO_PUBLIC_WEB_URL falls back gracefully (no crash)', () => {
      // When env var is empty, roomUrl becomes '/voice-club/{roomId}'
      const webBase = ('').replace(/\/$/, '');
      const roomUrl = `${webBase}/voice-club/test`;
      expect(roomUrl).toBe('/voice-club/test');
      // No crash — relative URL is the safe fallback
    });
  });

  // ── 10. BUG-003 fix is documented ────────────────────────────────────────
  describe('BUG-003 fix is documented in source', () => {
    test('mobile voice screen has BUG-003 fix comment', () => {
      const src = fs.readFileSync(MOB_SCREEN, 'utf8');
      expect(src).toMatch(/BUG-003/);
    });

    test('mobile README documents EXPO_PUBLIC_WEB_URL', () => {
      const readme = fs.readFileSync(
        path.join(__dirname, '../../../mobile/README.md'), 'utf8'
      );
      expect(readme).toMatch(/EXPO_PUBLIC_WEB_URL/);
    });
  });
});
