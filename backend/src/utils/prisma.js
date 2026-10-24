'use strict';

/**
 * Prisma Client — Production-optimized singleton with query monitoring
 * ─────────────────────────────────────────────────────────────────────────────
 * Connection pool:
 *   DB_POOL_SIZE     — max simultaneous connections (default: 10 prod / 5 dev)
 *   DB_POOL_TIMEOUT  — seconds to wait for a free connection (default: 10)
 *
 * Query monitoring:
 *   All environments: slow queries (> SLOW_QUERY_THRESHOLD_MS) are logged
 *                     and counted in metrics.
 *   Development only: all queries are logged at debug level.
 *
 * N+1 detection (development):
 *   If the same query model is called > N_PLUS_ONE_THRESHOLD times within
 *   N_PLUS_ONE_WINDOW_MS, a warning is emitted. This is a heuristic — it
 *   catches obvious loops but is not a substitute for EXPLAIN ANALYZE.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');
const logger  = require('./logger');
const metrics = require('./metrics');
const prom    = require('./prometheus');

const IS_DEV  = process.env.NODE_ENV !== 'production';
const SLOW_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '200', 10);

// N+1 detection thresholds (dev only)
const N_PLUS_ONE_THRESHOLD = 10;  // same model called this many times…
const N_PLUS_ONE_WINDOW_MS = 500; // …within this window

// ─── Connection URL with pool settings ───────────────────────────────────────
function buildDatabaseUrl() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set');

  const url      = new URL(base);
  const poolSize = process.env.DB_POOL_SIZE
    ? parseInt(process.env.DB_POOL_SIZE, 10)
    // DB-009: Production pool default raised to 25 (from 10).
    // With 50+ concurrent requests, a pool of 10 causes request queuing and
    // timeout errors. 25 handles typical production load safely.
    // Override via DB_POOL_SIZE env var if your DB server has lower limits.
    : IS_DEV ? 5 : 25;

  url.searchParams.set('connection_limit', String(poolSize));
  url.searchParams.set('pool_timeout',     process.env.DB_POOL_TIMEOUT || '10');
  url.searchParams.set('connect_timeout',  '5');
  url.searchParams.set('socket_timeout',   '60');

  return url.toString();
}

// ─── Prisma client ────────────────────────────────────────────────────────────
const prisma = new PrismaClient({
  datasources: { db: { url: buildDatabaseUrl() } },

  log: [
    // Always emit query events so our handler can measure duration
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn'  },
  ],

  errorFormat: 'minimal',
});

// ─── Query event handler ──────────────────────────────────────────────────────
prisma.$on('query', (e) => {
  const durationMs = e.duration;

  // ── In-memory metrics ──────────────────────────────────────────────────────
  metrics.increment('dbQueriesTotal');
  if (durationMs >= SLOW_MS) metrics.increment('dbSlowQueries');

  // ── Prometheus metrics ─────────────────────────────────────────────────────
  prom.dbQueriesTotal.inc();
  if (durationMs >= SLOW_MS) prom.dbSlowQueriesTotal.inc();

  // Extract model and action from the query string for the histogram label.
  // Prisma query strings look like: SELECT ... FROM `users` WHERE ...
  // We use a simple heuristic — not perfect but good enough for dashboards.
  const modelMatch  = e.query.match(/(?:FROM|INTO|UPDATE|JOIN)\s+`?(\w+)`?/i);
  const actionMatch = e.query.match(/^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i);
  const model  = modelMatch?.[1]  ?? 'unknown';
  const action = actionMatch?.[1] ?? 'unknown';

  prom.dbQueryDurationMs.observe({ model, action }, durationMs);

  if (durationMs >= SLOW_MS) {
    logger.warn('[prisma:slow]', {
      durationMs,
      query:  e.query.slice(0, 300),
      params: IS_DEV ? e.params?.slice(0, 200) : '[redacted]',
      target: e.target,
    });
  } else if (IS_DEV) {
    logger.debug('[prisma:query]', {
      durationMs,
      query: e.query.slice(0, 200),
    });
  }
});

prisma.$on('error', (e) => {
  logger.error('[prisma:error]', { message: e.message, target: e.target });
});

prisma.$on('warn', (e) => {
  logger.warn('[prisma:warn]', { message: e.message });
});

// ─── N+1 detection (development only) ────────────────────────────────────────
// Tracks how many times each model is queried within a short window.
// A burst of identical model queries usually indicates a missing include.
if (IS_DEV) {
  const modelCallLog = new Map(); // model → [timestamp, ...]

  prisma.$use(async (params, next) => {
    const model = params.model || 'unknown';
    const now   = Date.now();

    let calls = modelCallLog.get(model) || [];
    // Keep only calls within the window
    calls = calls.filter(t => now - t < N_PLUS_ONE_WINDOW_MS);
    calls.push(now);
    modelCallLog.set(model, calls);

    if (calls.length >= N_PLUS_ONE_THRESHOLD) {
      logger.warn('[prisma:n+1]', {
        model,
        action:  params.action,
        calls:   calls.length,
        windowMs: N_PLUS_ONE_WINDOW_MS,
        hint:    `Possible N+1: ${model}.${params.action} called ${calls.length}x in ${N_PLUS_ONE_WINDOW_MS}ms — consider using include/select`,
      });
      // Reset to avoid flooding logs
      modelCallLog.set(model, []);
    }

    return next(params);
  });
}

module.exports = prisma;
