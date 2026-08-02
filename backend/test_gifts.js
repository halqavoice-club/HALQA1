const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

p.gift.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })
  .then(r => {
    console.log('Total gifts:', r.length);
    r.forEach(g => console.log(
      `  [${g.sortOrder}] ${g.emoji} ${g.name.padEnd(15)} | ${g.rarity.padEnd(10)} | ${String(g.priceCoins).padStart(5)} coins | priority=${g.priority} | premium=${g.isPremium}`
    ));
    p.$disconnect();
  })
  .catch(e => {
    console.error('ERROR:', e.message);
    p.$disconnect();
    process.exit(1);
  });
