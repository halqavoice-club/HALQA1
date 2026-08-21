/**
 * Full database integrity check.
 * Run: node check-db-full.js
 */
'use strict';
require('dotenv').config();
const prisma = require('./src/utils/prisma');

async function run() {
  console.log('\n=== DATABASE FULL INTEGRITY CHECK ===\n');

  let issues = 0;

  // ── 1. Connection ─────────────────────────────────────────────────────────
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    console.log('[OK] Database connection');
  } catch (e) {
    console.error('[FAIL] Cannot connect to database:', e.message);
    process.exit(1);
  }

  // ── 2. live_classes table structure ──────────────────────────────────────
  try {
    const cols = await prisma.$queryRawUnsafe('DESCRIBE live_classes');
    const colMap = {};
    cols.forEach(c => { colMap[c.Field] = c; });

    const required = ['stream_type', 'host_user_id', 'schoolId', 'classId', 'teacherId'];
    const missing = required.filter(f => !colMap[f]);
    if (missing.length > 0) {
      console.error('[FAIL] live_classes missing columns:', missing.join(', '));
      console.error('       Run: npx prisma migrate deploy');
      issues++;
    } else {
      console.log('[OK] live_classes columns — stream_type, host_user_id present');
    }

    // Check nullability
    const shouldBeNullable = ['schoolId', 'classId', 'teacherId', 'host_user_id'];
    const notNullable = shouldBeNullable.filter(f => colMap[f] && colMap[f].Null === 'NO');
    if (notNullable.length > 0) {
      console.error('[FAIL] Columns should be nullable but are NOT NULL:', notNullable.join(', '));
      console.error('       Run: npx prisma migrate deploy');
      issues++;
    } else {
      console.log('[OK] live_classes nullable columns correct');
    }
  } catch (e) {
    console.error('[FAIL] Could not DESCRIBE live_classes:', e.message);
    issues++;
  }

  // ── 3. Orphaned enrollments ───────────────────────────────────────────────
  try {
    const result = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) as cnt FROM enrollments e LEFT JOIN students s ON e.studentId = s.id WHERE s.id IS NULL AND e.isActive = 1'
    );
    const cnt = Number(result[0].cnt);
    if (cnt > 0) {
      console.error(`[WARN] ${cnt} active enrollment(s) with missing student record`);
      console.error('       Run: node fix-orphaned-relations.js');
      issues++;
    } else {
      console.log('[OK] No orphaned enrollments');
    }
  } catch (e) {
    console.error('[WARN] Could not check orphaned enrollments:', e.message);
  }

  // ── 4. Orphaned teacher_classes ───────────────────────────────────────────
  try {
    const result = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) as cnt FROM teacher_classes tc LEFT JOIN teachers t ON tc.teacherId = t.id WHERE t.id IS NULL'
    );
    const cnt = Number(result[0].cnt);
    if (cnt > 0) {
      console.warn(`[WARN] ${cnt} teacher_class record(s) with missing teacher`);
      issues++;
    } else {
      console.log('[OK] No orphaned teacher_classes');
    }
  } catch (e) {
    console.error('[WARN] Could not check orphaned teacher_classes:', e.message);
  }

  // ── 5. Stuck PENDING school memberships ──────────────────────────────────
  try {
    const pending = await prisma.schoolMembership.count({ where: { status: 'PENDING' } });
    if (pending > 0) {
      console.warn(`[WARN] ${pending} school membership(s) stuck in PENDING status`);
      console.warn('       These users cannot access Education features until approved.');
      console.warn('       Go to Admin → School → Members to approve them.');
    } else {
      console.log('[OK] No pending memberships');
    }
  } catch (e) {
    console.error('[WARN] Could not check pending memberships:', e.message);
  }

  // ── 6. Users without SchoolMembership (legacy users) ─────────────────────
  try {
    const result = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as cnt
      FROM users u
      WHERE u.role NOT IN ('SUPER_ADMIN', 'MEMBER')
        AND u.deletedAt IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM school_memberships sm
          WHERE sm.userId = u.id AND sm.status = 'ACTIVE'
        )
    `);
    const cnt = Number(result[0].cnt);
    if (cnt > 0) {
      console.warn(`[WARN] ${cnt} legacy user(s) with role but no SchoolMembership record`);
      console.warn('       These users use the legacy User.role field for auth.');
      console.warn('       They will work normally but cannot use multi-school features.');
    } else {
      console.log('[OK] All non-MEMBER users have SchoolMembership records');
    }
  } catch (e) {
    console.error('[WARN] Could not check SchoolMembership coverage:', e.message);
  }

  // ── 7. Students with classId in enrollments that no longer exist ──────────
  try {
    const result = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) as cnt FROM enrollments e LEFT JOIN classes c ON e.classId = c.id WHERE c.id IS NULL AND e.isActive = 1'
    );
    const cnt = Number(result[0].cnt);
    if (cnt > 0) {
      console.error(`[FAIL] ${cnt} active enrollment(s) referencing deleted class`);
      issues++;
    } else {
      console.log('[OK] No enrollments referencing deleted classes');
    }
  } catch (e) {
    console.error('[WARN] Could not check class FK in enrollments:', e.message);
  }

  // ── 8. Duplicate active enrollments ──────────────────────────────────────
  try {
    const result = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as cnt FROM (
        SELECT studentId, classId, COUNT(*) as c
        FROM enrollments
        WHERE isActive = 1
        GROUP BY studentId, classId
        HAVING c > 1
      ) dups
    `);
    const cnt = Number(result[0].cnt);
    if (cnt > 0) {
      console.error(`[FAIL] ${cnt} duplicate active enrollment pair(s) (same student+class)`);
      issues++;
    } else {
      console.log('[OK] No duplicate enrollments');
    }
  } catch (e) {
    console.error('[WARN] Could not check duplicate enrollments:', e.message);
  }

  // ── 9. Teachers without a User record ─────────────────────────────────────
  try {
    const result = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) as cnt FROM teachers t LEFT JOIN users u ON t.userId = u.id WHERE u.id IS NULL'
    );
    const cnt = Number(result[0].cnt);
    if (cnt > 0) {
      console.error(`[FAIL] ${cnt} teacher record(s) with no User — orphaned data`);
      issues++;
    } else {
      console.log('[OK] All teacher records have a User');
    }
  } catch (e) {
    console.error('[WARN] Could not check teacher/user relation:', e.message);
  }

  // ── 10. JWT secret minimum length ─────────────────────────────────────────
  const jwtSecret = process.env.JWT_SECRET || '';
  if (jwtSecret.length < 32) {
    console.error(`[FAIL] JWT_SECRET is too short (${jwtSecret.length} chars, min 32)`);
    console.error('       Run: node src/prisma/generate-secrets.js');
    issues++;
  } else {
    console.log(`[OK] JWT_SECRET length OK (${jwtSecret.length} chars)`);
  }

  // ── 11. TOTP encryption key ────────────────────────────────────────────────
  const totpKey = process.env.TOTP_ENCRYPTION_KEY || '';
  if (!totpKey) {
    console.warn('[WARN] TOTP_ENCRYPTION_KEY not set — 2FA secrets use JWT_SECRET as fallback');
    console.warn('       Set a dedicated key in backend/.env for better security');
  } else {
    console.log('[OK] TOTP_ENCRYPTION_KEY is set');
  }

  // ── 12. Stripe webhook secret ─────────────────────────────────────────────
  const stripeWebhook = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!stripeWebhook || stripeWebhook.startsWith('whsec_REPLACE')) {
    console.warn('[WARN] STRIPE_WEBHOOK_SECRET is not configured — Stripe payments may fail');
    console.warn('       Get the secret from https://dashboard.stripe.com/webhooks');
  } else {
    console.log('[OK] STRIPE_WEBHOOK_SECRET is set');
  }

  // ── 13. LiveKit credentials ────────────────────────────────────────────────
  const livekitUrl    = process.env.LIVEKIT_URL || '';
  const livekitKey    = process.env.LIVEKIT_API_KEY || '';
  const livekitSecret = process.env.LIVEKIT_API_SECRET || '';
  if (!livekitUrl || !livekitKey || !livekitSecret) {
    console.warn('[WARN] LiveKit credentials incomplete — Voice Club and Live Classes will not work');
    const missing = [!livekitUrl && 'LIVEKIT_URL', !livekitKey && 'LIVEKIT_API_KEY', !livekitSecret && 'LIVEKIT_API_SECRET'].filter(Boolean);
    console.warn('       Missing:', missing.join(', '));
  } else {
    console.log('[OK] LiveKit credentials set');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(45));
  if (issues === 0) {
    console.log('✅ DATABASE AND CONFIG: ALL CHECKS PASSED');
  } else {
    console.log(`⚠️  ${issues} issue(s) found — see [FAIL] items above`);
  }
  console.log('='.repeat(45) + '\n');

  await prisma.$disconnect();
  process.exit(issues > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
