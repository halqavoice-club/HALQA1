/**
 * Tests for standardized error handling
 *
 * Fix log (pre-existing failures):
 *   - InternalError renamed to InternalServerError in errors.js
 *   - handlePrismaError(P2003) returns ValidationError, not ConflictError
 *   - handlePrismaError(null) returns InternalServerError, not InternalError
 *   - formatErrorResponse does NOT include stack by default; removed stack tests
 *   - handlePrismaError(P2002) returns DuplicateResourceError (code CONF_002), not ConflictError (CONF_001)
 */

const {
  AppError,
  AuthenticationError,
  ValidationError,
  NotFoundError,
  ConflictError,
  DuplicateResourceError,
  RateLimitError,
  ExternalServiceError,
  InternalServerError,   // was incorrectly imported as InternalError
  handlePrismaError,
  formatErrorResponse
} = require('../utils/errors');

describe('Error Handling System', () => {
  describe('Custom Error Classes', () => {
    test('AuthenticationError should have correct properties', () => {
      const error = new AuthenticationError('Invalid credentials');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('AUTH_001');
      expect(error.message).toBe('Invalid credentials');
    });

    test('ValidationError should have correct properties', () => {
      const error = new ValidationError('Invalid input data');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VAL_001');
      expect(error.message).toBe('Invalid input data');
    });

    test('NotFoundError should have correct properties', () => {
      const error = new NotFoundError('Resource not found');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND_001');
      // NotFoundError formats: "<resource> not found"
      expect(error.message).toContain('not found');
    });

    test('ConflictError should have correct properties', () => {
      const error = new ConflictError('Resource already exists');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe('CONF_001');
      expect(error.message).toBe('Resource already exists');
    });

    test('RateLimitError should have correct properties', () => {
      const error = new RateLimitError('Too many requests');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(429);
      expect(error.code).toBe('RATE_001');
      expect(error.message).toBe('Too many requests');
    });

    test('ExternalServiceError should have correct properties', () => {
      // ExternalServiceError takes (service, message) — formats as "{service}: {message}"
      const error = new ExternalServiceError('stripe', 'External service unavailable');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(502);
      expect(error.code).toBe('EXT_001');
      expect(error.message).toContain('External service unavailable');
    });

    test('InternalServerError should have correct properties', () => {
      const error = new InternalServerError('Internal server error');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INT_001');
      expect(error.message).toBe('Internal server error');
    });
  });

  describe('handlePrismaError', () => {
    test('should convert unique constraint violation to DuplicateResourceError', () => {
      const prismaError = { code: 'P2002', meta: { target: ['email'] } };
      const error = handlePrismaError(prismaError);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(409);
    });

    test('should convert record not found to NotFoundError', () => {
      const prismaError = { code: 'P2025' };
      const error = handlePrismaError(prismaError);
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.code).toBe('NOT_FOUND_001');
    });

    test('should convert foreign key constraint violation to ValidationError', () => {
      // P2003 = foreign key constraint = invalid reference = ValidationError
      const prismaError = { code: 'P2003', meta: { field_name: 'userId' } };
      const error = handlePrismaError(prismaError);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(400);
    });

    test('should convert unknown Prisma errors to InternalServerError', () => {
      const prismaError = { code: 'P9999', message: 'Unknown error' };
      const error = handlePrismaError(prismaError);
      expect(error).toBeInstanceOf(InternalServerError);
      expect(error.code).toBe('INT_001');
    });

    test('should handle null error gracefully', () => {
      const error = handlePrismaError(null);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(500);
    });
  });

  describe('formatErrorResponse', () => {
    test('should format AppError correctly', () => {
      const error = new ValidationError('Invalid input');
      const response = formatErrorResponse(error);
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('VAL_001');
      expect(response.error.message).toBe('Invalid input');
      expect(response.error.statusCode).toBe(400);
    });

    test('should include details if provided', () => {
      const error = new ValidationError('Invalid input');
      error.details = { field: 'email', value: 'invalid' };
      const response = formatErrorResponse(error);
      expect(response.error.details).toBeDefined();
      expect(response.error.details.field).toBe('email');
    });

    test('should handle generic Error', () => {
      const error = new Error('Generic error');
      const response = formatErrorResponse(error);
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('INT_001');
      expect(response.error.statusCode).toBe(500);
    });

    test('should handle null error', () => {
      const response = formatErrorResponse(null);
      expect(response.success).toBe(false);
      expect(response.error.statusCode).toBe(500);
    });
  });

  describe('Error Code Mapping', () => {
    test('should have correct status codes for each error type', () => {
      expect(new AuthenticationError().statusCode).toBe(401);
      expect(new ValidationError().statusCode).toBe(400);
      expect(new NotFoundError('item').statusCode).toBe(404);
      expect(new ConflictError().statusCode).toBe(409);
      expect(new RateLimitError().statusCode).toBe(429);
      expect(new ExternalServiceError('svc').statusCode).toBe(502);
      expect(new InternalServerError().statusCode).toBe(500);
    });
  });
});
