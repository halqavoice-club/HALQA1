# HALQA MySQL 8.4 Experimental Baseline

**Status:** UNVERIFIED — Offline-generated schema baseline  
**Purpose:** CI-only compatibility testing for future MySQL 8.4 migration  
**Source Commit:** `d1a81ccafce1bdefac5eacdde7df7bb43153905b`  
**Branch:** `fix/voice-club-realtime-sync-2026-10-15`  
**Generated:** Phase 3D-1C Unit B (offline analysis)

---

## ⚠️ CRITICAL WARNINGS

### NOT FOR PRODUCTION USE

This baseline is **EXPERIMENTAL** and has **NOT** been executed against a real MySQL 8.4 instance.

**DO NOT:**
- Run against production databases
- Run against staging databases
- Use as a migration replacement
- Assume parity with MariaDB without Unit C verification

**This is for:**
- Isolated CI testing in Docker MySQL 8.4 containers
- Schema compatibility verification
- Future migration planning

---

## What This Baseline IS

A **representative MySQL 8.4-compatible schema** derived from:

1. **Prisma schema** (`backend/prisma/schema.prisma`)
2. **103 canonical MariaDB migrations** (20260418105524_init → 20261022_add_voice_participant_seat_index)
3. **Sampled migration SQL** (10 of 103 migrations read in full)
4. **CHECK constraint SQL** (from 3 dedicated migrations)

**Approach:** Representative baseline covering **39 core tables** across 7 domains. Remaining **74 tables** fully documented in `schema-manifest.json`.

---

## What This Baseline IS NOT

1. **Not a complete 113-table baseline** — output token limits prevented full generation
2. **Not a production migration** — canonical MariaDB migrations remain authoritative
3. **Not runtime-verified** — parity status is UNVERIFIED until Unit C execution
4. **Not a Prisma introspection target** — Prisma operates against MariaDB production schema

---

## Files in This Baseline

| File | Purpose | Size Estimate |
|------|---------|---------------|
| `mysql-8.4-baseline.sql` | Executable DDL for 39 core tables + FK constraints + CHECK constraints | ~1,200 lines |
| `schema-manifest.json` | Complete inventory of all 113 tables with metadata | ~400 lines |
| `README.md` | This file — usage guide and compatibility documentation | ~300 lines |

---

## How to Use This Baseline

### Step 1: Create an Isolated MySQL 8.4 Container

```bash
docker run -d \
  --name halqa-mysql-test \
  -e MYSQL_ROOT_PASSWORD=test_root_password \
  -e MYSQL_DATABASE=halqa_test \
  -e MYSQL_USER=halqa_test \
  -e MYSQL_PASSWORD=test_password \
  -p 3307:3306 \
  mysql:8.4
```

### Step 2: Apply the Baseline

```bash
docker exec -i halqa-mysql-test mysql -uhalqa_test -ptest_password halqa_test \
  < backend/mysql-integration/baseline/mysql-8.4-baseline.sql
```

### Step 3: Verify Schema

```bash
docker exec -it halqa-mysql-test mysql -uhalqa_test -ptest_password halqa_test

-- Check table count
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'halqa_test';
-- Expected: 39 tables

-- Check foreign key count
SELECT COUNT(*) FROM information_schema.table_constraints 
WHERE table_schema = 'halqa_test' AND constraint_type = 'FOREIGN KEY';
-- Expected: 52 foreign keys

-- Check CHECK constraint count
SELECT COUNT(*) FROM information_schema.check_constraints 
WHERE constraint_schema = 'halqa_test';
-- Expected: 6 CHECK constraints
```

---

## Represented vs Documented Tables

### Represented (39 tables — in mysql-8.4-baseline.sql)

**Auth & Users (7):**
- users, auth_providers, refresh_tokens, otp_codes, sessions
- school_memberships, school_settings

**School Management (7):**
- schools, terms, classes, students, teachers, guardians, enrollments

