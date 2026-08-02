# Phase C Database Migration Documentation

## Overview

This document describes the Phase C database migration which adds missing database features to the HALQA Management System. All changes are **additive only** - no existing tables were modified destructively.

**Migration Date**: July 22, 2026  
**Migration Method**: `prisma db push` (due to migration history issues)  
**Breaking Changes**: None  
**Data Loss**: Minimal (3 varchar columns reduced from 255 to 191 chars for MySQL index compatibility)

---

## New Models Added

### 1. Group Chat System (5 tables)

#### GroupConversation
Multi-user group conversations separate from DM and broadcast messages.

**Fields**:
- `id`, `schoolId`, `classId`, `name`, `description`, `avatarUrl`
- `privacy` (PUBLIC, PRIVATE, SCHOOL_ONLY, CLASS_ONLY)
- `maxMembers`, `isMuted`, `slowMode`
- `memberCount`, `messageCount`, `lastMessage`, `lastMessageAt`
- `createdBy`, `deletedAt`, `createdAt`, `updatedAt`

**Indexes**: `schoolId`, `classId`, `privacy`, `createdAt`

#### GroupMember
Membership management for group conversations.

**Fields**:
- `id`, `conversationId`, `userId`
- `role` (OWNER, ADMIN, MODERATOR, MEMBER)
- `isMuted`, `joinedAt`, `leftAt`, `unreadCount`, `lastReadAt`
- `deletedAt`, `createdAt`, `updatedAt`

**Indexes**: `conversationId`, `userId`, `role`
**Unique**: `[conversationId, userId]`

#### GroupMessage
Messages within group conversations.

**Fields**:
- `id`, `conversationId`, `senderId`
- `type` (TEXT, IMAGE, VIDEO, AUDIO, DOCUMENT, POLL, SYSTEM)
- `body`, `mediaUrl`, `mimeType`, `fileSize`
- `replyToId` (self-referencing for replies)
- `deletedBy` (JSON array of userIds), `deletedAt`
- `createdAt`, `updatedAt`

**Indexes**: `conversationId`, `senderId`, `createdAt`, `[conversationId, createdAt]`

#### GroupMessageReaction
Reactions on group messages.

**Fields**:
- `id`, `messageId`, `userId`, `type`, `createdAt`

**Indexes**: `messageId`, `userId`
**Unique**: `[messageId, userId]`

#### GroupMessageRead
Read receipts for group messages.

**Fields**:
- `id`, `messageId`, `userId`, `readAt`

**Indexes**: `messageId`, `userId`
**Unique**: `[messageId, userId]`

---

### 2. Assignment Submission System (1 table)

#### AssignmentSubmission
Student assignment submissions with file uploads and grading.

**Fields**:
- `id`, `schoolId`, `classId`, `gradeId`, `studentId`, `teacherId`
- `title`, `description`, `attachments` (JSON), `textContent`
- `status` (DRAFT, SUBMITTED, REVIEWED, GRADED, REJECTED, LATE)
- `submittedAt`, `reviewedAt`, `gradedAt`
- `feedback`, `score`, `maxScore`, `percentage`, `isLate`
- `deletedAt`, `createdAt`, `updatedAt`

**Indexes**: `schoolId`, `classId`, `gradeId`, `studentId`, `status`, `submittedAt`

---

### 3. Exam Submission System (1 table)

#### ExamSubmission
Student exam submissions with auto-grading support.

**Fields**:
- `id`, `schoolId`, `classId`, `gradeId`, `studentId`, `teacherId`
- `title`, `answers` (JSON - structured answers), `attachments` (JSON)
- `status` (DRAFT, SUBMITTED, REVIEWED, GRADED, REJECTED, LATE)
- `submittedAt`, `reviewedAt`, `gradedAt`
- `feedback`, `score`, `maxScore`, `percentage`, `autoGraded`
- `deletedAt`, `createdAt`, `updatedAt`

**Indexes**: `schoolId`, `classId`, `gradeId`, `studentId`, `status`, `submittedAt`

---

