/**
 * Standardized Error Handling System
 * 
 * Provides consistent error codes, error classes, and error responses across the application.
 * 
 * Error Categories:
 * - AUTHENTICATION (1xxx): Authentication and authorization errors
 * - VALIDATION (2xxx): Input validation errors
 * - NOT_FOUND (3xxx): Resource not found errors
 * - CONFLICT (4xxx): Conflict/state errors
 * - RATE_LIMIT (5xxx): Rate limiting errors
 * - EXTERNAL_SERVICE (6xxx): External service errors
 * - INTERNAL (9xxx): Internal server errors
 */

/**
 * Base Application Error class
 */
class AppError extends Error {
  constructor(message, statusCode, code, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    this.timestamp = new Date().toISOString();

    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        details: this.details,
        timestamp: this.timestamp
      }
    };
  }
}

/**
 * Authentication Errors (1xxx)
 */
class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed', details = {}) {
    super(message, 401, 'AUTH_001', details);
  }
}

class TokenExpiredError extends AppError {
  constructor(details = {}) {
    super('Token has expired', 401, 'AUTH_002', details);
  }
}

class InvalidTokenError extends AppError {
  constructor(details = {}) {
    super('Invalid token', 401, 'AUTH_003', details);
  }
}

class InsufficientPermissionsError extends AppError {
  constructor(message = 'Insufficient permissions', details = {}) {
    super(message, 403, 'AUTH_004', details);
  }
}

class AccountSuspendedError extends AppError {
  constructor(details = {}) {
    super('Account has been suspended', 403, 'AUTH_005', details);
  }
}

class SessionExpiredError extends AppError {
  constructor(details = {}) {
    super('Session has expired', 401, 'AUTH_006', details);
  }
}

/**
 * Validation Errors (2xxx)
 */
class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = {}) {
    super(message, 400, 'VAL_001', details);
  }
}

class RequiredFieldError extends AppError {
  constructor(field, details = {}) {
    super(`Field '${field}' is required`, 400, 'VAL_002', { field, ...details });
  }
}

class InvalidFormatError extends AppError {
  constructor(field, expectedFormat, details = {}) {
    super(`Field '${field}' has invalid format. Expected: ${expectedFormat}`, 400, 'VAL_003', { field, expectedFormat, ...details });
  }
}

class InvalidEmailError extends AppError {
  constructor(details = {}) {
    super('Invalid email format', 400, 'VAL_004', details);
  }
}

class InvalidPasswordError extends AppError {
  constructor(message = 'Invalid password', details = {}) {
    super(message, 400, 'VAL_005', details);
  }
}

class InvalidOtpError extends AppError {
  constructor(details = {}) {
    super('Invalid or expired OTP', 400, 'VAL_006', details);
  }
}

/**
 * Not Found Errors (3xxx)
 */
class NotFoundError extends AppError {
  constructor(resource, details = {}) {
    super(`${resource} not found`, 404, 'NOT_FOUND_001', { resource, ...details });
  }
}

class UserNotFoundError extends AppError {
  constructor(details = {}) {
    super('User not found', 404, 'NOT_FOUND_002', details);
  }
}

class SchoolNotFoundError extends AppError {
  constructor(details = {}) {
    super('School not found', 404, 'NOT_FOUND_003', details);
  }
}

class ResourceNotFoundError extends AppError {
  constructor(resourceType, resourceId, details = {}) {
    super(`${resourceType} with ID ${resourceId} not found`, 404, 'NOT_FOUND_004', { resourceType, resourceId, ...details });
  }
}

/**
 * Conflict Errors (4xxx)
 */
class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details = {}) {
    super(message, 409, 'CONF_001', details);
  }
}

class DuplicateResourceError extends AppError {
  constructor(resource, identifier, details = {}) {
    super(`${resource} with identifier '${identifier}' already exists`, 409, 'CONF_002', { resource, identifier, ...details });
  }
}

class EmailAlreadyExistsError extends AppError {
  constructor(details = {}) {
    super('Email already registered', 409, 'CONF_003', details);
  }
}

class InvalidStateError extends AppError {
  constructor(message = 'Invalid state transition', details = {}) {
    super(message, 400, 'CONF_004', details);
  }
}

class ConcurrentModificationError extends AppError {
  constructor(details = {}) {
    super('Resource was modified by another transaction', 409, 'CONF_005', details);
  }
}

/**
 * Rate Limit Errors (5xxx)
 */
class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded', details = {}) {
    super(message, 429, 'RATE_001', details);
  }
}

class TooManyRequestsError extends AppError {
  constructor(retryAfter, details = {}) {
    super('Too many requests', 429, 'RATE_002', { retryAfter, ...details });
  }
}

/**
 * External Service Errors (6xxx)
 */
class ExternalServiceError extends AppError {
  constructor(service, message = 'External service error', details = {}) {
    super(`${service}: ${message}`, 502, 'EXT_001', { service, ...details });
  }
}

class DatabaseError extends AppError {
  constructor(message = 'Database error', details = {}) {
    super(message, 500, 'EXT_002', { service: 'database', ...details });
  }
}

class RedisError extends AppError {
  constructor(message = 'Redis error', details = {}) {
    super(message, 500, 'EXT_003', { service: 'redis', ...details });
  }
}

class EmailServiceError extends AppError {
  constructor(message = 'Email service error', details = {}) {
    super(message, 502, 'EXT_004', { service: 'email', ...details });
  }
}

class SMSError extends AppError {
  constructor(message = 'SMS service error', details = {}) {
    super(message, 502, 'EXT_005', { service: 'sms', ...details });
  }
}

class StorageError extends AppError {
  constructor(message = 'Storage service error', details = {}) {
    super(message, 502, 'EXT_006', { service: 'storage', ...details });
  }
}

