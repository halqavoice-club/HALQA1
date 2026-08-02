/**
 * Reset gift catalog — deletes all and re-seeds with correct data.
 * Run: node src/prisma/reset-gifts.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const GIFTS = [
  { id: 'gift-coffee',  name: 'Coffee',        emoji: '☕',  priceCoins: 1,    rarity: 'common',    animationType: 'bubble',        comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 1  },
  { id: 'gift-rose',    name: 'Rose',          emoji: '🌹',  priceCoins: 5,    rarity: 'common',    animationType: 'overlay',       comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 2  },
  { id: 'gift-love',    name: 'Romantic Love', emoji: '❤️',  priceCoins: 10,   rarity: 'standard',  animationType: 'avatar_effect', comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 3  },
  { id: 'gift-mic',     name: 'Golden Mic',    emoji: '🎙️', priceCoins: 20,   rarity: 'standard',  animationType: 'overlay',       comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 4  },
  { id: 'gift-star',    name: 'Star',          emoji: '⭐',  priceCoins: 50,   rarity: 'rare',      animationType: 'spotlight',     comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 5  },
  { id: 'gift-diamond', name: 'Diamond',       emoji: '💎',  priceCoins: 100,  rarity: 'rare',      animationType: 'banner',        comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 6  },
  { id: 'gift-rocket',  name: 'Rocket',        emoji: '🚀',  priceCoins: 200,  rarity: 'epic',      animationType: 'rocket_launch', comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 7  },
  { id: 'gift-crown',   name: 'Crown',         emoji: '👑',  priceCoins: 300,  rarity: 'epic',      animationType: 'banner',        comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 8  },
  { id: 'gift-car',     name: 'Racing Car',    emoji: '🏎️', priceCoins: 500,  rarity: 'epic',      animationType: 'racing',        comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 9  },
  { id: 'gift-galaxy',  name: 'Galaxy',        emoji: '🌌',  priceCoins: 999,  rarity: 'legendary', animationType: 'fullscreen',    comboEnabled: true,  isPremium: false, priority: 'normal', sortOrder: 10 },
  { id: 'gift-horse',   name: 'Horse',         emoji: '🐎',  priceCoins: 500,  rarity: 'legendary', animationType: 'overlay',       comboEnabled: true,  isPremium: true,  priority: 'high',   sortOrder: 11 },
  { id: 'gift-lion',    name: 'Lion',          emoji: '🦁',  priceCoins: 1000, rarity: 'legendary', animationType: 'fullscreen',    comboEnabled: false, isPremium: true,  priority: 'high',   sortOrder: 12 },
  { id: 'gift-burj',    name: 'Burj Khalifa',  emoji: '🏙️', priceCoins: 5000, rarity: 'ultimate',  animationType: 'cinematic',     comboEnabled: false, isPremium: true,  priority: 'ultra',  sortOrder: 13 },
];

const PACKAGES = [
  { id: 'pkg-starter',  name: 'Starter',  coins: 100,   bonusCoins: 0,    priceUsd: 0.99,  sortOrder: 1 },
  { id: 'pkg-basic',    name: 'Basic',    coins: 500,   bonusCoins: 50,   priceUsd: 4.99,  sortOrder: 2 },
  { id: 'pkg-popular',  name: 'Popular',  coins: 1000,  bonusCoins: 150,  priceUsd: 9.99,  sortOrder: 3 },
  { id: 'pkg-value',    name: 'Value',    coins: 2500,  bonusCoins: 500,  priceUsd: 19.99, sortOrder: 4 },
  { id: 'pkg-premium',  name: 'Premium',  coins: 5000,  bonusCoins: 1500, priceUsd: 39.99, sortOrder: 5 },
  { id: 'pkg-ultimate', name: 'Ultimate', coins: 10000, bonusCoins: 4000, priceUsd: 79.99, sortOrder: 6 },
];

async function main() {
  // Delete transactions first (FK constraint), then gifts
  const txDel = await prisma.giftTransaction.deleteMany({});
  console.log(`Deleted ${txDel.count} gift transactions`);

  const lbDel = await prisma.roomGiftLeaderboard.deleteMany({});
  console.log(`Deleted ${lbDel.count} leaderboard entries`);

  const deleted = await prisma.gift.deleteMany({});
  console.log(`Deleted ${deleted.count} old gifts`);

  // Re-seed with correct data
  for (const g of GIFTS) {
    await prisma.gift.create({ data: { ...g, isActive: true, soundEffect: null, imageUrl: null } });
    console.log(`  + ${g.emoji} ${g.name}`);
  }

  // Upsert coin packages
  for (const pkg of PACKAGES) {
    await prisma.coinPackage.upsert({
      where: { id: pkg.id },
      create: { ...pkg, isActive: true },
      update: { ...pkg, isActive: true },
    });
  }

  const total = await prisma.gift.count();
  console.log(`\nDone. ${total} gifts in DB.`);
}

main()
  .catch(e => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
