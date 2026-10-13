/**
 * Social Controller — Follow + Friend Request system
 */
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { getIo } = require('../sockets');
const { successResponse, errorResponse } = require('../utils/response');

const USER_SELECT = {
  id: true, firstName: true, lastName: true,
  // email is included for the "add friend as student" flow — a School Admin who is
  // already friends with a user needs their email to create the student account.
  // This is intentional: friendship implies a trusted relationship.
  email: true,
  avatarUrl: true, role: true, schoolId: true, bio: true
};

function emitToUser(userId, event, data) {
  const io = getIo();
  if (io) io.to(`user:${userId}`).emit(event, data);
}

// ── FOLLOW ────────────────────────────────────────────────────────────────────

async function followUser(req, res, next) {
  try {
    const followerId = req.user.id;
    const followingId = req.params.userId;
    if (followerId === followingId) return errorResponse(res, 'Cannot follow yourself', 400);

    const target = await prisma.user.findUnique({ where: { id: followingId }, select: USER_SELECT });
    if (!target) return errorResponse(res, 'User not found', 404);

    const existing = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId, followingId } }
    });
    if (existing) return successResponse(res, { following: true }, 'Already following');

    await prisma.follow.create({ data: { id: uuidv4(), followerId, followingId } });

    emitToUser(followingId, 'social:followed', {
      follower: { id: req.user.id, firstName: req.user.firstName, lastName: req.user.lastName, avatarUrl: req.user.avatarUrl }
    });

    return successResponse(res, { following: true }, `Now following ${target.firstName}`);
  } catch (err) { next(err); }
}

async function unfollowUser(req, res, next) {
  try {
    const followerId = req.user.id;
    const followingId = req.params.userId;
    await prisma.follow.deleteMany({ where: { followerId, followingId } });
    emitToUser(followingId, 'social:unfollowed', { followerId });
    return successResponse(res, { following: false }, 'Unfollowed');
  } catch (err) { next(err); }
}

