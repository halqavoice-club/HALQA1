/**
 * LiveVideoGrid.tsx
 *
 * TikTok/Zoom-style 4-column video tile grid for Live Class and Live Stream.
 * Matches the screenshot: edge-to-edge tiles, numbered seat badge (top-left),
 * name label (bottom), green waveform indicator + green speaking border.
 *
 * Features:
 *   - Always 4 columns, fills full width
 *   - Tiles are 4:3 aspect ratio (video-friendly)
 *   - Shows real avatar image or colored initials fallback
 *   - Seat number badge in top-left corner
 *   - Name + waveform indicator in bottom overlay
 *   - Green animated border when isSpeaking
 *   - Host badge (👑) in top-right
 *   - Muted mic icon (bottom-left) when isMuted
 *   - Scrollable when > 16 speakers (FlatList)
 *   - React.memo per tile — only re-renders on speaking/muted/avatar change
 *
 * Usage:
 *   <LiveVideoGrid
 *     speakers={activeSpeakers}
 *     currentUserId={user?.id ?? ''}
 *     isHost={isHost}
 *   />
 */

import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  Dimensions,
  StyleSheet,
  Pressable,
  StyleProp,
  ViewStyle,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VideoSpeaker {
  userId: string;
  seatIndex: number;
  displayName: string;
  avatarUrl?: string | null;
  role: 'owner' | 'moderator' | 'speaker';
  isMuted: boolean;
  isSpeaking: boolean;
  isOnline: boolean;
}

interface LiveVideoGridProps {
  speakers: VideoSpeaker[];
  currentUserId: string;
  isHost: boolean;
  onPressTile?: (speaker: VideoSpeaker) => void;
  onLongPressTile?: (speaker: VideoSpeaker) => void;
  style?: StyleProp<ViewStyle>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLUMNS = 4;
const GAP = 2; // px between tiles — tight like the screenshot
const SPEAKING_COLOR = '#22c55e';
const SPEAKING_BORDER_WIDTH = 3;

// 12-color palette for initials avatars
const AVATAR_COLORS = [
  '#1d4ed8', '#0f766e', '#7e22ce', '#b45309',
  '#be123c', '#0369a1', '#15803d', '#c2410c',
  '#6d28d9', '#0e7490', '#92400e', '#1e3a5f',
];

function hashColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = userId.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// ─── Waveform bars (animated when speaking) ───────────────────────────────────

const BAR_COUNT = 4;
const BAR_HEIGHTS = [8, 14, 10, 12]; // staggered natural heights

const WaveformBar = React.memo(function WaveformBar({
  baseHeight,
  delay,
  speaking,
}: {
  baseHeight: number;
  delay: number;
  speaking: boolean;
}) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (speaking) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.8, { duration: 200 + delay, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.6, { duration: 200 + delay, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
    } else {
      scale.value = withTiming(1, { duration: 150 });
    }
  }, [speaking, delay]); // eslint-disable-line

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        waveStyles.bar,
        { height: baseHeight, backgroundColor: speaking ? SPEAKING_COLOR : '#6b7280' },
        animStyle,
      ]}
    />
  );
});

const waveStyles = StyleSheet.create({
  bar: { width: 3, borderRadius: 2, marginHorizontal: 1 },
});

function Waveform({ speaking }: { speaking: boolean }) {
  return (
    <View style={wfStyles.container}>
      {BAR_HEIGHTS.map((h, i) => (
        <WaveformBar key={i} baseHeight={h} delay={i * 40} speaking={speaking} />
      ))}
    </View>
  );
}

const wfStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 18,
  },
});

// ─── Single video tile ────────────────────────────────────────────────────────

interface TileProps {
  speaker: VideoSpeaker;
  tileWidth: number;
  tileHeight: number;
  seatNumber: number; // 1-based display number
  isCurrentUser: boolean;
  isHost: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}

