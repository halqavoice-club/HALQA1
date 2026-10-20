'use client'

/**
 * SpeakerGrid.tsx  (web)
 *
 * Top-level orchestrator component for the Dynamic Speaker Layout System.
 * Reads layout state from `useDynamicLayoutStore`, wires the `useDynamicLayout`
 * hook for LiveKit/Socket.IO integration, and renders all child layout components.
 *
 * Features:
 * - Automatic vs. manual layout modes via LayoutControlBar
 * - Paginated seat area with swipe-left/right pointer events
 * - PaginationDots shown when totalPages > 1
 * - GiftOverlay floating above host seat
 * - react-window FixedSizeGrid when total speakers > 32
 * - Framer Motion AnimatePresence + layout prop for position transitions
 * - PK mode: two equal-width columns with animated VS badge + glow
 * - Reconnect banner when any speaker has isOnline === false
 * - will-change: transform on animated elements for GPU promotion
 *
 * Requirements: 3.5–3.8, 5.5, 5.7, 6.4–6.7, 8.2, 8.4
 */

import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FixedSizeGrid, type GridChildComponentProps } from 'react-window'

import { useDynamicLayoutStore } from './useDynamicLayoutStore'
import { useDynamicLayout } from './useDynamicLayout'
import { LayoutControlBar } from './LayoutControlBar'
import { PaginationDots } from './PaginationDots'
import { GiftOverlay, type GiftEvent } from './GiftOverlay'
import { SeatCard } from './SeatCard'
import type { SeatData, LayoutMode } from '@/lib/layout/layoutTypes'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum seat card dimension (px). Ensures 44×44 WCAG touch target. */
const MIN_SEAT_SIZE = 44
/** Gap between seats in the grid (px). */
const SEAT_GAP = 8
/** Speaker count threshold above which react-window virtual grid is activated. */
const VIRTUAL_GRID_THRESHOLD = 32
/** Minimum horizontal swipe distance (px) to trigger page change. */
const SWIPE_THRESHOLD = 40

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SpeakerGridProps {
  roomId: string
  isHost: boolean
  currentUserId: string
  theme?: 'dark' | 'light' | 'oled'
  className?: string
}

// ---------------------------------------------------------------------------
// Theme helpers
// ---------------------------------------------------------------------------

interface ThemeColors {
  bg: string
  card: string
  cardBorder: string
  primary: string
  accent: string
  text: string
  reconnect: string
  vsBg: string
  vsGlow: string
}

function getThemeColors(theme: 'dark' | 'light' | 'oled' = 'dark'): ThemeColors {
  if (theme === 'light') {
    return {
      bg: '#f3f4f6',
      card: '#ffffff',
      cardBorder: '#d1d5db',
      primary: '#4f46e5',
      accent: '#a5b4fc',
      text: '#111827',
      reconnect: '#fef3c7',
      vsBg: 'rgba(79,70,229,0.12)',
      vsGlow: '#4f46e5',
    }
  }
  if (theme === 'oled') {
    return {
      bg: '#000000',
      card: '#0a0a0a',
      cardBorder: '#1a1a1a',
      primary: '#4f46e5',
      accent: '#a5b4fc',
      text: '#f9fafb',
      reconnect: '#451a03',
      vsBg: 'rgba(79,70,229,0.08)',
      vsGlow: '#4f46e5',
    }
  }
  // dark (default)
  return {
    bg: '#0f0f23',
    card: '#1a1a2e',
    cardBorder: '#2d2d4e',
    primary: '#4f46e5',
    accent: '#a5b4fc',
    text: '#e5e7eb',
    reconnect: '#78350f',
    vsBg: 'rgba(79,70,229,0.15)',
    vsGlow: '#4f46e5',
  }
}

// ---------------------------------------------------------------------------
// Helper: compute seat pixel dimensions given container size and grid definition
// ---------------------------------------------------------------------------

function computeSeatSize(
  containerWidth: number,
  columns: number,
): number {
  const totalGap = SEAT_GAP * (columns + 1)
  const available = containerWidth - totalGap
  return Math.max(MIN_SEAT_SIZE, Math.floor(available / columns))
}

