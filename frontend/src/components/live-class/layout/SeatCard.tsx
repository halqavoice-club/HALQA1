'use client'

/**
 * SeatCard.tsx
 *
 * Per-seat renderer for the Dynamic Speaker Layout System (web).
 *
 * Renders an occupied or empty speaker seat with:
 *   - Avatar with lazy/async loading and deterministic initials fallback
 *   - Role badge (👑 owner, 🛡 moderator)
 *   - Flag badge (country code) — hidden when countryCode is null/undefined
 *   - Lock indicator (🔒) when seat.isLocked === true
 *   - SpeakingRing animation overlay
 *   - Minimum 44×44px touch target (WCAG 2.5.5)
 *   - onContextMenu mapped to onLongPress (web equivalent of long-press)
 *
 * Wrapped with React.memo + custom comparator: only re-renders on
 * isSpeaking, isMuted, or seat.avatarUrl changes.
 *
 * Requirements: 5.3, 8.1, 8.6, 8.7, 11.1, 11.5, 12.1, 12.4
 */

import React, { useState, useCallback } from 'react'
import { SeatData, LayoutMode } from '@/lib/layout/layoutTypes'
import { SpeakingRing } from './SpeakingRing'

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/**
 * Maps a userId to a deterministic HSL hue via djb2-style hash.
 * Returns an hsl() color string suitable for CSS backgrounds.
 */
function hashColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 60%, 45%)`
}

/**
 * Derives up to 2 uppercase initials from displayName (or userId fallback).
 * "Ali Hassan" → "AH", "alice" → "AL", "" → first 2 chars of userId slice.
 */
function getInitials(displayName: string, userId: string): string {
  const name = displayName || userId.slice(0, 8)
  const parts = name.trim().split(' ')
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SeatCardProps {
  seat: SeatData
  size: { width: number; height: number }
  isSpeaking: boolean
  isMuted: boolean
  isCurrentUser: boolean
  isHost: boolean
  layoutMode: LayoutMode
  onPress?: (seat: SeatData) => void
  onLongPress?: (seat: SeatData) => void
  showBadges?: boolean
  showGifts?: boolean
}

// ---------------------------------------------------------------------------
// Custom memo comparator
// Re-render only when isSpeaking, isMuted, or seat.avatarUrl changes.
// ---------------------------------------------------------------------------

function areEqual(prev: SeatCardProps, next: SeatCardProps): boolean {
  return (
    prev.isSpeaking === next.isSpeaking &&
    prev.isMuted === next.isMuted &&
    prev.seat.avatarUrl === next.seat.avatarUrl
  )
}

// ---------------------------------------------------------------------------
// SeatCard component
// ---------------------------------------------------------------------------

const SeatCardInner = function SeatCard({
  seat,
  size,
  isSpeaking,
  isMuted,
  isCurrentUser,
  isHost,
  layoutMode,
  onPress,
  onLongPress,
  showBadges = true,
  showGifts = true,
}: SeatCardProps) {
  const [avatarError, setAvatarError] = useState(false)

  const handleAvatarError = useCallback(() => {
    setAvatarError(true)
  }, [])

  const handleClick = useCallback(() => {
    onPress?.(seat)
  }, [onPress, seat])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      onLongPress?.(seat)
    },
    [onLongPress, seat],
  )

  // -------------------------------------------------------------------------
  // Empty seat
  // -------------------------------------------------------------------------

  if (seat.isEmpty) {
    return (
      <div
        aria-label="Empty seat"
        role="img"
        style={{
          width: size.width,
          height: size.height,
          minWidth: 44,
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 12,
          backgroundColor: '#374151',
          border: '1px dashed #4b5563',
          position: 'relative',
          boxSizing: 'border-box',
        }}
      >
        {/* Lock indicator on empty locked seat */}
        {seat.isLocked && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 4,
              left: 4,
              fontSize: 12,
              lineHeight: 1,
            }}
          >
            🔒
          </span>
        )}
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Occupied seat — derive display values
  // -------------------------------------------------------------------------

  const displayName = seat.displayName || seat.userId.slice(0, 8)
  const showInitials = !seat.avatarUrl || avatarError
  const bgColor = hashColor(seat.userId)
  const initials = getInitials(seat.displayName, seat.userId)

  const accessibilityLabel = `${displayName}, ${seat.role}, ${isSpeaking ? 'speaking' : 'muted'}`

  // Role badge
  const roleBadge =
    showBadges !== false && seat.role === 'owner'
      ? '👑'
      : showBadges !== false && seat.role === 'moderator'
        ? '🛡'
        : null

  return (
    <button
      type="button"
      aria-label={accessibilityLabel}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      style={{
        position: 'relative',
        width: Math.max(size.width, 44),
        height: Math.max(size.height, 44),
        minWidth: 44,
        minHeight: 44,
        padding: 0,
        border: '1px solid #2d2d4e',
        borderRadius: 12,
        backgroundColor: '#1a1a2e',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        overflow: 'visible',
        boxSizing: 'border-box',
        outline: isCurrentUser ? '2px solid #4f46e5' : 'none',
      }}
    >
      {/* Speaking ring — absolutely positioned behind/around the card */}
      <SpeakingRing isSpeaking={isSpeaking} />

      {/* Lock indicator */}
      {seat.isLocked && (
        <span
          aria-label="Locked"
          style={{
            position: 'absolute',
            top: 4,
            left: 4,
            fontSize: 12,
            lineHeight: 1,
            zIndex: 2,
          }}
        >
          🔒
        </span>
      )}

      {/* Role badge */}
      {roleBadge && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            fontSize: 12,
            lineHeight: 1,
            zIndex: 2,
          }}
        >
          {roleBadge}
        </span>
      )}

      {/* Muted indicator */}
      {isMuted && (
        <span
          aria-label="Muted"
          style={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            fontSize: 12,
            lineHeight: 1,
            zIndex: 2,
          }}
        >
          🔇
        </span>
      )}

      {/* Avatar */}
      <div
        style={{
          position: 'relative',
          width: Math.min(size.width * 0.6, 48),
          height: Math.min(size.height * 0.6, 48),
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {showInitials ? (
          /* Deterministic initials fallback */
          <div
            aria-hidden="true"
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              backgroundColor: bgColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontSize: Math.min(size.width * 0.18, 16),
              fontWeight: 700,
              userSelect: 'none',
            }}
          >
            {initials}
          </div>
        ) : (
          <img
            src={seat.avatarUrl}
            alt={displayName}
            loading="lazy"
            decoding="async"
            onError={handleAvatarError}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: '50%',
              display: 'block',
            }}
          />
        )}
      </div>

      {/* Display name */}
      <span
        style={{
          fontSize: Math.min(size.width * 0.12, 11),
          color: '#e5e7eb',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          paddingInline: 4,
          lineHeight: 1.2,
        }}
      >
        {displayName}
      </span>

      {/* Flag badge — only rendered when countryCode is present */}
      {seat.countryCode && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: 4,
            right: 4,
            fontSize: 10,
            lineHeight: 1,
            zIndex: 2,
          }}
        >
          {seat.countryCode}
        </span>
      )}
    </button>
  )
}

/**
 * SeatCard wrapped with React.memo and a custom equality comparator.
 * Only re-renders when isSpeaking, isMuted, or seat.avatarUrl changes.
 */
export const SeatCard = React.memo(SeatCardInner, areEqual)

SeatCard.displayName = 'SeatCard'
