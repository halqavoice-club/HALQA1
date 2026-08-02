/**
 * PaginationDots.tsx  (React Native)
 *
 * Animated page indicator with tap-to-jump support.
 * Hidden when totalPages <= 1.
 *
 * Requirements: 3.7, 3.8, 12.3
 */

import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

export interface PaginationDotsProps {
  totalPages: number;
  currentPage: number;
  onPageSelect: (page: number) => void;
}

function Dot({
  index,
  isActive,
  onPress,
}: {
  index: number;
  isActive: boolean;
  onPress: () => void;
}) {
  const width = useSharedValue(isActive ? 16 : 6);
  const bgColor = useSharedValue(isActive ? 1 : 0); // 1 = active color, 0 = inactive

  React.useEffect(() => {
    width.value = withTiming(isActive ? 16 : 6, { duration: 200 });
  }, [isActive]);

  const animStyle = useAnimatedStyle(() => ({
    width: width.value,
    backgroundColor: isActive ? '#4f46e5' : '#6b7280',
    borderRadius: isActive ? 4 : 3,
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={`Page ${index + 1}`}
      accessibilityHint={`Go to page ${index + 1}`}
      style={styles.dotHitArea}
    >
      <Animated.View style={[styles.dot, animStyle]} />
    </Pressable>
  );
}

export function PaginationDots({
  totalPages,
  currentPage,
  onPageSelect,
}: PaginationDotsProps) {
  if (totalPages <= 1) return null;

  return (
    <View style={styles.container} accessibilityRole="tablist">
      {Array.from({ length: totalPages }, (_, i) => (
        <Dot
          key={i}
          index={i}
          isActive={i === currentPage}
          onPress={() => onPageSelect(i)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
  },
  dotHitArea: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    height: 6,
  },
});
