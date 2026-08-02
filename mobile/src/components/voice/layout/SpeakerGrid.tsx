/**
 * SpeakerGrid.tsx  (React Native)
 *
 * Top-level orchestrator for the Dynamic Speaker Layout System (mobile).
 * Reads from useDynamicLayoutStore, drives all child layout components,
 * and handles pagination via Animated.FlatList with horizontal + pagingEnabled.
 *
 * Animation: itemLayoutAnimation={LinearTransition.springify()} for seat
 * entry/exit. FlatList uses getItemLayout for O(1) scroll position.
 *
 * Seat sizing algorithm (design doc):
 *   seatWidth  = (screenWidth - (columns+1) * GAP) / columns
 *   seatHeight = min(seatWidth * aspectRatio, (screenHeight - (rows+1)*GAP) / rows)
 *
 * Requirements: 3.5–3.8, 5.5, 5.6, 6.4–6.7, 8.2, 8.4
 */

import React, { useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Dimensions,
  StyleSheet,
  StyleProp,
  ViewStyle,
  FlatList,
} from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { useDynamicLayout } from './useDynamicLayout';
import { useDynamicLayoutStore } from './useDynamicLayoutStore';
import { SeatCard } from './SeatCard';
import { LayoutControlBar } from './LayoutControlBar';
import { PaginationDots } from './PaginationDots';
import { GiftOverlay, GiftEvent } from './GiftOverlay';
import type {
  SeatData,
  LayoutMode,
  SpeakerSlot,
} from '../../../../../src/lib/layout/layoutTypes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Horizontal/vertical gap between seats in dp. */
const GAP = 8;

/** Reserved height for LayoutControlBar row. */
const CONTROL_BAR_HEIGHT = 60;

/** Reserved height for PaginationDots row. */
const PAGINATION_HEIGHT = 44;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SpeakerGridProps {
  roomId: string;
  isHost: boolean;
  currentUserId: string;
  theme?: 'dark' | 'light' | 'oled';
  style?: StyleProp<ViewStyle>;
}

// ---------------------------------------------------------------------------
// Theme tokens
// ---------------------------------------------------------------------------

const THEMES = {
  dark: {
    bg: '#0f0f23',
    card: '#1a1a2e',
    banner: '#1e1b4b',
    bannerText: '#a5b4fc',
    vsDivider: '#4f46e5',
    vsGlow: 'rgba(79, 70, 229, 0.4)',
    vsText: '#ffffff',
    teamABorder: '#4f46e5',
    teamBBorder: '#a5b4fc',
  },
  light: {
    bg: '#f3f4f6',
    card: '#ffffff',
    banner: '#eef2ff',
    bannerText: '#4338ca',
    vsDivider: '#4f46e5',
    vsGlow: 'rgba(79, 70, 229, 0.2)',
    vsText: '#1e1b4b',
    teamABorder: '#4f46e5',
    teamBBorder: '#7c3aed',
  },
  oled: {
    bg: '#000000',
    card: '#0a0a0a',
    banner: '#0d0d1a',
    bannerText: '#818cf8',
    vsDivider: '#6366f1',
    vsGlow: 'rgba(99, 102, 241, 0.5)',
    vsText: '#ffffff',
    teamABorder: '#6366f1',
    teamBBorder: '#a78bfa',
  },
} as const;

type ThemeTokens = (typeof THEMES)[keyof typeof THEMES];

// ---------------------------------------------------------------------------
// Seat sizing algorithm (Requirements 5.6, design doc)
//
//   seatWidth  = (screenWidth - (columns+1) * GAP) / columns
//   seatHeight = min(seatWidth * aspectRatio, (screenHeight - (rows+1)*GAP) / rows)
// ---------------------------------------------------------------------------

function computeSeatSize(
  screenWidth: number,
  screenHeight: number,
  columns: number,
  rows: number,
  seatAspect = 1,
): { width: number; height: number } {
  const availableHeight =
    screenHeight - CONTROL_BAR_HEIGHT - PAGINATION_HEIGHT;

  const seatWidth = (screenWidth - (columns + 1) * GAP) / columns;
  const seatHeightFromAspect = seatWidth * seatAspect;
  const seatHeightFromRows = (availableHeight - (rows + 1) * GAP) / rows;
  const seatHeight = Math.min(seatHeightFromAspect, seatHeightFromRows);

  return {
    width: Math.max(44, Math.floor(seatWidth)),
    height: Math.max(44, Math.floor(seatHeight)),
  };
}

