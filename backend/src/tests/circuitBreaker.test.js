/**
 * Tests for circuit breaker pattern
 */

const { CircuitBreaker, CircuitBreakerRegistry } = require('../utils/circuitBreaker');

describe('Circuit Breaker Pattern', () => {
  let breaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      service: 'test-service',
      threshold: 3,
      timeout: 1000,
      resetTimeout: 500
    });
  });

  afterEach(() => {
    breaker.reset();
  });

  describe('CircuitBreaker', () => {
    test('should start in CLOSED state', () => {
      const state = breaker.getState();
      expect(state.state).toBe('CLOSED');
      expect(state.failureCount).toBe(0);
    });

    test('should execute function successfully in CLOSED state', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await breaker.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(breaker.getState().state).toBe('CLOSED');
    });

    test('should track failures and open circuit after threshold', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Service error'));

      // Execute failing function 3 times
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(fn);
        } catch (error) {
          // Expected to fail
        }
      }

      // Circuit should be OPEN
      expect(breaker.getState().state).toBe('OPEN');
      expect(breaker.getState().failureCount).toBe(3);
    });

    test('should fail fast when circuit is OPEN', async () => {
      const failFn = jest.fn().mockRejectedValue(new Error('error'));

      // Open the circuit using a separate fail function
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(failFn); } catch (error) {}
      }
      expect(breaker.getState().state).toBe('OPEN');

      // Now test that a NEW function is not called when circuit is OPEN
      const newFn = jest.fn().mockResolvedValue('success');
      await expect(breaker.execute(newFn)).rejects.toThrow('Circuit breaker OPEN');
      expect(newFn).not.toHaveBeenCalled();
    });

    test('should transition to HALF_OPEN after timeout', async () => {
      const failFn = jest.fn().mockRejectedValue(new Error('error'));

      // Open the circuit — 3 failures
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(failFn); } catch (error) {}
      }
      expect(breaker.getState().state).toBe('OPEN');

      // Wait for the timeout (breaker.timeout = 1000ms)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Execute a SUCCESSFUL call — breaker should move to HALF_OPEN first,
      // then onSuccess() will be called. Since threshold=3 and successCount
      // only reaches 1, it stays in HALF_OPEN.
      const successFn = jest.fn().mockResolvedValue('ok');
      await breaker.execute(successFn);

      expect(breaker.getState().state).toBe('HALF_OPEN');
    });

    test('should close circuit after successful execution in HALF_OPEN', async () => {
      const failFn = jest.fn().mockRejectedValue(new Error('error'));
      const successFn = jest.fn().mockResolvedValue('success');

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(failFn);
        } catch (error) {}
      }

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Execute successfully multiple times
      for (let i = 0; i < 3; i++) {
        await breaker.execute(successFn);
      }

      expect(breaker.getState().state).toBe('CLOSED');
    });

    test('should reset to CLOSED state', () => {
      // Force open
      breaker.transitionTo('OPEN');
      expect(breaker.getState().state).toBe('OPEN');

      breaker.reset();
      expect(breaker.getState().state).toBe('CLOSED');
      expect(breaker.getState().failureCount).toBe(0);
    });

    test('should track state changes in metrics', () => {
      const initialState = breaker.getState();
      expect(initialState.metrics.stateChanges).toHaveLength(0);

      breaker.transitionTo('OPEN');
      expect(breaker.getState().metrics.stateChanges).toHaveLength(1);
    });
  });

  describe('CircuitBreakerRegistry', () => {
    let registry;

    beforeEach(() => {
      registry = new CircuitBreakerRegistry();
    });

    test('should create and retrieve circuit breakers', () => {
      const breaker1 = registry.get('service-1');
      const breaker2 = registry.get('service-2');
      const breaker1Again = registry.get('service-1');

      expect(breaker1).toBe(breaker1Again);
      expect(breaker1).not.toBe(breaker2);
    });

    test('should get all circuit breaker states', () => {
      registry.get('service-1');
      registry.get('service-2');

      const states = registry.getAllStates();
      expect(Object.keys(states)).toHaveLength(2);
      expect(states['service-1']).toBeDefined();
      expect(states['service-2']).toBeDefined();
    });

    test('should reset specific circuit breaker', () => {
      const breaker = registry.get('service-1');
      breaker.transitionTo('OPEN');

      registry.reset('service-1');
      expect(breaker.getState().state).toBe('CLOSED');
    });

    test('should reset all circuit breakers', () => {
      const breaker1 = registry.get('service-1');
      const breaker2 = registry.get('service-2');

      breaker1.transitionTo('OPEN');
      breaker2.transitionTo('OPEN');

      registry.resetAll();

      expect(breaker1.getState().state).toBe('CLOSED');
      expect(breaker2.getState().state).toBe('CLOSED');
    });
  });
});
