# Unit B-6 final remediation offline validation

## Result

- `node --check validate-offline.js`: PASS
- `node --check validate-offline-negative-tests.js`: PASS
- `node validate-offline-negative-tests.js`: PASS, 19/19
- `node validate-offline.js`: PASS, zero errors

## Exhaustive final-state parity

141 Prisma models, 141 candidate tables, 1,675 scalar columns, 141 primary keys, 518 Prisma-derived indexes, and all 231 Prisma relations/candidate FKs reconcile. Five FULLTEXT indexes and six exact CHECK constraints are represented.

## Historical CREATE TABLE proof

All 103 migration files were tokenized with SQL comment and string handling. The corrected ledger contains 141 executable CREATE TABLE statements for 141 unique tables across 36 migrations: 94 plain quoted, 46 conditional quoted, zero plain unquoted, and one conditional unquoted. No duplicate create exists, comments/strings are excluded, and the historical table-name set equals the candidate table inventory.

## CHECK proof

The validator checks exact table, constraint name, physical referenced column, comparison/operator, numeric boundary, and complete ordered allowlist for all six canonical constraints. Whitespace alone is normalized.

Negative tests detect wrong names/tables/columns, `> 0` substitution, removed wallet types, added `SUPER_ADMIN`, missing/duplicate checks, and tautologies.

## Limits

This is static offline evidence. It does not establish MySQL 8.4 parsing, engine selection, FULLTEXT behavior, CHECK/FK enforcement, performance, original Prisma generator provenance, or application behavior.
