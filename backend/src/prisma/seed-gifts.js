/**
 * Seed script — Gift catalog + Coin packages
 * Run: node src/prisma/seed-gifts.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const GIFTS = [
  // ── Normal gifts ──────────────────────────────────────────────────────────
  { id: 'gift-coffee',   name: 'Coffee',       emoji: '☕',  priceCoins: 1,    rarity: 'common',    animationType: 'bubble',          comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 1,  soundEffect: null },
  { id: 'gift-rose',     name: 'Rose',         emoji: '🌹',  priceCoins: 5,    rarity: 'common',    animationType: 'overlay',         comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 2,  soundEffect: null },
  { id: 'gift-love',     name: 'Romantic Love',emoji: '❤️',  priceCoins: 10,   rarity: 'standard',  animationType: 'avatar_effect',   comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 3,  soundEffect: null },
  { id: 'gift-mic',      name: 'Golden Mic',   emoji: '🎙️', priceCoins: 20,   rarity: 'standard',  animationType: 'overlay',         comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 4,  soundEffect: null },
  { id: 'gift-star',     name: 'Star',         emoji: '⭐',  priceCoins: 50,   rarity: 'rare',      animationType: 'spotlight',       comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 5,  soundEffect: null },
  { id: 'gift-diamond',  name: 'Diamond',      emoji: '💎',  priceCoins: 100,  rarity: 'rare',      animationType: 'banner',          comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 6,  soundEffect: null },
  { id: 'gift-rocket',   name: 'Rocket',       emoji: '🚀',  priceCoins: 200,  rarity: 'epic',      animationType: 'rocket_launch',   comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 7,  soundEffect: null },
  { id: 'gift-crown',    name: 'Crown',        emoji: '👑',  priceCoins: 300,  rarity: 'epic',      animationType: 'banner',          comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 8,  soundEffect: null },
  { id: 'gift-car',      name: 'Racing Car',   emoji: '🏎️', priceCoins: 500,  rarity: 'epic',      animationType: 'racing',          comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 9,  soundEffect: null },
  { id: 'gift-galaxy',   name: 'Galaxy',       emoji: '🌌',  priceCoins: 999,  rarity: 'legendary', animationType: 'fullscreen',      comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 10, soundEffect: null },
  // ── Premium gifts ─────────────────────────────────────────────────────────
  { id: 'gift-horse',    name: 'Horse',        emoji: '🐎',  priceCoins: 500,  rarity: 'legendary', animationType: 'overlay',         comboEnabled: true,  isPremium: true,  priority: 'high',   sortOrder: 11, soundEffect: null },
  { id: 'gift-lion',     name: 'Lion',         emoji: '🦁',  priceCoins: 1000, rarity: 'legendary', animationType: 'fullscreen',      comboEnabled: false, isPremium: true,  priority: 'high',   sortOrder: 12, soundEffect: null },
  { id: 'gift-burj',     name: 'Burj Khalifa', emoji: '🏙️', priceCoins: 5000, rarity: 'ultimate',  animationType: 'cinematic',       comboEnabled: false, isPremium: true,  priority: 'ultra',  sortOrder: 13, soundEffect: null },
];

const COIN_PACKAGES = [
  { id: 'pkg-starter',  name: 'Starter',    coins: 100,   bonusCoins: 0,    priceUsd: 0.99,  sortOrder: 1, isActive: true },
  { id: 'pkg-basic',    name: 'Basic',      coins: 500,   bonusCoins: 50,   priceUsd: 4.99,  sortOrder: 2, isActive: true },
  { id: 'pkg-popular',  name: 'Popular',    coins: 1000,  bonusCoins: 150,  priceUsd: 9.99,  sortOrder: 3, isActive: true },
  { id: 'pkg-value',    name: 'Value',      coins: 2500,  bonusCoins: 500,  priceUsd: 19.99, sortOrder: 4, isActive: true },
  { id: 'pkg-premium',  name: 'Premium',    coins: 5000,  bonusCoins: 1500, priceUsd: 39.99, sortOrder: 5, isActive: true },
  { id: 'pkg-ultimate', name: 'Ultimate',   coins: 10000, bonusCoins: 4000, priceUsd: 79.99, sortOrder: 6, isActive: true },
];

async function main() {
  console.log('🎁 Seeding gift catalog...');

  for (const gift of GIFTS) {
    await prisma.gift.upsert({
      where:  { id: gift.id },
      create: gift,
      update: gift,
    });
    console.log(`  ✓ ${gift.emoji} ${gift.name} (${gift.priceCoins} coins)`);
  }

  console.log('\n🪙 Seeding coin packages...');

  for (const pkg of COIN_PACKAGES) {
    await prisma.coinPackage.upsert({
      where:  { id: pkg.id },
      create: pkg,
      update: pkg,
    });
    console.log(`  ✓ ${pkg.name}: ${pkg.coins} + ${pkg.bonusCoins} bonus = $${pkg.priceUsd}`);
  }

  console.log('\n✅ Gift seed complete!');
  console.log(`   ${GIFTS.length} gifts, ${COIN_PACKAGES.length} coin packages`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
