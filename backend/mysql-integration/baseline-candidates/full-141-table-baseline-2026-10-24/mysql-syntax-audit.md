# Unit B-6 MySQL 8.4 static syntax assessment

The baseline, FULLTEXT supplement and CHECK supplement use statically plausible MySQL 8.4 DDL. The candidate contains no `CREATE INDEX IF NOT EXISTS`, MariaDB system-versioning syntax, schema-qualified external references, connection strings or privilege-changing statements.

The historical migration ledger records MariaDB-oriented `CREATE INDEX IF NOT EXISTS` mechanics, but historical replay is neither part of this artifact set nor authorized. Those mechanics must not be used as evidence that historical migrations replay on MySQL 8.4.

The baseline relies on the server default engine. FULLTEXT support therefore requires Unit C to confirm every table is InnoDB. Parser behavior, collation semantics, key-length limits, FK ordering, CHECK enforcement and actual metadata rendering cannot be statically proven.

**Classification:** STATICALLY PLAUSIBLE; REAL MYSQL 8.4 EXECUTION REQUIRED. This is not a production-readiness statement.
