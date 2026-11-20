/**
 * OpenTelemetry Distributed Tracing
 * 
 * Provides distributed tracing for observability across microservices.
 * 
 * Features:
 * - Automatic HTTP request tracing
 * - Database query tracing
 * - Redis operation tracing
 * - Custom span creation
 * - Export to Jaeger/OTLP
 * 
 * Usage:
 *   const tracing = require('./utils/tracing');
 *   await tracing.initialize();
 *   
 *   // Create custom span
 *   const span = tracing.startSpan('operation-name');
 *   try {
 *     // do work
 *     span.setStatus({ code: SpanStatusCode.OK });
 *   } catch (error) {
 *     span.recordException(error);
 *     span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
 *   } finally {
 *     span.end();
 *   }
 */

const { trace, context, SpanStatusCode } = require('@opentelemetry/api');
const logger = require('./logger');

let isInitialized = false;

/**
 * Initialize OpenTelemetry tracing
 * 
 * Sets up tracing with appropriate exporters based on environment.
 */
async function initialize() {
  if (isInitialized) {
    logger.warn('[tracing] Already initialized');
    return;
  }

  // Skip tracing in test mode when no OTEL endpoint is configured.
  // OTel SDK 2.x removed addSpanProcessor() from NodeTracerProvider; the
  // console-exporter fallback path would crash before isInitialized is set.
  if (process.env.NODE_ENV === 'test' && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT && !process.env.JAEGER_ENDPOINT) {
    logger.info('[tracing] Skipping tracing initialization in test mode (no OTEL endpoint configured)');
    return;
  }

  try {
    const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
    const { resourceFromAttributes } = require('@opentelemetry/resources');
    const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
    const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
    const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
    const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
    const { PrismaInstrumentation } = (() => {
      try { return require('@opentelemetry/instrumentation-prisma'); }
      catch { return { PrismaInstrumentation: function() { return {}; } }; }
    })();
    const { RedisInstrumentation } = (() => {
      try { return require('@opentelemetry/instrumentation-redis'); }
      catch { return { RedisInstrumentation: function() { return {}; } }; }
    })();
    const { registerInstrumentations } = require('@opentelemetry/instrumentation');

    // Create tracer provider
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'halqa-backend',
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
        [SemanticResourceAttributes.HOST_NAME]: require('os').hostname(),
      })
    });

    // Configure exporter based on environment
    if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      // OTLP exporter (Jaeger, Tempo, etc.)
      const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
      const exporter = new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      });
      provider.addSpanProcessor(new BatchSpanProcessor(exporter));
      logger.info('[tracing] Using OTLP exporter');
    } else if (process.env.JAEGER_ENDPOINT) {
      // Jaeger exporter
      const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
      const exporter = new JaegerExporter({
        endpoint: process.env.JAEGER_ENDPOINT,
      });
      provider.addSpanProcessor(new BatchSpanProcessor(exporter));
      logger.info('[tracing] Using Jaeger exporter');
    } else {
      // Console exporter for development
      const { ConsoleSpanExporter } = require('@opentelemetry/sdk-trace-base');
      provider.addSpanProcessor(new BatchSpanProcessor(new ConsoleSpanExporter()));
      logger.info('[tracing] Using console exporter (development)');
    }

    // Register the provider
    provider.register();

    // Register instrumentations
    registerInstrumentations({
      instrumentations: [
        new HttpInstrumentation(),
        new ExpressInstrumentation(),
        new PrismaInstrumentation(),
        new RedisInstrumentation(),
      ],
    });

    isInitialized = true;
    logger.info('[tracing] OpenTelemetry initialized successfully');
  } catch (error) {
    logger.error('[tracing] Failed to initialize:', error);
    // Don't throw - allow app to start without tracing
  }
}

/**
 * Get the current tracer
 */
function getTracer(name = 'halqa-backend') {
  return trace.getTracer(name);
}

/**
 * Start a new span
 */
function startSpan(name, options = {}) {
  const tracer = getTracer();
  return tracer.startSpan(name, options);
}

/**
 * Run a function within a span
 */
