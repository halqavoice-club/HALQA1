-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260815_add_pk_system
-- Description: Add PK (Player vs Player Battle) system tables
-- Strategy: ADDITIVE ONLY — no existing tables modified, no columns dropped
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── ENUMS (MySQL uses VARCHAR for enum-like values in Prisma) ───────────────
-- Prisma handles enum→VARCHAR mapping. No DDL needed for MySQL enums
-- defined in the schema as enum types (they become VARCHAR with CHECK constraints
-- in Prisma's generated SQL).

-- ─── PK Config ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_config` (
  `id`                         VARCHAR(191) NOT NULL,
  `matchmakingEnabled`          BOOLEAN      NOT NULL DEFAULT true,
  `maxRatingDiffInitial`        INT          NOT NULL DEFAULT 50,
  `maxRatingDiffExpand`         INT          NOT NULL DEFAULT 100,
  `maxRatingDiffFinal`          INT          NOT NULL DEFAULT 200,
  `matchmakingExpandInterval`   INT          NOT NULL DEFAULT 10,
  `defaultDurationSeconds`      INT          NOT NULL DEFAULT 300,
  `minDurationSeconds`          INT          NOT NULL DEFAULT 60,
  `maxDurationSeconds`          INT          NOT NULL DEFAULT 600,
  `countdownSeconds`            INT          NOT NULL DEFAULT 5,
  `platformCutPercent`          INT          NOT NULL DEFAULT 0,
  `comboThresholds`             JSON         NOT NULL,
  `comebackThresholdPercent`    INT          NOT NULL DEFAULT 30,
  `comebackMultiplier`          DOUBLE       NOT NULL DEFAULT 1.5,
  `audienceVoteWeight`          DOUBLE       NOT NULL DEFAULT 0.1,
  `leaderboardCacheTtl`         INT          NOT NULL DEFAULT 300,
  `pkEnabled`                   BOOLEAN      NOT NULL DEFAULT true,
  `tournamentEnabled`           BOOLEAN      NOT NULL DEFAULT true,
  `rankingEnabled`              BOOLEAN      NOT NULL DEFAULT true,
  `votingEnabled`               BOOLEAN      NOT NULL DEFAULT true,
  `teamEnabled`                 BOOLEAN      NOT NULL DEFAULT true,
  `clubEnabled`                 BOOLEAN      NOT NULL DEFAULT true,
  `maxGiftVelocityPerMinute`    INT          NOT NULL DEFAULT 20,
  `suspiciousRatingThreshold`   DOUBLE       NOT NULL DEFAULT 0.9,
  `minMatchesForRating`         INT          NOT NULL DEFAULT 5,
  `updatedAt`                   DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Season ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_seasons` (
  `id`          VARCHAR(191) NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `startDate`   DATETIME(3)  NOT NULL,
  `endDate`     DATETIME(3)  NOT NULL,
  `status`      VARCHAR(20)  NOT NULL DEFAULT 'UPCOMING',
  `description` TEXT         NULL,
  `rules`       JSON         NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `pk_seasons_status_idx` (`status`),
  INDEX `pk_seasons_startDate_idx` (`startDate`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Match ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_matches` (
  `id`               VARCHAR(191) NOT NULL,
  `type`             VARCHAR(20)  NOT NULL DEFAULT 'ONE_V_ONE',
  `state`            VARCHAR(30)  NOT NULL DEFAULT 'IDLE',
  `seasonId`         VARCHAR(191) NULL,
  `tournamentId`     VARCHAR(191) NULL,
  `tournamentRound`  INT          NULL,
  `roomIdA`          VARCHAR(191) NULL,
  `roomIdB`          VARCHAR(191) NULL,
  `roomTypeA`        VARCHAR(20)  NOT NULL DEFAULT 'voice',
  `roomTypeB`        VARCHAR(20)  NOT NULL DEFAULT 'voice',
  `durationSeconds`  INT          NOT NULL DEFAULT 300,
  `countdownSeconds` INT          NOT NULL DEFAULT 5,
  `scheduledAt`      DATETIME(3)  NULL,
  `startedAt`        DATETIME(3)  NULL,
  `endedAt`          DATETIME(3)  NULL,
  `pausedAt`         DATETIME(3)  NULL,
  `pausedDuration`   INT          NOT NULL DEFAULT 0,
  `winnerId`         VARCHAR(191) NULL,
  `winnerSide`       VARCHAR(5)   NULL,
  `scoreA`           INT          NOT NULL DEFAULT 0,
  `scoreB`           INT          NOT NULL DEFAULT 0,
  `giftScoreA`       INT          NOT NULL DEFAULT 0,
  `giftScoreB`       INT          NOT NULL DEFAULT 0,
  `bonusScoreA`      INT          NOT NULL DEFAULT 0,
  `bonusScoreB`      INT          NOT NULL DEFAULT 0,
  `voteScoreA`       INT          NOT NULL DEFAULT 0,
  `voteScoreB`       INT          NOT NULL DEFAULT 0,
  `peakComboA`       INT          NOT NULL DEFAULT 0,
  `peakComboB`       INT          NOT NULL DEFAULT 0,
  `peakViewers`      INT          NOT NULL DEFAULT 0,
  `isRematch`        BOOLEAN      NOT NULL DEFAULT false,
  `previousMatchId`  VARCHAR(191) NULL,
  `endedByAdmin`     BOOLEAN      NOT NULL DEFAULT false,
  `adminNote`        TEXT         NULL,
  `disputeReason`    TEXT         NULL,
  `idempotencyKey`   VARCHAR(191) NOT NULL,
  `createdAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `pk_matches_idempotencyKey_key` (`idempotencyKey`),
  INDEX `pk_matches_state_idx` (`state`),
  INDEX `pk_matches_seasonId_idx` (`seasonId`),
  INDEX `pk_matches_tournamentId_idx` (`tournamentId`),
  INDEX `pk_matches_winnerId_idx` (`winnerId`),
  INDEX `pk_matches_createdAt_idx` (`createdAt`),
  INDEX `pk_matches_type_state_idx` (`type`, `state`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Participant ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_participants` (
  `id`              VARCHAR(191) NOT NULL,
  `pkMatchId`       VARCHAR(191) NOT NULL,
  `userId`          VARCHAR(191) NOT NULL,
  `side`            CHAR(1)      NOT NULL,
  `role`            VARCHAR(30)  NOT NULL DEFAULT 'HOST',
  `teamId`          VARCHAR(191) NULL,
  `isActive`        BOOLEAN      NOT NULL DEFAULT true,
  `joinedAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leftAt`          DATETIME(3)  NULL,
  `disconnectedAt`  DATETIME(3)  NULL,
  `reconnectedAt`   DATETIME(3)  NULL,
  `giftScore`       INT          NOT NULL DEFAULT 0,
  `bonusScore`      INT          NOT NULL DEFAULT 0,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `pk_participants_pkMatchId_userId_key` (`pkMatchId`, `userId`),
  INDEX `pk_participants_pkMatchId_idx` (`pkMatchId`),
  INDEX `pk_participants_userId_idx` (`userId`),
  INDEX `pk_participants_side_idx` (`side`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Team ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_teams` (
  `id`        VARCHAR(191) NOT NULL,
  `pkMatchId` VARCHAR(191) NOT NULL,
  `side`      CHAR(1)      NOT NULL,
  `name`      VARCHAR(120) NOT NULL,
  `avatarUrl` VARCHAR(2048) NULL,
  `captainId` VARCHAR(191) NOT NULL,
  `clubId`    VARCHAR(191) NULL,
  `score`     INT          NOT NULL DEFAULT 0,
  `giftScore` INT          NOT NULL DEFAULT 0,
  `bonusScore` INT         NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `pk_teams_pkMatchId_idx` (`pkMatchId`),
  INDEX `pk_teams_side_idx` (`side`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Invitation ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_invitations` (
  `id`              VARCHAR(191) NOT NULL,
  `senderId`        VARCHAR(191) NOT NULL,
  `receiverId`      VARCHAR(191) NOT NULL,
  `pkMatchId`       VARCHAR(191) NULL,
  `type`            VARCHAR(20)  NOT NULL DEFAULT 'ONE_V_ONE',
  `status`          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  `message`         VARCHAR(280) NULL,
  `durationSeconds` INT          NOT NULL DEFAULT 300,
  `teamSize`        INT          NOT NULL DEFAULT 1,
  `expiresAt`       DATETIME(3)  NOT NULL,
  `acceptedAt`      DATETIME(3)  NULL,
  `rejectedAt`      DATETIME(3)  NULL,
  `cancelledAt`     DATETIME(3)  NULL,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `pk_invitations_senderId_idx` (`senderId`),
  INDEX `pk_invitations_receiverId_idx` (`receiverId`),
  INDEX `pk_invitations_status_idx` (`status`),
  INDEX `pk_invitations_expiresAt_idx` (`expiresAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Gift Event ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_gift_events` (
  `id`                VARCHAR(191) NOT NULL,
  `pkMatchId`         VARCHAR(191) NOT NULL,
  `giftTransactionId` VARCHAR(191) NOT NULL,
  `side`              CHAR(1)      NOT NULL,
  `beneficiaryId`     VARCHAR(191) NOT NULL,
  `coinsSpent`        INT          NOT NULL,
  `giftScore`         INT          NOT NULL,
  `comboMultiplier`   DOUBLE       NOT NULL DEFAULT 1.0,
  `comboLevel`        INT          NOT NULL DEFAULT 0,
  `isComebackBonus`   BOOLEAN      NOT NULL DEFAULT false,
  `bonusScore`        INT          NOT NULL DEFAULT 0,
  `finalScore`        INT          NOT NULL,
  `processedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `pk_gift_events_giftTransactionId_key` (`giftTransactionId`),
  INDEX `pk_gift_events_pkMatchId_idx` (`pkMatchId`),
  INDEX `pk_gift_events_side_idx` (`side`),
  INDEX `pk_gift_events_beneficiaryId_idx` (`beneficiaryId`),
  INDEX `pk_gift_events_pkMatchId_side_idx` (`pkMatchId`, `side`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Vote ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_votes` (
  `id`        VARCHAR(191) NOT NULL,
  `pkMatchId` VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `side`      CHAR(1)      NOT NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `pk_votes_pkMatchId_userId_key` (`pkMatchId`, `userId`),
  INDEX `pk_votes_pkMatchId_idx` (`pkMatchId`),
  INDEX `pk_votes_userId_idx` (`userId`),
  INDEX `pk_votes_side_idx` (`side`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Matchmaking Queue ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_matchmaking_queue` (
  `id`               VARCHAR(191) NOT NULL,
  `userId`           VARCHAR(191) NOT NULL,
  `type`             VARCHAR(20)  NOT NULL DEFAULT 'ONE_V_ONE',
  `preferredRating`  INT          NULL,
  `preferredRegion`  VARCHAR(40)  NULL,
  `preferredLang`    VARCHAR(10)  NULL,
  `durationSeconds`  INT          NOT NULL DEFAULT 300,
  `teamSize`         INT          NOT NULL DEFAULT 1,
  `enteredAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `matchedAt`        DATETIME(3)  NULL,
  `cancelledAt`      DATETIME(3)  NULL,
  `pkMatchId`        VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `pk_matchmaking_queue_userId_key` (`userId`),
  INDEX `pk_matchmaking_queue_type_idx` (`type`),
  INDEX `pk_matchmaking_queue_enteredAt_idx` (`enteredAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK History ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_history` (
  `id`              VARCHAR(191) NOT NULL,
  `pkMatchId`       VARCHAR(191) NOT NULL,
  `type`            VARCHAR(20)  NOT NULL,
  `winnerId`        VARCHAR(191) NULL,
  `winnerSide`      CHAR(1)      NULL,
  `loserSide`       CHAR(1)      NULL,
  `scoreA`          INT          NOT NULL,
  `scoreB`          INT          NOT NULL,
  `giftScoreA`      INT          NOT NULL,
  `giftScoreB`      INT          NOT NULL,
  `voteScoreA`      INT          NOT NULL,
  `voteScoreB`      INT          NOT NULL,
  `peakComboA`      INT          NOT NULL,
  `peakComboB`      INT          NOT NULL,
  `peakViewers`     INT          NOT NULL,
  `durationSeconds` INT          NOT NULL,
  `seasonId`        VARCHAR(191) NULL,
  `tournamentId`    VARCHAR(191) NULL,
  `participantIds`  JSON         NOT NULL,
  `sideAIds`        JSON         NOT NULL,
  `sideBIds`        JSON         NOT NULL,
  `teamAName`       VARCHAR(120) NULL,
  `teamBName`       VARCHAR(120) NULL,
  `totalGifts`      INT          NOT NULL DEFAULT 0,
  `totalCoins`      INT          NOT NULL DEFAULT 0,
  `wasDisputed`     BOOLEAN      NOT NULL DEFAULT false,
  `recordingUrl`    VARCHAR(2048) NULL,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `pk_history_pkMatchId_key` (`pkMatchId`),
  INDEX `pk_history_winnerId_idx` (`winnerId`),
  INDEX `pk_history_seasonId_idx` (`seasonId`),
  INDEX `pk_history_tournamentId_idx` (`tournamentId`),
  INDEX `pk_history_createdAt_idx` (`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK User Stats ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_user_stats` (
  `id`             VARCHAR(191) NOT NULL,
  `userId`         VARCHAR(191) NOT NULL,
  `totalPKs`       INT          NOT NULL DEFAULT 0,
  `wins`           INT          NOT NULL DEFAULT 0,
  `losses`         INT          NOT NULL DEFAULT 0,
  `draws`          INT          NOT NULL DEFAULT 0,
  `winRate`        DOUBLE       NOT NULL DEFAULT 0.0,
  `currentStreak`  INT          NOT NULL DEFAULT 0,
  `bestStreak`     INT          NOT NULL DEFAULT 0,
  `totalScore`     INT          NOT NULL DEFAULT 0,
  `highestScore`   INT          NOT NULL DEFAULT 0,
  `totalGiftsSent` INT          NOT NULL DEFAULT 0,
  `totalGiftsRecv` INT          NOT NULL DEFAULT 0,
  `avgScore`       DOUBLE       NOT NULL DEFAULT 0.0,
  `avgDuration`    DOUBLE       NOT NULL DEFAULT 0.0,
  `rating`         INT          NOT NULL DEFAULT 1000,
  `rank`           VARCHAR(20)  NOT NULL DEFAULT 'BRONZE',
  `peakRating`     INT          NOT NULL DEFAULT 1000,
  `peakRank`       VARCHAR(20)  NOT NULL DEFAULT 'BRONZE',
  `seasonId`       VARCHAR(191) NULL,
  `seasonWins`     INT          NOT NULL DEFAULT 0,
  `seasonLosses`   INT          NOT NULL DEFAULT 0,
  `seasonScore`    INT          NOT NULL DEFAULT 0,
  `seasonRating`   INT          NOT NULL DEFAULT 1000,
  `seasonRank`     VARCHAR(20)  NOT NULL DEFAULT 'BRONZE',
  `updatedAt`      DATETIME(3)  NOT NULL,
  `createdAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `pk_user_stats_userId_key` (`userId`),
  INDEX `pk_user_stats_rating_idx` (`rating`),
  INDEX `pk_user_stats_rank_idx` (`rank`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Rank (season) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_ranks` (
  `id`        VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `seasonId`  VARCHAR(191) NOT NULL,
  `rank`      VARCHAR(20)  NOT NULL DEFAULT 'BRONZE',
  `rating`    INT          NOT NULL DEFAULT 1000,
  `wins`      INT          NOT NULL DEFAULT 0,
  `losses`    INT          NOT NULL DEFAULT 0,
  `score`     INT          NOT NULL DEFAULT 0,
  `position`  INT          NULL,
  `rewards`   JSON         NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `pk_ranks_userId_seasonId_key` (`userId`, `seasonId`),
  INDEX `pk_ranks_seasonId_idx` (`seasonId`),
  INDEX `pk_ranks_rating_idx` (`rating`),
  INDEX `pk_ranks_rank_idx` (`rank`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Leaderboard Entry ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_leaderboard` (
  `id`        VARCHAR(191) NOT NULL,
  `scope`     VARCHAR(20)  NOT NULL,
  `period`    VARCHAR(30)  NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `seasonId`  VARCHAR(191) NULL,
  `rank`      INT          NOT NULL,
  `score`     INT          NOT NULL DEFAULT 0,
  `wins`      INT          NOT NULL DEFAULT 0,
  `rating`    INT          NOT NULL DEFAULT 1000,
  `updatedAt` DATETIME(3)  NOT NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `pk_leaderboard_scope_period_userId_key` (`scope`, `period`, `userId`),
  INDEX `pk_leaderboard_scope_period_rank_idx` (`scope`, `period`, `rank`),
  INDEX `pk_leaderboard_userId_idx` (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Tournament ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_tournaments` (
  `id`                VARCHAR(191) NOT NULL,
  `name`              VARCHAR(120) NOT NULL,
  `description`       TEXT         NULL,
  `status`            VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
  `type`              VARCHAR(20)  NOT NULL DEFAULT 'ONE_V_ONE',
  `bracketType`       VARCHAR(30)  NOT NULL DEFAULT 'SINGLE_ELIMINATION',
  `maxParticipants`   INT          NOT NULL DEFAULT 16,
  `registeredCount`   INT          NOT NULL DEFAULT 0,
  `teamSize`          INT          NOT NULL DEFAULT 1,
  `registrationStart` DATETIME(3)  NOT NULL,
  `registrationEnd`   DATETIME(3)  NOT NULL,
  `startDate`         DATETIME(3)  NOT NULL,
  `endDate`           DATETIME(3)  NOT NULL,
  `prizeDescription`  TEXT         NULL,
  `rules`             JSON         NULL,
  `createdBy`         VARCHAR(191) NOT NULL,
  `cancelledAt`       DATETIME(3)  NULL,
  `cancelReason`      TEXT         NULL,
  `createdAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`         DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `pk_tournaments_status_idx` (`status`),
  INDEX `pk_tournaments_startDate_idx` (`startDate`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Tournament Participant ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_tournament_participants` (
  `id`           VARCHAR(191) NOT NULL,
  `tournamentId` VARCHAR(191) NOT NULL,
  `userId`       VARCHAR(191) NOT NULL,
  `seed`         INT          NULL,
  `wins`         INT          NOT NULL DEFAULT 0,
  `losses`       INT          NOT NULL DEFAULT 0,
  `eliminated`   BOOLEAN      NOT NULL DEFAULT false,
  `eliminatedAt` DATETIME(3)  NULL,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `pk_tournament_participants_tournamentId_userId_key` (`tournamentId`, `userId`),
  INDEX `pk_tournament_participants_tournamentId_idx` (`tournamentId`),
  INDEX `pk_tournament_participants_userId_idx` (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Achievement ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_achievements` (
  `id`          VARCHAR(191) NOT NULL,
  `key`         VARCHAR(191) NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `description` TEXT         NOT NULL,
  `iconUrl`     VARCHAR(2048) NULL,
  `condition`   JSON         NOT NULL,
  `isActive`    BOOLEAN      NOT NULL DEFAULT true,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `pk_achievements_key_key` (`key`),
  INDEX `pk_achievements_isActive_idx` (`isActive`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK User Achievement ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_user_achievements` (
  `id`            VARCHAR(191) NOT NULL,
  `userId`        VARCHAR(191) NOT NULL,
  `achievementId` VARCHAR(191) NOT NULL,
  `unlockedAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `pkMatchId`     VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `pk_user_achievements_userId_achievementId_key` (`userId`, `achievementId`),
  INDEX `pk_user_achievements_userId_idx` (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Mission ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_missions` (
  `id`          VARCHAR(191) NOT NULL,
  `key`         VARCHAR(191) NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `description` TEXT         NOT NULL,
  `type`        VARCHAR(20)  NOT NULL DEFAULT 'DAILY',
  `condition`   JSON         NOT NULL,
  `reward`      JSON         NULL,
  `isActive`    BOOLEAN      NOT NULL DEFAULT true,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `pk_missions_key_key` (`key`),
  INDEX `pk_missions_type_idx` (`type`),
  INDEX `pk_missions_isActive_idx` (`isActive`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Mission Progress ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_mission_progress` (
  `id`          VARCHAR(191) NOT NULL,
  `userId`      VARCHAR(191) NOT NULL,
  `missionId`   VARCHAR(191) NOT NULL,
  `progress`    INT          NOT NULL DEFAULT 0,
  `target`      INT          NOT NULL,
  `completed`   BOOLEAN      NOT NULL DEFAULT false,
  `completedAt` DATETIME(3)  NULL,
  `periodStart` DATETIME(3)  NOT NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `pk_mission_progress_userId_missionId_periodStart_key` (`userId`, `missionId`, `periodStart`),
  INDEX `pk_mission_progress_userId_idx` (`userId`),
  INDEX `pk_mission_progress_missionId_idx` (`missionId`),
  INDEX `pk_mission_progress_completed_idx` (`completed`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Audit Log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_audit_logs` (
  `id`          VARCHAR(191) NOT NULL,
  `pkMatchId`   VARCHAR(191) NOT NULL,
  `adminId`     VARCHAR(191) NOT NULL,
  `action`      VARCHAR(60)  NOT NULL,
  `reason`      TEXT         NULL,
  `beforeValue` JSON         NULL,
  `afterValue`  JSON         NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `pk_audit_logs_pkMatchId_idx` (`pkMatchId`),
  INDEX `pk_audit_logs_adminId_idx` (`adminId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── PK Analytics Event ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pk_analytics_events` (
  `id`        VARCHAR(191) NOT NULL,
  `eventType` VARCHAR(60)  NOT NULL,
  `pkMatchId` VARCHAR(191) NULL,
  `userId`    VARCHAR(191) NULL,
  `side`      CHAR(1)      NULL,
  `data`      JSON         NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `pk_analytics_events_eventType_idx` (`eventType`),
  INDEX `pk_analytics_events_pkMatchId_idx` (`pkMatchId`),
  INDEX `pk_analytics_events_userId_idx` (`userId`),
  INDEX `pk_analytics_events_createdAt_idx` (`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Seed default PK achievements ────────────────────────────────────────────
INSERT IGNORE INTO `pk_achievements` (`id`, `key`, `name`, `description`, `condition`, `isActive`, `createdAt`) VALUES
  (UUID(), 'first_pk',       'First Battle',      'Complete your first PK',           JSON_OBJECT('type','pks_gte','value',1),   true, NOW()),
  (UUID(), 'first_win',      'First Victory',     'Win your first PK battle',          JSON_OBJECT('type','wins_gte','value',1),  true, NOW()),
  (UUID(), 'win_10',         '10 Wins',           'Win 10 PK battles',                 JSON_OBJECT('type','wins_gte','value',10), true, NOW()),
  (UUID(), 'win_50',         '50 Wins',           'Win 50 PK battles',                 JSON_OBJECT('type','wins_gte','value',50), true, NOW()),
  (UUID(), 'streak_10',      'Win Streak x10',    'Achieve a 10-win streak',           JSON_OBJECT('type','streak_gte','value',10), true, NOW()),
  (UUID(), 'high_score_5000','High Scorer',       'Achieve a score of 5000 in one PK', JSON_OBJECT('type','score_gte','value',5000), true, NOW());

-- ─── Seed default PK missions ─────────────────────────────────────────────────
INSERT IGNORE INTO `pk_missions` (`id`, `key`, `name`, `description`, `type`, `condition`, `reward`, `isActive`, `createdAt`) VALUES
  (UUID(), 'daily_play_1',  'First Battle Today', 'Play 1 PK today',   'DAILY',  JSON_OBJECT('type','pks_gte','value',1), JSON_OBJECT('xp',10), true, NOW()),
  (UUID(), 'daily_win_1',   'Daily Winner',       'Win 1 PK today',    'DAILY',  JSON_OBJECT('type','wins_gte','value',1), JSON_OBJECT('xp',20), true, NOW()),
  (UUID(), 'weekly_win_3',  'Weekly Champion',    'Win 3 PKs this week','WEEKLY', JSON_OBJECT('type','wins_gte','value',3), JSON_OBJECT('xp',50), true, NOW());
