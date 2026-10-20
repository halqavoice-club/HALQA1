/**
 * HALQA Mobile — Leaderboard
 * Global + School tabs, All-Time / Monthly / Weekly periods,
 * Top-3 podium, rank-change indicator, "my rank" banner.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';

type Period = 'ALL_TIME' | 'MONTHLY' | 'WEEKLY';

interface LeaderEntry {
  rank: number; previousRank?: number | null;
  totalCoins: number; totalDiamonds: number; totalGifts: number;
  totalPosts: number; totalFollowers: number; period: string;
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
}

const PERIODS: { label: string; value: Period }[] = [
  { label: 'All Time', value: 'ALL_TIME' },
  { label: 'Monthly',  value: 'MONTHLY'  },
  { label: 'Weekly',   value: 'WEEKLY'   },
];

const MEDALS = ['🥇', '🥈', '🥉'];

function RankChange({ current, previous }: { current: number; previous?: number | null }) {
  if (previous == null) return null;
  const diff = previous - current;
  if (diff === 0) return <Text style={lb.rankFlat}>—</Text>;
  return (
    <Text style={[lb.rankChange, { color: diff > 0 ? '#10b981' : '#ef4444' }]}>
      {diff > 0 ? `↑${diff}` : `↓${Math.abs(diff)}`}
    </Text>
  );
}

function PodiumBlock({ entry, height, bg }: { entry: LeaderEntry; height: number; bg: string }) {
  const src = entry.user.avatarUrl;
  const initials = `${entry.user.firstName?.charAt(0) ?? ''}${entry.user.lastName?.charAt(0) ?? ''}`;
  return (
    <View style={[lb.podiumCol]}>
      <View style={lb.podiumAvWrap}>
        {src
          ? <Image source={{ uri: avatarUrl(src, `${entry.user.firstName} ${entry.user.lastName}`) }} style={lb.podiumAv} />
          : <Text style={lb.podiumAvInitials}>{initials}</Text>}
      </View>
      <Text style={lb.podiumName} numberOfLines={1}>{entry.user.firstName}</Text>
      <Text style={lb.podiumCoins}>🪙 {entry.totalCoins.toLocaleString()}</Text>
      <View style={[lb.podiumBar, { height, backgroundColor: bg }]}>
        <Text style={lb.podiumRankTxt}>#{entry.rank}</Text>
      </View>
    </View>
  );
}

function LeaderRow({ entry, isMe }: { entry: LeaderEntry; isMe: boolean }) {
  const src = entry.user.avatarUrl;
  const initials = `${entry.user.firstName?.charAt(0) ?? ''}${entry.user.lastName?.charAt(0) ?? ''}`;
  return (
    <View style={[lb.row, isMe && lb.rowMe]}>
      <View style={lb.rankCol}>
        {entry.rank <= 3
          ? <Text style={{ fontSize: 18 }}>{MEDALS[entry.rank - 1]}</Text>
          : <Text style={[lb.rankNum, isMe && { color: '#4f46e5' }]}>#{entry.rank}</Text>}
      </View>
      <View style={lb.avWrap}>
        {src
          ? <Image source={{ uri: avatarUrl(src, `${entry.user.firstName} ${entry.user.lastName}`) }} style={lb.av} />
          : <Text style={[lb.avInitials, isMe && { color: '#4f46e5' }]}>{initials}</Text>}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[lb.name, isMe && { color: '#4f46e5' }]} numberOfLines={1}>
          {entry.user.firstName} {entry.user.lastName}{isMe ? ' (you)' : ''}
        </Text>
        <View style={lb.metaRow}>
          <Text style={lb.metaTxt}>🪙 {entry.totalCoins.toLocaleString()}</Text>
          <Text style={lb.metaTxt}>🎁 {entry.totalGifts}</Text>
          <Text style={lb.metaTxt}>👥 {entry.totalFollowers}</Text>
        </View>
      </View>
      <View style={lb.rightCol}>
        <RankChange current={entry.rank} previous={entry.previousRank} />
        <Text style={[lb.coinsVal, isMe && { color: '#4f46e5' }]}>{entry.totalCoins.toLocaleString()}</Text>
      </View>
    </View>
  );
}

export default function LeaderboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const [tab, setTab]       = useState<'global' | 'school'>('global');
  const [period, setPeriod] = useState<Period>('ALL_TIME');

  const schoolId = (user as any)?.schoolId ?? '';

  const { data: global = [], isLoading: gLoading, refetch: gRefetch } = useQuery<LeaderEntry[]>({
    queryKey: ['leaderboard-global', period],
    queryFn: () => api.get('/leaderboard/global', { params: { period, limit: 100 } }).then(r => r.data.data ?? []),
    staleTime: 60_000,
  });

  const { data: school = [], isLoading: sLoading, refetch: sRefetch } = useQuery<LeaderEntry[]>({
    queryKey: ['leaderboard-school', schoolId, period],
    queryFn: () => api.get(`/leaderboard/schools/${schoolId}`, { params: { period, limit: 100 } }).then(r => r.data.data ?? []),
    enabled: !!schoolId && tab === 'school',
    staleTime: 60_000,
  });

  const entries  = tab === 'global' ? global : school;
  const isLoading = tab === 'global' ? gLoading : sLoading;
  const refetch   = tab === 'global' ? gRefetch : sRefetch;
  const myEntry   = entries.find(e => e.user.id === user?.id);
  const top3      = entries.slice(0, 3);

  return (
    <>
      <Stack.Screen options={{
        headerShown: true, title: 'Leaderboard',
        headerTintColor: '#f59e0b',
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { color: '#111827', fontWeight: '900' },
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={22} color="#f59e0b" />
          </TouchableOpacity>
        ),
      }} />
      <SafeAreaView style={lb.container} edges={['bottom']}>
        {/* Tab switcher */}
        <View style={lb.tabBar}>
          {(['global', 'school'] as const).map(t => (
            <TouchableOpacity key={t} style={[lb.tabBtn, tab === t && lb.tabBtnActive]} onPress={() => setTab(t)}>
              <Text style={[lb.tabTxt, tab === t && lb.tabTxtActive]}>
                {t === 'global' ? '🌐 Global' : '🏫 My School'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Period pills */}
        <View style={lb.periodRow}>
          {PERIODS.map(p => (
            <TouchableOpacity
              key={p.value}
              style={[lb.periodBtn, period === p.value && lb.periodBtnActive]}
              onPress={() => setPeriod(p.value)}
            >
              <Text style={[lb.periodTxt, period === p.value && lb.periodTxtActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {isLoading ? (
          <View style={lb.center}><ActivityIndicator size="large" color="#f59e0b" /></View>
        ) : (
          <FlatList
            data={entries}
            keyExtractor={e => e.user.id}
            refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor="#f59e0b" />}
            contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
            ListHeaderComponent={
              <View>
                {/* My rank banner */}
                {myEntry && (
                  <View style={lb.myRankBanner}>
                    <Ionicons name="trophy" size={28} color="#fbbf24" />
                    <View style={{ flex: 1 }}>
                      <Text style={lb.myRankLabel}>Your Rank</Text>
                      <Text style={lb.myRankValue}>#{myEntry.rank}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={lb.myRankCoinsLabel}>Coins</Text>
                      <Text style={lb.myRankCoins}>{myEntry.totalCoins.toLocaleString()}</Text>
                    </View>
                    <RankChange current={myEntry.rank} previous={myEntry.previousRank} />
                  </View>
                )}

                {/* Podium — only when 3+ entries */}
                {top3.length >= 3 && (
                  <View style={lb.podiumRow}>
                    {/* 2nd place */}
                    <PodiumBlock entry={top3[1]} height={72} bg="#c0c0c0" />
                    {/* 1st place */}
                    <PodiumBlock entry={top3[0]} height={96} bg="#f59e0b" />
                    {/* 3rd place */}
                    <PodiumBlock entry={top3[2]} height={56} bg="#cd7f32" />
                  </View>
                )}

                {entries.length === 0 && (
                  <View style={lb.empty}>
                    <Ionicons name="trophy-outline" size={48} color="#d1d5db" />
                    <Text style={lb.emptyTxt}>No entries yet</Text>
                  </View>
                )}
              </View>
            }
            renderItem={({ item }) => (
              <LeaderRow entry={item} isMe={item.user.id === user?.id} />
            )}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const lb = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#f8fafc' },
  tabBar:           { flexDirection: 'row', backgroundColor: '#f1f5f9', margin: 12, borderRadius: 14, padding: 3 },
  tabBtn:           { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 11 },
  tabBtnActive:     { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  tabTxt:           { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  tabTxtActive:     { color: '#111827', fontWeight: '800' },
  periodRow:        { flexDirection: 'row', gap: 8, paddingHorizontal: 12, marginBottom: 8 },
  periodBtn:        { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 20, backgroundColor: '#f1f5f9' },
  periodBtnActive:  { backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#f59e0b' },
  periodTxt:        { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  periodTxtActive:  { color: '#92400e', fontWeight: '700' },
  myRankBanner:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#4f46e5', borderRadius: 16, margin: 12, padding: 16 },
  myRankLabel:      { color: 'rgba(255,255,255,0.75)', fontSize: 11 },
  myRankValue:      { color: '#fff', fontSize: 26, fontWeight: '900', lineHeight: 28 },
  myRankCoinsLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10 },
  myRankCoins:      { color: '#fff', fontSize: 18, fontWeight: '800' },
  rankFlat:         { fontSize: 10, color: '#9ca3af' },
  rankChange:       { fontSize: 11, fontWeight: '800' },
  podiumRow:        { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 8, padding: 16, paddingBottom: 0 },
  podiumCol:        { alignItems: 'center', width: 90 },
  podiumAvWrap:     { width: 48, height: 48, borderRadius: 24, backgroundColor: '#e0e7ff', overflow: 'hidden', justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  podiumAv:         { width: 48, height: 48 },
  podiumAvInitials: { fontSize: 16, fontWeight: '800', color: '#4f46e5' },
  podiumName:       { fontSize: 11, fontWeight: '700', color: '#374151', textAlign: 'center', maxWidth: 80 },
  podiumCoins:      { fontSize: 10, color: '#6b7280', marginBottom: 4 },
  podiumBar:        { width: '100%', borderTopLeftRadius: 8, borderTopRightRadius: 8, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 },
  podiumRankTxt:    { color: '#fff', fontSize: 14, fontWeight: '900' },
  row:              { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 14, marginHorizontal: 12, marginBottom: 6, padding: 12, borderWidth: 1, borderColor: '#f1f5f9' },
  rowMe:            { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' },
  rankCol:          { width: 32, alignItems: 'center', flexShrink: 0 },
  rankNum:          { fontSize: 13, fontWeight: '700', color: '#9ca3af' },
  avWrap:           { width: 38, height: 38, borderRadius: 19, backgroundColor: '#e0e7ff', overflow: 'hidden', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  av:               { width: 38, height: 38 },
  avInitials:       { fontSize: 13, fontWeight: '800', color: '#4f46e5' },
  name:             { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  metaRow:          { flexDirection: 'row', gap: 8, marginTop: 2 },
  metaTxt:          { fontSize: 10, color: '#94a3b8' },
  rightCol:         { alignItems: 'flex-end', flexShrink: 0 },
  coinsVal:         { fontSize: 13, fontWeight: '800', color: '#374151' },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  empty:            { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTxt:         { fontSize: 15, color: '#94a3b8', marginTop: 12 },
});

