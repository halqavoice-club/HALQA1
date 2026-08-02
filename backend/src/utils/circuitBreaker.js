/**
 * Circuit Breaker Pattern Implementation
 * 
 * Prevents cascading failures by failing fast when a service is experiencing issues.
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is down, requests fail immediately
 * - HALF_OPEN: Testing if service has recovered
 * 
 * Usage:
 *   const breaker = new CircuitBreaker({
 *     service: 'external-api',
 *     threshold: 5,        // failures before opening
 *     timeout: 60000,      // time before attempting recovery
 *     resetTimeout: 30000  // time in HALF_OPEN state
 *   });
 *   
 *   const result = await breaker.execute(() => externalApiCall());
 */

const logger = require('./logger');

class CircuitBreaker {
  constructor(options = {}) {
    this.serviceName = options.service || 'unknown';
    this.threshold = options.threshold || 5;
    this.timeout = options.timeout || 60000;
    this.resetTimeout = options.resetTimeout || 30000;
    
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
    
    this.metrics = {
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      stateChanges: []
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute(fn) {
    this.metrics.totalRequests++;

    // Check if circuit is open
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        // Try to transition to HALF_OPEN
        this.transitionTo('HALF_OPEN');
      } else {
        // Circuit is still open, fail fast
        throw new Error(`Circuit breaker OPEN for ${this.serviceName}`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  onSuccess() {
    this.failureCount = 0;
    this.metrics.totalSuccesses++;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.threshold) {
        this.transitionTo('CLOSED');
      }
    }
  }

  /**
   * Handle failed execution
   */
  onFailure(error) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.metrics.totalFailures++;

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
    } else if (this.failureCount >= this.threshold) {
      this.transitionTo('OPEN');
    }
  }

  /**
   * Transition to a new state
   */
  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.successCount = 0;

    this.metrics.stateChanges.push({
      from: oldState,
      to: newState,
      timestamp: new Date().toISOString()
    });

    logger.info(`[CircuitBreaker] ${this.serviceName}: ${oldState} -> ${newState}`);

    // Emit Prometheus metric for state change
    try {
      const prom = require('./prometheus');
      prom.circuitBreakerStateChanges.inc({
        service: this.serviceName,
        from_state: oldState,
        to_state: newState
      });
    } catch {} // prom not available yet during module load

    // Send alert on state changes
    if (newState === 'OPEN' || newState === 'HALF_OPEN') {
      try {
        const { alertCircuitBreaker } = require('./alerting');
        alertCircuitBreaker(this.serviceName, newState, {
          failureCount: this.failureCount,
          lastFailureTime: this.lastFailureTime
        }).catch(() => {});
      } catch {} // alerting not available
    }
  }

  /**
   * Get current state and metrics
   */
  getState() {
    return {
      service: this.serviceName,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      metrics: this.metrics
    };
  }

  /**
   * Reset circuit breaker to CLOSED state
   */
  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
    logger.info(`[CircuitBreaker] ${this.serviceName}: Reset to CLOSED`);
  }
}

/**
 * Circuit Breaker Registry
 * 
 * Manages multiple circuit breakers for different services.
 */
class CircuitBreakerRegistry {
  constructor() {
    this.breakers = new Map();
  }

  /**
   * Get or create a circuit breaker for a service
   */
  get(serviceName, options = {}) {
    if (!this.breakers.has(serviceName)) {
      this.breakers.set(serviceName, new CircuitBreaker({
        service: serviceName,
        ...options
      }));
    }
    return this.breakers.get(serviceName);
  }

  /**
   * Get state of all circuit breakers
   */
  getAllStates() {
    const states = {};
    this.breakers.forEach((breaker, name) => {
      states[name] = breaker.getState();
    });
    return states;
  }

  /**
   * Reset a specific circuit breaker
   */
  reset(serviceName) {
    const breaker = this.breakers.get(serviceName);
    if (breaker) {
      breaker.reset();
    }
  }

  /**
   * Reset all circuit breakers
   */
  resetAll() {
    this.breakers.forEach((breaker) => breaker.reset());
  }
}

// Global registry instance
const registry = new CircuitBreakerRegistry();

/**
 * Circuit breaker middleware for Express routes
 * 
 * Wraps route handlers with circuit breaker protection.
 * 
 * Usage:
 *   router.get('/external-api', circuitBreaker('external-api'), handler);
 */
function circuitBreakerMiddleware(serviceName, options = {}) {
  const breaker = registry.get(serviceName, options);

  return async (req, res, next) => {
    try {
      // Execute the next handler with circuit breaker
      await breaker.execute(async () => {
        return new Promise((resolve, reject) => {
          const originalJson = res.json.bind(res);
          const originalEnd = res.end.bind(res);

          let responseData = null;

          res.json = function(data) {
            responseData = data;
            return originalJson(data);
          };

          res.end = function(...args) {
            if (responseData) {
              resolve(responseData);
            } else {
              resolve();
            }
            return originalEnd(...args);
          };

          next();
        });
      });

      // Add circuit breaker headers
      res.setHeader('X-Circuit-Breaker-State', breaker.state);
    } catch (error) {
      if (error.message.includes('Circuit breaker OPEN')) {
        return res.status(503).json({
          success: false,
          error: {
            code: 'EXT_008',
            message: 'Service temporarily unavailable',
            statusCode: 503,
            details: {
              service: serviceName,
              circuitState: 'OPEN'
            }
          }
        });
      }
      next(error);
    }
  };
}

/**
 * Pre-configured circuit breakers for common services
 */

// Database circuit breaker
const dbBreaker = registry.get('database', {
  threshold: 3,
  timeout: 30000,
  resetTimeout: 10000
});

// Redis circuit breaker
const redisBreaker = registry.get('redis', {
  threshold: 5,
  timeout: 20000,
  resetTimeout: 5000
});

// External API circuit breaker
const externalApiBreaker = registry.get('external-api', {
  threshold: 5,
  timeout: 60000,
  resetTimeout: 30000
});

// Email service circuit breaker
const emailBreaker = registry.get('email', {
  threshold: 3,
  timeout: 120000,
  resetTimeout: 60000
});

// SMS service circuit breaker
const smsBreaker = registry.get('sms', {
  threshold: 3,
  timeout: 120000,
  resetTimeout: 60000
});

// Storage service circuit breaker
const storageBreaker = registry.get('storage', {
  threshold: 3,
  timeout: 60000,
  resetTimeout: 30000
});

// Payment service circuit breaker
const paymentBreaker = registry.get('payment', {
  threshold: 2,
  timeout: 120000,
  resetTimeout: 60000
});

/**
 * Health check endpoint for circuit breakers
 */
function getCircuitBreakerHealth(req, res) {
  const states = registry.getAllStates();
  
  const openBreakers = Object.values(states).filter(s => s.state === 'OPEN');
  const halfOpenBreakers = Object.values(states).filter(s => s.state === 'HALF_OPEN');
  
  const healthStatus = openBreakers.length > 0 ? 'degraded' : 'healthy';

  return res.json({
    success: true,
    data: {
      status: healthStatus,
      openBreakers: openBreakers.map(b => b.service),
      halfOpenBreakers: halfOpenBreakers.map(b => b.service),
      breakers: states
    }
  });
}

module.exports = {
  CircuitBreaker,
  CircuitBreakerRegistry,
  registry,
  middleware: circuitBreakerMiddleware,
  getCircuitBreakerHealth,
  // Pre-configured breakers
  dbBreaker,
  redisBreaker,
  externalApiBreaker,
  emailBreaker,
  smsBreaker,
  storageBreaker,
  paymentBreaker
};
