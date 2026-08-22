const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const prisma = require('../utils/prisma');
const { saveFile, deleteFile } = require('../utils/storage');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');
// REQ-18.4: Invalidate getMe cache on any profile mutation
const { deleteGetMeCache } = require('../controllers/auth.controller');

// ─── Avatar upload — memory storage, saveFile() handles local vs S3 ──────────
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only JPEG, PNG, WebP or GIF images are allowed'));
  },
});

router.use(authenticate);

// ─── POST /users/avatar — upload / replace profile photo ─────────────────────
// Must come BEFORE /:id routes
router.post('/avatar', avatarUpload.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, 'No image uploaded', 400);

    const ext      = path.extname(req.file.originalname).toLowerCase();
    const filename = `avatar-${req.user.id}-${uuidv4()}${ext}`;
    const { url }  = await saveFile(req.file.buffer, filename, req.file.mimetype, 'avatars');

    // Delete old avatar from whichever backend stored it
    const existing = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { avatarUrl: true },
    });
    if (existing?.avatarUrl) {
      await deleteFile(existing.avatarUrl).catch(() => {});
    }

    const user = await prisma.user.update({
      where:  { id: req.user.id },
      data:   { avatarUrl: url },
      select: { id: true, avatarUrl: true, firstName: true, lastName: true },
    });

    // REQ-18.4: Invalidate getMe cache so next call returns the new avatar
    await deleteGetMeCache(req.user.id);

    return successResponse(res, user, 'Avatar updated');
  } catch (error) { next(error); }
});

// ─── PUT /users/profile — update personal info ────────────────────────────────
// Must come BEFORE /:id to avoid Express matching "profile" as an ID

// P1-003 FIX (SEC-HIGH-003): Validate avatarUrl to prevent XSS and SSRF.
// Allowed values:
//   null / undefined / '' — clear the avatar (valid)
//   /uploads/...          — local dev storage URL (relative path)
//   https://...           — HTTPS CDN/R2 URL (production)
// Rejected values:
//   javascript:...        — stored XSS
//   data:...              — stored XSS via data URI
//   file:...              — local filesystem disclosure
//   http://...            — plain HTTP (insecure, not used by storage layer)
//   arbitrary strings     — not a URL
function validateAvatarUrl(avatarUrl) {
  if (avatarUrl === null || avatarUrl === undefined || avatarUrl === '') {
    return true; // explicit clear is allowed
  }
  if (typeof avatarUrl !== 'string') return false;

  // Relative local path from STORAGE_TYPE=local (e.g. /uploads/avatars/uuid.jpg)
  if (avatarUrl.startsWith('/uploads/')) return true;

  // Must be a valid HTTPS URL for production CDN/R2
  try {
    const parsed = new URL(avatarUrl);
    if (parsed.protocol !== 'https:') return false; // only HTTPS
    return true;
  } catch {
    return false; // not a URL at all
  }
}

router.put('/profile', async (req, res, next) => {
  try {
    const { firstName, lastName, phone, dateOfBirth, gender, address, language, timezone, avatarUrl, bio } = req.body;

    // Validate avatarUrl before any database operation
    if (avatarUrl !== undefined && !validateAvatarUrl(avatarUrl)) {
      return errorResponse(res, 'avatarUrl must be a valid HTTPS URL, a /uploads/ path, or null', 400);
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        firstName, lastName, phone,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
        gender, address, language, timezone,
        ...(bio !== undefined && { bio: bio?.trim() || null }),
        ...(avatarUrl !== undefined && { avatarUrl: avatarUrl || null })
      },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true, bio: true, username: true }
    });
    // REQ-18.4: Invalidate getMe cache so next call returns updated profile
    await deleteGetMeCache(req.user.id);
    return successResponse(res, user, 'Profile updated');
  } catch (error) { next(error); }
});

// ─── PUT /users/username — set or update unique @handle ──────────────────────
// Additive endpoint — sets the user's unique username for @mention targeting.
// Username rules: 3-30 chars, alphanumeric + underscore only, case-insensitive.
// Must come BEFORE /:id routes.
router.put('/username', async (req, res, next) => {
  try {
    const { username } = req.body;
    if (!username) return errorResponse(res, 'username is required', 400);

    // Validate format: 3-30 chars, letters/numbers/underscore only
    const cleaned = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(cleaned)) {
      return errorResponse(res, 'Username must be 3-30 characters: letters, numbers, and underscores only', 400);
    }

    // Reserved names — prevent impersonation of system accounts
    const RESERVED = ['admin', 'halqa', 'support', 'system', 'moderator', 'root', 'null', 'undefined'];
    if (RESERVED.includes(cleaned)) {
      return errorResponse(res, 'This username is reserved', 400);
    }

    const user = await prisma.user.update({
      where:  { id: req.user.id },
      data:   { username: cleaned },
      select: { id: true, username: true, firstName: true, lastName: true }
    });

    // Invalidate auth cache so the new username is reflected immediately
    const { invalidateUserCache } = require('../middleware/auth.middleware');
    await invalidateUserCache(req.user.id);

    return successResponse(res, user, `Username @${cleaned} set successfully`);
  } catch (error) {
    // P2002 = unique constraint violation — username taken
    if (error.code === 'P2002') {
      return errorResponse(res, 'This username is already taken', 409);
    }
    next(error);
  }
});