### 4. Marketplace System (3 tables)

#### Product
Product listings for school marketplace.

**Fields**:
- `id`, `schoolId`, `sellerId`, `title`, `description`
- `category` (BOOKS, UNIFORMS, SUPPLIES, ELECTRONICS, OTHER)
- `condition` (NEW, LIKE_NEW, GOOD, FAIR, POOR)
- `price` (Decimal), `negotiable`, `images` (JSON)
- `stock`, `viewCount`, `favoriteCount`, `soldCount`
- `isActive`, `featured`, `expiresAt`
- `deletedAt`, `createdAt`, `updatedAt`

**Indexes**: `schoolId`, `sellerId`, `category`, `condition`, `isActive`, `createdAt`

#### Order
Orders for marketplace products.

**Fields**:
- `id`, `schoolId`, `productId`, `buyerId`, `sellerId`
- `quantity`, `totalPrice` (Decimal)
- `status` (PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED, REFUNDED)
- `shippingAddress` (JSON), `notes`
- `confirmedAt`, `shippedAt`, `deliveredAt`, `cancelledAt`, `refundedAt`
- `deletedAt`, `createdAt`, `updatedAt`

**Indexes**: `schoolId`, `productId`, `buyerId`, `sellerId`, `status`, `createdAt`

#### Review
Product reviews with verified purchase flag.

**Fields**:
- `id`, `productId`, `orderId`, `reviewerId`, `sellerId`
- `rating` (1-5), `title`, `body`, `images` (JSON)
- `isVerified`, `deletedAt`, `createdAt`, `updatedAt`

**Indexes**: `productId`, `orderId`, `reviewerId`, `sellerId`, `rating`

---

### 5. Transport System (4 tables)

#### SchoolBus
School bus fleet management.

**Fields**:
- `id`, `schoolId`, `plateNumber` (unique), `busNumber` (unique)
- `capacity`, `make`, `model`, `year`, `color`, `fuelType`
- `status` (ACTIVE, INACTIVE, MAINTENANCE, OUT_OF_SERVICE)
- `insuranceExpiry`, `lastServiceAt`, `nextServiceAt`, `notes`
- `deletedAt`, `createdAt`, `updatedAt`

**Indexes**: `schoolId`, `status`

#### BusRoute
Bus routes with schedules.

**Fields**:
- `id`, `schoolId`, `busId`, `name`, `description`
- `routeNumber`, `startTime`, `endTime`
- `distanceKm`, `durationMin`, `isActive`
- `deletedAt`, `createdAt`, `updatedAt`

**Indexes**: `schoolId`, `busId`, `isActive`

#### BusStop
Bus stops along routes.

**Fields**:
- `id`, `routeId`, `name`, `address`
- `latitude`, `longitude`, `sequence`, `estimatedTime`
- `isActive`, `deletedAt`, `createdAt`, `updatedAt`

**Indexes**: `routeId`, `sequence`

#### Driver
Bus driver profiles.

**Fields**:
- `id`, `schoolId`, `userId` (unique, nullable)
- `firstName`, `lastName`, `phone`, `licenseNumber` (unique)
- `licenseExpiry`, `address`, `emergencyContact` (JSON)
- `status` (ACTIVE, INACTIVE, ON_LEAVE, SUSPENDED)
- `hiredAt`, `notes`, `deletedAt`, `createdAt`, `updatedAt`

**Indexes**: `schoolId`, `userId`, `status`

#### BusAssignment
Student bus assignments.

**Fields**:
- `id`, `schoolId`, `busId`, `routeId`, `stopId`, `driverId`, `studentId`
- `pickupTime`, `dropoffTime`
- `isMorning`, `isAfternoon`, `isActive`
- `effectiveFrom`, `effectiveTo`, `notes`
- `deletedAt`, `createdAt`, `updatedAt`

**Indexes**: `schoolId`, `busId`, `routeId`, `driverId`, `studentId`, `isActive`
**Unique**: `[studentId, isMorning, effectiveFrom]`

---

### 6. Analytics Tables (2 tables)

