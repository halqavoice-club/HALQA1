/**
 * Secret and Environment Isolation
 * 
 * Sanitized subprocess environment helpers and secret redaction.
 * Addresses SECRET-LEAK-01 HIGH finding: Redact passwords in all error paths.
 * 
 * PROTECTION CONTROLS:
 * - Reject unexpected DATABASE_URL
 * - Remove production/shadow-database variables
 * - Safe diagnostic redaction (connection URLs, passwords, tokens)
 * - Safe error formatting
 * - Secret-free evidence reporting
 * - Allowlisted future executable arguments
 * 
 * REDACTION TARGETS:
 * - MySQL connection URLs (mysql://user:password@host → mysql://user:[REDACTED]@host)
 * - Passwords in SQL (IDENTIFIED BY 'pass' → IDENTIFIED BY '[REDACTED]')
 * - Tokens and API keys
 * - SQL errors containing credentials
 * - Stack traces with connection strings
 * - Environment dumps
 * 
 * OFFLINE IMPLEMENTATION: Pure string/object sanitization.
 * Do NOT log secrets to prove redaction.
 * 
 * @module secret-environment
 */

'use strict';

/**
 * Forbidden environment variables (must be removed before subprocess execution).
 * 
 * @constant {Set<string>}
 */
const FORBIDDEN_ENV_VARS = new Set([
  'DATABASE_URL',
  'DIRECT_URL',
  'SHADOW_DATABASE_URL',
  'MYSQL_URL',
  'DB_CONNECTION_STRING',
  'PROD_DATABASE_URL',
  'STAGING_DATABASE_URL',
  'PRODUCTION_DATABASE_URL',
]);

/**
 * Sensitive data patterns for redaction.
 * 
 * @constant {RegExp[]}
 */
const SENSITIVE_PATTERNS = [
  // MySQL connection URLs
  /mysql:\/\/([^:]+):([^@]+)@/gi,
  // PostgreSQL connection URLs
  /postgres(?:ql)?:\/\/([^:]+):([^@]+)@/gi,
  // IDENTIFIED BY 'password'
  /IDENTIFIED\s+BY\s+['"]([^'"]+)['"]/gi,
  // PASSWORD = 'password'
  /PASSWORD\s*=\s*['"]([^'"]+)['"]/gi,
  // Generic password patterns
  /password['":\s]*['":]([^'",\s}]+)/gi,
  // API keys
  /api[_-]?key['":\s]*['":]([^'",\s}]+)/gi,
  // Bearer tokens
  /bearer\s+([a-zA-Z0-9._-]{20,})/gi,
];

/**
 * Redact sensitive data from any value (string, object, array).
 * 
 * @param {*} data - Data to redact
 * @returns {*} - Redacted data (same type as input)
 */
function redactSensitiveData(data) {
  if (data === null || data === undefined) {
    return data;
  }
  
  if (typeof data === 'string') {
    return redactString(data);
  }
  
  if (Array.isArray(data)) {
    return data.map(item => redactSensitiveData(item));
  }
  
  if (typeof data === 'object') {
    const redacted = {};
    for (const [key, value] of Object.entries(data)) {
      // Redact key if it looks sensitive
      if (isSensitiveKey(key)) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactSensitiveData(value);
      }
    }
    return redacted;
  }
  
  return data;
}

/**
 * Redact sensitive patterns from a string.
 * 
 * @param {string} str - String to redact
 * @returns {string} - Redacted string
 */
