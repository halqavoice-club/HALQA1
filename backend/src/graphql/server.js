/**
 * GraphQL Server Setup
 *
 * Sets up Apollo Server with Express integration.
 * Includes authentication, error handling, and subscriptions.
 *
 * BE-014 Security hardening:
 *   - Introspection disabled in production (already was, confirmed)
 *   - Landing page disabled in production (ApolloServerPluginLandingPageDisabled)
 *   - Authentication enforced via context — req.user populated for authenticated queries
 *   - Query depth limit: 7 levels (prevents deeply-nested DoS queries)
 *   - CORS restricted to CLIENT_URL (not open '*' as before)
 *
 * Phase 7B: Migrated from apollo-server-express@3 to @apollo/server@4.
 *   - applyMiddleware() replaced with expressMiddleware()
 *   - context option moved to expressMiddleware second argument
 *   - formatError signature updated: (formattedError, error)
 *   - playground replaced with ApolloServerPluginLandingPageDisabled in production
 *   - ApolloServerPluginDrainHttpServer import path updated
 *   - setupGraphQL made async to await server.start()
 */

const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@as-integrations/express4');
const { ApolloServerPluginDrainHttpServer } = require('@apollo/server/plugin/drainHttpServer');
const { ApolloServerPluginLandingPageDisabled } = require('@apollo/server/plugin/disabled');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { WebSocketServer } = require('ws');
const { useServer } = require('graphql-ws/use/ws');
const cors = require('cors');
const typeDefs = require('./schema');
const resolvers = require('./resolvers');
const logger = require('../utils/logger');
const { PubSub } = require('graphql-subscriptions');
const { verifyAccessToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');

const IS_PROD = process.env.NODE_ENV === 'production';

// Create PubSub instance for subscriptions
const pubsub = new PubSub();

// ─── Max query depth (BE-014) ─────────────────────────────────────────────────
// Deeply nested GraphQL queries can cause exponential DB load.
// Depth 7 covers all legitimate UI queries while blocking abuse.
const MAX_QUERY_DEPTH = 7;

function checkDepth(selectionSet, depth = 0) {
  if (!selectionSet || !selectionSet.selections) return depth;
  if (depth > MAX_QUERY_DEPTH) return depth;
  return Math.max(...selectionSet.selections.map(sel =>
    checkDepth(sel.selectionSet, depth + 1)
  ));
}

/**
 * Create GraphQL context — populates req.user for authenticated requests.
 * Called per-request by expressMiddleware.
 */
async function createContext({ req }) {
  // For HTTP requests — resolve user from Bearer token
  const authHeader = req.headers.authorization || req.headers['x-auth-token'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  let user = null;
  if (token) {
    try {
      const decoded = verifyAccessToken(token);
      user = await prisma.user.findUnique({
        where:  { id: decoded.userId },
        select: { id: true, email: true, role: true, status: true, schoolId: true,
                  firstName: true, lastName: true, avatarUrl: true }
      });
      // Reject suspended/inactive users at context level
      if (user && (user.status === 'SUSPENDED' || user.status === 'INACTIVE')) {
        user = null;
      }
    } catch (error) {
      // Invalid/expired token — user remains null (unauthenticated)
      logger.debug('[graphql] Token verification failed:', error.message);
    }
  }

  return { user, pubsub, req };
}

/**
 * Create Apollo Server (v4)
 */
function createServer(httpServer) {
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers
  });

  // Landing page plugins: disabled in production, default (Apollo Sandbox) in development
  const landingPagePlugin = IS_PROD
    ? ApolloServerPluginLandingPageDisabled()
    : undefined;

  const plugins = [
    ApolloServerPluginDrainHttpServer({ httpServer }),
    {
      // BE-014: Query depth guard plugin — API unchanged between v3 and v4
      async requestDidStart() {
        return {
          async didResolveOperation({ document }) {
            const depth = Math.max(...document.definitions.map(def =>
              checkDepth(def.selectionSet)
            ));
            if (depth > MAX_QUERY_DEPTH) {
              throw new Error(
                `Query depth ${depth} exceeds maximum allowed depth of ${MAX_QUERY_DEPTH}`
              );
            }
          }
        };
      }
    },
    {
      async serverWillStart() {
        return {
          async drainServer() {
            if (subscriptionServer) {
              subscriptionServer.dispose();
            }
          }
        };
      }
    }
  ];

  if (landingPagePlugin) {
    plugins.push(landingPagePlugin);
  }

  const server = new ApolloServer({
    schema,
    plugins,
    // BE-014: Introspection disabled in production
    introspection: !IS_PROD,
    // Phase 7B: formatError signature changed in v4 — first arg is the formatted error,
    // second arg is the original error. Behavior is semantically identical to v3.
    formatError: (formattedError, error) => {
      // In production: never leak internal error details
      if (IS_PROD) {
        logger.error('[graphql] Error:', error?.message ?? formattedError.message, formattedError.path);
        return {
          message: formattedError.extensions?.code === 'UNAUTHENTICATED'
            ? formattedError.message
            : 'An error occurred',
          code: formattedError.extensions?.code || 'INTERNAL_SERVER_ERROR',
          path: formattedError.path
        };
      }
      logger.error('[graphql] Error:', error ?? formattedError);
      return {
        message: formattedError.message,
        code: formattedError.extensions?.code || 'INTERNAL_SERVER_ERROR',
        path: formattedError.path
      };
    },
  });

  return { server, schema };
}

