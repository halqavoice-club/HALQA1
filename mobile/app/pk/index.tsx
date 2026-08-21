/**
 * PK Hub Screen — mobile/app/pk/index.tsx
 * Shows matchmaking, leaderboard, and history.
 * Route: /pk (navigated from voice tab or notification)
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import api from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';

const RANK_COLORS: Record<string, string> = {
  BRONZE: '#CD7F32', SILVER: '#C0C0C0', GOLD: '#FFD700',
  PLATINUM: '#00CED1', DIAMOND: '#4169E1', MASTER: '#9400D3',
  GRANDMASTER: '#DC143C',
};

const DURATIONS = [
  { label: '1m',  value: 60  },
  { label: '3m',  value: 180 },
  { label: '5m',  value: 300 },
  { label: '10m', value: 600 },
];

export default function PKHubScreen() {
  const router   = useRouter();
  const { user } = useAuthStore();

  const [tab,         setTab]         = useState<'leaderboard' | 'history'>('leaderboard');
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [history,     setHistory]     = useState<any[]>([]);
  const [myStats,     setMyStats]     = useState<any>(null);
  const [loading,     setLoading]     = useState(true);
  const [inQueue,     setInQueue]     = useState(false);
  const [queueTime,   setQueueTime]   = useState(0);
  const [duration,    setDuration]    = useState(300);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Promise.all([
      api.get('/pk/leaderboards?scope=weekly&limit=20'),
      api.get('/pk/history?limit=10'),
      user?.id ? api.get(`/pk/stats/${user.id}`) : Promise.resolve(null),
    ]).then(([lb, hist, stats]) => {
      setLeaderboard(lb.data.data?.leaderboard || []);
      setHistory(hist.data.data || []);
      if (stats) setMyStats(stats.data.data || null);
    }).finally(() => setLoading(false));

    // Socket: match found
    const socket = getSocket();
    if (socket) {
      const handler = (data: { pkMatchId: string }) => {
        clearQueueTimer();
        setInQueue(false);
        router.push(`/pk/${data.pkMatchId}` as any);
      };
      socket.on('pk:matched', handler);
      return () => { socket.off('pk:matched', handler); };
    }
  }, []); // eslint-disable-line

  function clearQueueTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setQueueTime(0);
  }

  const joinMatchmaking = async () => {
    try {
      await api.post('/pk/matchmaking/join', { type: 'ONE_V_ONE', durationSeconds: duration });
      setInQueue(true);
      timerRef.current = setInterval(() => setQueueTime(t => t + 1), 1000);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message || 'Could not join queue');
    }
  };

  const leaveMatchmaking = async () => {
    try {
      await api.post('/pk/matchmaking/leave');
    } catch {}
    clearQueueTimer();
    setInQueue(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>⚔️ PK Battle</Text>
      </View>

      {/* My Stats */}
      {myStats && (
        <View style={styles.statsCard}>
          <View>
            <Text style={styles.rankLabel}>MY RANK</Text>
            <Text style={[styles.rankValue, { color: RANK_COLORS[myStats.rank] || '#fff' }]}>
              {myStats.rank}
            </Text>
            <Text style={styles.ratingText}>Rating: {myStats.rating}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.wlText}>{myStats.wins}W – {myStats.losses}L</Text>
            <Text style={styles.subText}>
              {myStats.totalPKs > 0 ? Math.round((myStats.wins / myStats.totalPKs) * 100) : 0}% win rate
            </Text>
            <Text style={styles.subText}>Streak: {myStats.currentStreak > 0 ? `+${myStats.currentStreak}` : myStats.currentStreak}</Text>
          </View>
        </View>
      )}

      {/* Duration selector */}
      {!inQueue && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Match Duration</Text>
          <View style={styles.durationRow}>
            {DURATIONS.map(d => (
              <TouchableOpacity
                key={d.value}
                onPress={() => setDuration(d.value)}
                style={[styles.durationBtn, duration === d.value && styles.durationBtnActive]}
              >
                <Text style={[styles.durationText, duration === d.value && { color: '#fff' }]}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Matchmaking button */}
      {inQueue ? (
        <View style={styles.queueCard}>
          <Text style={styles.queueText}>🔍 Searching for opponent...</Text>
          <Text style={styles.queueTime}>
            {Math.floor(queueTime / 60).toString().padStart(2, '0')}:
            {(queueTime % 60).toString().padStart(2, '0')}
          </Text>
          <TouchableOpacity onPress={leaveMatchmaking} style={styles.cancelBtn}>
            <Text style={styles.cancelBtnText}>Cancel Search</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity onPress={joinMatchmaking} style={styles.findBtn}>
          <Text style={styles.findBtnText}>⚔️ Find Opponent</Text>
        </TouchableOpacity>
      )}

      {/* Tabs */}
      <View style={styles.tabBar}>
        {(['leaderboard', 'history'] as const).map(t => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'leaderboard' ? '🏆 Rankings' : '📜 History'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Leaderboard */}
      {tab === 'leaderboard' && leaderboard.map((entry: any, i: number) => (
        <View key={entry.userId} style={styles.listItem}>
          <Text style={styles.rank}>{i + 1}</Text>
          <View style={styles.avatar}>
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>{entry.user?.firstName?.[0] || '?'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{entry.user?.firstName} {entry.user?.lastName}</Text>
            <Text style={styles.subText}>{entry.wins}W · {entry.score?.toLocaleString()} pts</Text>
          </View>
          <Text style={styles.ratingChip}>{entry.rating}</Text>
        </View>
      ))}

      {/* History */}
      {tab === 'history' && history.map((h: any) => (
        <TouchableOpacity
          key={h.id}
          style={styles.listItem}
          onPress={() => router.push(`/pk/${h.pkMatchId}` as any)}
        >
          <Text style={styles.resultIcon}>
            {h.winnerSide === 'DRAW' ? '🤝' : h.winnerId === user?.id ? '🏆' : '💪'}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {h.winnerSide === 'DRAW' ? 'Draw' : h.winnerId === user?.id ? 'Victory' : 'Defeat'}
            </Text>
            <Text style={styles.subText}>{new Date(h.createdAt).toLocaleDateString()}</Text>
          </View>
          <Text style={styles.scoreText}>{h.scoreA?.toLocaleString()} vs {h.scoreB?.toLocaleString()}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#0f172a' },
  center:        { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  header:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 56 },
  title:         { fontSize: 22, fontWeight: '800', color: '#fff' },
  statsCard:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 16, margin: 16, padding: 16 },
  rankLabel:     { color: '#94a3b8', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  rankValue:     { fontSize: 22, fontWeight: '900' },
  ratingText:    { color: '#64748b', fontSize: 11, marginTop: 2 },
  wlText:        { color: '#e2e8f0', fontWeight: '700', fontSize: 14 },
  subText:       { color: '#64748b', fontSize: 11, marginTop: 2 },
  section:       { paddingHorizontal: 16, marginBottom: 8 },
  sectionTitle:  { color: '#94a3b8', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  durationRow:   { flexDirection: 'row', gap: 8 },
  durationBtn:   { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#1e293b', alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  durationBtnActive: { backgroundColor: '#4f46e5', borderColor: '#6366f1' },
  durationText:  { color: '#94a3b8', fontWeight: '600' },
  findBtn:       { backgroundColor: '#4f46e5', margin: 16, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  findBtnText:   { color: '#fff', fontWeight: '800', fontSize: 16 },
  queueCard:     { margin: 16, backgroundColor: '#1e293b', borderRadius: 16, padding: 24, alignItems: 'center', gap: 8 },
  queueText:     { color: '#e2e8f0', fontWeight: '700', fontSize: 16 },
  queueTime:     { color: '#6366f1', fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  cancelBtn:     { marginTop: 8, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#334155' },
  cancelBtnText: { color: '#94a3b8', fontWeight: '600' },
  tabBar:        { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, marginBottom: 4, backgroundColor: '#1e293b', borderRadius: 12, padding: 4 },
  tab:           { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive:     { backgroundColor: '#4f46e5' },
  tabText:       { color: '#64748b', fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: '#fff' },
  listItem:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  rank:          { color: '#475569', fontWeight: '900', fontSize: 16, width: 24, textAlign: 'center' },
  avatar:        { width: 36, height: 36, borderRadius: 18, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center' },
  name:          { color: '#e2e8f0', fontWeight: '700', fontSize: 14 },
  ratingChip:    { color: '#6366f1', fontWeight: '700' },
  resultIcon:    { fontSize: 22, width: 32, textAlign: 'center' },
  scoreText:     { color: '#94a3b8', fontSize: 12, fontVariant: ['tabular-nums'] },
});