// ---------------------------------------------------------------------------
// VirtualCell — cell renderer for react-window FixedSizeGrid
// ---------------------------------------------------------------------------

interface VirtualCellData {
  seats: SeatData[]
  columns: number
  cellSize: number
  isCurrentUser: (userId: string) => boolean
  isHost: boolean
  layoutMode: LayoutMode
  onPress: (seat: SeatData) => void
  onLongPress: (seat: SeatData) => void
}

function VirtualCell({ columnIndex, rowIndex, style, data }: GridChildComponentProps<VirtualCellData>) {
  const { seats, columns, cellSize, isCurrentUser, isHost, layoutMode, onPress, onLongPress } = data
  const index = rowIndex * columns + columnIndex
  if (index >= seats.length) return null
  const seat = seats[index]

  return (
    <div style={{ ...style, padding: SEAT_GAP / 2, boxSizing: 'border-box' }}>
      <SeatCard
        seat={seat}
        size={{ width: cellSize - SEAT_GAP, height: cellSize - SEAT_GAP }}
        isSpeaking={seat.isSpeaking}
        isMuted={seat.isMuted}
        isCurrentUser={isCurrentUser(seat.userId)}
        isHost={isHost}
        layoutMode={layoutMode}
        onPress={onPress}
        onLongPress={onLongPress}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReconnectBanner
// ---------------------------------------------------------------------------

function ReconnectBanner({ colors }: { colors: ThemeColors }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      role="alert"
      aria-live="assertive"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        backgroundColor: colors.reconnect,
        color: '#fbbf24',
        fontSize: 13,
        fontWeight: 600,
        borderBottom: '1px solid #92400e',
        willChange: 'transform',
      }}
    >
      <span aria-hidden="true">⚠️</span>
      <span>Reconnecting to the room…</span>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// VS Badge (PK mode)
// ---------------------------------------------------------------------------

function VSBadge({ primary }: { primary: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      aria-hidden="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        flexShrink: 0,
        willChange: 'transform',
      }}
    >
      <motion.div
        animate={{
          boxShadow: [
            `0 0 8px 2px ${primary}66`,
            `0 0 20px 6px ${primary}aa`,
            `0 0 8px 2px ${primary}66`,
          ],
        }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          backgroundColor: primary,
          borderRadius: 8,
          padding: '4px 8px',
          color: '#ffffff',
          fontWeight: 900,
          fontSize: 14,
          letterSpacing: 1,
          willChange: 'transform',
        }}
      >
        VS
      </motion.div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// SpeakerGrid
// ---------------------------------------------------------------------------

