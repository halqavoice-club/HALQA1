'use strict';
/**
 * scripts/encrypt-account-details.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-time migration script: encrypts any plaintext payout_requests.account_details
 * rows using AES-256-GCM (the same algorithm used by payout.controller.js).
 *
 * Run ONCE after deploying the economy consolidation but BEFORE accepting new
 * payout requests in production.
 *
 * IDEMPOTENT: Already-encrypted rows are skipped. Running this script twice
 * is safe and will not double-encrypt.
 *
 * ROLLBACK: Run with --decrypt flag to reverse the encryption (emergency use).
 *
 * Usage:
 *   node scripts/encrypt-account-details.js           # dry-run (preview only)
 *   node scripts/encrypt-account-details.js --apply   # apply encryption
 *   node scripts/encrypt-account-details.js --decrypt --apply  # EMERGENCY: decrypt back
 *
 * Prerequisites:
 *   - PAYOUT_ENCRYPTION_KEY must be set in your environment (32+ bytes)
 *   - DATABASE_URL must be set in your environment
 *   - Run from the backend/ directory OR from the project root
 *
 * Example:
 *   cd backend
 *   PAYOUT_ENCRYPTION_KEY=your-32-byte-key node ../scripts/encrypt-account-details.js --apply
 */

const path  = require('path');
const apply   = process.argv.includes('--apply');
const decrypt = process.argv.includes('--decrypt');

// ─── Load encryption utility ──────────────────────────────────────────────────
// Try backend/src/utils/encryption.js relative to this script's location
let encryptionUtil;
try {
  encryptionUtil = require(path.join(__dirname, '..', 'backend', 'src', 'utils', 'encryption'));
} catch {
  // If running from backend/ directory
  try {
    encryptionUtil = require(path.join(__dirname, '..', 'src', 'utils', 'encryption'));
  } catch (err) {
    console.error('[encrypt-account-details] Cannot find encryption.js. Run from project root or backend/.');
    console.error(err.message);
    process.exit(1);
  }
}
const { encrypt, decrypt: decryptFn, isEncrypted } = encryptionUtil;

// ─── Load Prisma client ────────────────────────────────────────────────────────
let prisma;
try {
  prisma = require(path.join(__dirname, '..', 'backend', 'src', 'utils', 'prisma'));
} catch {
  try {
    prisma = require(path.join(__dirname, '..', 'src', 'utils', 'prisma'));
  } catch (err) {
    console.error('[encrypt-account-details] Cannot find prisma client. Run from project root or backend/.');
    process.exit(1);
  }
}

// ─── Validate environment ─────────────────────────────────────────────────────
if (!process.env.PAYOUT_ENCRYPTION_KEY) {
  console.error('[encrypt-account-details] PAYOUT_ENCRYPTION_KEY is not set. Aborting.');
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Payout Account Details Encryption Migration');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(` Mode:   ${decrypt ? 'DECRYPT (emergency rollback)' : 'ENCRYPT'}`);
  console.log(` Dry run: ${!apply ? 'YES — no changes will be written' : 'NO  — changes WILL be applied'}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!apply) {
    console.log('⚠️  DRY RUN MODE. Add --apply to write changes.\n');
  }

  // Fetch all payout requests
  const all = await prisma.payoutRequest.findMany({
    select: { id: true, accountDetails: true, createdAt: true }
  });

  console.log(`Found ${all.length} payout request(s) total.\n`);

  let skipped   = 0;
  let processed = 0;
  let errors    = 0;

  for (const record of all) {
    const raw = record.accountDetails;

    if (!raw || raw.trim() === '{}' || raw.trim() === '') {
      console.log(`  SKIP  [${record.id.slice(0, 8)}…] — empty accountDetails`);
      skipped++;
      continue;
    }

    if (!decrypt && isEncrypted(raw)) {
      console.log(`  SKIP  [${record.id.slice(0, 8)}…] — already encrypted`);
      skipped++;
      continue;
    }

    if (decrypt && !isEncrypted(raw)) {
      console.log(`  SKIP  [${record.id.slice(0, 8)}…] — not encrypted (plaintext already)`);
      skipped++;
      continue;
    }

    try {
      let newValue;
      if (decrypt) {
        // Decrypt back to plaintext JSON (emergency rollback)
        newValue = decryptFn(raw);
        // Verify it's valid JSON before writing back
        JSON.parse(newValue);
      } else {
        // Encrypt plaintext JSON
        // Verify it's valid JSON first
        JSON.parse(raw);
        newValue = encrypt(raw);
      }

      const action = decrypt ? 'DECRYPT' : 'ENCRYPT';
      console.log(`  ${apply ? action : 'WOULD ' + action}  [${record.id.slice(0, 8)}…] — created ${record.createdAt.toISOString().slice(0, 10)}`);

      if (apply) {
        await prisma.payoutRequest.update({
          where: { id: record.id },
          data:  { accountDetails: newValue }
        });
      }
      processed++;
    } catch (err) {
      console.error(`  ERROR [${record.id.slice(0, 8)}…] — ${err.message}`);
      errors++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(` Results:`);
  console.log(`   Processed : ${processed}`);
  console.log(`   Skipped   : ${skipped}`);
  console.log(`   Errors    : ${errors}`);
  if (!apply) {
    console.log('\n  No changes written (dry run). Re-run with --apply to commit.');
  } else if (errors === 0) {
    console.log('\n  ✅ Migration completed successfully.');
  } else {
    console.log('\n  ⚠️  Migration completed with errors. Review output above.');
    process.exit(1);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[encrypt-account-details] Fatal error:', err.message);
  process.exit(1);
});
