/**
 * fix-membership-gaps.js
 *
 * Fixes two data issues found by check-db-full.js:
 *
 * 1. PENDING school memberships — approves them to ACTIVE
 *    (these were created by createStudent / createTeacher / createGuardian
 *     which already upserts the membership. The PENDING status means
 *     the admin hasn't confirmed them yet. We auto-approve them here.)
 *
 * 2. Legacy users (role=TEACHER/STUDENT/GUARDIAN/SCHOOL_ADMIN) with no
 *    SchoolMembership — creates the membership from their User.role
 *    + User.schoolId fields so they work with the new auth middleware.
 *
 * Run: node fix-membership-gaps.js
 *
 * Safe to run multiple times — all operations are upserts / conditional updates.
 */
'use strict';
require('dotenv').config();
const prisma = require('./src/utils/prisma');

async function run() {
  console.log('\n=== MEMBERSHIP GAP FIX ===\n');

  // ── 1. Approve PENDING memberships ────────────────────────────────────────
  const pending = await prisma.schoolMembership.findMany({
    where: { status: 'PENDING', deletedAt: null },
    include: { user: { select: { email: true, role: true } }, school: { select: { name: true } } },
  });

  if (pending.length === 0) {
    console.log('[OK] No pending memberships to approve');
  } else {
    console.log(`Found ${pending.length} PENDING membership(s):`);
    for (const m of pending) {
      console.log(`  ${m.user.email} (${m.role}) @ ${m.school.name}`);
    }

    const updated = await prisma.schoolMembership.updateMany({
      where: { status: 'PENDING', deletedAt: null },
      data:  { status: 'ACTIVE' },
    });
    console.log(`[FIX] Approved ${updated.count} membership(s) → ACTIVE`);
  }

  // ── 2. Create missing SchoolMembership for legacy users ────────────────────
  const legacyRoles = ['TEACHER', 'STUDENT', 'GUARDIAN', 'SCHOOL_ADMIN', 'SUPER_ADMIN'];
  const legacyUsers = await prisma.user.findMany({
    where: {
      role: { in: legacyRoles },
      deletedAt: null,
      schoolId: { not: null },
    },
    select: { id: true, email: true, role: true, schoolId: true },
  });

  let created = 0;
  let skipped = 0;

  for (const user of legacyUsers) {
    if (!user.schoolId) { skipped++; continue; }

    // Check if membership already exists
    const existing = await prisma.schoolMembership.findFirst({
      where: { userId: user.id, schoolId: user.schoolId, deletedAt: null },
    });

    if (existing) {
      skipped++;
      continue;
    }

    // Create it
    try {
      await prisma.schoolMembership.create({
        data: {
          userId:   user.id,
          schoolId: user.schoolId,
          role:     user.role,      // copy global role as school role
          status:   'ACTIVE',
          joinedAt: new Date(),
        },
      });
      console.log(`[FIX] Created membership: ${user.email} (${user.role}) → schoolId ${user.schoolId}`);
      created++;
    } catch (e) {
      if (e.code === 'P2002') {
        // unique constraint — already exists (race condition), skip
        skipped++;
      } else {
        console.error(`[ERROR] Could not create membership for ${user.email}:`, e.message);
      }
    }
  }

  console.log(`\n[DONE] Created ${created} membership(s), skipped ${skipped} (already existed)`);

  // ── 3. Verify ─────────────────────────────────────────────────────────────
  const stillPending = await prisma.schoolMembership.count({ where: { status: 'PENDING' } });
  console.log(`\nRemaining PENDING memberships: ${stillPending}`);

  const remainingGap = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as cnt
    FROM users u
    WHERE u.role NOT IN ('SUPER_ADMIN', 'MEMBER')
      AND u.deletedAt IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM school_memberships sm
        WHERE sm.userId = u.id AND sm.status = 'ACTIVE' AND sm.deletedAt IS NULL
      )
  `);
  console.log(`Remaining legacy users without active membership: ${remainingGap[0].cnt}`);

  console.log('\n=== FIX COMPLETE ===\n');
  await prisma.$disconnect();
}

run().catch(e => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
