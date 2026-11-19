# HALQA — Phase 0 Executive Summary

## Database

- **Production / CI:** MariaDB 10.11 LTS
- **Local development:** MariaDB 10.11 (via `docker-compose up -d`) recommended; XAMPP bundles MariaDB 10.4.x (audited: 10.4.32-MariaDB) — usable for dev only, diverges from CI/prod.
- **Prisma provider:** `mysql` (Prisma's correct setting for MariaDB)
- **Replication / HA:** Not yet configured. See RB-008 in [HALQA-RELEASE-BLOCKERS.md](./HALQA-RELEASE-BLOCKERS.md).

> This document summarizes the database standardization performed as part of the MariaDB 10.11 LTS remediation. Live production runtime has not been independently verified in this pass — do not assert production runtime status without a confirmed deployment log or running-process check.
