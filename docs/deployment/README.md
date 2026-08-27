# HALQA Deployment + Production

**Audit date:** 2026-08-26  
**Status:** Read-only documentation audit. No application code modified.

---

## Infrastructure

| Service | Technology | Required |
|---------|-----------|---------|
| Backend | Node.js 20, Express | ✅ |
| Frontend | Next.js 14 (standalone) | ✅ |
| Database | MySQL / MariaDB 10.11 | ✅ |
| Cache | Redis 7 | ⚠️ Soft |
| Media SFU | LiveKit | ✅ For audio/video |
| Media Storage | Local or Cloudflare R2 | ✅ |
| Push | Firebase FCM | ⚠️ Soft |
| Email | SMTP | ⚠️ Soft |
| SMS | Twilio | ⚠️ Soft |
| Monitoring | Prometheus + Grafana | ⚠️ Optional |
| Reverse Proxy | nginx | ✅ For production |

---

## CI/CD Pipeline (GitHub Actions)

### Trigger

- `push` to `main` or `develop`
- `pull_request` to `main` or `develop`

### Jobs (in order)

```
backend-tests (unit)  ─────┐
backend (lint+schema) ─────┤→ backend-integration ─→ docker ─→ e2e
frontend (tsc+lint)   ─────┘
mobile (tsc+lint)
```

| Job | What it does |
|-----|-------------|
| `backend-tests` | Jest unit tests (mocked deps) |
| `backend` | ESLint, Prisma schema validate, syntax check |
| `backend-integration` | Integration tests against real MySQL + Redis, migration drift check, backup/restore verification |
| `frontend` | TypeScript check, ESLint, Jest unit + PBT tests |
| `mobile` | TypeScript check, ESLint, Jest unit tests |
| `docker` | Docker build test (backend + frontend images) |
| `e2e` | Playwright E2E tests (main branch / PRs to main only) |

### Migration Drift Check

```yaml
- name: Verify no pending migrations (drift detection)
  run: |
    STATUS=$(npx prisma migrate status 2>&1)
    if echo "$STATUS" | grep -q "have not yet been applied"; then
      echo "ERROR: Unapplied migrations detected."
      exit 1
    fi
```

Blocks deployment if schema has changes not covered by a migration file.

---

## Deployment Process (SSH Deploy to Production)

Triggered on push to `main` when `backend/**`, `frontend/**`, `nginx/**`, or `docker-compose.prod.yml` changes.

**Safe migration order (DO-004 fix):**

```
1. git pull origin main           — new code + migration files land
2. docker compose run --rm backend npx prisma migrate deploy
                                  — run migrations in TEMP container
                                  — works even if backend is down
3. docker compose up -d --build --no-deps backend frontend
                                  — rebuild and restart services
4. health check loop (up to 90s)  — verify backend is healthy
```

This order ensures the DB schema is migrated **before** the new backend starts.

---

## Environment Variables (Required)

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | MySQL connection string |
| `REDIS_URL` | Redis connection |
| `JWT_SECRET` | min 32 chars |
| `JWT_REFRESH_SECRET` | min 32 chars |
| `LIVEKIT_URL` | `wss://...` |
| `LIVEKIT_API_KEY` | From LiveKit dashboard |
| `LIVEKIT_API_SECRET` | From LiveKit dashboard |
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `STRIPE_PUBLISHABLE_KEY` | Frontend Stripe.js |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `CLIENT_URL` | Comma-separated allowed CORS origins |
| `STORAGE_TYPE` | `local` or `r2` |
| `ADMIN_IP_ALLOWLIST` | Comma-separated CIDRs for admin APIs |
| `METRICS_TOKEN` | Prometheus metrics endpoint token |
| `FCM_SERVICE_ACCOUNT` | Firebase service account JSON |
| `SMTP_HOST` | Email server |
| `SMTP_USER` | Email sender |

---

## Health Checks

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Basic liveness (no auth) |
| `GET /health/liveness` | Kubernetes liveness probe |
| `GET /health/readiness` | Kubernetes readiness (DB + Redis + circuit breakers) |
| `GET /health/startup` | Kubernetes startup probe |
| `GET /health/detailed` | Full diagnostic (DB latency, memory, event loop) |

---

## Production Rules

1. **Migrations before backend restart** — always apply migrations before new backend starts (DO-004)
2. **Prisma generate** after any schema change — `npx prisma generate` must run after schema changes
3. **ADMIN_IP_ALLOWLIST must be set** in production — empty list allows all IPs for admin routes (GAP-001)
4. **LiveKit must be configured** — token endpoints return 503 if not configured
5. **Redis recommended** — without Redis: trending hashtags, community bans, speaker queues, auth cache degrade to DB fallback
6. **Stripe webhook secret** — must match the endpoint's signing secret in the Stripe dashboard
7. **METRICS_TOKEN must be a strong random value** — empty or default token blocks the metrics endpoint

---

## Backup Strategy

The CI pipeline verifies backup/restore with every integration test run:
- `mysqldump` creates backup
- Database dropped and recreated
- Restore from dump
- Table count verified (must be ≥ 10)

Production backup scripts: `scripts/auto-backup-scheduler.ps1`

---

## Rollback

If a deployment fails:
1. Health check job fails and logs the last 50 backend log lines
2. Manual SSH to production, `git revert HEAD` or `git reset --hard HEAD~1`
3. Rerun migrations for rollback if needed: `npx prisma migrate deploy`
4. `docker compose up -d --build --no-deps backend`

No automated rollback — manual intervention required.
