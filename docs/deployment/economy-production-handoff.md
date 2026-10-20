# Economy Consolidation — Production Handoff Checklist

**Version:** halqa-economy-consolidation spec (September 2026)
**Regression baseline:** 132/132 tests passing (5 test suites)
**Scope:** Backend-only environment changes + DB migrations + one-time data migration

---

## Pre-Flight: Before Touching Production

### 1. Verify the regression baseline locally

Run this on your development machine before the staging or production deployment.

```bash
cd backend
npx jest "economy-config|encryption.test|gift.test|stripe.test|wallet.test" \
  --runInBand --forceExit --no-coverage
```

**Expected:** `Tests: 132 passed, 132 total` — stop if any test fails.

---

### 2. Generate the encryption key (backend secret only)

`PAYOUT_ENCRYPTION_KEY` is a **backend-only secret**. It must:
- Never appear in frontend or mobile env files
- Never be committed to source control
- Be different for staging vs production

```bash
# Generate a secure 64-hex-char key (32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store the output in your secrets manager (AWS Secrets Manager, Vault, Railway env, etc.).

---

## Phase A: Staging Environment

Run every step below against **staging** before touching production.

### A1. Back up the staging database

```bash
# XAMPP local (replace with your staging credentials)
mysqldump -u root halqa_db > halqa_db_pre_economy_staging_$(date +%Y%m%d_%H%M%S).sql
```

### A2. Set the encryption key on staging

Add `PAYOUT_ENCRYPTION_KEY=<your-generated-key>` to your staging server's environment.
Do not use the same key as production.

### A3. Run the pre-migration verification query

Before applying M-B (Float → Decimal), verify no data would be corrupted:

```sql
-- Run against staging DB. Expected: 0 rows.
SELECT id, usd_amount
FROM payout_requests
WHERE usd_amount != ROUND(usd_amount, 2);
```

If any rows are returned, investigate before proceeding.

### A4. Apply migrations to staging

```bash
cd backend
npx prisma migrate deploy
```

**Expected migrations to apply (in order):**
- `20260921_add_diamonds_to_wallet_transactions` — M-A: adds `diamonds INT DEFAULT 0`
- `20260921_payout_usd_amount_decimal` — M-B: `usd_amount` Float → Decimal(10,2)
- `20260921_fee_record_stripe_session_id` — M-C: adds `stripe_session_id UNIQUE` to fee_records
- `20260921_wallet_transaction_new_types` — M-D: informational (no DDL)

**Verify:** `npx prisma migrate status` should show all migrations as applied.

### A5. Regenerate Prisma client (if not already done)

```bash
cd backend
npx prisma generate
```

### A6. Run the encryption migration script (dry run first)

```bash
cd backend
PAYOUT_ENCRYPTION_KEY=<your-staging-key> \
  node ../scripts/encrypt-account-details.js
```

Review the output. It will show which rows would be encrypted and which skipped.
Expected output includes `SKIP` for empty rows and `WOULD ENCRYPT` for plaintext rows.

### A7. Apply the encryption migration

```bash
cd backend
PAYOUT_ENCRYPTION_KEY=<your-staging-key> \
  node ../scripts/encrypt-account-details.js --apply
```

**Expected:** `✅ Migration completed successfully.` with 0 errors.

### A8. Verify no plaintext payout account details remain

```sql
-- Run against staging DB.
-- All non-empty rows should match the iv:tag:ciphertext format.
-- Plaintext JSON starts with '{' — none should remain.
SELECT id, LEFT(account_details, 10) AS preview
FROM payout_requests
WHERE account_details IS NOT NULL
  AND account_details != '{}'
  AND account_details != ''
  AND account_details NOT LIKE '%:%:%';
-- Expected: 0 rows
```

### A9. Start the staging server

```bash
cd backend
npm run dev   # or npm start for production mode
```

Confirm in the server logs:
- No `[payout] PAYOUT_ENCRYPTION_KEY is missing` error
- Server starts cleanly

### A10. Run the economy smoke tests on staging

**Regression baseline (must pass):**
```bash
cd backend
npx jest "economy-config|encryption.test|gift.test|stripe.test|wallet.test" \
  --runInBand --forceExit --no-coverage
