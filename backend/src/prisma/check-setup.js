/**
 * Pre-flight check — run before starting the server
 * node src/prisma/check-setup.js
 */
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function ok(msg)   { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌ ${msg}`); failed++; }
function info(msg) { console.log(`  ℹ️  ${msg}`); }

async function run() {
  console.log('\n🔍 Halqa Setup Check\n');

  // ── 1. .env file ──────────────────────────────────────────────────────────
  console.log('📋 Environment');
  const envPath = path.join(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    ok('.env file found');
    require('dotenv').config({ path: envPath });

    if (process.env.DATABASE_URL) ok('DATABASE_URL set');
    else fail('DATABASE_URL missing in .env');

    if (process.env.JWT_SECRET) ok('JWT_SECRET set');
    else fail('JWT_SECRET missing in .env');

    if (process.env.JWT_REFRESH_SECRET) ok('JWT_REFRESH_SECRET set');
    else fail('JWT_REFRESH_SECRET missing in .env');
  } else {
    fail('.env file not found — copy .env.example to .env');
  }

  // ── 2. Prisma client ──────────────────────────────────────────────────────
  console.log('\n🗄️  Database');
  try {
    const { PrismaClient } = require('@prisma/client');
    ok('Prisma client generated');

    const prisma = new PrismaClient();
    try {
      await prisma.$connect();
      ok('MySQL connection successful');

      // Check tables exist
      const tables = await prisma.$queryRaw`SHOW TABLES`;
      const tableNames = tables.map(t => Object.values(t)[0]);
      const required = ['users', 'students', 'teachers', 'classes', 'attendance', 'grades'];
      const missing = required.filter(t => !tableNames.includes(t));

      if (missing.length === 0) {
        ok(`All required tables exist (${tableNames.length} total)`);
      } else {
        fail(`Missing tables: ${missing.join(', ')} — run: npx prisma migrate dev`);
      }

      // Check seed data
      const userCount = await prisma.user.count();
      if (userCount > 0) {
        ok(`${userCount} users in database`);
      } else {
        info('No users found — run: node src/prisma/seed.js');
      }

      await prisma.$disconnect();
    } catch (dbErr) {
      fail(`MySQL connection failed: ${dbErr.message}`);
      info('Make sure XAMPP MySQL is running on port 3306');
    }
  } catch (e) {
    fail('Prisma client not generated — run: npx prisma generate');
  }

  // ── 3. Required packages ──────────────────────────────────────────────────
  console.log('\n📦 Packages');
  const required = ['express', 'bcryptjs', 'jsonwebtoken', 'multer', 'exceljs', 'pdfkit', 'socket.io', 'nodemailer', 'uuid', 'winston'];
  let allOk = true;
  for (const pkg of required) {
    try { require(pkg); }
    catch { fail(`Missing package: ${pkg} — run: npm install`); allOk = false; }
  }
  if (allOk) ok('All required packages installed');

  // ── 4. Upload directories ─────────────────────────────────────────────────
  console.log('\n📁 Directories');
  const dirs = [
    path.join(__dirname, '../../uploads'),
    path.join(__dirname, '../../uploads/audio'),
    path.join(__dirname, '../../uploads/avatars'),
    path.join(__dirname, '../../logs'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      ok(`Created: ${path.relative(process.cwd(), dir)}`);
    } else {
      ok(`Exists: ${path.relative(process.cwd(), dir)}`);
    }
  }

  // ── 5. Summary ────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed\n`);

  if (failed === 0) {
    console.log('🚀 Everything looks good! Run: npm run dev\n');
    process.exit(0);
  } else {
    console.log('⚠️  Fix the issues above before starting the server.\n');
    process.exit(1);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