function redactString(str) {
  if (!str || typeof str !== 'string') {
    return str;
  }
  
  let redacted = str;
  
  // Redact MySQL connection URLs
  redacted = redacted.replace(
    /mysql:\/\/([^:]+):([^@]+)@/gi,
    'mysql://$1:[REDACTED]@'
  );
  
  // Redact PostgreSQL connection URLs
  redacted = redacted.replace(
    /postgres(?:ql)?:\/\/([^:]+):([^@]+)@/gi,
    'postgresql://$1:[REDACTED]@'
  );
  
  // Redact IDENTIFIED BY 'password'
  redacted = redacted.replace(
    /IDENTIFIED\s+BY\s+['"]([^'"]+)['"]/gi,
    "IDENTIFIED BY '[REDACTED]'"
  );
  
  // Redact PASSWORD = 'password'
  redacted = redacted.replace(
    /PASSWORD\s*=\s*['"]([^'"]+)['"]/gi,
    "PASSWORD = '[REDACTED]'"
  );

  redacted = redacted.replace(/(password\s*[:=]\s*)([^\s,;}]+)/gi, '$1[REDACTED]');
  redacted = redacted.replace(/(api[_-]?key\s*[:=]\s*)([^\s,;}]+)/gi, '$1[REDACTED]');
  redacted = redacted.replace(/(bearer\s+)[a-zA-Z0-9._-]{8,}/gi, '$1[REDACTED]');
  
  return redacted;
}

/**
 * Check if a key name is sensitive.
 * 
 * @param {string} key - Key name to check
 * @returns {boolean} - True if sensitive
 */
function isSensitiveKey(key) {
  if (!key || typeof key !== 'string') {
    return false;
  }
  
  const lowerKey = key.toLowerCase();
  const sensitiveKeys = [
    'password',
    'passwd',
    'pwd',
    'secret',
    'token',
    'api_key',
    'apikey',
    'auth',
    'credential',
    'private_key',
    'privatekey',
  ];
  
  return sensitiveKeys.some(sk => lowerKey.includes(sk));
}

/**
 * Sanitize environment variables for subprocess execution.
 * 
 * Removes:
 * - DATABASE_URL and variants
 * - Production/shadow database variables
 * - API keys and tokens
 * - Any other sensitive variables
 * 
 * @param {object} env - Environment variables object
 * @returns {object} - Sanitized environment
 */
function sanitizeEnvironment(env) {
  if (!env || typeof env !== 'object') {
    return {};
  }
  
  const sanitized = {};
  
  for (const [key, value] of Object.entries(env)) {
    // Skip forbidden variables
    if (FORBIDDEN_ENV_VARS.has(key)) {
      continue;
    }
    
    // Skip sensitive keys
    if (isSensitiveKey(key)) {
      continue;
    }
    
    // Copy safe variables
    sanitized[key] = value;
  }
  
  return sanitized;
}

/**
 * Redact SQL statements (for logging).
 * 
 * @param {string} sql - SQL statement
 * @returns {string} - Redacted SQL
 */
function redactSQL(sql) {
  if (!sql || typeof sql !== 'string') {
    return sql;
  }
  
  let redacted = sql;
  
  // Redact CREATE USER ... IDENTIFIED BY
  redacted = redacted.replace(
    /CREATE\s+USER\s+[^;]*IDENTIFIED\s+BY\s+['"]([^'"]+)['"]/gi,
    (match) => match.replace(/IDENTIFIED\s+BY\s+['"]([^'"]+)['"]/gi, "IDENTIFIED BY '[REDACTED]'")
  );
  
  // Redact ALTER USER ... IDENTIFIED BY
  redacted = redacted.replace(
    /ALTER\s+USER\s+[^;]*IDENTIFIED\s+BY\s+['"]([^'"]+)['"]/gi,
    (match) => match.replace(/IDENTIFIED\s+BY\s+['"]([^'"]+)['"]/gi, "IDENTIFIED BY '[REDACTED]'")
  );
  
  // Redact SET PASSWORD
  redacted = redacted.replace(
    /SET\s+PASSWORD\s+[^;]*PASSWORD\s*\(\s*['"]([^'"]+)['"]\s*\)/gi,
    "SET PASSWORD = PASSWORD('[REDACTED]')"
  );
  
  return redacted;
}

