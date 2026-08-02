/**
 * Seed coin packages into the database.
 * Run with: node src/prisma/seed-coins.js
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const PACKAGES = [
  { name: 'Starter Pack',    coins: 100,   bonusCoins: 0,   priceUsd: 0.99,  sortOrder: 1 },
  { name: 'Basic Pack',      coins: 500,   bonusCoins: 50,  priceUsd: 4.99,  sortOrder: 2 },
  { name: 'Standard Pack',   coins: 1000,  bonusCoins: 150, priceUsd: 9.99,  sortOrder: 3 },
  { name: 'Premium Pack',    coins: 3000,  bonusCoins: 600, priceUsd: 24.99, sortOrder: 4 },
  { name: 'Ultimate Pack',   coins: 6000,  bonusCoins: 1800,priceUsd: 49.99, sortOrder: 5 },
]

async function main() {
  console.log('Seeding coin packages...')

  for (const pkg of PACKAGES) {
    const existing = await prisma.coinPackage.findFirst({ where: { name: pkg.name } })
    if (existing) {
      console.log(`  ⏭  Skipped (already exists): ${pkg.name}`)
      continue
    }
    await prisma.coinPackage.create({ data: { ...pkg, isActive: true } })
    console.log(`  ✅ Created: ${pkg.name} — ${pkg.coins + pkg.bonusCoins} coins for $${pkg.priceUsd}`)
  }

  console.log('Done.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
