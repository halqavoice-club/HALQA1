'use strict';

/**
 * Migrate local file records to Cloudflare R2
 * ─────────────────────────────────────────────────────────────────────────────
 * This script:
 *   1. Finds all file_uploads records with local URLs (/uploads/...)
 *   2. Reads each file from disk
 *   3. Uploads it to R2
 *   4. Updates the DB record with the new R2 URL
 *   5. Optionally migrates user avatarUrl and school logoUrl fields
 *
 * Run ONCE after switching STORAGE_TYPE=r2 in production.
 *
 * Usage:
 *   node src/prisma/migrate-to-r2.js
 *   node src/prisma/migrate-to-r2.js --dry-run   (preview only, no changes)
 *
 * Prerequisites:
 *   - STORAGE_TYPE=r2 in .env
 *   - R2 credentials configured
 *   - Local uploads/ folder accessible
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { saveFile, STORAGE_TYPE } = require('../utils/storage');

const prisma  = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isLocalUrl(url) {
  return url && (url.startsWith('/uploads/') || url.startsWith('uploads/'));
}

function localUrlToPath(url) {
  const relative = url.startsWith('/') ? url.slice(1) : url;
  return path.join(process.cwd(), relative);
}

function guessMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png',  '.webp': 'image/webp',
    '.gif': 'image/gif',  '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',  '.aac': 'audio/aac',
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] || 'application/octet-stream';
}

function guessFolder(url) {
  if (url.includes('/avatars/')) return 'avatars';
  if (url.includes('/audio/'))   return 'audio';
  if (url.includes('/logos/'))   return 'logos';
  if (url.includes('/covers/'))  return 'covers';
  if (url.includes('/reports/')) return 'reports';
  return 'uploads';
}

async function migrateUrl(localUrl, label) {
  if (!isLocalUrl(localUrl)) return null; // already a cloud URL or null

  const filePath = localUrlToPath(localUrl);
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠️  File not found on disk: ${filePath} (${label})`);
    return null;
  }

  const buffer   = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  const mimeType = guessMimeType(filename);
  const folder   = guessFolder(localUrl);

  if (DRY_RUN) {
    console.log(`  [dry-run] Would upload: ${localUrl} → ${folder}/${filename}`);
    return `https://DRY_RUN/${folder}/${filename}`;
  }

  const { url } = await saveFile(buffer, filename, mimeType, folder);
  return url;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Halqa R2 Migration Script ===\n');

  if (STORAGE_TYPE !== 'r2') {
    console.error('❌ STORAGE_TYPE is not "r2". Set STORAGE_TYPE=r2 in .env before running.');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('🔍 DRY RUN — no changes will be made\n');
  }

  let totalMigrated = 0;
  let totalSkipped  = 0;
  let totalFailed   = 0;

  // ── 1. file_uploads table ──────────────────────────────────────────────────
  console.log('Step 1: Migrating file_uploads records...');
  const fileUploads = await prisma.fileUpload.findMany({
    where: { url: { startsWith: '/uploads/' } },
    select: { id: true, url: true, filename: true, mimeType: true },
  });

  console.log(`  Found ${fileUploads.length} local file_uploads records`);

  for (const record of fileUploads) {
    try {
      const newUrl = await migrateUrl(record.url, `file_upload:${record.id}`);
      if (!newUrl) { totalSkipped++; continue; }

      if (!DRY_RUN) {
        await prisma.fileUpload.update({
          where: { id: record.id },
          data:  { url: newUrl, storageType: 'r2' },
        });
      }
      console.log(`  ✅ ${record.url} → ${newUrl}`);
      totalMigrated++;
    } catch (err) {
      console.error(`  ❌ Failed for ${record.url}: ${err.message}`);
      totalFailed++;
    }
  }

  // ── 2. users.avatarUrl ─────────────────────────────────────────────────────
  console.log('\nStep 2: Migrating user avatars...');
  const usersWithLocalAvatar = await prisma.user.findMany({
    where: { avatarUrl: { startsWith: '/uploads/' } },
    select: { id: true, avatarUrl: true },
  });

  console.log(`  Found ${usersWithLocalAvatar.length} users with local avatars`);

  for (const user of usersWithLocalAvatar) {
    try {
      const newUrl = await migrateUrl(user.avatarUrl, `user:${user.id}`);
      if (!newUrl) { totalSkipped++; continue; }

      if (!DRY_RUN) {
        await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: newUrl } });
      }
      console.log(`  ✅ user:${user.id} avatar → ${newUrl}`);
      totalMigrated++;
    } catch (err) {
      console.error(`  ❌ Failed for user:${user.id}: ${err.message}`);
      totalFailed++;
    }
  }

  // ── 3. schools.logoUrl ─────────────────────────────────────────────────────
  console.log('\nStep 3: Migrating school logos...');
  const schoolsWithLocalLogo = await prisma.school.findMany({
    where: { logoUrl: { startsWith: '/uploads/' } },
    select: { id: true, logoUrl: true },
  });

  console.log(`  Found ${schoolsWithLocalLogo.length} schools with local logos`);

  for (const school of schoolsWithLocalLogo) {
    try {
      const newUrl = await migrateUrl(school.logoUrl, `school:${school.id}`);
      if (!newUrl) { totalSkipped++; continue; }

      if (!DRY_RUN) {
        await prisma.school.update({ where: { id: school.id }, data: { logoUrl: newUrl } });
      }
      console.log(`  ✅ school:${school.id} logo → ${newUrl}`);
      totalMigrated++;
    } catch (err) {
      console.error(`  ❌ Failed for school:${school.id}: ${err.message}`);
      totalFailed++;
    }
  }

  // ── 4. audio_lessons.audioUrl ──────────────────────────────────────────────
  console.log('\nStep 4: Migrating audio lesson files...');
  const lessonsWithLocalAudio = await prisma.audioLesson.findMany({
    where: { audioUrl: { startsWith: '/uploads/' } },
    select: { id: true, audioUrl: true, filename: true, mimeType: true },
  });

  console.log(`  Found ${lessonsWithLocalAudio.length} audio lessons with local files`);

  for (const lesson of lessonsWithLocalAudio) {
    try {
      const newUrl = await migrateUrl(lesson.audioUrl, `lesson:${lesson.id}`);
      if (!newUrl) { totalSkipped++; continue; }

      if (!DRY_RUN) {
        await prisma.audioLesson.update({ where: { id: lesson.id }, data: { audioUrl: newUrl } });
      }
      console.log(`  ✅ lesson:${lesson.id} → ${newUrl}`);
      totalMigrated++;
    } catch (err) {
      console.error(`  ❌ Failed for lesson:${lesson.id}: ${err.message}`);
      totalFailed++;
    }
  }

  // ── 5. voice_rooms.coverImageUrl ──────────────────────────────────────────
  console.log('\nStep 5: Migrating voice room cover images...');
  const roomsWithLocalCover = await prisma.voiceRoom.findMany({
    where: { coverImageUrl: { startsWith: '/uploads/' } },
    select: { id: true, coverImageUrl: true },
  });

  console.log(`  Found ${roomsWithLocalCover.length} voice rooms with local cover images`);

  for (const room of roomsWithLocalCover) {
    try {
      const newUrl = await migrateUrl(room.coverImageUrl, `room:${room.id}`);
      if (!newUrl) { totalSkipped++; continue; }

      if (!DRY_RUN) {
        await prisma.voiceRoom.update({ where: { id: room.id }, data: { coverImageUrl: newUrl } });
      }
      console.log(`  ✅ room:${room.id} cover → ${newUrl}`);
      totalMigrated++;
    } catch (err) {
      console.error(`  ❌ Failed for room:${room.id}: ${err.message}`);
      totalFailed++;
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n=== Migration Summary ===');
  console.log(`  Migrated : ${totalMigrated}`);
  console.log(`  Skipped  : ${totalSkipped}  (file not found on disk)`);
  console.log(`  Failed   : ${totalFailed}`);

  if (DRY_RUN) {
    console.log('\n  This was a dry run — no changes were made.');
    console.log('  Run without --dry-run to apply.\n');
  } else if (totalFailed === 0) {
    console.log('\n  ✅ Migration complete. You can now remove the local uploads/ folder.\n');
  } else {
    console.log('\n  ⚠️  Some files failed. Check the errors above and re-run.\n');
  }
}

main()
  .catch(err => { console.error('Fatal:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
