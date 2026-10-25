'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EXPECTED_MANIFEST, computeArtifactSetIdentity } = require('./artifact-integrity');

function createImmutableArtifactSnapshot(sourceDirectory, snapshotDirectory) {
  const source = path.resolve(sourceDirectory);
  const destination = path.resolve(snapshotDirectory);
  if (source === destination || destination.startsWith(`${source}${path.sep}`)) throw new Error('Snapshot directory must be separate from source artifacts');
  if (fs.existsSync(destination)) throw new Error('Snapshot destination already exists');
  const parent = path.dirname(destination);
  if (!fs.lstatSync(parent).isDirectory() || fs.lstatSync(parent).isSymbolicLink()) throw new Error('Snapshot parent must be a real directory');
  fs.mkdirSync(destination, { mode: 0o700 });
  const copied = [];
  try {
    for (const expected of EXPECTED_MANIFEST.files) {
      const sourcePath = path.join(source, expected.name);
      const statsBefore = fs.lstatSync(sourcePath);
      if (!statsBefore.isFile() || statsBefore.isSymbolicLink()) throw new Error(`Unsafe artifact source: ${expected.name}`);
      const bytes = fs.readFileSync(sourcePath);
      const statsAfter = fs.statSync(sourcePath);
      if (statsBefore.size !== statsAfter.size || statsBefore.mtimeMs !== statsAfter.mtimeMs) throw new Error(`Artifact changed during snapshot: ${expected.name}`);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
      if (hash !== expected.sha256 || bytes.length !== expected.size) throw new Error(`Artifact mismatch during snapshot: ${expected.name}`);
      const targetPath = path.join(destination, expected.name);
      fs.writeFileSync(targetPath, bytes, { flag: 'wx', mode: 0o400 });
      copied.push({ name: expected.name, path: targetPath, bytes, hash, size: bytes.length });
    }
    const identity = computeArtifactSetIdentity(copied);
    if (identity !== EXPECTED_MANIFEST.artifactSetIdentity) throw new Error('Snapshot artifact-set identity mismatch');
    for (const file of copied) {
      fs.chmodSync(file.path, 0o400);
      delete file.bytes;
    }
    fs.chmodSync(destination, 0o500);
    return Object.freeze({ artifactSetIdentity: identity, directory: destination, files: Object.freeze(copied.map(Object.freeze)) });
  } catch (error) {
    // Leave partial output fail-closed for explicit recovery; never silently reuse it.
    throw new Error(`Immutable snapshot failed; quarantine or remove the incomplete destination before retry: ${error.message}`);
  }
}

module.exports = { createImmutableArtifactSnapshot };
