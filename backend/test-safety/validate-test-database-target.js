'use strict';

/**
 * Pure validation for a caller-supplied destructive-test database target.
 *
 * Reading TEST_DATABASE_URL and invoking this function belongs in a separate
 * CLI adapter. Phase 3A intentionally performs no environment access, database
 * connection, application import, or other side effect.
 */

const DESTRUCTIVE_TEST_AUTHORIZATION =
  'I_ACKNOWLEDGE_DESTRUCTIVE_TEST_DATABASE_OPERATIONS';
const REQUIRED_PROFILE_FIELDS = ['protocol', 'host', 'port', 'databaseName', 'username'];
const FORBIDDEN_USERNAMES = new Set(['root', 'halqa_user']);
const FORBIDDEN_DATABASE_NAMES = new Set(['halqa_db']);

function configurationError(message) {
  const error = new Error(`Unsafe test database target: ${message}`);
  error.code = 'UNSAFE_TEST_DATABASE_TARGET';
  return error;
}

function requirePlainString(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw configurationError(`${label} must be a non-empty, unpadded string`);
  }
  return value;
}

function validateTrustedProfile(trustedProfile) {
  if (!trustedProfile || typeof trustedProfile !== 'object' || Array.isArray(trustedProfile)) {
    throw configurationError('a trusted target profile is required');
  }
  for (const field of REQUIRED_PROFILE_FIELDS) {
    requirePlainString(trustedProfile[field], `trustedProfile.${field}`);
  }
  if (trustedProfile.protocol !== 'mysql:') {
    throw configurationError('trustedProfile.protocol must be exactly "mysql:"');
  }
  if (
    !/^\d+$/.test(trustedProfile.port) ||
    Number(trustedProfile.port) < 1 ||
    Number(trustedProfile.port) > 65535
  ) {
    throw configurationError('trustedProfile.port must be an explicit valid port');
  }
  if (
    /[%/?#@\\\s]/.test(trustedProfile.host) ||
    /[%/?#@\\\s]/.test(trustedProfile.databaseName) ||
    /[%/?#@:\\\s]/.test(trustedProfile.username)
  ) {
    throw configurationError('the trusted profile contains an ambiguous target identity');
  }
  if (FORBIDDEN_USERNAMES.has(trustedProfile.username.toLowerCase())) {
    throw configurationError('the trusted profile must use a dedicated non-root username');
  }
  if (FORBIDDEN_DATABASE_NAMES.has(trustedProfile.databaseName.toLowerCase())) {
    throw configurationError('the trusted profile must not identify the application database');
  }
}

function parseDatabaseUrl(testDatabaseUrl) {
  requirePlainString(testDatabaseUrl, 'TEST_DATABASE_URL');
  if (/\s|\\/.test(testDatabaseUrl)) {
    throw configurationError('TEST_DATABASE_URL contains ambiguous characters');
  }

  let parsed;
  try {
    parsed = new URL(testDatabaseUrl);
  } catch {
    throw configurationError('TEST_DATABASE_URL is not a valid URL');
  }

  if (parsed.protocol !== 'mysql:') {
    throw configurationError('TEST_DATABASE_URL must use exactly the mysql protocol');
  }
  if (!parsed.hostname || !parsed.port) {
    throw configurationError('TEST_DATABASE_URL must include an exact host and explicit port');
  }
  if (!parsed.username || !parsed.password) {
    throw configurationError('TEST_DATABASE_URL must include a username and password');
  }
  if (parsed.search) {
    throw configurationError('TEST_DATABASE_URL must not contain URL parameters or socket overrides');
  }
  if (parsed.hash) {
    throw configurationError('TEST_DATABASE_URL must not contain a fragment');
  }

  const databaseName = parsed.pathname.slice(1);
  if (
    !databaseName || databaseName.includes('/') || databaseName.includes('%') ||
    parsed.username.includes('%') || parsed.hostname.includes('%')
  ) {
    throw configurationError('TEST_DATABASE_URL contains an ambiguous encoded target identity');
  }
  if (FORBIDDEN_USERNAMES.has(parsed.username.toLowerCase())) {
    throw configurationError('TEST_DATABASE_URL must not use the root database identity');
  }
  if (FORBIDDEN_DATABASE_NAMES.has(databaseName.toLowerCase())) {
    throw configurationError('TEST_DATABASE_URL must not identify the application database');
  }

  return Object.freeze({
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    databaseName,
    username: parsed.username,
  });
}

function validateTestDatabaseTarget({ testDatabaseUrl, trustedProfile, authorization } = {}) {
  if (authorization !== DESTRUCTIVE_TEST_AUTHORIZATION) {
    throw configurationError('explicit destructive-test authorization is required');
  }
  validateTrustedProfile(trustedProfile);
  const target = parseDatabaseUrl(testDatabaseUrl);
  const expected = {
    protocol: trustedProfile.protocol,
    hostname: trustedProfile.host,
    port: trustedProfile.port,
    databaseName: trustedProfile.databaseName,
    username: trustedProfile.username,
  };
  for (const field of Object.keys(expected)) {
    if (target[field] !== expected[field]) {
      throw configurationError(`TEST_DATABASE_URL ${field} does not match the trusted profile`);
    }
  }
  return target;
}

module.exports = {
  DESTRUCTIVE_TEST_AUTHORIZATION,
  parseDatabaseUrl,
  validateTestDatabaseTarget,
};
