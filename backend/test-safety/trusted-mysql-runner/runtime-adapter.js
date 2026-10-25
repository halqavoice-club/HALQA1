'use strict';

const crypto = require('crypto');
const imagePolicy = require('./mysql-image-policy');
const accountPolicy = require('./account-policy');
const { sanitizeEnvironment } = require('./secret-environment');

const ARTIFACT_SET_ID = 'F2402ED222C452BFCACB6D8D3F8D6FEB5C64A10D791DC22AD2B145D331391F2A';
const ALLOWED_STEPS = new Set(['OBSERVE_IDENTITY', 'VERIFY_ACCOUNTS', 'SNAPSHOT_ARTIFACTS', 'TEARDOWN']);
const SAFE_ENV = new Set(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'COMSPEC', 'WINDIR', 'NODE_ENV']);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

function createIsolatedSubprocessEnvironment(inherited = {}, additions = {}) {
  const sanitized = sanitizeEnvironment(inherited);
  const result = {};
  for (const [key, value] of Object.entries(sanitized)) if (SAFE_ENV.has(key)) result[key] = String(value);
  for (const [key, value] of Object.entries(additions)) {
    if (!SAFE_ENV.has(key)) throw new Error(`Subprocess environment variable is not allowlisted: ${key}`);
    result[key] = String(value);
  }
  return Object.freeze(result);
}

function validateObservedIdentity(container, mysql, expected) {
  const requiredContainer = ['containerId', 'imageDigest', 'platform', 'networkId', 'networkName', 'endpointHost', 'endpointPort', 'internalPort'];
  const requiredMysql = ['serverUuid', 'version', 'hostname', 'endpointHost', 'endpointPort'];
  for (const field of requiredContainer) if (!container || !container[field]) throw new Error(`Missing container observation: ${field}`);
  for (const field of requiredMysql) if (!mysql || !mysql[field]) throw new Error(`Missing MySQL observation: ${field}`);
  if (container.endpointHost !== mysql.endpointHost || String(container.endpointPort) !== String(mysql.endpointPort)) throw new Error('Container and MySQL endpoint observations conflict');
  if (container.containerId !== expected.containerId || container.networkId !== expected.networkId) throw new Error('Observed runtime identity does not match runner-owned provisioning record');
  if (mysql.hostname !== container.containerId.slice(0, 12) && !mysql.hostname.startsWith(container.containerId.slice(0, 12))) throw new Error('Observed MySQL hostname does not bind to container identity');
  if (!/^8\.4(?:\.|$)/.test(mysql.version)) throw new Error('Observed server is not MySQL 8.4');
  if (!/^[a-f0-9-]{36}$/i.test(mysql.serverUuid)) throw new Error('Observed MySQL server UUID is malformed');
  imagePolicy.validatePlatform(container.platform);
  imagePolicy.validateImageReference(`mysql@${container.imageDigest}`, container.platform);
  const identity = { container, mysql, artifactSetIdentity: ARTIFACT_SET_ID };
  return { identity, identityDigest: `sha256:${crypto.createHash('sha256').update(canonical(identity)).digest('hex')}` };
}

function createStepAuthority({ key, store, runId, identityDigest }) {
  if (!Buffer.isBuffer(key) || key.length < 32) throw new Error('Step authority key must be at least 32 bytes');
  if (!store || typeof store.consumeNonce !== 'function') throw new Error('Durable authority store is required');
  function executeAuthorizedStep(step, operation) {
    if (!ALLOWED_STEPS.has(step)) throw new Error(`Unauthorized runtime step: ${step}`);
    if (typeof operation !== 'function') throw new Error('Authorized step operation must be a function');
    const nonce = crypto.randomBytes(16).toString('hex');
    const issuedAt = new Date().toISOString();
    const payload = { runId, identityDigest, step, nonce, issuedAt };
    const mac = crypto.createHmac('sha256', key).update(canonical(payload)).digest('hex');
    const expected = crypto.createHmac('sha256', key).update(canonical(payload)).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'))) throw new Error('Internal step authorization failed');
    store.consumeNonce(runId, nonce, step);
    return operation(Object.freeze({ ...payload, mac: '[REDACTED]' }));
  }
  return Object.freeze({ executeAuthorizedStep });
}

function createTrustedRuntimeAdapter({ containerRuntime, mysqlObserver, authorityStore, authorityKey, runId }) {
  if (!containerRuntime || typeof containerRuntime.inspect !== 'function' || typeof containerRuntime.listOwned !== 'function' || typeof containerRuntime.teardown !== 'function') throw new Error('Trusted container runtime interface is incomplete');
  if (!mysqlObserver || typeof mysqlObserver.observe !== 'function') throw new Error('Trusted MySQL observation interface is incomplete');
  async function attest(provisioningRecord) {
    const container = await containerRuntime.inspect(provisioningRecord.containerId);
    const mysql = await mysqlObserver.observe({ host: container.endpointHost, port: container.endpointPort });
    const verified = validateObservedIdentity(container, mysql, provisioningRecord);
    authorityStore.registerRun(runId, verified.identityDigest);
    return Object.freeze({ ...verified, stepAuthority: createStepAuthority({ key: authorityKey, store: authorityStore, runId, identityDigest: verified.identityDigest }) });
  }
  async function detectOrphans(activeRunIds) {
    const owned = await containerRuntime.listOwned();
    const active = new Set(activeRunIds);
    return owned.filter(item => !active.has(item.runId)).map(item => Object.freeze({ runId: item.runId, containerId: item.containerId, action: 'TEARDOWN_REQUIRED' }));
  }
  async function teardown(record) {
    authorityStore.revokeRun(record.runId, 'teardown');
    await containerRuntime.teardown(record.containerId);
    return true;
  }
  return Object.freeze({ attest, detectOrphans, teardown, createIsolatedSubprocessEnvironment });
}

function validateAccountLifecycle({ bootstrapGrants, migratorGrants, readerGrants, schema, bootstrapRevoked }) {
  accountPolicy.validateBootstrapPrivileges(bootstrapGrants);
  accountPolicy.validateMigratorPrivileges(migratorGrants, schema);
  accountPolicy.validateReaderPrivileges(readerGrants, schema);
  if (bootstrapRevoked !== true) throw new Error('Bootstrap revocation has not been observed');
  return true;
}

module.exports = { ARTIFACT_SET_ID, createIsolatedSubprocessEnvironment, validateObservedIdentity, createStepAuthority, createTrustedRuntimeAdapter, validateAccountLifecycle };
