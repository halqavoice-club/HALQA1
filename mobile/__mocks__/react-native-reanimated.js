/**
 * Jest mock for react-native-reanimated v4
 *
 * Reanimated v4 requires react-native-worklets which is a native module
 * only available via Metro bundler. In Jest (Node.js/JSDOM) we replace the
 * entire package with no-op stubs so tests that import reanimated don't crash.
 *
 * Tests that specifically test animation behaviour should use
 * `jest.mock('react-native-reanimated')` with more targeted stubs.
 */
'use strict';

const React = require('react');

// ─── Shared value ─────────────────────────────────────────────────────────────
function useSharedValue(init) {
  const ref = React.useRef({ value: init });
  return ref.current;
}

// ─── Animated style ───────────────────────────────────────────────────────────
function useAnimatedStyle(fn) {
  return fn();
}

// ─── Animation helpers ────────────────────────────────────────────────────────
const withTiming    = (v) => v;
const withSpring    = (v) => v;
const withSequence  = (...args) => args[args.length - 1];
const withDelay     = (_delay, anim) => anim;
const withRepeat    = (anim) => anim;
const cancelAnimation = () => {};
const runOnJS       = (fn) => fn;
const runOnUI       = (fn) => fn;

// ─── Animated components ──────────────────────────────────────────────────────
const Animated = {
  View:       'View',
  Text:       'Text',
  Image:      'Image',
  ScrollView: 'ScrollView',
  FlatList:   'FlatList',
  createAnimatedComponent: (Component) => Component,
};

// ─── Easing ───────────────────────────────────────────────────────────────────
const Easing = {
  linear:   (t) => t,
  ease:     (t) => t,
  quad:     (t) => t,
  cubic:    (t) => t,
  out:      (fn) => fn,
  in:       (fn) => fn,
  inOut:    (fn) => fn,
  bezier:   () => (t) => t,
};

// ─── Layout animations ────────────────────────────────────────────────────────
const LinearTransition = {
  springify: () => LinearTransition,
  duration:  () => LinearTransition,
};
const FadeIn    = { duration: () => FadeIn, delay: () => FadeIn, springify: () => FadeIn };
const FadeOut   = { duration: () => FadeOut };
const SlideInRight  = { duration: () => SlideInRight };
const SlideOutLeft  = { duration: () => SlideOutLeft };

// ─── Gesture handler stubs ────────────────────────────────────────────────────
function useAnimatedGestureHandler() { return {}; }
function useAnimatedScrollHandler() { return {}; }

// ─── Derived value ────────────────────────────────────────────────────────────
function useDerivedValue(fn) {
  return { value: fn() };
}

// ─── Interpolate ─────────────────────────────────────────────────────────────
function interpolate(value, inputRange, outputRange) {
  return outputRange[0];
}
const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };

module.exports = {
  // Hooks
  useSharedValue,
  useAnimatedStyle,
  useAnimatedGestureHandler,
  useAnimatedScrollHandler,
  useDerivedValue,
  // Animation functions
  withTiming,
  withSpring,
  withSequence,
  withDelay,
  withRepeat,
  cancelAnimation,
  runOnJS,
  runOnUI,
  // Helpers
  interpolate,
  Extrapolation,
  Easing,
  // Components
  Animated,
  default: { Animated },
  // Layout animations
  LinearTransition,
  FadeIn,
  FadeOut,
  SlideInRight,
  SlideOutLeft,
};