function VideoTileBase({
  speaker,
  tileWidth,
  tileHeight,
  seatNumber,
  isCurrentUser,
  isHost,
  onPress,
  onLongPress,
}: TileProps) {
  const [imgError, setImgError] = React.useState(false);
  const showImg = !!speaker.avatarUrl && !imgError;

  // Speaking border — animated opacity pulse
  const borderOpacity = useSharedValue(0);
  useEffect(() => {
    if (speaker.isSpeaking) {
      borderOpacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 300 }),
          withTiming(0.6, { duration: 300 }),
        ),
        -1,
        true,
      );
    } else {
      borderOpacity.value = withTiming(0, { duration: 200 });
    }
  }, [speaker.isSpeaking]); // eslint-disable-line

  const borderStyle = useAnimatedStyle(() => ({
    opacity: borderOpacity.value,
  }));

  const bgColor = hashColor(speaker.userId);
  const nameText = speaker.displayName || speaker.userId.slice(0, 8);
  const isOwner = speaker.role === 'owner';
  const isMod = speaker.role === 'moderator';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityLabel={`${nameText}, ${speaker.isSpeaking ? 'speaking' : speaker.isMuted ? 'muted' : 'on stage'}`}
      accessibilityRole="button"
      style={[
        tileStyles.tile,
        {
          width: tileWidth,
          height: tileHeight,
          // Current user: subtle blue tint
          borderColor: isCurrentUser ? '#4f46e5' : 'transparent',
          borderWidth: isCurrentUser ? SPEAKING_BORDER_WIDTH : 0,
        },
      ]}
    >
      {/* ── Background: avatar image or initials ── */}
      {showImg ? (
        <Image
          source={{ uri: speaker.avatarUrl! }}
          onError={() => setImgError(true)}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: bgColor, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={tileStyles.initialsText}>{initials(nameText)}</Text>
        </View>
      )}

      {/* ── Speaking border overlay (animated green) ── */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          tileStyles.speakingBorder,
          borderStyle,
        ]}
      />

      {/* ── Seat number badge (top-left) ── */}
      <View style={tileStyles.seatBadge}>
        <Text style={tileStyles.seatBadgeText}>{seatNumber}</Text>
      </View>

      {/* ── Role badge (top-right) ── */}
      {(isOwner || isMod) && (
        <View style={tileStyles.roleBadge}>
          <Text style={tileStyles.roleBadgeText}>
            {isOwner ? '👑' : '🛡️'}
          </Text>
        </View>
      )}

      {/* ── Offline overlay ── */}
      {!speaker.isOnline && (
        <View style={tileStyles.offlineOverlay}>
          <Text style={tileStyles.offlineText}>Reconnecting…</Text>
        </View>
      )}

      {/* ── Bottom gradient overlay with name + waveform ── */}
      <View style={tileStyles.bottomOverlay}>
        {/* Muted mic — left side */}
        {speaker.isMuted && (
          <Ionicons
            name="mic-off"
            size={12}
            color="#ef4444"
            style={tileStyles.mutedIcon}
          />
        )}

        {/* Name — takes remaining space */}
        <Text style={tileStyles.nameText} numberOfLines={1}>
          {nameText}
        </Text>

        {/* Waveform — right side */}
        <Waveform speaking={speaker.isSpeaking && !speaker.isMuted} />
      </View>
    </Pressable>
  );
}

// Memoized — only re-render when speaking/muted/avatar/online changes
function tilesAreEqual(prev: TileProps, next: TileProps): boolean {
  return (
    prev.speaker.isSpeaking === next.speaker.isSpeaking &&
    prev.speaker.isMuted === next.speaker.isMuted &&
    prev.speaker.avatarUrl === next.speaker.avatarUrl &&
    prev.speaker.isOnline === next.speaker.isOnline &&
    prev.speaker.displayName === next.speaker.displayName &&
    prev.seatNumber === next.seatNumber &&
    prev.tileWidth === next.tileWidth &&
    prev.tileHeight === next.tileHeight
  );
}

const VideoTile = React.memo(VideoTileBase, tilesAreEqual);
VideoTile.displayName = 'VideoTile';

const tileStyles = StyleSheet.create({
  tile: {
    overflow: 'hidden',
    backgroundColor: '#111827',
    position: 'relative',
  },
  initialsText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
  },
  speakingBorder: {
    borderWidth: SPEAKING_BORDER_WIDTH,
    borderColor: SPEAKING_COLOR,
  },
  seatBadge: {
    position: 'absolute',
    top: 5,
    left: 5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  seatBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  roleBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
  },
  roleBadgeText: {
    fontSize: 14,
  },
  offlineOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineText: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '600',
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    gap: 3,
  },
  mutedIcon: {
    flexShrink: 0,
  },
  nameText: {
    flex: 1,
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
});

