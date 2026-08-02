'use client'

/**
 * LayoutControlBar.tsx
 *
 * Horizontal scrollable pill bar for selecting layout modes.
 * "Auto" is always the first option.
 *
 * Requirements: 2.1, 2.8, 12.2, 12.3
 */

import React from 'react'
import type { LayoutMode } from '../../../../../src/lib/layout/layoutTypes'

export interface LayoutControlBarProps {
  currentMode: LayoutMode
  isManual: boolean
  onSelectMode: (mode: LayoutMode) => void
  onResetAuto: () => void
}

const MODE_LABELS: Record<LayoutMode | 'auto-reset', string> = {
  auto: 'Auto',
  grid: 'Grid',
  'focus-host': 'Focus',
  podcast: 'Podcast',
  classroom: 'Class',
  pk: 'PK',
  compact: 'Compact',
  minimal: 'Minimal',
  'auto-reset': 'Auto',
}

const MANUAL_MODES: LayoutMode[] = [
  'grid',
  'focus-host',
  'podcast',
  'classroom',
  'pk',
  'compact',
  'minimal',
]

export function LayoutControlBar({
  currentMode,
  isManual,
  onSelectMode,
  onResetAuto,
}: LayoutControlBarProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Layout mode"
      style={{
        display: 'flex',
        flexDirection: 'row',
        overflowX: 'auto',
        gap: 8,
        padding: '8px 12px',
        scrollbarWidth: 'none',
      }}
    >
      {/* Auto button — always first */}
      <button
        type="button"
        role="radio"
        aria-checked={!isManual}
        aria-label="Auto layout"
        onClick={onResetAuto}
        style={{
          minWidth: 44,
          minHeight: 44,
          borderRadius: 20,
          paddingInline: 14,
          paddingBlock: 8,
          border: 'none',
          cursor: 'pointer',
          backgroundColor: !isManual ? '#4f46e5' : '#1a1a2e',
          color: !isManual ? '#ffffff' : '#9ca3af',
          fontWeight: 600,
          fontSize: 13,
          whiteSpace: 'nowrap',
          transition: 'background-color 0.2s, color 0.2s',
        }}
      >
        Auto
      </button>

      {/* Manual mode buttons */}
      {MANUAL_MODES.map((mode) => {
        const isActive = isManual && currentMode === mode
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={`${MODE_LABELS[mode]} layout`}
            onClick={() => onSelectMode(mode)}
            style={{
              minWidth: 44,
              minHeight: 44,
              borderRadius: 20,
              paddingInline: 14,
              paddingBlock: 8,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: isActive ? '#4f46e5' : '#1a1a2e',
              color: isActive ? '#ffffff' : '#9ca3af',
              fontWeight: 600,
              fontSize: 13,
              whiteSpace: 'nowrap',
              transition: 'background-color 0.2s, color 0.2s',
            }}
          >
            {MODE_LABELS[mode]}
          </button>
        )
      })}
    </div>
  )
}