async function withSpan(name, fn, options = {}) {
  const span = startSpan(name, options);
  
  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.recordException(error);
    span.setStatus({ 
      code: SpanStatusCode.ERROR, 
      message: error.message 
    });
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Add attributes to current span
 */
function setAttributes(attributes) {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}

/**
 * Add event to current span
 */
function addEvent(name, attributes = {}) {
  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Record exception on current span
 */
function recordException(error) {
  const span = trace.getActiveSpan();
  if (span) {
    span.recordException(error);
  }
}

/**
 * Get current trace ID
 */
function getTraceId() {
  const span = trace.getActiveSpan();
  if (span) {
    return span.spanContext().traceId;
  }
  return null;
}

/**
 * Get current span ID
 */
function getSpanId() {
  const span = trace.getActiveSpan();
  if (span) {
    return span.spanContext().spanId;
  }
  return null;
}

/**
 * Express middleware for tracing
 */
function tracingMiddleware(req, res, next) {
  if (!isInitialized) {
    return next();
  }

  const tracer = getTracer('express');
  const span = tracer.startSpan(`${req.method} ${req.path}`, {
    kind: 1, // SERVER
    attributes: {
      'http.method': req.method,
      'http.url': req.url,
      'http.target': req.path,
      'http.route': req.route?.path || req.path,
      'http.user_agent': req.headers['user-agent'],
      'http.client_ip': req.ip,
      'user.id': req.user?.id,
    }
  });

  // Add trace context to response headers
  const traceId = span.spanContext().traceId;
  const spanId = span.spanContext().spanId;
  res.setHeader('X-Trace-Id', traceId);
  res.setHeader('X-Span-Id', spanId);

  // Intercept response to capture status
  const originalJson = res.json.bind(res);
  res.json = function(body) {
    span.setAttribute('http.status_code', res.statusCode);
    span.setAttribute('http.status_text', res.statusMessage);
    return originalJson(body);
  };

  // End span on response finish
  res.on('finish', () => {
    span.setAttribute('http.status_code', res.statusCode);
    if (res.statusCode >= 400) {
      span.setStatus({ 
        code: SpanStatusCode.ERROR, 
        message: `HTTP ${res.statusCode}` 
      });
    }
    span.end();
  });

  // Also end on error
  res.on('error', (error) => {
    span.recordException(error);
    span.setStatus({ 
      code: SpanStatusCode.ERROR, 
      message: error.message 
    });
    span.end();
  });

  next();
}

/**
 * Prisma middleware for query tracing
 */
function prismaTracingMiddleware() {
  return async (params, next) => {
    if (!isInitialized) {
      return next(params);
    }

    const tracer = getTracer('prisma');
    const span = tracer.startSpan(`prisma.${params.model}.${params.action}`, {
      attributes: {
        'db.system': 'mysql',
        'db.name': process.env.DATABASE_NAME,
        'db.operation': params.action,
        'db.model': params.model,
        'prisma.args': JSON.stringify(params.args || {}),
      }
    });

    const startTime = Date.now();
    
    try {
      const result = await next(params);
      const duration = Date.now() - startTime;
      
      span.setAttribute('db.duration_ms', duration);
      span.setStatus({ code: SpanStatusCode.OK });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      span.setAttribute('db.duration_ms', duration);
      span.recordException(error);
      span.setStatus({ 
        code: SpanStatusCode.ERROR, 
        message: error.message 
      });
      
      throw error;
    } finally {
      span.end();
    }
  };
}

/**
 * Redis operation tracing wrapper
 */
async function traceRedisOperation(operation, fn) {
  if (!isInitialized) {
    return fn();
  }

  const tracer = getTracer('redis');
  const span = tracer.startSpan(`redis.${operation}`, {
    attributes: {
      'db.system': 'redis',
      'redis.operation': operation,
    }
  });

  const startTime = Date.now();
  
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    
    span.setAttribute('db.duration_ms', duration);
    span.setStatus({ code: SpanStatusCode.OK });
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    span.setAttribute('db.duration_ms', duration);
    span.recordException(error);
    span.setStatus({ 
      code: SpanStatusCode.ERROR, 
      message: error.message 
    });
    
    throw error;
  } finally {
    span.end();
  }
}

module.exports = {
  initialize,
  isInitialized: () => isInitialized,
  getTracer,
  startSpan,
  withSpan,
  setAttributes,
  addEvent,
  recordException,
  getTraceId,
  getSpanId,
  middleware: tracingMiddleware,
  prismaMiddleware: prismaTracingMiddleware,
  traceRedis: traceRedisOperation,
  SpanStatusCode
};
