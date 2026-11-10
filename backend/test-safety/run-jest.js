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
  });
}

function run({ args = process.argv.slice(2), inheritedEnv = process.env, spawn = spawnSync } = {}) {
  if (!fs.existsSync(UNIT_CONFIG)) throw safetyError('approved unit Jest configuration is missing');
  const jestBin = require.resolve('jest/bin/jest');
  const plan = buildLaunchPlan({ args, inheritedEnv });
  const result = spawn(process.execPath, ['--max-old-space-size=3072', jestBin, ...plan.jestArgs], {
    cwd: BACKEND_ROOT,
    env: plan.childEnv,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw safetyError(`Jest could not start: ${result.error.message}`);
  return Number.isInteger(result.status) ? result.status : 1;
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
  discoverTestFiles,
  normalizeTestPath,
  parseArguments,
  run,
  sanitizeEnvironment,
};
