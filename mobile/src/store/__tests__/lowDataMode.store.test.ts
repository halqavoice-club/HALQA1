/**
 * Tests for the LowDataMode Zustand store.
 *
 * MMKV is auto-mocked via moduleNameMapper in jest.config.js
 * (`react-native-mmkv` → `__mocks__/react-native-mmkv.js`), which provides
 * an in-memory implementation. No additional jest.mock() call is needed.
 */

// Reset Zustand store state between tests so each test starts fresh.
// We re-import the store module after resetting the module registry.
beforeEach(() => {
  jest.resetModules();
});

describe('useLowDataMode — auto mode', () => {
  it('starts with isEnabled=false and userPreference=null', () => {
    const { useLowDataMode } = require('../lowDataMode.store');
    const state = useLowDataMode.getState();
    expect(state.isEnabled).toBe(false);
    expect(state.userPreference).toBeNull();
  });

  it('setAutoEnabled(true) sets isEnabled when userPreference is null', () => {
    const { useLowDataMode } = require('../lowDataMode.store');
    useLowDataMode.getState().setAutoEnabled(true);
    expect(useLowDataMode.getState().isEnabled).toBe(true);
  });

  it('setAutoEnabled(false) clears isEnabled when userPreference is null', () => {
    const { useLowDataMode } = require('../lowDataMode.store');
    useLowDataMode.getState().setAutoEnabled(true);
    useLowDataMode.getState().setAutoEnabled(false);
    expect(useLowDataMode.getState().isEnabled).toBe(false);
  });
});

describe('useLowDataMode — user preference overrides auto', () => {
  it('setAutoEnabled is blocked when userPreference is explicitly true', () => {
    const { useLowDataMode } = require('../lowDataMode.store');
    useLowDataMode.getState().setUserPreference(true);
    // Auto signal says "off" — should be ignored
    useLowDataMode.getState().setAutoEnabled(false);
    expect(useLowDataMode.getState().isEnabled).toBe(true);
  });

  it('setAutoEnabled is blocked when userPreference is explicitly false', () => {
    const { useLowDataMode } = require('../lowDataMode.store');
    useLowDataMode.getState().setUserPreference(false);
    // Auto signal says "on" — should be ignored
    useLowDataMode.getState().setAutoEnabled(true);
    expect(useLowDataMode.getState().isEnabled).toBe(false);
  });

  it('setUserPreference(true) sets isEnabled=true immediately', () => {
    const { useLowDataMode } = require('../lowDataMode.store');
    useLowDataMode.getState().setUserPreference(true);
    const state = useLowDataMode.getState();
    expect(state.userPreference).toBe(true);
    expect(state.isEnabled).toBe(true);
  });

  it('setUserPreference(false) sets isEnabled=false immediately', () => {
    const { useLowDataMode } = require('../lowDataMode.store');
    useLowDataMode.getState().setAutoEnabled(true); // first auto-enable
    useLowDataMode.getState().setUserPreference(false);
    const state = useLowDataMode.getState();
    expect(state.userPreference).toBe(false);
    expect(state.isEnabled).toBe(false);
  });
});

describe('useLowDataMode — reset to auto mode', () => {
  it('setUserPreference(null) resets userPreference to null (auto mode)', () => {
    const { useLowDataMode } = require('../lowDataMode.store');
    useLowDataMode.getState().setUserPreference(true);
    useLowDataMode.getState().setUserPreference(null);
    expect(useLowDataMode.getState().userPreference).toBeNull();
  });

  it('after resetting to null, setAutoEnabled works again', () => {
    const { useLowDataMode } = require('../lowDataMode.store');
    // Lock preference to false
    useLowDataMode.getState().setUserPreference(false);
    // Reset to auto
    useLowDataMode.getState().setUserPreference(null);
    // Now auto signal should work
    useLowDataMode.getState().setAutoEnabled(true);
    expect(useLowDataMode.getState().isEnabled).toBe(true);
  });
});

describe('useLowData selector', () => {
  it('returns isEnabled boolean from the store via getState', () => {
    const { useLowDataMode } = require('../lowDataMode.store');
    // useLowData() is a React hook and cannot be called outside a component.
    // Test the underlying state directly — same source of truth.
    expect(useLowDataMode.getState().isEnabled).toBe(false);
    useLowDataMode.getState().setAutoEnabled(true);
    expect(useLowDataMode.getState().isEnabled).toBe(true);
  });
});
