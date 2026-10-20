/**
 * PK Battle Screen — mobile/app/pk/[id].tsx
 * Renders the live battle for a given match ID.
 * All scoring is server-authoritative via Socket.IO.
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  Dimensions, Alert, ActivityIndicator
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';
import { usePKStore } from '@/store/pk.store';
import api from '@/lib/api';

const { width: SW } = Dimensions.get('window');

type PKState = 'PREPARING' | 'COUNTDOWN' | 'LIVE' | 'PAUSED' | 'FINISHING' | 'COMPLETED' | 'ABORTED';

interface MatchData {
  id:             string;
  state:          PKState;
  scoreA:         number;
  scoreB:         number;
  giftScoreA:     number;
  giftScoreB:     number;
  voteScoreA:     number;
  voteScoreB:     number;
  durationSeconds: number;
  winnerId:       string | null;
  winnerSide:     string | null;
  participants:   Array<{ userId: string; side: string; role: string; user?: { firstName: string; lastName: string; avatarUrl?: string } }>;
}

export default function PKBattleScreen() {
  const { id }   = useLocalSearchParams<{ id: string }>();
  const router   = useRouter();
  const { user } = useAuthStore();
  const { setActiveMatch, clearMatch } = usePKStore();

  const [match,    setMatch]    = useState<MatchData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [remaining, setRemaining] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [voteA,    setVoteA]    = useState(0);
  const [voteB,    setVoteB]    = useState(0);
  const [showWinner, setShowWinner] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scoreBarAnim = useRef(new Animated.Value(0.5)).current;

  // Load match
  useEffect(() => {
    if (!id) return;
    api.get(`/pk/${id}`).then(r => {
      const m = r.data.data;
      setMatch(m);
      setActiveMatch(m);       // sync to store
      setRemaining(m.durationSeconds);
      setVoteA(m.voteScoreA || 0);
      setVoteB(m.voteScoreB || 0);
    }).finally(() => setLoading(false));

    return () => {
      stopTimer();
      clearMatch();             // clear store on unmount
    };
  }, [id]); // eslint-disable-line

  // Animate score bar when scores change
  useEffect(() => {
    if (!match) return;
    const total = match.scoreA + match.scoreB;
    const pct   = total > 0 ? match.scoreA / total : 0.5;
    Animated.timing(scoreBarAnim, {
      toValue: pct,
      duration: 500,
      useNativeDriver: false,
    }).start();
  }, [match?.scoreA, match?.scoreB]); // eslint-disable-line

  // Socket
  useEffect(() => {
    if (!id) return;
    const socket = getSocket();
    if (!socket) return;

    socket.emit('pk:join', id);

    const onState = (data: any) => {
      if (data.pkMatchId !== id) return;
      setMatch(prev => prev ? { ...prev, ...data } : data);
      if (data.remainingSeconds !== undefined) {
        setRemaining(data.remainingSeconds);
        if (data.state === 'LIVE') startTimer(data.remainingSeconds);
      }
    };

    const onCountdown = (data: any) => {
      if (data.pkMatchId !== id) return;
      setCountdown(data.seconds);
    };

    const onStarted = (data: any) => {
      if (data.pkMatchId !== id) return;
      setMatch(prev => prev ? { ...prev, state: 'LIVE' } : prev);
      setCountdown(null);
      setRemaining(data.remainingSeconds || data.durationSeconds);
      startTimer(data.remainingSeconds || data.durationSeconds);
    };

    const onScore = (data: any) => {
      if (data.pkMatchId !== id) return;
      setMatch(prev => prev ? { ...prev, scoreA: data.scoreA, scoreB: data.scoreB, giftScoreA: data.giftScoreA, giftScoreB: data.giftScoreB } : prev);
    };

    const onVote = (data: any) => {
      if (data.pkMatchId !== id) return;
      setVoteA(data.voteScoreA);
      setVoteB(data.voteScoreB);
    };

    const onTimer = (data: any) => {
      if (data.pkMatchId !== id) return;
      setRemaining(data.remainingSeconds);
    };

    const onPaused = (data: any) => {
      if (data.pkMatchId !== id) return;
      stopTimer();
      setMatch(prev => prev ? { ...prev, state: 'PAUSED' } : prev);
    };

    const onResumed = (data: any) => {
      if (data.pkMatchId !== id) return;
      setMatch(prev => prev ? { ...prev, state: 'LIVE' } : prev);
      setRemaining(data.remainingSeconds);
      startTimer(data.remainingSeconds);
    };

    const onWinner = (data: any) => {
      if (data.pkMatchId !== id) return;
      stopTimer();
      setMatch(prev => prev ? { ...prev, winnerId: data.winnerId, winnerSide: data.winnerSide, state: 'COMPLETED', scoreA: data.scoreA, scoreB: data.scoreB } : prev);
      setTimeout(() => setShowWinner(true), 500);
    };

    const onEnded = (data: any) => {
      if (data.pkMatchId !== id) return;
      stopTimer();
      setMatch(prev => prev ? { ...prev, state: data.state } : prev);
    };

    socket.on('pk:state',     onState);
    socket.on('pk:countdown', onCountdown);
    socket.on('pk:started',   onStarted);
    socket.on('pk:score',     onScore);
    socket.on('pk:vote',      onVote);
    socket.on('pk:timer',     onTimer);
    socket.on('pk:paused',    onPaused);
    socket.on('pk:resumed',   onResumed);
    socket.on('pk:winner',    onWinner);
    socket.on('pk:ended',     onEnded);

    return () => {
      socket.emit('pk:leave', id);
      socket.off('pk:state',     onState);
      socket.off('pk:countdown', onCountdown);
      socket.off('pk:started',   onStarted);
      socket.off('pk:score',     onScore);
      socket.off('pk:vote',      onVote);
      socket.off('pk:timer',     onTimer);
      socket.off('pk:paused',    onPaused);
      socket.off('pk:resumed',   onResumed);
      socket.off('pk:winner',    onWinner);
      socket.off('pk:ended',     onEnded);
    };
  }, [id]); // eslint-disable-line

  function startTimer(seconds: number) {
    stopTimer();
    if (seconds <= 0) return;
    timerRef.current = setInterval(() => {
      setRemaining(s => {
        if (s <= 1) { stopTimer(); return 0; }
        return s - 1;
      });
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  const castVote = useCallback(async (side: 'A' | 'B') => {
    try {
      await api.post(`/pk/${id}/vote`, { side });
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message || 'Could not cast vote');
    }
  }, [id]);

  const startBattle = useCallback(async () => {
    try { await api.post(`/pk/${id}/start`); } catch {}
  }, [id]);

  const handleRematch = useCallback(async () => {
    try {
      const r = await api.post(`/pk/${id}/rematch`);
      const newMatch = r.data.data;
      router.replace(`/pk/${newMatch.id}` as any);
    } catch { Alert.alert('Error', 'Could not create rematch'); }
  }, [id, router]);

  if (loading || !match) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  const mySide      = match.participants.find(p => p.userId === user?.id)?.side;
  const sideAUser   = match.participants.find(p => p.side === 'A')?.user;
  const sideBUser   = match.participants.find(p => p.side === 'B')?.user;
  const isLive      = match.state === 'LIVE';
  const isPaused    = match.state === 'PAUSED';
  const isDone      = match.state === 'COMPLETED' || match.state === 'ABORTED';
  const isFinal30   = remaining <= 30 && remaining > 0 && isLive;
  const total       = match.scoreA + match.scoreB;
  const pctA        = total > 0 ? (match.scoreA / total) * 100 : 50;
  const pctB        = 100 - pctA;
  const mins        = Math.floor(remaining / 60);
  const secs        = remaining % 60;

  return (
    <View style={s.container}>
      {/* State badge */}
      <View style={[s.stateBadge, isLive && s.stateLive, isPaused && s.statePaused, isDone && s.stateDone]}>
        <Text style={s.stateText}>{match.state.replace('_', ' ')}</Text>
      </View>

      {/* Countdown overlay */}
      {countdown !== null && countdown > 0 && (
        <View style={s.countdownOverlay}>
          <Text style={s.countdownNum}>{countdown}</Text>
        </View>
      )}

      {/* Winner overlay */}
      {showWinner && (
        <View style={s.winnerOverlay}>
          <Text style={s.winnerEmoji}>
            {match.winnerId === user?.id ? '🏆' : match.winnerSide === 'DRAW' ? '🤝' : '💪'}
          </Text>
          <Text style={s.winnerTitle}>
            {match.winnerId === user?.id ? 'YOU WON!' : match.winnerSide === 'DRAW' ? 'DRAW!' : 'MATCH OVER'}
          </Text>
          <Text style={s.winnerScore}>
            {match.scoreA.toLocaleString()} vs {match.scoreB.toLocaleString()}
          </Text>
          <TouchableOpacity onPress={handleRematch} style={s.rematchBtn}>
            <Text style={s.rematchBtnText}>⚔️ Rematch</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} style={s.exitBtn}>
            <Text style={s.exitBtnText}>Exit</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Timer */}
      {(isLive || isPaused) && (
        <Text style={[s.timer, isFinal30 && s.timerFinal, isPaused && s.timerPaused]}>
          {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
          {isPaused ? '  ⏸' : ''}
        </Text>
      )}

      {/* Players */}
      <View style={s.players}>
        <View style={s.player}>
          <View style={[s.avatar, { backgroundColor: '#be123c' }]}>
            <Text style={s.avatarText}>{sideAUser?.firstName?.[0] || 'A'}</Text>
          </View>
          <Text style={s.playerName} numberOfLines={1}>
            {sideAUser ? `${sideAUser.firstName}` : 'Side A'}
          </Text>
        </View>
        <Text style={s.vs}>VS</Text>
        <View style={s.player}>
          <View style={[s.avatar, { backgroundColor: '#1d4ed8' }]}>
            <Text style={s.avatarText}>{sideBUser?.firstName?.[0] || 'B'}</Text>
          </View>
          <Text style={s.playerName} numberOfLines={1}>
            {sideBUser ? `${sideBUser.firstName}` : 'Side B'}
          </Text>
        </View>
      </View>

      {/* Score */}
      <View style={s.scoreRow}>
        <Text style={[s.score, match.scoreA >= match.scoreB && s.scoreLeading]}>
          {match.scoreA.toLocaleString()}
        </Text>
        <Text style={s.scoreSep}>–</Text>
        <Text style={[s.score, match.scoreB >= match.scoreA && s.scoreLeading]}>
          {match.scoreB.toLocaleString()}
        </Text>
      </View>

      {/* Progress bar */}
      <View style={s.barContainer}>
        <View style={[s.barA, { width: `${pctA}%` }]} />
        <View style={[s.barB, { width: `${pctB}%` }]} />
      </View>

      {/* Votes */}
      <View style={s.voteRow}>
        <Text style={s.voteText}>🗳️ {voteA}</Text>
        <Text style={s.voteSep}>audience votes</Text>
        <Text style={s.voteText}>{voteB} 🗳️</Text>
      </View>

      {/* Vote buttons (audience only, live) */}
      {isLive && !mySide && (
        <View style={s.voteButtons}>
          <TouchableOpacity onPress={() => castVote('A')} style={s.voteBtnA}>
            <Text style={s.voteBtnText}>Vote A</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => castVote('B')} style={s.voteBtnB}>
            <Text style={s.voteBtnText}>Vote B</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Start button */}
      {match.state === 'PREPARING' && mySide === 'A' && (
        <TouchableOpacity onPress={startBattle} style={s.startBtn}>
          <Text style={s.startBtnText}>⚔️ Start Battle!</Text>
        </TouchableOpacity>
      )}

      {/* Gift detail */}
      {(isLive || isDone) && (
        <View style={s.giftDetail}>
          <Text style={s.giftDetailText}>🎁 {match.giftScoreA.toLocaleString()} | {match.giftScoreB.toLocaleString()} 🎁</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0f172a', alignItems: 'center', paddingTop: 60, paddingHorizontal: 20 },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  stateBadge:      { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20, backgroundColor: '#334155', marginBottom: 12 },
  stateLive:       { backgroundColor: '#16a34a' },
  statePaused:     { backgroundColor: '#d97706' },
  stateDone:       { backgroundColor: '#475569' },
  stateText:       { color: '#fff', fontWeight: '700', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  countdownOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 99 },
  countdownNum:    { fontSize: 120, fontWeight: '900', color: '#fff', textShadowColor: '#6366f1', textShadowRadius: 20 },
  winnerOverlay:   { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100, gap: 12 },
  winnerEmoji:     { fontSize: 64 },
  winnerTitle:     { fontSize: 28, fontWeight: '900', color: '#ffd700' },
  winnerScore:     { fontSize: 22, fontWeight: '700', color: '#e2e8f0', fontVariant: ['tabular-nums'] },
  rematchBtn:      { backgroundColor: '#4f46e5', paddingHorizontal: 40, paddingVertical: 14, borderRadius: 14, marginTop: 8 },
  rematchBtnText:  { color: '#fff', fontWeight: '800', fontSize: 16 },
  exitBtn:         { paddingHorizontal: 24, paddingVertical: 10 },
  exitBtnText:     { color: '#64748b', fontWeight: '600' },
  timer:           { fontSize: 56, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'], marginBottom: 16 },
  timerFinal:      { color: '#ef4444' },
  timerPaused:     { color: '#f59e0b' },
  players:         { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20, width: '100%', justifyContent: 'center' },
  player:          { alignItems: 'center', gap: 6, flex: 1 },
  avatar:          { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  avatarText:      { color: '#fff', fontWeight: '900', fontSize: 22 },
  playerName:      { color: '#e2e8f0', fontWeight: '700', fontSize: 13, maxWidth: 90, textAlign: 'center' },
  vs:              { color: '#475569', fontWeight: '900', fontSize: 18 },
  scoreRow:        { flexDirection: 'row', alignItems: 'center', gap: 24, marginBottom: 12 },
  score:           { fontSize: 36, fontWeight: '900', color: '#94a3b8', fontVariant: ['tabular-nums'] },
  scoreLeading:    { color: '#fff' },
  scoreSep:        { color: '#334155', fontSize: 28 },
  barContainer:    { flexDirection: 'row', width: SW - 40, height: 10, borderRadius: 6, overflow: 'hidden', backgroundColor: '#1e293b', marginBottom: 8 },
  barA:            { height: '100%', backgroundColor: '#be123c' },
  barB:            { height: '100%', backgroundColor: '#1d4ed8' },
  voteRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  voteText:        { color: '#94a3b8', fontSize: 12 },
  voteSep:         { color: '#334155', fontSize: 11 },
  voteButtons:     { flexDirection: 'row', gap: 12, marginBottom: 20 },
  voteBtnA:        { flex: 1, paddingVertical: 12, backgroundColor: '#be123c', borderRadius: 12, alignItems: 'center' },
  voteBtnB:        { flex: 1, paddingVertical: 12, backgroundColor: '#1d4ed8', borderRadius: 12, alignItems: 'center' },
  voteBtnText:     { color: '#fff', fontWeight: '700' },
  startBtn:        { backgroundColor: '#4f46e5', paddingHorizontal: 48, paddingVertical: 16, borderRadius: 14 },
  startBtnText:    { color: '#fff', fontWeight: '800', fontSize: 16 },
  giftDetail:      { marginTop: 12 },
  giftDetailText:  { color: '#475569', fontSize: 12, fontVariant: ['tabular-nums'] },
});