/**
 * Setup WebSocket server for subscriptions.
 * Uses graphql-ws + ws — independent of Apollo Express middleware (unchanged from v3).
 */
let subscriptionServer = null;

function setupSubscriptionServer(httpServer, schema) {
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql'
  });

  subscriptionServer = useServer(
    {
      schema,
      context: async (ctx) => {
        // BE-014 (WebSocket): Verify JWT for GraphQL subscriptions.
        const rawToken = ctx.connectionParams?.authorization || ctx.connectionParams?.token;
        const token = rawToken?.startsWith('Bearer ') ? rawToken.slice(7) : rawToken;

        let user = null;
        if (token) {
          try {
            const decoded = verifyAccessToken(token);
            user = await prisma.user.findUnique({
              where:  { id: decoded.userId },
              select: { id: true, email: true, role: true, status: true, schoolId: true,
                        firstName: true, lastName: true, avatarUrl: true }
            });
            // Reject suspended/inactive users
            if (user && (user.status === 'SUSPENDED' || user.status === 'INACTIVE')) {
              user = null;
            }
          } catch (error) {
            logger.debug('[graphql:ws] Token verification failed:', error.message);
          }
        }

        return { user, pubsub };
      },
      onConnect: () => {
        logger.info('[graphql] Subscription client connected');
      },
      onDisconnect: () => {
        logger.info('[graphql] Subscription client disconnected');
      }
    },
    wsServer
  );

  return wsServer;
}

/**
 * Setup GraphQL middleware (async — v4 requires await server.start())
 */
async function setupGraphQL(app, httpServer) {
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers
  });

  // Setup WebSocket subscriptions (independent of Apollo Express middleware)
  setupSubscriptionServer(httpServer, schema);

  // Create Apollo Server v4
  const { server } = createServer(httpServer);

  // v4 requires start() before attaching expressMiddleware
  await server.start();

  // BE-014: CORS restricted to configured CLIENT_URL only (not '*')
  const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
    .split(',').map(o => o.trim());

  // app.use(express.json()) is already applied globally in app.js (line ~884)
  // before setupGraphQL is called (line ~1036) — no local parser needed.
  app.use(
    '/graphql',
    cors({
      origin: allowedOrigins,
      credentials: true
    }),
    expressMiddleware(server, {
      context: createContext
    })
  );

  logger.info(`[graphql] GraphQL server ready at /graphql (introspection: ${!IS_PROD})`);

  return server;
}

/**
 * Publish events for subscriptions
 */
function publishEvent(eventType, payload) {
  pubsub.publish(eventType, { [eventType]: payload });
  logger.debug(`[graphql] Published event: ${eventType}`);
}

/**
 * Helper functions for publishing common events
 */
const publishUserCreated = (user) => publishEvent('USER_CREATED', user);
const publishUserUpdated = (user) => publishEvent('USER_UPDATED', user);
const publishUserDeleted = (userId) => publishEvent('USER_DELETED', userId);
const publishPostCreated = (post) => publishEvent('POST_CREATED', post);
const publishPostUpdated = (post) => publishEvent('POST_UPDATED', post);
const publishPostDeleted = (postId) => publishEvent('POST_DELETED', postId);

module.exports = {
  setupGraphQL,
  createContext,
  publishEvent,
  publishUserCreated,
  publishUserUpdated,
  publishUserDeleted,
  publishPostCreated,
  publishPostUpdated,
  publishPostDeleted,
  pubsub
};
