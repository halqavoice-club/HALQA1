/**
 * GraphQL Server Setup
 *
 * Sets up Apollo Server with Express integration.
 * Includes authentication, error handling, and subscriptions.
 *
 * BE-014 Security hardening:
 *   - Introspection disabled in production (already was, confirmed)
 *   - Playground disabled in production (already was, confirmed)
 *   - Authentication enforced via context — req.user populated for authenticated queries
 *   - Query depth limit: 7 levels (prevents deeply-nested DoS queries)
 *   - CORS restricted to CLIENT_URL (not open '*' as before)
 */

const { ApolloServer } = require('apollo-server-express');
const { ApolloServerPluginDrainHttpServer } = require('apollo-server-core');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { WebSocketServer } = require('ws');
const { useServer } = require('graphql-ws/use/ws');
const express = require('express');
const http = require('http');
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
 * Create GraphQL context — populates req.user for authenticated requests
 */
async function createContext({ req, connection }) {
  // For subscriptions (WebSocket)
  if (connection) {
    return connection.context;
  }

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
 * Create Apollo Server
 */
function createServer(httpServer) {
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers
  });

  const server = new ApolloServer({
    schema,
    context: createContext,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        // BE-014: Query depth guard plugin
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
    ],
    formatError: (error) => {
      // In production: never leak internal error details
      if (IS_PROD) {
        logger.error('[graphql] Error:', error.message, error.path);
        return {
          message: error.extensions?.code === 'UNAUTHENTICATED'
            ? error.message
            : 'An error occurred',
          code: error.extensions?.code || 'INTERNAL_SERVER_ERROR',
          path: error.path
        };
      }
      logger.error('[graphql] Error:', error);
      return {
        message: error.message,
        code: error.extensions?.code || 'INTERNAL_SERVER_ERROR',
        path: error.path
      };
    },
    // BE-014: Introspection and playground disabled in production
    introspection: !IS_PROD,
    playground:    !IS_PROD,
  });

  return server;
}

/**
 * Setup WebSocket server for subscriptions
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
        // HTTP query auth was already fixed; this closes the WebSocket gap.
        // Unauthenticated subscription connections receive user=null — resolvers
        // that require auth will reject them at the field level.
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
            // Invalid/expired token — connection allowed but user=null
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
 * Setup GraphQL middleware
 */
function setupGraphQL(app, httpServer) {
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers
  });

  // Setup subscriptions
  setupSubscriptionServer(httpServer, schema);

  // Create Apollo Server
  const server = createServer(httpServer);

  // Apply middleware
  server.start().then(() => {
    server.applyMiddleware({
      app,
      path: '/graphql',
      // BE-014: Restrict CORS to allowed origins (same as REST API).
      // Previously was '*' — allowing any origin to query the GraphQL API.
      cors: {
        origin: (process.env.CLIENT_URL || 'http://localhost:3000')
          .split(',').map(o => o.trim()),
        credentials: true
      }
    });

    logger.info(`[graphql] GraphQL server ready at /graphql (introspection: ${!IS_PROD})`);
  });

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
