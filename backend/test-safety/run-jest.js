'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SAFE_UNIT_TESTS, DESTRUCTIVE_TESTS } = require('./safe-test-manifest');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const UNIT_CONFIG = path.join(BACKEND_ROOT, 'jest.unit.config.js');
const SAFE_INHERITED_ENV = Object.freeze([
  'PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'ComSpec', 'TEMP', 'TMP',
  'LOCALAPPDATA', 'APPDATA', 'HOME', 'USERPROFILE', 'CI', 'TZ', 'LANG',
  'FORCE_COLOR', 'NO_COLOR',
]);
const GROUPS = Object.freeze({
  social: /social|post|feed|comment|reaction|follow|friend|explore|story|report|community-socket|phase[3-7]|task[26]|bug-005|sprint11/i,
  voice: /voice|ph19|ph24c|pk\.test|vc-sync|sprint12|sprint17|sprint18|sprint19/i,
  'live-class': /live-class|livekit|maxspeakers|public-stream|ph24a|sprint14|sprint16/i,
  auth: /super-admin|architecture|p[0-3]-security|erp-remediation|school-auth|school-membership|platform-admin|phase24j|idempotency|health|rateLimiter|session|privilege|ui-separation|auth\.test|sprint[7-9]|sprint10|graphql|validation|encryption|internal-provisioning|phase2|phase4b|payout|wallet|gift|economy|creator|stripe/i,
  realtime: /socket-auth-vuln|alerting|cache|circuitBreaker|tracing|db-hardening|production-hardening|apiVersion|errors/i,
});

function safetyError(message) {
  const error = new Error(`Safe Jest launcher rejected the request: ${message}`);
  error.code = 'UNSAFE_JEST_REQUEST';
  return error;
}

function normalizeTestPath(file) {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.includes('..') || path.isAbsolute(file)) {
    throw safetyError('test paths must be backend-relative without traversal');
  }
  return normalized;
}

function discoverTestFiles(rootDir = BACKEND_ROOT) {
  const testsRoot = path.join(rootDir, 'src', 'tests');
  const found = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.test.js')) {
        found.push(path.relative(rootDir, absolute).replace(/\\/g, '/'));
      }
    }
  }
  visit(testsRoot);
  return found.sort();
}

function auditClassification(existingTestFiles) {
  const safe = new Set(SAFE_UNIT_TESTS);
  const destructive = new Set(DESTRUCTIVE_TESTS);
  const overlap = [...safe].filter((file) => destructive.has(file));
  if (overlap.length) throw safetyError(`multiply classified test: ${overlap[0]}`);

  const existing = new Set(existingTestFiles.map(normalizeTestPath));
  const unclassified = [...existing].filter((file) => !safe.has(file) && !destructive.has(file));
  if (unclassified.length) throw safetyError(`unclassified test file: ${unclassified[0]}`);

  const missing = [...safe, ...destructive].filter((file) => !existing.has(file));
  if (missing.length) throw safetyError(`classified test file is missing: ${missing[0]}`);
  return Object.freeze({ safeCount: safe.size, destructiveCount: destructive.size });
}

function sanitizeEnvironment(inheritedEnv = {}) {
  const childEnv = {};
  for (const allowedName of SAFE_INHERITED_ENV) {
    const actualName = Object.keys(inheritedEnv).find(
      (name) => name.toLowerCase() === allowedName.toLowerCase()
    );
    if (actualName && inheritedEnv[actualName] !== undefined) {
      childEnv[allowedName] = inheritedEnv[actualName];
    }
  }
  childEnv.NODE_ENV = 'test';
  childEnv.HALQA_TEST_MODE = 'unit';
  return childEnv;
}

function parseArguments(args) {
  let group = null;
  let coverage = false;
  let listTests = false;
  const requestedTests = [];

  for (const arg of args) {
    if (arg === '--coverage') coverage = true;
    else if (arg === '--list-tests') listTests = true;
    else if (arg === '--mode=unit') continue;
    else if (arg.startsWith('--mode=')) {
      throw safetyError('integration and destructive modes are disabled in Phase 3B-1');
    } else if (arg.startsWith('--group=')) {
      const requestedGroup = arg.slice('--group='.length);
      if (!GROUPS[requestedGroup]) throw safetyError(`unknown unit-test group: ${requestedGroup}`);
      if (group) throw safetyError('only one unit-test group may be selected');
      group = requestedGroup;
    } else if (arg.startsWith('-')) {
      throw safetyError(`unrecognized or unsafe Jest option: ${arg}`);
    } else {
      requestedTests.push(normalizeTestPath(arg));
    }
  }
  if (group && requestedTests.length) {
    throw safetyError('a group and explicit test paths cannot be combined');
  }
  return { group, coverage, listTests, requestedTests };
}

