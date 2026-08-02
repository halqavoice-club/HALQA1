-- ─── THEMED GIFTS MIGRATION ──────────────────────────────────────────────────
-- Adds: Coffee, Romantic Love, Super Racing Car
-- New animation types: bubble, avatar_effect, racing
-- New rarity: standard (between common and rare)

-- Seed 3 new themed gifts
INSERT INTO `gifts` (
  `id`, `name`, `emoji`, `animationType`, `soundEffect`,
  `priceCoins`, `rarity`, `comboEnabled`, `priority`, `isPremium`,
  `isActive`, `sortOrder`, `createdAt`, `updatedAt`
) VALUES
  -- Coffee: 5 coins, common, bubble animation, spam-safe combo
  (UUID(), 'Coffee',         '☕', 'bubble',       'soft_pop.mp3',    5,   'common',   true,  'normal', false, true, 0,  NOW(), NOW()),
  -- Romantic Love: 50 coins, standard, avatar_effect animation
  (UUID(), 'Romantic Love',  '❤️', 'avatar_effect', 'soft_chime.mp3', 50,  'standard', true,  'normal', false, true, 6,  NOW(), NOW()),
  -- Super Racing Car: 200 coins, rare, racing animation
  (UUID(), 'Racing Car',     '🏎️', 'racing',        'engine_rev.mp3', 200, 'rare',     true,  'high',   false, true, 7,  NOW(), NOW());

-- Re-order existing gifts to make room (Coffee goes first at sortOrder=0)
-- Rose stays at 1, Heart at 2, etc. — no changes needed since Coffee is 0
