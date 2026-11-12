'use strict';
/**
 * Voice Club — Low-Bandwidth Phase 1 Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies the three Phase 1 changes made for VCLUB-LB-002 / VCLUB-LB-022
 * (web audio bitrate adaptation) and VCLUB-LB-023 (Socket.IO ping tuning).
 *
 * Test strategy: source-grep style (same pattern as voice-forensic-fixes.test.js).
 * Each describe block reads the relevant source file(s) and asserts the presence
 * of the key implementation constructs. This is fast, zero-dependency, and
 * confirms the changes are in place without requiring a running server.
 *
 * Covered changes:
 *   CHANGE-001  useLiveKit.ts — adaptive audio bitrate via network quality hook
 *   CHANGE-002  app.js        — Socket.IO pingTimeout / pingInterval tuning
 *   CHANGE-003  (this file)   — regression tests for the above
 */

const fs   = require('fs');
const path = require('path');

// ── File paths ────────────────────────────────────────────────────────────────
const APP_JS         = path.join(__dirname, '../app.js');
const USE_LIVEKIT_TS = path.join(__dirname, '../../../frontend/src/hooks/useLiveKit.ts');
const NET_QUALITY_TS = path.join(__dirname, '../../../frontend/src/hooks/useNetworkQuality.ts');
const VOICE_VIEW_TSX = path.join(__dirname, '../../../frontend/src/components/voice/VoiceRoomView.tsx');

