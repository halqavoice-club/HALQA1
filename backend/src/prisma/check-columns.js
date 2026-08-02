/**
 * check-columns.js — verify all critical DB columns exist
 * Run: node src/prisma/check-columns.js
 */
const prisma = require('../utils/prisma');

async function check() {
  const errors = [];

  try {
    const room = await prisma.voiceRoom.findFirst({
      select: {
        id: true, isOpenMic: true, lastActivityAt: true,
        commentsEnabled: true, slowMode: true, messageType: true, coverImageUrl: true
      }
    });
    console.log('✅ voice_rooms columns OK');
  } catch(e) { errors.push('voice_rooms: ' + e.message.split('\n')[0]); }

  try {
    const gift = await prisma.gift.findFirst({ select: { id: true, isPremium: true, priority: true } });
    console.log('✅ gifts columns OK');
  } catch(e) { errors.push('gifts: ' + e.message.split('\n')[0]); }

  try {
    const txn = await prisma.giftTransaction.findFirst({ select: { id: true, isPremium: true, priority: true } });
    console.log('✅ gift_transactions columns OK');
  } catch(e) { errors.push('gift_transactions: ' + e.message.split('\n')[0]); }

  try {
    const user = await prisma.user.findFirst({ select: { id: true, bio: true } });
    console.log('✅ users.bio OK');
  } catch(e) { errors.push('users.bio: ' + e.message.split('\n')[0]); }

  try {
    const audio = await prisma.audioCategory.findFirst({ select: { id: true } });
    console.log('✅ audioCategory table OK');
  } catch(e) { errors.push('audioCategory: ' + e.message.split('\n')[0]); }

  try {
    const lib = await prisma.libraryBook.findFirst({ select: { id: true } });
    console.log('✅ libraryBook table OK');
  } catch(e) { errors.push('libraryBook: ' + e.message.split('\n')[0]); }

  try {
    const fee = await prisma.feeRecord.findFirst({ select: { id: true } });
    console.log('✅ feeRecord table OK');
  } catch(e) { errors.push('feeRecord: ' + e.message.split('\n')[0]); }

  try {
    const wallet = await prisma.wallet.findFirst({ select: { id: true, coins: true, diamonds: true } });
    console.log('✅ wallet table OK');
  } catch(e) { errors.push('wallet: ' + e.message.split('\n')[0]); }

  try {
    const follow = await prisma.follow.findFirst({ select: { id: true } });
    console.log('✅ follows table OK');
  } catch(e) { errors.push('follows: ' + e.message.split('\n')[0]); }

  try {
    const dm = await prisma.dmConversation.findFirst({ select: { id: true } });
    console.log('✅ dm_conversations table OK');
  } catch(e) { errors.push('dm_conversations: ' + e.message.split('\n')[0]); }

  if (errors.length === 0) {
    console.log('\n✅ ALL COLUMNS AND TABLES VERIFIED OK');
  } else {
    console.log('\n❌ ERRORS FOUND:');
    errors.forEach(e => console.log('  -', e));
    console.log('\nRun: npx prisma migrate deploy && npx prisma generate');
  }

  await prisma.$disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });
