/**
 * HALQA Mobile — Gift Leaderboard (Voice Room)
 * Compact header widget + full bottom sheet popover.
 *
 * Usage:
 *   <GiftLeaderboard leaderboard={leaderboard} />
 *
 * leaderboard = array of { userId, totalCoins, giftCount, user: { firstName, lastName, avatarUrl } }
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  Modal, Image, Pressable
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { avatarUrl } from '@/lib/avatar';

const RANK_ICONS  = ['🥇', '🥈', '🥉'];
const RANK_COLORS = ['#fbbf24', '#9ca3af', '#cd7f32'];

export interface LeaderEntry {
  userId: string;
  totalCoins: number;
  giftCount: number;
  user: { id?: string; firstName: string; lastName: string; avatarUrl: string | null };
}

interface Props {
  leaderboard: LeaderEntry[];
}

function Avatar({ entry, size, showGoldRing }: { entry: LeaderEntry; size: number; showGoldRing?: boolean }) {
  const src = entry.user.avatarUrl;
  const initials = `${entry.user.firstName[0] ?? ''}${entry.user.lastName[0] ?? ''}`.toUpperCase();
  return (
    <View style={[gl.av, { width: size, height: size, borderRadius: size / 2 }, showGoldRing && gl.goldRing]}>
      {src
        ? <Image source={{ uri: avatarUrl(src, `${entry.user.firstName} ${entry.user.lastName}`) }}
            style={{ width: size, height: size, borderRadius: size / 2 }} />
        : <Text style={[gl.initials, { fontSize: size * 0.36 }]}>{initials}</Text>
      }
    </View>
  );
}

export function GiftLeaderboard({ leaderboard }: Props) {
  const [open, setOpen] = useState(false);

  if (!leaderboard || leaderboard.length === 0) return null;

  const top3 = leaderboard.slice(0, 3);

  return (
    <>
      {/* Compact trigger — stacked avatars + trophy */}
      <TouchableOpacity style={gl.trigger} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <View style={gl.avatarStack}>
          {top3.map((entry, i) => (
            <View key={entry.userId} style={[gl.stackSlot, { marginLeft: i === 0 ? 0 : -8, zIndex: 3 - i }]}>
              <Avatar entry={entry} size={28} showGoldRing={i === 0} />
            </View>
          ))}
        </View>
        <Text style={gl.trophy}>🏆</Text>
      </TouchableOpacity>

      {/* Full leaderboard modal */}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={gl.backdrop} onPress={() => setOpen(false)} />
        <View style={gl.sheet}>
          {/* Handle */}
          <View style={gl.handle} />

          {/* Header */}
          <View style={gl.sheetHeader}>
            <Text style={gl.sheetTitle}>🏆 Top Supporters</Text>
            <TouchableOpacity onPress={() => setOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          {/* List */}
          <FlatList
            data={leaderboard.slice(0, 10)}
            keyExtractor={e => e.userId}
            contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 32 }}
            renderItem={({ item: entry, index: i }) => {
              const rankIcon  = RANK_ICONS[i]  ?? `#${i + 1}`;
              const rankColor = RANK_COLORS[i] ?? '#6b7280';
              return (
                <View style={gl.row}>
                  <Text style={[gl.rankIcon, { color: rankColor }]}>{rankIcon}</Text>
                  <Avatar entry={entry} size={40} showGoldRing={i === 0} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={gl.name} numberOfLines={1}>
                      {entry.user.firstName} {entry.user.lastName}
                    </Text>
                    <Text style={gl.giftCount}>
                      {entry.giftCount} gift{entry.giftCount !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <View style={gl.coinsWrap}>
                    <Text style={gl.coinsText}>🪙 {entry.totalCoins.toLocaleString()}</Text>
                  </View>
                </View>
              );
            }}
          />
        </View>
      </Modal>
    </>
  );
}

const gl = StyleSheet.create({
  trigger:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  avatarStack:  { flexDirection: 'row' },
  stackSlot:    { borderRadius: 14, overflow: 'visible' },
  av:           { backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  goldRing:     { borderWidth: 2, borderColor: '#fbbf24' },
  initials:     { color: '#fff', fontWeight: '800' },
  trophy:       { fontSize: 16 },
  backdrop:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet:        { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '75%' },
  handle:       { width: 40, height: 4, backgroundColor: '#374151', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  sheetHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1e1e3a' },
  sheetTitle:   { fontSize: 16, fontWeight: '800', color: '#e5e7eb' },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#111827', borderRadius: 14, padding: 12 },
  rankIcon:     { fontSize: 20, minWidth: 28, textAlign: 'center' },
  name:         { fontSize: 14, fontWeight: '700', color: '#e5e7eb' },
  giftCount:    { fontSize: 11, color: '#6b7280', marginTop: 2 },
  coinsWrap:    { backgroundColor: '#1e1040', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  coinsText:    { fontSize: 12, fontWeight: '700', color: '#a5b4fc' },
});

