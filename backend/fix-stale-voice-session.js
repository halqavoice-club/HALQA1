/**
 * Fix: Clear stale active voice participant records for a user.
 * Run: node fix-stale-voice-session.js [userId]
 *      node fix-stale-voice-session.js          <- lists all stuck users
 *      node fix-stale-voice-session.js --all    <- clears ALL stale sessions
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const targetUserId = process.argv[2] || null;

  if (targetUserId && targetUserId !== '--all') {
    // Show what's stuck for a specific user
    const stuck = await prisma.voiceParticipant.findMany({
      where: { userId: targetUserId, isActive: true },
      include: { room: { select: { id: true, title: true, status: true } } }
    });

    if (stuck.length === 0) {
      console.log('No active voice sessions found for user ' + targetUserId);
      return;
    }

    console.log('Found ' + stuck.length + ' stale session(s) for user ' + targetUserId + ':');
    stuck.forEach(p => {
      console.log('  Room: ' + p.roomId + ' (' + (p.room?.title ?? 'unknown') + ') status=' + p.room?.status);
    });

    const result = await prisma.voiceParticipant.updateMany({
      where: { userId: targetUserId, isActive: true },
      data: { isActive: false, leftAt: new Date(), seatNumber: null, handRaised: false, handRaisedAt: null }
    });
    console.log('Cleared ' + result.count + ' stale session(s) for user ' + targetUserId);

  } else {
    // List ALL users with stale active sessions
    const stuck = await prisma.voiceParticipant.findMany({
      where: { isActive: true },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        room: { select: { id: true, title: true, status: true } }
      }
    });

    if (stuck.length === 0) {
      console.log('No stale voice sessions found.');
      return;
    }

    console.log('Found ' + stuck.length + ' active participant record(s):\n');
    stuck.forEach(p => {
      console.log('  User: ' + p.user?.firstName + ' ' + p.user?.lastName + ' (' + p.userId + ')');
      console.log('  Room: ' + p.roomId + ' "' + (p.room?.title ?? 'unknown') + '" status=' + p.room?.status);
      console.log('  JoinedAt: ' + p.joinedAt);
      console.log('');
    });

    if (targetUserId === '--all') {
      const result = await prisma.voiceParticipant.updateMany({
        where: { isActive: true },
        data: { isActive: false, leftAt: new Date(), seatNumber: null, handRaised: false, handRaisedAt: null }
      });
      console.log('Cleared ALL ' + result.count + ' stale session(s)');
    } else {
      console.log('To clear a specific user: node fix-stale-voice-session.js <userId>');
      console.log('To clear ALL:             node fix-stale-voice-session.js --all');
    }
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
