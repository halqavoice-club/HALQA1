/**
 * seed-check.js
 * Run: node seed-check.js
 * Shows exactly what is and isn't seeded in the database.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ log: [] });

const line  = (label, val) => process.stdout.write(`  ${label.padEnd(28)} ${val}\n`);
const head  = (title)      => process.stdout.write(`\n${'─'.repeat(50)}\n  ${title}\n${'─'.repeat(50)}\n`);
const ok    = (s)          => `✅  ${s}`;
const miss  = (s)          => `❌  ${s}`;
const warn  = (s)          => `⚠️   ${s}`;

async function check() {
  process.stdout.write('\n🔍  SEED CHECK — Halqa Management System\n');

  // ── CORE TABLES ────────────────────────────────────────────────────────────
  head('CORE DATA');
  const schools   = await p.school.count();
  const users     = await p.user.count();
  const teachers  = await p.teacher.count();
  const students  = await p.student.count();
  const guardians = await p.guardian.count();
  const classes   = await p.class.count();
  const terms     = await p.term.count();

  line('Schools',   schools   > 0 ? ok(schools)   : miss('0 — run seed.js'));
  line('Users',     users     > 0 ? ok(users)     : miss('0 — run seed.js'));
  line('Teachers',  teachers  > 0 ? ok(teachers)  : miss('0 — run seed.js'));
  line('Students',  students  > 0 ? ok(students)  : miss('0 — run seed.js'));
  line('Guardians', guardians > 0 ? ok(guardians) : miss('0 — run seed.js'));
  line('Classes',   classes   > 0 ? ok(classes)   : miss('0 — run seed.js'));
  line('Terms',     terms     > 0 ? ok(terms)     : miss('0 — run seed.js'));

  // ── ACADEMIC DATA ──────────────────────────────────────────────────────────
  head('ACADEMIC DATA');
  const enrollments  = await p.enrollment.count();
  const attendance   = await p.attendance.count();
  const grades       = await p.grade.count();
  const behavior     = await p.behaviorLog.count();
  const announcements= await p.announcement.count();
  const messages     = await p.message.count();
  const notifications= await p.notification.count();
  const notes        = await p.note.count();
  const events       = await p.calendarEvent.count();

  line('Enrollments',    enrollments   > 0 ? ok(enrollments)   : warn('0 — run seed-data.js'));
  line('Attendance',     attendance    > 0 ? ok(attendance)    : warn('0 — run seed-data.js'));
  line('Grades',         grades        > 0 ? ok(grades)        : warn('0 — run seed-data.js'));
  line('Behavior Logs',  behavior      > 0 ? ok(behavior)      : warn('0 — run seed-data.js'));
  line('Announcements',  announcements > 0 ? ok(announcements) : warn('0 — run seed-data.js'));
  line('Messages',       messages      > 0 ? ok(messages)      : warn('0 — run seed-data.js'));
  line('Notifications',  notifications > 0 ? ok(notifications) : warn('0 — run seed-data.js'));
  line('Notes',          notes         > 0 ? ok(notes)         : warn('0 — run seed-data.js'));
  line('Calendar Events',events        > 0 ? ok(events)        : warn('0 — run seed-data.js'));

  // ── VOICE CLUB ─────────────────────────────────────────────────────────────
  head('VOICE CLUB');
  const voiceRooms = await p.voiceRoom.count();
  const voiceParts = await p.voiceParticipant.count();
  const voiceMsgs  = await p.voiceMessage.count();
  const voiceStats = await p.voiceHostStats.count();

  line('Voice Rooms',       voiceRooms > 0 ? ok(voiceRooms) : warn('0 — create rooms via UI'));
  line('Voice Participants', voiceParts > 0 ? ok(voiceParts) : warn('0 — join rooms via UI'));
  line('Voice Messages',    voiceMsgs  > 0 ? ok(voiceMsgs)  : warn('0 — chat in rooms'));
  line('Voice Host Stats',  voiceStats > 0 ? ok(voiceStats) : warn('0 — end rooms to generate'));

  // ── GIFT SYSTEM ────────────────────────────────────────────────────────────
  head('GIFT SYSTEM');

  // Check if gifts table exists and has data
  let gifts = [], wallets = [], transactions = [], leaderboard = [], packages = [];
  let giftTableExists = true;

  try {
    gifts        = await p.gift.findMany({ orderBy: { sortOrder: 'asc' } });
    wallets      = await p.wallet.findMany({ include: { user: { select: { email: true } } } });
    transactions = await p.giftTransaction.findMany({ take: 5, orderBy: { createdAt: 'desc' } });
    leaderboard  = await p.roomGiftLeaderboard.findMany({ take: 5 });
    packages     = await p.coinPackage.findMany({ orderBy: { sortOrder: 'asc' } });
  } catch (e) {
    giftTableExists = false;
    line('Gift Tables', miss('Migration not applied — run: npx prisma migrate deploy'));
  }

  if (giftTableExists) {
    const normalGifts  = gifts.filter(g => !g.isPremium);
    const premiumGifts = gifts.filter(g => g.isPremium);

    line('Coin Packages',    packages.length > 0 ? ok(packages.length) : miss('0 — migration not applied'));
    line('Gifts (normal)',   normalGifts.length  > 0 ? ok(normalGifts.length)  : miss('0 — migration not applied'));
    line('Gifts (premium)',  premiumGifts.length > 0 ? ok(premiumGifts.length) : miss('0 — migration not applied'));
    line('Wallets',          wallets.length      > 0 ? ok(wallets.length)      : warn('0 — users need to purchase coins'));
    line('Gift Transactions',transactions.length > 0 ? ok(transactions.length) : warn('0 — no gifts sent yet'));
    line('Leaderboard Rows', leaderboard.length  > 0 ? ok(leaderboard.length)  : warn('0 — no gifts sent yet'));

    if (gifts.length > 0) {
      process.stdout.write('\n  Gift Catalog:\n');
      gifts.forEach(g => {
        const tag = g.isPremium ? ' [PREMIUM]' : '';
        process.stdout.write(`    ${g.emoji}  ${g.name.padEnd(16)} ${String(g.priceCoins).padStart(5)} coins  ${g.rarity}${tag}\n`);
      });
    }

    if (packages.length > 0) {
      process.stdout.write('\n  Coin Packages:\n');
      packages.forEach(pkg => {
        const bonus = pkg.bonusCoins > 0 ? ` (+${pkg.bonusCoins} bonus)` : '';
        process.stdout.write(`    ${pkg.name.padEnd(12)} ${pkg.coins} coins${bonus}  $${pkg.priceUsd}\n`);
      });
    }

    if (wallets.length > 0) {
      process.stdout.write('\n  Wallets:\n');
      wallets.forEach(w => {
        process.stdout.write(`    ${w.user.email.padEnd(35)} 🪙 ${String(w.coins).padStart(6)} coins  💎 ${w.diamonds} diamonds\n`);
      });
    }
  }

  // ── MIGRATIONS ─────────────────────────────────────────────────────────────
  head('MIGRATIONS');
  try {
    const migrations = await p.$queryRaw`
      SELECT migration_name, finished_at
      FROM _prisma_migrations
      ORDER BY finished_at DESC
    `;
    migrations.forEach(m => {
      const status = m.finished_at ? ok(m.migration_name) : miss(m.migration_name + ' (PENDING)');
      line('', status);
    });
  } catch {
    line('Migration table', miss('Cannot read — check DB connection'));
  }

  // ── USER ACCOUNTS ──────────────────────────────────────────────────────────
  head('USER ACCOUNTS');
  try {
    const accounts = await p.user.findMany({
      select: { email: true, role: true, status: true, firstName: true, lastName: true },
      orderBy: { role: 'asc' }
    });
    if (accounts.length === 0) {
      line('', miss('No users — run: node src/prisma/seed.js'));
    } else {
      accounts.forEach(u => {
        const status = u.status === 'ACTIVE' ? '✅' : '⚠️ ';
        process.stdout.write(`    ${status} ${u.email.padEnd(38)} ${u.role.padEnd(12)} ${u.firstName} ${u.lastName}\n`);
      });
    }
  } catch (e) {
    line('', miss('Cannot read users: ' + e.message));
  }

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  head('QUICK COMMANDS');
  process.stdout.write('  Apply migrations:    npx prisma migrate deploy\n');
  process.stdout.write('  Regen Prisma client: npx prisma generate\n');
  process.stdout.write('  Seed base data:      node src/prisma/seed.js\n');
  process.stdout.write('  Seed demo data:      node src/prisma/seed-data.js\n');
  process.stdout.write('  Seed gift coins:     node seed-check.js --add-coins\n');
  process.stdout.write('  Open Prisma Studio:  npx prisma studio\n');
  process.stdout.write('\n');
}

// ── Optional: add test coins to all users ─────────────────────────────────────
async function addTestCoins() {
  process.stdout.write('\n💰  Adding 10,000 test coins to all users...\n');
  const users = await p.user.findMany({ select: { id: true, email: true } });
  let count = 0;
  for (const u of users) {
    await p.wallet.upsert({
      where:  { userId: u.id },
      create: { userId: u.id, coins: 10000, diamonds: 0, totalSpent: 0, totalEarned: 0 },
      update: { coins: { increment: 10000 } }
    });
    process.stdout.write(`  ✅  ${u.email} → +10,000 coins\n`);
    count++;
  }
  process.stdout.write(`\n  Done — ${count} wallets updated.\n\n`);
}

async function main() {
  try {
    await check();
    if (process.argv.includes('--add-coins')) {
      await addTestCoins();
    }
  } catch (e) {
    process.stdout.write('\n❌  Error: ' + e.message + '\n');
    process.stdout.write('    Make sure MySQL is running and DATABASE_URL is correct.\n\n');
  } finally {
    await p.$disconnect();
  }
}

main();
