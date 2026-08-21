/**
 * Feature Flag System
 * 
 * Provides feature flag management for gradual feature rollouts.
 * Supports:
 * - Boolean flags (on/off)
 * - Percentage rollouts
 * - User-based targeting
 * - Environment-based targeting
 * - Remote configuration
 * - Flag change history
 * 
 * Usage:
 *   const featureFlags = require('./utils/featureFlags');
 *   
 *   // Initialize with flags
 *   await featureFlags.initialize({
 *     newFeature: false,
 *     betaFeature: { enabled: true, percentage: 50 },
 *     userFeature: { enabled: true, users: ['user-123', 'user-456'] }
 *   });
 *   
 *   // Check if flag is enabled
 *   if (featureFlags.isEnabled('newFeature', userId)) {
 *     // Use new feature
 *   }
 */

const logger = require('./logger');
const { isRedisReady, getCache, setCache } = require('./redis');

let flags = {};
let flagHistory = [];
const CACHE_TTL = 60; // 1 minute cache

/**
 * Initialize feature flags
 */
async function initialize(initialFlags = {}) {
  flags = initialFlags;
  
  // Try to load from Redis cache
  if (isRedisReady()) {
    try {
      const cached = await getCache('feature-flags');
      if (cached) {
        flags = cached;
        logger.info('[featureFlags] Loaded flags from cache');
      }
    } catch (error) {
      logger.error('[featureFlags] Failed to load from cache:', error);
    }
  }

  logger.info('[featureFlags] Initialized with', Object.keys(flags).length, 'flags');
}

/**
 * Check if flag is enabled for a specific user
 */
function isEnabled(flagName, userId = null, context = {}) {
  const flag = flags[flagName];

  // Flag doesn't exist
  if (flag === undefined) {
    logger.warn(`[featureFlags] Flag ${flagName} not found`);
    return false;
  }

  // Simple boolean flag
  if (typeof flag === 'boolean') {
    return flag;
  }

  // Complex flag with configuration
  if (typeof flag === 'object' && flag !== null) {
    // Check if flag is globally enabled
    if (!flag.enabled) {
      return false;
    }

    // Check user-based targeting
    if (flag.users && userId) {
      return flag.users.includes(userId);
    }

    // Check percentage rollout
    if (flag.percentage && userId) {
      const hash = hashString(userId + flagName);
      const value = hash % 100;
      return value < flag.percentage;
    }

    // Check environment targeting
    if (flag.environments) {
      const env = process.env.NODE_ENV || 'development';
      return flag.environments.includes(env);
    }

    // Check custom rules
    if (flag.rules && context) {
      return evaluateRules(flag.rules, context);
    }

    // Default to enabled if no specific targeting
    return true;
  }

  return false;
}

/**
 * Get flag value
 */
function getFlag(flagName) {
  return flags[flagName];
}

/**
 * Get all flags
 */
function getAllFlags() {
  return { ...flags };
}

/**
 * Set flag value
 */
function setFlag(flagName, value, metadata = {}) {
  const oldValue = flags[flagName];
  flags[flagName] = value;

  // Record history
  flagHistory.push({
    flagName,
    oldValue,
    newValue: value,
    timestamp: new Date().toISOString(),
    metadata
  });

  // Keep only last 100 history entries
  if (flagHistory.length > 100) {
    flagHistory = flagHistory.slice(-100);
  }

  // Update cache
  if (isRedisReady()) {
    setCache('feature-flags', flags, CACHE_TTL).catch(() => {});
  }

  logger.info(`[featureFlags] Set flag ${flagName}:`, value);
}

/**
 * Delete flag
 */
function deleteFlag(flagName) {
  const oldValue = flags[flagName];
  delete flags[flagName];

  flagHistory.push({
    flagName,
    oldValue,
    newValue: null,
    timestamp: new Date().toISOString(),
    action: 'deleted'
  });

  if (isRedisReady()) {
    setCache('feature-flags', flags, CACHE_TTL).catch(() => {});
  }

  logger.info(`[featureFlags] Deleted flag ${flagName}`);
}

/**
 * Get flag history
 */
function getFlagHistory(flagName = null) {
  if (flagName) {
    return flagHistory.filter(h => h.flagName === flagName);
  }
  return flagHistory;
}

/**
 * Evaluate custom rules
 */
