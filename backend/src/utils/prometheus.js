'use strict';

/**
 * Prometheus Metrics Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Wraps prom-client and exposes all application metrics as Prometheus
 * instruments. Designed to be the single source of truth for metric
 * definitions — both the requestLogger and the /metrics endpoint import
 * from here.
 *
 * Metric naming follows the Prometheus convention:
 *   <namespace>_<subsystem>_<name>_<unit>
 *   namespace = halqa
 *
 * Instruments defined here:
 *
 *   Counters (monotonically increasing):
 *     halqa_http_requests_total          {method, route, status_code}
 *     halqa_http_errors_total            {method, route, status_code, category}
 *     halqa_db_queries_total             {}
 *     halqa_db_slow_queries_total        {}
 *     halqa_socket_connections_total     {}   (lifetime connects)
 *     halqa_socket_disconnections_total  {}
 *     halqa_cache_hits_total             {}
 *     halqa_cache_misses_total           {}
 *
 *   Histograms (latency distributions — p50/p95/p99 ready):
 *     halqa_http_request_duration_ms     {method, route, status_code}
 *     halqa_db_query_duration_ms         {model, action}
 *     halqa_redis_ping_duration_ms       {}
 *
 *   Gauges (point-in-time):
 *     halqa_socket_connections_active    {}
 *     halqa_socket_rooms_active          {}
 *     halqa_active_users                 {}   (unique in last 5 min)
 *     halqa_process_uptime_seconds       {}
 *
 * Default Node.js metrics (GC, event loop lag, heap, file descriptors):
 *   Collected automatically by prom-client's collectDefaultMetrics().
 *   Prefix: halqa_nodejs_
 *
 * Usage:
 *   const prom = require('./prometheus');
 *   prom.httpRequestsTotal.inc({ method: 'GET', route: '/api/v1/users', status_code: '200' });
 *   prom.httpRequestDurationMs.observe({ method: 'GET', route: '/api/v1/users', status_code: '200' }, 45);
 * ─────────────────────────────────────────────────────────────────────────────
 */

const client = require('prom-client');

// ─── Registry ─────────────────────────────────────────────────────────────────
// Use a dedicated registry so we don't accidentally mix with other libraries
// that might also use the default registry.
const registry = new client.Registry();

// ─── HTTP metrics ─────────────────────────────────────────────────────────────

const httpRequestsTotal = new client.Counter({
  name:       'halqa_http_requests_total',
  help:       'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers:  [registry],
});

const httpErrorsTotal = new client.Counter({
  name:       'halqa_http_errors_total',
  help:       'Total number of HTTP errors (4xx + 5xx)',
  labelNames: ['method', 'route', 'status_code', 'category'],
  registers:  [registry],
});

// Histogram buckets in milliseconds — covers p50/p95/p99 for typical APIs.
// Buckets: 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s
const HTTP_DURATION_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

const httpRequestDurationMs = new client.Histogram({
  name:       'halqa_http_request_duration_ms',
  help:       'HTTP request duration in milliseconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets:    HTTP_DURATION_BUCKETS,
  registers:  [registry],
});

// ─── Database metrics ─────────────────────────────────────────────────────────

const dbQueriesTotal = new client.Counter({
  name:      'halqa_db_queries_total',
  help:      'Total number of database queries executed',
  registers: [registry],
});

const dbSlowQueriesTotal = new client.Counter({
  name:      'halqa_db_slow_queries_total',
  help:      'Total number of slow database queries (above threshold)',
  registers: [registry],
});

// Buckets in ms — DB queries should be fast; flag anything over 1s
const DB_DURATION_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

const dbQueryDurationMs = new client.Histogram({
  name:       'halqa_db_query_duration_ms',
  help:       'Database query duration in milliseconds',
  labelNames: ['model', 'action'],
  buckets:    DB_DURATION_BUCKETS,
  registers:  [registry],
});

// ─── Redis metrics ────────────────────────────────────────────────────────────

const redisPingDurationMs = new client.Histogram({
  name:    'halqa_redis_ping_duration_ms',
  help:    'Redis PING round-trip latency in milliseconds',
  buckets: [0.5, 1, 2, 5, 10, 25, 50, 100, 250],
  registers: [registry],
});

const cacheHitsTotal = new client.Counter({
  name:      'halqa_cache_hits_total',
  help:      'Total number of cache hits',
  registers: [registry],
});

const cacheMissesTotal = new client.Counter({
  name:      'halqa_cache_misses_total',
  help:      'Total number of cache misses',
  registers: [registry],
});

// ─── Socket.IO metrics ────────────────────────────────────────────────────────

const socketConnectionsTotal = new client.Counter({
  name:      'halqa_socket_connections_total',
  help:      'Total number of Socket.IO connections (lifetime)',
  registers: [registry],
});

const socketDisconnectionsTotal = new client.Counter({
  name:      'halqa_socket_disconnections_total',
  help:      'Total number of Socket.IO disconnections (lifetime)',
  registers: [registry],
});

