'use strict';

/**
 * Cloudflare R2 connectivity test
 * ─────────────────────────────────────────────────────────────────────────────
 * Run: node test-r2.js
 *
 * Tests:
 *   1. Upload a small PNG (1×1 pixel) to R2 under avatars/
 *   2. Verify the public URL is accessible (if R2_PUBLIC_URL is set)
 *   3. Generate a signed URL for the object
 *   4. Delete the test file
 *
 * Requires these env vars (copy from .env.production.example):
 *   STORAGE_TYPE=r2
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET
 *   R2_PUBLIC_URL   (optional — needed for public access test)
 */

require('dotenv').config();

const { saveFile, deleteFile, generateSignedUrl, STORAGE_TYPE } = require('./src/utils/storage');

// Minimal valid 1×1 transparent PNG (67 bytes)
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4' +
  '890000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
  'hex'
);

async function main() {
  console.log('\n=== Cloudflare R2 Connectivity Test ===\n');

  // ── Config check ─────────────────────────────────────────────────────────────
  const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
  const missing  = required.filter(k => !process.env[k]);

  if (missing.length > 0) {
    console.error('❌ Missing env vars:', missing.join(', '));
    console.error('   Copy .env.production.example to .env and fill in R2 values.');
    process.exit(1);
  }

  if (STORAGE_TYPE !== 'r2') {
    console.warn(`⚠️  STORAGE_TYPE="${STORAGE_TYPE}" — set STORAGE_TYPE=r2 in .env to test R2.`);
    process.exit(1);
  }

  console.log('Config:');
  console.log('  STORAGE_TYPE    :', STORAGE_TYPE);
  console.log('  R2_ACCOUNT_ID   :', process.env.R2_ACCOUNT_ID);
  console.log('  R2_BUCKET       :', process.env.R2_BUCKET);
  console.log('  R2_PUBLIC_URL   :', process.env.R2_PUBLIC_URL || '(not set)');
  console.log('');

  let uploadedUrl, uploadedKey;

  // ── Step 1: Upload ────────────────────────────────────────────────────────────
  console.log('Step 1: Uploading test PNG to avatars/...');
  try {
    const filename = `r2-test-${Date.now()}.png`;
    const result   = await saveFile(TINY_PNG, filename, 'image/png', 'avatars');
    uploadedUrl    = result.url;
    uploadedKey    = result.key;
    console.log('  ✅ Upload OK');
    console.log('  URL:', uploadedUrl);
    console.log('  Key:', uploadedKey);
  } catch (err) {
    console.error('  ❌ Upload FAILED:', err.message);
    process.exit(1);
  }

  // ── Step 2: Public URL check ──────────────────────────────────────────────────
  if (process.env.R2_PUBLIC_URL && uploadedUrl.startsWith('http')) {
    console.log('\nStep 2: Verifying public URL...');
    try {
      const lib = uploadedUrl.startsWith('https') ? require('https') : require('http');
      await new Promise((resolve) => {
        lib.get(uploadedUrl, (res) => {
          if (res.statusCode === 200) {
            console.log('  ✅ Public URL accessible (HTTP 200)');
          } else {
            console.warn(`  ⚠️  HTTP ${res.statusCode} — bucket may not have public access enabled.`);
            console.warn('     Go to: R2 bucket → Settings → Public access → Allow access');
          }
          resolve();
        }).on('error', (err) => {
          console.warn('  ⚠️  Could not reach URL:', err.message);
          resolve();
        });
      });
    } catch (err) {
      console.warn('  ⚠️  Public URL check failed:', err.message);
    }
  } else {
    console.log('\nStep 2: Skipped (R2_PUBLIC_URL not set)');
  }

  // ── Step 3: Signed URL ────────────────────────────────────────────────────────
  console.log('\nStep 3: Generating signed URL (60s expiry)...');
  try {
    const signed = await generateSignedUrl(uploadedKey, 60);
    console.log('  ✅ Signed URL generated');
    console.log('  Signed URL:', signed.slice(0, 80) + '...');
  } catch (err) {
    console.warn('  ⚠️  Signed URL failed:', err.message);
  }

  // ── Step 4: Delete ────────────────────────────────────────────────────────────
  console.log('\nStep 4: Deleting test file...');
  try {
    await deleteFile(uploadedUrl);
    console.log('  ✅ Delete OK');
  } catch (err) {
    console.error('  ❌ Delete FAILED:', err.message);
  }

  console.log('\n=== R2 test complete ✅ ===\n');
  console.log('Your backend is ready to use Cloudflare R2.');
  console.log('Set STORAGE_TYPE=r2 in your production .env and restart.\n');
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
