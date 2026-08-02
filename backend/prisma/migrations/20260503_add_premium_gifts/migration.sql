-- ─── PREMIUM GIFTS MIGRATION ─────────────────────────────────────────────────
-- Adds: priority column, cinematic animationType, ultimate rarity
-- Extends gifts table with premium gift fields

ALTER TABLE `gifts`
  ADD COLUMN `priority`    VARCHAR(191) NOT NULL DEFAULT 'normal' AFTER `comboEnabled`,
  ADD COLUMN `isPremium`   BOOLEAN      NOT NULL DEFAULT false     AFTER `priority`;

-- Add index for premium lookup
ALTER TABLE `gifts` ADD INDEX `gifts_isPremium_idx` (`isPremium`);

-- Add priority to gift_transactions for analytics
ALTER TABLE `gift_transactions`
  ADD COLUMN `priority`  VARCHAR(191) NOT NULL DEFAULT 'normal' AFTER `combo`,
  ADD COLUMN `isPremium` BOOLEAN      NOT NULL DEFAULT false     AFTER `priority`;

-- ─── Seed premium gifts ───────────────────────────────────────────────────────
INSERT INTO `gifts` (
  `id`, `name`, `emoji`, `animationType`, `soundEffect`,
  `priceCoins`, `rarity`, `comboEnabled`, `priority`, `isPremium`,
  `isActive`, `sortOrder`, `createdAt`, `updatedAt`
) VALUES
  -- Horse: 500 coins, epic, overlay, combo allowed
  (UUID(), 'Horse',         '🐎', 'overlay',    'horse_run.mp3',   500,  'epic',      true,  'high',  true, true, 11, NOW(), NOW()),
  -- Lion: 1000 coins, legendary, fullscreen, no combo
  (UUID(), 'Lion',          '🦁', 'fullscreen', 'lion_roar.mp3',   1000, 'legendary', false, 'high',  true, true, 12, NOW(), NOW()),
  -- Burj Khalifa: 5000 coins, ultimate, cinematic, no combo
  (UUID(), 'Burj Khalifa',  '🏙️', 'cinematic',  'fireworks.mp3',   5000, 'ultimate',  false, 'ultra', true, true, 13, NOW(), NOW());
