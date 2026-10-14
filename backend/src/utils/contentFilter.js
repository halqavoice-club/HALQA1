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
//
// FIND-005 FIX: Added a baseline set of universally inappropriate terms.
// Previously this array was empty, making the filter a no-op unless
// CONTENT_FILTER_WORDS was explicitly configured at deploy time.
// Operators should extend this via CONTENT_FILTER_WORDS for community-specific terms.
const DEFAULT_BLOCKED_PATTERNS = [
  // Severe profanity — the most universally inappropriate English terms
  /\bf+u+c+k+\b/i,
  /\bs+h+i+t+\b/i,
  /\ba+s+s+h+o+l+e+\b/i,
  /\bb+i+t+c+h+\b/i,
  /\bc+u+n+t\b/i,
  // Slurs — religious and ethnic hatred
  /\bkaffir\b/i,
  /\bnigger\b/i,
  /\bspic\b/i,
  /\bchink\b/i,
  /\bgook\b/i,
  // Calls to violence / self-harm (phrase-level)
  /\bkill\s+yourself\b/i,
  /\bgo\s+kill\s+yourself\b/i,
];

// Build the active filter from env config
let _cachedFilter = null;

// FIND-005 FIX: Emit a startup warning when the filter is enabled but no
// patterns are configured. This surfaces misconfiguration at boot rather
// than silently accepting all content. Fires once on first getFilter() call.
let _startupWarningEmitted = false;

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

  const enabled = process.env.CONTENT_FILTER_ENABLED !== 'false';

  // Startup warning: filter is enabled but has no patterns to enforce.
  // This catches the case where DEFAULT_BLOCKED_PATTERNS is re-emptied by a
  // future maintainer and CONTENT_FILTER_WORDS is not set in the environment.
  if (enabled && allPatterns.length === 0 && !_startupWarningEmitted) {
    _startupWarningEmitted = true;
    logger.warn(
      '[content-filter] Filter is ENABLED but DEFAULT_BLOCKED_PATTERNS is empty ' +
      'and CONTENT_FILTER_WORDS is not configured. ' +
      'All content will pass unchecked. Set CONTENT_FILTER_WORDS or populate ' +
      'DEFAULT_BLOCKED_PATTERNS in backend/src/utils/contentFilter.js.'
    );
  }

  _cachedFilter = {
    patterns: allPatterns,
    enabled,
    mode: process.env.CONTENT_FILTER_MODE || 'block',
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