function buildLaunchPlan({ args = [], inheritedEnv = {}, existingTestFiles } = {}) {
  const discovered = existingTestFiles || discoverTestFiles();
  auditClassification(discovered);
  const parsed = parseArguments(args);
  const safe = new Set(SAFE_UNIT_TESTS);
  const destructive = new Set(DESTRUCTIVE_TESTS);

  for (const file of parsed.requestedTests) {
    if (destructive.has(file)) throw safetyError(`destructive test execution is disabled: ${file}`);
    if (!safe.has(file)) throw safetyError(`test path is not approved for unit mode: ${file}`);
  }

  let selectedTests = parsed.requestedTests.length ? parsed.requestedTests : [...SAFE_UNIT_TESTS];
  if (parsed.group) selectedTests = selectedTests.filter((file) => GROUPS[parsed.group].test(file));
  if (!selectedTests.length) throw safetyError('no approved unit tests were selected');

  const jestArgs = [
    '--config', UNIT_CONFIG,
    '--runInBand',
    '--runTestsByPath',
    ...selectedTests,
  ];
  if (parsed.coverage) jestArgs.splice(4, 0, '--coverage');
  if (parsed.listTests) jestArgs.splice(4, 0, '--listTests');

  return Object.freeze({
    mode: 'unit',
    configPath: UNIT_CONFIG,
    selectedTests: Object.freeze(selectedTests),
    jestArgs: Object.freeze(jestArgs),
    childEnv: Object.freeze(sanitizeEnvironment(inheritedEnv)),
    // Execution metadata used by run() to decide whether the full suite should
    // be split into bounded batches (see FULL_SUITE_BATCH_SIZE).
    group: parsed.group,
    listTests: parsed.listTests,
    coverage: parsed.coverage,
    requestedTests: Object.freeze(parsed.requestedTests),
  });
}

// Full-suite runs accumulate heap across the entire safe-unit inventory inside
// one --runInBand process and exhaust memory (verified: the suite OOMs even at
// Node's ~4.3 GB default heap, and a 40-file mixed batch OOMs at the 3072 cap).
// The suite is therefore partitioned by the existing group regexes (each group
// run already completes within the heap cap) with first-match assignment so
// every test runs exactly once, then each partition is capped so no single Jest
// process accumulates enough heap to OOM. Only the no-argument full-suite path
// is batched; group runs, explicit test paths, --listTests and --coverage keep
// the single-process path (--coverage must run in one process to produce a
// combined report; --listTests is a metadata query).
// Group partitions are each a subset of a group run that already completes
// within the heap cap (verified via --group=<name>), so they are capped at 30
// (well within their proven full-group size). The residual partition (tests
// matching no group, including the memory-heavy stage-2 crypto suites) is
// capped smaller so its heaviest cluster never approaches the heap limit.
const FULL_SUITE_GROUP_BATCH_SIZE = 30;
const FULL_SUITE_RESIDUAL_BATCH_SIZE = 5;

function spawnJest(spawn, jestBin, jestArgs, childEnv) {
  const result = spawn(
    process.execPath,
    ['--max-old-space-size=3072', jestBin, ...jestArgs],
    { cwd: BACKEND_ROOT, env: childEnv, stdio: 'inherit', windowsHide: true },
  );
  if (result.error) throw safetyError(`Jest could not start: ${result.error.message}`);
  return Number.isInteger(result.status) ? result.status : 1;
}

// Partition the full safe-unit inventory by group regex (first match wins) and
// cap each partition. Group partitions are subsets of group runs that already
// complete within the heap cap, so the bounded batches inherit that memory
// profile; tests matching no group form a residual partition that is capped
// smaller (its stage-2 crypto cluster is memory-heavy). Returns an ordered list
// of disjoint test-path batches.
function buildFullSuiteBatches(selectedTests) {
  const assigned = new Set();
  const partitions = [];
  for (const groupName of Object.keys(GROUPS)) {
    const re = GROUPS[groupName];
    const part = selectedTests.filter((t) => !assigned.has(t) && re.test(t));
    part.forEach((t) => assigned.add(t));
    if (part.length) partitions.push({ tests: part, cap: FULL_SUITE_GROUP_BATCH_SIZE });
  }
  const residual = selectedTests.filter((t) => !assigned.has(t));
  if (residual.length) partitions.push({ tests: residual, cap: FULL_SUITE_RESIDUAL_BATCH_SIZE });

  const batches = [];
  for (const { tests, cap } of partitions) {
    for (let i = 0; i < tests.length; i += cap) {
      batches.push(tests.slice(i, i + cap));
    }
  }
  return batches;
}

function run({ args = process.argv.slice(2), inheritedEnv = process.env, spawn = spawnSync } = {}) {
  if (!fs.existsSync(UNIT_CONFIG)) throw safetyError('approved unit Jest configuration is missing');
  const jestBin = require.resolve('jest/bin/jest');
  const plan = buildLaunchPlan({ args, inheritedEnv });

  const fullSuite =
    !plan.group && plan.requestedTests.length === 0 && !plan.listTests && !plan.coverage;

  if (!fullSuite) {
    return spawnJest(spawn, jestBin, plan.jestArgs, plan.childEnv);
  }

  // Bounded full-suite execution: run the partitioned batches sequentially so
  // each Jest process is fresh and stays well under the heap cap. Every approved
  // test still runs exactly once; the batch boundary only resets the Jest
  // process. A non-zero batch status is preserved so real test failures still
  // surface (this only prevents the heap-exhaustion crash, exit 134).
  const batches = buildFullSuiteBatches(plan.selectedTests);
  let finalStatus = 0;
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    process.stderr.write(
      `\n[run-jest] full-suite batch ${b + 1}/${batches.length} — ${batch.length} file(s)\n`,
    );
    const batchArgs = ['--config', UNIT_CONFIG, '--runInBand', '--runTestsByPath', ...batch];
    const status = spawnJest(spawn, jestBin, batchArgs, plan.childEnv);
    if (status !== 0 && finalStatus === 0) finalStatus = status;
  }
  return finalStatus;
}

if (require.main === module) {
  try {
    process.exitCode = run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  SAFE_INHERITED_ENV,
  auditClassification,
  buildLaunchPlan,
  buildFullSuiteBatches,
  discoverTestFiles,
  normalizeTestPath,
  parseArguments,
  run,
  sanitizeEnvironment,
};
