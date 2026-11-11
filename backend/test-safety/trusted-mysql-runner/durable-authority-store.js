'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

function macState(state, key) {
  return crypto.createHmac('sha256', key).update(canonical(state)).digest('hex');
}

function assertSafeStatePath(statePath) {
  if (!path.isAbsolute(statePath)) throw new Error('Authority state path must be absolute');
  const parent = path.dirname(statePath);
  const parentStats = fs.lstatSync(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) throw new Error('Authority state parent must be a real directory');
  if (fs.existsSync(statePath) && fs.lstatSync(statePath).isSymbolicLink()) throw new Error('Authority state file cannot be a symlink');
}

/**
 * Read the state file from disk, verify HMAC, and validate schema.
 * Returns the parsed, verified state object.
 * Throws on any corruption, HMAC mismatch, or schema violation.
 */
function readAndVerifyFromDisk(statePath, key) {
  const raw = fs.readFileSync(statePath, 'utf8');
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new Error('Authority state envelope malformed');
  }
  if (!envelope || !envelope.state || !/^[a-f0-9]{64}$/.test(envelope.mac || '')) throw new Error('Authority state envelope malformed');
  const expected = macState(envelope.state, key);
  const actual = Buffer.from(envelope.mac, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  if (actual.length !== expectedBytes.length || !crypto.timingSafeEqual(actual, expectedBytes)) throw new Error('Authority state integrity verification failed');
  if (!envelope.state.runs || !envelope.state.consumedNonces || typeof envelope.state.runs !== 'object' || Array.isArray(envelope.state.runs)) throw new Error('Authority state schema malformed');
  if (envelope.state.version !== 1) throw new Error('Authority state version unsupported');
  return envelope.state;
}

class DurableAuthorityStore {
  constructor(statePath, key, state) {
    this.statePath = statePath;
    this.lockPath = `${statePath}.lock`;
    this.key = Buffer.from(key);
    this.state = state;
  }

  static initialize(statePath, key) {
    assertSafeStatePath(statePath);
    if (!Buffer.isBuffer(key) || key.length < 32) throw new Error('Authority key must be at least 32 bytes');
    // Use O_CREAT|O_EXCL (flag 'wx') for atomic exclusive creation.
    // If two processes race, only one wins; the other gets EEXIST.
    const initialState = { version: 1, revision: 0, runs: {}, consumedNonces: {} };
    const envelope = { state: initialState, mac: macState(initialState, Buffer.from(key)) };
    try {
      fs.writeFileSync(statePath, `${canonical(envelope)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch (err) {
      if (err.code === 'EEXIST') throw new Error('Authority state already exists; refusing reinitialization');
      throw err;
    }
    return new DurableAuthorityStore(statePath, key, initialState);
  }

  static open(statePath, key) {
    assertSafeStatePath(statePath);
    if (!Buffer.isBuffer(key) || key.length < 32) throw new Error('Authority key must be at least 32 bytes');
    if (!fs.existsSync(statePath)) throw new Error('Authority state missing; explicit initialization required');
    const state = readAndVerifyFromDisk(statePath, key);
    return new DurableAuthorityStore(statePath, key, state);
  }

  _withLock(operation) {
    let fd;
    try {
      fd = fs.openSync(this.lockPath, 'wx', 0o600);
      return operation();
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Authority state lock exists; fail-closed recovery required');
      throw error;
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { /* ignore */ }
        try { fs.unlinkSync(this.lockPath); } catch { /* ignore */ }
      }
    }
  }

  _persist() {
    const envelope = { state: this.state, mac: macState(this.state, this.key) };
    const tempPath = `${this.statePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tempPath, `${canonical(envelope)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      fs.renameSync(tempPath, this.statePath);
    } catch (err) {
      // Clean up temp file on failure, then restore in-memory state from last good disk state
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
      // Restore in-memory state to last known-good (before this failed mutation)
      // The caller's mutation is rolled back by re-reading old state from disk
      try {
        this.state = readAndVerifyFromDisk(this.statePath, this.key);
      } catch {
        // If we can't even read the disk, leave state as-is — the caller's error
        // propagates naturally and no partial state is published
      }
      throw err;
    }
  }

  /**
   * Security-critical fresh read: re-read and re-verify the HMAC from disk.
   * Must be called at the start of each mutating _withLock operation to prevent
   * stale in-memory state from overwriting updates made by other processes.
   */
  _freshReadUnderLock() {
    const freshState = readAndVerifyFromDisk(this.statePath, this.key);
    this.state = freshState;
  }

  registerRun(runId, identityDigest, options, now) {
    // Support legacy 3-arg call: registerRun(runId, identityDigest, now)
    // and new 4-arg call: registerRun(runId, identityDigest, options, now)
    let containerId = undefined;
    if (options instanceof Date) {
      now = options;
      options = {};
    } else {
      options = options || {};
      containerId = options.containerId;
    }
    if (!now) now = new Date();

    return this._withLock(() => {
      this._freshReadUnderLock();
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(runId)) throw new Error('Invalid run ID');
      if (!/^sha256:[a-f0-9]{64}$/.test(identityDigest)) throw new Error('Invalid identity digest');
      if (this.state.runs[runId]) throw new Error('Run already registered');
      const runRecord = { identityDigest, status: 'ACTIVE', createdAt: now.toISOString(), updatedAt: now.toISOString() };
      if (containerId !== undefined) runRecord.containerId = containerId;
      this.state.runs[runId] = runRecord;
      this.state.revision += 1;
      this._persist();
      return { ...this.state.runs[runId] };
    });
  }

  consumeNonce(runId, nonce, step, now = new Date()) {
    return this._withLock(() => {
      this._freshReadUnderLock();
      const run = this.state.runs[runId];
      if (!run || run.status !== 'ACTIVE') throw new Error('Run is missing or revoked');
      if (!/^[a-f0-9]{32}$/.test(nonce)) throw new Error('Invalid nonce');
      if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(step)) throw new Error('Invalid authorization step');
      if (this.state.consumedNonces[nonce]) throw new Error('Authorization replay detected');
      this.state.consumedNonces[nonce] = { runId, step, consumedAt: now.toISOString() };
      run.updatedAt = now.toISOString();
      this.state.revision += 1;
      this._persist();
      return true;
    });
  }

  revokeRun(runId, reason, now = new Date()) {
    return this._withLock(() => {
      this._freshReadUnderLock();
      const run = this.state.runs[runId];
      if (!run) throw new Error('Run is missing: unknown run: ' + runId);
      // Idempotent: if already REVOKED, return false without modifying state
      if (run.status === 'REVOKED') return false;
      run.status = 'REVOKED';
      run.revokedAt = now.toISOString();
      run.revocationReason = String(reason || 'unspecified');
      run.updatedAt = now.toISOString();
      this.state.revision += 1;
      this._persist();
      return true;
    });
  }

  getRun(runId) {
    // B-TEST-012/013: check for lock contention before reading
    // B-TEST-015: security-critical fresh read to detect external corruption
    return this._withLock(() => {
      this._freshReadUnderLock();
      const run = this.state.runs[runId];
      return run ? { ...run } : null;
    });
  }

  /**
   * Returns a snapshot of the current in-memory state (after a fresh disk read).
   * Used by cross-process tests (F-01-11, B-TEST-001/002/010) to inspect revision
   * and consumed nonces without exposing the mutable internal state directly.
   */
  getStateSnapshot() {
    return this._withLock(() => {
      this._freshReadUnderLock();
      return JSON.parse(JSON.stringify(this.state));
    });
  }
}

module.exports = { DurableAuthorityStore };