// ─── GET /users — list all users (admin only, school-scoped) ────────────────
// Uses school membership context (req.schoolId) when available so that new
// MEMBER users who are school admins can list their school's users.
// Falls back to req.user.schoolId for legacy users.
router.get('/',
  require('../middleware/educationAuth').eduAdmin[0], // requireSchoolMember
  require('../middleware/educationAuth').eduAdmin[1], // requireSchoolRole(SCHOOL_ADMIN, SUPER_ADMIN)
  async (req, res, next) => {
  try {
    const { page = 1, limit = 20, role, search, status } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);
    // Use req.schoolId (set by requireSchoolMember) — school-scoped and validated
    const schoolId = req.schoolId || req.user.schoolId;
    const isGlobalSuperAdmin = req.schoolMembership?.role === 'SUPER_ADMIN' || req.user.role === 'SUPER_ADMIN';

    const where = {
      deletedAt: null,
      // Scope to school unless this is a global super admin with no specific school
      ...(schoolId && !isGlobalSuperAdmin && { schoolId }),
      ...(schoolId &&  isGlobalSuperAdmin && req.schoolId && { schoolId })
    };

    if (role)   where.role   = role;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName:  { contains: search } },
        { email:     { contains: search } }
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, email: true, firstName: true, lastName: true,
          role: true, status: true, avatarUrl: true, lastLoginAt: true,
          createdAt: true, schoolId: true
        },
        skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    return paginatedResponse(res, users, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) { next(error); }
});

// ─── GET /users/:id ───────────────────────────────────────────────────────────
// SEC-CRIT-002 FIX: Restrict PII in cross-user profile lookups.
//
// BEFORE: Any authenticated user could fetch full PII of any other user,
//         including email, phone, dateOfBirth, gender, address, emailVerified.
//
// AFTER:
//   - Own profile request (id === req.user.id): returns full profile
//   - SUPER_ADMIN or same-school SCHOOL_ADMIN: returns full profile
//   - Any other authenticated user: returns public profile only
//     (no email, phone, dateOfBirth, gender, address, emailVerified, lastLoginAt)
//
// Public profile = what any user should be able to see about another user
// on their profile page: name, avatar, username, bio, role (for display), joinDate.
const PUBLIC_PROFILE_SELECT = {
  id: true, firstName: true, lastName: true,
  avatarUrl: true, bio: true, username: true,
  role: true, createdAt: true, schoolId: true
};

// Full profile — own profile or admin view
const FULL_PROFILE_SELECT = {
  id: true, email: true, firstName: true, lastName: true,
  role: true, status: true, avatarUrl: true, phone: true,
  bio: true, username: true, dateOfBirth: true, gender: true, address: true,
  lastLoginAt: true, createdAt: true, schoolId: true, emailVerified: true
};

router.get('/:id', async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const isOwnProfile = targetId === req.user.id;
    const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
    // SCHOOL_ADMIN can see full profiles of users in their school
    const isSchoolAdmin = req.user.role === 'SCHOOL_ADMIN';

    // Choose select fields based on requester relationship to target
    let selectFields;
    if (isOwnProfile || isSuperAdmin) {
      selectFields = FULL_PROFILE_SELECT;
    } else if (isSchoolAdmin) {
      // School admin sees full profile only if target is in same school
      // We check schoolId after lookup — use full select, strip if needed
      selectFields = FULL_PROFILE_SELECT;
    } else {
      selectFields = PUBLIC_PROFILE_SELECT;
    }

    const user = await prisma.user.findUnique({
      where: { id: targetId },
      select: selectFields
    });
    if (!user) return errorResponse(res, 'User not found', 404);

    // For SCHOOL_ADMIN: only return full profile if target is in same school
    if (isSchoolAdmin && !isOwnProfile && user.schoolId !== req.user.schoolId) {
      // Different school — return public profile only (re-select public fields)
      const publicUser = await prisma.user.findUnique({
        where: { id: targetId },
        select: PUBLIC_PROFILE_SELECT
      });
      return successResponse(res, publicUser);
    }

    return successResponse(res, user);
  } catch (error) { next(error); }
});

