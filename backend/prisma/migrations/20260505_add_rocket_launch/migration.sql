-- ─── ROCKET LAUNCH MIGRATION ─────────────────────────────────────────────────
-- Version 1: Upgrade existing Rocket → rocket_launch animation (mid-tier, combo)
-- Version 2: Add Rocket Pro → rocket_cinematic animation (premium, no combo)

-- Upgrade existing Rocket gift to use the new rocket_launch animation type
UPDATE `gifts`
SET
  `animationType` = 'rocket_launch',
  `updatedAt`     = NOW()
WHERE `name` = 'Rocket' AND `isPremium` = false;

-- Add Rocket Pro (premium, legendary, no combo, cinematic launch)
INSERT INTO `gifts` (
  `id`, `name`, `emoji`, `animationType`, `soundEffect`,
  `priceCoins`, `rarity`, `comboEnabled`, `priority`, `isPremium`,
  `isActive`, `sortOrder`, `createdAt`, `updatedAt`
) VALUES (
  UUID(),
  'Rocket Pro',
  '🚀',
  'rocket_cinematic',
  'rocket_launch.mp3',
  2000,
  'legendary',
  false,
  'ultra',
  true,
  true,
  14,
  NOW(),
  NOW()
);
