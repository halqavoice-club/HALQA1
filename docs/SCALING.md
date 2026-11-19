# HALQA — Scaling & Infrastructure Guide

## Current Architecture (Single-Node)

The default production setup runs one backend container, one Redis instance, and one MariaDB 10.11 instance. This handles up to approximately **2,000–3,000 concurrent Socket.IO connections** on a 4-core VPS before CPU becomes the bottleneck.

```
nginx (80/443)
    ├── frontend:3000
    └── backend:5000
         ├── MariaDB 10.11 (single node)
         └── Redis (single node, in-memory fallback if down)
```

---

## Redis: Single vs Cluster Mode

Two Redis files exist in `backend/src/utils/`:

| File | Mode | When to use |
|---|---|---|
| `redis.js` | Single instance | Default — dev and production (≤5k connections) |
| `redisCluster.js` | Redis Cluster | When Redis becomes a bottleneck (>5k connections) |

### Switching to Redis Cluster

1. Provision 3+ Redis nodes (e.g. Redis Cloud Flex, AWS ElastiCache Cluster)
2. Set env vars:
   ```env
   REDIS_CLUSTER=true
   REDIS_CLUSTER_NODES=redis1:6379,redis2:6379,redis3:6379
   REDIS_PASSWORD=your_password
   ```
3. In `backend/src/utils/prisma.js`, no change needed — Redis is accessed via `utils/redis.js`
4. Update `app.js` Socket.IO adapter section to use `redisCluster.js` when `REDIS_CLUSTER=true`

The `redisCluster.js` file exports the same interface as `redis.js` (`getCache`, `setCache`, `deleteCache`) so the switch is drop-in.

---

## Horizontal Backend Scaling

To run multiple backend instances behind nginx:

### 1. Update `docker-compose.prod.yml`

```yaml
backend:
  deploy:
    replicas: 3
  # ... existing config ...
```

### 2. Configure nginx upstream with sticky sessions

Socket.IO requires sticky sessions (or Redis pub/sub adapter). The `@socket.io/redis-adapter` is already installed and wired — it uses the Redis instance to broadcast events across all backend nodes.

```nginx
upstream backend_pool {
    ip_hash;  # sticky sessions — required for Socket.IO polling transport
    server backend_1:5000;
    server backend_2:5000;
    server backend_3:5000;
}
```

### 3. Leader election

`backend/src/utils/leaderElection.js` uses Redis to elect a single leader among backend nodes. The leader runs cron jobs (cleanup worker, scheduled posts) so they don't fire on every instance. This is already initialized in `app.js`:

```js
leaderElection.initialize('halqa-backend')
```

No changes needed — it becomes active automatically when multiple instances share the same Redis.

---

## Elasticsearch: Active / Fallback Behaviour

`backend/src/utils/elasticsearch.js` and `backend/src/utils/search.js` check for the `ELASTICSEARCH_URL` environment variable:

- **If set**: search queries use Elasticsearch for full-text (`MATCH ... AGAINST`)
- **If not set**: falls back to MySQL `LIKE '%query%'` (slower, but functional)

To enable Elasticsearch:
```env
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_API_KEY=optional_if_using_auth
```

The fallback is transparent — no code changes needed. The switch is entirely driven by the env var.

---

## LiveKit: Health Check & Degradation

If the LiveKit server is unreachable, Voice Club and Live Classes will fail silently. The `/health` endpoint includes a LiveKit connectivity check:

```
GET /health/detailed
```

This returns `livekit: { status: 'ok' | 'error', latency_ms: N }` so load balancers and monitoring can detect outages.

**Graceful degradation**: The frontend checks the `/health/detailed` endpoint on Voice Club page load. If `livekit.status === 'error'`, it shows a banner:
> "Live audio is temporarily unavailable. Please try again in a few minutes."

This is implemented in `frontend/src/components/voice/VoiceRoomView.tsx` via the `useNetworkQuality` hook.

---

## Load Testing

Load test scripts are in `scripts/load-test/` (create this folder):

Recommended tools:
- **k6** — JavaScript-based, good for WebSocket + REST
- **Artillery** — YAML-based, simple setup

### Quick k6 test

```bash
# Install: https://k6.io/docs/get-started/installation/
k6 run scripts/load-test/voice-room.js

# Target: 100 concurrent users joining a voice room
# Pass threshold: p95 latency < 500ms, error rate < 1%
```

---

## Database Connection Pool

The connection pool is configured via `DATABASE_URL`:

```env
DATABASE_URL="mysql://user:pass@host:3306/halqa_db?connection_limit=25&pool_timeout=10"
```

- `connection_limit=25` — max concurrent DB connections (default: 5–10)
- `pool_timeout=10` — seconds to wait for a free connection before rejecting

**Recommended values by deployment size:**

| Concurrent users | connection_limit | Notes |
|---|---|---|
| < 500 | 10 | Default XAMPP setup |
| 500–2,000 | 25 | Standard production |
| 2,000–10,000 | 50 | Multi-core VPS or managed DB |
| 10,000+ | Managed MariaDB (AWS RDS for MariaDB) or self-hosted with MaxScale/ProxySQL | Managed connection pooling and read replicas |

> **Note:** Prisma provider remains `mysql` (Prisma's correct setting for MariaDB).
