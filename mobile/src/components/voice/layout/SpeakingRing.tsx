/**
 * SpeakingRing.tsx  (React Native)
 *
 * Animated speaking indicator ring rendered as an absolutely-positioned
 * circular border around a SeatCard — React Native Reanimated 4 (compatible
 * with Reanimated 2 API).
 *
 * State machine (per design doc):
 *   IDLE ──→ SPEAKING ──→ IDLE
 *              │
 *              ↓
 *          PEAK (brief scale burst when audio peaks)
 *
 * Transitions:
 *   IDLE → SPEAKING : opacity withTiming(1, {duration:200}), scale withSpring(1.05)
 *   SPEAKING → IDLE : opacity withTiming(0, {duration:300, easing:Easing.out(Easing.ease)}),
 *                     scale withSpring(1.0)
 *   PEAK            : withSequence(withTiming(1.12,{duration:50}), withTiming(1.05,{duration:50}))
 *
 * All animations run on the UI thread via Reanimated worklets — no JS-bridge calls
 * during the animation loop.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

import React, { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  Easing
} from 'react-native-reanimated';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SpeakingRingProps {
  /** Whether the participant is currently speaking. Controls IDLE↔SPEAKING transitions. */
  isSpeaking: boolean;
  /**
   * Set to `true` briefly when audio peaks — triggers a scale burst (PEAK transition).
   * The parent should toggle this back to `false` after a short interval (e.g. 150ms)
   * so the effect fires on the rising edge only.
   */
  isAudioPeak?: boolean;
  /** Ring border color. Defaults to the design-system speaking green. */
  color?: string;
  /**
   * Explicit diameter in dp. When omitted the ring fills the parent via
   * `top: -3, left: -3, right: -3, bottom: -3` (slightly outside the parent).
   */
  size?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_COLOR = '#10b981';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SpeakingRing = React.memo(function SpeakingRing({
  isSpeaking,
  isAudioPeak = false,
  color = DEFAULT_COLOR,
  size,
}: SpeakingRingProps) {
  // -------------------------------------------------------------------------
  // Shared values (run on UI thread)
  // -------------------------------------------------------------------------

  const opacity = useSharedValue(0);
  const scale = useSharedValue(1);

  // -------------------------------------------------------------------------
  // IDLE ↔ SPEAKING transitions
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (isSpeaking) {
      // IDLE → SPEAKING
      opacity.value = withTiming(1, { duration: 200 });
      scale.value = withSpring(1.05);
    } else {
      // SPEAKING → IDLE
      opacity.value = withTiming(0, {
        duration: 300,
        easing: Easing.out(Easing.ease),
      });
      scale.value = withSpring(1.0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSpeaking]);

  // -------------------------------------------------------------------------
  // PEAK transition
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (isAudioPeak && isSpeaking) {
      // Scale burst: 1.05 → 1.12 → 1.05, each leg 50ms
      scale.value = withSequence(
        withTiming(1.12, { duration: 50 }),
        withTiming(1.05, { duration: 50 }),
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAudioPeak]);

  // -------------------------------------------------------------------------
  // Animated style (worklet — runs on UI thread, no JS bridge)
  // -------------------------------------------------------------------------

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  // -------------------------------------------------------------------------
  // Sizing
  // -------------------------------------------------------------------------

  const positionStyle =
    size !== undefined
      ? ({
          width: size,
          height: size,
        } as const)
      : ({
          top: -3,
          left: -3,
          right: -3,
          bottom: -3,
        } as const);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no"
      style={[
        {
          position: 'absolute',
          ...positionStyle,
          borderRadius: 9999,
          borderWidth: 2,
          borderColor: color,
          pointerEvents: 'none',
        },
        animatedStyle,
      ]}
    />
  );
});

SpeakingRing.displayName = 'SpeakingRing';

