# HALQA Voice Club — Security and Reliability Fix Review

Commit 749f8b6 addresses seven confirmed security and reliability issues across the backend, frontend, and mobile layers: socket cross-room broadcast (B1), LiveKit native integration (B2), OpenTelemetry resource constructor (P1-A), EAS production placeholder (P1-D), `window.confirm()` replacement (P2-A), join/token rate limiting (P2-B), and Redis NX set semantics in leader election (P2-C). The fixes are mostly correct. Two issues warrant attention before this commit is considered fully clean: the new rate limiters are initialized at module-load time against a Redis readiness state that may not yet be settled, and the LiveKit plugin packages added to `package.json` are not installed in `node_modules`, meaning the EAS build will fail until `npm install` is run on the mobile project.

**Watch for:**
- **confirmed** — B2 plugin packages (`@livekit/react-native-expo-plugin`, `@config-plugins/react-native-webrtc`) are listed in `package.json` but absent from `node_modules`. Any EAS build triggered from this commit without running `npm install` first will fail at the Expo config plugin resolution step.
- **confirmed** — Rate limiters (P2-B) are constructed with `createUserRateLimiter()` at module-load time, which snapshots Redis readiness at that instant. If voice.routes.js loads before Redis connects, they permanently fall back to per-process in-memory stores, losing cross-instance enforcement silently.
- **confirmed** — The test mock collapses both `voice:mic_received` (user-scoped) and all room-scoped events onto one shared `toEmit` spy. The test cannot distinguish which channel each event was routed to — it only verifies the event name and payload, not the channel.

**Verdict**: NEEDS_CHANGES

---

## High-level view

**B1 (socket scoping)** is correctly fixed. All six room-broadcast events now use `io.to('voice:${roomId}')` and `voice:mic_received` correctly routes to `io.to('user:${acceptorId}')`. No bare `io.emit` calls remain in `acceptMicOffer`. The 32/32 test suite passes. The test refactor does have a channel-verification gap (see Issues).

**B2 (LiveKit native)** adds the right packages and configuration entries, but neither `@livekit/react-native-expo-plugin` nor `@config-plugins/react-native-webrtc` is present in `node_modules`. The packages are declared in `package.json` and referenced in `app.json plugins`, but `npm install` has not been run. Any EAS build from this worktree will fail at plugin resolution.

**P1-A (tracing)** is correct. `resourceFromAttributes` is exported by the installed `@opentelemetry/resources@2.11.0` and confirmed callable at runtime. The old `Resource` class is not exported by this version at all, so the fix also removes a latent startup crash in production.

**P2-A (AlertDialog)** correctly replaces all three `window.confirm()` / `confirm()` calls. The state machines are well-structured with proper cleanup on cancel. One edge case exists in `UserProfileSheet`: the ban action is called inline inside `onConfirm` without async error handling, so a ban API failure will be swallowed silently with the dialog already closed.

**P2-B (rate limiters)** applies `joinRateLimiter` and `livekitTokenRateLimiter` to the right routes. The underlying `createUserRateLimiter` falls back to in-memory when Redis is not ready at call time. Because both limiters are instantiated at module-load time (top level in routes, before any request), the selection between Redis and in-memory is frozen at startup. In a deployment sequence where Redis starts after the Node process, every instance will silently run per-process in-memory limiters for the full session.

**P2-C (leader election NX)** correctly replaces `setCache(key, value, ttl, 'NX')` — which passed `'NX'` as a JSON-serialized value because `setCache` only accepts three arguments and uses `setex` internally — with `getRedis().set(key, value, 'EX', ttl, 'NX')`. The ioredis NX option is confirmed correct. The `Math.ceil()` on the TTL is a safe improvement. `renewLeadership` still uses `setCache` without NX, which is correct behavior for renewal.

---

<details>
<summary>Issues (5)</summary>

