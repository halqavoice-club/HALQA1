'use strict';

/**
 * Production Environment Validator
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates that all required environment variables are set before the server
 * attempts to connect to any external service.
 *
 * Called once at the top of startServer() in app.js.
 * Throws immediately with a clear message listing every missing variable so
 * the operator knows exactly what to fix before the process exits.
 *
 * Rules:
 *   - In production (NODE_ENV=production): hard fail on any missing required var.
 *   - In development: warn only — allows partial local setups to still run.
 *
 * Categories:
 *   REQUIRED_ALWAYS   — must exist in every environment (DB, JWT)
 *   REQUIRED_PROD     — must exist in production only (Redis password, LiveKit, Stripe)
 *   INSECURE_DEFAULTS — values that must be changed from their placeholder defaults
 * ─────────────────────────────────────────────────────────────────────────────
 */

const IS_PROD = process.env.NODE_ENV === 'production';

// ─── Variables required in EVERY environment ─────────────────────────────────
const REQUIRED_ALWAYS = [
  { key: 'DATABASE_URL',        hint: 'mysql://user:pass@host:3306/dbname' },
  { key: 'JWT_SECRET',          hint: 'A random 32+ character string' },
  { key: 'JWT_REFRESH_SECRET',  hint: 'A different random 32+ character string' },
  { key: 'PORT',                hint: '5000' },
];

// ─── Minimum secret lengths ───────────────────────────────────────────────────
// SEC-001: Short or guessable JWT secrets allow offline brute-force attacks
// against captured tokens. Enforce a minimum of 32 characters in all envs.
const SECRET_MIN_LENGTH = [
  { key: 'JWT_SECRET',         min: 32 },
  { key: 'JWT_REFRESH_SECRET', min: 32 },
];

// ─── Variables required in PRODUCTION only ───────────────────────────────────
const REQUIRED_PROD = [
  { key: 'REDIS_URL',             hint: 'redis://:password@redis:6379' },
  { key: 'CLIENT_URL',            hint: 'https://yourdomain.com' },
  { key: 'LIVEKIT_URL',           hint: 'wss://your-project.livekit.cloud' },
  { key: 'LIVEKIT_API_KEY',       hint: 'From your LiveKit project dashboard' },
  { key: 'LIVEKIT_API_SECRET',    hint: 'From your LiveKit project dashboard' },
  { key: 'STRIPE_SECRET_KEY',     hint: 'sk_live_... from Stripe dashboard' },
  { key: 'STRIPE_WEBHOOK_SECRET', hint: 'whsec_... from Stripe webhook settings' },
  { key: 'SMTP_HOST',             hint: 'smtp.yourmailprovider.com' },
  { key: 'SMTP_USER',             hint: 'your@email.com' },
  { key: 'SMTP_PASS',             hint: 'Your SMTP password or app password' },
];

// ─── Values that must NOT remain at their placeholder defaults ────────────────
const INSECURE_DEFAULTS = [
  {
    key:     'JWT_SECRET',
    pattern: /halqa_jwt_secret_change_in_production/i,
    hint:    'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  },
  {
    key:     'JWT_REFRESH_SECRET',
    pattern: /halqa_refresh_secret_change_in_production/i,
    hint:    'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  },
  {
    key:     'METRICS_TOKEN',
    pattern: /halqa_metrics_dev_token_change_in_production/i,
    hint:    'Set to a random secret to protect the /metrics endpoint'
  },
];

// ─── Validator ────────────────────────────────────────────────────────────────
function validateEnv() {
  const errors   = [];
  const warnings = [];

  // Check always-required vars
  for (const { key, hint } of REQUIRED_ALWAYS) {
    if (!process.env[key]) {
      errors.push(`  ✗ ${key} is not set\n      Hint: ${hint}`);
    }
  }

  // SEC-001: Enforce minimum secret length (all environments)
  // A JWT_SECRET shorter than 32 characters is trivially brute-forced offline.
  for (const { key, min } of SECRET_MIN_LENGTH) {
    const val = process.env[key];
    if (val && val.length < min) {
      const target = IS_PROD ? errors : warnings;
      target.push(
        `  ✗ ${key} is too short (${val.length} chars). Minimum is ${min} characters.\n` +
        `      Generate one: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
      );
    }
  }

  // Check production-only vars
  if (IS_PROD) {
    for (const { key, hint } of REQUIRED_PROD) {
      if (!process.env[key]) {
        errors.push(`  ✗ ${key} is not set\n      Hint: ${hint}`);
      }
    }

    // Check for insecure default values
    for (const { key, pattern, hint } of INSECURE_DEFAULTS) {
      const val = process.env[key];
      if (val && pattern.test(val)) {
        errors.push(`  ✗ ${key} is still set to the insecure default value\n      Hint: ${hint}`);
      }
    }
  } else {
    // Development: warn about insecure defaults but don't block startup
    for (const { key, pattern, hint } of INSECURE_DEFAULTS) {
      const val = process.env[key];
      if (val && pattern.test(val)) {
        warnings.push(`  ⚠  ${key} is using the default value — change before deploying to production\n      Hint: ${hint}`);
      }
    }
  }

  // ── Connection pool size warning ────────────────────────────────────────────
  // Requirement 2.4: warn when connection_limit is not set in DATABASE_URL
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl && !dbUrl.includes('connection_limit')) {
    const target = IS_PROD ? warnings : warnings;
    target.push(
      '  ⚠  DATABASE_URL does not include connection_limit. Under high traffic the default ' +
      'pool size (5-10) may cause queuing.\n' +
      '      Recommendation: append ?connection_limit=25&pool_timeout=10 to your DATABASE_URL'
    );
  }

  // ── Alerting configuration warning (production) ──────────────────────────
  if (IS_PROD && !process.env.SLACK_WEBHOOK_URL && !process.env.PAGERDUTY_ROUTING_KEY) {
    warnings.push(
      '  ⚠  Neither SLACK_WEBHOOK_URL nor PAGERDUTY_ROUTING_KEY is set.\n' +
      '      Production incidents will not trigger automatic alerts.\n' +
      '      Set at least one in your .env or Docker environment.'
    );
  }

  // ── Report warnings (development) ─────────────────────────────────────────
  if (warnings.length > 0) {
    console.warn('\n⚠️  HALQA — Environment warnings (safe to ignore in development):');
    warnings.forEach(w => console.warn(w));
    console.warn('');
  }

  // ── Report errors and exit ─────────────────────────────────────────────────
  if (errors.length > 0) {
    console.error('\n❌ HALQA — FATAL: Required environment variables are missing or insecure.\n');
    console.error(`   Found ${errors.length} problem(s) in NODE_ENV="${process.env.NODE_ENV || 'undefined'}":\n`);
    errors.forEach(e => console.error(e));
    console.error('\n   Fix the above issues in your .env file or Docker environment before starting.\n');
    process.exit(1);
  }
}

module.exports = { validateEnv };
