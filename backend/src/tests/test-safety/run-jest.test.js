'use strict';

const fs = require('fs');
const path = require('path');
const { SAFE_UNIT_TESTS, DESTRUCTIVE_TESTS } = require('../../../test-safety/safe-test-manifest');

const modulesBeforeImport = new Set(Object.keys(require.cache));
const launcher = require('../../../test-safety/run-jest');
const modulesLoadedByImport = Object.keys(require.cache).filter(
  (modulePath) => !modulesBeforeImport.has(modulePath)
);
const allClassified = [...SAFE_UNIT_TESTS, ...DESTRUCTIVE_TESTS];

function plan(args = [], inheritedEnv = {}) {
  return launcher.buildLaunchPlan({ args, inheritedEnv, existingTestFiles: allClassified });
}

describe('Phase 3B-1 guarded Jest launcher', () => {
  test('default mode selects only explicitly approved safe unit tests', () => {
    const result = plan();
    expect(result.mode).toBe('unit');
    expect(result.selectedTests).toEqual(SAFE_UNIT_TESTS);
    expect(result.selectedTests).not.toEqual(expect.arrayContaining(DESTRUCTIVE_TESTS));
  });

  test('launch plan exits naturally without a fixed --forceExit argument', () => {
    const result = plan();

    expect(result.jestArgs).toContain('--runInBand');
    expect(result.jestArgs).toContain('--runTestsByPath');
    expect(result.jestArgs).not.toContain('--forceExit');
  });

  test('rejects caller-supplied --forceExit', () => {
    expect(() => plan(['--forceExit'])).toThrow('unrecognized or unsafe Jest option');
  });

  test('GitHub Actions invokes guarded backend unit scripts without forwarded Jest options', () => {
    const workflowPath = path.resolve(__dirname, '../../../../.github/workflows/ci.yml');
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    const guardedScripts = [
      'test:unit',
      'test:group:social',
      'test:group:voice',
      'test:group:live-class',
      'test:group:auth',
      'test:group:realtime',
    ];

    for (const script of guardedScripts) {
      expect(workflow).toContain(`run: npm run ${script}`);
      expect(workflow).not.toMatch(new RegExp(
        `run:\\s+npm run ${script.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s+--`
      ));
    }
  });

  test.each([
    'mysql://halqa_user:secret@production-db:3306/halqa_db',
    'mysql://root:@localhost:3306/halqa_db',
  ])('removes inherited DATABASE_URL: %s', (DATABASE_URL) => {
    const result = plan([], { PATH: 'safe-path', DATABASE_URL });
    expect(result.childEnv).toEqual(expect.objectContaining({ PATH: 'safe-path' }));
    expect(result.childEnv).not.toHaveProperty('DATABASE_URL');
  });

  test('rejects an unknown test path', () => {
    expect(() => plan(['src/tests/not-reviewed.test.js'])).toThrow('not approved for unit mode');
  });

  test('rejects a destructive test path', () => {
    expect(() => plan(['src/tests/phase-c.test.js'])).toThrow(
      'destructive test execution is disabled'
    );
  });

  test.each(['--config=other.js', '--setupFiles=unsafe.js', '--testPathIgnorePatterns=', '-i'])(
    'rejects unsafe Jest configuration override %s', (argument) => {
      expect(() => plan([argument])).toThrow('unrecognized or unsafe Jest option');
    }
  );

  test('fails closed when classification is missing', () => {
    expect(() => launcher.auditClassification([
      ...allClassified,
      'src/tests/new-unreviewed.test.js',
    ])).toThrow('unclassified test file');
  });

  test.each(['--mode=integration', '--mode=destructive']) (
    'rejects unauthorized integration execution through %s', (argument) => {
      expect(() => plan([argument])).toThrow('destructive modes are disabled');
    }
  );

  test('passes only allowlisted, sanitized values to a mocked child process', () => {
    const childEnv = plan([], {
      PATH: 'safe-path',
      CI: 'true',
      DATABASE_URL: 'mysql://root:secret@prod/halqa_db',
      TEST_DATABASE_URL: 'mysql://test:secret@localhost:3307/halqa_tests',
      REDIS_URL: 'redis://prod',
      LIVEKIT_API_SECRET: 'secret',
      SMTP_PASS: 'secret',
      NODE_OPTIONS: '--require malicious.js',
    }).childEnv;

    expect(childEnv).toEqual({
      PATH: 'safe-path', CI: 'true', NODE_ENV: 'test', HALQA_TEST_MODE: 'unit',
    });
  });

  test('does not connect to a database or load Prisma/application modules during guard tests', () => {
    const newlyLoaded = modulesLoadedByImport.map((modulePath) => modulePath.replace(/\\/g, '/'));
    expect(newlyLoaded.some((modulePath) => /@prisma|\/utils\/prisma|\/src\/app\.js$/.test(modulePath)))
      .toBe(false);
    const source = fs.readFileSync(path.resolve(__dirname, '../../../test-safety/run-jest.js'), 'utf8');
    expect(source).not.toMatch(/PrismaClient|\$connect\s*\(/);
  });

  test('mocked launcher execution does not modify an existing user file', () => {
    const userFile = path.resolve(__dirname, '../../../../package.json');
    const before = fs.readFileSync(userFile);
    const spawn = jest.fn(() => ({ status: 0 }));
    expect(launcher.run({ args: ['--list-tests'], inheritedEnv: {}, spawn })).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(userFile)).toEqual(before);
  });
});

