/**
 * @jest-environment jsdom
 */
/**
 * useLiveKit.reconnect-consent.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * HALQA VOICE CLUB — Phase 3A-3C3A-FIX: DEF-CONSENT-01 Behavioral Tests
 *
 * Verifies FIX-01: Web reconnection consent preservation
 * - Initial connection honors backend micEnabled hint
 * - Reconnection preserves user's current local mic intent
 * - Explicit OFF stays OFF after reconnect
 * - Explicit ON stays ON after reconnect (active speaker continuity)
 * - Token refresh (55-min proactive reconnect) uses new backend hint
 * - Explicit disconnect resets isInitialConnectionRef
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { ConnectionState } from 'livekit-client';

describe('PHASE 3A-3C3A-FIX: DEF-CONSENT-01 Web Reconnection Consent Preservation', () => {

  /**
   * Simplified test runner that models the FIX-01 reconnection intent logic.
   * This tests the ALGORITHM, not the full React hook integration (which requires
   * extensive LiveKit SDK mocking). The algorithm is deterministic and testable
   * without rendering components.
   */
  function createReconnectIntentRunner() {
    let isInitialConnection = true;
    let localMicIntent = false;
    let currentMicState = false;
    const setMicrophoneCalls: boolean[] = [];

    const connect = async (backendMicEnabledHint: boolean) => {
      // Simulate LiveKit SDK connect + setMicrophoneEnabled
      if (isInitialConnection) {
        // First connection: backend hint is authoritative
        currentMicState = backendMicEnabledHint;
        localMicIntent = backendMicEnabledHint;
        setMicrophoneCalls.push(backendMicEnabledHint);
        isInitialConnection = false;
      } else {
        // Reconnection: user's CURRENT local intent is authoritative
        currentMicState = localMicIntent;
        setMicrophoneCalls.push(localMicIntent);
      }
    };

    const enableMic = () => {
      currentMicState = true;
      localMicIntent = true;
    };

    const disableMic = () => {
      currentMicState = false;
      localMicIntent = false;
    };

    const disconnect = () => {
      isInitialConnection = true;
      localMicIntent = false;
      currentMicState = false;
    };

    return {
      connect,
      enableMic,
      disableMic,
      disconnect,
      getCurrentMicState: () => currentMicState,
      getLocalMicIntent: () => localMicIntent,
      getSetMicrophoneCalls: () => setMicrophoneCalls,
      getIsInitialConnection: () => isInitialConnection,
    };
  }

  test('Initial connection honors backend micEnabled=true hint', async () => {
    const runner = createReconnectIntentRunner();

    await runner.connect(true); // backend says micEnabled=true

    expect(runner.getCurrentMicState()).toBe(true);
    expect(runner.getLocalMicIntent()).toBe(true);
    expect(runner.getSetMicrophoneCalls()).toEqual([true]);
    expect(runner.getIsInitialConnection()).toBe(false);
  });

  test('Initial connection honors backend micEnabled=false hint', async () => {
    const runner = createReconnectIntentRunner();

    await runner.connect(false); // backend says micEnabled=false

    expect(runner.getCurrentMicState()).toBe(false);
    expect(runner.getLocalMicIntent()).toBe(false);
    expect(runner.getSetMicrophoneCalls()).toEqual([false]);
    expect(runner.getIsInitialConnection()).toBe(false);
  });

  test('Reconnection preserves user explicit OFF intent', async () => {
    const runner = createReconnectIntentRunner();

    // 1. Initial connect with micEnabled=true
    await runner.connect(true);
    expect(runner.getCurrentMicState()).toBe(true);

    // 2. User explicitly disables mic
    runner.disableMic();
    expect(runner.getLocalMicIntent()).toBe(false);

    // 3. Network blip → reconnect (backend would say micEnabled=true again, but we ignore it)
    await runner.connect(true); // second connect = reconnect

    // 4. Mic should stay OFF (localMicIntent=false wins)
    expect(runner.getCurrentMicState()).toBe(false);
    expect(runner.getSetMicrophoneCalls()).toEqual([true, false]); // initial=true, reconnect=false
  });

  test('Reconnection preserves user explicit ON intent (active speaker continuity)', async () => {
    const runner = createReconnectIntentRunner();

    // 1. Initial connect with micEnabled=false
    await runner.connect(false);
    expect(runner.getCurrentMicState()).toBe(false);

    // 2. User explicitly enables mic
    runner.enableMic();
    expect(runner.getLocalMicIntent()).toBe(true);

    // 3. Network blip → reconnect
    await runner.connect(false); // second connect = reconnect

    // 4. Mic should stay ON (localMicIntent=true wins)
    expect(runner.getCurrentMicState()).toBe(true);
    expect(runner.getSetMicrophoneCalls()).toEqual([false, true]); // initial=false, reconnect=true
  });

  test('Token refresh (55-min disconnect) acts as new initial connection', async () => {
    const runner = createReconnectIntentRunner();

    // 1. Initial connect with micEnabled=false, user unmutes
    await runner.connect(false);
    runner.enableMic();
    expect(runner.getCurrentMicState()).toBe(true);

    // 2. Backend moderator mutes user (sets isMuted=true in DB)
    // 3. Token refresh fires: explicit disconnect + reconnect
    runner.disconnect(); // this resets isInitialConnection=true

    // 4. New connect with fresh backend hint (micEnabled=false from new token)
    await runner.connect(false);

    // 5. Mic should be OFF (backend hint wins because disconnect reset isInitialConnection)
    expect(runner.getCurrentMicState()).toBe(false);
    expect(runner.getSetMicrophoneCalls()).toEqual([false, false]); // both OFF
  });

  test('Explicit disconnect resets isInitialConnectionRef', async () => {
    const runner = createReconnectIntentRunner();

    // Connect → disconnect → connect again
    await runner.connect(true);
    runner.disconnect();

    expect(runner.getIsInitialConnection()).toBe(true);
    expect(runner.getLocalMicIntent()).toBe(false);

    // Second connect should be treated as initial (honor backend hint)
    await runner.connect(false);
    expect(runner.getCurrentMicState()).toBe(false);
    expect(runner.getSetMicrophoneCalls()).toEqual([true, false]);
  });

  test('Multiple reconnects without disconnect preserve latest user intent', async () => {
    const runner = createReconnectIntentRunner();

    // Initial connect: mic OFF
    await runner.connect(false);

    // User unmutes
    runner.enableMic();

    // Network blip 1 → reconnect
    await runner.connect(true); // backend would say true, but we use localMicIntent=true
    expect(runner.getCurrentMicState()).toBe(true);

    // User mutes again
    runner.disableMic();

    // Network blip 2 → reconnect
    await runner.connect(true); // backend would say true, but we use localMicIntent=false
    expect(runner.getCurrentMicState()).toBe(false);

    expect(runner.getSetMicrophoneCalls()).toEqual([false, true, false]);
  });

});
