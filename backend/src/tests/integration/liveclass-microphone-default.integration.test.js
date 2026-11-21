/**
 * SEC01-G-BE02: Prisma @default vs DB column default for
 * microphone_authorization_mode (Issue 4 — isolated default-behavior test).
 *
 * Four cases:
 *   1. Prisma create with the field omitted (client-side @default applies).
 *   2. Prisma create with an explicit SFU_AUTHORITATIVE value.
 *   3. Raw SQL INSERT with the column omitted (DB column default applies).
 *   4. Raw SQL INSERT with an explicit SFU_AUTHORITATIVE value.
 *
 * Destructive integration test: requires DATABASE_URL pointing at a
 * disposable migrated database (halqa_test). Never point at dev/prod.
 */

'use strict';
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

let prisma;

describe('SEC01-G-BE02 Prisma @default vs DB column default', () => {
  let testSchoolId, testTeacherId;
  const createdLcIds = [];
  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    prisma = new PrismaClient();
    // Create minimum fixtures: school + teacher.
    // School: `slug` is a required field (no @default) and unique; `country`
    // matches the working pattern in liveclass-microphone-triggers.integration.test.js.
    const school = await prisma.school.create({
      data: {
        name: `mic-default-test-school-${uid()}`,
        slug: `mic-default-${uid()}`,
        country: 'MY',
      },
    });
    testSchoolId = school.id;
    // Teacher: the User model uses `firstName`/`lastName` (both required String)
    // and `passwordHash` (the column name). `status` defaults to PENDING;
    // ACTIVE + emailVerified are set explicitly so any raw-SQL authorization
    // path that checks `status = 'ACTIVE'` does not reject the host.
    const teacher = await prisma.user.create({
      data: {
        firstName: 'MicDefault',
        lastName: 'Teacher',
        email: `mic-default-teacher-${uid()}@test.local`,
        passwordHash: 'hashed-not-real',
        role: 'TEACHER',
        status: 'ACTIVE',
        emailVerified: true,
      },
    });
    testTeacherId = teacher.id;
  }, 30000);

  afterAll(async () => {
    // Delete live class rows first (FK-safe order: live classes before users/schools)
    for (const id of createdLcIds) {
      await prisma.liveClass.delete({ where: { id } }).catch(() => {});
    }
    if (testTeacherId) await prisma.user.delete({ where: { id: testTeacherId } }).catch(() => {});
    if (testSchoolId) await prisma.school.delete({ where: { id: testSchoolId } }).catch(() => {});
    await prisma.$disconnect();
  });

  test('Case 1: Prisma create omitting microphoneAuthorizationMode stores SFU_AUTHORITATIVE', async () => {
    const capturedEvents = [];
    const loggingPrisma = new PrismaClient({
      log: [{ emit: 'event', level: 'query' }],
    });
    loggingPrisma.$on('query', (e) => capturedEvents.push({ query: e.query, params: e.params }));

    const lc = await loggingPrisma.liveClass.create({
      data: {
        title: `Default Test ${uid()}`,
        livekitRoomName: `default-test-${Date.now()}`,
        maxParticipants: 50,
        streamType: 'CLASS',
        status: 'SCHEDULED',
        schoolId: testSchoolId,
        hostUserId: testTeacherId,
        // microphoneAuthorizationMode intentionally omitted
      },
    });
    createdLcIds.push(lc.id);

    // Assert persisted value is SFU_AUTHORITATIVE (Prisma @default applied client-side)
    expect(lc.microphoneAuthorizationMode).toBe('SFU_AUTHORITATIVE');

    // Assert the Prisma client sent 'SFU_AUTHORITATIVE' as a parameter — it did not
    // leave the value to the DB column default.
    // e.params is a JSON string in Prisma 5.x, e.g. '["<uuid>","SFU_AUTHORITATIVE",...]'
    const insertEvent = capturedEvents.find(
      e => e.query.toLowerCase().includes('insert') && e.query.toLowerCase().includes('live_classes')
    );
    expect(insertEvent).toBeDefined();
    expect(insertEvent.params).toContain('SFU_AUTHORITATIVE');

    // Read back from DB via raw SQL to confirm storage independently of ORM return value
    const rows = await prisma.$queryRawUnsafe(
      'SELECT microphone_authorization_mode FROM live_classes WHERE id = ?', lc.id
    );
    expect(rows[0].microphone_authorization_mode).toBe('SFU_AUTHORITATIVE');

    await loggingPrisma.$disconnect();
  });

  test('Case 2: Prisma create with explicit SFU_AUTHORITATIVE stores SFU_AUTHORITATIVE', async () => {
    const lc = await prisma.liveClass.create({
      data: {
        title: `Explicit SFU Test ${uid()}`,
        livekitRoomName: `explicit-sfu-${Date.now()}`,
        maxParticipants: 50,
        streamType: 'CLASS',
        status: 'SCHEDULED',
        schoolId: testSchoolId,
        hostUserId: testTeacherId,
        microphoneAuthorizationMode: 'SFU_AUTHORITATIVE',
      },
    });
    createdLcIds.push(lc.id);
    expect(lc.microphoneAuthorizationMode).toBe('SFU_AUTHORITATIVE');
    const rows = await prisma.$queryRawUnsafe(
      'SELECT microphone_authorization_mode FROM live_classes WHERE id = ?', lc.id
    );
    expect(rows[0].microphone_authorization_mode).toBe('SFU_AUTHORITATIVE');
  });

  test('Case 3: raw SQL INSERT omitting column stores DB column default', async () => {
    // Determine the expected DB default based on which migrations have been applied.
    // - After 20261030 only: DB default is LEGACY.
    // - After Issue 3's reconciliation migration: DB default is SFU_AUTHORITATIVE.
    // This assertion is deterministic: it fails if the INSERT stored the wrong value
    // relative to the applied migrations.
    const reconMigRows = await prisma.$queryRawUnsafe(
      "SELECT migration_name FROM _prisma_migrations WHERE migration_name LIKE '%reconcile_microphone_authorization_default%' AND finished_at IS NOT NULL"
    );
    const expectedDefault = reconMigRows.length > 0 ? 'SFU_AUTHORITATIVE' : 'LEGACY';

    const id = uuidv4();
    const now = new Date().toISOString().slice(0, 23).replace('T', ' ');
    await prisma.$executeRawUnsafe(
      `INSERT INTO live_classes
         (id, stream_type, host_user_id, schoolId, title, status, maxSpeakers,
          chatEnabled, handRaiseEnabled, isOpenMic, screenShareEnabled,
          whiteboardEnabled, quranPanelEnabled, isRecorded, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, 'CLASS', testTeacherId, testSchoolId, `Raw Insert Test ${uid()}`,
      'SCHEDULED', 2, 1, 1, 0, 1, 1, 0, 0, now, now
    );
    createdLcIds.push(id);

    const rows = await prisma.$queryRawUnsafe(
      'SELECT microphone_authorization_mode FROM live_classes WHERE id = ?', id
    );
    // Assert the DB default was applied — not an adaptive tautology.
    // If the INSERT stored a value that does not match the applied migrations,
    // this test fails, which is the desired regression signal.
    expect(rows[0].microphone_authorization_mode).toBe(expectedDefault);

    // Secondary confirmation: SHOW COLUMNS must agree
    const colInfo = await prisma.$queryRawUnsafe(
      "SHOW COLUMNS FROM live_classes LIKE 'microphone_authorization_mode'"
    );
    expect(colInfo[0].Default).toBe(expectedDefault);
  });

  test('Case 4: raw SQL INSERT with explicit SFU_AUTHORITATIVE stores SFU_AUTHORITATIVE', async () => {
    const id = uuidv4();
    const now = new Date().toISOString().slice(0, 23).replace('T', ' ');
    await prisma.$executeRawUnsafe(
      `INSERT INTO live_classes
         (id, stream_type, host_user_id, schoolId, title, status, maxSpeakers,
          microphone_authorization_mode,
          chatEnabled, handRaiseEnabled, isOpenMic, screenShareEnabled,
          whiteboardEnabled, quranPanelEnabled, isRecorded, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, 'CLASS', testTeacherId, testSchoolId, `Raw Explicit Test ${uid()}`,
      'SCHEDULED', 2, 'SFU_AUTHORITATIVE', 1, 1, 0, 1, 1, 0, 0, now, now
    );
    createdLcIds.push(id);
    const rows = await prisma.$queryRawUnsafe(
      'SELECT microphone_authorization_mode FROM live_classes WHERE id = ?', id
    );
    expect(rows[0].microphone_authorization_mode).toBe('SFU_AUTHORITATIVE');
  });
});
