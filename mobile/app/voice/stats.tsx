/**
 * HALQA Mobile — Voice Club Stats
 * Ported from frontend/src/app/(dashboard)/voice-club/stats/page.tsx
 * Shows XP level card, all-time stats, 30-day bar chart, level roadmap,
 * recent rooms, and top-hosts leaderboard.
 */
import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Dimensions
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────
interface LevelInfo {
  level: number; title: string; emoji: string; color: string;
  totalXp: number; xpInLevel: number; xpNeeded: number; progress: number;
  next: { title: string; emoji: string; minXp: number } | null;
}
interface DayStats {
  date: string; roomsHosted: number; totalMinutes: number;
  peakAudience: number; totalListeners: number; totalSpeakers: number; totalMessages: number;
}
interface StatsData {
  level: LevelInfo;
  allTime: {
    roomsHosted: number; totalMinutes: number; totalListeners: number;
    totalSpeakers: number; totalMessages: number; peakAudience: number;
  };
  streak: number;
  chart: DayStats[];
  recentRooms: {
    id: string; title: string; coverEmoji: string; coverImageUrl?: string | null;
    topic: string | null; startedAt: string | null; endedAt: string | null;
    _count: { participants: number; messages: number };
  }[];
  levels: { level: number; title: string; emoji: string; minXp: number; color: string }[];
}
interface LeaderEntry {
  rank: number;
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
  totalXp: number; totalMinutes: number; roomsHosted: number; level: LevelInfo;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return iso; }
}
function fmtShort(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color }: {
  icon: string; label: string; value: string | number; sub?: string; color: string;
}) {
  return (
    <View style={[sc.statCard, { borderLeftColor: color }]}>
      <View style={[sc.statIcon, { backgroundColor: color + '20' }]}>
        <Text style={{ fontSize: 18 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={sc.statLabel} numberOfLines={1}>{label}</Text>
        <Text style={sc.statValue} numberOfLines={1}>{value}</Text>
        {sub ? <Text style={sc.statSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </View>
  );
}

// ─── XP progress bar ──────────────────────────────────────────────────────────
function XpBar({ progress, color }: { progress: number; color: string }) {
  return (
    <View style={sc.xpBarBg}>
      <View style={[sc.xpBarFill, { width: `${Math.min(progress, 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function VoiceStatsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();

  const { data: stats, isLoading } = useQuery<StatsData>({
    queryKey: ['voice-stats-me'],
    queryFn: () => api.get('/voice/stats/me').then(r => r.data.data),
    staleTime: 60_000,
  });

  const { data: leaderboard } = useQuery<LeaderEntry[]>({
    queryKey: ['voice-leaderboard'],
    queryFn: () => api.get('/voice/stats/leaderboard').then(r => r.data.data),
    staleTime: 120_000,
  });

  // Prepare chart labels (last 30 days, show every 5th)
  const chartData = useMemo(() => {
    if (!stats?.chart) return [];
    return stats.chart.map(d => ({
      day: fmtDate(d.date),
      rooms: d.roomsHosted,
      mins: d.totalMinutes,
    }));
  }, [stats?.chart]);

  if (isLoading || !stats) {
    return (
      <View style={sc.loadingContainer}>
        <ActivityIndicator size="large" color="#8b5cf6" />
        <Text style={sc.loadingText}>Loading stats…</Text>
      </View>
    );
  }

  const { level, allTime, streak, recentRooms, levels } = stats;
  const totalHours = Math.floor(allTime.totalMinutes / 60);
  const remainMins = allTime.totalMinutes % 60;
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <>
      <Stack.Screen options={{
        headerShown: true, title: 'My Stats',
        headerTintColor: '#8b5cf6',
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { color: '#111827', fontWeight: '800' },
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={22} color="#8b5cf6" />
          </TouchableOpacity>
        ),
      }} />
      <SafeAreaView style={sc.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={sc.scroll} showsVerticalScrollIndicator={false}>

          {/* ── Level card ────────────────────────────────────────────────── */}
          <View style={[sc.levelCard, { backgroundColor: level.color }]}>
            {/* Decorative circles */}
            <View style={sc.levelDecoCircle1} />
            <View style={sc.levelDecoCircle2} />

            <View style={sc.levelTop}>
              <View>
                <Text style={sc.levelSubLabel}>Your Level</Text>
                <View style={sc.levelTitleRow}>
                  <Text style={sc.levelEmoji}>{level.emoji}</Text>
                  <View>
                    <Text style={sc.levelTitle}>{level.title}</Text>
                    <Text style={sc.levelNum}>Level {level.level}</Text>
                  </View>
                </View>
              </View>
              <View style={sc.xpBadge}>
                <Text style={sc.xpBadgeLabel}>Total XP</Text>
                <Text style={sc.xpBadgeValue}>{level.totalXp.toLocaleString()}</Text>
              </View>
            </View>

            {level.next ? (
              <View style={{ marginTop: 12 }}>
                <View style={sc.xpBarLabels}>
                  <Text style={sc.xpBarLabelLeft}>{level.xpInLevel} XP</Text>
                  <Text style={sc.xpBarLabelRight}>{level.next.emoji} {level.next.title} at {level.next.minXp} XP</Text>
                </View>
                <XpBar progress={level.progress} color="rgba(255,255,255,0.9)" />
                <Text style={sc.xpProgressPct}>{level.progress}% to next level</Text>
              </View>
            ) : (
              <Text style={sc.maxLevel}>🏆 Maximum level reached!</Text>
            )}
          </View>

          {/* ── Streak + quick stats ─────────────────────────────────────── */}
          <View style={sc.streakCard}>
            <Ionicons name="flame" size={28} color="#fff" />
            <View>
              <Text style={sc.streakLabel}>Day Streak</Text>
              <Text style={sc.streakValue}>{streak}</Text>
              <Text style={sc.streakSub}>{streak === 1 ? 'day' : 'days'} in a row</Text>
            </View>
          </View>

          <View style={sc.statsGrid}>
            <StatCard icon="🎙️" label="Rooms Hosted"     value={allTime.roomsHosted}    color="#8b5cf6" />
            <StatCard
              icon="⏱️" label="Time on Air"
              value={totalHours > 0 ? `${totalHours}h ${remainMins}m` : `${allTime.totalMinutes}m`}
              color="#3b82f6"
            />
            <StatCard icon="👥" label="Total Listeners"  value={allTime.totalListeners} sub={`Peak: ${allTime.peakAudience}`} color="#10b981" />
            <StatCard icon="🎤" label="Speakers Promoted" value={allTime.totalSpeakers}  color="#f59e0b" />
            <StatCard icon="💬" label="Chat Messages"     value={allTime.totalMessages}  color="#ec4899" />
          </View>

          {/* ── Level roadmap ────────────────────────────────────────────── */}
          <View style={sc.section}>
            <Text style={sc.sectionTitle}>Level Roadmap</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {levels.map((l, i) => {
                const isReached  = level.totalXp >= l.minXp;
                const isCurrent  = level.level === l.level;
                return (
                  <React.Fragment key={l.level}>
                    <View style={[
                      sc.roadmapItem,
                      isCurrent  && { borderWidth: 2, borderColor: l.color },
                      !isReached && sc.roadmapItemDim,
                    ]}>
                      <Text style={{ fontSize: 20 }}>{l.emoji}</Text>
                      <Text style={sc.roadmapLabel} numberOfLines={1}>{l.title}</Text>
                      <Text style={sc.roadmapXp}>{l.minXp} XP</Text>
                    </View>
                    {i < levels.length - 1 && (
                      <View style={[sc.roadmapConnector, isReached && level.level > l.level && sc.roadmapConnectorFilled]} />
                    )}
                  </React.Fragment>
                );
              })}
            </ScrollView>
          </View>

          {/* ── 30-day activity chart ────────────────────────────────────── */}
          {chartData.length > 0 && (
            <View style={sc.section}>
              <Text style={sc.sectionTitle}>30-Day Activity</Text>
              <View style={sc.chartLegend}>
                <View style={sc.legendItem}><View style={[sc.legendDot, { backgroundColor: '#8b5cf6' }]} /><Text style={sc.legendTxt}>Rooms</Text></View>
                <View style={sc.legendItem}><View style={[sc.legendDot, { backgroundColor: '#60a5fa' }]} /><Text style={sc.legendTxt}>Minutes</Text></View>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ width: Math.max(SCREEN_W - 48, chartData.length * 28) }}>
                  {/* Simple bar chart using pure RN Views (no recharts needed) */}
                  {(() => {
                    const maxVal = Math.max(...chartData.map(d => Math.max(d.rooms, d.mins)), 1);
                    const barH = 100;
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: barH + 24, gap: 2 }}>
                        {chartData.map((d, i) => {
                          const showLabel = i % 5 === 0;
                          const rH = Math.round((d.rooms / maxVal) * barH);
                          const mH = Math.round((d.mins / maxVal) * barH);
                          return (
                            <View key={i} style={{ alignItems: 'center', flex: 1, gap: 1 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 1 }}>
                                <View style={{ width: 5, height: Math.max(rH, 2), backgroundColor: '#8b5cf6', borderRadius: 2 }} />
                                <View style={{ width: 5, height: Math.max(mH, 2), backgroundColor: '#60a5fa', borderRadius: 2 }} />
                              </View>
                              {showLabel
                                ? <Text style={sc.chartLabel} numberOfLines={1}>{d.day}</Text>
                                : <View style={{ height: 14 }} />
                              }
                            </View>
                          );
                        })}
                      </View>
                    );
                  })()}
                </View>
              </ScrollView>
            </View>
          )}

          {/* ── Recent rooms ─────────────────────────────────────────────── */}
          {recentRooms.length > 0 && (
            <View style={sc.section}>
              <Text style={sc.sectionTitle}>Recent Rooms</Text>
              {recentRooms.map(room => {
                const start = room.startedAt ? new Date(room.startedAt) : null;
                const end   = room.endedAt   ? new Date(room.endedAt)   : null;
                const mins  = start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : null;
                return (
                  <View key={room.id} style={sc.recentRoomRow}>
                    {room.coverImageUrl
                      ? <Image source={{ uri: room.coverImageUrl }} style={sc.recentRoomImg} />
                      : <Text style={{ fontSize: 22 }}>{room.coverEmoji ?? '🎙️'}</Text>
                    }
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={sc.recentRoomTitle} numberOfLines={1}>{room.title}</Text>
                      <Text style={sc.recentRoomMeta}>
                        {end ? fmtShort(end.toISOString()) : '—'}
                        {mins !== null ? ` · ${mins}m` : ''}
                      </Text>
                    </View>
                    <View style={sc.recentRoomCounts}>
                      <Text style={sc.recentRoomCount}>👥 {room._count.participants}</Text>
                      <Text style={sc.recentRoomCount}>💬 {room._count.messages}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* ── Leaderboard ──────────────────────────────────────────────── */}
          {leaderboard && leaderboard.length > 0 && (
            <View style={sc.section}>
              <View style={sc.sectionTitleRow}>
                <Text style={{ fontSize: 16 }}>🏆</Text>
                <Text style={sc.sectionTitle}>Top Hosts</Text>
              </View>
              {leaderboard.map(entry => {
                const isMe = entry.user?.id === user?.id;
                const initials = `${entry.user?.firstName?.charAt(0) ?? ''}${entry.user?.lastName?.charAt(0) ?? ''}`;
                const avSrc = entry.user?.avatarUrl;
                return (
                  <View key={entry.rank} style={[sc.leaderRow, isMe && sc.leaderRowMe]}>
                    <View style={[
                      sc.leaderRankBadge,
                      entry.rank === 1 ? { backgroundColor: '#f59e0b' } :
                      entry.rank === 2 ? { backgroundColor: '#9ca3af' } :
                      entry.rank === 3 ? { backgroundColor: '#fb923c' } :
                      { backgroundColor: '#f3f4f6' },
                    ]}>
                      <Text style={[sc.leaderRankTxt, entry.rank > 3 && { color: '#6b7280' }]}>
                        {entry.rank <= 3 ? medals[entry.rank - 1] : entry.rank}
                      </Text>
                    </View>
                    <View style={sc.leaderAvWrap}>
                      {avSrc
                        ? <Image source={{ uri: avatarUrl(avSrc, `${entry.user.firstName} ${entry.user.lastName}`) }} style={sc.leaderAv} />
                        : <Text style={sc.leaderAvInitials}>{initials}</Text>
                      }
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[sc.leaderName, isMe && { color: '#7c3aed' }]} numberOfLines={1}>
                        {isMe ? 'You' : `${entry.user?.firstName} ${entry.user?.lastName}`}
                      </Text>
                      <Text style={sc.leaderMeta}>{entry.roomsHosted} rooms · {entry.totalMinutes}m</Text>
                    </View>
                    <View style={[sc.levelPill, { borderColor: entry.level.color + '50', backgroundColor: entry.level.color + '15' }]}>
                      <Text style={[sc.levelPillTxt, { color: entry.level.color }]}>{entry.level.emoji} {entry.level.title}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* XP formula hint */}
          <Text style={sc.hint}>
            XP = Rooms×10 + Minutes×1 + Listeners×2 + Speakers×5 + Messages×1
          </Text>

        </ScrollView>
      </SafeAreaView>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f9fafb' },
  scroll:          { padding: 16, paddingBottom: 40, gap: 12 },
  loadingContainer:{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText:     { color: '#9ca3af', fontSize: 14 },

  // Level card
  levelCard:       { borderRadius: 20, padding: 20, overflow: 'hidden', position: 'relative' },
  levelDecoCircle1:{ position: 'absolute', top: -32, right: -32, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.15)' },
  levelDecoCircle2:{ position: 'absolute', bottom: -20, right: -10, width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.1)' },
  levelTop:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  levelSubLabel:   { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  levelTitleRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  levelEmoji:      { fontSize: 32 },
  levelTitle:      { color: '#fff', fontSize: 22, fontWeight: '900', lineHeight: 24 },
  levelNum:        { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 1 },
  xpBadge:         { alignItems: 'flex-end' },
  xpBadgeLabel:    { color: 'rgba(255,255,255,0.7)', fontSize: 10 },
  xpBadgeValue:    { color: '#fff', fontSize: 22, fontWeight: '900' },
  xpBarLabels:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  xpBarLabelLeft:  { color: 'rgba(255,255,255,0.7)', fontSize: 10 },
  xpBarLabelRight: { color: 'rgba(255,255,255,0.7)', fontSize: 10 },
  xpBarBg:         { height: 10, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 5, overflow: 'hidden' },
  xpBarFill:       { height: '100%', borderRadius: 5 },
  xpProgressPct:   { color: 'rgba(255,255,255,0.6)', fontSize: 10, textAlign: 'right', marginTop: 3 },
  maxLevel:        { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 10 },

  // Streak card
  streakCard:      { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#ef4444', borderRadius: 16, padding: 16 },
  streakLabel:     { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600' },
  streakValue:     { color: '#fff', fontSize: 36, fontWeight: '900', lineHeight: 38 },
  streakSub:       { color: 'rgba(255,255,255,0.7)', fontSize: 11 },

  // Stats grid
  statsGrid:       { gap: 8 },
  statCard:        { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#f3f4f6', borderLeftWidth: 4 },
  statIcon:        { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  statLabel:       { color: '#9ca3af', fontSize: 11, fontWeight: '600' },
  statValue:       { color: '#111827', fontSize: 20, fontWeight: '900', lineHeight: 22 },
  statSub:         { color: '#9ca3af', fontSize: 10, marginTop: 1 },

  // Section
  section:         { backgroundColor: '#fff', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#f3f4f6' },
  sectionTitle:    { fontSize: 14, fontWeight: '800', color: '#374151', marginBottom: 10 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },

  // Roadmap
  roadmapItem:     { alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 12, padding: 10, minWidth: 68, borderWidth: 1.5, borderColor: 'transparent' },
  roadmapItemDim:  { opacity: 0.4 },
  roadmapLabel:    { color: '#6b7280', fontSize: 10, fontWeight: '700', marginTop: 3, textAlign: 'center' },
  roadmapXp:       { color: '#9ca3af', fontSize: 9, marginTop: 1 },
  roadmapConnector:{ width: 16, height: 2, backgroundColor: '#e5e7eb', alignSelf: 'center', marginBottom: 12 },
  roadmapConnectorFilled: { backgroundColor: '#9ca3af' },

  // Chart
  chartLegend:     { flexDirection: 'row', gap: 12, marginBottom: 8 },
  legendItem:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:       { width: 10, height: 10, borderRadius: 3 },
  legendTxt:       { fontSize: 11, color: '#9ca3af' },
  chartLabel:      { fontSize: 8, color: '#9ca3af', marginTop: 2, textAlign: 'center' },

  // Recent rooms
  recentRoomRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  recentRoomImg:   { width: 32, height: 32, borderRadius: 8, backgroundColor: '#ede9fe' },
  recentRoomTitle: { fontSize: 13, fontWeight: '600', color: '#111827' },
  recentRoomMeta:  { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  recentRoomCounts:{ flexDirection: 'row', gap: 8 },
  recentRoomCount: { fontSize: 11, color: '#9ca3af' },

  // Leaderboard
  leaderRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderRadius: 12, paddingHorizontal: 6 },
  leaderRowMe:     { backgroundColor: '#ede9fe' },
  leaderRankBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  leaderRankTxt:   { fontSize: 12, fontWeight: '900', color: '#fff' },
  leaderAvWrap:    { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  leaderAv:        { width: 36, height: 36 },
  leaderAvInitials:{ fontSize: 12, fontWeight: '800', color: '#7c3aed' },
  leaderName:      { fontSize: 13, fontWeight: '700', color: '#111827' },
  leaderMeta:      { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  levelPill:       { borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 3 },
  levelPillTxt:    { fontSize: 10, fontWeight: '700' },

  // XP hint
  hint:            { fontSize: 11, color: '#9ca3af', textAlign: 'center', paddingVertical: 8 },
});