```
Expected: 132/132

**Manual smoke test — payout flow:**
1. Log in as a user with diamonds on staging
2. Hit `GET /api/v1/wallet/payout/info` — verify `diamondToUsd: 0.005`, `minPayoutDiamonds: 2000`
3. Submit a payout request via the web payout page — verify 201 response
4. Check DB: `SELECT account_details FROM payout_requests ORDER BY created_at DESC LIMIT 1;`
   - Value should start with base64 characters followed by `:`, not with `{`
5. Log in as SUPER_ADMIN — verify payout appears in admin payments page
6. Approve the payout — verify `PAYOUT_REVERSAL` transaction is NOT created on approve
7. Reject a different test payout — verify diamonds are restored and `PAYOUT_REVERSAL` record exists

**Deprecated endpoint check:**
```bash
curl -X POST https://staging.yourdomain.com/api/v1/creators/me/payout-request \
  -H "Authorization: Bearer <token>"
# Expected: HTTP 410
```

**Stripe webhook smoke test (Stripe CLI):**
```bash
# Install Stripe CLI if not present: https://stripe.com/docs/stripe-cli
stripe listen --forward-to http://localhost:5000/api/v1/stripe/webhook

# In another terminal, trigger a test event
stripe trigger checkout.session.completed
# Verify in server logs: coin credit + wallet:coins_credited socket event

stripe trigger charge.dispute.created
# Verify in server logs: [stripe:dispute] charge.dispute.created logged at WARN level
```

**Ledger balance spot check:**
```sql
-- For a few users, verify wallet balance matches ledger sum
SELECT
  w.user_id,
  w.coins AS wallet_coins,
  COALESCE(SUM(wt.coins), 0) AS ledger_sum,
  w.coins - COALESCE(SUM(wt.coins), 0) AS delta
FROM wallets w
LEFT JOIN wallet_transactions wt ON wt.user_id = w.user_id
GROUP BY w.user_id, w.coins
HAVING delta != 0;
-- Expected: 0 rows (all balances match ledger)
-- Non-zero rows indicate legacy data created before the ledger was introduced.
-- These are pre-existing and do not indicate a new bug.
```

**Idempotency check (replay protection):**
```bash
# Send the same Stripe webhook event twice
# Server should log "already processed (DB check)" on the second delivery
# No duplicate coin credit should occur
```

**Web payout flow (browser):**
1. Navigate to `/wallet/payout` — confirm no hardcoded constants in page source
2. Verify displayed conversion rate matches `GET /api/v1/wallet/payout/info` response
3. Submit a payout request — verify form submits to `/wallet/payout/request` (not `/creators/me/payout-request`)

**Mobile payout flow (Expo dev):**
1. Navigate to Payout Request screen
2. Verify rates load from server
3. Submit request — verify network call goes to `/wallet/payout/request`
4. Verify old endpoint (`/creators/me/payout-request`) is NOT called

---

## Phase B: Production Deployment

Only proceed after Phase A passes completely.

### B1. Back up the production database

```bash
mysqldump -u <prod_user> -p<prod_pass> -h <prod_host> halqa_db \
  > halqa_db_pre_economy_prod_$(date +%Y%m%d_%H%M%S).sql
```

Store this backup offsite. Do not skip this step.

### B2. Set the production encryption key

Add `PAYOUT_ENCRYPTION_KEY=<production-key>` to your production environment (not the same as staging).

**Verify it is backend-only:**
- [ ] NOT in `frontend/.env.local` or `frontend/.env.production`
- [ ] NOT in `mobile/.env`
- [ ] NOT committed to git
- [ ] IS in the production server's environment variables only

### B3. Run the pre-migration verification (same as A3 against production DB)

```sql
SELECT id, usd_amount FROM payout_requests WHERE usd_amount != ROUND(usd_amount, 2);
-- Expected: 0 rows
```

### B4. Apply migrations to production

```bash
cd backend
npx prisma migrate deploy
```

This is a forward-only, non-destructive operation:
- M-A: adds a column with a safe default → zero downtime
- M-B: changes Float to Decimal → safe for 2dp amounts
- M-C: adds nullable column + unique index → zero downtime
- M-D: informational only

### B5. Deploy the backend

Deploy your backend code (PM2 restart, Docker redeploy, etc.) with `PAYOUT_ENCRYPTION_KEY` set.

Verify in production logs after startup:
```
✓ No "[payout] PAYOUT_ENCRYPTION_KEY is missing" error
✓ Server starts cleanly
```

### B6. Run the encryption migration (dry run then apply)

```bash
# Dry run first — review output
PAYOUT_ENCRYPTION_KEY=<prod-key> node scripts/encrypt-account-details.js

# Apply if dry run output looks correct
PAYOUT_ENCRYPTION_KEY=<prod-key> node scripts/encrypt-account-details.js --apply
```

### B7. Verify no plaintext remains in production DB

```sql
SELECT id FROM payout_requests
WHERE account_details IS NOT NULL
  AND account_details != '{}'
  AND account_details != ''
  AND account_details NOT LIKE '%:%:%';
-- Expected: 0 rows
```

### B8. Deploy frontend and mobile simultaneously

The mobile app must be updated at the same time as the backend deployment because:
- Mobile now calls `POST /wallet/payout/request` (new endpoint)
- Old mobile builds calling `/creators/me/payout-request` will receive HTTP 410 (graceful failure with error message)
- Users on old builds will see an error directing them to update — this is acceptable

### B9. Run the full regression baseline on production

```bash
cd backend
npx jest "economy-config|encryption.test|gift.test|stripe.test|wallet.test" \
  --runInBand --forceExit --no-coverage
# Expected: 132/132 tests passing
```

---

## Post-Deployment Monitoring (First 24 Hours)

Watch for these in your production logs and monitoring:

| Signal | What it means | Action |
|--------|--------------|--------|
| `[payout] PAYOUT_ENCRYPTION_KEY is missing` | Key not set | Set env var and restart |
| `[payout:request] Blocked: PAYOUT_ENCRYPTION_KEY is not configured` | Same as above | Set env var |
| `[stripe:dispute] charge.dispute.created` | Real chargeback received | Admin review required |
| `[gift] Redis unavailable — used DB fallback` | Redis down, gift cap using DB | Fix Redis; DB fallback is active |
| `[payout] Admin … rejected payout` | Normal admin action | No action needed |
| HTTP 410 on `/creators/me/payout-request` | Old mobile app version | Users should update app |

---

## Rollback Procedure

If something goes wrong, roll back in reverse order:

### Step 1: Restore backend code to previous version
Deploy the previous backend build.

### Step 2: Decrypt account details (if encryption was applied)
```bash
PAYOUT_ENCRYPTION_KEY=<prod-key> node scripts/encrypt-account-details.js --decrypt --apply
```

### Step 3: Roll back DB migrations (if needed)
```sql
-- M-C rollback
ALTER TABLE fee_records DROP INDEX uq_fee_stripe_session, DROP COLUMN stripe_session_id;

-- M-B rollback
ALTER TABLE payout_requests MODIFY COLUMN usd_amount FLOAT NOT NULL;

-- M-A rollback
ALTER TABLE wallet_transactions DROP COLUMN diamonds;
```

### Step 4: Restore from backup (last resort)
```bash
mysql -u <user> -p<pass> -h <host> halqa_db < halqa_db_pre_economy_prod_<timestamp>.sql
```

---

## Final Acceptance Checklist

Sign off each item before considering the deployment complete:

- [ ] 132/132 unit tests pass on production after deployment
- [ ] No plaintext `accountDetails` rows remain in `payout_requests`
- [ ] `GET /api/v1/wallet/payout/info` returns `diamondToUsd: 0.005`, `minPayoutDiamonds: 2000`
- [ ] `POST /api/v1/wallet/payout/request` creates a `PayoutRequest` with encrypted `accountDetails`
- [ ] `POST /api/v1/creators/me/payout-request` returns HTTP 410
- [ ] Stripe webhook `checkout.session.completed` credits coins correctly
- [ ] Duplicate Stripe webhook delivery is rejected (idempotent)
- [ ] `charge.dispute.created` is handled and logged at WARN level
- [ ] Web payout page loads rates from server (no hardcoded constants)
- [ ] Mobile payout screen calls correct endpoint
- [ ] `PAYOUT_ENCRYPTION_KEY` is backend-only (not in frontend/mobile env)
- [ ] `PAYOUT_ENCRYPTION_KEY` is not committed to git
- [ ] DB ledger balance spot-check shows 0 new discrepancies
- [ ] Admin payout management UI shows masked account details (not plaintext)
- [ ] Admin can approve/reject/complete payouts
- [ ] SUPER_ADMIN cannot send gifts, subscribe, or become a creator (403)
