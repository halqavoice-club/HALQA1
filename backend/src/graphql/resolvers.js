/**
 * GraphQL Resolvers
 * 
 * Implements resolver functions for GraphQL schema.
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

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
      const where = schoolId ? { schoolId } : {};
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
      return prisma.user.update({
        where: { id },
        data: input,
        include: { school: true }
      });
    },

    deleteUser: async (parent, { id }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      if (!['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(context.user.role)) throw new Error('Unauthorized');
      await prisma.user.delete({ where: { id } });
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