const appSrc      = fs.existsSync(APP_JS)         ? fs.readFileSync(APP_JS,         'utf8') : '';
const livekitSrc  = fs.existsSync(USE_LIVEKIT_TS) ? fs.readFileSync(USE_LIVEKIT_TS, 'utf8') : '';
const netQualSrc  = fs.existsSync(NET_QUALITY_TS) ? fs.readFileSync(NET_QUALITY_TS, 'utf8') : '';
const voiceViewSrc = fs.existsSync(VOICE_VIEW_TSX) ? fs.readFileSync(VOICE_VIEW_TSX, 'utf8') : '';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CHANGE-001 — useLiveKit.ts imports useNetworkQuality and qualityToAudioBitrate
// ═══════════════════════════════════════════════════════════════════════════════
describe('CHANGE-001 (VCLUB-LB-002/022) — useLiveKit.ts imports network quality helpers', () => {
  test('useLiveKit.ts exists and is non-empty', () => {
    expect(livekitSrc.length).toBeGreaterThan(0);
  });

  test('useLiveKit.ts imports useNetworkQuality from useNetworkQuality hook', () => {
    expect(livekitSrc).toMatch(/useNetworkQuality/);
    expect(livekitSrc).toMatch(/from\s+['"]@\/hooks\/useNetworkQuality['"]/);
  });

  test('useLiveKit.ts imports qualityToAudioBitrate', () => {
    expect(livekitSrc).toMatch(/qualityToAudioBitrate/);
  });

  test('useLiveKit.ts imports ConnectionQuality from livekit-client', () => {
    expect(livekitSrc).toMatch(/ConnectionQuality/);
    expect(livekitSrc).toMatch(/from\s+['"]livekit-client['"]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CHANGE-001 — useLiveKit.ts adapts audio bitrate via RTCRtpSender (FEAT-002)
//
//    FEAT-002 replaced the broken setTrackPublishDefaults() call (which does not
//    exist in livekit-client 2.5.4) with RTCRtpSender.setParameters(), accessed
//    via the LocalTrack.sender getter that IS present in 2.5.4.  These tests
//    verify the new (correct) implementation; the old setTrackPublishDefaults
//    tests are removed because that API is intentionally gone.
// ═══════════════════════════════════════════════════════════════════════════════
describe('CHANGE-001 (VCLUB-LB-002/022) — useLiveKit.ts adapts audio bitrate on quality change', () => {
  test('useLiveKit.ts does NOT call setTrackPublishDefaults (FEAT-002: broken API removed)', () => {
    // setTrackPublishDefaults does not exist in livekit-client 2.5.4 and was
    // replaced by RTCRtpSender.setParameters() in FEAT-002.
    expect(livekitSrc).not.toMatch(/localParticipant\.setTrackPublishDefaults/);
  });

  test('useLiveKit.ts uses RTCRtpSender.setParameters() for bitrate adaptation (FEAT-002)', () => {
    // The new implementation reads sender.getParameters(), mutates maxBitrate,
    // and calls sender.setParameters() — all on the LocalTrack.sender getter.
    expect(livekitSrc).toMatch(/sender\.getParameters\(\)/);
    expect(livekitSrc).toMatch(/sender\.setParameters\(/);
    expect(livekitSrc).toMatch(/maxBitrate/);
  });

  test('useLiveKit.ts guards RTCRtpSender path: returns silently if sender is null/undefined', () => {
    // Guard: if (!sender) return  — no throw, no console.error
    expect(livekitSrc).toMatch(/if\s*\(!\s*sender\)\s*return/);
  });

  test('useLiveKit.ts iterates audioTrackPublications to find the mic publication', () => {
    // The new implementation iterates the Map to find Track.Source.Microphone
    expect(livekitSrc).toMatch(/audioTrackPublications/);
  });

  test('useLiveKit.ts calls qualityToAudioBitrate(quality) to compute the new bitrate', () => {
    expect(livekitSrc).toMatch(/qualityToAudioBitrate\s*\(\s*quality\s*\)/);
  });

  test('useLiveKit.ts has a useEffect that depends on [quality]', () => {
    // The effect's dependency array must list quality
    expect(livekitSrc).toMatch(/\},\s*\[quality\]/);
  });

  test('useLiveKit.ts guards the bitrate update with ConnectionState.Connected check', () => {
    expect(livekitSrc).toMatch(/ConnectionState\.Connected/);
  });

  test('useLiveKit.ts listens for RoomEvent.ConnectionQualityChanged', () => {
    expect(livekitSrc).toMatch(/RoomEvent\.ConnectionQualityChanged/);
  });

  test('useLiveKit.ts exposes connectionQuality in its return object', () => {
    expect(livekitSrc).toMatch(/connectionQuality/);
    // Verify it is included in the return statement
    const returnIdx = livekitSrc.lastIndexOf('return {');
    const returnBlock = livekitSrc.slice(returnIdx, returnIdx + 500);
    expect(returnBlock).toMatch(/connectionQuality/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. CHANGE-001 — qualityToAudioBitrate maps quality tiers correctly
//    (unit test of the already-existing function in useNetworkQuality.ts)
// ═══════════════════════════════════════════════════════════════════════════════
describe('CHANGE-001 (VCLUB-LB-002/022) — qualityToAudioBitrate returns correct bitrates', () => {
  // Extract qualityToAudioBitrate from source via regex to avoid TS/ESM issues
  // in the Jest environment. Parse the switch table directly from source text.
  function extractBitrateMap(src) {
    const map = {};
    const caseRe = /case\s+'(\w+)'\s*:\s*return\s+([\d_]+)/g;
    let m;
    while ((m = caseRe.exec(src)) !== null) {
      // Strip numeric separators (e.g. 96_000 → 96000)
      map[m[1]] = parseInt(m[2].replace(/_/g, ''), 10);
    }
    return map;
  }

  test('useNetworkQuality.ts exists and exports qualityToAudioBitrate', () => {
    expect(netQualSrc.length).toBeGreaterThan(0);
    expect(netQualSrc).toMatch(/qualityToAudioBitrate/);
  });

  test('qualityToAudioBitrate maps excellent → 96000, good → 64000, fair → 32000', () => {
    const map = extractBitrateMap(netQualSrc);
    expect(map['excellent']).toBe(96000);
    expect(map['good']).toBe(64000);
    expect(map['fair']).toBe(32000);
  });

  test('qualityToAudioBitrate maps poor and offline to a reduced bitrate (≤ 24000)', () => {
    const map = extractBitrateMap(netQualSrc);
    expect(map['poor']).toBeLessThanOrEqual(24000);
    expect(map['offline']).toBeLessThanOrEqual(24000);
  });

  test('web quality tier ordering is monotone decreasing (excellent > good > fair > poor)', () => {
    // R-004 FIX: the previous test claimed "web and mobile use the same quality tier ordering"
    // but only read the frontend file, and the web 'good' value (64 000) differs from the
    // mobile 'good' value (72 000). The ordering IS the same across both platforms, but the
    // values are not identical. This test now only asserts what it actually checks: that the
    // web bitrate map is strictly monotone decreasing across tiers — not cross-platform value parity.
    const map = extractBitrateMap(netQualSrc);
    expect(map['excellent']).toBeGreaterThan(map['good']);
    expect(map['good']).toBeGreaterThan(map['fair']);
    expect(map['fair']).toBeGreaterThan(map['poor']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. CHANGE-002 — app.js pingTimeout and pingInterval are tuned for rural links
// ═══════════════════════════════════════════════════════════════════════════════
describe('CHANGE-002 (VCLUB-LB-023) — app.js Socket.IO ping settings for rural/high-latency links', () => {
  test('app.js exists and is non-empty', () => {
    expect(appSrc.length).toBeGreaterThan(0);
  });

  test('app.js Socket.IO Server constructor contains pingTimeout: 60000', () => {
    // Match pingTimeout set to 60000 (possibly with surrounding whitespace)
    expect(appSrc).toMatch(/pingTimeout\s*:\s*60000/);
  });

  test('app.js Socket.IO Server constructor contains pingInterval: 25000', () => {
    expect(appSrc).toMatch(/pingInterval\s*:\s*25000/);
  });

  test('pingTimeout (60000) is greater than the Socket.IO default (20000)', () => {
    // Match only the property assignment line (not the comment which also contains a number)
    const match = appSrc.match(/^\s*pingTimeout\s*:\s*(\d+)/m);
    expect(match).not.toBeNull();
    const value = parseInt(match[1], 10);
    expect(value).toBeGreaterThan(20000);
  });

  test('pingTimeout and pingInterval are inside the new Server() options block', () => {
    // Verify both settings appear within the Server constructor block
    const serverIdx = appSrc.indexOf('new Server(httpServer,');
    expect(serverIdx).toBeGreaterThan(-1);
    // The constructor block ends at the matching });  — take a generous window
    const block = appSrc.slice(serverIdx, serverIdx + 2000);
    expect(block).toMatch(/pingTimeout\s*:\s*60000/);
    expect(block).toMatch(/pingInterval\s*:\s*25000/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. CHANGE-001 (P1-3) — VoiceRoomView shows connection quality indicator
// ═══════════════════════════════════════════════════════════════════════════════
describe('CHANGE-001 (VCLUB-LB-005/P1-3) — VoiceRoomView connection quality indicator', () => {
  test('VoiceRoomView.tsx imports ConnectionQuality from livekit-client', () => {
    expect(voiceViewSrc).toMatch(/ConnectionQuality/);
  });

  test('VoiceRoomView.tsx destructures connectionQuality from useLiveKit', () => {
    // connectionQuality must appear in the useLiveKit destructure block
    const lkIdx = voiceViewSrc.indexOf('useLiveKit(roomId)');
    expect(lkIdx).toBeGreaterThan(-1);
    // Search in the 400 chars before the useLiveKit call (the destructure block)
    const block = voiceViewSrc.slice(Math.max(0, lkIdx - 400), lkIdx + 50);
    expect(block).toMatch(/connectionQuality/);
  });

  test('VoiceRoomView.tsx renders a quality warning element for Poor/Lost quality', () => {
    expect(voiceViewSrc).toMatch(/ConnectionQuality\.Poor/);
    expect(voiceViewSrc).toMatch(/ConnectionQuality\.Lost/);
    // The warning must be inside the JSX (visible element)
    expect(voiceViewSrc).toMatch(/vc-conn-quality-warn/);
  });
});