const socketConnectionsActive = new client.Gauge({
  name:      'halqa_socket_connections_active',
  help:      'Current number of active Socket.IO connections',
  registers: [registry],
});

const socketRoomsActive = new client.Gauge({
  name:      'halqa_socket_rooms_active',
  help:      'Current number of active Socket.IO rooms',
  registers: [registry],
});

// ─── Application gauges ───────────────────────────────────────────────────────

const activeUsers = new client.Gauge({
  name:      'halqa_active_users',
  help:      'Number of unique users active in the last 5 minutes',
  registers: [registry],
});

const processUptimeSeconds = new client.Gauge({
  name:      'halqa_process_uptime_seconds',
  help:      'Process uptime in seconds',
  registers: [registry],
  // Collect callback — called every time the registry is scraped
  collect() {
    this.set(Math.round(process.uptime()));
  },
});

// ─── Exports ──────────────────────────────────────────────────────────────────

// ─── API versioning metrics ───────────────────────────────────────────────────

const apiDeprecatedUsage = new client.Counter({
  name:       'halqa_api_deprecated_usage_total',
  help:       'Total number of requests made to deprecated API versions',
  labelNames: ['version', 'endpoint'],
  registers:  [registry],
});

// ─── Rate limit metrics ───────────────────────────────────────────────────────

const rateLimitHitsTotal = new client.Counter({
  name:       'halqa_rate_limit_hits_total',
  help:       'Total number of rate limit hits',
  labelNames: ['type'], // 'user', 'device', 'global', 'auth'
  registers:  [registry],
});

// ─── Circuit breaker metrics ──────────────────────────────────────────────────

const circuitBreakerStateChanges = new client.Counter({
  name:       'halqa_circuit_breaker_state_changes_total',
  help:       'Total number of circuit breaker state changes',
  labelNames: ['service', 'from_state', 'to_state'],
  registers:  [registry],
});

// ─── Session management metrics ────────────────────────────────────────────────

const sessionCreationsTotal = new client.Counter({
  name:       'halqa_session_creations_total',
  help:       'Total number of sessions created',
  labelNames: ['device_type'],
  registers:  [registry],
});

const sessionTerminationsTotal = new client.Counter({
  name:       'halqa_session_terminations_total',
  help:       'Total number of sessions terminated',
  labelNames: ['reason'], // SESSION_LIMIT, USER_TERMINATED, USER_TERMINATED_ALL
  registers:  [registry],
});

const activeSessions = new client.Gauge({
  name:      'halqa_active_sessions',
  help:      'Current number of active sessions',
  registers: [registry],
});

// ─── Idempotency metrics ───────────────────────────────────────────────────────

const idempotencyHitsTotal = new client.Counter({
  name:       'halqa_idempotency_hits_total',
  help:       'Total number of idempotency cache hits (duplicate requests)',
  labelNames: ['endpoint'],
  registers:  [registry],
});

const idempotencyMissesTotal = new client.Counter({
  name:       'halqa_idempotency_misses_total',
  help:       'Total number of idempotency cache misses (new requests)',
  labelNames: ['endpoint'],
  registers:  [registry],
});

// ─── Alerting metrics ─────────────────────────────────────────────────────────

const alertsSentTotal = new client.Counter({
  name:       'halqa_alerts_sent_total',
  help:       'Total number of alerts sent',
  labelNames: ['channel', 'severity'], // channel: slack, pagerduty, email, webhook
  registers:  [registry],
});

const alertsFailedTotal = new client.Counter({
  name:       'halqa_alerts_failed_total',
  help:       'Total number of failed alert attempts',
  labelNames: ['channel'],
  registers:  [registry],
});

module.exports = {
  // Registry — used by the /metrics endpoint
  registry,

  // HTTP
  httpRequestsTotal,
  httpErrorsTotal,
  httpRequestDurationMs,

  // Database
  dbQueriesTotal,
  dbSlowQueriesTotal,
  dbQueryDurationMs,

  // Redis
  redisPingDurationMs,
  cacheHitsTotal,
  cacheMissesTotal,

  // Socket.IO
  socketConnectionsTotal,
  socketDisconnectionsTotal,
  socketConnectionsActive,
  socketRoomsActive,

  // Application
  activeUsers,
  processUptimeSeconds,

  // API versioning
  apiDeprecatedUsage,

  // Rate limiting
  rateLimitHitsTotal,

  // Circuit breaker
  circuitBreakerStateChanges,

  // Session management
  sessionCreationsTotal,
  sessionTerminationsTotal,
  activeSessions,

  // Idempotency
  idempotencyHitsTotal,
  idempotencyMissesTotal,

  // Alerting
  alertsSentTotal,
  alertsFailedTotal,
};

// ─── Default Node.js metrics (GC, event loop, heap, file descriptors) ────────
// Prefix: halqa_nodejs_ to avoid collision with custom metrics.
client.collectDefaultMetrics({ register: registry, prefix: 'halqa_nodejs_' });
