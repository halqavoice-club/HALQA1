/**
 * API Versioning Middleware
 * 
 * Provides API versioning strategy to support multiple API versions simultaneously.
 * Allows gradual rollout of new features without breaking existing clients.
 * 
 * Versioning Strategy:
 * - URL-based versioning: /api/v1/, /api/v2/, etc.
 * - Header-based versioning: Accept-Version: v1
 * - Default version: v1 (for backward compatibility)
 * - Deprecation warnings for old versions
 * 
 * Usage:
 *   const apiVersion = require('./middleware/apiVersion');
 *   app.use('/api', apiVersion.middleware);
 *   
 *   // Version-specific routes
 *   router.get('/endpoint', apiVersion.v1, handlerV1);
 *   router.get('/endpoint', apiVersion.v2, handlerV2);
 */

const logger = require('../utils/logger');

const SUPPORTED_VERSIONS = ['v1', 'v2'];
const DEFAULT_VERSION = 'v1';
const DEPRECATED_VERSIONS = ['v1']; // v1 is deprecated but still supported

/**
 * Extract API version from request
 * Priority: URL path > Accept-Version header > Default
 */
function extractVersion(req) {
  // Check URL path first: /api/v1/... or /api/v2/...
  const urlMatch = req.path.match(/^\/api\/(v\d+)\//);
  if (urlMatch) {
    const version = urlMatch[1];
    if (SUPPORTED_VERSIONS.includes(version)) {
      return version;
    }
  }

  // Check Accept-Version header
  const headerVersion = req.headers['accept-version'];
  if (headerVersion && SUPPORTED_VERSIONS.includes(headerVersion)) {
    return headerVersion;
  }

  // Default to v1 for backward compatibility
  return DEFAULT_VERSION;
}

/**
 * API versioning middleware
 * 
 * Attaches version info to request and sets appropriate headers.
 */
function apiVersionMiddleware(req, res, next) {
  const version = extractVersion(req);
  
  // Attach version to request
  req.apiVersion = version;
  req.isDeprecated = DEPRECATED_VERSIONS.includes(version);

  // Set version headers
  res.setHeader('API-Version', version);
  res.setHeader('API-Supported-Versions', SUPPORTED_VERSIONS.join(', '));

  // Add deprecation warning for deprecated versions
  if (req.isDeprecated) {
    res.setHeader('Deprecation', `true`);
    res.setHeader('Sunset', new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString()); // 6 months
    logger.warn(`[apiVersion] Deprecated version ${version} requested by ${req.ip}`);
  }

  next();
}

/**
 * Version guard middleware
 * 
 * Only allows requests matching the specified version(s).
 * 
 * Usage:
 *   router.get('/endpoint', apiVersion.guard('v2'), handlerV2);
 *   router.get('/endpoint', apiVersion.guard(['v1', 'v2']), handlerMulti);
 */
function guardVersion(allowedVersions) {
  const versions = Array.isArray(allowedVersions) ? allowedVersions : [allowedVersions];
  
  return (req, res, next) => {
    if (!versions.includes(req.apiVersion)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VAL_007',
          message: `API version ${req.apiVersion} not supported for this endpoint`,
          statusCode: 400,
          details: {
            requestedVersion: req.apiVersion,
            supportedVersions: versions
          }
        }
      });
    }
    next();
  };
}

/**
 * Version-specific middleware helpers
 */
const v1 = guardVersion('v1');
const v2 = guardVersion('v2');
const v1OrV2 = guardVersion(['v1', 'v2']);

/**
 * Version migration helper
 * 
 * Transforms v1 request/response to v2 format and vice versa.
 * Useful for gradual migration of endpoints.
 * 
 * Usage:
 *   router.get('/endpoint', 
 *     apiVersion.migrateToV2(requestTransformer, responseTransformer),
 *     handlerV2
 *   );
 */
function migrateToV2(requestTransformer, responseTransformer) {
  return (req, res, next) => {
    if (req.apiVersion === 'v1' && requestTransformer) {
      try {
        req.body = requestTransformer(req.body);
        req.query = requestTransformer(req.query);
      } catch (error) {
        logger.error('[apiVersion] Migration error:', error);
        return res.status(400).json({
          success: false,
          error: {
            code: 'INT_004',
            message: 'Version migration failed',
            statusCode: 400
          }
        });
      }
    }

    // Intercept response for v1 clients
    if (req.apiVersion === 'v1' && responseTransformer) {
      const originalJson = res.json.bind(res);
      res.json = function(data) {
        try {
          const transformed = responseTransformer(data);
          return originalJson(transformed);
        } catch (error) {
          logger.error('[apiVersion] Response migration error:', error);
          return originalJson(data);
        }
      };
    }

    next();
  };
}

/**
 * Version deprecation check
 * 
 * Logs warnings when deprecated versions are used.
 * Can be extended to send metrics or alerts.
 */
function checkDeprecation(req, res, next) {
  if (req.isDeprecated) {
    logger.warn(`[apiVersion] Deprecated API version ${req.apiVersion} used`, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      path: req.path,
      method: req.method
    });

    // Send metrics (if metrics system is available)
    try {
      const prom = require('../utils/prometheus');
      prom.apiDeprecatedUsage.inc({
        version: req.apiVersion,
        endpoint: req.path
      });
    } catch (error) {
      // Metrics not available, ignore
    }
  }
  next();
}

/**
 * Version compatibility matrix
 * 
 * Defines which client versions are compatible with which API versions.
 * Used for client upgrade prompts.
 */
const COMPATIBILITY_MATRIX = {
  'v1': {
    minClientVersion: '1.0.0',
    maxClientVersion: '2.0.0',
    deprecated: true,
    sunsetDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString()
  },
  'v2': {
    minClientVersion: '2.0.0',
    maxClientVersion: '3.0.0',
    deprecated: false
  }
};

/**
 * Get version info for client
 * 
 * Returns version information to help clients decide if they need to upgrade.
 */
function getVersionInfo(req, res) {
  const clientVersion = req.headers['x-client-version'];
  
  const response = {
    currentVersion: req.apiVersion,
    supportedVersions: SUPPORTED_VERSIONS,
    deprecatedVersions: DEPRECATED_VERSIONS,
    compatibility: COMPATIBILITY_MATRIX,
    clientUpgradeRequired: false
  };

  // Check if client needs upgrade
  if (clientVersion && COMPATIBILITY_MATRIX[req.apiVersion]) {
    const versionInfo = COMPATIBILITY_MATRIX[req.apiVersion];
    const [major, minor, patch] = clientVersion.split('.').map(Number);
    
    if (versionInfo.deprecated) {
      response.clientUpgradeRequired = true;
      response.recommendedVersion = 'v2';
    }
  }

  return res.json({
    success: true,
    data: response
  });
}

module.exports = {
  middleware: apiVersionMiddleware,
  guard: guardVersion,
  v1,
  v2,
  v1OrV2,
  migrateToV2,
  checkDeprecation,
  getVersionInfo,
  extractVersion,
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  DEPRECATED_VERSIONS,
  COMPATIBILITY_MATRIX
};
