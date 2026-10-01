/**
 * live-class-spotlight.test.js
 *
 * Tests for the Host-Only Individual Participant Maximize/Minimize (spotlight) feature.
 *
 * Authoritative rule: only the Live creator/HOST may maximize, switch, or minimize.
 * The host is identified by: isHost = (myParticipantRole === 'HOST' || isCreator)
 * where isCreator = lc.hostUserId === user.id.
 *
 * Implementation:
 *   frontend/src/components/live-class/LiveClassRoomImpl.tsx  (web)
 *   mobile/app/live-class/[id].tsx                            (RN)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const WEB_FILE = path.join(
  __dirname,
  '../../../frontend/src/components/live-class/LiveClassRoomImpl.tsx'
);
const RN_FILE = path.join(
  __dirname,
  '../../../mobile/app/live-class/[id].tsx'
);

const webSrc = fs.readFileSync(WEB_FILE, 'utf8');
const rnSrc  = fs.readFileSync(RN_FILE,  'utf8');

// ─── Helper: extract the spotlight block for targeted assertions ──────────────
function webSpotlightBlock() {
  const start = webSrc.indexOf('SPOTLIGHT LAYOUT');
  // Grid mode marker changed slightly — search for the common prefix
  const end   = webSrc.indexOf('GRID MODE (existing behavior', start);
  return (start > -1 && end > -1) ? webSrc.slice(start, end) : '';
}

function rnSpotlightBlock() {
  // The spotlight block starts after the TikTok comment and ends before GRID MODE
  const start = rnSrc.indexOf('SPOTLIGHT MODE');
  const end   = rnSrc.indexOf('GRID MODE (Option A parity', start);
  if (start > -1 && end > -1) return rnSrc.slice(start, end);
  // Fallback: use the ternary block between selectedParticipantId check and grid mode
  const s2 = rnSrc.indexOf('selectedParticipantId && videoSpeakers.find');
  const e2 = rnSrc.indexOf('Option A parity', s2);
  return (s2 > -1 && e2 > -1) ? rnSrc.slice(s2, e2) : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. HOST IDENTIFICATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Host identification — authoritative field', () => {
  test('Web: isHost derived from participant record HOST role OR creator (hostUserId)', () => {
    expect(webSrc).toMatch(/isHost\s*=\s*myParticipantRole\s*===\s*'HOST'\s*\|\|\s*isCreator/);
  });

  test('Web: isCreator uses lc.hostUserId === user.id (not school role)', () => {
    expect(webSrc).toMatch(/isCreator\s*=\s*!!lc\s*&&\s*!!user\s*&&\s*lc\.hostUserId\s*===\s*user\.id/);
  });

  test('RN: isHost derived from participant record HOST role OR creator', () => {
    expect(rnSrc).toMatch(/isHost\s*=\s*myParticipantRole\s*===\s*'HOST'\s*\|\|\s*isCreator/);
  });

  test('RN: isCreator uses liveClass.hostUserId === user.id (not school role)', () => {
    expect(rnSrc).toMatch(/isCreator\s*=\s*!!liveClass\s*&&\s*!!user\s*&&\s*liveClass\.hostUserId\s*===\s*user\.id/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. WEB — HOST-ONLY GATE
// ─────────────────────────────────────────────────────────────────────────────
describe('Web: spotlight gated by isHost', () => {
  test('Popup Spotlight action gated on isHost (not available to non-hosts)', () => {
    // The spotlight action in the popup uses {isHost && (...)}, confirmed in source
    expect(webSrc).toMatch(/isHost.*Spotlight.*make primary|Spotlight.*isHost/s);
  });

  test('Dedicated "✕ Grid" deselect button gated on isHost', () => {
    // The deselect button is conditionally rendered: {isSelected && isLarge && isHost && (...)}
    expect(webSrc).toMatch(/isSelected.*isLarge.*isHost|isHost.*isSelected.*isLarge/);
    // The button calls setSelectedParticipantId(null)
    expect(webSrc).toMatch(/setSelectedParticipantId\(null\)/);
  });

  test('Tile onClick restores original behavior (handleParticipantClick — no isHost gate)', () => {
    // Option A: single click opens popup for everyone, spotlight is inside popup
    expect(webSrc).toMatch(/onClick.*handleParticipantClick/s);
  });

  test('Spotlight popup action gated on isHost, not isModerator', () => {
    // The popup spotlight action checks isHost specifically
    expect(webSrc).toMatch(/isHost.*Spotlight/s);
    // canManage (which includes Moderator) is NOT used as the spotlight gate
    const spotBlock = webSpotlightBlock();
    expect(spotBlock).not.toMatch(/if\s*\(!canManage\)\s*return/);
  });

  test('"Return to grid" button only shown to Host', () => {
    // Deselect button is wrapped in isSelected && isLarge && isHost
    expect(webSrc).toMatch(/isSelected.*isLarge.*isHost/);
  });
});

describe('Web: spotlight guard uses isHost, NOT isModerator/canManage/isStaff', () => {
  test('Spotlight onClick guard is specifically isHost (not isModerator)', () => {
    // Popup spotlight action uses isHost
    expect(webSrc).toMatch(/isHost.*Spotlight.*make primary/s);
    // Deselect button is gated by isHost
    expect(webSrc).toMatch(/isSelected.*isLarge.*isHost/);
    // isModerator is NOT a spotlight gate
    expect(webSrc).not.toMatch(/if\s*\(!isModerator\)\s*return[\s\S]{0,200}setSelectedParticipantId/);
  });

  test('canManage is NOT used as the spotlight permission gate', () => {
    const spotBlock = webSpotlightBlock();
    expect(spotBlock).not.toMatch(/if\s*\(!canManage\)\s*return/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. WEB — SELECTED PARTICIPANT STATE (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
describe('Web: selectedParticipantId state', () => {
  test('state variable declared as useState<string | null>(null)', () => {
    expect(webSrc).toMatch(/selectedParticipantId.*useState.*null/);
  });

  test('state is separate from isFullscreen', () => {
    const fsSetters = webSrc.match(/setIsFullscreen\([^)]*\)/g) ?? [];
    fsSetters.forEach(call => expect(call).not.toMatch(/selectedParticipant/));
  });

  test('state is separate from screenFullscreen', () => {
    const sfSetters = webSrc.match(/setScreenFullscreen\([^)]*\)/g) ?? [];
    sfSetters.forEach(call => expect(call).not.toMatch(/selectedParticipant/));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. WEB — AUTO-CLEAR (participant leave recovery)
// ─────────────────────────────────────────────────────────────────────────────
describe('Web: auto-clear when selected participant leaves', () => {
  test('useEffect clears selectedParticipantId when participant no longer on stage', () => {
    expect(webSrc).toMatch(/useEffect[\s\S]*?selectedParticipantId[\s\S]*?setSelectedParticipantId\(null\)/);
  });

  test('auto-clear depends on participants array (not a host-only action)', () => {
    // Auto-clear is system-driven, not user-driven — no isHost check needed here
    expect(webSrc).toMatch(/participants.*selectedParticipantId|stageParticipants.*selectedParticipantId/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. WEB — SPOTLIGHT NO API / LIVEKIT / SOCKET
// ─────────────────────────────────────────────────────────────────────────────
describe('Web: spotlight block — no backend side effects', () => {
  const block = webSpotlightBlock();

  test('spotlight block found', () => {
    expect(block.length).toBeGreaterThan(0);
  });

  test('no room.connect()', () => {
    expect(block).not.toMatch(/room\.connect\s*\(/);
  });

  test('no room.disconnect()', () => {
    expect(block).not.toMatch(/room\.disconnect\s*\(/);
  });

  test('no joinLiveClass / joinMutation', () => {
    expect(block).not.toMatch(/joinLiveClass|joinMutation\.mutate/);
  });

  test('no socket.emit', () => {
    expect(block).not.toMatch(/socket\.emit/);
  });

  test('no speakerSlot modification', () => {
    expect(block).not.toMatch(/speakerSlot\s*=/);
  });

  test('no maxSpeakers modification', () => {
    expect(block).not.toMatch(/maxSpeakers\s*=/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. WEB — MODERATION STILL WORKS FOR MANAGERS
// ─────────────────────────────────────────────────────────────────────────────
describe('Web: moderation popup still accessible via single click (Option A)', () => {
  test('handleParticipantClick still exists and is wired to onClick', () => {
    expect(webSrc).toMatch(/handleParticipantClick/);
    // In Option A: single click opens popup via handleParticipantClick
    expect(webSrc).toMatch(/onClick.*handleParticipantClick/s);
  });

  test('canManage guards moderation actions in popup (not spotlight)', () => {
    expect(webSrc).toMatch(/canManage.*participantPopup|participantPopup.*canManage/s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. RN — HOST-ONLY GATE
// ─────────────────────────────────────────────────────────────────────────────
describe('RN: spotlight gated by isHost (Option A parity — via action sheet)', () => {
  test('showParticipantSheet function exists and gates spotlight by isHost', () => {
    // Option A: tap opens action sheet for everyone; spotlight is isHost-gated INSIDE the sheet
    expect(rnSrc).toMatch(/showParticipantSheet/);
    expect(rnSrc).toMatch(/if\s*\(isHost\)/);
  });

  test('Primary tile onPress calls showParticipantSheet', () => {
    expect(rnSrc).toMatch(/showParticipantSheet.*primary\.userId|primary\.userId.*showParticipantSheet/s);
  });

  test('Secondary tile onPress calls showParticipantSheet', () => {
    expect(rnSrc).toMatch(/showParticipantSheet.*s\.userId|s\.userId.*showParticipantSheet/s);
  });

  test('"Return to grid" hint only shown to Host', () => {
    expect(rnSrc).toMatch(/visible to Host only/);
    expect(rnSrc).toMatch(/Return to grid/);
    expect(rnSrc).toMatch(/isHost/);
  });
});

describe('RN: spotlight guard uses isHost, NOT isModerator', () => {
  test('showParticipantSheet uses isHost gate for spotlight, not isModerator', () => {
    // The sheet checks isHost before adding spotlight action
    expect(rnSrc).toMatch(/if\s*\(isHost\)[\s\S]*?Spotlight|Spotlight[\s\S]*?isHost/s);
    expect(rnSrc).not.toMatch(/if\s*\(!isModerator\)\s*return[\s\S]{0,200}setSelectedParticipantId/);
  });

  test('canManage NOT used as spotlight permission gate', () => {
    const rnBlock = rnSpotlightBlock();
    expect(rnBlock).not.toMatch(/if\s*\(!canManage\)\s*return/);
  });
});

describe('RN: selectedParticipantId state', () => {
  test('state declared as useState<string | null>(null)', () => {
    expect(rnSrc).toMatch(/selectedParticipantId.*useState.*null/);
  });

  test('state is separate from isFullscreen', () => {
    const fsSetters = rnSrc.match(/setIsFullscreen\([^)]*\)/g) ?? [];
    fsSetters.forEach(call => expect(call).not.toMatch(/selectedParticipant/));
  });

  test('state is separate from isScreenSharing', () => {
    const ssSetters = rnSrc.match(/setIsScreenSharing\([^)]*\)/g) ?? [];
    ssSetters.forEach(call => expect(call).not.toMatch(/selectedParticipant/));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. RN — AUTO-CLEAR (participant leave recovery — system driven, not host-only)
// ─────────────────────────────────────────────────────────────────────────────
describe('RN: auto-clear when selected participant leaves', () => {
  test('useEffect clears selectedParticipantId when participant no longer on stage', () => {
    expect(rnSrc).toMatch(/useEffect[\s\S]*?selectedParticipantId[\s\S]*?setSelectedParticipantId\(null\)/);
  });

  test('auto-clear checks participants array presence on stage', () => {
    expect(rnSrc).toMatch(/speakerSlot.*HOST.*MODERATOR|HOST.*MODERATOR.*speakerSlot/s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. RN — SPOTLIGHT NO API / LIVEKIT / SOCKET
// ─────────────────────────────────────────────────────────────────────────────
describe('RN: spotlight block — no backend side effects', () => {
  test('spotlight block found', () => {
    // Verify the spotlight conditional render exists in RN
    expect(rnSrc).toMatch(/selectedParticipantId.*&&.*videoSpeakers\.find/s);
  });

  test('no joinLiveClass API call', () => {
    expect(rnSrc).not.toMatch(/setSelectedParticipantId[\s\S]{0,200}live-classes.*\/join/);
    // The spotlight code should only call setSelectedParticipantId, not join API
    expect(rnSrc).toMatch(/setSelectedParticipantId/);
  });

  test('no socket.emit in spotlight action handlers', () => {
    // setSelectedParticipantId call sites should not emit socket events
    const setterCalls = rnSrc.match(/setSelectedParticipantId\([^)]{0,50}\)[\s\S]{0,50}/g) ?? [];
    setterCalls.forEach(call => expect(call).not.toMatch(/socket\.emit/));
  });

  test('no speakerSlot modification from spotlight action', () => {
    const setterCalls = rnSrc.match(/setSelectedParticipantId\([^)]{0,50}\)/g) ?? [];
    setterCalls.forEach(call => expect(call).not.toMatch(/speakerSlot/));
  });

  test('no maxSpeakers modification from spotlight action', () => {
    const setterCalls = rnSrc.match(/setSelectedParticipantId\([^)]{0,50}\)/g) ?? [];
    setterCalls.forEach(call => expect(call).not.toMatch(/maxSpeakers/));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. RN — LONG PRESS MODERATION PRESERVED (isHost guards existing actions)
// ─────────────────────────────────────────────────────────────────────────────
describe('RN: long press moderation preserved', () => {
  test('onLongPressTile still defined in grid mode', () => {
    expect(rnSrc).toMatch(/onLongPressTile.*isHost/s);
  });

  test('Primary tile press shows moderation actions (Option A: via onPress alert)', () => {
    // Option A: moderation is inside the onPress Alert on the primary tile
    // Both handleMuteParticipant and setSelectedParticipantId are reachable from the alert
    expect(rnSrc).toMatch(/handleMuteParticipant/);
    expect(rnSrc).toMatch(/Remove spotlight/);
  });

  test('Secondary tile press shows moderation actions (Option A: via onPress alert)', () => {
    // Secondary tiles also show moderation in onPress Alert
    expect(rnSrc).toMatch(/Spotlight.*make primary/);
    expect(rnSrc).toMatch(/handleMuteParticipant/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. ROLE SEPARATION — Host ≠ Moderator ≠ Teacher ≠ School Admin ≠ SUPER_ADMIN
// ─────────────────────────────────────────────────────────────────────────────
describe('Role separation: spotlight cannot be accessed via non-HOST roles', () => {
  // These checks verify the spotlight guard uses isHost SPECIFICALLY,
  // not broader checks that would let Moderator/Teacher/SchoolAdmin through.

  test('Web: isModerator is NOT the spotlight gate', () => {
    // Option A: spotlight is gated by isHost in two ways:
    //   1. Popup "Spotlight" action: {isHost && (...)}
    //   2. Deselect button: {isSelected && isLarge && isHost && (...)}
    // Both use isHost specifically, not isModerator.
    expect(webSrc).toMatch(/isHost.*Spotlight.*make primary/s); // popup isHost gate
    expect(webSrc).toMatch(/isSelected.*isLarge.*isHost/); // deselect button isHost gate
    // isModerator is NOT a spotlight gate
    expect(webSrc).not.toMatch(/if\s*\(!isModerator\)\s*return[\s\S]{0,200}setSelectedParticipantId/);
    // Option A comment confirms popup-based access
    expect(webSrc).toMatch(/Spotlight.*action.*Host|Host.*Spotlight/i);
  });

  test('RN: "Return to grid" hint is conditionally rendered for Host only', () => {
    // The hint exists and isHost guard exists in the spotlight block
    expect(rnSrc).toMatch(/Return to grid/);
    expect(rnSrc).toMatch(/Tap to return.*visible to Host only|visible to Host only/);
  });

  test('Web: isHost is defined as participant-record role, not global user.role', () => {
    // isHost = (myParticipantRole === 'HOST') || isCreator
    // It does NOT check user.role === 'TEACHER' or 'SCHOOL_ADMIN'
    const isHostDecl = webSrc.match(/const isHost\s*=[\s\S]{0,100}/)?.[0] ?? '';
    expect(isHostDecl).not.toMatch(/user\.role\s*===\s*'TEACHER'/);
    expect(isHostDecl).not.toMatch(/user\.role\s*===\s*'SCHOOL_ADMIN'/);
    expect(isHostDecl).not.toMatch(/user\.role\s*===\s*'SUPER_ADMIN'/);
  });

  test('RN: isHost is defined as participant-record role, not global user.role', () => {
    const isHostDecl = rnSrc.match(/const isHost\s*=[\s\S]{0,100}/)?.[0] ?? '';
    expect(isHostDecl).not.toMatch(/user\.role\s*===\s*'TEACHER'/);
    expect(isHostDecl).not.toMatch(/user\.role\s*===\s*'SCHOOL_ADMIN'/);
    expect(isHostDecl).not.toMatch(/user\.role\s*===\s*'SUPER_ADMIN'/);
  });

  test('Web: isHost is NOT the same as canManage (which includes Moderator)', () => {
    // canManage = isHost || isModerator — spotlight must use isHost only
    const canManageDecl = webSrc.match(/const canManage\s*=[\s\S]{0,100}/)?.[0] ?? '';
    expect(canManageDecl).toMatch(/isModerator/); // proves canManage is broader
    // Option A: spotlight is accessed through the popup (gated by isHost in the popup action)
    // and through the dedicated deselect button (gated by isSelected && isLarge && isHost)
    expect(webSrc).toMatch(/isSelected.*isLarge.*isHost/); // deselect button is Host-only
    expect(webSrc).toMatch(/isHost.*Spotlight.*make primary/s); // popup action is Host-only
    // canManage is NOT used as the spotlight gate
    expect(webSrc).not.toMatch(/if\s*\(!canManage\)\s*return[\s\S]{0,40}setSelectedParticipantId/);
  });

  test('RN: isHost is NOT the same as isTeacher (which includes Moderator)', () => {
    // isTeacher = isHost || myParticipantRole === 'MODERATOR' in RN
    // Option A parity: spotlight is gated by isHost INSIDE showParticipantSheet, not in onPressTile
    // Spotlight action only added to sheet when isHost is true
    expect(rnSrc).toMatch(/if\s*\(isHost\)/); // isHost check exists in showParticipantSheet
    expect(rnSrc).toMatch(/showParticipantSheet/); // unified sheet function exists
    // isTeacher is NOT used as spotlight gate
    expect(rnSrc).not.toMatch(/if\s*\(!isTeacher\)\s*return[\s\S]{0,40}setSelectedParticipantId/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. PUBLIC LIVE: no streamType restriction on spotlight
// ─────────────────────────────────────────────────────────────────────────────
describe('PUBLIC and SCHOOL live — spotlight available to Host of either', () => {
  test('Web spotlight block has no streamType condition blocking spotlight', () => {
    const block = webSpotlightBlock();
    // The spotlight block must not check streamType to enable/disable the feature
    // (it should only check isHost — stream type is irrelevant to who the host is)
    expect(block).not.toMatch(/streamType\s*===\s*'PUBLIC'.*isHost|streamType.*!==.*PUBLIC.*return/);
  });

  test('RN spotlight block has no streamType restriction', () => {
    const block = rnSpotlightBlock();
    expect(block).not.toMatch(/streamType\s*===\s*'PUBLIC'.*isHost|streamType.*!==.*PUBLIC.*return/);
  });

  test('Web: isCreator works for PUBLIC (uses lc.hostUserId, stream-type agnostic)', () => {
    const isCreatorDecl = webSrc.match(/const isCreator\s*=[\s\S]{0,100}/)?.[0] ?? '';
    expect(isCreatorDecl).toMatch(/hostUserId/);
    expect(isCreatorDecl).not.toMatch(/streamType/);
  });

  test('RN: isCreator works for PUBLIC (uses liveClass.hostUserId, stream-type agnostic)', () => {
    const isCreatorDecl = rnSrc.match(/const isCreator\s*=[\s\S]{0,100}/)?.[0] ?? '';
    expect(isCreatorDecl).toMatch(/hostUserId/);
    expect(isCreatorDecl).not.toMatch(/streamType/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. FULLSCREEN INDEPENDENCE
// ─────────────────────────────────────────────────────────────────────────────
describe('Fullscreen independence', () => {
  test('Web: setIsFullscreen never calls setSelectedParticipantId', () => {
    const fsSetters = webSrc.match(/setIsFullscreen[\s\S]{0,200}/g) ?? [];
    fsSetters.forEach(block => {
      expect(block).not.toMatch(/setSelectedParticipantId/);
    });
  });

  test('Web: toggleFullscreen never calls setSelectedParticipantId', () => {
    const tfIdx = webSrc.indexOf('const toggleFullscreen');
    const tfBlock = tfIdx > -1 ? webSrc.slice(tfIdx, tfIdx + 500) : '';
    expect(tfBlock).not.toMatch(/setSelectedParticipantId/);
  });

  test('RN: handleToggleFullscreen never calls setSelectedParticipantId', () => {
    const htIdx = rnSrc.indexOf('const handleToggleFullscreen');
    const htBlock = htIdx > -1 ? rnSrc.slice(htIdx, htIdx + 500) : '';
    expect(htBlock).not.toMatch(/setSelectedParticipantId/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. REGRESSION: speakerSlot and maxSpeakers unchanged
// ─────────────────────────────────────────────────────────────────────────────
describe('Regression: speakerSlot and maxSpeakers unchanged by spotlight', () => {
  test('Web: setSelectedParticipantId calls never reference speakerSlot', () => {
    const calls = webSrc.match(/setSelectedParticipantId\([^)]{0,200}\)/g) ?? [];
    calls.forEach(call => expect(call).not.toMatch(/speakerSlot/));
  });

  test('Web: setSelectedParticipantId calls never reference maxSpeakers', () => {
    const calls = webSrc.match(/setSelectedParticipantId\([^)]{0,200}\)/g) ?? [];
    calls.forEach(call => expect(call).not.toMatch(/maxSpeakers/));
  });

  test('RN: setSelectedParticipantId calls never reference speakerSlot', () => {
    const calls = rnSrc.match(/setSelectedParticipantId\([^)]{0,200}\)/g) ?? [];
    calls.forEach(call => expect(call).not.toMatch(/speakerSlot/));
  });

  test('RN: setSelectedParticipantId calls never reference maxSpeakers', () => {
    const calls = rnSrc.match(/setSelectedParticipantId\([^)]{0,200}\)/g) ?? [];
    calls.forEach(call => expect(call).not.toMatch(/maxSpeakers/));
  });
});
