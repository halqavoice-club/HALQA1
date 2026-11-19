# HALQA — Architecture Map

## Database Layer

- **Production / CI:** MariaDB 10.11 LTS
- **Local development:** MariaDB 10.11 (via `docker-compose up -d`) recommended for parity; XAMPP bundles MariaDB 10.4.x (audited: 10.4.32-MariaDB) and is usable but diverges from CI/prod.
- **Prisma provider:** `mysql` (Prisma's correct setting for MariaDB)

## Infrastructure Overview

See [SCALING.md](./SCALING.md) for capacity planning and horizontal scaling guidance.

See [RESTORE_GUIDE.md](./RESTORE_GUIDE.md) for local dev setup and disaster recovery.

See [HALQA-RELEASE-BLOCKERS.md](./HALQA-RELEASE-BLOCKERS.md) for open production blockers including RB-008 (MariaDB 10.11 replication/cluster not yet configured).
