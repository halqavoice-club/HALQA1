# Chat/DM — Known Gaps

**Audit date:** 2026-08-26

---

## CHAT-GAP-001 — No Admin DM Inspection

**Severity:** LOW (privacy-correct)  
No admin endpoint reads private DM messages. Accessing them requires direct DB access with appropriate authorization.

---

## CHAT-GAP-002 — No Message Editing for DM

**Severity:** LOW  
DMs can be soft-deleted by sender but cannot be edited after sending. `deletedBySender = true` hides from sender; `deletedByReceiver = true` hides from receiver. No `PATCH /messages/:msgId` endpoint exists for DM.

---

## CHAT-GAP-003 — `ALLOW_DM_NON_FRIENDS` Flag Not Enforced at API Level

**Severity:** MEDIUM  
The env var `ALLOW_DM_NON_FRIENDS` is documented in the Platform Settings page but whether it gates `sendMessage` in `dm.controller.js` needs verification. If not enforced, users can DM anyone regardless of friend status or blocks.

---

## CHAT-GAP-004 — Group Chat Privacy `CLASS_ONLY` Uses schoolId from User

**Severity:** LOW  
`CLASS_ONLY` privacy is defined in the enum but enforcement depends on how the controller validates class membership. Same legacy `User.schoolId` concern as the feed system.

---

## Summary

| ID | Severity | Description | Fixed? |
|----|---------|-------------|--------|
| CHAT-GAP-001 | LOW | No admin DM inspection (privacy-correct) | N/A |
| CHAT-GAP-002 | LOW | No DM message editing | ❌ missing |
| CHAT-GAP-003 | MEDIUM | ALLOW_DM_NON_FRIENDS not verified | ❓ verify |
| CHAT-GAP-004 | LOW | CLASS_ONLY enforcement uses legacy schoolId | ❌ |
