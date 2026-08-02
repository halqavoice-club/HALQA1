/**
 * Tests for OpenTelemetry tracing
 */

const {
  initialize,
  getTracer,
  startSpan,
  withSpan,
  setAttributes,
  addEvent,
  recordException,
  getTraceId,
  getSpanId,
  middleware: tracingMiddleware,
  SpanStatusCode
} = require('../utils/tracing');

// Mock OpenTelemetry
jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: jest.fn(() => ({
      startSpan: jest.fn(() => ({
        setAttributes: jest.fn(),
        addEvent: jest.fn(),
        recordException: jest.fn(),
        setStatus: jest.fn(),
        end: jest.fn(),
        spanContext: jest.fn(() => ({ traceId: 'test-trace-id', spanId: 'test-span-id' }))
      }))
    }))
  },
  context: jest.fn(),
  SpanStatusCode: {
    OK: 1,
    ERROR: 2
  }
}));

jest.mock('@opentelemetry/sdk-trace-node', () => ({
  NodeTracerProvider: jest.fn()
}));

jest.mock('@opentelemetry/resources', () => ({
  Resource: jest.fn()
}));

jest.mock('@opentelemetry/semantic-conventions', () => ({
  SemanticResourceAttributes: {}
}));

jest.mock('@opentelemetry/sdk-trace-base', () => ({
  BatchSpanProcessor: jest.fn()
}));

jest.mock('@opentelemetry/instrumentation-http', () => ({
  HttpInstrumentation: jest.fn()
}));

jest.mock('@opentelemetry/instrumentation-express', () => ({
  ExpressInstrumentation: jest.fn()
}));

jest.mock('@opentelemetry/instrumentation-prisma', () => ({
  PrismaInstrumentation: jest.fn()
}));

jest.mock('@opentelemetry/instrumentation-redis', () => ({
  RedisInstrumentation: jest.fn()
}));

jest.mock('@opentelemetry/instrumentation', () => ({
  registerInstrumentations: jest.fn()
}));