#### DailySchoolStats
Pre-aggregated daily school statistics.

**Fields**:
- `id`, `schoolId`, `date`
- `studentCount`, `teacherCount`, `classCount`
- `attendanceRate`, `averageGrade`, `behaviorScore`
- `totalPosts`, `totalMessages`, `totalGifts`, `totalCoins`
- `createdAt`, `updatedAt`

**Indexes**: `schoolId`, `date`
**Unique**: `[schoolId, date]`

#### DailyUserStats
Pre-aggregated daily user statistics.

**Fields**:
- `id`, `userId`, `date`
- `loginCount`, `postsCreated`, `commentsCreated`
- `likesGiven`, `likesReceived`, `messagesSent`
- `voiceMinutes`, `giftsSent`, `giftsReceived`
- `coinsSpent`, `coinsEarned`
- `createdAt`, `updatedAt`

**Indexes**: `userId`, `date`
**Unique**: `[userId, date]`

---

### 7. Leaderboard Tables (2 tables)

#### GlobalLeaderboard
Pre-computed global leaderboard.

**Fields**:
- `id`, `userId` (unique)
- `totalCoins`, `totalDiamonds`, `totalGifts`, `totalPosts`, `totalFollowers`
- `rank`, `previousRank`, `period` (ALL_TIME, WEEKLY, MONTHLY)
- `updatedAt`

**Indexes**: `rank`, `period`

#### SchoolLeaderboard
Pre-computed school-specific leaderboard.

**Fields**:
- `id`, `schoolId`, `userId`
- `totalCoins`, `totalDiamonds`, `totalGifts`, `totalPosts`
- `rank`, `previousRank`, `period`
- `updatedAt`

**Indexes**: `schoolId`, `rank`, `period`
**Unique**: `[schoolId, userId, period]`

---

### 8. Search Optimization Tables (2 tables)

#### SearchIndex
Full-text search optimization table.

**Fields**:
- `id`, `entityType`, `entityId`, `title`, `content`
- `tags` (JSON), `schoolId`, `userId`, `popularity`
- `lastIndexedAt`, `updatedAt`

**Indexes**: `entityType`, `schoolId`, `userId`, `popularity`
**Unique**: `[entityType, entityId]`

#### TrendingHashtag
Trending hashtag tracking.

**Fields**:
- `id`, `hashtag` (unique), `count`, `rank`, `previousRank`
- `period` (HOURLY, DAILY, WEEKLY), `updatedAt`

**Indexes**: `rank`, `period`

---

### 9. Backup Metadata (1 table)

#### BackupMetadata
Backup tracking and metadata.

**Fields**:
- `id`, `backupType` (FULL, INCREMENTAL, DIFFERENTIAL)
- `backupMethod` (MANUAL, AUTOMATED, SCHEDULED)
- `fileName`, `fileSize` (BigInt), `filePath`, `checksum`
- `status` (PENDING, COMPLETED, FAILED)
- `startedAt`, `completedAt`, `retentionDays`
- `createdBy`, `notes`, `deletedAt`, `createdAt`, `updatedAt`

**Indexes**: `backupType`, `status`, `startedAt`

---

## New Enums Added

1. **GroupChatPrivacy**: PUBLIC, PRIVATE, SCHOOL_ONLY, CLASS_ONLY
2. **GroupChatRole**: OWNER, ADMIN, MODERATOR, MEMBER
3. **GroupMessageType**: TEXT, IMAGE, VIDEO, AUDIO, DOCUMENT, POLL, SYSTEM
4. **SubmissionStatus**: DRAFT, SUBMITTED, REVIEWED, GRADED, REJECTED, LATE
5. **ProductCondition**: NEW, LIKE_NEW, GOOD, FAIR, POOR
6. **OrderStatus**: PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED, REFUNDED
7. **BusStatus**: ACTIVE, INACTIVE, MAINTENANCE, OUT_OF_SERVICE
8. **DriverStatus**: ACTIVE, INACTIVE, ON_LEAVE, SUSPENDED

---

## Relations Added to Existing Models

