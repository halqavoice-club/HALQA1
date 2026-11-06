# HALQA experimental MySQL 8.4 baseline — Unit B-6

> **AUTHORITATIVE STATUS:** This README, `UNIT-B6-FINAL-COMPLETION.md`, and `full-schema-manifest.json` supersede `.agents/tasks/phase-3d-1c-unit-b5-complete.md`. The ignored B-5 report is historical, obsolete, unsafe for execution, and must not be used by people or automation. It contains root/destructive commands, an obsolete baseline hash, and an incomplete artifact order.

## Status and authorization

This is an **offline-verified experimental artifact set**. It is not production-ready, has not been executed by Unit B-6, and authorizes no database, Docker, migration, integration-test, staging, or production operation.

Source: branch `fix/voice-club-realtime-sync-2026-10-15`, commit `d1a81ccafce1bdefac5eacdde7df7bb43153905b`, Prisma schema SHA-256 `91667206A696165C57EC5FC172371C4FFDEC6EE3379CF8803FC172F63C59FDC0`.

## Required artifact set

The set is indivisible. Partial application is failure.

1. `mysql-8.4-full-baseline-candidate.sql` — 141 tables and 231 FKs.
2. `historical-fulltext-index-supplement.sql` — five historical FULLTEXT indexes.
3. `custom-sql-supplement.sql` — six historical CHECK constraints.

The execution order above is recorded in `full-schema-manifest.json`. Unit B-6 did not execute it.

The candidate baseline differs from the original B-5 output only by correction of two UTF-8-corrupted string defaults: `voice_rooms.coverEmoji` is `🎙️` and `gifts.emoji` is `🎁`.

## Offline evidence

Run only the local non-network validator from the repository root:

```powershell
node backend/mysql-integration/baseline-candidates/full-141-table-baseline-2026-10-24/validate-offline.js
```

The validator reads text files only. It does not import Prisma, spawn a process, open a socket, load `.env`, or execute SQL. `parity-object-ledger.json` records all 141 tables, 1,675 scalar columns, 141 PKs, 518 Prisma-derived indexes, and 231 FKs with Prisma and candidate locations. `migration-object-ledger.json` records 631 classified lifecycle occurrences across all 103 migrations. Historical data transformations are documented but are not replayed into a from-empty database.

The corrected Unit B-6 ledger records 631 lifecycle occurrences, including all 141 executable CREATE TABLE statements across 36 migrations: 94 plain quoted, 46 `IF NOT EXISTS` quoted, and one `IF NOT EXISTS` unquoted. `validate-offline-negative-tests.js` provides 19 in-memory hostile tests for parser and CHECK mutation behavior.

Offline PASS means structural equality to the current Prisma schema plus presence of the eleven reviewed historical custom objects. It does not prove MySQL parsing, InnoDB FULLTEXT creation, CHECK/FK enforcement, query performance, migration replay compatibility, or application behavior.

## Historical objects

The five FULLTEXT definitions come unchanged from `20260721_add_fulltext_indexes/migration.sql`. No later migration names, drops, or replaces them. Their tables and columns exist and use VARCHAR/TEXT-compatible types. The default MySQL 8.4 engine is expected to be InnoDB, but actual engine, collation behavior, parser choice and index creation require Unit C verification.

The six CHECK definitions come from the three recorded canonical migrations. Wallet checks enforce local nonnegative values only; they do not prove ledger conservation, atomicity or concurrency safety. The school-role CHECK does not replace backend authorization.

## Prisma CLI provenance

`backend/package.json`, `backend/package-lock.json`, and the currently installed local package identify Prisma 5.22.0. The B-5 generation log records the original SQL hash and successful exit, but it does not record the resolved executable path or command environment. Therefore original CLI provenance remains a GAP.

A future offline regeneration must use the reviewed local executable by explicit path, first verify its package hash and `5.22.0` version, use the recorded schema checksum, sanitize Prisma/database environment variables, prohibit network access, and record executable path, executable/package hashes, argv, environment allowlist, exit code, stderr, and output hash. Regeneration requires separate authorization because it changes the baseline artifact.

## Unit C separation

- **C-1 — service verification:** separately authorized creation and attestation of a pinned, disposable MySQL 8.4 service. No baseline loading.
- **C-2 — artifact loading:** separately authorized only after C-1 succeeds. Recompute the manifest artifact-set identity, verify migrator identity/privileges, and apply all three SQL files in order. Any failure fails the complete load.
- **C-3 — read-only inspection:** separately authorized after successful C-2, using an independently verified reader identity and comparison with the approved manifest.

Routine root use, generic database names, reusable credentials, `.env` fallback, unverified localhost endpoints, continue-on-error, historical migration replay, application startup, and integration tests are not approved by this document.

## Remaining gates

Real MySQL 8.4 syntax/enforcement, service identity, privileges, engine/collation, metadata parity, and application behavior remain unverified. Production release remains **NO-GO**.
