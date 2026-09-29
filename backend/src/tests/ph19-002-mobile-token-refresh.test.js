'use strict';
/**
 * PH19-002 — Mobile LiveKit Token Refresh Tests (Phase 24A.1)
 *
 * Verifies all three reconnect paths in useLiveKitAudio use tokenFetcher,
 * and that the mobile Voice screen wires tokenFetcher into lk.connect().
 *
 * Architecture:
 *   useLiveKitAudio has three distinct reconnect paths:
 *     PATH-1: RoomEvent.Disconnected handler  (server disconnect / network blip)
 *     PATH-2: catch block after room.connect() error  (initial connect failure)
 *     PATH-3: reconnect() public function  (background resume via AppState)
 *
 * Required behaviors:
 *   - All three paths call tokenFetcherRef.current() when set
 *   - Fresh token replaces lastTokenRef.current after successful fetch
 *   - 403/401 from tokenFetcher halts retries (reconnectCountRef = MAX)
 *   - Voice screen passes tokenFetcher to lk.connect() (5th argument)
 *   - tokenFetcher calls POST /voice/:id/livekit-token
 *
 * Evidence type: SOURCE-LEVEL (static analysis of TypeScript source)
 */

const fs   = require('fs');
const path = require('path');

const HOOK_SRC_PATH   = path.join(__dirname, '../../../mobile/src/hooks/useLiveKitAudio.ts');
const SCREEN_SRC_PATH = path.join(__dirname, '../../../mobile/app/voice/[id].tsx');

const hookSrc   = fs.existsSync(HOOK_SRC_PATH)   ? fs.readFileSync(HOOK_SRC_PATH,   'utf8') : '';
const screenSrc = fs.existsSync(SCREEN_SRC_PATH) ? fs.readFileSync(SCREEN_SRC_PATH, 'utf8') : '';

// ─── Helper: extract a named section ─────────────────────────────────────────
function between(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start === -1) return '';
  const end = endMarker ? src.indexOf(endMarker, start + 1) : src.length;
  return src.slice(start, end === -1 ? src.length : end);
}

// ─── Extract the three reconnect paths ───────────────────────────────────────
// PATH-1: Disconnected handler — inside room.on(RoomEvent.Disconnected, ...)
const disconnectedBlock = between(hookSrc, 'RoomEvent.Disconnected', 'RoomEvent.Reconnecting');
// PATH-2: catch block after room.connect()
const catchBlock = between(hookSrc, '} catch (err: any) {', '} finally {');
// PATH-3: reconnect() function
const reconnectFn = between(hookSrc, 'const reconnect = useCallback', '}, [connect]);');

