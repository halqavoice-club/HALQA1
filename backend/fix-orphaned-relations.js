'use strict';
/**
 * Fix orphaned relations — sets teacherId to NULL on records where the
 * referenced Teacher row no longer exists. Avoids deleting live classes
 * or other records that have real data (only the teacher FK is broken).
 *
 * Run once: node fix-orphaned-relations.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  console.log('Scanning for orphaned teacher relations...');
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
  try {
    // 1. teacher_classes with missing teacher → delete the junction row
    const tc = await prisma.$executeRawUnsafe(
      'DELETE tc FROM teacher_classes tc LEFT JOIN teachers t ON tc.teacherId = t.id WHERE t.id IS NULL'
    );
    console.log(`  teacher_classes: deleted ${tc} orphaned rows`);

    // 2. live_classes with missing teacher → soft-delete them (teacher was deleted, class is invalid)
    const lc = await prisma.$executeRawUnsafe(
      `UPDATE live_classes SET deletedAt = NOW() 
       WHERE deletedAt IS NULL 
       AND teacherId NOT IN (SELECT id FROM teachers)`
    );
    console.log(`  live_classes: soft-deleted ${lc} rows with missing teacher`);

    // 3. grades with missing teacher → soft-delete
    const gr = await prisma.$executeRawUnsafe(
      `UPDATE grades SET deletedAt = NOW() 
       WHERE deletedAt IS NULL 
       AND teacherId IS NOT NULL 
       AND teacherId NOT IN (SELECT id FROM teachers)`
    ).catch(() => 0); // grades may not have deletedAt — skip silently
    console.log(`  grades: processed ${gr} orphaned teacher refs`);

    // 4. enrollment with missing student
    const en = await prisma.$executeRawUnsafe(
      'DELETE e FROM enrollments e LEFT JOIN students s ON e.studentId = s.id WHERE s.id IS NULL'
    );
    console.log(`  enrollments: deleted ${en} orphaned rows`);

    // 5. Check voice_participants with missing user
    const vp = await prisma.$executeRawUnsafe(
      'DELETE vp FROM voice_participants vp LEFT JOIN users u ON vp.userId = u.id WHERE u.id IS NULL'
    );
    console.log(`  voice_participants: deleted ${vp} orphaned rows`);

    console.log('Done. All orphaned relations cleaned.');
  } finally {
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
    await prisma.$disconnect();
  }
}

fix().catch(e => { console.error('Error:', e.message); process.exit(1); });
