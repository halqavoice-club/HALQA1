# Gifts / Payments — Known Gaps

**Last updated:** 2026-09-21 (economy consolidation complete)

---

## Previously Identified Gaps — ALL RESOLVED

The following gaps were documented on 2026-08-26. All five have been fixed as part of the `halqa-economy-consolidation` spec (Phases 1–15, September 2026).

| ID | Description | Status | Fix |
|----|-------------|--------|-----|
| UIGAP-004 | No payout management UI | ✅ FIXED | Admin payments page has full payout management (approve/reject/complete/cancel) |
| UIGAP-005 | No admin coin grant API | ✅ FIXED | `POST /api/v1/admin/actions/users/:id/grant-coins` implemented |
| PAY-GAP-001 | No refund API | ✅ FIXED | `POST /api/v1/admin/actions/transactions/:id/refund` implemented |
| PAY-GAP-002 | No Stripe refund integration | ✅ FIXED | `stripe.refunds.create()` called fire-and-forget after DB commit |
| PAY-GAP-003 | TX_TYPE_STYLE mismatch in admin UI | ✅ FIXED | Admin payments page uses correct DB type keys |

---

## Economy Consolidation — Resolved (September 2026)

These gaps were identified in the Sep 21 2026 discovery audit and fixed in the consolidation spec:

| ID | Description | Status | Fix |
|----|-------------|--------|-----|
| EC-001 | Duplicate payout implementations with conflicting rates | ✅ FIXED | `creator.controller.requestPayout` removed; single payout flow via `payout.controller.js` |
| EC-002 | `accountDetails` stored as plaintext | ✅ FIXED | AES-256-GCM encryption via `encryption.js`; `PAYOUT_ENCRYPTION_KEY` env var required |
| EC-003 | No `PAYOUT` / `PAYOUT_REVERSAL` WalletTransaction types | ✅ FIXED | Migration M-A added `diamonds` column; PAYOUT and PAYOUT_REVERSAL types implemented |
| EC-004 | `PayoutRequest.usdAmount` stored as Float | ✅ FIXED | Migration M-B: changed to `DECIMAL(10,2)` |
| EC-005 | Fee payment idempotency was Redis-only | ✅ FIXED | Migration M-C + DB-first idempotency (findFirst + P2002 guard) |
| EC-006 | Gift daily spend cap bypassed when Redis unavailable | ✅ FIXED | DB aggregate fallback; 503 if both Redis and DB fail |
| EC-007 | GIFT_SEND / TIP_SEND / SUBSCRIPTION ledger writes were non-fatal | ✅ FIXED | `.catch(() => {})` removed; ledger failure rolls back entire transaction |
| EC-008 | Creator subscription TOCTOU race condition | ✅ FIXED | Pre-transaction balance check removed; optimistic lock `WHERE coins >= priceCoins` |
| EC-009 | No `charge.dispute.created` Stripe webhook handler | ✅ FIXED | Handler flags WalletTransaction as DISPUTED, notifies SUPER_ADMIN via socket |
| EC-010 | `GET /wallet/history` only showed GiftTransactions | ✅ FIXED | Unified WalletTransaction history with GIFT_SEND enrichment, no broken `.room` include |
| EC-011 | roomResolver threw for unknown/PK/community room types | ✅ FIXED | Returns `null` for unknown types; pk + community handlers added |
| EC-012 | SUPER_ADMIN could become creator / send gifts / subscribe | ✅ FIXED | HTTP 403 guards on becomeCreator, subscribe, sendTip, sendGift, sendGiftToAll |
| EC-013 | Hardcoded DIAMOND_TO_USD in frontend and mobile | ✅ FIXED | Both use `GET /wallet/payout/info` — no client-side economy constants |
| EC-014 | Mobile payout screen called deprecated creator endpoint | ✅ FIXED | Mobile now calls `POST /wallet/payout/request` (canonical endpoint) |
| EC-015 | `PAYOUT_ENCRYPTION_KEY` not documented in env examples | ✅ FIXED | Added to `.env.example` and `.env.production.example` with instructions |

---

## Remaining Known Gaps (deferred — not part of consolidation spec)

| ID | Description | Severity | Notes |
|----|-------------|----------|-------|
| EC-FUTURE-001 | No Stripe Connect for automated payouts | Medium | Payouts processed manually by admin. Stripe Connect integration is future work. |
| EC-FUTURE-002 | PayPal integration is UI-only stub | Medium | PayPal method shown in UI but no API integration. Server validates method enum. |
| EC-FUTURE-003 | No subscription auto-renewal worker | Medium | `CreatorSubscription.expiresAt` index exists. Worker scaffolded in tasks.md Phase 12. |
| EC-FUTURE-004 | No economy reconciliation worker | Low | Reconciliation worker defined in tasks.md Phase 12. Not yet implemented. |
| EC-FUTURE-005 | Revenue reporting API not implemented | Low | Defined in tasks.md Phase 13. Not yet implemented. |
| EC-FUTURE-006 | No `payout.test.js` or `creator.test.js` | ✅ FIXED | Phase 14 complete — `payout.test.js` (18 tests) and `creator.test.js` (22 tests) written and passing. Full suite: 2739/2739. |

---

## Architecture Notes

### Payout flow (as of economy consolidation)

```
Creator → POST /wallet/payout/request
  → payout.controller.requestPayout
  → wallet.update (diamonds, optimistic lock WHERE diamonds >= amount)
  → payoutRequest.create (PENDING)
  → walletTransaction.create (PAYOUT, diamonds=-N)
  → socket emit to role:SUPER_ADMIN

Admin → PATCH /wallet/payout/admin/:id { action: "approve" | "reject" | "complete" }
  → On reject: wallet.update (+diamonds) + walletTransaction.create (PAYOUT_REVERSAL)
  → On complete: payoutRequest.update (COMPLETED, transactionRef)
```

### Deprecated endpoints

| Endpoint | HTTP status | Replacement |
|----------|-------------|-------------|
| `POST /api/v1/creators/me/payout-request` | 410 Gone | `POST /api/v1/wallet/payout/request` |
| `GET /api/v1/creators/me/payout-info` | 410 Gone | `GET /api/v1/wallet/payout/info` |
