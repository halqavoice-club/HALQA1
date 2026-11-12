'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Exact mirror of the non-self-referential Unit B-6 canonical artifact list.
// This module reads and hashes artifacts only; it cannot execute SQL.
const EXPECTED_MANIFEST = Object.freeze({
  files: Object.freeze([
    Object.freeze({ name: 'mysql-8.4-full-baseline-candidate.sql', sha256: '7DD691DB8F1A892FB39D380D7ECC28CAE3B5869D884CF24424A67EA35969DD7D', size: 166022 }),
    Object.freeze({ name: 'historical-fulltext-index-supplement.sql', sha256: '3F5646FEB312225F8B2671E916BBEA454177EE950D2177985959BB031117082D', size: 733 }),
    Object.freeze({ name: 'custom-sql-supplement.sql', sha256: '0B62331259F8B57E48341E19797E51541E04F49AEE6D8BFAA5127F147237484C', size: 2866 }),
    Object.freeze({ name: 'custom-sql-objects.json', sha256: '75143D542833AEACB224F8A995A701B0400CB6C3F9D9EB095AC326E3E42D6CA5', size: 2402 }),
    Object.freeze({ name: 'migration-object-ledger.json', sha256: '88F2E3BEF7D2F79B52974390A41D4003B05FD96A98C754A95FA05F193E6E1863', size: 419292 }),
    Object.freeze({ name: 'parity-object-ledger.json', sha256: 'F4D58DC767D213600E83A1727A5DC56DCA5B2E98F4DEDC2A28C4AD878760279B', size: 1275443 }),
    Object.freeze({ name: 'validate-offline.js', sha256: 'FEDB0FFB83FE62E4C48AB0511062D9484AA612A08FC707902CB5FC7646D7C35A', size: 30416 }),
    Object.freeze({ name: 'validate-offline-negative-tests.js', sha256: '7A519F92F5014B7D6F19CB3391796504F943B9C5502BE330D99B9096F139654A', size: 3024 }),
  ]),
  artifactSetIdentity: 'F2402ED222C452BFCACB6D8D3F8D6FEB5C64A10D791DC22AD2B145D331391F2A',
  executionOrder: Object.freeze([
    'mysql-8.4-full-baseline-candidate.sql',
    'historical-fulltext-index-supplement.sql',
    'custom-sql-supplement.sql',
  ]),
});

function detectPathTraversal(candidate) {
  if (typeof candidate !== 'string' || !candidate || candidate.includes('\0')) {
    throw new Error('Artifact path must be a non-empty string without NUL bytes');
  }
  if (candidate.split(/[\\/]+/).includes('..')) throw new Error(`Path traversal detected: ${candidate}`);
}

function detectSymlink(filePath) {
  const stats = fs.lstatSync(filePath);
  if (stats.isSymbolicLink()) throw new Error(`Symlink detected: ${filePath}`);
  const parent = path.dirname(filePath);
  if (fs.realpathSync(parent) !== path.resolve(parent)) throw new Error(`Junction or reparse-point parent detected: ${parent}`);
}

function computeFileSHA256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function computeArtifactSetIdentity(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    if (!file || typeof file.name !== 'string') throw new Error('Canonical artifact entry requires a name');
    const bytes = file.bytes || (file.path ? fs.readFileSync(file.path) : null);
    if (!Buffer.isBuffer(bytes)) throw new Error(`Canonical artifact entry requires raw bytes: ${file.name}`);
    hash.update(Buffer.from(file.name + '\n', 'utf8'));
    hash.update(bytes);
    hash.update(Buffer.from('\n', 'utf8'));
  }
  return hash.digest('hex').toUpperCase();
}

function validateArtifactOrder(files, executionOrder = EXPECTED_MANIFEST.executionOrder) {
  const required = ['mysql-8.4-full-baseline-candidate.sql', 'historical-fulltext-index-supplement.sql', 'custom-sql-supplement.sql'];
  if (!Array.isArray(executionOrder) || executionOrder.length !== 3 || executionOrder.some((name, i) => name !== required[i])) {
    throw new Error(`Invalid SQL execution order: ${Array.isArray(executionOrder) ? executionOrder.join(' -> ') : '(invalid)'}`);
  }
  const names = new Set(files.map(file => file.name));
  for (const name of required) if (!names.has(name)) throw new Error(`Missing expected artifact: ${name}`);
  return true;
}

function verifyArtifactSet(directoryPath, expectedManifest = EXPECTED_MANIFEST) {
  detectPathTraversal(directoryPath);
  const directory = path.resolve(directoryPath);
  const dirStats = fs.lstatSync(directory);
  if (!dirStats.isDirectory() || dirStats.isSymbolicLink()) throw new Error('Artifact directory must be a real directory');
  if (!expectedManifest || !Array.isArray(expectedManifest.files) || expectedManifest.files.length !== 8) {
    throw new Error('Expected manifest must bind all 8 canonical Unit B-6 files');
  }
  const verifiedFiles = expectedManifest.files.map((expected, index) => {
    if (!/^[A-Za-z0-9._-]+$/.test(expected.name)) throw new Error(`Malformed artifact filename: ${expected.name}`);
    const filePath = path.join(directory, expected.name);
    if (!fs.existsSync(filePath)) throw new Error(`Missing expected artifact: ${expected.name}`);
    detectSymlink(filePath);
    const before = fs.statSync(filePath);
    const bytes = fs.readFileSync(filePath);
    const after = fs.statSync(filePath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`Artifact changed during inspection: ${expected.name}`);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
    if (sha256 !== expected.sha256) throw new Error(`Hash mismatch for ${expected.name}. Expected: ${expected.sha256}, Actual: ${sha256}`);
    if (bytes.length !== expected.size) throw new Error(`Size mismatch for ${expected.name}. Expected: ${expected.size}, Actual: ${bytes.length}`);
    return { name: expected.name, path: filePath, bytes, hash: sha256, size: bytes.length, order: index + 1 };
  });
  validateArtifactOrder(verifiedFiles, expectedManifest.executionOrder);
  const artifactSetIdentity = computeArtifactSetIdentity(verifiedFiles);
  if (artifactSetIdentity !== expectedManifest.artifactSetIdentity) {
    throw new Error(`Artifact-set identity mismatch. Expected: ${expectedManifest.artifactSetIdentity}, Actual: ${artifactSetIdentity}`);
  }
  return { verified: true, files: verifiedFiles.map(({ bytes, ...file }) => file), artifactSetIdentity, executionOrder: [...expectedManifest.executionOrder] };
}

function rejectManifestMismatch(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Manifest mismatch detected');
  throw new Error('rejectManifestMismatch must only be called for mismatched manifests');
}

module.exports = { verifyArtifactSet, computeArtifactSetIdentity, computeFileSHA256, validateArtifactOrder, detectPathTraversal, detectSymlink, rejectManifestMismatch, EXPECTED_MANIFEST };
