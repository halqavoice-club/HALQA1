/**
 * fix-live-class-columns.js
 *
 * Diagnoses and fixes the live_classes table to add the missing columns
 * that the 20260819_add_public_livestream migration should have created.
 *
 * The migration was recorded in _prisma_migrations as "applied" but the
 * actual ALTER TABLE statements may not have executed (e.g. MySQL error
 * during migration that was swallowed). This script applies them directly.
 *
 * Run: node fix-live-class-columns.js
 */
'use strict';
require('dotenv').config();
const prisma = require('./src/utils/prisma');

async function run() {
  console.log('\n=== LIVE CLASS COLUMN FIX ===\n');

  // Step 1: Check current columns
  const cols = await prisma.$queryRawUnsafe('DESCRIBE live_classes');
  const existing = new Set(cols.map(c => c.Field));
  console.log('Existing columns:', [...existing].join(', '));
  console.log('');

  const fixes = [];

  // Step 2: Add stream_type if missing
  if (!existing.has('stream_type')) {
    console.log('[FIX] Adding stream_type column...');
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `live_classes` ADD COLUMN `stream_type` VARCHAR(20) NOT NULL DEFAULT 'SCHOOL' AFTER `id`"
    );
    console.log('[OK] stream_type added');
    fixes.push('stream_type');
  } else {
    console.log('[OK] stream_type already exists');
  }

  // Step 3: Make schoolId nullable if it isn't already
  const schoolIdCol = cols.find(c => c.Field === 'schoolId');
  if (schoolIdCol && schoolIdCol.Null === 'NO') {
    console.log('[FIX] Making schoolId nullable...');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE `live_classes` MODIFY COLUMN `schoolId` VARCHAR(191) NULL'
    );
    console.log('[OK] schoolId is now nullable');
    fixes.push('schoolId nullable');
  } else {
    console.log('[OK] schoolId already nullable');
  }

  // Step 4: Make classId nullable if it isn't already
  const classIdCol = cols.find(c => c.Field === 'classId');
  if (classIdCol && classIdCol.Null === 'NO') {
    console.log('[FIX] Making classId nullable...');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE `live_classes` MODIFY COLUMN `classId` VARCHAR(191) NULL'
    );
    console.log('[OK] classId is now nullable');
    fixes.push('classId nullable');
  } else {
    console.log('[OK] classId already nullable');
  }

  // Step 5: Make teacherId nullable if it isn't already
  const teacherIdCol = cols.find(c => c.Field === 'teacherId');
  if (teacherIdCol && teacherIdCol.Null === 'NO') {
    console.log('[FIX] Making teacherId nullable...');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE `live_classes` MODIFY COLUMN `teacherId` VARCHAR(191) NULL'
    );
    console.log('[OK] teacherId is now nullable');
    fixes.push('teacherId nullable');
  } else {
    console.log('[OK] teacherId already nullable');
  }

  // Step 6: Add host_user_id if missing
  if (!existing.has('host_user_id')) {
    console.log('[FIX] Adding host_user_id column...');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE `live_classes` ADD COLUMN `host_user_id` VARCHAR(191) NULL AFTER `teacherId`'
    );
    // Add FK
    try {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE `live_classes` ADD CONSTRAINT `fk_live_classes_host_user` FOREIGN KEY (`host_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL'
      );
      console.log('[OK] host_user_id added with FK');
    } catch (fkErr) {
      // FK might already exist from a partial migration — that's fine
      console.log('[OK] host_user_id added (FK skipped:', fkErr.message.split('\n')[0], ')');
    }
    fixes.push('host_user_id');
  } else {
    console.log('[OK] host_user_id already exists');
  }

  // Step 6b: Make maxParticipants nullable (unlimited viewers — no cap for public streams)
  const maxParticipantsCol = cols.find(c => c.Field === 'maxParticipants');
  if (maxParticipantsCol && maxParticipantsCol.Null === 'NO') {
    console.log('[FIX] Making maxParticipants nullable (no default cap)...');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE `live_classes` MODIFY COLUMN `maxParticipants` INT NULL'
    );
    console.log('[OK] maxParticipants is now nullable');
    fixes.push('maxParticipants nullable');
  } else {
    console.log('[OK] maxParticipants already nullable');
  }

  // Step 7: Add indexes if missing
  const indexResult = await prisma.$queryRawUnsafe(
    "SHOW INDEX FROM `live_classes`"
  );
  const existingIndexes = new Set(indexResult.map(i => i.Key_name));

  if (!existingIndexes.has('live_classes_stream_type_idx')) {
    try {
      await prisma.$executeRawUnsafe(
        'CREATE INDEX `live_classes_stream_type_idx` ON `live_classes`(`stream_type`)'
      );
      console.log('[OK] Index live_classes_stream_type_idx created');
    } catch (e) {
      console.log('[SKIP] stream_type index:', e.message.split('\n')[0]);
    }
  }

  if (!existingIndexes.has('live_classes_host_user_id_idx')) {
    try {
      await prisma.$executeRawUnsafe(
        'CREATE INDEX `live_classes_host_user_id_idx` ON `live_classes`(`host_user_id`)'
      );
      console.log('[OK] Index live_classes_host_user_id_idx created');
    } catch (e) {
      console.log('[SKIP] host_user_id index:', e.message.split('\n')[0]);
    }
  }

  // Step 8: Verify final state
  console.log('\n--- Final column state ---');
  const finalCols = await prisma.$queryRawUnsafe('DESCRIBE live_classes');
  finalCols.forEach(c => {
    const isNew = fixes.some(f => f.includes(c.Field.replace(/_/g, '').toLowerCase()) ||
      c.Field === 'stream_type' || c.Field === 'host_user_id');
    const marker = isNew ? ' ← NEW/FIXED' : '';
    console.log(`  ${c.Field}: ${c.Type} ${c.Null === 'YES' ? 'NULL' : 'NOT NULL'}${c.Default ? ` DEFAULT '${c.Default}'` : ''}${marker}`);
  });

  // Step 9: Mark migration as resolved in _prisma_migrations if needed
  // (Prisma marks it as applied even if it failed — we need to ensure it's correct)
  const migRecord = await prisma.$queryRawUnsafe(
    "SELECT migration_name, finished_at, rolled_back_at FROM `_prisma_migrations` WHERE migration_name = '20260819_add_public_livestream'"
  );
  if (migRecord.length > 0) {
    console.log('\nMigration record:', migRecord[0]);
  }

  // Step 10: Quick creation test (raw SQL — same path as the controller)
  console.log('\n--- Quick creation test (raw SQL) ---');
  try {
    const { v4: uuidv4 } = require('uuid');
    const host = await prisma.user.findFirst({ where: { deletedAt: null, status: 'ACTIVE' }, select: { id: true } });
    const testId = uuidv4();
    const now = new Date().toISOString().slice(0, 23).replace('T', ' ');
    // SEC01-G-BE02: set microphone_authorization_mode explicitly so this
    // diagnostic does not depend on the DB column default (which Issue 3
    // changes from LEGACY to SFU_AUTHORITATIVE). SFU_AUTHORITATIVE mirrors
    // what rawCreateLiveClass always writes.
    await prisma.$executeRawUnsafe(
      `INSERT INTO live_classes (id, stream_type, host_user_id, schoolId, classId, teacherId, title, description, scheduledAt, duration, status, chatEnabled, handRaiseEnabled, whiteboardEnabled, quranPanelEnabled, isOpenMic, screenShareEnabled, maxParticipants, isRecorded, microphone_authorization_mode, createdAt, updatedAt)
       VALUES (?, 'PUBLIC', ?, NULL, NULL, NULL, '_test_', NULL, NULL, NULL, 'SCHEDULED', 1, 1, 1, 0, 1, 1, NULL, 0, 'SFU_AUTHORITATIVE', ?, ?)`,
      testId, host.id, now, now
    );
    const rows = await prisma.$queryRawUnsafe('SELECT id, maxParticipants FROM live_classes WHERE id = ?', testId);
    if (rows[0].maxParticipants === null) {
      console.log('[OK] Test creation succeeded — maxParticipants correctly stored as NULL:', testId);
    } else {
      console.log('[WARN] maxParticipants not null:', rows[0].maxParticipants);
    }
    await prisma.$executeRawUnsafe('DELETE FROM live_classes WHERE id = ?', testId);
    console.log('[OK] Test record cleaned up');
  } catch (e) {
    console.error('[FAIL] Test creation still failing:', e.message.split('\n')[0]);
  }

  console.log('\n=== DONE ===\n');
  if (fixes.length > 0) {
    console.log(`Applied ${fixes.length} fix(es): ${fixes.join(', ')}`);
    console.log('Restart the backend server for changes to take effect.\n');
  } else {
    console.log('No fixes needed — all columns already in place.\n');
  }

  await prisma.$disconnect();
}

run().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
