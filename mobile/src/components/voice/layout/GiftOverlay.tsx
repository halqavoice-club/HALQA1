/**
 * GiftOverlay.tsx  (React Native)
 *
 * Floating gift burst animation above the host seat.
 * Uses Reanimated FadeIn/FadeOut + translateY animation.
 *
 * Requirement: 2.6 — Hidden in Minimal mode (showGifts === false)
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  FadeIn,
  FadeOut
} from 'react-native-reanimated';

export interface GiftEvent {
  id: string;
  emoji: string;
  label?: string;
}

export interface GiftOverlayProps {
  giftEvents: GiftEvent[];
  /** False in Minimal mode — renders nothing */
  showGifts?: boolean;
}

function GiftItem({ gift }: { gift: GiftEvent }) {
  const translateY = useSharedValue(0);
  const scale = useSharedValue(0.5);

  useEffect(() => {
    translateY.value = withTiming(-80, { duration: 600 });
    scale.value = withSpring(1.2, { stiffness: 300, damping: 15 });
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(300)}
      style={[styles.giftItem, animStyle]}
      accessible={false}
      importantForAccessibility="no"
    >
      <Text style={styles.emoji}>{gift.emoji}</Text>
      {gift.label && <Text style={styles.label}>{gift.label}</Text>}
    </Animated.View>
  );
}

export function GiftOverlay({ giftEvents, showGifts = true }: GiftOverlayProps) {
  if (!showGifts) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      {giftEvents.map((gift) => (
        <GiftItem key={gift.id} gift={gift} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    zIndex: 10,
    alignItems: 'center',
  },
  giftItem: {
    position: 'absolute',
    alignItems: 'center',
    gap: 2,
  },
  emoji: {
    fontSize: 32,
    lineHeight: 36,
  },
  label: {
    fontSize: 11,
    color: '#e5e7eb',
    fontWeight: '600',
  },
});

