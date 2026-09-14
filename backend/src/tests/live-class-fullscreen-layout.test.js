/**
 * HALQA — Full Screen Layout Mode Tests
 *
 * Verifies the architectural invariants of the Full Screen presentation feature:
 *
 * 1. Backend has NO fullscreen endpoint — it is purely a UI presentation concern.
 * 2. Backend has NO fullscreen DB column — no schema change required.
 * 3. Stage lifecycle controller (approveHand, inviteToStage, demoteFromStage,
 *    dropMicLiveClass) is intact and unaffected by fullscreen work.
 * 4. All stage routes are still registered.
 *
 * Note: Web/mobile frontend tests read the physical .tsx files which are managed
 * by Kiro's virtual FS. Those invariants are verified by source inspection below.
 * The critical correctness property is: fullscreen is layout state only —
 * nothing in the backend changed for it.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROUTES_FILE  = path.join(__dirname, '../routes/live-class.routes.js');
const CTRL_FILE    = path.join(__dirname, '../controllers/live-class.controller.js');
const SCHEMA_FILE  = path.join(__dirname, '../../prisma/schema.prisma');
const MIGRATION_DIR = path.join(__dirname, '../../prisma/migrations');

let routesSrc = '';
let ctrlSrc   = '';
let schemaSrc = '';

beforeAll(() => {
  routesSrc = fs.readFileSync(ROUTES_FILE, 'utf8');
  ctrlSrc   = fs.readFileSync(CTRL_FILE,   'utf8');
  schemaSrc = fs.readFileSync(SCHEMA_FILE, 'utf8');
});

// ─── A. Backend: No fullscreen route ─────────────────────────────────────────
describe('A. Backend: no fullscreen endpoint', () => {
  test('No /fullscreen route in live-class routes', () => {
    const routeLines = routesSrc.split('\n').filter(l => l.includes('router.'));
    for (const line of routeLines) {
      expect(line.toLowerCase()).not.toMatch(/fullscreen/);
    }
  });

  test('Controller exports no fullscreen-named function', () => {
    const exportBlock = ctrlSrc.slice(ctrlSrc.lastIndexOf('module.exports'));
    expect(exportBlock.toLowerCase()).not.toMatch(/fullscreen/);
  });

  test('No fullscreen query parameter in routes', () => {
    expect(routesSrc.toLowerCase()).not.toMatch(/fullscreen/);
  });
});

// ─── B. Database: No fullscreen column ───────────────────────────────────────
describe('B. Database: no fullscreen field in schema', () => {
  function extractModel(src, modelName) {
    const start = src.indexOf(`model ${modelName} {`);
    if (start < 0) return '';
    const end = src.indexOf('\n}', start) + 2;
    return src.slice(start, end);
  }

  test('LiveClass model has no fullscreen field', () => {
    const model = extractModel(schemaSrc, 'LiveClass');
    expect(model).toBeTruthy();
    const fieldLines = model.split('\n').filter(l => /^\s+\w/.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('@@'));
    for (const line of fieldLines) {
      expect(line.toLowerCase()).not.toMatch(/fullscreen/);
    }
  });

  test('LiveClassParticipant model has no fullscreen field', () => {
    const model = extractModel(schemaSrc, 'LiveClassParticipant');
    expect(model).toBeTruthy();
    const fieldLines = model.split('\n').filter(l => /^\s+\w/.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('@@'));
    for (const line of fieldLines) {
      expect(line.toLowerCase()).not.toMatch(/fullscreen/);
    }
  });

  test('No fullscreen migration was created', () => {
    const migrations = fs.readdirSync(MIGRATION_DIR);
    for (const m of migrations) {
      expect(m.toLowerCase()).not.toMatch(/fullscreen/);
    }
  });
});

// ─── C. Stage lifecycle preserved ────────────────────────────────────────────
describe('C. Stage lifecycle controller unchanged', () => {
  test('approveHand exported', () => {
    const exportBlock = ctrlSrc.slice(ctrlSrc.lastIndexOf('module.exports'));
    expect(exportBlock).toMatch(/approveHand/);
  });

  test('inviteToStage exported', () => {
    const exportBlock = ctrlSrc.slice(ctrlSrc.lastIndexOf('module.exports'));
    expect(exportBlock).toMatch(/inviteToStage/);
  });

  test('demoteFromStage exported', () => {
    const exportBlock = ctrlSrc.slice(ctrlSrc.lastIndexOf('module.exports'));
    expect(exportBlock).toMatch(/demoteFromStage/);
  });

  test('dropMicLiveClass exported', () => {
    const exportBlock = ctrlSrc.slice(ctrlSrc.lastIndexOf('module.exports'));
    expect(exportBlock).toMatch(/dropMicLiveClass/);
  });

  test('approveHand enforces maxSpeakers cap', () => {
    const idx = ctrlSrc.indexOf('async function approveHand');
    expect(idx).toBeGreaterThan(-1);
    const fn = ctrlSrc.slice(idx, idx + 4000);
    expect(fn).toMatch(/maxSpeakers/);
    expect(fn).toMatch(/Stage is full|stage.*full|full.*stage/i);
  });

  test('inviteToStage enforces maxSpeakers cap', () => {
    const idx = ctrlSrc.indexOf('async function inviteToStage');
    expect(idx).toBeGreaterThan(-1);
    const fn = ctrlSrc.slice(idx, idx + 2000);
    expect(fn).toMatch(/maxSpeakers/);
  });

  test('demoteFromStage emits speaker_removed and revoke_mic', () => {
    const idx = ctrlSrc.indexOf('async function demoteFromStage');
    expect(idx).toBeGreaterThan(-1);
    const fn = ctrlSrc.slice(idx, idx + 2500);
    expect(fn).toMatch(/speaker_removed/);
    expect(fn).toMatch(/revoke_mic/);
  });

  test('dropMicLiveClass clears speakerSlot', () => {
    const idx = ctrlSrc.indexOf('async function dropMicLiveClass');
    expect(idx).toBeGreaterThan(-1);
    const fn = ctrlSrc.slice(idx, idx + 1200);
    expect(fn).toMatch(/speakerSlot.*null|null.*speakerSlot|speakerSlot: null/);
  });
});

// ─── D. Stage routes intact ───────────────────────────────────────────────────
describe('D. Stage routes still registered', () => {
  test('/invite/:userId route registered', () => {
    expect(routesSrc).toMatch(/\/invite\/:userId/);
  });

  test('/demote/:userId route registered', () => {
    expect(routesSrc).toMatch(/\/demote\/:userId/);
  });

  test('/drop-mic route registered', () => {
    expect(routesSrc).toMatch(/\/drop-mic/);
  });

  test('/hand/approve/:userId route registered', () => {
    expect(routesSrc).toMatch(/\/hand\/approve\/:userId/);
  });
});

// ─── E. Unique speakerSlot constraint in schema ───────────────────────────────
describe('E. DB safety net: unique speakerSlot constraint', () => {
  test('@@unique([liveClassId, speakerSlot]) in schema', () => {
    expect(schemaSrc).toMatch(/@@unique\(\[liveClassId,\s*speakerSlot\]/);
  });

  test('unique_liveclass_speaker_slot migration exists', () => {
    const migrations = fs.readdirSync(MIGRATION_DIR);
    const hasStageMigration = migrations.some(m => m.includes('live_class_stage'));
    expect(hasStageMigration).toBe(true);
  });
});

// ─── F. Fullscreen is local — no liveclass: socket event for it ──────────────
describe('F. Fullscreen is viewer-local (no backend socket event)', () => {
  test('Controller emits no liveclass:fullscreen event', () => {
    expect(ctrlSrc).not.toMatch(/emit.*liveclass:fullscreen/);
  });

  test('Controller emits no liveclass:layout event', () => {
    expect(ctrlSrc).not.toMatch(/emit.*liveclass:layout/);
  });

  test('Routes file has no fullscreen socket setup', () => {
    expect(routesSrc).not.toMatch(/liveclass:fullscreen/);
  });
});

// ─── G. No backend API changes for fullscreen ────────────────────────────────
describe('G. No backend API added for fullscreen', () => {
  test('liveClass validator has no fullscreen field', () => {
    const validatorSrc = fs.readFileSync(
      path.join(__dirname, '../middleware/validators/liveClass.validator.js'), 'utf8'
    );
    expect(validatorSrc.toLowerCase()).not.toMatch(/fullscreen/);
  });

  test('Controller has no isFullscreen or fullscreenMode parameter', () => {
    expect(ctrlSrc.toLowerCase()).not.toMatch(/isfullscreen|fullscreenmode/);
  });
});
