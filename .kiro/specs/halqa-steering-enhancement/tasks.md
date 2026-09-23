# Implementation Plan: Halqa Steering Enhancement

## Overview

All 5 steering files are already written. This plan covers verification and one targeted update:
verify each file's front-matter, confirm no duplicate content against the 3 existing files,
validate cross-references point to real files, confirm the 16 invariants appear in both
`security.md` (concise) and `constitution.md` (detailed), spot-check fileMatch patterns
against real paths in the repo, and update `product.md` to reflect HALQA's multi-purpose
identity per the constitution's absolute rule in Section 1.

## Tasks

- [ ] 1. Verify Kiro front-matter on all 5 new steering files
  - [ ] 1.1 Check security.md front-matter fields
    - Open `.kiro/steering/security.md` and confirm the YAML front-matter block between `---` delimiters contains: `inclusion: fileMatch`, a `fileMatchPattern` value, and a `description` field
    - Confirm the `fileMatchPattern` matches the design spec: `**/{middleware,auth*,admin*,routes}/**,**/*security*,**/*invariant*,**/*permission*,**/*auth*`
    - _Requirements: 6.6, 1.1_

  - [ ] 1.2 Check realtime.md front-matter fields
    - Open `.kiro/steering/realtime.md` and confirm `inclusion: fileMatch`, `fileMatchPattern`, and `description` are all present
    - Confirm the `fileMatchPattern` contains socket, livekit, voice, live-class, and hooks patterns
    - _Requirements: 6.6, 2.1_

  - [ ] 1.3 Check payments.md front-matter fields
    - Open `.kiro/steering/payments.md` and confirm `inclusion: fileMatch`, `fileMatchPattern`, and `description` are all present
    - Confirm the `fileMatchPattern` covers stripe, wallet, gift, payout, coins, payment, transaction
    - _Requirements: 6.6, 3.1_

  - [ ] 1.4 Check testing.md front-matter fields
    - Open `.kiro/steering/testing.md` and confirm `inclusion: fileMatch`, `fileMatchPattern`, and `description` are all present
    - Confirm the `fileMatchPattern` covers `*.test.js`, `*.test.ts`, `*.spec.ts`, `*.pbt.test.ts`, and `**/tests/**`
    - _Requirements: 6.6, 4.1_

  - [ ] 1.5 Check constitution.md front-matter fields
    - Open `.kiro/steering/constitution.md` and confirm `inclusion: manual` and `description` are present
    - Confirm there is NO `fileMatchPattern` field (manual inclusion requires none)
    - _Requirements: 6.6, 5.1_

- [ ] 2. Verify non-duplication against tech.md, structure.md, and product.md
  - [ ] 2.1 Confirm no tech stack table duplication in the 5 new files
    - For each of the 5 new steering files, search for any standalone table row claiming specific package version strings (e.g. `Socket.IO 4.x`, `Stripe SDK`, `Jest 29`, `livekit-server-sdk`) that belong to `tech.md`
    - Verify that each file that mentions a tech package does so only via a cross-reference (`See tech.md`) rather than restating version numbers
    - _Requirements: 6.1, 1.7, 2.12, 3.12, 4.10_

  - [ ] 2.2 Confirm no Key Architecture Rules duplication in the 5 new files
    - For each of the 5 new steering files, search for any reproduction of the numbered list "Key Architecture Rules 1–7" or the backend/frontend/mobile directory tree blocks that belong to `structure.md`
    - Verify that `realtime.md` references `structure.md Rule 4` (transport order) rather than restating the rule's text verbatim
    - _Requirements: 6.2, 2.3_

  - [ ] 2.3 Confirm no user-role definitions duplication in the 5 new files
    - For each of the 5 new steering files, check that SUPER_ADMIN, SCHOOL_ADMIN, TEACHER, STUDENT, GUARDIAN role definitions are not restated — only referenced by pointing to `product.md`
    - _Requirements: 6.3_

- [ ] 3. Checkpoint — front-matter and non-duplication verified
  - Ensure all sub-tasks in sections 1 and 2 are confirmed. Note any issues found before continuing.

- [ ] 4. Verify cross-references point to files that actually exist
  - [ ] 4.1 Validate cross-reference targets in security.md
    - security.md references: `structure.md`, `product.md`, `docs/authorization/super-admin-production-invariants.md`, `docs/MASTER-VIOLATIONS.md`
    - Confirm each of these files exists on disk at the referenced path
    - _Requirements: 6.4_

  - [ ] 4.2 Validate cross-reference targets in realtime.md
    - realtime.md references: `structure.md Key Architecture Rule 4`, `security.md INV-009`, `docs/authorization/realtime-architecture.md`, `docs/authorization/livekit-architecture.md`, `docs/authorization/realtime-event-catalog.md`
    - Confirm each referenced file exists; if `realtime-event-catalog.md` is absent, note it as a missing reference
    - _Requirements: 6.4, 2.12_

  - [ ] 4.3 Validate cross-reference targets in payments.md
    - payments.md references: `tech.md`, `security.md INV-013`, `backend/src/middleware/idempotency.js`, `backend/src/utils/roomResolver.js`, `docs/gifts-payments/`
    - Confirm each referenced file/directory exists on disk
    - _Requirements: 6.4, 3.12_

  - [ ] 4.4 Validate cross-reference targets in testing.md
    - testing.md references: `tech.md`, `backend/src/tests/platform-admin-scope.test.js`, `backend/src/tests/p0-security-fixes.test.js`, `backend/src/tests/super-admin-scope.test.js`, `src/lib/layout/__tests__/computeLayout.pbt.test.ts`
    - Confirm each referenced file exists on disk
    - _Requirements: 6.4, 4.10_

  - [ ] 4.5 Validate cross-reference targets in constitution.md
    - constitution.md references: `tech.md`, `structure.md`, `product.md`, `security.md`, `realtime.md`, `payments.md`, `testing.md`, `docs/MASTER-VIOLATIONS.md`, `docs/HALQA-MASTER.md`, `docs/authorization/`
    - Confirm each referenced file/directory exists on disk
    - _Requirements: 6.4, 5.11_

