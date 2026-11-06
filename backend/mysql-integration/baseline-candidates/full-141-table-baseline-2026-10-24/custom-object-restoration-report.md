# Unit B-6 historical custom-object reconciliation

All 103 canonical migrations were scanned. The statement-level ledger records 631 classified lifecycle occurrences, including 141 CREATE TABLE statements, six CHECK constraints, five FULLTEXT indexes, 34 standalone index statements, 58 FK additions, five FK removals, one index removal, 53 column additions, 22 column modifications, 15 dynamic-SQL occurrences and 11 data transformations.

The five FULLTEXT indexes originate at lines 14–31 of `20260721_add_fulltext_indexes/migration.sql`. A repository-wide later-migration search found no matching drop, rename or replacement. Their target tables/columns exist in the final candidate with string-compatible types, names are unique, and column order matches the migration. They are restored in `historical-fulltext-index-supplement.sql`.

The six CHECK constraints remain byte-for-meaning consistent with their three historical sources and are retained in `custom-sql-supplement.sql`. Their runtime enforcement is not verified.

Objects expressible by Prisma are represented once in the generated baseline and checked exhaustively by `parity-object-ledger.json`; they are not duplicated in supplements. Historical data transformations are recorded but are not applicable to a from-empty database. Dynamic migration branches are historical replay mechanics; their intended final structures are reconciled against the current Prisma schema and candidate.

MySQL execution, actual storage engine, FULLTEXT parser choice, collation semantics and CHECK/FK enforcement remain Unit C gaps.