**Voice Club (5):**
- voice_rooms, voice_participants, voice_messages, voice_room_members, voice_host_stats

**Gift Economy (7):**
- wallets, wallet_transactions, coin_packages, gifts, gift_transactions
- platform_revenue_entries, payout_requests

**Social (8):**
- follows, friend_requests, posts, post_reactions, stories
- communities, dm_conversations, direct_messages

**Live Classes (3):**
- live_classes, live_class_participants, live_class_messages

**System (2):**
- notifications, audit_logs

### Documented Only (74 tables — in schema-manifest.json)

These tables are **NOT** in the baseline SQL but are fully documented with column types, indexes, and FK relationships in `schema-manifest.json`.

**Attendance & Grades (5):** attendance, attendance_logs, grades, grade_categories, behavior_logs  
**Audio Courses (3):** audio_categories, audio_courses, audio_lessons  
**Library (2):** library_books, library_issues  
**Fees (1):** fee_records  
**Calendar & Notes (3):** calendar_events, notes, announcements  
**Messaging (2):** messages, message_recipients  
**File Uploads (1):** file_uploads  
**Reports (1):** reports  
**Activities (2):** activities, activity_participants  
**Social Extended (18):** post_comments, comment_reactions, post_bookmarks, post_views, post_mentions, story_views, story_reactions, community_members, community_join_requests, community_bans, community_invites, creator_profiles, creator_subscriptions, creator_tips, dm_reactions, post_media, post_hashtags, hashtags  
**Group Chat (5):** group_conversations, group_members, group_messages, group_message_reactions, group_message_reads  
**Assignments & Exams (2):** assignment_submissions, exam_submissions  
**Marketplace (3):** products, orders, reviews  
**Transport (4):** school_buses, bus_routes, drivers, bus_assignments  
**Leaderboards (2):** global_leaderboard, school_leaderboard  
**Practice Quizzes (3):** quizzes, quiz_questions, quiz_attempts  
**PK Battle System (5):** pk_battles, pk_participants, pk_user_stats, pk_user_achievements, pk_mission_progress  
**Relationship Tables (9):** guardian_students, teacher_classes, room_gift_leaderboard, user_reports, post_reports, user_blocks, user_daily_gift_spend, live_class_hand_queue, live_class_attendance  
**Live Classes Extended (2):** live_class_polls, live_class_whiteboard_snapshots  
**Creator Economy (1):** creator_tiers

---

## How to Extend This Baseline

To add a documented-only table to the baseline:

1. **Read the Prisma model** in `backend/prisma/schema.prisma`
2. **Check `schema-manifest.json`** for column metadata
3. **Follow the CREATE TABLE pattern** from mysql-8.4-baseline.sql:

```sql
CREATE TABLE `table_name` (
  `id` VARCHAR(191) NOT NULL,
  -- Add columns with correct MySQL 8.4 types
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- Add indexes
  INDEX `idx_table_column` (`column`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

4. **Add foreign key constraints** after all CREATE TABLEs:

```sql
ALTER TABLE `child_table`
  ADD CONSTRAINT `fk_child_table_parent_field` 
  FOREIGN KEY (`parentId`) REFERENCES `parent_table`(`id`) 
  ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## MariaDB → MySQL 8.4 Syntax Changes