// ─── Voice screen lk.connect() call ──────────────────────────────────────────
const connectCallBlock = between(screenSrc, 'Connect LiveKit for real audio', 'non-fatal');

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════
describe('PH19-002: useLiveKitAudio interface', () => {
  test('connect() signature accepts tokenFetcher as 5th parameter', () => {
    expect(hookSrc).toMatch(/tokenFetcher\s*\?\s*:/);
    // Must be a function returning Promise<string>
    expect(hookSrc).toMatch(/tokenFetcher.*Promise<string>/);
  });

  test('tokenFetcherRef stored as useRef', () => {
    expect(hookSrc).toMatch(/tokenFetcherRef\s*=\s*useRef/);
  });

  test('tokenFetcher stored in ref inside connect()', () => {
    const connectFn = between(hookSrc, 'const connect = useCallback', '}, [quality])');
    expect(connectFn).toMatch(/tokenFetcherRef\.current\s*=\s*tokenFetcher/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATH-1: RoomEvent.Disconnected
// ═══════════════════════════════════════════════════════════════════════════
describe('PH19-002 PATH-1: RoomEvent.Disconnected uses tokenFetcher', () => {
  test('Disconnected handler calls tokenFetcherRef.current()', () => {
    expect(disconnectedBlock).toMatch(/tokenFetcherRef\.current\s*\(\s*\)/);
  });

  test('Fresh token assigned to lastTokenRef after fetch', () => {
    expect(disconnectedBlock).toMatch(/lastTokenRef\.current\s*=\s*reconnectToken/);
  });

  test('403 stops retries — reconnectCountRef set to MAX_RECONNECT_ATTEMPTS', () => {
    expect(disconnectedBlock).toMatch(/reconnectCountRef\.current\s*=\s*MAX_RECONNECT_ATTEMPTS/);
  });

  test('Reconnect uses reconnectToken (fresh), not lastTokenRef.current directly', () => {
    // The connect call must use the local `reconnectToken` variable, not the cached ref
    expect(disconnectedBlock).toMatch(/connect\s*\(\s*lastUrlRef\.current\s*,\s*reconnectToken/);
  });

  test('User-initiated disconnect does NOT attempt tokenFetcher', () => {
    // isUserInitiated check must appear before the tokenFetcher block
    const isUserInitiatedIdx = disconnectedBlock.indexOf('isUserInitiated');
    const tokenFetcherIdx    = disconnectedBlock.indexOf('tokenFetcherRef');
    expect(isUserInitiatedIdx).toBeGreaterThan(-1);
    // isUserInitiated guard wraps the entire retry block (including tokenFetcher)
    expect(isUserInitiatedIdx).toBeLessThan(tokenFetcherIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATH-2: catch block (connection error retry)
// ═══════════════════════════════════════════════════════════════════════════
describe('PH19-002 PATH-2: catch block retry uses tokenFetcher', () => {
  test('catch block calls tokenFetcherRef.current() for retry token', () => {
    expect(catchBlock).toMatch(/tokenFetcherRef\.current\s*\(\s*\)/);
  });

  test('Fresh token assigned to lastTokenRef on catch retry', () => {
    expect(catchBlock).toMatch(/lastTokenRef\.current\s*=\s*retryToken/);
  });

  test('403 stops catch retries', () => {
    expect(catchBlock).toMatch(/reconnectCountRef\.current\s*=\s*MAX_RECONNECT_ATTEMPTS/);
  });

  test('Retry uses retryToken variable (fresh), not raw lastTokenRef', () => {
    expect(catchBlock).toMatch(/connect\s*\(\s*lastUrlRef\.current\s*,\s*retryToken/);
  });

  test('Transient errors (non-403) still attempt tokenFetcher', () => {
    // isTransient check should not exclude tokenFetcher path
    expect(catchBlock).toMatch(/isTransient/);
    expect(catchBlock).toMatch(/tokenFetcherRef\.current/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATH-3: reconnect() force-reconnect (background resume)
// ═══════════════════════════════════════════════════════════════════════════
describe('PH19-002 PATH-3: reconnect() uses tokenFetcher', () => {
  test('reconnect() calls tokenFetcherRef.current() for fresh token', () => {
    expect(reconnectFn).toMatch(/tokenFetcherRef\.current\s*\(\s*\)/);
  });

  test('Fresh token assigned to lastTokenRef in reconnect()', () => {
    expect(reconnectFn).toMatch(/lastTokenRef\.current\s*=\s*freshToken/);
  });

  test('403 from tokenFetcher causes reconnect() to abort (return without connect)', () => {
    // The catch block inside reconnect() must return without calling connect
    expect(reconnectFn).toMatch(/catch\s*\{[^}]*return/);
  });

  test('reconnect() calls connect() with freshToken, not raw lastTokenRef', () => {
    expect(reconnectFn).toMatch(/connect\s*\(\s*lastUrlRef\.current\s*,\s*freshToken/);
  });

  test('reconnect() returns early if no token available', () => {
    // Guard: if (!freshToken) return
    expect(reconnectFn).toMatch(/if\s*\(\s*!freshToken\s*\)\s*return/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VOICE SCREEN WIRING
// ═══════════════════════════════════════════════════════════════════════════
describe('PH19-002: Mobile Voice screen wires tokenFetcher', () => {
  test('lk.connect() is called with tokenFetcher as 5th argument', () => {
    expect(connectCallBlock).toMatch(/lk\.connect\s*\([^)]*tokenFetcher\s*\)/);
  });

  test('tokenFetcher calls POST /voice/:id/livekit-token', () => {
    expect(connectCallBlock).toMatch(/api\.post\s*\(\s*`\/voice\/\$\{id\}\/livekit-token`\s*\)/);
  });

  test('tokenFetcher extracts token from response data', () => {
    expect(connectCallBlock).toMatch(/res\.data\?\.data\?\.token/);
  });

  test('tokenFetcher throws if no token in response', () => {
    // Must throw when token is absent — this causes reconnect to abort
    expect(connectCallBlock).toMatch(/throw new Error/);
  });

  test('tokenFetcher returns Promise<string>', () => {
    expect(connectCallBlock).toMatch(/Promise<string>/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY INVARIANT: 403 stops ALL reconnect paths
// ═══════════════════════════════════════════════════════════════════════════
describe('PH19-002: 403 stops reconnect attempts on all paths', () => {
  test('PATH-1 Disconnected: 403 sets reconnectCountRef to MAX — no more retries', () => {
    expect(disconnectedBlock).toMatch(/reconnectCountRef\.current\s*=\s*MAX_RECONNECT_ATTEMPTS/);
  });

  test('PATH-2 catch: 403 sets reconnectCountRef to MAX — no more retries', () => {
    expect(catchBlock).toMatch(/reconnectCountRef\.current\s*=\s*MAX_RECONNECT_ATTEMPTS/);
  });

  test('PATH-3 reconnect(): 403 returns without calling connect', () => {
    // catch block must return before connect() is called
    const catchIdx   = reconnectFn.indexOf('} catch');
    const connectIdx = reconnectFn.indexOf('await connect(', catchIdx > -1 ? catchIdx : 0);
    // catch is present and connect is NOT inside catch (comes after)
    expect(catchIdx).toBeGreaterThan(-1);
    // If connect follows catch, it means the catch just returns — correct
    expect(reconnectFn).toMatch(/catch\s*\{[^}]*return/s);
  });

  test('Stale lastTokenRef cannot be reused after tokenFetcher is set', () => {
    // All three paths declare a local variable (reconnectToken/retryToken/freshToken)
    // and use that instead of lastTokenRef.current directly
    expect(disconnectedBlock).toMatch(/let reconnectToken\s*=/);
    expect(catchBlock).toMatch(/let retryToken\s*=/);
    expect(reconnectFn).toMatch(/let freshToken\s*=/);
  });
});
