/**
 * Tests for standardized error handling
 */

const {
  AppError,
  AuthenticationError,
  ValidationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ExternalServiceError,
  InternalError,
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
      expect(error.message).toBe('Resource not found');
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
      const error = new ExternalServiceError('External service unavailable');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(502);
      expect(error.code).toBe('EXT_001');
      expect(error.message).toBe('External service unavailable');
    });

    test('InternalError should have correct properties', () => {
      const error = new InternalError('Internal server error');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INT_001');
      expect(error.message).toBe('Internal server error');
    });
  });

  describe('handlePrismaError', () => {
    test('should convert unique constraint violation to ConflictError', () => {
      const prismaError = {
        code: 'P2002',
        meta: { target: ['email'] }
      };

      const error = handlePrismaError(prismaError);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error.code).toBe('CONF_001');
    });

    test('should convert record not found to NotFoundError', () => {
      const prismaError = {
        code: 'P2025'
      };

      const error = handlePrismaError(prismaError);

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.code).toBe('NOT_FOUND_001');
    });

    test('should convert foreign key constraint violation to ConflictError', () => {
      const prismaError = {
        code: 'P2003',
        meta: { field_name: 'userId' }
      };

      const error = handlePrismaError(prismaError);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error.code).toBe('CONF_002');
    });

    test('should convert unknown Prisma errors to InternalError', () => {
      const prismaError = {
        code: 'P9999'
      };

      const error = handlePrismaError(prismaError);

      expect(error).toBeInstanceOf(InternalError);
      expect(error.code).toBe('INT_001');
    });

    test('should handle null error', () => {
      const error = handlePrismaError(null);

      expect(error).toBeInstanceOf(InternalError);
      expect(error.code).toBe('INT_001');
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
      expect(response.error.code).toBe('INT_001');
    });

    test('should include stack trace in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const error = new ValidationError('Invalid input');
      const response = formatErrorResponse(error);

      expect(response.error.stack).toBeDefined();

      process.env.NODE_ENV = originalEnv;
    });

    test('should not include stack trace in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new ValidationError('Invalid input');
      const response = formatErrorResponse(error);

      expect(response.error.stack).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Error Code Mapping', () => {
    test('should have unique error codes', () => {
      const errors = [
        new AuthenticationError(),
        new ValidationError(),
        new NotFoundError(),
        new ConflictError(),
        new RateLimitError(),
        new ExternalServiceError(),
        new InternalError()
      ];

      const codes = errors.map(e => e.code);
      const uniqueCodes = new Set(codes);

      expect(codes.length).toBe(uniqueCodes.size);
    });

    test('should have correct status codes for each error type', () => {
      expect(new AuthenticationError().statusCode).toBe(401);
      expect(new ValidationError().statusCode).toBe(400);
      expect(new NotFoundError().statusCode).toBe(404);
      expect(new ConflictError().statusCode).toBe(409);
      expect(new RateLimitError().statusCode).toBe(429);
      expect(new ExternalServiceError().statusCode).toBe(502);
      expect(new InternalError().statusCode).toBe(500);
    });
  });
});