// ─── PUT /users/:id/status ────────────────────────────────────────────────────
// P1-001 FIX (SEC-HIGH-001): Validate status against the exact UserStatus enum.
// Previously any string could be written to the status column.
// Valid values mirror the Prisma UserStatus enum: ACTIVE | INACTIVE | SUSPENDED | PENDING | BANNED
// PENDING is included because admins may need to reset a user to pending state.
// Invalid values are rejected with HTTP 400 before any DB operation.
const VALID_USER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING', 'BANNED'];

router.put('/:id/status',
  require('../middleware/educationAuth').eduAdmin[0],
  require('../middleware/educationAuth').eduAdmin[1],
  async (req, res, next) => {
    try {
      const { status } = req.body;

      // Validate status before touching the database
      if (!status || !VALID_USER_STATUSES.includes(status)) {
        return errorResponse(
          res,
          `Invalid status. Must be one of: ${VALID_USER_STATUSES.join(', ')}`,
          400
        );
      }

      const user = await prisma.user.update({
        where: { id: req.params.id },
        data:  { status },
        select: { id: true, status: true }
      });

      // Invalidate auth cache immediately so status change takes effect
      // within the current 30s cache window rather than waiting for TTL expiry.
      const { invalidateUserCache } = require('../middleware/auth.middleware');
      await invalidateUserCache(req.params.id);

      return successResponse(res, user, 'User status updated');
    } catch (error) { next(error); }
  }
);

// ─── PUT /users/fcm-token — Register or clear device push token ──────────────
// Called by the mobile app after:
//   - User grants notification permission (register token)
//   - User logs out (clear token with null)
//   - FCM rotates the token (update with new token)
// Must come BEFORE /:id routes.
router.put('/fcm-token', async (req, res, next) => {
  try {
    const { token } = req.body;  // null to clear, string to register

    if (token !== null && token !== undefined && typeof token !== 'string') {
      return errorResponse(res, 'token must be a string or null', 400);
    }
    if (token && token.length > 512) {
      return errorResponse(res, 'token too long', 400);
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data:  { fcmToken: token || null }
    });

    // Invalidate auth cache so the updated fcmToken is picked up by notification worker
    const { invalidateUserCache } = require('../middleware/auth.middleware');
    await invalidateUserCache(req.user.id);

    return successResponse(res, null, token ? 'Push token registered' : 'Push token cleared');
  } catch (error) { next(error); }
});