export function SpeakerGrid({
  roomId,
  isHost,
  currentUserId,
  theme = 'dark',
  className,
}: SpeakerGridProps) {
  const colors = getThemeColors(theme)

  // -------------------------------------------------------------------------
  // Zustand store + LiveKit/Socket.IO bridge
  // -------------------------------------------------------------------------

  const {
    layout,
    currentPage,
    manualMode,
    setPage,
    setManual,
    clearManual,
  } = useDynamicLayout(roomId)

  // Also subscribe to store directly for gift events (optional future hook-up)
  const store = useDynamicLayoutStore()

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const { gridDef, pages, totalPages, totalSpeakers, mode, pkConfig } = layout
  const isPKMode = mode === 'pk'
  const isMinimalMode = mode === 'minimal'
  const showBadges = !isMinimalMode
  const showGifts = !isMinimalMode

  // Reconnect banner: visible if any speaker has isOnline === false
  const isAnyOffline = useMemo(
    () => store.speakers.some((sp) => sp.isOnline === false),
    [store.speakers],
  )

  // Current page seats — memoised to avoid page slicing on unrelated state changes (Req 5.5)
  const currentPageSeats: SeatData[] = useMemo(
    () => pages[currentPage] ?? [],
    [pages, currentPage],
  )

  // Gift events — placeholder state; real events would come from a socket/store
  const [giftEvents, setGiftEvents] = useState<GiftEvent[]>([])

  // Container ref for measuring width
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(600)

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // Seat size (square)
  const seatSize = useMemo(
    () => computeSeatSize(containerWidth, gridDef.columns),
    [containerWidth, gridDef.columns],
  )

  // -------------------------------------------------------------------------
  // Swipe handling via pointer events (Req 3.5, 3.6)
  // -------------------------------------------------------------------------

  const pointerStartX = useRef<number | null>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerStartX.current = e.clientX
  }, [])

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (pointerStartX.current === null) return
      const delta = e.clientX - pointerStartX.current
      pointerStartX.current = null

      if (Math.abs(delta) < SWIPE_THRESHOLD) return

      if (delta < 0) {
        // Swipe left → next page
        if (currentPage < totalPages - 1) {
          setPage(currentPage + 1)
        }
      } else {
        // Swipe right → previous page
        if (currentPage > 0) {
          setPage(currentPage - 1)
        }
      }
    },
    [currentPage, totalPages, setPage],
  )

  // -------------------------------------------------------------------------
  // Seat interaction callbacks (stable references)
  // -------------------------------------------------------------------------

  const isCurrentUser = useCallback(
    (userId: string) => userId === currentUserId,
    [currentUserId],
  )

  const handleSeatPress = useCallback((_seat: SeatData) => {
    // Future: open profile sheet
  }, [])

  const handleSeatLongPress = useCallback((_seat: SeatData) => {
    // Future: open admin action sheet (handled inside SeatCard when isHost)
  }, [])

  // -------------------------------------------------------------------------
  // Layout control bar handlers
  // -------------------------------------------------------------------------

  const handleSelectMode = useCallback(
    (m: LayoutMode) => setManual(m),
    [setManual],
  )

  const handleResetAuto = useCallback(() => clearManual(), [clearManual])

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  /**
   * Renders the standard seat grid for the current page using either
   * react-window (when totalSpeakers > 32) or a plain CSS grid.
   */
  function renderSeatGrid(seats: SeatData[]) {
    if (totalSpeakers > VIRTUAL_GRID_THRESHOLD) {
      // Virtual grid via react-window (Req 5.7)
      const cellSize = seatSize + SEAT_GAP
      const gridHeight = gridDef.rows * cellSize + SEAT_GAP

      const cellData: VirtualCellData = {
        seats,
        columns: gridDef.columns,
        cellSize,
        isCurrentUser,
        isHost,
        layoutMode: mode,
        onPress: handleSeatPress,
        onLongPress: handleSeatLongPress,
      }

      return (
        <FixedSizeGrid
          columnCount={gridDef.columns}
          columnWidth={cellSize}
          rowCount={gridDef.rows}
          rowHeight={cellSize}
          height={gridHeight}
          width={containerWidth}
          itemData={cellData}
          style={{ willChange: 'transform' }}
        >
          {VirtualCell}
        </FixedSizeGrid>
      )
    }

    // Standard CSS grid with Framer Motion layout animations
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${gridDef.columns}, 1fr)`,
          gap: SEAT_GAP,
          padding: SEAT_GAP,
          willChange: 'transform',
        }}
      >
        <AnimatePresence initial={false}>
          {seats.map((seat) => (
            <motion.div
              key={seat.key}
              layout
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ type: 'spring', stiffness: 350, damping: 25 }}
              style={{ willChange: 'transform', display: 'flex', justifyContent: 'center' }}
            >
              <SeatCard
                seat={seat}
                size={{ width: seatSize, height: seatSize }}
                isSpeaking={seat.isSpeaking}
                isMuted={seat.isMuted}
                isCurrentUser={isCurrentUser(seat.userId)}
                isHost={isHost}
                layoutMode={mode}
                onPress={handleSeatPress}
                onLongPress={handleSeatLongPress}
                showBadges={showBadges}
                showGifts={showGifts}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    )
  }

  /**
   * Renders the PK mode layout: two equal-width columns with an animated
   * VS badge between them (Req 6.4–6.6).
   */
  function renderPKGrid() {
    if (!pkConfig) return renderSeatGrid(currentPageSeats)

    const { teamA, teamB } = pkConfig

    // Build SeatData lists from pkConfig members, merging with current page for display metadata
    const teamASeats: SeatData[] = teamA.map((sp) => ({
      ...sp,
      isEmpty: false,
      key: `seat-${sp.seatIndex}`,
    }))
    const teamBSeats: SeatData[] = teamB.map((sp) => ({
      ...sp,
      isEmpty: false,
      key: `seat-${sp.seatIndex}`,
    }))

    const pkSeatSize = Math.max(
      MIN_SEAT_SIZE,
      Math.floor((containerWidth - 36 - SEAT_GAP * 4) / 2 / 1),
    )

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          gap: 0,
          alignItems: 'flex-start',
          padding: SEAT_GAP,
        }}
      >
        {/* Team A — left column (primary color border) */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: SEAT_GAP,
            alignItems: 'center',
          }}
        >
          <AnimatePresence initial={false}>
            {teamASeats.map((seat) => (
              <motion.div
                key={seat.key}
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                style={{ willChange: 'transform' }}
              >
                <SeatCard
                  seat={seat}
                  size={{ width: pkSeatSize, height: pkSeatSize }}
                  isSpeaking={seat.isSpeaking}
                  isMuted={seat.isMuted}
                  isCurrentUser={isCurrentUser(seat.userId)}
                  isHost={isHost}
                  layoutMode={mode}
                  onPress={handleSeatPress}
                  onLongPress={handleSeatLongPress}
                  showBadges={showBadges}
                  showGifts={showGifts}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Animated VS divider (Req 6.5) */}
        <AnimatePresence>
          <VSBadge primary={colors.primary} />
        </AnimatePresence>

        {/* Team B — right column (accent color border) */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: SEAT_GAP,
            alignItems: 'center',
          }}
        >
          <AnimatePresence initial={false}>
            {teamBSeats.map((seat) => (
              <motion.div
                key={seat.key}
                layout
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                style={{ willChange: 'transform' }}
              >
                <SeatCard
                  seat={seat}
                  size={{ width: pkSeatSize, height: pkSeatSize }}
                  isSpeaking={seat.isSpeaking}
                  isMuted={seat.isMuted}
                  isCurrentUser={isCurrentUser(seat.userId)}
                  isHost={isHost}
                  layoutMode={mode}
                  onPress={handleSeatPress}
                  onLongPress={handleSeatLongPress}
                  showBadges={showBadges}
                  showGifts={showGifts}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: colors.bg,
        width: '100%',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Reconnect banner — shown when any speaker isOnline === false (Req 8.2, 8.4) */}
      <AnimatePresence>
        {isAnyOffline && <ReconnectBanner key="reconnect-banner" colors={colors} />}
      </AnimatePresence>

      {/* Layout mode control bar */}
      <LayoutControlBar
        currentMode={manualMode ?? 'auto'}
        isManual={manualMode !== null}
        onSelectMode={handleSelectMode}
        onResetAuto={handleResetAuto}
      />

      {/* Paginated seat area — swipe-enabled container */}
      <div
        style={{ flex: 1, position: 'relative', touchAction: 'pan-y' }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { pointerStartX.current = null }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentPage}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            style={{ willChange: 'transform' }}
          >
            {isPKMode ? renderPKGrid() : renderSeatGrid(currentPageSeats)}
          </motion.div>
        </AnimatePresence>

        {/* GiftOverlay — floats above host seat (Req 2.6) */}
        <GiftOverlay giftEvents={giftEvents} showGifts={showGifts} />
      </div>

      {/* Pagination dots — only rendered when totalPages > 1 (Req 3.8) */}
      {totalPages > 1 && (
        <PaginationDots
          totalPages={totalPages}
          currentPage={currentPage}
          onPageSelect={setPage}
        />
      )}
    </div>
  )
}
