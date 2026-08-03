'use strict';
/**
 * Content Filter Utility
 * ─────────────────────────────────────────────────────────────────────────────
 * Basic word-level content moderation for an Islamic school platform.
 *
 * Strategy:
 *   1. Maintain a configurable blocklist loaded from env var or default list
 *   2. Scan message/post body text before persisting to DB
 *   3. Return { clean: true } or { clean: false, reason: string }
 *   4. Never crash the caller — wrap everything in try/catch
 *
 * Configuration:
 *   CONTENT_FILTER_ENABLED=true|false   (default: true in production)
 *   CONTENT_FILTER_WORDS=word1,word2    (comma-separated additions to default list)
 *   CONTENT_FILTER_MODE=block|flag      (block = reject HTTP 400; flag = allow + log)
 *
 * Usage:
 *   const { checkContent } = require('../utils/contentFilter');
 *   const result = checkContent(req.body.body);
 *   if (!result.clean) return errorResponse(res, result.reason, 400);
 */

const logger = require('./logger');

// Default blocklist — extend via CONTENT_FILTER_WORDS env var.
// Kept minimal — the list is NOT exhaustive. For production, consider:
//   - Perspective API (Google): https://www.perspectiveapi.com
//   - Azure Content Moderator
// These can be wired as an async check here if API credentials are available.
const DEFAULT_BLOCKED_PATTERNS = [
  // Hate speech patterns (regex — case-insensitive word-boundary match)
  // Add your own patterns here as needed for your specific community
];

// Build the active filter from env config
let _cachedFilter = null;

function getFilter() {
  if (_cachedFilter) return _cachedFilter;

  const customWords = (process.env.CONTENT_FILTER_WORDS || '')
    .split(',')
    .map(w => w.trim().toLowerCase())
    .filter(Boolean);

  const allPatterns = [
    ...DEFAULT_BLOCKED_PATTERNS,
    ...customWords.map(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')),
  ];

  _cachedFilter = {
    patterns:    allPatterns,
    enabled:     process.env.CONTENT_FILTER_ENABLED !== 'false',
    mode:        process.env.CONTENT_FILTER_MODE || 'block', // 'block' | 'flag'
  };

  return _cachedFilter;
}

// Reset cache when env changes (useful in tests)
function resetFilter() { _cachedFilter = null; }

/**
 * Check a text string against the content filter.
 *
 * @param {string} text - The content to check
 * @param {string} [context] - Optional context label for logging (e.g. 'group-chat', 'post')
 * @returns {{ clean: boolean, reason?: string }}
 */
function checkContent(text, context = 'message') {
  try {
    const filter = getFilter();

    if (!filter.enabled || !text || typeof text !== 'string') {
      return { clean: true };
    }

    for (const pattern of filter.patterns) {
      if (pattern.test(text)) {
        const matched = text.match(pattern)?.[0] ?? '(redacted)';

        if (filter.mode === 'flag') {
          // Flag mode: allow the content but log it for admin review
          logger.warn(`[content-filter] Flagged ${context} content matching pattern: "${matched}"`);
          return { clean: true, flagged: true, matched };
        }

        // Block mode: reject the content
        logger.info(`[content-filter] Blocked ${context} content matching pattern: "${matched}"`);
        return {
          clean:  false,
          reason: 'Message contains content that is not allowed on this platform.',
        };
      }
    }

    return { clean: true };
  } catch (err) {
    // Never crash the caller — content filter failure is non-fatal
    logger.error(`[content-filter] Filter error: ${err.message}`);
    return { clean: true };
  }
}

/**
 * Express middleware factory — applies content filter to req.body[field].
 * Returns HTTP 400 if content is blocked (mode=block).
 *
 * Usage:
 *   router.post('/', filterMiddleware('body'), controller)
 */
function filterMiddleware(field = 'body', context = 'message') {
  return (req, res, next) => {
    const text = req.body?.[field];
    if (!text) return next();

    const result = checkContent(text, context);
    if (!result.clean) {
      const { errorResponse } = require('./response');
      return errorResponse(res, result.reason, 400);
    }
    next();
  };
}

module.exports = { checkContent, filterMiddleware, resetFilter };