function evaluateRules(rules, context) {
  for (const rule of rules) {
    if (rule.type === 'equals') {
      if (context[rule.field] === rule.value) {
        return rule.result;
      }
    } else if (rule.type === 'contains') {
      if (context[rule.field] && context[rule.field].includes(rule.value)) {
        return rule.result;
      }
    } else if (rule.type === 'greaterThan') {
      if (context[rule.field] > rule.value) {
        return rule.result;
      }
    } else if (rule.type === 'lessThan') {
      if (context[rule.field] < rule.value) {
        return rule.result;
      }
    }
  }
  return false;
}

/**
 * Hash string to number (for percentage rollouts)
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Middleware to check feature flags
 */
function middleware(flagName, options = {}) {
  const { fallback = false, contextExtractor = null } = options;

  return (req, res, next) => {
    const userId = req.user?.id || req.headers['x-user-id'];
    const context = contextExtractor ? contextExtractor(req) : {};

    if (isEnabled(flagName, userId, context)) {
      req.featureFlags = req.featureFlags || {};
      req.featureFlags[flagName] = true;
      return next();
    }

    if (fallback) {
      return next();
    }

    return res.status(404).json({
      success: false,
      error:({
        code: 'NOT_FOUND_001',
        message: 'Feature not available',
        statusCode: 404
      })
    });
  };
}

/**
 * Express helper to conditionally enable routes
 */
function ifEnabled(flagName, handler, fallbackHandler = null) {
  return (req, res, next) => {
    const userId = req.user?.id;
    const context = { req, res };

    if (isEnabled(flagName, userId, context)) {
      return handler(req, res, next);
    }

    if (fallbackHandler) {
      return fallbackHandler(req, res, next);
    }

    return res.status(404).json({
      success: false,
      error:({
        code: 'NOT_FOUND_001',
        message: 'Feature not available',
        statusCode: 404
      })
    });
  };
}

/**
 * Load flags from remote configuration
 */
async function loadFromRemote(url) {
  try {
    const response = await fetch(url);
    const remoteFlags = await response.json();
    
    Object.assign(flags, remoteFlags);
    
    if (isRedisReady()) {
      await setCache('feature-flags', flags, CACHE_TTL);
    }

    logger.info('[featureFlags] Loaded flags from remote:', url);
    return true;
  } catch (error) {
    logger.error('[featureFlags] Failed to load from remote:', error);
    return false;
  }
}

/**
 * Export flags to remote configuration
 */
function exportFlags() {
  return {
    flags,
    history: flagHistory,
    exportedAt: new Date().toISOString()
  };
}

/**
 * Import flags from configuration
 */
function importFlags(config) {
  if (config.flags) {
    Object.assign(flags, config.flags);
  }

  if (config.history) {
    flagHistory = [...flagHistory, ...config.history];
  }

  if (isRedisReady()) {
    setCache('feature-flags', flags, CACHE_TTL).catch(() => {});
  }

  logger.info('[featureFlags] Imported flags from configuration');
}

/**
 * Get flag statistics
 */
function getStats() {
  const totalFlags = Object.keys(flags).length;
  const enabledFlags = Object.values(flags).filter(f => {
    if (typeof f === 'boolean') return f;
    if (typeof f === 'object') return f.enabled;
    return false;
  }).length;

  return {
    totalFlags,
    enabledFlags,
    disabledFlags: totalFlags - enabledFlags,
    historyEntries: flagHistory.length
  };
}

/**
 * Pre-configured common flags
 */

const defaultFlags = {
  // New features (disabled by default)
  newDashboard: false,
  advancedSearch: false,
  realTimeNotifications: false,
  
  // Beta features (percentage rollout)
  betaUI: { enabled: true, percentage: 10 },
  experimentalAPI: { enabled: true, percentage: 5 },
  
  // User-specific features
  premiumFeatures: { enabled: true, users: [] },
  adminFeatures: { enabled: true, users: [] },
  
  // Environment-specific
  debugMode: { enabled: true, environments: ['development', 'staging'] },
  maintenanceMode: { enabled: false, environments: ['production'] },

  // ── PK Battle System (additive) ──────────────────────────────────────────
  PK_ENABLED:             true,
  PK_MATCHMAKING_ENABLED: true,
  PK_TOURNAMENT_ENABLED:  true,
  PK_RANKING_ENABLED:     true,
  PK_VOTING_ENABLED:      true,
  PK_TEAM_ENABLED:        true,
  PK_CLUB_ENABLED:        true,
};

module.exports = {
  initialize,
  isEnabled,
  getFlag,
  getAllFlags,
  setFlag,
  deleteFlag,
  getFlagHistory,
  middleware,
  ifEnabled,
  loadFromRemote,
  exportFlags,
  importFlags,
  getStats,
  defaultFlags
};