async function getFollowers(req, res, next) {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const rows = await prisma.follow.findMany({
      where: { followingId: userId },
      include: { follower: { select: USER_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    const myFollowing = await prisma.follow.findMany({
      where: { followerId: req.user.id, followingId: { in: rows.map(r => r.followerId) } },
      select: { followingId: true }
    });
    const followingSet = new Set(myFollowing.map(f => f.followingId));

    return successResponse(res, rows.map(r => ({
      ...r.follower, followedAt: r.createdAt, iFollowThem: followingSet.has(r.followerId)
    })));
  } catch (err) { next(err); }
}

async function getFollowing(req, res, next) {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const rows = await prisma.follow.findMany({
      where: { followerId: userId },
      include: { following: { select: USER_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    return successResponse(res, rows.map(r => ({ ...r.following, followedAt: r.createdAt })));
  } catch (err) { next(err); }
}

async function getSocialCounts(req, res, next) {
  try {
    const { userId } = req.params;
    const meId = req.user.id;

    const [followers, following, friends, posts] = await Promise.all([
      prisma.follow.count({ where: { followingId: userId } }),
      prisma.follow.count({ where: { followerId: userId } }),
      prisma.friendRequest.count({
        where: { status: 'ACCEPTED', OR: [{ senderId: userId }, { receiverId: userId }] }
      }),
      // Count published (non-draft, non-deleted) posts for profile stat display
      prisma.post.count({ where: { authorId: userId, deletedAt: null, isDraft: false } })
    ]);

    let isFollowing = false;
    let friendStatus = 'none';

    if (meId !== userId) {
      isFollowing = !!(await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: meId, followingId: userId } }
      }));

      const fr = await prisma.friendRequest.findFirst({
        where: { OR: [{ senderId: meId, receiverId: userId }, { senderId: userId, receiverId: meId }] }
      });
      if (fr) {
        if (fr.status === 'ACCEPTED') friendStatus = 'friends';
        else if (fr.status === 'PENDING')
          friendStatus = fr.senderId === meId ? 'pending_sent' : 'pending_received';
      }
    }

    // Mutual friends count
    let mutualFriends = 0;
    if (meId !== userId) {
      const [myFR, theirFR] = await Promise.all([
        prisma.friendRequest.findMany({
          where: { status: 'ACCEPTED', OR: [{ senderId: meId }, { receiverId: meId }] },
          select: { senderId: true, receiverId: true }
        }),
        prisma.friendRequest.findMany({
          where: { status: 'ACCEPTED', OR: [{ senderId: userId }, { receiverId: userId }] },
          select: { senderId: true, receiverId: true }
        })
      ]);
      const myIds    = new Set(myFR.map(r => r.senderId === meId ? r.receiverId : r.senderId));
      const theirIds = new Set(theirFR.map(r => r.senderId === userId ? r.receiverId : r.senderId));
      mutualFriends  = [...myIds].filter(id => theirIds.has(id) && id !== meId && id !== userId).length;
    }

    return successResponse(res, { followers, following, friends, posts, isFollowing, friendStatus, mutualFriends });
  } catch (err) { next(err); }
}

async function sendFriendRequest(req, res, next) {
  try {
    const senderId = req.user.id;
    const receiverId = req.params.userId;
    if (senderId === receiverId) return errorResponse(res, 'Cannot add yourself', 400);

    const receiver = await prisma.user.findUnique({ where: { id: receiverId }, select: USER_SELECT });
    if (!receiver) return errorResponse(res, 'User not found', 404);

    const existing = await prisma.friendRequest.findFirst({
      where: { OR: [{ senderId, receiverId }, { senderId: receiverId, receiverId: senderId }] }
    });

    if (existing) {
      if (existing.status === 'ACCEPTED') return errorResponse(res, 'Already friends', 400);
      if (existing.status === 'PENDING') {
        // They already sent us a request — auto-accept
        if (existing.senderId === receiverId) {
          req.params.userId = receiverId;
          return acceptFriendRequest(req, res, next);
        }
        return errorResponse(res, 'Request already sent', 400);
      }
      // Was rejected — allow re-send
      await prisma.friendRequest.update({
        where: { id: existing.id },
        data: { status: 'PENDING', senderId, receiverId, updatedAt: new Date() }
      });
    } else {
      await prisma.friendRequest.create({ data: { id: uuidv4(), senderId, receiverId } });
    }

    emitToUser(receiverId, 'social:friend_request', {
      sender: { id: req.user.id, firstName: req.user.firstName, lastName: req.user.lastName, avatarUrl: req.user.avatarUrl }
    });

    return successResponse(res, { status: 'pending' }, 'Friend request sent');
  } catch (err) { next(err); }
}

async function acceptFriendRequest(req, res, next) {
  try {
    const receiverId = req.user.id;
    const senderId = req.params.userId;

    const request = await prisma.friendRequest.findFirst({
      where: { senderId, receiverId, status: 'PENDING' }
    });
    if (!request) return errorResponse(res, 'Request not found', 404);

    await prisma.friendRequest.update({
      where: { id: request.id },
      data: { status: 'ACCEPTED', updatedAt: new Date() }
    });

    // Auto-follow each other
    await Promise.all([
      prisma.follow.upsert({
        where: { followerId_followingId: { followerId: receiverId, followingId: senderId } },
        create: { id: uuidv4(), followerId: receiverId, followingId: senderId },
        update: {}
      }),
      prisma.follow.upsert({
        where: { followerId_followingId: { followerId: senderId, followingId: receiverId } },
        create: { id: uuidv4(), followerId: senderId, followingId: receiverId },
        update: {}
      })
    ]);

    emitToUser(senderId, 'social:request_accepted', {
      friend: { id: req.user.id, firstName: req.user.firstName, lastName: req.user.lastName, avatarUrl: req.user.avatarUrl }
    });

    return successResponse(res, { status: 'accepted' }, 'Friend request accepted');
  } catch (err) { next(err); }
}

async function rejectFriendRequest(req, res, next) {
  try {
    const receiverId = req.user.id;
    const senderId = req.params.userId;

    const request = await prisma.friendRequest.findFirst({
      where: { senderId, receiverId, status: 'PENDING' }
    });
    if (!request) return errorResponse(res, 'Request not found', 404);

    await prisma.friendRequest.update({
      where: { id: request.id },
      data: { status: 'REJECTED', updatedAt: new Date() }
    });

    emitToUser(senderId, 'social:request_rejected', { receiverId });
    return successResponse(res, { status: 'rejected' }, 'Request rejected');
  } catch (err) { next(err); }
}

async function removeFriend(req, res, next) {
  try {
    const meId = req.user.id;
    const otherId = req.params.userId;

    await prisma.friendRequest.deleteMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ senderId: meId, receiverId: otherId }, { senderId: otherId, receiverId: meId }]
      }
    });

    emitToUser(otherId, 'social:friend_removed', { userId: meId });
    return successResponse(res, null, 'Friend removed');
  } catch (err) { next(err); }
}

async function getFriends(req, res, next) {
  try {
    const meId = req.user.id;
    const { limit = 100, search } = req.query;

    const requests = await prisma.friendRequest.findMany({
      where: { status: 'ACCEPTED', OR: [{ senderId: meId }, { receiverId: meId }] },
      include: { sender: { select: USER_SELECT }, receiver: { select: USER_SELECT } },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(parseInt(limit), 200)
    });

    let friends = requests.map(r => r.senderId === meId ? r.receiver : r.sender);

    if (search) {
      const q = search.toLowerCase();
      friends = friends.filter(f =>
        f.firstName.toLowerCase().includes(q) || f.lastName.toLowerCase().includes(q)
      );
    }

    return successResponse(res, friends);
  } catch (err) { next(err); }
}

