# Gifts / Payments — Known Gaps

**Audit date:** 2026-08-26

---

## UIGAP-004 — No Payout Management UI (CRITICAL)

Admin UI has no payout management page. See [docs/authorization/super-admin-current-violations.md](../authorization/super-admin-current-violations.md#uigap-004).

The API (`/wallet/payout/admin/list`, `/wallet/payout/admin/:id`) **does exist** and is SUPER_ADMIN-gated. The gap is only in the admin UI — the backend is functional.

---

## UIGAP-005 — No Admin Coin Grant API

`WalletTransaction.type = 'ADMIN_GRANT'` exists in the schema and in the `TX_TYPE_STYLE` styling in the admin UI, but there is no API endpoint to create an ADMIN_GRANT transaction.

No way to grant coins to a user without direct DB access.

---

## PAY-GAP-001 — No Refund API

There is no endpoint for issuing coin refunds. `WalletTransaction.type = 'REFUND'` exists in the schema but no controller implements it.

---

## PAY-GAP-002 — No Stripe Refund Integration

Stripe checkout sessions that complete successfully cannot be refunded via any platform API. Refunds would require manual action in the Stripe dashboard.

---

## PAY-GAP-003 — `WalletTransaction` Type Styling Mismatch in Admin UI

The admin payments UI (`TX_TYPE_STYLE`) uses keys `PURCHASE`, `SPEND`, `EARN`, `REFUND`, `WITHDRAWAL` — but the actual DB values are `STRIPE_PURCHASE`, `GIFT_SEND`, `TIP_SEND`, `SUBSCRIPTION`, `ADMIN_GRANT`, `REFUND`. Styling will not match for most transaction types.

---

## Summary

| ID | Severity | Description | Fixed? |
|----|---------|-------------|--------|
| UIGAP-004 | CRITICAL | No payout management UI | ❌ (API exists) |
| UIGAP-005 | HIGH | No admin coin grant API | ❌ missing |
| PAY-GAP-001 | HIGH | No refund API | ❌ missing |
| PAY-GAP-002 | HIGH | No Stripe refund integration | ❌ missing |
| PAY-GAP-003 | LOW | Admin UI transaction type styling mismatch | ❌ UI bug |