class PaymentServiceError extends AppError {
  constructor(message = 'Payment service error', details = {}) {
    super(message, 502, 'EXT_007', { service: 'payment', ...details });
  }
}

/**
 * Internal Errors (9xxx)
 */
class InternalServerError extends AppError {
  constructor(message = 'Internal server error', details = {}) {
    super(message, 500, 'INT_001', details);
  }
}

class NotImplementedError extends AppError {
  constructor(feature, details = {}) {
    super(`Feature '${feature}' is not implemented`, 501, 'INT_002', { feature, ...details });
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', details = {}) {
    super(message, 503, 'INT_003', details);
  }
}

/**
 * Error code mapping for quick lookup
 */
const ERROR_CODES = {
  // Authentication
  AUTH_001: 'Authentication failed',
  AUTH_002: 'Token expired',
  AUTH_003: 'Invalid token',
  AUTH_004: 'Insufficient permissions',
  AUTH_005: 'Account suspended',
  AUTH_006: 'Session expired',
  
  // Validation
  VAL_001: 'Validation failed',
  VAL_002: 'Required field missing',
  VAL_003: 'Invalid format',
  VAL_004: 'Invalid email',
  VAL_005: 'Invalid password',
  VAL_006: 'Invalid OTP',
  
  // Not Found
  NOT_FOUND_001: 'Resource not found',
  NOT_FOUND_002: 'User not found',
  NOT_FOUND_003: 'School not found',
  NOT_FOUND_004: 'Resource by ID not found',
  
  // Conflict
  CONF_001: 'Resource conflict',
  CONF_002: 'Duplicate resource',
  CONF_003: 'Email already exists',
  CONF_004: 'Invalid state',
  CONF_005: 'Concurrent modification',
  
  // Rate Limit
  RATE_001: 'Rate limit exceeded',
  RATE_002: 'Too many requests',
  
  // External Service
  EXT_001: 'External service error',
  EXT_002: 'Database error',
  EXT_003: 'Redis error',
  EXT_004: 'Email service error',
  EXT_005: 'SMS service error',
  EXT_006: 'Storage service error',
  EXT_007: 'Payment service error',
  
  // Internal
  INT_001: 'Internal server error',
  INT_002: 'Not implemented',
  INT_003: 'Service unavailable'
};

/**
 * Convert Prisma errors to AppError
 */
function handlePrismaError(error) {
  if (!error) {
    return new InternalServerError('Unknown database error');
  }

  if (error.code === 'P2002') {
    // Unique constraint violation
    const field = error.meta?.target?.[0] || 'field';
    return new DuplicateResourceError(field, error.meta?.target?.[1]);
  }
  
  if (error.code === 'P2025') {
    // Record not found
    return new NotFoundError('Resource');
  }
  
  if (error.code === 'P2003') {
    // Foreign key constraint violation
    return new ValidationError('Invalid reference', { field: error.meta?.field_name });
  }
  
  if (error.code === 'P2014') {
    // Required relation violation
    return new ValidationError('Required relation missing', { relation: error.meta?.relation_name });
  }
  
  // Default to internal server error (unknown Prisma error code)
  return new InternalServerError(error.message || 'Database error', { originalCode: error.code });
}

/**
 * Convert unknown errors to AppError
 */
function handleUnknownError(error) {
  if (!error) {
    return new InternalServerError('Unknown error');
  }

  if (error instanceof AppError) {
    return error;
  }
  
  if (error.name === 'ValidationError') {
    return new ValidationError(error.message);
  }
  
  if (error.name === 'TokenExpiredError') {
    return new TokenExpiredError();
  }
  
  if (error.name === 'JsonWebTokenError') {
    return new InvalidTokenError();
  }
  
  if (error.code === 'LIMIT_FILE_SIZE') {
    return new ValidationError('File too large');
  }
  
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return new ValidationError('Unexpected file field');
  }
  
  // Default to internal server error
  if (process.env.NODE_ENV === 'production') {
    return new InternalServerError();
  }
  
  // In development, include the original error
  return new InternalServerError(error.message, { stack: error.stack });
}

/**
 * Error response formatter
 */
function formatErrorResponse(error) {
  const appError = handleUnknownError(error);
  
  return {
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      statusCode: appError.statusCode,
      ...(Object.keys(appError.details).length > 0 && { details: appError.details }),
      timestamp: appError.timestamp
    }
  };
}

module.exports = {
  // Base class
  AppError,
  
  // Authentication errors
  AuthenticationError,
  TokenExpiredError,
  InvalidTokenError,
  InsufficientPermissionsError,
  AccountSuspendedError,
  SessionExpiredError,
  
  // Validation errors
  ValidationError,
  RequiredFieldError,
  InvalidFormatError,
  InvalidEmailError,
  InvalidPasswordError,
  InvalidOtpError,
  
  // Not found errors
  NotFoundError,
  UserNotFoundError,
  SchoolNotFoundError,
  ResourceNotFoundError,
  
  // Conflict errors
  ConflictError,
  DuplicateResourceError,
  EmailAlreadyExistsError,
  InvalidStateError,
  ConcurrentModificationError,
  
  // Rate limit errors
  RateLimitError,
  TooManyRequestsError,
  
  // External service errors
  ExternalServiceError,
  DatabaseError,
  RedisError,
  EmailServiceError,
  SMSError,
  StorageError,
  PaymentServiceError,
  
  // Internal errors
  InternalServerError,
  NotImplementedError,
  ServiceUnavailableError,
  
  // Utilities
  ERROR_CODES,
  handlePrismaError,
  handleUnknownError,
  formatErrorResponse
};