describe('buildFullSuiteBatches', () => {
  const { buildFullSuiteBatches } = launcher;

  // ── (a) No batch exceeds 30 files ───────────────────────────────────────
  test('(a) no batch exceeds 30 files', () => {
    // Use the full real safe-unit inventory — largest real-world input
    const batches = buildFullSuiteBatches([...SAFE_UNIT_TESTS]);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(30);
    }
  });

  // ── (b) Residual batch (tests matching no group) stays ≤ 5 files ────────
  test('(b) residual-only batches are capped at 5 files', () => {
    // Craft an input that matches no group regex so it falls into residual
    const residualOnly = Array.from({ length: 12 }, (_, i) => `src/tests/zzz-no-group-${i}.test.js`);
    const batches = buildFullSuiteBatches(residualOnly);
    // All batches come from the residual partition (cap=5), so none exceed 5
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(5);
    }
    // Verify total coverage
    const allFiles = batches.flat();
    expect(allFiles.sort()).toEqual([...residualOnly].sort());
  });

  // ── (c) Every input file appears in exactly one batch (no silent skipping) ──
  test('(c) every input file appears in exactly one batch — no skipping, no duplicates', () => {
    const input = [...SAFE_UNIT_TESTS];
    const batches = buildFullSuiteBatches(input);
    const allFiles = batches.flat();

    // No file is missing
    expect(allFiles.sort()).toEqual([...input].sort());

    // No file appears more than once
    const seen = new Set();
    for (const file of allFiles) {
      expect(seen.has(file)).toBe(false);
      seen.add(file);
    }
    expect(seen.size).toBe(input.length);
  });

  // ── (d) Empty input returns no batches ────────────────────────────────────
  test('(d) empty input returns an empty batch list', () => {
    const batches = buildFullSuiteBatches([]);
    expect(batches).toEqual([]);
  });

  // ── additional: mixed group + residual correctly partitioned ─────────────
  test('(e) group files and residual files are both present in output', () => {
    // Pick one known voice file and one known auth file plus a residual file
    const voiceFile   = 'src/tests/voice-realtime-sync.test.js';
    const authFile    = 'src/tests/auth.test.js';
    const residual    = 'src/tests/zzz-residual-only.test.js';
    const input       = [voiceFile, authFile, residual];
    const batches     = buildFullSuiteBatches(input);
    const allFiles    = batches.flat();

    expect(allFiles).toContain(voiceFile);
    expect(allFiles).toContain(authFile);
    expect(allFiles).toContain(residual);
    // All files present exactly once
    expect(allFiles.length).toBe(3);
  });
});
