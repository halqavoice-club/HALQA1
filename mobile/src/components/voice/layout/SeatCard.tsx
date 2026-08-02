/**
 * SeatCard.tsx  (React Native)
 *
 * Per-seat renderer for the Dynamic Speaker Layout System.
 * Renders a single seat — occupied or empty — with avatar, badges,
 * speaking ring, and accessibility labels.
 *
 * React.memo with a custom comparator: only re-renders when
 * isSpeaking, isMuted, or avatarUrl change (Requirement 5.3).
 *
 * Requirements covered: 5.3, 8.1, 8.6, 8.7, 11.5, 12.1, 12.4
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  StyleProp,
  ViewStyle,
  StyleSheet,
} from 'react-native';
import { SeatData, LayoutMode } from '../../../../../src/lib/layout/layoutTypes';
import { SpeakingRing } from './SpeakingRing';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SeatCardProps {
  seat: SeatData;
  size: { width: number; height: number };
  isSpeaking: boolean;
  isMuted: boolean;
  isCurrentUser: boolean;
  isHost: boolean;
  layoutMode: LayoutMode;
  onPress?: (seat: SeatData) => void;
  onLongPress?: (seat: SeatData) => void;
  showBadges?: boolean;
  showGifts?: boolean;
  style?: StyleProp<ViewStyle>;
}

// ---------------------------------------------------------------------------
// Avatar fallback — 12-color palette (RN doesn't support hsl())
// ---------------------------------------------------------------------------

const AVATAR_COLORS = [
  '#E53E3E', '#DD6B20', '#D69E2E', '#38A169',
  '#3182CE', '#805AD5', '#D53F8C', '#319795',
  '#2D3748', '#667EEA', '#F6AD55', '#68D391',
];

function hashIndex(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % AVATAR_COLORS.length;
}

function getInitials(displayName: string, userId: string): string {
  const name = displayName || userId.slice(0, 8);
  const parts = name.trim().split(' ');
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

// ---------------------------------------------------------------------------
// Internal base component
// ---------------------------------------------------------------------------

function SeatCardBase({
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
  style,
}: SeatCardProps) {
  const [avatarError, setAvatarError] = useState(false);

  // -------------------------------------------------------------------------
  // Empty seat
  // -------------------------------------------------------------------------

  if (seat.isEmpty) {
    return (
      <View
        accessibilityLabel="Empty seat"
        accessibilityRole="none"
        style={[
          {
            width: size.width,
            height: size.height,
            minWidth: 44,
            minHeight: 44,
            backgroundColor: '#374151',
            borderRadius: 12,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: '#4b5563',
            alignItems: 'center',
            justifyContent: 'center',
          },
          style,
        ]}
      >
        {seat.isLocked && (
          <Text style={styles.lockIconCenter}>🔒</Text>
        )}
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Occupied seat — derived display values
  // -------------------------------------------------------------------------

  const displayName = seat.displayName || seat.userId.slice(0, 8);
  const initials = getInitials(seat.displayName, seat.userId);
  const showAvatar = !avatarError && !!seat.avatarUrl;

  const accessibilityLabel = `${displayName}, ${seat.role}, ${isSpeaking ? 'speaking' : 'muted'}`;

  // Role badge emoji
  const roleBadge =
    seat.role === 'owner'
      ? '👑'
      : seat.role === 'moderator'
      ? '🛡️'
      : null;

  // Current-user highlight border
  const currentUserBorder = isCurrentUser
    ? { borderColor: '#4f46e5', borderWidth: 2 }
    : {};

  // -------------------------------------------------------------------------
  // Render occupied seat
  // -------------------------------------------------------------------------

  return (
    <Pressable
      onPress={() => onPress?.(seat)}
      onLongPress={() => onLongPress?.(seat)}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityHint={isHost ? 'Double tap to view seat options' : 'Double tap to interact with this speaker'}
      style={[
        {
          width: size.width,
          height: size.height,
          minWidth: 44,
          minHeight: 44,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: '#1a1a2e',
          alignItems: 'center',
          justifyContent: 'center',
          ...currentUserBorder,
        },
        style,
      ]}
    >
      {/* Speaking ring — absolutely positioned behind/around everything */}
      <SpeakingRing isSpeaking={isSpeaking} />

      {/* Avatar */}
      {showAvatar ? (
        <Image
          source={{ uri: seat.avatarUrl }}
          onError={() => setAvatarError(true)}
          style={styles.avatar}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          style={[
            styles.avatar,
            { backgroundColor: AVATAR_COLORS[hashIndex(seat.userId)] },
          ]}
        >
          <Text style={styles.initialsText}>{initials}</Text>
        </View>
      )}

      {/* Role badge (top-right) — 👑 or 🛡️ */}
      {showBadges !== false && roleBadge !== null && (
        <Text style={styles.roleBadge}>{roleBadge}</Text>
      )}

      {/* Lock indicator (top-left) */}
      {seat.isLocked && (
        <Text style={styles.lockIconTopLeft}>🔒</Text>
      )}

      {/* Muted indicator (bottom-left) */}
      {isMuted && (
        <Text style={styles.mutedIcon}>🔇</Text>
      )}

      {/* Country flag (bottom area, above display name) */}
      {!!seat.countryCode && (
        <Text style={styles.countryFlag}>{seat.countryCode}</Text>
      )}

      {/* Display name */}
      <Text numberOfLines={1} style={styles.displayName}>
        {displayName}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  avatar: {
    width: '65%',
    aspectRatio: 1,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  initialsText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  roleBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    fontSize: 12,
  },
  lockIconTopLeft: {
    position: 'absolute',
    top: 4,
    left: 4,
    fontSize: 12,
  },
  lockIconCenter: {
    fontSize: 18,
  },
  mutedIcon: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    fontSize: 12,
  },
  countryFlag: {
    fontSize: 10,
    color: '#9ca3af',
    marginBottom: 1,
  },
  displayName: {
    fontSize: 10,
    color: '#e5e7eb',
    fontWeight: '500',
    paddingHorizontal: 2,
    textAlign: 'center',
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
  },
});

// ---------------------------------------------------------------------------
// React.memo with custom comparator (Requirement 5.3)
// Re-renders ONLY when isSpeaking, isMuted, or avatarUrl change.
// ---------------------------------------------------------------------------

function areEqual(prev: SeatCardProps, next: SeatCardProps): boolean {
  return (
    prev.isSpeaking === next.isSpeaking &&
    prev.isMuted === next.isMuted &&
    prev.seat.avatarUrl === next.seat.avatarUrl
  );
}

export const SeatCard = React.memo(SeatCardBase, areEqual);

SeatCard.displayName = 'SeatCard';