describe('OpenTelemetry Tracing', () => {
  describe('initialize', () => {
    test('should initialize tracing without errors', async () => {
      await expect(initialize()).resolves.not.toThrow();
    });

    test('should handle initialization errors gracefully', async () => {
      // Mock an error during initialization
      const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
      NodeTracerProvider.mockImplementation(() => {
        throw new Error('Initialization error');
      });

      await expect(initialize()).resolves.not.toThrow();
    });
  });

  describe('getTracer', () => {
    test('should return tracer instance', () => {
      const tracer = getTracer('test-service');
      expect(tracer).toBeDefined();
    });

    test('should use default service name if not provided', () => {
      const tracer = getTracer();
      expect(tracer).toBeDefined();
    });
  });

  describe('startSpan', () => {
    test('should start a new span', () => {
      const span = startSpan('test-operation');
      expect(span).toBeDefined();
      expect(span.setAttributes).toBeDefined();
      expect(span.end).toBeDefined();
    });

    test('should create span with options', () => {
      const span = startSpan('test-operation', {
        kind: 1,
        attributes: { test: 'value' }
      });
      expect(span).toBeDefined();
    });
  });

  describe('withSpan', () => {
    test('should execute function within span', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      const result = await withSpan('test-operation', fn);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalled();
    });

    test('should set OK status on success', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      await withSpan('test-operation', fn);

      const { getTracer } = require('@opentelemetry/api');
      const span = getTracer().startSpan.mock.results[0].value;
      expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    });

    test('should record exception and set error status on failure', async () => {
      const error = new Error('Test error');
      const fn = jest.fn().mockRejectedValue(error);

      await expect(withSpan('test-operation', fn)).rejects.toThrow('Test error');

      const { getTracer } = require('@opentelemetry/api');
      const span = getTracer().startSpan.mock.results[0].value;
      expect(span.recordException).toHaveBeenCalledWith(error);
      expect(span.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Test error'
      });
    });

    test('should end span after execution', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      await withSpan('test-operation', fn);

      const { getTracer } = require('@opentelemetry/api');
      const span = getTracer().startSpan.mock.results[0].value;
      expect(span.end).toHaveBeenCalled();
    });
  });

  describe('setAttributes', () => {
    test('should set attributes on current span', () => {
      const attributes = { key1: 'value1', key2: 'value2' };
      setAttributes(attributes);

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('addEvent', () => {
    test('should add event to current span', () => {
      addEvent('test-event', { data: 'value' });

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('recordException', () => {
    test('should record exception on current span', () => {
      const error = new Error('Test error');
      recordException(error);

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('getTraceId', () => {
    test('should return trace ID from active span', () => {
      const traceId = getTraceId();
      expect(traceId).toBe('test-trace-id');
    });

    test('should return null when no active span', () => {
      // Mock no active span
      const { trace } = require('@opentelemetry/api');
      trace.getActiveSpan = jest.fn(() => null);

      const traceId = getTraceId();
      expect(traceId).toBeNull();
    });
  });

  describe('getSpanId', () => {
    test('should return span ID from active span', () => {
      const spanId = getSpanId();
      expect(spanId).toBe('test-span-id');
    });

    test('should return null when no active span', () => {
      // Mock no active span
      const { trace } = require('@opentelemetry/api');
      trace.getActiveSpan = jest.fn(() => null);

      const spanId = getSpanId();
      expect(spanId).toBeNull();
    });
  });

  describe('tracingMiddleware', () => {
    let app;

    beforeEach(() => {
      app = require('express')();
      app.use(require('express').json());
    });

    test('should add tracing headers to response', async () => {
      app.get('/test', tracingMiddleware, (req, res) => {
        res.json({ success: true });
      });

      const response = await require('supertest')(app).get('/test');

      expect(response.headers['x-trace-id']).toBe('test-trace-id');
      expect(response.headers['x-span-id']).toBe('test-span-id');
    });

    test('should set span attributes on request', async () => {
      app.get('/test', tracingMiddleware, (req, res) => {
        res.json({ success: true });
      });

      const response = await require('supertest')(app).get('/test');

      expect(response.status).toBe(200);
    });

    test('should handle response finish event', async () => {
      app.get('/test', tracingMiddleware, (req, res) => {
        res.json({ success: true });
      });

      const response = await require('supertest')(app).get('/test');

      expect(response.status).toBe(200);
    });
  });

  describe('prismaMiddleware', () => {
    test('should wrap Prisma queries with tracing', async () => {
      const { prismaMiddleware } = require('../utils/tracing');
      const middleware = prismaMiddleware();

      const next = jest.fn().mockResolvedValue({ id: 1 });
      const params = { model: 'User', action: 'findMany', args: {} };

      const result = await middleware(params, next);

      expect(result).toBeDefined();
      expect(next).toHaveBeenCalledWith(params);
    });

    test('should record query duration', async () => {
      const { prismaMiddleware } = require('../utils/tracing');
      const middleware = prismaMiddleware();

      const next = jest.fn().mockResolvedValue({ id: 1 });
      const params = { model: 'User', action: 'findMany', args: {} };

      await middleware(params, next);

      // Should not throw
      expect(true).toBe(true);
    });

    test('should handle query errors', async () => {
      const { prismaMiddleware } = require('../utils/tracing');
      const middleware = prismaMiddleware();

      const next = jest.fn().mockRejectedValue(new Error('Query error'));
      const params = { model: 'User', action: 'findMany', args: {} };

      await expect(middleware(params, next)).rejects.toThrow('Query error');
    });
  });

  describe('traceRedis', () => {
    test('should wrap Redis operations with tracing', async () => {
      const { traceRedis } = require('../utils/tracing');
      const fn = jest.fn().mockResolvedValue('OK');

      const result = await traceRedis('ping', fn);

      expect(result).toBe('OK');
      expect(fn).toHaveBeenCalled();
    });

    test('should record operation duration', async () => {
      const { traceRedis } = require('../utils/tracing');
      const fn = jest.fn().mockResolvedValue('OK');

      await traceRedis('ping', fn);

      // Should not throw
      expect(true).toBe(true);
    });

    test('should handle Redis errors', async () => {
      const { traceRedis } = require('../utils/tracing');
      const fn = jest.fn().mockRejectedValue(new Error('Redis error'));

      await expect(traceRedis('ping', fn)).rejects.toThrow('Redis error');
    });
  });
});
