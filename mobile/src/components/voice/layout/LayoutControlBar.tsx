/**
 * LayoutControlBar.tsx  (React Native)
 *
 * Horizontal ScrollView of pill buttons for selecting layout modes.
 * "Auto" is always the first item.
 *
 * Requirements: 2.1, 2.8, 12.2, 12.3
 */

import React from 'react';
import { ScrollView, Pressable, Text, StyleSheet, View } from 'react-native';
import type { LayoutMode } from '../../../../../src/lib/layout/layoutTypes';

export interface LayoutControlBarProps {
  currentMode: LayoutMode;
  isManual: boolean;
  onSelectMode: (mode: LayoutMode) => void;
  onResetAuto: () => void;
}

const MANUAL_MODES: LayoutMode[] = [
  'grid',
  'focus-host',
  'podcast',
  'classroom',
  'pk',
  'compact',
  'minimal',
];

const MODE_LABELS: Record<LayoutMode, string> = {
  auto: 'Auto',
  grid: 'Grid',
  'focus-host': 'Focus',
  podcast: 'Podcast',
  classroom: 'Class',
  pk: 'PK',
  compact: 'Compact',
  minimal: 'Minimal',
};

export function LayoutControlBar({
  currentMode,
  isManual,
  onSelectMode,
  onResetAuto,
}: LayoutControlBarProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
      accessibilityRole="tablist"
    >
      {/* Auto button — always first */}
      <Pressable
        onPress={onResetAuto}
        accessibilityRole="radio"
        accessibilityState={{ selected: !isManual }}
        accessibilityLabel="Auto layout"
        accessibilityHint="Automatically selects the best layout for the current speaker count"
        style={[styles.pill, !isManual && styles.pillActive]}
      >
        <Text style={[styles.label, !isManual && styles.labelActive]}>
          Auto
        </Text>
      </Pressable>

      {/* Manual mode buttons */}
      {MANUAL_MODES.map((mode) => {
        const isActive = isManual && currentMode === mode;
        return (
          <Pressable
            key={mode}
            onPress={() => onSelectMode(mode)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${MODE_LABELS[mode]} layout`}
            accessibilityHint={`Switch to ${MODE_LABELS[mode]} layout mode`}
            style={[styles.pill, isActive && styles.pillActive]}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {MODE_LABELS[mode]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  pill: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    backgroundColor: '#4f46e5',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9ca3af',
  },
  labelActive: {
    color: '#ffffff',
  },
});
