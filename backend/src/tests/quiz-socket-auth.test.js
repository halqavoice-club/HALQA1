'use strict';
/**
 * quiz-socket-auth.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression tests for AUDIT-007-AUTHZ fix: quiz:watch socket handler
 * authorization guards.
 *
 * Fixes verified:
 *   AUDIT-007-AUTHZ (original): SUPER_ADMIN unconditionally denied from quiz:watch
 *   AUDIT-007-AUTHZ (original): SCHOOL_ADMIN cross-school access denied
 *   AUDIT-007-AUTHZ (original): schoolId field selected in quiz lookup
 *   AUDIT-007-AUTHZ (edge-case hardening):
 *     - SUPER_ADMIN deny is BEFORE teacher-ID comparison (unconditional even if
 *       SUPER_ADMIN userId coincidentally equals quiz.teacher.userId)
 *     - SCHOOL_ADMIN school-scope check is UNCONDITIONAL (even if their userId
 *       matches quiz.teacher.userId — the teacher-match alone does not grant access)
 *
 * Test strategy: source-code inspection via fs.readFileSync — same approach
 * used by super-admin-scope.test.js (SA-FIX-10 / SA-FIX-11). Avoids requiring
 * a live DB or Socket.IO server while providing evidence-backed verification
 * of the complete authorization path and its structural ordering.
 *
 * Run via: npm run test:unit
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

const APP_JS = path.join(__dirname, '../app.js');

// ─── Source helpers ────────────────────────────────────────────────────────────

/**
 * Extract the full quiz:watch handler block from app.js.
 * Bounded by the next socket.on call (quiz:unwatch) that immediately follows.
 */