// ─── Empty tile placeholder ───────────────────────────────────────────────────

function EmptyTile({ width, height }: { width: number; height: number }) {
  return (
    <View style={[emptyStyles.tile, { width, height }]} />
  );
}

const emptyStyles = StyleSheet.create({
  tile: {
    backgroundColor: '#0a0a0a',
  },
});

// ─── Main grid component ──────────────────────────────────────────────────────

export const LiveVideoGrid = React.memo(function LiveVideoGrid({
  speakers,
  currentUserId,
  isHost,
  onPressTile,
  onLongPressTile,
  style,
}: LiveVideoGridProps) {
  const { width: screenWidth } = Dimensions.get('window');

  // Tile dimensions: 4 columns, 4:3 aspect ratio, gap=2 between tiles
  const tileWidth = useMemo(() => Math.floor((screenWidth - GAP * (COLUMNS - 1)) / COLUMNS), [screenWidth]);
  const tileHeight = useMemo(() => Math.floor(tileWidth * (3 / 4)), [tileWidth]);

  // Sort: owner first, then moderators, then speakers — stable by seatIndex
  const sorted = useMemo(
    () =>
      [...speakers].sort((a, b) => {
        const rank = (r: VideoSpeaker['role']) => r === 'owner' ? 0 : r === 'moderator' ? 1 : 2;
        const rd = rank(a.role) - rank(b.role);
        return rd !== 0 ? rd : a.seatIndex - b.seatIndex;
      }),
    [speakers],
  );

  // Pad to nearest multiple of COLUMNS so the last row is full
  const padded = useMemo(() => {
    const remainder = sorted.length % COLUMNS;
    if (remainder === 0) return sorted;
    return [...sorted, ...Array(COLUMNS - remainder).fill(null)];
  }, [sorted]);

  // Build rows of 4 for renderItem
  const rows = useMemo(() => {
    const result: (VideoSpeaker | null)[][] = [];
    for (let i = 0; i < padded.length; i += COLUMNS) {
      result.push(padded.slice(i, i + COLUMNS));
    }
    return result;
  }, [padded]);

  const renderRow = useCallback(
    ({ item: row, index: rowIndex }: { item: (VideoSpeaker | null)[]; index: number }) => (
      <View style={[gridStyles.row, { gap: GAP }]}>
        {row.map((speaker, colIndex) => {
          const globalIndex = rowIndex * COLUMNS + colIndex;
          if (!speaker) return <EmptyTile key={`empty-${globalIndex}`} width={tileWidth} height={tileHeight} />;
          return (
            <VideoTile
              key={speaker.userId}
              speaker={speaker}
              tileWidth={tileWidth}
              tileHeight={tileHeight}
              seatNumber={globalIndex + 1}
              isCurrentUser={speaker.userId === currentUserId}
              isHost={isHost}
              onPress={onPressTile ? () => onPressTile(speaker) : undefined}
              onLongPress={onLongPressTile ? () => onLongPressTile(speaker) : undefined}
            />
          );
        })}
      </View>
    ),
    [tileWidth, tileHeight, currentUserId, isHost, onPressTile, onLongPressTile],
  );

  const keyExtractor = useCallback((_: any, index: number) => `row-${index}`, []);

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: tileHeight + GAP,
      offset: (tileHeight + GAP) * index,
      index,
    }),
    [tileHeight],
  );

  if (speakers.length === 0) {
    return (
      <View style={gridStyles.empty}>
        <Ionicons name="people-outline" size={40} color="#374151" />
        <Text style={gridStyles.emptyText}>No speakers on stage yet</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={keyExtractor}
      renderItem={renderRow}
      getItemLayout={getItemLayout}
      showsVerticalScrollIndicator={false}
      scrollEnabled={rows.length > 4} // only scroll if > 16 tiles
      style={[gridStyles.list, style]}
      contentContainerStyle={[gridStyles.content, { gap: GAP }]}
      removeClippedSubviews
      maxToRenderPerBatch={4}
      windowSize={5}
    />
  );
});

LiveVideoGrid.displayName = 'LiveVideoGrid';

const gridStyles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: '#000',
  },
  content: {
    // gap is set dynamically above
  },
  row: {
    flexDirection: 'row',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#000',
  },
  emptyText: {
    color: '#4b5563',
    fontSize: 14,
    fontWeight: '600',
  },
});