1. **B2 packages not installed** — `@livekit/react-native-expo-plugin` and `@config-plugins/react-native-webrtc` are in `package.json` but absent from `node_modules`. Run `npm install` in `mobile/` and commit the lockfile changes before triggering any EAS build.

2. **Rate limiter Redis selection frozen at startup** — `joinRateLimiter` and `livekitTokenRateLimiter` are constructed at module-load time via `createUserRateLimiter`, which calls `isRedisReady()` immediately and permanently assigns either a Redis or in-memory store. If the module loads before Redis is ready (common during cold start), both limiters silently operate in-memory for the process lifetime. Migrate them to `createCachedUserRateLimiter` (already available in `rateLimiter.user.js`) so backend selection is deferred to the first request.

3. **B1 test: channel routing not verified for `voice:mic_received`** — The mock uses a single `toEmit` spy for the return value of all `io.to(...)` calls, so `expect(io.toEmit).toHaveBeenCalledWith('voice:mic_received', ...)` passes whether the event goes to `user:${acceptorId}` or `voice:${roomId}`. Add a separate spy for the user-channel mock and assert `io.to` was called with the user channel specifically for this event.

4. **Ban action swallows errors in UserProfileSheet** — `onConfirm` in the ban dialog calls `modAction(onBan, ...)()` and immediately calls `setBanDialogOpen(false)`. `modAction` returns an async function, but the result is not awaited in the `onConfirm` callback. If the ban API call throws, the dialog closes, the participant appears banned in the UI, but the backend operation may have failed silently. Await the async action or handle the rejection before closing the dialog.

