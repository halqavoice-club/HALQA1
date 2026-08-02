/**
 * runtime-test.js — full runtime verification of all previously-failing queries
 * Run: node src/prisma/runtime-test.js
 */
const prisma = require('../utils/prisma');

async function fullCheck() {
  const results = [];

  // 1. Dashboard SUPER_ADMIN query (schoolId = null)
  try {
    const schoolFilter = {};
    const count = await prisma.student.count({ where: { ...schoolFilter, deletedAt: null } });
    results.push({ ok: true, name: 'dashboard SUPER_ADMIN (schoolId=null)', detail: count + ' students' });
  } catch(e) { results.push({ ok: false, name: 'dashboard SUPER_ADMIN', detail: e.message.split('\n')[0] }); }

  // 2. Term query (schoolId = null)
  try {
    const terms = await prisma.term.findMany({ where: { deletedAt: null }, take: 1 });
    results.push({ ok: true, name: 'term query (no schoolId)', detail: terms.length + ' terms' });
  } catch(e) { results.push({ ok: false, name: 'term query', detail: e.message.split('\n')[0] }); }

  // 3. Voice rooms with all new columns
  try {
    const rooms = await prisma.voiceRoom.findMany({
      where: { deletedAt: null, status: { not: 'ENDED' } },
      select: { id: true, title: true, isOpenMic: true, lastActivityAt: true, commentsEnabled: true, slowMode: true, messageType: true, coverImageUrl: true },
      take: 1
    });
    results.push({ ok: true, name: 'voice_rooms all columns', detail: rooms.length + ' rooms' });
  } catch(e) { results.push({ ok: false, name: 'voice_rooms columns', detail: e.message.split('\n')[0] }); }

  // 4. Gifts with isPremium + priority
  try {
    const gifts = await prisma.gift.findMany({
      where: { isActive: true },
      select: { id: true, name: true, isPremium: true, priority: true },
      take: 5
    });
    results.push({ ok: true, name: 'gifts isPremium+priority', detail: gifts.map(g => g.name).join(', ') });
  } catch(e) { results.push({ ok: false, name: 'gifts columns', detail: e.message.split('\n')[0] }); }

  // 5. Gift transactions with isPremium + priority
  try {
    const txn = await prisma.giftTransaction.findFirst({
      select: { id: true, isPremium: true, priority: true }
    });
    results.push({ ok: true, name: 'gift_transactions isPremium+priority', detail: txn ? 'found' : 'empty table (OK)' });
  } catch(e) { results.push({ ok: false, name: 'gift_transactions columns', detail: e.message.split('\n')[0] }); }

  // 6. Audio categories
  try {
    const cats = await prisma.audioCategory.findMany({ take: 1 });
    results.push({ ok: true, name: 'audioCategory table', detail: cats.length + ' rows' });
  } catch(e) { results.push({ ok: false, name: 'audioCategory', detail: e.message.split('\n')[0] }); }

  // 7. Library books
  try {
    const books = await prisma.libraryBook.findMany({ take: 1 });
    results.push({ ok: true, name: 'libraryBook table', detail: books.length + ' rows' });
  } catch(e) { results.push({ ok: false, name: 'libraryBook', detail: e.message.split('\n')[0] }); }

  // 8. Fee records
  try {
    const fees = await prisma.feeRecord.findMany({ take: 1 });
    results.push({ ok: true, name: 'feeRecord table', detail: fees.length + ' rows' });
  } catch(e) { results.push({ ok: false, name: 'feeRecord', detail: e.message.split('\n')[0] }); }

  // 9. Wallets
  try {
    const wallets = await prisma.wallet.findMany({ take: 1 });
    results.push({ ok: true, name: 'wallet table', detail: wallets.length + ' rows' });
  } catch(e) { results.push({ ok: false, name: 'wallet', detail: e.message.split('\n')[0] }); }

  // 10. Social follows
  try {
    const follows = await prisma.follow.findMany({ take: 1 });
    results.push({ ok: true, name: 'follows table', detail: follows.length + ' rows' });
  } catch(e) { results.push({ ok: false, name: 'follows', detail: e.message.split('\n')[0] }); }

  // 11. DM conversations
  try {
    const convs = await prisma.dmConversation.findMany({ take: 1 });
    results.push({ ok: true, name: 'dmConversation table', detail: convs.length + ' rows' });
  } catch(e) { results.push({ ok: false, name: 'dmConversation', detail: e.message.split('\n')[0] }); }

  // 12. User bio
  try {
    const user = await prisma.user.findFirst({ select: { id: true, bio: true } });
    results.push({ ok: true, name: 'users.bio column', detail: 'OK' });
  } catch(e) { results.push({ ok: false, name: 'users.bio', detail: e.message.split('\n')[0] }); }

  // Print results
  console.log('\n═══════════════════════════════════════════');
  console.log('  RUNTIME TEST RESULTS');
  console.log('═══════════════════════════════════════════');
  let passed = 0, failed = 0;
  results.forEach(r => {
    if (r.ok) { console.log('  ✅ ' + r.name + ' — ' + r.detail); passed++; }
    else       { console.log('  ❌ ' + r.name + ' — ' + r.detail); failed++; }
  });
  console.log('═══════════════════════════════════════════');
  console.log('  ' + passed + ' passed, ' + failed + ' failed');
  console.log('═══════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

fullCheck()
  .catch(e => { console.error('FATAL:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
