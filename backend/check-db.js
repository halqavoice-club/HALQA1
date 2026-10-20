'use strict';
require('dotenv').config();
const prisma = require('./src/utils/prisma');

async function checkDb() {
  console.log('=== DATABASE HEALTH CHECK ===');
  console.log('DB:', process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':***@'));

  try {
    // 1. Connection
    await prisma.$queryRawUnsafe('SELECT 1');
    console.log('\n[OK] Connection: working');

    // 2. Last migrations
    const migrations = await prisma.$queryRawUnsafe(
      'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 8'
    );
    console.log('\n[OK] Last 8 migrations:');
    migrations.forEach(m => console.log('     -', m.migration_name, m.finished_at ? '✓' : '⚠ PENDING'));

    // 3. Table counts
    const [users, schools, memberships, classes, students, teachers, activeTokens, authProviders, notifications] = await Promise.all([
      prisma.user.count(),
      prisma.school.count(),
      prisma.schoolMembership.count(),
      prisma.class.count(),
      prisma.student.count(),
      prisma.teacher.count(),
      prisma.refreshToken.count({ where: { isRevoked: false, expiresAt: { gt: new Date() } } }),
      prisma.authProvider.count(),
      prisma.notification.count(),
    ]);

    console.log('\n[OK] Table row counts:');
    console.log('     users              :', users);
    console.log('     schools            :', schools);
    console.log('     school_memberships :', memberships);
    console.log('     classes            :', classes);
    console.log('     students           :', students);
    console.log('     teachers           :', teachers);
    console.log('     refresh_tokens(live):', activeTokens);
    console.log('     auth_providers     :', authProviders, '(Google/OAuth)');
    console.log('     notifications      :', notifications);

    // 4. User role breakdown
    const roles = await prisma.user.groupBy({ by: ['role'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } });
    console.log('\n[OK] User.role breakdown:');
    roles.forEach(r => console.log('     ' + r.role.padEnd(15) + ':', r._count.id));

    // 5. School membership breakdown
    const mRoles = await prisma.schoolMembership.groupBy({
      by: ['role', 'status'], _count: { id: true }, orderBy: { _count: { id: 'desc' } }
    });
    console.log('\n[OK] SchoolMembership breakdown:');
    mRoles.forEach(r => console.log('     ' + (r.role + '/' + r.status).padEnd(25) + ':', r._count.id));

    // 6. Google-only accounts
    const googleOnly = await prisma.user.count({ where: { passwordHash: null } });
    console.log('\n[OK] Google-only accounts (passwordHash=NULL):', googleOnly);

    // 7. OAuth providers
    if (authProviders > 0) {
      const providers = await prisma.authProvider.groupBy({ by: ['provider'], _count: { id: true } });
      console.log('[OK] OAuth provider accounts:');
      providers.forEach(p => console.log('     ' + p.provider + ':', p._count.id));
    }

    // 8. Integrity checks
    const pendingMemberships = await prisma.schoolMembership.count({ where: { status: 'PENDING' } });
    const suspendedUsers = await prisma.user.count({ where: { status: 'SUSPENDED' } });
    const deletedUsers = await prisma.user.count({ where: { deletedAt: { not: null } } });
    console.log('\n[OK] Data integrity:');
    console.log('     Pending memberships :', pendingMemberships);
    console.log('     Suspended users     :', suspendedUsers);
    console.log('     Soft-deleted users  :', deletedUsers);

    // 9. Check demo seed accounts exist
    const seedAccounts = ['superadmin@halqa.com', 'admin@halqa-academy.com', 'teacher@halqa-academy.com', 'student1@halqa.com', 'parent@halqa.com'];
    const found = await prisma.user.findMany({ where: { email: { in: seedAccounts } }, select: { email: true, status: true, role: true } });
    console.log('\n[OK] Seed demo accounts:');
    seedAccounts.forEach(email => {
      const u = found.find(x => x.email === email);
      console.log('    ', email, u ? `[${u.role} / ${u.status}]` : '✗ MISSING');
    });

    console.log('\n=== DATABASE: HEALTHY ===');
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    process.exit(process.exitCode || 0);
  }
}

checkDb();