5. **`registerGlobals()` called before all other imports** — The `registerGlobals()` call is placed before the `import { useEffect }` block. While this is intentional (required by `@livekit/react-native`'s WebRTC shim to run before any React Native module loads), the effect in TypeScript/Metro depends on module evaluation order, which is not explicitly documented in this file. Add a comment explaining why it must precede all other imports, to prevent future contributors from reordering them.

</details>

<details>
<summary>Details</summary>

## B1 — Socket scoping: 7 of 7 emits corrected

All seven `io.emit(...)` calls in `acceptMicOffer` are replaced. Six go to `io.to('voice:${roomId}')`: `voice:mic_passed`, `voice:role_changed` × 2, `voice:mute_changed` × 2, and `voice:stage_state`. One — `voice:mic_received` — routes to `io.to('user:${acceptorId}')`, matching the design comment in the file header ("Tell the new speaker directly"). No bare `io.emit` calls remain anywhere in the file.

The test mock refactor introduces `toEmit` as a shared spy for `io.to(...).emit(...)` and exposes it as `io.toEmit` for assertions. This correctly guards against `io.emit` being called directly:

```js
const toEmit = jest.fn();
const io = { emit: jest.fn(), to: jest.fn().mockReturnValue({ emit: toEmit }), toEmit };
```

The gap: `io.to` is a single mock returning the same object regardless of channel argument. When the test asserts `io.toEmit.toHaveBeenCalledWith('voice:mic_received', ...)`, it verifies the event name and payload but not which channel string was passed to `io.to`. An accidental regression that routes `voice:mic_received` to `voice:${roomId}` instead of `user:${acceptorId}` would still pass all current assertions.

The `expectNoExternalMutation` helper checks only `getIo().emit`, not `getIo().toEmit`. This is correct — mutation guards apply to unexpected `io.emit` calls, not to `io.to(...).emit(...)`, which is the expected pattern. The helper's scope is appropriate.

## B2 — LiveKit plugin packages not installed

`package.json` adds `@livekit/react-native-expo-plugin@^2.0.0` and `@config-plugins/react-native-webrtc@^9.0.0`. Both are referenced in `app.json` under `plugins`. Neither directory exists under `mobile/node_modules/@livekit` (only `react-native`, `react-native-webrtc`, `components-*`, `mutex`, and `protocol` are present) and `mobile/node_modules/@config-plugins` does not exist at all.

Expo config plugins are resolved at build time — `npx expo prebuild` and `eas build` both resolve the `plugins` array. A missing plugin package causes a hard error before any native code is compiled. The build will not succeed from the current state.

The plugin choice is correct for `@livekit/react-native@2.x`: `@livekit/react-native-expo-plugin@^2.0.0` is the companion package for this major version. Using `@config-plugins/react-native-webrtc` alongside it is consistent with the documented setup.

`UIBackgroundModes: ["audio"]` is correctly placed inside `ios.infoPlist`. `registerGlobals()` is placed before all other imports in `_layout.tsx`, which is required so the WebRTC shim patches global objects before React Native's native module bridge initializes.

## P1-A — OpenTelemetry resource constructor

`@opentelemetry/resources@2.11.0` does not export `Resource` as a class — `Object.keys(require('@opentelemetry/resources'))` returns no `Resource` entry. The old code `new Resource({...})` would throw at runtime in production. `resourceFromAttributes` is confirmed exported as a function and accepts the same attribute map, returning a `Resource` instance. The fix closes a production startup crash.

## P2-C — Leader election NX correctness

The original `setCache(leaderLockKey, nodeId, ttl / 1000, 'NX')` passes `'NX'` as the fourth argument to a function that only accepts `(key, value, ttlSeconds)`. The `'NX'` string was silently ignored, so the SETNX semantics were never applied — any node could overwrite an existing lock. The fix uses `getRedis().set(key, value, 'EX', ttl, 'NX')` directly on the ioredis client, which applies both EX (expiry) and NX (set-if-not-exists) atomically. `getRedis()` throws if called before Redis connects, but `acquireLeadership` already guards with `if (!isRedisReady()) return false` before reaching this call.

The `Math.ceil()` on `ttl / 1000` corrects a subtle float-to-int issue: Redis `EX` takes an integer; without ceil, a TTL like 29999ms would truncate to 29 seconds, potentially causing premature lock expiry.

</details>

---

## File map

<details>
<summary>Changed files (12)</summary>

| File | Change |
|---|---|
| `backend/src/controllers/voice-mic.controller.js` | 7 bare `io.emit()` calls replaced with room-scoped and user-scoped channel routing |
| `backend/src/routes/voice.routes.js` | `createUserRateLimiter` imported; `joinRateLimiter` and `livekitTokenRateLimiter` added and applied to join and livekit-token routes |
| `backend/src/tests/voice-p0-mic-pass-sfu.test.js` | Mock refactored to separate `toEmit` spy; `expect(io.emit).not.toHaveBeenCalled()` guards added |
| `backend/src/utils/leaderElection.js` | `setCache(key, val, ttl, 'NX')` replaced with `getRedis().set(key, val, 'EX', ceil(ttl), 'NX')` at both acquisition sites |
| `backend/src/utils/tracing.js` | `new Resource({})` replaced with `resourceFromAttributes({})` |
| `frontend/src/app/(dashboard)/voice-club/page.tsx` | `confirm()` replaced with `AlertDialog`; `archiveDialog` state added |
| `frontend/src/components/voice/VoiceRoomView.tsx` | `window.confirm()` replaced with `AlertDialog`; `seatLockDialog` state added |
| `frontend/src/components/voice/UserProfileSheet.tsx` | `confirm()` replaced with `AlertDialog`; `banDialogOpen` state added |
| `mobile/app.json` | `@livekit/react-native-expo-plugin` and `@config-plugins/react-native-webrtc` added to plugins; `UIBackgroundModes: ["audio"]` added to `ios.infoPlist` |
| `mobile/app/_layout.tsx` | `registerGlobals()` from `@livekit/react-native` added as first executable statement |
| `mobile/eas.json` | `EXPO_PUBLIC_WEB_URL` placeholder replaced with `https://halqa.app` |
| `mobile/package.json` | `@livekit/react-native-expo-plugin` and `@config-plugins/react-native-webrtc` added as dependencies |

Diff: `git show 749f8b6`

</details>