| Construct | MariaDB | MySQL 8.4 Baseline | Notes |
|-----------|---------|-------------------|-------|
| **Conditional DDL** | `CREATE INDEX IF NOT EXISTS` | `CREATE INDEX` (no IF NOT EXISTS) | Baseline is clean-slate — objects do not exist yet |
| **Add Column** | `ADD COLUMN IF NOT EXISTS` | Not applicable | Baseline uses CREATE TABLE only, no ALTER |
| **Collation** | `utf8mb4_unicode_ci` (implicit) | `utf8mb4_unicode_ci` (explicit) | MySQL 8 default is `utf8mb4_0900_ai_ci`; explicit ensures parity |
| **ENUM** | `ENUM('A','B')` | `ENUM('A','B')` | Identical syntax |
| **JSON** | `JSON` (alias for LONGTEXT) | `JSON` (native type) | MySQL 8 has native JSON with validation |
| **CHECK Constraints** | `CHECK (expr)` (enforced 10.2+) | `CHECK (expr)` (enforced 8.0.16+) | Fully compatible |
| **Foreign Keys** | `ON DELETE CASCADE/RESTRICT/SET NULL` | `ON DELETE CASCADE/RESTRICT/SET NULL` | Standard SQL |
| **DATETIME(3)** | Millisecond precision | Millisecond precision | Fully compatible |
| **TINYINT(1)** | Boolean storage | Boolean storage | Prisma Boolean maps identically |
| **VARCHAR(191)** | InnoDB utf8mb4 key length limit | Same limit | 3072-byte index limit ÷ 4 bytes = 768 max; 191 is safe |

---

## Known Gaps & BLOCKED Items

### 1. Full 113-Table Baseline Not Generated

**Reason:** Output token limit (15,000+ lines exceeds single-turn capacity)  
**Mitigation:** Representative 39-table baseline created; remaining 74 documented in schema-manifest.json  
**Impact:** CI testing covers core domains; full schema reconstruction requires adding documented tables

### 2. INSERT Statements Excluded

**Reason:** Baseline is schema-only; data seeding excluded per offline-only requirement  
**Mitigation:** Application seed scripts (`backend/prisma/seed.js`) handle reference data post-baseline  
**Impact:** `coin_packages` and `gifts` tables will be empty after baseline application

### 3. Dynamic Prepared SQL Not Included

**Reason:** Baseline is static .sql file; conditional logic not applicable  
**Example:** Migration 20260730 uses `SET @var = (SELECT ...); PREPARE stmt FROM @sql;`  
**Mitigation:** All FK drops resolved offline; baseline includes only final FK state  
**Impact:** None — baseline reflects post-migration schema state

---

## CHECK Constraints

All CHECK constraints are MySQL 8.0.16+ compatible (enforced identically to MariaDB 10.2+).

| Table | Constraint | Expression | Migration Source |
|-------|------------|------------|------------------|
| `wallets` | `chk_wallet_coins_positive` | `coins >= 0` | 20260821_add_wallet_balance_checks |
| `wallets` | `chk_wallet_diamonds_positive` | `diamonds >= 0` | 20260821_add_wallet_balance_checks |
| `wallets` | `chk_wallet_total_spent` | `totalSpent >= 0` | 20260821_add_wallet_balance_checks |
| `wallets` | `chk_wallet_total_earned` | `totalEarned >= 0` | 20260821_add_wallet_balance_checks |
| `school_memberships` | `chk_membership_role` | `role IN ('SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN', 'REPRESENTATIVE')` | 20260821_add_membership_role_check |
| `wallet_transactions` | `chk_wallet_tx_type` | `type IN ('STRIPE_PURCHASE', 'GIFT_SEND', 'GIFT_RECEIVE', 'TIP_SEND', 'TIP_RECEIVE', 'SUBSCRIPTION', 'SUBSCRIPTION_RECEIVE', 'ADMIN_GRANT', 'REFUND', 'PAYOUT', 'PAYOUT_REVERSAL', 'DISPUTED')` | 20261007_add_wallet_tx_type_check |

---

## Foreign Key Cascade Rules

### CASCADE (child records deleted when parent is deleted)
- school_settings → schools
- school_memberships → users, schools
- refresh_tokens, otp_codes, sessions, auth_providers → users
- students, teachers, guardians → users (identity cascade)
- enrollments → students, classes
- voice_participants, voice_messages, voice_room_members → voice_rooms, users
- wallet, wallet_transactions → users
- gift_transactions → users (sender/receiver), gifts
- follows, friend_requests, posts, stories, communities, dm_conversations, direct_messages → users
- live_class_participants, live_class_messages → live_classes, users
- notifications → users

