#!/usr/bin/env node
/**
 * validate-prod-env.js
 *
 * Run BEFORE docker-compose.prod.yml to catch placeholder values.
 * Usage:
 *   node scripts/validate-prod-env.js .env.docker.local
 *
 * Exit code 0 = all good, exit code 1 = found problems.
 */

const fs   = require('fs');
const path = require('path');

const envFile = process.argv[2] || '.env.docker.local';
const filePath = path.resolve(process.cwd(), envFile);

if (!fs.existsSync(filePath)) {
  console.error(`\n❌  File not found: ${filePath}`);
  console.error('    Create it: cp .env.docker .env.docker.local  then fill in all values\n');
  process.exit(1);
}

const lines = fs.readFileSync(filePath, 'utf8').split('\n');
const vars = {};
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const [key, ...rest] = trimmed.split('=');
  if (key) vars[key.trim()] = rest.join('=').trim();
}

const REQUIRED = [
  // Database
  { key: 'MYSQL_ROOT_PASSWORD',   minLen: 20, noPlaceholder: true },
  { key: 'MYSQL_PASSWORD',        minLen: 20, noPlaceholder: true },
  // Redis
  { key: 'REDIS_PASSWORD',        minLen: 16, noPlaceholder: true },
  // JWT
  { key: 'JWT_SECRET',            minLen: 32, noPlaceholder: true },
  { key: 'JWT_REFRESH_SECRET',    minLen: 32, noPlaceholder: true, differentFrom: 'JWT_SECRET' },
  // App URL
  { key: 'CLIENT_URL',            pattern: /^https:\/\/.+/, message: 'must start with https://' },
  { key: 'NEXT_PUBLIC_API_URL',   pattern: /^https:\/\/.+/, message: 'must start with https://' },
  // Email
  { key: 'SMTP_USER',             noPlaceholder: true },
  { key: 'SMTP_PASS',             noPlaceholder: true },
  // Storage
  { key: 'R2_ACCOUNT_ID',         noPlaceholder: true },
  { key: 'R2_ACCESS_KEY_ID',      noPlaceholder: true },
  { key: 'R2_SECRET_ACCESS_KEY',  noPlaceholder: true },
  { key: 'R2_PUBLIC_URL',         noPlaceholder: true },
  // LiveKit
  { key: 'LIVEKIT_URL',           noPlaceholder: true },
  { key: 'LIVEKIT_API_KEY',       noPlaceholder: true },
  { key: 'LIVEKIT_API_SECRET',    noPlaceholder: true },
  // Stripe
  { key: 'STRIPE_SECRET_KEY',     pattern: /^sk_live_/, message: 'must start with sk_live_ (not sk_test_)' },
  { key: 'STRIPE_PUBLISHABLE_KEY',pattern: /^pk_live_/, message: 'must start with pk_live_ (not pk_test_)' },
  { key: 'STRIPE_WEBHOOK_SECRET', pattern: /^whsec_[a-zA-Z0-9]{10,}/, message: 'must start with whsec_ followed by real secret (not placeholder)' },
  // Security
  { key: 'ADMIN_IP_ALLOWLIST',    noPlaceholder: true, canBeEmpty: true },
  { key: 'METRICS_TOKEN',         minLen: 16, noPlaceholder: true },
  { key: 'TOTP_ENCRYPTION_KEY',   minLen: 16, noPlaceholder: true },
];

const PLACEHOLDER_PATTERNS = [
  /CHANGE_ME/i,
  /REPLACE_WITH/i,
  /your-/i,
  /yourdomain\.com/,
  /sk_test_/,
  /pk_test_/,
];

let errors = 0;
let warnings = 0;

function fail(key, msg) {
  console.error(`  ❌  ${key}: ${msg}`);
  errors++;
}
function warn(key, msg) {
  console.warn(`  ⚠️   ${key}: ${msg}`);
  warnings++;
}

console.log(`\n🔍  Validating: ${filePath}\n`);

for (const rule of REQUIRED) {
  const val = vars[rule.key];

  if (!val && !rule.canBeEmpty) {
    fail(rule.key, 'missing or empty');
    continue;
  }

  if (val && rule.noPlaceholder && !rule.canBeEmpty) {
    for (const pat of PLACEHOLDER_PATTERNS) {
      if (pat.test(val)) {
        fail(rule.key, `still contains placeholder value: "${val.slice(0, 40)}"`);
        break;
      }
    }
  }

  if (val && rule.minLen && val.length < rule.minLen) {
    fail(rule.key, `too short — minimum ${rule.minLen} characters, got ${val.length}`);
  }

  if (val && rule.pattern && !rule.pattern.test(val)) {
    fail(rule.key, rule.message || `does not match expected pattern`);
  }

  if (rule.differentFrom && val === vars[rule.differentFrom]) {
    fail(rule.key, `must be DIFFERENT from ${rule.differentFrom}`);
  }
}

// Warn about empty ADMIN_IP_ALLOWLIST
if (!vars['ADMIN_IP_ALLOWLIST'] || vars['ADMIN_IP_ALLOWLIST'] === '') {
  warn('ADMIN_IP_ALLOWLIST', 'is empty — admin endpoints are accessible from any IP. Set to your VPN/office IP for better security.');
}

// Check NODE_ENV
if (vars['NODE_ENV'] && vars['NODE_ENV'] !== 'production') {
  warn('NODE_ENV', `should be "production" in production, got "${vars['NODE_ENV']}"`);
}

console.log('');
if (errors > 0) {
  console.error(`❌  ${errors} error(s) found. Fix all errors before deploying.\n`);
  if (warnings > 0) console.warn(`⚠️   ${warnings} warning(s).\n`);
  process.exit(1);
} else {
  if (warnings > 0) {
    console.warn(`⚠️   ${warnings} warning(s) — review before deploying.`);
  }
  console.log(`✅  All required environment variables look good.\n`);
  console.log(`    Deploy with:`);
  console.log(`    docker-compose -f docker-compose.prod.yml --env-file ${envFile} up -d --build\n`);
  process.exit(0);
}