async function getIncomingRequests(req, res, next) {
  try {
    const requests = await prisma.friendRequest.findMany({
      where: { receiverId: req.user.id, status: 'PENDING' },
      include: { sender: { select: USER_SELECT } },
      orderBy: { createdAt: 'desc' }
    });
    return successResponse(res, requests.map(r => ({
      requestId: r.id, user: r.sender, sentAt: r.createdAt
    })));
  } catch (err) { next(err); }
}

async function getSentRequests(req, res, next) {
  try {
    const requests = await prisma.friendRequest.findMany({
      where: { senderId: req.user.id, status: 'PENDING' },
      include: { receiver: { select: USER_SELECT } },
      orderBy: { createdAt: 'desc' }
    });
    return successResponse(res, requests.map(r => ({
      requestId: r.id, user: r.receiver, sentAt: r.createdAt
    })));
  } catch (err) { next(err); }
}

// GET /social/search?q=  — search users to follow/add
async function searchUsers(req, res, next) {
  try {
    const { q, limit = 20 } = req.query;
    const meId = req.user.id;

    if (!q || q.trim().length < 2) return successResponse(res, []);

    // SOC-P1-01 FIX: Social user search is a PLATFORM-WIDE feature.
    // The previous code applied a school filter that restricted search results
    // to only users from the same school. This violated the Social/Education
    // boundary — a MEMBER with no school couldn't find MEMBER users with a school,
    // and a MEMBER with school A couldn't find MEMBER users at school B.
    // Social discovery must be platform-wide — no schoolId filter here.
    // Education-scoped search (students/teachers/classes) lives at GET /api/v1/search.

    // MF-002 FIX: Exclude bilaterally blocked users from search results.
    // Fetch all block relationships involving the searcher in one query, then
    // pass the excluded IDs into the main findMany to avoid N+1.
    const myBlocks = await prisma.userBlock.findMany({
      where: { OR: [{ blockerId: meId }, { blockedId: meId }] },
      select: { blockerId: true, blockedId: true }
    }).catch(() => []);
    const blockedUserIds = [...new Set(
      myBlocks.flatMap(b => [b.blockerId, b.blockedId]).filter(id => id !== meId)
    )];

    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        id: { not: meId },
        // MF-002: exclude blocked/blocking users
        ...(blockedUserIds.length > 0 && { NOT: { id: { in: blockedUserIds } } }),
        OR: [
          { firstName: { contains: q.trim() } },
          { lastName:  { contains: q.trim() } },
          { email:     { contains: q.trim() } }
        ]
      },
      select: USER_SELECT,
      take: Math.min(parseInt(limit), 50)
    });

    // Enrich with social status
    const userIds = users.map(u => u.id);

    const [myFollows, friendRequests] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: meId, followingId: { in: userIds } },
        select: { followingId: true }
      }),
      prisma.friendRequest.findMany({
        where: {
          OR: [
            { senderId: meId,   receiverId: { in: userIds } },
            { senderId: { in: userIds }, receiverId: meId }
          ]
        }
      })
    ]);

    const followingSet = new Set(myFollows.map(f => f.followingId));
    const frMap = new Map();
    friendRequests.forEach(fr => {
      const otherId = fr.senderId === meId ? fr.receiverId : fr.senderId;
      frMap.set(otherId, fr);
    });

    return successResponse(res, users.map(u => {
      const fr = frMap.get(u.id);
      let friendStatus = 'none';
      if (fr) {
        if (fr.status === 'ACCEPTED') friendStatus = 'friends';
        else if (fr.status === 'PENDING')
          friendStatus = fr.senderId === meId ? 'pending_sent' : 'pending_received';
      }
      return { ...u, isFollowing: followingSet.has(u.id), friendStatus };
    }));
  } catch (err) { next(err); }
}

// DELETE /social/friends/request/:userId — cancel own sent request
async function cancelFriendRequest(req, res, next) {
  try {
    const senderId = req.user.id;
    const receiverId = req.params.userId;

    const request = await prisma.friendRequest.findFirst({
      where: { senderId, receiverId, status: 'PENDING' }
    });
    if (!request) return errorResponse(res, 'Request not found', 404);

    await prisma.friendRequest.delete({ where: { id: request.id } });
    return successResponse(res, null, 'Request cancelled');
  } catch (err) { next(err); }
}

module.exports = {
  followUser, unfollowUser, getFollowers, getFollowing, getSocialCounts,
  sendFriendRequest, acceptFriendRequest, rejectFriendRequest, removeFriend,
  cancelFriendRequest, getFriends, getIncomingRequests, getSentRequests, searchUsers
};
