-- Universal Gift Engine: make gift_transactions and room_gift_leaderboard room-type agnostic
-- Drop the VoiceRoom FK so any room type (live_class, pk, etc.) can use the same tables
-- All existing voice rows are preserved (room_type defaults to 'voice')

-- 1. Drop the FK constraint on gift_transactions.room_id (MySQL finds FK name dynamically)
SET @fk1 = (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gift_transactions'
    AND COLUMN_NAME = 'room_id'
    AND REFERENCED_TABLE_NAME = 'voice_rooms'
  LIMIT 1
);
SET @sql1 = IF(@fk1 IS NOT NULL,
  CONCAT('ALTER TABLE `gift_transactions` DROP FOREIGN KEY `', @fk1, '`'),
  'SELECT 1'
);
PREPARE stmt1 FROM @sql1; EXECUTE stmt1; DEALLOCATE PREPARE stmt1;

-- 2. Drop the FK constraint on room_gift_leaderboard.room_id
SET @fk2 = (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'room_gift_leaderboard'
    AND COLUMN_NAME = 'room_id'
    AND REFERENCED_TABLE_NAME = 'voice_rooms'
  LIMIT 1
);
SET @sql2 = IF(@fk2 IS NOT NULL,
  CONCAT('ALTER TABLE `room_gift_leaderboard` DROP FOREIGN KEY `', @fk2, '`'),
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- 3. Add room_type column to both tables (idempotent)
ALTER TABLE `gift_transactions`
  ADD COLUMN `room_type` VARCHAR(30) NOT NULL DEFAULT 'voice';

ALTER TABLE `room_gift_leaderboard`
  ADD COLUMN `room_type` VARCHAR(30) NOT NULL DEFAULT 'voice';

-- 4. Add indexes for room_type
CREATE INDEX IF NOT EXISTS `gift_transactions_room_type_idx` ON `gift_transactions` (`room_type`);
CREATE INDEX IF NOT EXISTS `room_gift_leaderboard_room_type_idx` ON `room_gift_leaderboard` (`room_type`);

-- 5. Add missing columns to gifts table if needed (idempotent)
ALTER TABLE `gifts`
  ADD COLUMN `priority`  VARCHAR(30) NOT NULL DEFAULT 'normal',
  ADD COLUMN `isPremium` BOOLEAN     NOT NULL DEFAULT false;

-- 6. Seed educational gift collection (camelCase column names to match existing schema)
INSERT IGNORE INTO `gifts` (`id`, `name`, `emoji`, `imageUrl`, `animationType`, `soundEffect`, `priceCoins`, `rarity`, `comboEnabled`, `priority`, `isPremium`, `isActive`, `sortOrder`, `createdAt`, `updatedAt`) VALUES
  (UUID(), 'Notebook',          '📔', NULL, 'floating',         NULL, 1,     'common',    0, 'normal', 0, 1, 200, NOW(), NOW()),
  (UUID(), 'Book',              '📚', NULL, 'floating',         NULL, 5,     'common',    0, 'normal', 0, 1, 201, NOW(), NOW()),
  (UUID(), 'Golden Pencil',     '✏',  NULL, 'overlay',          NULL, 20,    'rare',      1, 'normal', 0, 1, 202, NOW(), NOW()),
  (UUID(), 'Certificate',       '📜', NULL, 'banner',           NULL, 50,    'rare',      1, 'normal', 0, 1, 203, NOW(), NOW()),
  (UUID(), 'Graduation Cap',    '🎓', NULL, 'spotlight',        NULL, 100,   'epic',      1, 'high',   0, 1, 204, NOW(), NOW()),
  (UUID(), 'Knowledge Tree',    '🌳', NULL, 'spotlight',        NULL, 200,   'epic',      1, 'high',   0, 1, 205, NOW(), NOW()),
  (UUID(), 'Microscope',        '🔬', NULL, 'overlay',          NULL, 30,    'rare',      1, 'normal', 0, 1, 206, NOW(), NOW()),
  (UUID(), 'Telescope',         '🔭', NULL, 'overlay',          NULL, 30,    'rare',      1, 'normal', 0, 1, 207, NOW(), NOW()),
  (UUID(), 'Laptop',            '💻', NULL, 'spotlight',        NULL, 150,   'epic',      1, 'high',   0, 1, 208, NOW(), NOW()),
  (UUID(), 'Library',           '🏛', NULL, 'spotlight',        NULL, 300,   'epic',      1, 'high',   0, 1, 209, NOW(), NOW()),
  (UUID(), 'Globe',             '🌍', NULL, 'overlay',          NULL, 25,    'rare',      1, 'normal', 0, 1, 210, NOW(), NOW()),
  (UUID(), 'Teacher Medal',     '🏅', NULL, 'fullscreen',       NULL, 500,   'epic',      1, 'high',   0, 1, 211, NOW(), NOW()),
  (UUID(), 'Star Student',      '⭐', NULL, 'overlay',          NULL, 100,   'rare',      1, 'normal', 0, 1, 212, NOW(), NOW()),
  (UUID(), 'Golden Trophy',     '🏆', NULL, 'cinematic',        NULL, 1000,  'legendary', 1, 'ultra',  1, 1, 213, NOW(), NOW()),
  (UUID(), 'Brain',             '🧠', NULL, 'overlay',          NULL, 50,    'rare',      1, 'normal', 0, 1, 214, NOW(), NOW()),
  (UUID(), 'Rocket',            '🚀', NULL, 'rocket_launch',    NULL, 200,   'epic',      1, 'high',   0, 1, 215, NOW(), NOW()),
  (UUID(), 'Diamond Book',      '💎', NULL, 'cinematic',        NULL, 2000,  'legendary', 1, 'ultra',  1, 1, 216, NOW(), NOW()),
  (UUID(), 'Magic Blackboard',  '🖊', NULL, 'fullscreen',       NULL, 500,   'epic',      1, 'high',   0, 1, 217, NOW(), NOW()),
  (UUID(), 'Wisdom Crown',      '👑', NULL, 'rocket_cinematic', NULL, 5000,  'legendary', 1, 'ultra',  1, 1, 218, NOW(), NOW()),
  (UUID(), 'Scholarship',       '🎖', NULL, 'rocket_cinematic', NULL, 10000, 'legendary', 1, 'ultra',  1, 1, 219, NOW(), NOW());
