/**
 * GraphQL Resolvers
 * 
 * Implements resolver functions for GraphQL schema.
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');
const { assertSafeUserRole, sanitizeUserData } = require('../utils/roleGuard');

const resolvers = {
  Query: {
    // User queries
    me: async (parent, args, context) => {
      if (!context.user) {
        throw new Error('Not authenticated');
      }
      return prisma.user.findUnique({
        where: { id: context.user.id },
        include: { school: true }
      });
    },

    user: async (parent, { id }, context) => {
      // Require auth — user profile data should not be publicly queryable
      if (!context.user) throw new Error('Not authenticated');
      return prisma.user.findUnique({
        where: { id },
        include: { school: true }
      });
    },

    users: async (parent, { page = 1, pageSize = 20, schoolId }, context) => {
      // Admin-only — listing all users is sensitive
      if (!context.user) throw new Error('Not authenticated');
      if (!['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(context.user.role)) {
        throw new Error('Unauthorized');
      }

      // P1-004 FIX: SCHOOL_ADMIN must be scoped to their own school.
      // Without this, a SCHOOL_ADMIN could list all platform users by omitting schoolId.
      // SUPER_ADMIN uses the dedicated admin-stats REST endpoint for platform-wide user listing.
      const where = {};
      if (context.user.role === 'SCHOOL_ADMIN') {
        where.schoolId = context.user.schoolId;
      } else if (schoolId) {
        where.schoolId = schoolId;
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          include: { school: true },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.user.count({ where })
      ]);

      return {
        users,
        total,
        page,
        pageSize
      };
    },

    // School queries
    school: async (parent, { id }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      return prisma.school.findUnique({
        where: { id },
        include: { users: true }
      });
    },

    schools: async (parent, { page = 1, pageSize = 20 }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      if (context.user.role !== 'SUPER_ADMIN') throw new Error('Unauthorized');
      const [schools, total] = await Promise.all([
        prisma.school.findMany({
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.school.count()
      ]);

      return {
        users: schools,
        total,
        page,
        pageSize
      };
    },

    // Post queries — require auth (posts may contain school-scoped content)
    post: async (parent, { id }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      return prisma.post.findUnique({
        where: { id },
        include: { author: true, school: true }
      });
    },

    posts: async (parent, { page = 1, pageSize = 20, schoolId, authorId }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      const where = {};
      if (schoolId) where.schoolId = schoolId;
      if (authorId) where.authorId = authorId;

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where,
          include: { author: true, school: true },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.post.count({ where })
      ]);

      return {
        posts,
        total,
        page,
        pageSize
      };
    },

    searchPosts: async (parent, { query, page = 1, pageSize = 20 }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      const where = {
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { content: { contains: query, mode: 'insensitive' } }
        ]
      };

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where,
          include: { author: true, school: true },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.post.count({ where })
      ]);

      return {
        posts,
        total,
        page,
        pageSize
      };
    },

    // Session queries
    mySessions: async (parent, args, context) => {
      if (!context.user) {
        throw new Error('Not authenticated');
      }
      return prisma.session.findMany({
        where: { userId: context.user.id, isActive: true },
        orderBy: { lastAccessedAt: 'desc' }
      });
    },

    session: async (parent, { id }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      // Users can only see their own sessions; admins can see any
      const s = await prisma.session.findUnique({ where: { id }, include: { user: true } });
      if (!s) return null;
      if (s.userId !== context.user.id && !['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(context.user.role)) {
        throw new Error('Unauthorized');
      }
      return s;
    },

    // Health check — public
    health: () => 'OK'
  },

  Mutation: {
    // User mutations
    createUser: async (parent, { input }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      if (!['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(context.user.role)) throw new Error('Unauthorized');
      // P0-001 FIX: Validate role field against roleGuard before passing to Prisma.
      // Without this, a SCHOOL_ADMIN could create a user with role: 'SUPER_ADMIN',
      // bypassing the internal provisioning endpoint (internal.routes.js).
      if (input.role) {
        assertSafeUserRole(input.role, 'GraphQL createUser');
      }
      return prisma.user.create({
        data: input,
        include: { school: true }
      });
    },

    updateUser: async (parent, { id, input }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      // Users can update themselves; admins can update anyone in their school
      const isSelf  = context.user.id === id;
      const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(context.user.role);
      if (!isSelf && !isAdmin) throw new Error('Unauthorized');

      // P0-002 FIX: Validate role field against roleGuard before passing to Prisma.
      // Without this, a SCHOOL_ADMIN could update their own role to 'SUPER_ADMIN',
      // escalating to platform admin via GraphQL — bypassing internal.routes.js.
      if (input.role) {
        assertSafeUserRole(input.role, 'GraphQL updateUser');
      }

      // P1-004 FIX: SCHOOL_ADMIN must be scoped to their own school.
      // Without this, a SCHOOL_ADMIN could update users in any school.
      if (isAdmin && !isSelf && context.user.role === 'SCHOOL_ADMIN') {
        const target = await prisma.user.findUnique({
          where: { id },
          select: { schoolId: true }
        });
        if (!target) throw new Error('User not found');
        if (target.schoolId !== context.user.schoolId) {
          throw new Error('Unauthorized — can only update users in your school');
        }
      }

      return prisma.user.update({
        where: { id },
        data: input,
        include: { school: true }
      });
    },

    deleteUser: async (parent, { id }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      if (!['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(context.user.role)) throw new Error('Unauthorized');

      // P1-002 FIX: Soft-delete instead of hard-delete.
      // The REST API only soft-deletes (sets deletedAt + anonymizes PII).
      // Hard-deleting via GraphQL would destroy referential integrity and
      // bypass the audit trail. Match the REST pattern.
      await prisma.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          status: 'INACTIVE',
        },
      });
      return true;
    },

    // School mutations
    createSchool: async (parent, { input }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      if (context.user.role !== 'SUPER_ADMIN') throw new Error('Unauthorized');
      return prisma.school.create({
        data: input,
        include: { users: true }
      });
    },

    updateSchool: async (parent, { id, input }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      if (!['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(context.user.role)) throw new Error('Unauthorized');

      // P1-001 FIX: SUPER_ADMIN must have an explicit SchoolMembership to edit a school,
      // matching the REST API (PUT /schools/:id in school.routes.js).
      // Without this, a SUPER_ADMIN could edit any school's settings without membership.
      if (context.user.role === 'SUPER_ADMIN') {
        const membership = await prisma.schoolMembership.findUnique({
          where: { userId_schoolId: { userId: context.user.id, schoolId: id } },
          select: { role: true, status: true },
        }).catch(() => null);
        if (!membership || membership.status !== 'ACTIVE' ||
            !['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(membership.role)) {
          throw new Error('Platform admins must have an active school membership to edit school settings');
        }
      }

      // SCHOOL_ADMIN can only update their own school
      if (context.user.role === 'SCHOOL_ADMIN' && context.user.schoolId !== id) {
        throw new Error('You can only update your own school');
      }

      return prisma.school.update({
        where: { id },
        data: input,
        include: { users: true }
      });
    },

    deleteSchool: async (parent, { id }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      if (context.user.role !== 'SUPER_ADMIN') throw new Error('Unauthorized');
      await prisma.school.delete({ where: { id } });
      return true;
    },

    // Post mutations
    createPost: async (parent, { input }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      return prisma.post.create({
        data: {
          ...input,
          authorId: context.user.id
        },
        include: { author: true, school: true }
      });
    },

    updatePost: async (parent, { id, input }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      const post = await prisma.post.findUnique({ where: { id }, select: { authorId: true } });
      if (!post) throw new Error('Post not found');

      // P1-003 FIX: SUPER_ADMIN cannot edit another user's post content.
      // The REST API blocks this via blockSuperAdminFromSocialEdit() middleware.
      // SUPER_ADMIN retains deletion authority for platform moderation only.
      if (post.authorId !== context.user.id && context.user.role === 'SUPER_ADMIN') {
        throw new Error('Platform administrators cannot edit another user\'s social content. Use the admin panel to delete or report content.');
      }

      if (post.authorId !== context.user.id && !['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(context.user.role)) {
        throw new Error('Unauthorized');
      }
      return prisma.post.update({
        where: { id },
        data: input,
        include: { author: true, school: true }
      });
    },

    deletePost: async (parent, { id }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      const post = await prisma.post.findUnique({ where: { id }, select: { authorId: true } });
      if (!post) throw new Error('Post not found');
      if (post.authorId !== context.user.id && !['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(context.user.role)) {
        throw new Error('Unauthorized');
      }
      await prisma.post.delete({ where: { id } });
      return true;
    },

    // Session mutations
    terminateSession: async (parent, { id }, context) => {
      if (!context.user) {
        throw new Error('Not authenticated');
      }
      await prisma.session.update({
        where: { id },
        data: {
          isActive: false,
          terminatedAt: new Date(),
          terminationReason: 'USER_TERMINATED'
        }
      });
      return true;
    },

    terminateAllSessions: async (parent, args, context) => {
      if (!context.user) {
        throw new Error('Not authenticated');
      }
      await prisma.session.updateMany({
        where: { userId: context.user.id, isActive: true },
        data: {
          isActive: false,
          terminatedAt: new Date(),
          terminationReason: 'USER_TERMINATED_ALL'
        }
      });
      return true;
    }
  },

  Subscription: {
    // All subscriptions require auth — unauthenticated users have user=null
    // Resolvers throw if user is absent.
    userCreated: {
      subscribe: (parent, args, { pubsub, user }) => {
        if (!user) throw new Error('Not authenticated');
        return pubsub.asyncIterator(['USER_CREATED']);
      }
    },
    userUpdated: {
      subscribe: (parent, args, { pubsub, user }) => {
        if (!user) throw new Error('Not authenticated');
        return pubsub.asyncIterator(['USER_UPDATED']);
      }
    },
    userDeleted: {
      subscribe: (parent, args, { pubsub, user }) => {
        if (!user) throw new Error('Not authenticated');
        return pubsub.asyncIterator(['USER_DELETED']);
      }
    },
    postCreated: {
      subscribe: (parent, args, { pubsub, user }) => {
        if (!user) throw new Error('Not authenticated');
        return pubsub.asyncIterator(['POST_CREATED']);
      }
    },
    postUpdated: {
      subscribe: (parent, args, { pubsub, user }) => {
        if (!user) throw new Error('Not authenticated');
        return pubsub.asyncIterator(['POST_UPDATED']);
      }
    },
    postDeleted: {
      subscribe: (parent, args, { pubsub, user }) => {
        if (!user) throw new Error('Not authenticated');
        return pubsub.asyncIterator(['POST_DELETED']);
      }
    }
  }
};

module.exports = resolvers;