// ─── DELETE /users/me — Delete own account (GDPR / App Store requirement) ─────
// Soft-deletes the account and anonymizes all PII so the user cannot be
// identified. Hard purge of content (posts, comments, media) is handled by
// a scheduled cleanup job — this keeps immediate response time fast.
//
// What this does:
//   1. Requires password confirmation to prevent accidental/malicious deletion
//   2. Marks user.deletedAt = now (soft delete — authenticate() will reject future logins)
//   3. Anonymizes PII: email, firstName, lastName, phone, avatarUrl, bio, address
//   4. Revokes all refresh tokens (all sessions immediately invalid)
//   5. Invalidates auth cache
//   6. Emits socket disconnect to any active sessions
//   7. Soft-deletes own posts, stories (they vanish from feeds)
//   8. Removes own follows and community memberships (cleans up counts)
//
// What is preserved (for data integrity of other users):
//   - DM messages (other user's conversation history)
//   - Voice room participant records (historical stats)
//   - Gift transactions (financial records)
//   - AuditLog entries
//   - Notifications sent to others
//
// Must come BEFORE /:id to avoid Express matching "me" as a user ID.
router.delete('/me', async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return errorResponse(res, 'Password confirmation required to delete account', 400);

    // 1. Verify password
    const user = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { id: true, passwordHash: true, email: true, schoolId: true, role: true }
    });
    if (!user) return errorResponse(res, 'User not found', 404);

    const bcrypt   = require('bcryptjs');

    // SEC-MED-004 FIX: OAuth users have no passwordHash — bcrypt.compare(password, null)
    // throws a TypeError that causes a 500 crash. Return a clear 400 instead.
    if (!user.passwordHash) {
      return errorResponse(res, 'This account uses Google Sign-In. To delete your account, please contact support.', 400);
    }

    const isValid  = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) return errorResponse(res, 'Incorrect password', 400);

    // 2. Prevent deletion of school admins with active schools (protect data integrity)
    // Check both legacy global role and new school membership role
    const hasAdminMembership = await prisma.schoolMembership.findFirst({
      where: { userId: user.id, role: { in: ['SUPER_ADMIN', 'SCHOOL_ADMIN'] }, status: 'ACTIVE' }
    });
    if (user.role === 'SCHOOL_ADMIN' || user.role === 'SUPER_ADMIN' || hasAdminMembership) {
      const school = await prisma.school.findFirst({
        where: { id: user.schoolId ?? '', isActive: true, deletedAt: null }
      });
      if (school) {
        return errorResponse(res,
          'School admins cannot delete their account while the school is active. Transfer admin rights first.',
          400
        );
      }
    }

    // P4-001 FIX: Block deletion if the user has a non-zero wallet balance.
    // Coins and diamonds represent real monetary value (coins are purchased via
    // Stripe; diamonds are earned by receiving gifts). Silently discarding them
    // on account deletion would be a financial loss for the user and a potential
    // consumer-protection issue. We block deletion and direct the user to
    // withdraw/spend their balance first.
    const wallet = await prisma.wallet.findUnique({
      where:  { userId: user.id },
      select: { coins: true, diamonds: true },
    });
    if (wallet && (wallet.coins > 0 || wallet.diamonds > 0)) {
      const parts = [];
      if (wallet.coins    > 0) parts.push(`${wallet.coins} coin${wallet.coins    !== 1 ? 's' : ''}`);
      if (wallet.diamonds > 0) parts.push(`${wallet.diamonds} diamond${wallet.diamonds !== 1 ? 's' : ''}`);
      return errorResponse(res,
        `Your wallet has a balance (${parts.join(' and ')}). Please spend or withdraw your balance before deleting your account.`,
        400
      );
    }

    const deletedAt      = new Date();
    const anonymousEmail = `deleted_${user.id}@halqa.deleted`;
    const anonymousName  = 'Deleted User';

    // 3. Atomically anonymize PII + soft-delete + revoke sessions
    await prisma.$transaction([
      // Anonymize and soft-delete the user
      prisma.user.update({
        where: { id: user.id },
        data: {
          deletedAt,
          status:       'INACTIVE',
          email:        anonymousEmail,
          passwordHash: 'DELETED',          // prevent any future login
          firstName:    anonymousName,
          lastName:     '',
          phone:        null,
          avatarUrl:    null,
          bio:          null,
          address:      null,
          dateOfBirth:  null,
          username:     null,               // free up the username for others
        }
      }),
      // Revoke all refresh tokens — all existing sessions immediately invalid
      prisma.refreshToken.updateMany({
        where: { userId: user.id },
        data:  { isRevoked: true }
      }),
      // Soft-delete own posts (removes from all feeds)
      prisma.post.updateMany({
        where: { authorId: user.id, deletedAt: null },
        data:  { deletedAt }
      }),
      // Soft-delete own stories
      prisma.story.updateMany({
        where: { authorId: user.id, deletedAt: null },
        data:  { deletedAt }
      }),
    ]);

    // 4. Clean up social graph (non-critical — use allSettled so one failure doesn't abort)
    await Promise.allSettled([
      // Remove follows (both directions) — cleans up follower/following counts
      prisma.follow.deleteMany({
        where: { OR: [{ followerId: user.id }, { followingId: user.id }] }
      }),
      // Leave all communities
      prisma.communityMember.deleteMany({ where: { userId: user.id } }),
      // Cancel pending friend requests
      prisma.friendRequest.deleteMany({
        where: {
          status: 'PENDING',
          OR: [{ senderId: user.id }, { receiverId: user.id }]
        }
      }),
      // Leave active voice rooms
      prisma.voiceParticipant.updateMany({
        where: { userId: user.id, isActive: true },
        data:  { isActive: false, leftAt: deletedAt }
      }),
      // Leave active live classes
      prisma.liveClassParticipant.updateMany({
        where: { userId: user.id, isActive: true },
        data:  { isActive: false, leftAt: deletedAt }
      }),
    ]);

    // 5. Invalidate auth cache so any cached user record is immediately cleared
    const { invalidateUserCache } = require('../middleware/auth.middleware');
    await invalidateUserCache(user.id);

    // 6. Disconnect all active socket sessions for this user
    const { getIo } = require('../sockets');
    const io = getIo();
    if (io) {
      // Notify the user's personal room to trigger client-side logout
      io.to(`user:${user.id}`).emit('account:deleted', { userId: user.id });
      // Force disconnect all sockets in the user's personal room
      const sockets = await io.in(`user:${user.id}`).fetchSockets();
      sockets.forEach(s => s.disconnect(true));
    }

    // 7. Clear the refresh token cookie
    res.clearCookie('refreshToken');

    return successResponse(res, null, 'Account deleted successfully. We\'re sorry to see you go.');
  } catch (error) { next(error); }
});

module.exports = router;
