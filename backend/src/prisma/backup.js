/**
 * Database backup script
 * Run manually: node src/prisma/backup.js
 * Or schedule with Windows Task Scheduler / cron
 */
require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DB_URL = process.env.DATABASE_URL || 'mysql://root:@localhost:3306/halqa_db';
const BACKUP_DIR = path.join(process.cwd(), 'backups');
const MAX_BACKUPS = 7; // keep last 7 days

// Parse DB URL
function parseDbUrl(url) {
  const match = url.match(/mysql:\/\/([^:]*):([^@]*)@([^:]+):(\d+)\/(.+)/);
  if (!match) throw new Error('Invalid DATABASE_URL format');
  return { user: match[1], pass: match[2], host: match[3], port: match[4], db: match[5] };
}

async function backup() {
  // Ensure backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const { user, pass, host, port, db } = parseDbUrl(DB_URL);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${db}_${timestamp}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);

  console.log(`📦 Starting backup of ${db}...`);

  try {
    // Build mysqldump command
    const passArg = pass ? `-p${pass}` : '';
    const cmd = `mysqldump -u ${user} ${passArg} -h ${host} -P ${port} --single-transaction --routines --triggers ${db}`;

    const sql = execSync(cmd, { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
    fs.writeFileSync(filepath, sql, 'utf8');

    const sizeMB = (fs.statSync(filepath).size / (1024 * 1024)).toFixed(2);
    console.log(`✅ Backup saved: ${filename} (${sizeMB} MB)`);

    // Clean up old backups
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith(db) && f.endsWith('.sql'))
      .sort()
      .reverse();

    if (backups.length > MAX_BACKUPS) {
      const toDelete = backups.slice(MAX_BACKUPS);
      toDelete.forEach(f => {
        fs.unlinkSync(path.join(BACKUP_DIR, f));
        console.log(`🗑️  Deleted old backup: ${f}`);
      });
    }

    console.log(`\n📊 Backup summary:`);
    console.log(`   File: ${filepath}`);
    console.log(`   Size: ${sizeMB} MB`);
    console.log(`   Total backups kept: ${Math.min(backups.length, MAX_BACKUPS)}`);

    return { success: true, file: filepath, size: sizeMB };
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    // Clean up partial file
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    process.exit(1);
  }
}

backup();
