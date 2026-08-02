/**
 * fix-voice-db.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Safely adds any missing Voice Club columns that may be absent if the DB was
 * restored from a backup older than the migrations that added them.
 *
 * Run: node src/prisma/fix-voice-db.js
 *
 * Safe to run multiple times — uses IF NOT EXISTS / IGNORE patterns.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function columnExists(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = ?
       AND COLUMN_NAME  = ?`,
    table, column
  );
  return Number(rows[0].cnt) > 0;
}

async function run() {
  console.log('🔧 Checking Voice Club database columns...\n');

  const fixes = [
    // gifts table
    { table: 'gifts', column: 'priority',    sql: "ALTER TABLE `gifts` ADD COLUMN `priority` VARCHAR(191) NOT NULL DEFAULT 'normal' AFTER `comboEnabled`" },
    { table: 'gifts', column: 'isPremium',   sql: "ALTER TABLE `gifts` ADD COLUMN `isPremium` BOOLEAN NOT NULL DEFAULT false AFTER `priority`" },
    // gift_transactions table
    { table: 'gift_transactions', column: 'priority',  sql: "ALTER TABLE `gift_transactions` ADD COLUMN `priority` VARCHAR(191) NOT NULL DEFAULT 'normal' AFTER `combo`" },
    { table: 'gift_transactions', column: 'isPremium', sql: "ALTER TABLE `gift_transactions` ADD COLUMN `isPremium` BOOLEAN NOT NULL DEFAULT false AFTER `priority`" },
    // voice_rooms table — cover image
    { table: 'voice_rooms', column: 'coverImageUrl',   sql: "ALTER TABLE `voice_rooms` ADD COLUMN `coverImageUrl` VARCHAR(191) NULL" },
    // voice_rooms table — comment settings
    { table: 'voice_rooms', column: 'commentsEnabled', sql: "ALTER TABLE `voice_rooms` ADD COLUMN `commentsEnabled` BOOLEAN NOT NULL DEFAULT true" },
    { table: 'voice_rooms', column: 'slowMode',        sql: "ALTER TABLE `voice_rooms` ADD COLUMN `slowMode` BOOLEAN NOT NULL DEFAULT false" },
    { table: 'voice_rooms', column: 'messageType',     sql: "ALTER TABLE `voice_rooms` ADD COLUMN `messageType` VARCHAR(191) NOT NULL DEFAULT 'all'" },
    // voice_rooms table — open mic
    { table: 'voice_rooms', column: 'isOpenMic',       sql: "ALTER TABLE `voice_rooms` ADD COLUMN `isOpenMic` BOOLEAN NOT NULL DEFAULT false" },
    // users table — bio
    { table: 'users', column: 'bio',                   sql: "ALTER TABLE `users` ADD COLUMN `bio` TEXT NULL" },
  ];

  let fixed = 0;
  let skipped = 0;

  for (const fix of fixes) {
    const exists = await columnExists(fix.table, fix.column);
    if (exists) {
      console.log(`  ✅ ${fix.table}.${fix.column} — already exists`);
      skipped++;
    } else {
      try {
        await prisma.$executeRawUnsafe(fix.sql);
        console.log(`  🔧 ${fix.table}.${fix.column} — ADDED`);
        fixed++;
      } catch (err) {
        console.error(`  ❌ ${fix.table}.${fix.column} — FAILED: ${err.message}`);
      }
    }
  }

  // Check for missing tables (social system, DMs)
  const tables = [
    { name: 'follows',          hint: 'Run: npx prisma migrate deploy' },
    { name: 'friend_requests',  hint: 'Run: npx prisma migrate deploy' },
    { name: 'dm_conversations', hint: 'Run: npx prisma migrate deploy' },
    { name: 'direct_messages',  hint: 'Run: npx prisma migrate deploy' },
    { name: 'wallets',          hint: 'Run: npx prisma migrate deploy' },
    { name: 'gifts',            hint: 'Run: npx prisma migrate deploy' },
    { name: 'gift_transactions',hint: 'Run: npx prisma migrate deploy' },
    { name: 'voice_rooms',      hint: 'Run: npx prisma migrate deploy' },
  ];

  console.log('\n📋 Checking required tables...\n');
  let missingTables = 0;
  for (const t of tables) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      t.name
    );
    if (Number(rows[0].cnt) === 0) {
      console.log(`  ❌ Table '${t.name}' is MISSING — ${t.hint}`);
      missingTables++;
    } else {
      console.log(`  ✅ Table '${t.name}' — exists`);
    }
  }

  console.log(`\n─────────────────────────────────────────`);
  console.log(`Columns: ${fixed} added, ${skipped} already existed`);
  if (missingTables > 0) {
    console.log(`\n⚠️  ${missingTables} table(s) missing!`);
    console.log(`   Run: cd backend && npx prisma migrate deploy && npx prisma generate`);
  } else {
    console.log(`Tables:  all present ✅`);
  }
  console.log(`─────────────────────────────────────────\n`);
}

run()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