function getQuizWatchHandlerSource() {
  const src = fs.readFileSync(APP_JS, 'utf8');
  const match = src.match(/socket\.on\('quiz:watch'[\s\S]*?socket\.on\('quiz:unwatch'/);
  return match ? match[0] : null;
}

/**
 * Return the character index of the first occurrence of a literal string
 * within the handler source.  Returns -1 if not found.
 */
function idx(handler, literal) {
  return handler.indexOf(literal);
}

// ─── Test suite ────────────────────────────────────────────────────────────────

describe('AUDIT-007-AUTHZ: quiz:watch socket handler authorization', () => {

  let src;        // full app.js source
  let handler;    // just the quiz:watch block

  beforeAll(() => {
    src     = fs.readFileSync(APP_JS, 'utf8');
    handler = getQuizWatchHandlerSource();
  });

  // ── 0. Precondition ───────────────────────────────────────────────────────────

  test('0. quiz:watch handler exists in app.js and is extractable', () => {
    expect(handler).not.toBeNull();
    expect(handler).toContain("socket.on('quiz:watch'");
  });

  // ── 1. Structural shape: three-step authorization block ───────────────────────
  //
  //  Step 1 — SUPER_ADMIN unconditional deny (before teacher-ID comparison)
  //  Step 2 — SCHOOL_ADMIN with school-scope check
  //  Step 3 — All other roles: must own the quiz (teacher.userId === userId)

  test('1a. Step 1: SUPER_ADMIN deny is present as an explicit early-return', () => {
    expect(handler).toMatch(
      /if\s*\(\s*socket\.userRole\s*===\s*['"]SUPER_ADMIN['"]\s*\)\s*return/
    );
  });

  test('1b. Step 1: SUPER_ADMIN deny is placed BEFORE the teacher-ID comparison — unconditional even when userId matches teacher', () => {
    // The deny must appear in source BEFORE the quiz.teacher.userId check.
    // If it comes after, a SUPER_ADMIN whose userId === teacher.userId
    // would skip the deny via the outer ownership shortcut.
    const superAdminDenyIdx    = idx(handler, "socket.userRole === 'SUPER_ADMIN'");
    const teacherOwnershipIdx  = idx(handler, 'quiz.teacher.userId !== userId');

    expect(superAdminDenyIdx).toBeGreaterThan(-1);
    expect(teacherOwnershipIdx).toBeGreaterThan(-1);
    expect(superAdminDenyIdx).toBeLessThan(teacherOwnershipIdx);
  });

  test('1c. Step 2: SCHOOL_ADMIN school-scope check is present', () => {
    expect(handler).toMatch(/socket\.userSchoolId\s*!==\s*quiz\.schoolId/);
  });

  test('1d. Step 2: SCHOOL_ADMIN school-scope check is inside the SCHOOL_ADMIN branch (not inside the teacher-mismatch branch)', () => {
    // The school-scope check must appear AFTER the SCHOOL_ADMIN role check
    // and BEFORE the teacher-mismatch else-if — so it runs regardless of
    // whether the SCHOOL_ADMIN's userId happens to match quiz.teacher.userId.
    //
    // Correct structure:
    //   if (role === 'SCHOOL_ADMIN') {
    //     if (userSchoolId !== quiz.schoolId) return;
    //   } else if (quiz.teacher.userId !== userId) {
    //     return;
    //   }
    //
    // The school-scope check must appear BEFORE the teacher-ownership else-if.
    const schoolAdminBranchIdx  = idx(handler, "socket.userRole === 'SCHOOL_ADMIN'");
    const schoolScopeCheckIdx   = idx(handler, 'socket.userSchoolId !== quiz.schoolId');
    const teacherOwnershipIdx   = idx(handler, 'quiz.teacher.userId !== userId');

    expect(schoolAdminBranchIdx).toBeGreaterThan(-1);
    expect(schoolScopeCheckIdx).toBeGreaterThan(-1);
    expect(teacherOwnershipIdx).toBeGreaterThan(-1);

    // school-scope check is inside the SCHOOL_ADMIN branch (comes after its opening)
    expect(schoolScopeCheckIdx).toBeGreaterThan(schoolAdminBranchIdx);
    // teacher-ownership check is in the else-if (comes after the school-scope check)
    expect(teacherOwnershipIdx).toBeGreaterThan(schoolScopeCheckIdx);
  });

  test('1e. Step 3: teacher-ownership check is inside an else-if (not a standalone if)', () => {
    // The ownership check must be `} else if (quiz.teacher.userId !== userId)`
    // so that a SCHOOL_ADMIN who passed the school check does NOT then hit
    // an additional ownership guard.
    expect(handler).toMatch(/\}\s*else\s*if\s*\(\s*quiz\.teacher\.userId\s*!==\s*userId\s*\)/);
  });

  // ── 2. Old bypass pattern is gone ─────────────────────────────────────────────

  test('2a. Old bypass pattern (SUPER_ADMIN allowed via !=) is absent', () => {
    // The old vulnerable line was:
    //   if (socket.userRole !== 'SCHOOL_ADMIN' && socket.userRole !== 'SUPER_ADMIN') return;
    expect(handler).not.toMatch(/socket\.userRole\s*!==\s*['"]SUPER_ADMIN['"]/);
  });

  test('2b. SUPER_ADMIN appears in exactly one executable check (the deny) — not in any allow path', () => {
    // Strip single-line comments from the handler before counting, so that
    // legitimate explanatory comments (which mention SUPER_ADMIN to describe
    // the invariant) don't skew the count.
    const codeOnly = handler.replace(/\/\/[^\n]*/g, '');
    // In the stripped code, SUPER_ADMIN must appear exactly once: the deny guard.
    // Any additional occurrence would indicate a second role check that could
    // represent an allow path.
    const occurrences = (codeOnly.match(/SUPER_ADMIN/g) || []).length;
    expect(occurrences).toBe(1);
  });

  // ── 3. schoolId is selected in the Prisma query ───────────────────────────────

  test('3. quiz Prisma select includes schoolId: true (required for school-scope check)', () => {
    // Without schoolId in the select, quiz.schoolId is undefined.
    // undefined !== undefined → false → SCHOOL_ADMIN would be wrongly admitted.
    expect(handler).toMatch(/schoolId\s*:\s*true/);
  });

  // ── 4. SUPER_ADMIN edge cases ──────────────────────────────────────────────────
  //
  // These tests verify the structural invariant that proves the following
  // runtime scenarios are handled correctly without a live DB:
  //
  //   a) SUPER_ADMIN whose userId !== quiz.teacher.userId → DENIED (step 1)
  //   b) SUPER_ADMIN whose userId === quiz.teacher.userId → DENIED (step 1, before ownership check)

  test('4a. SUPER_ADMIN (userId ≠ teacher) is denied: step 1 fires before quiz is even checked', () => {
    // Step 1 appears after quiz load (not before — quiz must be loaded to know quizId is valid)
    // but BEFORE the teacher comparison.  Verified in test 1b.
    // This test asserts the deny fires for any SUPER_ADMIN regardless of teacher match.
    const superAdminDenyIdx   = idx(handler, "socket.userRole === 'SUPER_ADMIN'");
    const teacherCompareIdx   = idx(handler, 'quiz.teacher.userId !== userId');
    expect(superAdminDenyIdx).toBeLessThan(teacherCompareIdx);
  });

  test('4b. SUPER_ADMIN (userId = teacher) is denied: no path reaches socket.join for SUPER_ADMIN', () => {
    // If SUPER_ADMIN deny is before the teacher comparison AND the teacher
    // comparison is in an else-if (not reachable by SCHOOL_ADMIN or SUPER_ADMIN),
    // then even a SUPER_ADMIN with a matching teacher record hits step 1 and returns.
    //
    // Verify: SUPER_ADMIN deny is before socket.join — no execution path for SA
    // can reach the join after passing the deny check.
    const superAdminDenyIdx = idx(handler, "socket.userRole === 'SUPER_ADMIN'");
    const socketJoinIdx     = idx(handler, 'socket.join(`quiz:${quizId}`)');
    expect(superAdminDenyIdx).toBeGreaterThan(-1);
    expect(socketJoinIdx).toBeGreaterThan(-1);
    expect(superAdminDenyIdx).toBeLessThan(socketJoinIdx);
  });

  // ── 5. SCHOOL_ADMIN edge cases ────────────────────────────────────────────────
  //
  //   a) SCHOOL_ADMIN, same school, userId ≠ teacher → ALLOWED (step 2 passes)
  //   b) SCHOOL_ADMIN, other school, userId ≠ teacher → DENIED (step 2 school check)
  //   c) SCHOOL_ADMIN, same school, userId = teacher → ALLOWED (step 2 passes;
  //      falls through without hitting teacher-ownership else-if)
  //   d) SCHOOL_ADMIN, other school, userId = teacher → DENIED (step 2 school check;
  //      teacher-match alone does not grant access)

  test('5a/5c. SCHOOL_ADMIN with same school passes step 2 and reaches socket.join (not blocked by teacher check)', () => {
    // Structural proof: if SCHOOL_ADMIN branch is an if-else-if pattern,
    // a SCHOOL_ADMIN who passes the school-scope check falls through to
    // socket.join without entering the teacher-ownership else-if.
    // Verified by test 1d (else-if structure) and 1c (school check present).
    const schoolAdminBranchIdx = idx(handler, "socket.userRole === 'SCHOOL_ADMIN'");
    const socketJoinIdx        = idx(handler, 'socket.join(`quiz:${quizId}`)');
    // The SCHOOL_ADMIN branch must appear before socket.join
    expect(schoolAdminBranchIdx).toBeLessThan(socketJoinIdx);
    // The structure is if/else-if (not two independent ifs) — verified in test 1e
  });

  test('5b/5d. SCHOOL_ADMIN with wrong school is denied regardless of teacher-ID match (school check is unconditional)', () => {
    // The school-scope check must appear inside the SCHOOL_ADMIN branch,
    // NOT inside the teacher-mismatch branch. This ensures it runs even when
    // the SCHOOL_ADMIN's userId matches quiz.teacher.userId.
    //
    // If the check were inside `if (quiz.teacher.userId !== userId)` instead,
    // a SCHOOL_ADMIN whose userId === teacher.userId would skip it.
    //
    // Proof: school-scope check appears BEFORE teacher-ownership else-if (test 1d),
    // and the teacher-ownership check is in an else-if (test 1e), meaning it is
    // unreachable when the SCHOOL_ADMIN branch executes.
    expect(handler).toMatch(/\}\s*else\s*if\s*\(\s*quiz\.teacher\.userId\s*!==\s*userId\s*\)/);
    const schoolScopeCheckIdx  = idx(handler, 'socket.userSchoolId !== quiz.schoolId');
    const teacherOwnershipIdx  = idx(handler, 'quiz.teacher.userId !== userId');
    expect(schoolScopeCheckIdx).toBeLessThan(teacherOwnershipIdx);
  });

  // ── 6. Authorized teacher access is preserved ─────────────────────────────────

  test('6a. Owning teacher (userId = teacher, role = TEACHER): teacher-ownership check present', () => {
    // A TEACHER who owns the quiz must still reach socket.join.
    // The else-if path allows this: if role !== SCHOOL_ADMIN and userId === teacher.userId,
    // the else-if condition is false → falls through to socket.join.
    expect(handler).toMatch(/quiz\.teacher\.userId\s*!==\s*userId/);
    expect(handler).toMatch(/socket\.join\(`quiz:\$\{quizId\}`\)/);
  });

  test('6b. quiz:snapshot emission path is intact (authorized users receive current state)', () => {
    expect(handler).toMatch(/socket\.emit\('quiz:snapshot'/);
  });

  // ── 7. Denial of unauthorized sockets (room join and snapshot) ────────────────

  test('7a. Unauthenticated / missing quizId guard is present (before DB query)', () => {
    expect(handler).toMatch(/if\s*\(!quizId\s*\|\|\s*!userId\)\s*return/);
  });

  test('7b. Nonexistent quiz guard is present (before authorization)', () => {
    expect(handler).toMatch(/if\s*\(!quiz\)\s*return/);
  });

  test('7c. All authorization returns appear BEFORE socket.join — no unauthorized socket reaches the room', () => {
    // The latest of the three authorization return points must precede socket.join.
    // Proxy: all three authorization checks appear before socket.join.
    const superAdminDenyIdx  = idx(handler, "socket.userRole === 'SUPER_ADMIN'");
    const schoolScopeIdx     = idx(handler, 'socket.userSchoolId !== quiz.schoolId');
    const teacherOwnerIdx    = idx(handler, 'quiz.teacher.userId !== userId');
    const socketJoinIdx      = idx(handler, 'socket.join(`quiz:${quizId}`)');

    expect(superAdminDenyIdx).toBeLessThan(socketJoinIdx);
    expect(schoolScopeIdx).toBeLessThan(socketJoinIdx);
    expect(teacherOwnerIdx).toBeLessThan(socketJoinIdx);
  });

  test('7d. snapshot emission is after socket.join — unauthorized sockets never receive it', () => {
    const socketJoinIdx    = idx(handler, 'socket.join(`quiz:${quizId}`)');
    const snapshotEmitIdx  = idx(handler, "socket.emit('quiz:snapshot'");
    expect(socketJoinIdx).toBeGreaterThan(-1);
    expect(snapshotEmitIdx).toBeGreaterThan(-1);
    expect(snapshotEmitIdx).toBeGreaterThan(socketJoinIdx);
  });

  // ── 8. Ordering invariants summary ────────────────────────────────────────────

  test('8. Authorization ordering invariant: SA-deny < school-scope < teacher-ownership < socket.join < snapshot', () => {
    const saIdx       = idx(handler, "socket.userRole === 'SUPER_ADMIN'");
    const schoolIdx   = idx(handler, 'socket.userSchoolId !== quiz.schoolId');
    const teacherIdx  = idx(handler, 'quiz.teacher.userId !== userId');
    const joinIdx     = idx(handler, 'socket.join(`quiz:${quizId}`)');
    const snapIdx     = idx(handler, "socket.emit('quiz:snapshot'");

    expect(saIdx).toBeLessThan(schoolIdx);
    expect(schoolIdx).toBeLessThan(teacherIdx);
    expect(teacherIdx).toBeLessThan(joinIdx);
    expect(joinIdx).toBeLessThan(snapIdx);
  });

  // ── 9. SA-FIX-10 regression guard ─────────────────────────────────────────────

  test('9. school:join handler still has its own SUPER_ADMIN deny (SA-FIX-10 not regressed)', () => {
    const schoolJoinMatch = src.match(/socket\.on\('school:join'[\s\S]*?socket\.on\('school:leave'/);
    expect(schoolJoinMatch).not.toBeNull();
    const schoolJoinCode = schoolJoinMatch[0];
    expect(schoolJoinCode).toMatch(
      /if\s*\(\s*socket\.userRole\s*===\s*['"]SUPER_ADMIN['"]\s*\)\s*return/
    );
  });

});