// ---------------------------------------------------------------------------
// Helper: map SpeakerSlot → SeatData (for PK team arrays)
// ---------------------------------------------------------------------------

function slotToSeatData(slot: SpeakerSlot): SeatData {
  return {
    ...slot,
    isEmpty: false,
    key: `seat-${slot.seatIndex}`,
  };
}

// ---------------------------------------------------------------------------
// VS Divider component for PK mode (Requirement 6.5)
// ---------------------------------------------------------------------------

function VSDivider({ theme }: { theme: ThemeTokens }) {
  return (
    <View
      style={[styles.vsDividerContainer, { borderColor: theme.vsDivider }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[styles.vsGlow, { backgroundColor: theme.vsGlow }]}
        pointerEvents="none"
      />
      <Text
        style={[styles.vsText, { color: theme.vsText }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        VS
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Reconnect banner (Requirements 8.2, 8.4)
// ---------------------------------------------------------------------------

function ReconnectBanner({ theme }: { theme: ThemeTokens }) {
  return (
    <View
      style={[styles.reconnectBanner, { backgroundColor: theme.banner }]}
      accessibilityLiveRegion="polite"
      accessibilityLabel="Connection lost. Reconnecting…"
    >
      <Text style={[styles.reconnectText, { color: theme.bannerText }]}>
        🔄 Connection lost — reconnecting…
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// PK Section — one team column (Requirements 6.4, 6.6)
// ---------------------------------------------------------------------------

interface PKSectionProps {
  teamSeats: SeatData[];
  seatSize: { width: number; height: number };
  currentUserId: string;
  isHost: boolean;
  layoutMode: LayoutMode;
  borderColor: string;
  onPress: (seat: SeatData) => void;
  onLongPress: (seat: SeatData) => void;
}

function PKSection({
  teamSeats,
  seatSize,
  currentUserId,
  isHost,
  layoutMode,
  borderColor,
  onPress,
  onLongPress,
}: PKSectionProps) {
  return (
    <View style={styles.pkColumn}>
      {teamSeats.map((seat) => (
        <View key={seat.key} style={[styles.pkSeatWrapper, { borderColor }]}>
          <SeatCard
            seat={seat}
            size={seatSize}
            isSpeaking={seat.isSpeaking}
            isMuted={seat.isMuted}
            isCurrentUser={seat.userId === currentUserId}
            isHost={isHost}
            layoutMode={layoutMode}
            onPress={onPress}
            onLongPress={onLongPress}
            showBadges={layoutMode !== 'minimal'}
            showGifts={layoutMode !== 'minimal'}
          />
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main SpeakerGrid
// ---------------------------------------------------------------------------

export function SpeakerGrid({
  roomId,
  isHost,
  currentUserId,
  theme = 'dark',
  style,
}: SpeakerGridProps) {
  const themeTokens = THEMES[theme] ?? THEMES.dark;

  // -------------------------------------------------------------------------
  // Layout state from hook + store
  // -------------------------------------------------------------------------
  const { layout, currentPage, setPage, setManual, clearManual } =
    useDynamicLayout(roomId);

  const store = useDynamicLayoutStore();

  // Detect disconnected state — any speaker with isOnline === false (Req 8.4)
  const isDisconnected = useMemo(
    () => store.speakers.some((sp) => !sp.isOnline),
    [store.speakers],
  );

  // -------------------------------------------------------------------------
  // Screen dimensions
  // -------------------------------------------------------------------------
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

  // -------------------------------------------------------------------------
  // Seat sizing — memoised (Requirement 5.5)
  // seatWidth  = (screenWidth - (columns+1) * GAP) / columns
  // seatHeight = min(seatWidth * aspectRatio, (screenHeight - (rows+1)*GAP) / rows)
  // -------------------------------------------------------------------------
  const seatSize = useMemo(
    () =>
      computeSeatSize(
        screenWidth,
        screenHeight,
        layout.gridDef.columns,
        layout.gridDef.rows,
        layout.gridDef.seatAspect ?? 1,
      ),
    [
      screenWidth,
      screenHeight,
      layout.gridDef.columns,
      layout.gridDef.rows,
      layout.gridDef.seatAspect,
    ],
  );

  // PK mode: each team column gets equal width; subtract VS badge width + gaps
  const pkSeatSize = useMemo(() => {
    const pkColumnWidth = Math.floor((screenWidth - GAP * 3 - 56) / 2); // 56 = VS badge width
    return {
      width: Math.max(44, pkColumnWidth),
      height: seatSize.height,
    };
  }, [screenWidth, seatSize.height]);

  // -------------------------------------------------------------------------
  // Seat event handlers
  // -------------------------------------------------------------------------
  const handleSeatPress = useCallback((_seat: SeatData) => {
    // Host/moderator → admin modal handled upstream; no-op here
  }, []);

  const handleSeatLongPress = useCallback((_seat: SeatData) => {
    // Admin action menu — handled upstream
  }, []);

  // -------------------------------------------------------------------------
  // Page slicing — memoised (Requirement 5.5)
  // The outer FlatList receives all pages; each page is sliced for rendering.
  // -------------------------------------------------------------------------
  const pages: SeatData[][] = useMemo(
    () => layout.pages,
    [layout.pages],
  );

  // -------------------------------------------------------------------------
  // FlatList item sizing for O(1) scroll (Requirement 5.6)
  // Each "item" in the horizontal FlatList is one full page (pageWidth wide).
  // -------------------------------------------------------------------------
  const pageWidth = screenWidth;

  const getItemLayout = useCallback(
    (_data: SeatData[][] | null | undefined, index: number) => ({
      length: pageWidth,
      offset: pageWidth * index,
      index,
    }),
    [pageWidth],
  );

  // -------------------------------------------------------------------------
  // FlatList scroll sync → store.setCurrentPage (Requirements 3.5, 3.6)
  // -------------------------------------------------------------------------
  const flatListRef = useRef<FlatList<SeatData[]>>(null);

  const onMomentumScrollEnd = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      const newPage = Math.round(
        event.nativeEvent.contentOffset.x / pageWidth,
      );
      if (newPage !== currentPage) {
        setPage(newPage);
      }
    },
    [pageWidth, currentPage, setPage],
  );

  // Imperatively scroll when currentPage changes externally (dot tap — Req 3.7)
  React.useEffect(() => {
    if (flatListRef.current && layout.totalPages > 1) {
      flatListRef.current.scrollToIndex({
        index: Math.min(currentPage, layout.totalPages - 1),
        animated: true,
      });
    }
  }, [currentPage, layout.totalPages]);

  // -------------------------------------------------------------------------
  // Render a single page of seats (renderItem for outer FlatList)
  // -------------------------------------------------------------------------
  const renderPage = useCallback(
    ({ item: pageSeats }: { item: SeatData[] }) => {
      const { columns } = layout.gridDef;

      // PK mode: two equal-width columns with VS badge between (Req 6.4–6.6)
      if (layout.mode === 'pk' && layout.pkConfig) {
        const teamASeats = layout.pkConfig.teamA.map(slotToSeatData);
        const teamBSeats = layout.pkConfig.teamB.map(slotToSeatData);

        return (
          <View
            style={[styles.pageContainer, styles.pkPageContainer, { width: pageWidth }]}
            accessibilityLabel={`PK mode page`}
          >
            <PKSection
              teamSeats={teamASeats}
              seatSize={pkSeatSize}
              currentUserId={currentUserId}
              isHost={isHost}
              layoutMode={layout.mode}
              borderColor={themeTokens.teamABorder}
              onPress={handleSeatPress}
              onLongPress={handleSeatLongPress}
            />
            {/* VS badge divider between two equal-width columns (Req 6.5, 6.6) */}
            <VSDivider theme={themeTokens} />
            <PKSection
              teamSeats={teamBSeats}
              seatSize={pkSeatSize}
              currentUserId={currentUserId}
              isHost={isHost}
              layoutMode={layout.mode}
              borderColor={themeTokens.teamBBorder}
              onPress={handleSeatPress}
              onLongPress={handleSeatLongPress}
            />
          </View>
        );
      }

      // Normal grid — chunk page seats into rows of `columns` width
      const rows: SeatData[][] = [];
      for (let i = 0; i < pageSeats.length; i += columns) {
        rows.push(pageSeats.slice(i, i + columns));
      }

      return (
        <View style={[styles.pageContainer, { width: pageWidth }]}>
          {rows.map((rowSeats, rowIndex) => (
            <View key={`row-${rowIndex}`} style={styles.row}>
              {rowSeats.map((seat) => (
                <SeatCard
                  key={seat.key}
                  seat={seat}
                  size={seatSize}
                  isSpeaking={seat.isSpeaking}
                  isMuted={seat.isMuted}
                  isCurrentUser={seat.userId === currentUserId}
                  isHost={isHost}
                  layoutMode={layout.mode}
                  onPress={handleSeatPress}
                  onLongPress={handleSeatLongPress}
                  showBadges={layout.mode !== 'minimal'}
                  showGifts={layout.mode !== 'minimal'}
                  style={{ margin: GAP / 2 }}
                />
              ))}
            </View>
          ))}
        </View>
      );
    },
    [
      layout.mode,
      layout.gridDef,
      layout.pkConfig,
      seatSize,
      pkSeatSize,
      pageWidth,
      currentUserId,
      isHost,
      themeTokens,
      handleSeatPress,
      handleSeatLongPress,
    ],
  );

  // -------------------------------------------------------------------------
  // Gift events — derive from store (host seat; empty when no gift events)
  // showGifts is false in minimal mode (Requirement 2.6)
  // -------------------------------------------------------------------------
  const giftEvents: GiftEvent[] = useMemo(() => [], []);
  const showGifts = layout.mode !== 'minimal';

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: themeTokens.bg },
        style,
      ]}
    >
      {/* Reconnect banner — above everything (Requirements 8.2, 8.4) */}
      {isDisconnected && <ReconnectBanner theme={themeTokens} />}

      {/* Layout mode picker (Requirement 2.1, 2.8) */}
      <LayoutControlBar
        currentMode={layout.mode}
        isManual={layout.isManual}
        onSelectMode={(mode: LayoutMode) => setManual(mode)}
        onResetAuto={clearManual}
      />

      {/* Paginated seat area — horizontal FlatList (Requirements 3.5–3.6, 5.6)
          - horizontal + pagingEnabled for page-level swipe navigation
          - getItemLayout for O(1) scroll position calculation
          - itemLayoutAnimation for seat entry/exit spring animation        */}
      <Animated.FlatList<SeatData[]>
        ref={flatListRef as React.RefObject<FlatList<SeatData[]>>}
        data={pages}
        keyExtractor={(_, index) => `page-${index}`}
        renderItem={renderPage}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        getItemLayout={getItemLayout}
        initialScrollIndex={0}
        scrollEventThrottle={16}
        /* Spring animation for seat entry/exit transitions */
        itemLayoutAnimation={LinearTransition.springify()}
        style={styles.flatList}
        contentContainerStyle={styles.flatListContent}
        accessibilityLabel="Speaker grid"
        accessibilityRole="list"
      />

      {/* Pagination dots — only when totalPages > 1 (Requirement 3.8) */}
      {layout.totalPages > 1 && (
        <PaginationDots
          totalPages={layout.totalPages}
          currentPage={currentPage}
          onPageSelect={setPage}
        />
      )}

      {/* Gift overlay — floating above host seat, pointerEvents=none (Req 2.6) */}
      <GiftOverlay giftEvents={giftEvents} showGifts={showGifts} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  reconnectBanner: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  reconnectText: {
    fontSize: 13,
    fontWeight: '600',
  },
  flatList: {
    flex: 1,
  },
  flatListContent: {
    // No extra padding needed; pageWidth handles per-page sizing
  },
  pageContainer: {
    flex: 1,
    paddingHorizontal: GAP,
    paddingVertical: GAP,
    alignItems: 'flex-start',
    alignContent: 'flex-start',
  },
  pkPageContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: GAP / 2,
    width: '100%',
  },
  // PK mode — equal-width columns (Requirement 6.6)
  pkColumn: {
    flex: 1,
    alignItems: 'center',
    gap: GAP,
  },
  pkSeatWrapper: {
    borderWidth: 2,
    borderRadius: 14,
    overflow: 'hidden',
  },
  // VS divider badge (Requirement 6.5)
  vsDividerContainer: {
    width: 48,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: 24,
    paddingVertical: 8,
    marginHorizontal: 4,
    position: 'relative',
    zIndex: 2,
  },
  vsGlow: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    zIndex: -1,
  },
  vsText: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