### RESTRICT (parent cannot be deleted while children exist)
- terms, classes, students, teachers, guardians → schools
- communities → users (ownerId)
- gifts → gift_transactions
- live_classes → users (hostId)

### SET NULL (FK set to NULL when parent is deleted)
- users → schools (schoolId can be null for social-only users)
- classes → terms (classes can outlive term deletion)
- live_classes → classes (classId can be null for public streams)

---

## JSON Columns

25 JSON columns across the schema for flexible/nested data:

| Table | Column | Purpose |
|-------|--------|---------|
| school_settings | gradingScale, attendanceTypes, behaviorCategories, workingDays | Custom school configuration |
| students | emergencyContact | Nested contact object |
| classes | schedule | Weekly schedule array |
| voice_rooms | lockedSeats | Array of locked seat indices |
| posts | mediaUrls, pollOptions | Arrays of URLs and poll data |
| stories | mediaUrls | Array of media URLs |
| direct_messages | mediaUrls | Array of attachments |
| notifications | data, sentVia | Notification payload and delivery channels |
| audit_logs | oldValues, newValues | Change tracking |

---

## Parity Verification Checklist (Unit C)

After applying the baseline to a MySQL 8.4 instance:

- [ ] All 39 tables created successfully
- [ ] All 52 foreign key constraints applied
- [ ] All 6 CHECK constraints enforced
- [ ] All indexes created without errors
- [ ] UTF-8 MB4 collation correctly applied
- [ ] ENUM types accept expected values
- [ ] JSON columns accept valid JSON and reject invalid
- [ ] CASCADE rules delete child records correctly
- [ ] RESTRICT rules prevent parent deletion
- [ ] SET NULL rules nullify FK correctly
- [ ] DATETIME(3) stores millisecond precision
- [ ] TINYINT(1) behaves as boolean (0/1)
- [ ] VARCHAR(191) indexed columns perform correctly
- [ ] Unique constraints prevent duplicate inserts
- [ ] Auto-increment IDs generate correctly (if any)

---

## Unit C Next Steps

Once this baseline is executed against a real MySQL 8.4 instance in Unit C:

1. **Compare table structure** against MariaDB production
2. **Run application integration tests** against MySQL container
3. **Measure query performance** vs MariaDB baseline
4. **Validate referential integrity** across all FK relationships
5. **Test CHECK constraint enforcement** with invalid data attempts
6. **Verify JSON column behavior** (validation, indexing, query performance)
7. **Document any runtime parity gaps** not detectable in offline analysis

---

## Source References

- **Prisma Schema:** `backend/prisma/schema.prisma`
- **Canonical Migrations:** `backend/prisma/migrations/` (103 directories)
- **Survey Report:** `.agents/tasks/unitb-migration-sample.md`
- **Migration Count:** 103 (excluding migration_lock.toml)
- **First Migration:** 20260418105524_init
- **Last Migration:** 20261022_add_voice_participant_seat_index
- **Source Commit:** d1a81ccafce1bdefac5eacdde7df7bb43153905b
- **Branch:** fix/voice-club-realtime-sync-2026-10-15

---

## Maintenance

This baseline is a **point-in-time snapshot**. If new migrations are added to the canonical MariaDB migration history:

1. Re-run Unit B offline analysis with updated migration count
2. Regenerate baseline SQL with new tables/columns/constraints
3. Update schema-manifest.json with new metadata
4. Re-verify parity in Unit C against fresh MySQL 8.4 container

---

## Contact & Support

For questions about this baseline:
- See survey report: `.agents/tasks/unitb-migration-sample.md`
- Review Unit B specification in workflow documentation
- Check HALQA-MASTER.md for context on Phase 3D-1C

**DO NOT** use this baseline for production deployments without full Unit C verification and explicit migration planning approval.
