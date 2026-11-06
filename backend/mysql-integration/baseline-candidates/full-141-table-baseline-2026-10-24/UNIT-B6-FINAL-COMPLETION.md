# HALQA Phase 3D-1C Unit B-6 — authoritative final offline completion

## Supersession and safety

This document supersedes `.agents/tasks/phase-3d-1c-unit-b5-complete.md` for all status, artifact-selection and future-work decisions. The B-5 file is retained as historical evidence because ownership is uncertain, but it is obsolete and unsafe for execution. Its root commands, database drop, generic database, placeholder root credential, obsolete hashes, missing FULLTEXT supplement, production-readiness language and implied Unit C authorization are rejected.

No automation may derive executable commands from the B-5 report. The only current artifact identity and ordering authority is `full-schema-manifest.json`. The current README intentionally contains no database execution recipe.

## Corrective closure

- B6C-F01: RESOLVED. Comment/string-aware statement tokenization accounts for 141 executable unique table creates across 36 migrations: 94 plain quoted, 46 conditional quoted and one conditional unquoted.
- B6C-F02: RESOLVED. Six CHECK constraints are validated by exact table/name/column/expression semantics, not count.
- B6-F02: RESOLVED BY AUTHORITATIVE ALTERNATIVE. The ownership-uncertain B-5 historical file was not modified; this document and README unambiguously supersede it.
- Parser hostile tests: 10/10 PASS.
- CHECK mutation tests: 9/9 PASS.
- Final-schema parity: 141 tables, 1,675 columns, 141 PKs, 518 Prisma-derived indexes and 231 FKs; zero mismatches.
- Custom objects: five FULLTEXT indexes and six CHECK constraints.

## Authorization boundary

Offline acceptance authorizes no MySQL, Docker, Prisma migration, SQL execution, integration test, staging, deployment or production action. C-1, C-2 and C-3 each require separate explicit authorization and prerequisite evidence. Original generator provenance and runtime MySQL behavior remain gaps. Aikido remains BLOCKED unless an authenticated result is produced.
