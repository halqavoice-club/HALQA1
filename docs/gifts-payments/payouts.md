# Payouts — Diamond to Cash Withdrawal

**Source:** `backend/src/routes/payout.routes.js`, `backend/src/controllers/payout.controller.js`  
**Mounted at:** `/api/v1/wallet/payout`  
**Audit date:** 2026-08-26

---

## Payout Flow

```
Host requests payout:
  POST /wallet/payout/request
  { diamonds: 2000, method: 'bank_transfer', accountDetails: { ... } }
    └─ Creates PayoutRequest { status: 'PENDING' }
    └─ Emits creator:payout_requested → role:SUPER_ADMIN socket room

SUPER_ADMIN reviews:
  GET  /wallet/payout/admin/list?status=PENDING
  PATCH /wallet/payout/admin/:id { action: 'approve' | 'reject' | 'complete', adminNote }
    └─ On approve: status → 'APPROVED'
    └─ On complete: status → 'COMPLETED', diamonds deducted from host wallet
    └─ On reject: status → 'REJECTED', diamonds refunded to host wallet
```

---

## API Endpoints

### User Endpoints

| Method | Path | Auth | Rate limit | Notes |
|--------|------|------|-----------|-------|
| GET | `/history` | ✅ | — | Own payout history |
| POST | `/request` | ✅ | 5/hour | Request payout (min 2000 diamonds) |
| DELETE | `/:id/cancel` | ✅ | — | Cancel pending payout |

### Admin Endpoints (SUPER_ADMIN only)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/admin/list` | SUPER_ADMIN | List all payouts (filter by status) |
| PATCH | `/admin/:id` | SUPER_ADMIN | Process payout: approve/reject/complete |

**H-8 Fix:** SCHOOL_ADMIN was previously able to process payouts. This was removed — payouts are a platform-level financial operation, not a school-scoped operation.

---

## Database Model: `PayoutRequest`

| Field | Notes |
|-------|-------|
| `userId` | FK → `users.id` |
| `diamonds` | Diamonds requested |
| `usdAmount` | `diamonds × 0.005` |
| `method` | `bank_transfer / paypal / stripe` |
| `accountDetails` | JSON — **SENSITIVE** — bank/PayPal account info |
| `status` | PENDING → APPROVED → PROCESSING → COMPLETED / REJECTED / CANCELLED |
| `adminNote?` | Admin's internal note |
| `transactionRef?` | External payment reference |
| `processedAt?` | When processed |

---

## Minimum Payout

2000 diamonds minimum enforced at the API validator:
```javascript
body('diamonds').isInt({ min: 2000 })
```

---

## Security

- `accountDetails` contains sensitive financial data (bank account numbers, PayPal addresses)
- This field is never returned by the admin stats endpoint
- The admin payout API (`/admin/list`, `/admin/:id`) requires `authorize('SUPER_ADMIN')` + IP allowlist

---

## Known Gap: UIGAP-004

The admin UI page `/admin/payments` does NOT show payout requests. There is no payout management section in the current admin UI. Processing payouts requires using the API directly or a separate admin tool.

See [gaps.md](./gaps.md) and [docs/authorization/super-admin-current-violations.md](../authorization/super-admin-current-violations.md#uigap-004).
