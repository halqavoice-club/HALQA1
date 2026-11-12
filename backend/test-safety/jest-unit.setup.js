'use strict';

// Defense in depth for direct config use. The guarded launcher already omits
// these values from the child environment.
for (const name of [
  'DATABASE_URL', 'TEST_DATABASE_URL', 'DESTRUCTIVE_TEST_AUTHORIZATION',
  'REDIS_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'SMTP_PASS',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
]) {
  delete process.env[name];
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  HALQA_TEST_MODE: 'unit',
  JWT_SECRET: 'unit_jwt_secret_at_least_32_characters_long!!',
  JWT_REFRESH_SECRET: 'unit_refresh_secret_at_least_32_chars_long!!',
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '7d',
  PORT: '5001',
  SERVICE_NAME: 'halqa-unit-test',
  STRIPE_SKIP_SIGNATURE: 'true',
  LIVEKIT_URL: 'wss://unit.invalid',
  LIVEKIT_API_KEY: 'unit_api_key_32_chars_minimum!',
  LIVEKIT_API_SECRET: 'unit_api_secret_32_chars_minimum!',
  STORAGE_TYPE: 'local',
  METRICS_TOKEN: 'unit_metrics_token_32_chars_minimum!!',
  HEALTH_TOKEN: 'unit_health_token_32_chars_minimum!!',
  CLIENT_URL: 'http://localhost:3000',
  PAYOUT_ENCRYPTION_KEY: 'unit_payout_encryption_key_32bytes!!',
});