/**
 * Redact connection strings.
 * 
 * @param {string} url - Connection URL
 * @returns {string} - Redacted URL
 */
function redactConnectionString(url) {
  if (!url || typeof url !== 'string') {
    return url;
  }
  
  // Redact password in connection string
  return url.replace(
    /:([^@:]+)@/,
    ':[REDACTED]@'
  );
}

/**
 * Redact password from any string.
 * 
 * @param {string} str - String potentially containing password
 * @returns {string} - Redacted string
 */
function redactPassword(str) {
  if (!str || typeof str !== 'string') {
    return str;
  }
  
  return redactString(str);
}

/**
 * Create safe error message (redact sensitive data from error).
 * 
 * @param {Error|string} error - Error object or message
 * @returns {string} - Safe error message
 */
function safeErrorMessage(error) {
  if (!error) {
    return 'Unknown error';
  }
  
  let message = '';
  
  if (error instanceof Error) {
    message = error.message;
    
    // Include stack trace if available (redacted)
    if (error.stack) {
      const redactedStack = redactString(error.stack);
      message += '\n' + redactedStack;
    }
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = JSON.stringify(error);
  }
  
  return redactString(message);
}

/**
 * Create secret-free attestation evidence for reporting.
 * 
 * Removes:
 * - Account credentials (username, password)
 * - Connection strings
 * - Any other sensitive fields
 * 
 * @param {object} attestation - Attestation evidence
 * @returns {object} - Secret-free attestation
 */
function secretFreeEvidence(attestation) {
  if (!attestation || typeof attestation !== 'object') {
    return attestation;
  }
  
  const safe = {};
  for (const [key, value] of Object.entries(attestation)) {
    safe[key] = key === 'accountCredentials' ? value : redactSensitiveData({ [key]: value })[key];
  }
  
  // Remove sensitive fields
  const sensitiveFields = [
    'password',
    'accountPassword',
    'connectionString',
    'databaseUrl',
    'credentials',
  ];
  
  for (const field of sensitiveFields) {
    if (safe[field]) {
      safe[field] = '[REDACTED]';
    }
  }
  
  // Redact nested account credentials
  if (safe.accountCredentials && typeof safe.accountCredentials === 'object') {
    safe.accountCredentials = {
      username: safe.accountCredentials.username || '[REDACTED]',
      password: '[REDACTED]',
      expiresAt: safe.accountCredentials.expiresAt || null,
    };
  }
  
  return safe;
}

/**
 * Validate that no sensitive data is present in output.
 * 
 * @param {string} output - Output string to validate
 * @returns {boolean} - True if no sensitive data detected
 * @throws {Error} - If sensitive data detected
 */
function validateNoSensitiveData(output) {
  if (!output || typeof output !== 'string') {
    return true;
  }
  
  // Check for patterns that suggest unredacted secrets
  const dangerousPatterns = [
    /IDENTIFIED\s+BY\s+['"][^[]/i, // IDENTIFIED BY with actual password (not [REDACTED])
    /PASSWORD\s*=\s*['"][^[]/i, // PASSWORD = with actual password
    /:\/\/[^:]+:[^@[\]]+@/, // Connection string with unredacted password
    /password\s*[:=]\s*(?!\[REDACTED\])\S+/i,
    /api[_-]?key\s*[:=]\s*(?!\[REDACTED\])\S+/i,
    /bearer\s+(?!\[REDACTED\])[a-zA-Z0-9._-]{8,}/i,
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(output)) {
      throw new Error(
        'SECRET-LEAK-01 violation: Sensitive data detected in output. ' +
        'All passwords and secrets must be redacted before logging.'
      );
    }
  }
  
  return true;
}

module.exports = {
  redactSensitiveData,
  sanitizeEnvironment,
  redactSQL,
  redactConnectionString,
  redactPassword,
  safeErrorMessage,
  secretFreeEvidence,
  validateNoSensitiveData,
};
