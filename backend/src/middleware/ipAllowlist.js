/**
 * IP Allowlist Middleware
 *
 * Restricts access to admin routes based on the ADMIN_IP_ALLOWLIST environment variable.
 *
 * Configuration:
 *   ADMIN_IP_ALLOWLIST=192.168.1.10,10.0.0.0/8,172.16.0.0/12
 *
 * - Accepts comma-separated IPv4 addresses and/or CIDR ranges.
 * - Returns 403 when the request IP is not in the list.
 * - Passes through unconditionally when the env var is empty or unset
 *   (so development environments are not accidentally locked out).
 *
 * Requirements: 10.1, 10.2
 */

'use strict';

const { isIPv4 } = require('net');

/**
 * Convert a CIDR string (e.g. "10.0.0.0/8") into a numeric network / mask pair
 * for fast bitwise comparison.
 *
 * @param {string} cidr
 * @returns {{ network: number, mask: number }}
 */
function parseCIDR(cidr) {
  const [ip, prefixStr] = cidr.split('/');
  const prefix = prefixStr !== undefined ? parseInt(prefixStr, 10) : 32;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const network = ipToInt(ip) & mask;
  return { network, mask };
}

/**
 * Convert a dotted-decimal IPv4 string to a 32-bit unsigned integer.
 *
 * @param {string} ip
 * @returns {number}
 */
function ipToInt(ip) {
  return ip
    .split('.')
    .reduce((acc, octet) => (acc * 256 + parseInt(octet, 10)) >>> 0, 0);
}

/**
 * Check whether `ip` matches any entry in the parsed allowlist.
 *
 * @param {string} ip - Dotted-decimal IPv4 address
 * @param {{ network: number, mask: number }[]} entries
 * @returns {boolean}
 */
function isAllowed(ip, entries) {
  const ipInt = ipToInt(ip);
  return entries.some(({ network, mask }) => (ipInt & mask) === network);
}

/**
 * Parse ADMIN_IP_ALLOWLIST into a list of CIDR entries.
 * Results are cached so the env var is only parsed once per process lifetime.
 */
let _cachedEntries = null;
let _cachedRaw = undefined;

function getAllowlistEntries() {
  const raw = process.env.ADMIN_IP_ALLOWLIST;

  // Re-parse only when the env var changes (handles test overrides).
  if (raw === _cachedRaw && _cachedEntries !== null) {
    return _cachedEntries;
  }

  _cachedRaw = raw;

  if (!raw || raw.trim() === '') {
    _cachedEntries = null; // null means "no restriction"
    return null;
  }

  _cachedEntries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.includes('/')) {
        return parseCIDR(entry);
      }
      // Bare IP — treat as a /32 CIDR
      return parseCIDR(`${entry}/32`);
    });

  return _cachedEntries;
}

/**
 * Extract the real client IP, respecting X-Forwarded-For when set by a trusted
 * proxy (Express `trust proxy` setting).
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function getClientIP(req) {
  // req.ip already honours the `trust proxy` setting.
  return req.ip || req.connection.remoteAddress || '';
}

/**
 * Strip IPv6-mapped IPv4 prefix ("::ffff:") so pure IPv4 comparisons work.
 *
 * @param {string} ip
 * @returns {string}
 */
function normalizeIP(ip) {
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  return ip;
}

/**
 * Express middleware that enforces the IP allowlist.
 *
 * - If ADMIN_IP_ALLOWLIST is empty/unset → pass through (no restriction).
 * - If the client IP matches any entry   → pass through.
 * - Otherwise                            → respond with 403, no body.
 */
function ipAllowlist(req, res, next) {
  const entries = getAllowlistEntries();

  // Allowlist not configured — allow all traffic.
  if (entries === null) {
    return next();
  }

  const rawIP = getClientIP(req);
  const clientIP = normalizeIP(rawIP);

  if (!isIPv4(clientIP)) {
    // Non-IPv4 addresses (pure IPv6) are not supported by this middleware.
    // Reject to avoid accidentally granting access through an unchecked path.
    return res.status(403).end();
  }

  if (isAllowed(clientIP, entries)) {
    return next();
  }

  return res.status(403).end();
}

module.exports = ipAllowlist;