- [ ] 5. Verify the 16 invariants appear correctly in both security.md and constitution.md
  - [ ] 5.1 Confirm all 16 invariant IDs are present in security.md (concise form)
    - Open `security.md` and verify INV-001 through INV-016 all appear in the invariant table
    - Confirm each entry is one sentence or less (concise checklist form)
    - Confirm the change-control checklist has all 16 checkbox items (one per invariant)
    - _Requirements: 6.5, 1.3, 1.4_

  - [ ] 5.2 Confirm all 16 invariant IDs are present in constitution.md (detailed form)
    - Open `constitution.md` and verify INV-001 through INV-016 are all referenced
    - Confirm the constitution's invariant content is more detailed than the security.md one-sentence form (fuller explanation per invariant)
    - _Requirements: 6.5, 5.4_

- [ ] 6. Spot-check fileMatch patterns against real files in the repo
  - [ ] 6.1 Spot-check security.md pattern against real middleware and route files
    - Verify the pattern `**/{middleware,auth*,admin*,routes}/**` would match real files such as: `backend/src/middleware/auth.middleware.js`, `backend/src/routes/user.routes.js`, `backend/src/middleware/validators/liveClass.validator.js`
    - Verify the pattern `**/*auth*` would match `backend/src/middleware/auth.middleware.js`
    - Note any real security-related files in the repo that the pattern would miss
    - _Requirements: 1.1_

  - [ ] 6.2 Spot-check realtime.md pattern against real socket and hook files
    - Verify the pattern `**/{sockets,hooks}/**` would match `backend/src/sockets/index.js` and frontend hook files
    - Verify `**/*voice*` would match `backend/src/controllers/voice.controller.js`
    - Verify `**/*live-class*` would match `backend/src/routes/live-class.routes.js`
    - Note any real realtime files the pattern would miss
    - _Requirements: 2.1_

  - [ ] 6.3 Spot-check payments.md pattern against real payment files
    - Verify `**/*wallet*` would match `backend/src/routes/wallet.routes.js` (if it exists) or similar
    - Verify `**/*gift*` would match `backend/src/controllers/gift.controller.js`
    - Verify `**/*stripe*` would match any Stripe-related files in the repo
    - Note any real payment files the pattern would miss
    - _Requirements: 3.1_

  - [ ] 6.4 Spot-check testing.md pattern against real test files
    - Verify `**/*.test.js` would match `backend/src/tests/idempotency.test.js`
    - Verify `**/*.pbt.test.ts` would match `src/lib/layout/__tests__/computeLayout.pbt.test.ts`
    - Verify `**/tests/**` would match files in `backend/src/tests/`
    - Note any test files the pattern would miss (e.g. `.spec.ts` files)
    - _Requirements: 4.1_

- [ ] 7. Checkpoint — cross-references and fileMatch patterns verified
  - Ensure all sub-tasks in sections 4, 5, and 6 are confirmed. Note any broken references or pattern gaps found.

- [ ] 8. Update product.md to reflect HALQA's multi-purpose identity
  - [ ] 8.1 Revise the opening description in product.md
    - Open `.kiro/steering/product.md`
    - The current first line reads: `**Halqa** is a full-stack Islamic school management platform with an integrated social and live media layer.`
    - Replace it with a description that reflects the multi-purpose identity defined in `constitution.md` Section 1: HALQA is a general-purpose platform for connection, learning, live experiences, communities, and creator monetization — with Islamic education and school management as specialized domains within it, not the platform's entire identity
    - Preserve all existing sections (Core Domains, User Roles, Islamic-Specific Features) unchanged — only update the opening paragraph
    - _Requirements: 6.3 (conflict between product.md and constitution.md Section 1 must be resolved)_

  - [ ]* 8.2 Verify product.md still passes a non-duplication check after the edit
    - Confirm the updated product.md does not introduce any new duplication of tech stack, architecture rules, or invariants from the other steering files
    - _Requirements: 6.1, 6.2, 6.3_

- [ ] 9. Final checkpoint — all verifications complete and product.md updated
  - Ensure all tasks pass, the 5 steering files are confirmed valid, all cross-references resolve, and `product.md` no longer describes HALQA as exclusively an Islamic school management platform.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All 5 steering files are already written — these tasks are verification and one targeted correction
- Section 8 (product.md update) is a code change task; all other sections are read/verify tasks
- Each task references specific requirements for traceability
- Checkpoints in sections 3, 7, and 9 are natural break points — raise questions there if issues are found

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5", "5.1", "5.2"] },
    { "id": 3, "tasks": ["6.1", "6.2", "6.3", "6.4"] },
    { "id": 4, "tasks": ["8.1"] },
    { "id": 5, "tasks": ["8.2"] }
  ]
}
```
