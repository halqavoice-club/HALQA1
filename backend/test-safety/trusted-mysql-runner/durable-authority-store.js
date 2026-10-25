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
    if (fs.existsSync(statePath)) throw new Error('Authority state already exists; refusing reinitialization');
    const store = new DurableAuthorityStore(statePath, key, { version: 1, revision: 0, runs: {}, consumedNonces: {} });
    store._persist();
    return store;
  }

  static open(statePath, key) {
    assertSafeStatePath(statePath);
    if (!Buffer.isBuffer(key) || key.length < 32) throw new Error('Authority key must be at least 32 bytes');
    if (!fs.existsSync(statePath)) throw new Error('Authority state missing; explicit initialization required');
    const envelope = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!envelope || !envelope.state || !/^[a-f0-9]{64}$/.test(envelope.mac || '')) throw new Error('Authority state envelope malformed');
    const expected = macState(envelope.state, key);
    const actual = Buffer.from(envelope.mac, 'hex');
    const expectedBytes = Buffer.from(expected, 'hex');
    if (actual.length !== expectedBytes.length || !crypto.timingSafeEqual(actual, expectedBytes)) throw new Error('Authority state integrity verification failed');
    if (envelope.state.version !== 1 || !envelope.state.runs || !envelope.state.consumedNonces) throw new Error('Authority state schema unsupported');
    return new DurableAuthorityStore(statePath, key, envelope.state);
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
        fs.closeSync(fd);
        fs.unlinkSync(this.lockPath);
      }
    }
  }

  _persist() {
    const envelope = { state: this.state, mac: macState(this.state, this.key) };
    const tempPath = `${this.statePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    fs.writeFileSync(tempPath, `${canonical(envelope)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(tempPath, this.statePath);
  }

  registerRun(runId, identityDigest, now = new Date()) {
    return this._withLock(() => {
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(runId)) throw new Error('Invalid run ID');
      if (!/^sha256:[a-f0-9]{64}$/.test(identityDigest)) throw new Error('Invalid identity digest');
      if (this.state.runs[runId]) throw new Error('Run already registered');
      this.state.runs[runId] = { identityDigest, status: 'ACTIVE', createdAt: now.toISOString(), updatedAt: now.toISOString() };
      this.state.revision += 1;
      this._persist();
      return { ...this.state.runs[runId] };
    });
  }

  consumeNonce(runId, nonce, step, now = new Date()) {
    return this._withLock(() => {
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
      const run = this.state.runs[runId];
      if (!run) throw new Error('Run is missing');
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
    const run = this.state.runs[runId];
    return run ? { ...run } : null;
  }
}

module.exports = { DurableAuthorityStore };