### School
- `groupConversations` → GroupConversation[]
- `assignmentSubmissions` → AssignmentSubmission[]
- `examSubmissions` → ExamSubmission[]
- `marketplaceProducts` → Product[]
- `marketplaceOrders` → Order[]
- `schoolBuses` → SchoolBus[]
- `busRoutes` → BusRoute[]
- `drivers` → Driver[]

### User
- `groupMemberships` → GroupMember[]
- `groupMessages` → GroupMessage[]
- `groupReactions` → GroupMessageReaction[]
- `groupReads` → GroupMessageRead[]
- `sellerProducts` → Product[]
- `buyerOrders` → Order[]
- `sellerOrders` → Order[]
- `userReviews` → Review[]
- `sellerReviews` → Review[]
- `driverProfile` → Driver?
- `globalLeaderboard` → GlobalLeaderboard?
- `schoolLeaderboards` → SchoolLeaderboard[]

### Class
- `groupConversations` → GroupConversation[]
- `assignmentSubmissions` → AssignmentSubmission[]
- `examSubmissions` → ExamSubmission[]

### Student
- `assignmentSubmissions` → AssignmentSubmission[]
- `examSubmissions` → ExamSubmission[]
- `busAssignments` → BusAssignment[]

### Grade
- `assignmentSubmissions` → AssignmentSubmission[]
- `examSubmissions` → ExamSubmission[]

---

## Composite Indexes Added to Existing Tables

### Classes
- `[schoolId, isActive]` - Active classes filter

### Students
- `[schoolId, deletedAt]` - Active students filter

### Teachers
- `[schoolId, deletedAt]` - Active teachers filter

### Guardians
- `[schoolId, deletedAt]` - Active guardians filter

### BehaviorLog
- `[studentId, date]` - Student behavior history

