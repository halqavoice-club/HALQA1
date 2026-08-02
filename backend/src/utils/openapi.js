/**
 * OpenAPI/Swagger Documentation Generator
 * 
 * Auto-generates OpenAPI 3.0 specification from Express routes.
 * Supports:
 * - Automatic route discovery
 * - JSDoc-based documentation
 * - Schema validation
 * - Security schemes
 * - Response examples
 * 
 * Usage:
 *   const openapi = require('./utils/openapi');
 *   
 *   // Generate spec
 *   const spec = openapi.generateSpec(app);
 *   
 *   // Serve documentation
 *   app.use('/api-docs', openapi.serveUI(spec));
 * 
 * Environment Variables:
 *   OPENAPI_ENABLED: true/false (default: true)
 *   OPENAPI_TITLE: API title (default: Halqa API)
 *   OPENAPI_VERSION: API version (default: 1.0.0)
 */

const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const logger = require('./logger');

let enabled = process.env.OPENAPI_ENABLED !== 'false';
const title = process.env.OPENAPI_TITLE || 'Halqa API';
const version = process.env.OPENAPI_VERSION || '1.0.0';

/**
 * OpenAPI configuration
 */
const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title,
      version,
      description: 'Halqa Class Management System API Documentation',
      contact: {
        name: 'Halqa Support',
        email: 'support@halqa.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:3000',
        description: 'Development server'
      },
      {
        url: process.env.API_PRODUCTION_URL || 'https://api.halqa.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'teacher', 'student', 'parent'] },
            schoolId: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        School: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            address: { type: 'string' },
            city: { type: 'string' },
            country: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string', format: 'email' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Post: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            content: { type: 'string' },
            authorId: { type: 'string', format: 'uuid' },
            schoolId: { type: 'string', format: 'uuid' },
            tags: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Session: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            deviceFingerprint: { type: 'string' },
            deviceType: { type: 'string' },
            deviceName: { type: 'string' },
            ipAddress: { type: 'string' },
            isActive: { type: 'boolean' },
            lastAccessedAt: { type: 'string', format: 'date-time' },
            terminatedAt: { type: 'string', format: 'date-time' },
            terminationReason: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                statusCode: { type: 'integer' },
                details: { type: 'object' }
              }
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' }
          }
        }
      },
      responses: {
        Unauthorized: {
          description: 'Unauthorized access',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        },
        ServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' }
            }
          }
        }
      }
    },
    tags: [
      { name: 'Auth', description: 'Authentication endpoints' },
      { name: 'Users', description: 'User management' },
      { name: 'Schools', description: 'School management' },
      { name: 'Posts', description: 'Post management' },
      { name: 'Sessions', description: 'Session management' },
      { name: 'Health', description: 'Health check endpoints' }
    ]
  },
  apis: ['./src/routes/*.js', './src/controllers/*.js']
};

/**
 * Generate OpenAPI specification
 */
function generateSpec(app) {
  if (!enabled) {
    logger.warn('[openapi] OpenAPI generation disabled');
    return null;
  }

  try {
    const spec = swaggerJsdoc(options);
    logger.info('[openapi] Generated OpenAPI specification');
    return spec;
  } catch (error) {
    logger.error('[openapi] Failed to generate specification:', error);
    return null;
  }
}

/**
 * Serve Swagger UI
 */
function serveUI(spec, options = {}) {
  if (!enabled || !spec) {
    return (req, res) => res.status(404).json({ error: 'OpenAPI disabled' });
  }

  const defaultOptions = {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: title + ' Documentation',
    ...options
  };

  return swaggerUi.serve;
}

/**
 * Serve Swagger UI assets
 */
function serveAssets(spec, options = {}) {
  if (!enabled || !spec) {
    return (req, res) => res.status(404).json({ error: 'OpenAPI disabled' });
  }

  return swaggerUi.setup(spec, options);
}

/**
 * Export specification as JSON
 */
function exportSpec(spec, format = 'json') {
  if (!spec) {
    return null;
  }

  if (format === 'json') {
    return JSON.stringify(spec, null, 2);
  } else if (format === 'yaml') {
    const yaml = require('yaml');
    return yaml.stringify(spec);
  }

  return spec;
}

/**
 * Validate OpenAPI specification
 */
function validateSpec(spec) {
  if (!spec) {
    return { valid: false, errors: ['Specification is null'] };
  }

  const errors = [];

  // Check required fields
  if (!spec.openapi) {
    errors.push('Missing openapi version');
  }
  if (!spec.info) {
    errors.push('Missing info object');
  }
  if (!spec.paths) {
    errors.push('Missing paths object');
  }

  // Check server URLs
  if (spec.servers && spec.servers.length === 0) {
    errors.push('No servers defined');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get API statistics
 */
function getStats(spec) {
  if (!spec) {
    return null;
  }

  let pathCount = 0;
  let operationCount = 0;
  const operationsByMethod = {};

  Object.keys(spec.paths || {}).forEach(path => {
    pathCount++;
    const methods = ['get', 'post', 'put', 'patch', 'delete'];
    methods.forEach(method => {
      if (spec.paths[path][method]) {
        operationCount++;
        operationsByMethod[method] = (operationsByMethod[method] || 0) + 1;
      }
    });
  });

  return {
    pathCount,
    operationCount,
    operationsByMethod,
    schemaCount: Object.keys(spec.components?.schemas || {}).length,
    tagCount: spec.tags?.length || 0
  };
}

/**
 * Middleware to serve OpenAPI spec
 */
function specMiddleware(spec) {
  return (req, res) => {
    if (!enabled || !spec) {
      return res.status(404).json({ error: 'OpenAPI disabled' });
    }

    const format = req.query.format || 'json';
    const exported = exportSpec(spec, format);

    if (format === 'yaml') {
      res.setHeader('Content-Type', 'text/yaml');
    } else {
      res.setHeader('Content-Type', 'application/json');
    }

    res.send(exported);
  };
}

/**
 * Setup OpenAPI documentation
 */
function setup(app, customOptions = {}) {
  if (!enabled) {
    logger.warn('[openapi] OpenAPI disabled, skipping setup');
    return;
  }

  const spec = generateSpec(app);
  if (!spec) {
    return;
  }

  // Serve specification
  app.get('/api-docs/spec.json', specMiddleware(spec));
  app.get('/api-docs/spec.yaml', (req, res) => {
    const exported = exportSpec(spec, 'yaml');
    res.setHeader('Content-Type', 'text/yaml');
    res.send(exported);
  });

  // Serve Swagger UI
  app.use('/api-docs', serveUI(spec), serveAssets(spec, customOptions));

  logger.info('[openapi] OpenAPI documentation available at /api-docs');
  logger.info('[openapi] OpenAPI spec available at /api-docs/spec.json');
}

/**
 * JSDoc decorators for automatic documentation
 */

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     summary: Health check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 */

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: User login
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /api/v1/users:
 *   get:
 *     summary: Get all users
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 pageSize:
 *                   type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

module.exports = {
  generateSpec,
  serveUI,
  serveAssets,
  exportSpec,
  validateSpec,
  getStats,
  specMiddleware,
  setup,
  options,
  isEnabled: () => enabled
};