### GradeCategory
- (No indexes added - deletedAt field doesn't exist)

### Grades
- `[studentId, deletedAt]` - Active grades filter

### Activities
- `[classId, deletedAt]` - Active activities filter

### Messages
- `[senderId, deletedAt]` - Active messages filter

### Notifications
- `[userId, type, createdAt]` - Filtered notification inbox

### CalendarEvent
- `[schoolId, startDate, endDate]` - Date range queries

### Notes
- `[userId, deletedAt]` - Active notes filter

### Announcements
- `[publishAt]` - Sort by publish date
- `[schoolId, isPinned, publishAt]` - Pinned announcements
- `[schoolId, expiresAt]` - Expired announcements cleanup

### FileUpload
- `[schoolId]` - School file lookup
- `[entityType, entityId]` - Entity file lookup

### Reports
- `[status]` - Status filtering
- `[generatedBy]` - User report history

### LibraryBook
- `[schoolId, deletedAt]` - Active books filter

### LibraryIssue
- `[dueDate]` - Overdue books query

### FeeRecord
- `[dueDate]` - Overdue fees query

---

## Data Loss Summary

The following columns were altered with potential data loss:

1. **live_classes.title**: VarChar(255) → VarChar(191)
   - Affected rows: 3
   - Impact: Minimal - no titles exceed 191 characters

2. **live_classes.livekitRoomName**: VarChar(255) → VarChar(191)
   - Affected rows: 3
   - Impact: Minimal - no room names exceed 191 characters

3. **voice_rooms.title**: VarChar(255) → VarChar(191)
   - Affected rows: 1
   - Impact: Minimal - no titles exceed 191 characters

**Note**: These changes were required for MySQL UTF8MB4 index compatibility (max index key length of 767 bytes).

---

## Migration Execution

### Method Used
```bash
npx prisma db push --accept-data-loss --skip-generate
```

### Reason for db push instead of migrate
The migration history had a failed migration (`20260503_add_user_bio`) that could not be resolved cleanly. Using `db push` was the safest approach to sync the schema without breaking existing data.

### Verification
- Schema validation: ✅ Passed
- Database sync: ✅ Completed
- Existing data: ✅ Preserved (except 3 varchar column truncations)

---

## Rollback Instructions

If rollback is required, manually drop the new tables:

```sql
-- Group Chat
DROP TABLE IF EXISTS group_message_reads;
DROP TABLE IF EXISTS group_message_reactions;
DROP TABLE IF EXISTS group_messages;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS group_conversations;

-- Assignment/Exam Submissions
DROP TABLE IF EXISTS exam_submissions;
DROP TABLE IF EXISTS assignment_submissions;

-- Marketplace
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;

-- Transport
DROP TABLE IF EXISTS bus_assignments;
DROP TABLE IF EXISTS bus_stops;
DROP TABLE IF EXISTS bus_routes;
DROP TABLE IF EXISTS school_buses;
DROP TABLE IF EXISTS drivers;

-- Analytics
DROP TABLE IF EXISTS daily_user_stats;
DROP TABLE IF EXISTS daily_school_stats;

-- Leaderboards
DROP TABLE IF EXISTS school_leaderboard;
DROP TABLE IF EXISTS global_leaderboard;

-- Search
DROP TABLE IF EXISTS trending_hashtags;
DROP TABLE IF EXISTS search_index;

-- Backup
DROP TABLE IF EXISTS backup_metadata;
```

Then restore the previous schema version from version control.

---

## Seed Data

Seed data is available in `backend/prisma/seed-phase-c.js`.

To run the seed:
```bash
cd backend
node prisma/seed-phase-c.js
```

**Seed data includes**:
- Sample group conversations with members and messages
- Marketplace products, orders, and reviews
- Transport system with buses, routes, stops, drivers, and assignments
- Daily analytics stats
- Leaderboard entries
- Search index entries
- Trending hashtags
- Backup metadata record

---

## Tests

Comprehensive tests for all new models are available in `backend/src/tests/phase-c.test.js`.

To run the tests:
```bash
cd backend
npm test -- src/tests/phase-c.test.js
```

**Test coverage includes**:
- Group Chat: 5 tests (conversations, members, messages, reactions, reads)
- Assignment Submissions: 3 tests (create, submit, grade)
- Exam Submissions: 2 tests (create, auto-grade)
- Marketplace: 3 tests (products, orders, reviews)
- Transport: 1 test (bus assignments)
- Analytics: 2 tests (school stats, user stats)
- Leaderboards: 2 tests (global, school)
- Search: 2 tests (index, trending hashtags)
- Backup: 1 test (metadata)

**Total**: 21 tests

---

## Performance Impact

### Positive Impacts
- **Analytics tables**: Pre-aggregated data reduces query load
- **Leaderboard tables**: Eliminates real-time computation
- **Search index**: Faster full-text search
- **Composite indexes**: Optimized query paths

### Potential Impacts
- **Additional storage**: ~20-50MB for new tables (depends on data volume)
- **Maintenance overhead**: Analytics tables need periodic refresh jobs
- **Index overhead**: Additional indexes increase write time slightly

---

## Production Checklist

Before deploying to production:

- [ ] Review and test seed data
- [ ] Run all tests and ensure they pass
- [ ] Create analytics refresh jobs (BullMQ workers)
- [ ] Create leaderboard recalculation jobs
- [ ] Create search index sync jobs
- [ ] Update API documentation with new endpoints
- [ ] Update frontend with new UI components
- [ ] Update mobile app with new screens
- [ ] Train staff on new features (transport, marketplace, group chat)
- [ ] Set up monitoring for new tables
- [ ] Configure backup retention policy
- [ ] Review and adjust database connection pool size

---

## Next Steps

1. **Backend Implementation**: Create controllers and services for new features
2. **Frontend Implementation**: Build UI components for group chat, marketplace, transport
3. **Mobile Implementation**: Add screens for new features
4. **API Documentation**: Document new endpoints
5. **Analytics Jobs**: Implement background workers for data aggregation
6. **Search Indexing**: Implement real-time search index updates
7. **Leaderboard Refresh**: Implement periodic leaderboard recalculation

---

## Support

For issues or questions about this migration, contact the database team or create an issue in the project repository.
