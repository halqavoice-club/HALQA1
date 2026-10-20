/**
 * PKComponents — Mobile PK Battle UI for Voice Club
 * MobilePKPanel  — Bottom-sheet to challenge a speaker or enter matchmaking
 * MobilePKBanner — TikTok-style sticky PK header (timer, scores, gift badges)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ScrollView, Image, ActivityIndicator, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { usePKStore } from '@/store/pk.store';
import { avatarUrl as buildAvatarUrl } from '@/lib/avatar';

interface Speaker {
  id: string;
  name: string;
  avatar?: string | null;
  role: string;
  seatNumber: number | null;
  isActive: boolean;
}

interface PKBannerParticipant {
  userId: string;
  side: 'A' | 'B';
  user: { firstName: string; lastName: string; avatarUrl: string | null };
}

const DURATIONS = [
  { label: '1 min',  seconds: 60  },
  { label: '3 min',  seconds: 180 },
  { label: '5 min',  seconds: 300 },
  { label: '10 min', seconds: 600 },
];

// ─── MobilePKPanel ────────────────────────────────────────────────────────────

interface PanelProps {
  visible:      boolean;
  onClose:      () => void;
  roomId:       string;
  speakers:     Speaker[];
  myUserId:     string;
  onPKStarted?: (pkMatchId: string, participants: PKBannerParticipant[], durationSeconds: number) => void;
}

export function MobilePKPanel({ visible, onClose, roomId, speakers, myUserId, onPKStarted }: PanelProps) {
  const pkStore = usePKStore();
  const [tab,       setTab]       = useState<'challenge' | 'matchmaking'>('challenge');
  const [duration,  setDuration]  = useState(300);
  const [selected,  setSelected]  = useState<string | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [queueSecs, setQueueSecs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eligible = speakers.filter(s => s.id !== myUserId && s.isActive && s.seatNumber != null);

  useEffect(() => {
    if (!visible) { setSelected(null); setLoading(false); clearTimer(); }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const socket = getSocket();
    if (!socket) return;
    const handler = (d: { pkMatchId: string }) => {
      pkStore.setInQueue(false); clearTimer(); onClose();
      showMessage({ message: '⚔️ Opponent found! Battle starting…', type: 'success' });
    };
    socket.on('pk:matched', handler);
    return () => { socket.off('pk:matched', handler); };
  }, [visible]); // eslint-disable-line

  function clearTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setQueueSecs(0);
  }

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // FIX: roomId is now passed in the invitation payload
  // so acceptInvitation can detect which rooms to link and emit pk:room:started
  const handleChallenge = useCallback(async () => {
    if (!selected || loading) return;
    setLoading(true);
    try {
      await api.post('/pk/invitations', {
        receiverId:      selected,
        type:            'ONE_V_ONE',
        durationSeconds: duration,
        roomId,                          // ← THE FIX
        message:         '⚔️ PK challenge from the Voice Room!',
      });
      showMessage({ message: '⚔️ Challenge sent!', type: 'success' });
      onClose();
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 409) {
        showMessage({ message: 'Already challenged — previous invite still pending', type: 'warning' });
      } else {
        showMessage({ message: e?.response?.data?.message || 'Could not send challenge', type: 'danger' });
      }
    } finally { setLoading(false); }
  }, [selected, duration, loading, onClose, roomId]);

  const handleJoinQueue = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await api.post('/pk/matchmaking/join', { type: 'ONE_V_ONE', durationSeconds: duration });
      pkStore.setInQueue(true);
      timerRef.current = setInterval(() => setQueueSecs(t => t + 1), 1000);
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message || 'Matchmaking unavailable', type: 'danger' });
    } finally { setLoading(false); }
  }, [duration, loading, pkStore]);

  const handleLeaveQueue = useCallback(async () => {
    try { await api.post('/pk/matchmaking/leave'); } catch {}
    pkStore.setInQueue(false); clearTimer();
  }, [pkStore]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={p.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={p.sheet}>
        <View style={p.handle} />
        <View style={p.header}>
          <Text style={p.title}>⚔️ PK Battle</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color="#94a3b8" />
          </TouchableOpacity>
        </View>
        <View style={p.tabs}>
          {(['challenge', 'matchmaking'] as const).map(t => (
            <TouchableOpacity key={t} style={[p.tab, tab === t && p.tabActive]} onPress={() => setTab(t)}>
              <Text style={[p.tabText, tab === t && p.tabTextActive]}>
                {t === 'challenge' ? '🎯 Challenge' : '🔍 Matchmaking'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={p.section}>
          <Text style={p.sectionLabel}>Duration</Text>
          <View style={p.durationRow}>
            {DURATIONS.map(d => (
              <TouchableOpacity key={d.seconds} style={[p.durBtn, duration === d.seconds && p.durBtnActive]} onPress={() => setDuration(d.seconds)}>
                <Text style={[p.durBtnText, duration === d.seconds && p.durBtnTextActive]}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        {tab === 'challenge' && (
          <View style={p.body}>
            {eligible.length === 0 ? (
              <View style={p.emptyBox}>
                <Text style={p.emptyText}>No speakers on stage to challenge.</Text>
                <Text style={[p.emptyText, { marginTop: 4, fontSize: 11 }]}>Use Matchmaking to find a global opponent.</Text>
              </View>
            ) : (
              <>
                <Text style={p.sectionLabel}>Pick an opponent</Text>
                <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                  {eligible.map(sp => (
                    <TouchableOpacity key={sp.id} style={[p.speakerRow, selected === sp.id && p.speakerRowActive]}
                      onPress={() => setSelected(s => s === sp.id ? null : sp.id)} activeOpacity={0.8}>
                      <Image source={{ uri: buildAvatarUrl(sp.avatar, sp.name) }} style={p.speakerAvatar} />
                      <View style={{ flex: 1 }}>
                        <Text style={p.speakerName} numberOfLines={1}>{sp.name}</Text>
                        <Text style={p.speakerMeta}>Seat {sp.seatNumber} · {sp.role}</Text>
                      </View>
                      {selected === sp.id && <Ionicons name="checkmark-circle" size={22} color="#6366f1" />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TouchableOpacity style={[p.actionBtn, (!selected || loading) && p.actionBtnDisabled]}
                  onPress={handleChallenge} disabled={!selected || loading} activeOpacity={0.8}>
                  {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={p.actionBtnText}>⚔️ Send Challenge</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
        {tab === 'matchmaking' && (
          <View style={p.body}>
            {pkStore.inQueue ? (
              <View style={p.queueBox}>
                <Text style={p.queueEmoji}>⚔️</Text>
                <Text style={p.queueTitle}>Searching for opponent…</Text>
                <Text style={p.queueTimer}>{fmt(queueSecs)}</Text>
                <Text style={p.queueHint}>You can close this panel — we'll notify you when matched.</Text>
                <TouchableOpacity style={p.cancelBtn} onPress={handleLeaveQueue}>
                  <Text style={p.cancelBtnText}>Cancel Search</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={p.body}>
                <Text style={p.matchmakingDesc}>Find a random opponent near your skill level.</Text>
                <TouchableOpacity style={[p.actionBtn, loading && p.actionBtnDisabled]}
                  onPress={handleJoinQueue} disabled={loading} activeOpacity={0.8}>
                  {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={p.actionBtnText}>🔍 Find Opponent</Text>}
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

const p = StyleSheet.create({
  backdrop:          { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet:             { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 32 },
  handle:            { width: 40, height: 4, backgroundColor: '#374151', borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  header:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title:             { color: '#fff', fontSize: 18, fontWeight: '800' },
  tabs:              { flexDirection: 'row', backgroundColor: '#111827', borderRadius: 12, padding: 3, marginBottom: 14 },
  tab:               { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  tabActive:         { backgroundColor: '#4f46e5' },
  tabText:           { color: '#6b7280', fontSize: 13, fontWeight: '600' },
  tabTextActive:     { color: '#fff' },
  section:           { marginBottom: 12 },
  sectionLabel:      { color: '#64748b', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  durationRow:       { flexDirection: 'row', gap: 8 },
  durBtn:            { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151', alignItems: 'center' },
  durBtnActive:      { backgroundColor: '#4f46e5', borderColor: '#6366f1' },
  durBtnText:        { color: '#6b7280', fontSize: 12, fontWeight: '600' },
  durBtnTextActive:  { color: '#fff' },
  body:              { gap: 10 },
  emptyBox:          { alignItems: 'center', paddingVertical: 24 },
  emptyText:         { color: '#64748b', fontSize: 13, textAlign: 'center' },
  speakerRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#111827', borderRadius: 12, padding: 10, marginBottom: 4, borderWidth: 1, borderColor: '#1e293b' },
  speakerRowActive:  { borderColor: '#6366f1', backgroundColor: '#1e1040' },
  speakerAvatar:     { width: 36, height: 36, borderRadius: 18, backgroundColor: '#334155' },
  speakerName:       { color: '#e2e8f0', fontSize: 14, fontWeight: '600' },
  speakerMeta:       { color: '#64748b', fontSize: 11, marginTop: 1 },
  actionBtn:         { marginTop: 8, backgroundColor: '#4f46e5', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  actionBtnDisabled: { backgroundColor: '#1e293b', opacity: 0.5 },
  actionBtnText:     { color: '#fff', fontWeight: '700', fontSize: 15 },
  queueBox:          { alignItems: 'center', gap: 8, paddingVertical: 12 },
  queueEmoji:        { fontSize: 48, marginBottom: 4 },
  queueTitle:        { color: '#e2e8f0', fontSize: 16, fontWeight: '700' },
  queueTimer:        { color: '#6366f1', fontSize: 32, fontWeight: '900', fontVariant: ['tabular-nums'] },
  queueHint:         { color: '#64748b', fontSize: 11, textAlign: 'center', marginTop: 4 },
  cancelBtn:         { marginTop: 8, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  cancelBtnText:     { color: '#94a3b8', fontWeight: '600', fontSize: 14 },
  matchmakingDesc:   { color: '#94a3b8', fontSize: 13, textAlign: 'center', marginBottom: 8 },
});

// ─── MobilePKBanner — TikTok-style ───────────────────────────────────────────

interface BannerProps {
  pkMatchId:       string;
  participants:    PKBannerParticipant[];
  durationSeconds: number;
  onDismiss:       () => void;
  onWatch:         () => void;
}

export function MobilePKBanner({ pkMatchId, participants, durationSeconds, onDismiss, onWatch }: BannerProps) {
  const [scoreA,     setScoreA]     = useState(0);
  const [scoreB,     setScoreB]     = useState(0);
  const [giftCountA, setGiftCountA] = useState(0);
  const [giftCountB, setGiftCountB] = useState(0);
  const [remaining,  setRemaining]  = useState(durationSeconds);
  const [state,      setState]      = useState<string>('LIVE');
  const [winnerSide, setWinnerSide] = useState<string | null>(null);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const slideAnim = useRef(new Animated.Value(-140)).current;

  const sideA = participants.find(p => p.side === 'A');
  const sideB = participants.find(p => p.side === 'B');
  const total   = scoreA + scoreB;
  const pctA    = total > 0 ? Math.max(4, Math.min(96, Math.round((scoreA / total) * 100))) : 50;
  const pctB    = 100 - pctA;
  const mins    = Math.floor(remaining / 60);
  const secs    = remaining % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const isFinal = remaining <= 30 && remaining > 0 && state === 'LIVE';
  const isDone  = state === 'COMPLETED' || state === 'ABORTED';

  const winnerLabel =
    winnerSide === 'DRAW' ? '🤝 Draw!'
    : winnerSide === 'A'  ? `🏆 ${sideA?.user.firstName ?? 'Side A'} wins!`
    : winnerSide === 'B'  ? `🏆 ${sideB?.user.firstName ?? 'Side B'} wins!`
    : 'Battle ended';

  useEffect(() => {
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
    startTimer(durationSeconds);
    return () => stopTimer();
  }, [durationSeconds]); // eslint-disable-line

  function startTimer(s: number) {
    stopTimer();
    if (s <= 0) return;
    timerRef.current = setInterval(() => {
      setRemaining(r => { if (r <= 1) { stopTimer(); return 0; } return r - 1; });
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('pk:join', pkMatchId);
    socket.on('pk:score',   (d: any) => { if (d.pkMatchId !== pkMatchId) return; setScoreA(d.scoreA); setScoreB(d.scoreB); });
    socket.on('pk:gift',    (d: any) => { if (d.pkMatchId !== pkMatchId) return; if (d.side === 'A') setGiftCountA(c => c + 1); else setGiftCountB(c => c + 1); });
    socket.on('pk:timer',   (d: any) => { if (d.pkMatchId !== pkMatchId) return; setRemaining(d.remainingSeconds); });
    socket.on('pk:started', (d: any) => { if (d.pkMatchId !== pkMatchId) return; setState('LIVE'); const r = d.remainingSeconds ?? durationSeconds; setRemaining(r); startTimer(r); });
    socket.on('pk:paused',  (d: any) => { if (d.pkMatchId !== pkMatchId) return; setState('PAUSED'); stopTimer(); });
    socket.on('pk:resumed', (d: any) => { if (d.pkMatchId !== pkMatchId) return; setState('LIVE'); setRemaining(d.remainingSeconds); startTimer(d.remainingSeconds); });
    socket.on('pk:winner',  (d: any) => { if (d.pkMatchId !== pkMatchId) return; setScoreA(d.scoreA); setScoreB(d.scoreB); setWinnerSide(d.winnerSide); setState('COMPLETED'); stopTimer(); setTimeout(onDismiss, 5000); });
    socket.on('pk:ended',   (d: any) => { if (d.pkMatchId !== pkMatchId) return; setState('ABORTED'); stopTimer(); setTimeout(onDismiss, 3000); });
    return () => {
      socket.emit('pk:leave', pkMatchId);
      ['pk:score','pk:gift','pk:timer','pk:started','pk:paused','pk:resumed','pk:winner','pk:ended'].forEach(e => socket.off(e));
    };
  }, [pkMatchId]); // eslint-disable-line

  return (
    <Animated.View style={[b.banner, { transform: [{ translateY: slideAnim }] }]} pointerEvents="box-none">
      <View style={b.bg} />
      {/* Top bar */}
      <View style={b.topBar}>
        <View style={{ width: 32 }} />
        <View style={b.timerCenter}>
          <Text style={b.pkBlue}>P</Text>
          <Text style={b.pkPink}>K</Text>
          <Text style={[b.timerText, isFinal && b.timerFinal, state === 'PAUSED' && b.timerPaused]}>
            {'  '}{timeStr}
          </Text>
          <Text style={b.clockIcon}>🕐</Text>
          {state === 'PAUSED' && <Text style={b.pausedBadge}>⏸</Text>}
        </View>
        <TouchableOpacity style={b.endBtn} onPress={onDismiss} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>✕</Text>
        </TouchableOpacity>
      </View>
      {/* Battle row */}
      <View style={b.battleRow}>
        <View style={b.sideA}>
          <Image source={{ uri: buildAvatarUrl(sideA?.user.avatarUrl, sideA?.user.firstName ?? 'A') }} style={b.avatarA} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text style={{ fontSize: 9 }}>💎</Text>
              <Text style={b.nameText} numberOfLines={1}>{sideA?.user.firstName ?? 'Side A'}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 1 }}>
              <Text style={{ fontSize: 9 }}>🔥</Text>
              <Text style={[b.scoreText, scoreA > scoreB && b.scoreLeading, winnerSide === 'A' && b.scoreWinner]}>
                {scoreA.toLocaleString()}
              </Text>
            </View>
          </View>
        </View>
        <View style={b.progressWrap}>
          <View style={b.progressTrack}>
            <View style={[b.progressLeft,  { flex: pctA }]} />
            <View style={[b.progressRight, { flex: pctB }]} />
          </View>
        </View>
        <View style={b.sideB}>
          <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
              <Text style={b.nameText} numberOfLines={1}>{sideB?.user.firstName ?? 'Side B'}</Text>
              <Text style={{ fontSize: 9 }}>💎</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 1, justifyContent: 'flex-end' }}>
              <Text style={[b.scoreText, scoreB > scoreA && b.scoreLeading, winnerSide === 'B' && b.scoreWinner]}>
                {scoreB.toLocaleString()}
              </Text>
              <Text style={{ fontSize: 9 }}>🔥</Text>
            </View>
          </View>
          <Image source={{ uri: buildAvatarUrl(sideB?.user.avatarUrl, sideB?.user.firstName ?? 'B') }} style={b.avatarB} />
        </View>
      </View>
      {/* Bottom row */}
      <View style={b.bottomRow}>
        <View style={b.giftBadgeBlue}>
          <Text style={{ fontSize: 11 }}>🔑</Text>
          <Text style={b.giftText}>×{giftCountA}</Text>
        </View>
        {isDone && winnerSide
          ? <Text style={b.winnerLabel} numberOfLines={1}>{winnerLabel}</Text>
          : <TouchableOpacity onPress={onWatch} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={b.watchText}>👁 Watch full battle</Text>
            </TouchableOpacity>
        }
        <View style={b.giftBadgeRed}>
          <Text style={b.giftText}>×{giftCountB}</Text>
          <Text style={{ fontSize: 11 }}>🔑</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const b = StyleSheet.create({
  banner:        { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 500, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, overflow: 'hidden', elevation: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 16 },
  bg:            { ...StyleSheet.absoluteFillObject, backgroundColor: '#1a237e', opacity: 0.95 },
  topBar:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, backgroundColor: 'rgba(0,0,0,0.2)' },
  timerCenter:   { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1, justifyContent: 'center' },
  pkBlue:        { color: '#60a5fa', fontSize: 15, fontWeight: '900', lineHeight: 17 },
  pkPink:        { color: '#f472b6', fontSize: 15, fontWeight: '900', lineHeight: 17 },
  timerText:     { color: '#fff', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timerFinal:    { color: '#fca5a5' },
  timerPaused:   { color: '#fde68a' },
  clockIcon:     { fontSize: 12, marginLeft: 3 },
  pausedBadge:   { fontSize: 11, color: '#fde68a', marginLeft: 4 },
  endBtn:        { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  battleRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  sideA:         { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  sideB:         { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, justifyContent: 'flex-end' },
  avatarA:       { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: '#60a5fa', flexShrink: 0, backgroundColor: '#1e3a5f' },
  avatarB:       { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: '#f87171', flexShrink: 0, backgroundColor: '#5f1e1e' },
  nameText:      { color: '#f1f5f9', fontSize: 12, fontWeight: '700' },
  scoreText:     { color: 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
  scoreLeading:  { color: '#fff' },
  scoreWinner:   { color: '#fbbf24' },
  progressWrap:  { width: 100, alignItems: 'center', flexShrink: 0 },
  progressTrack: { flexDirection: 'row', width: '100%', height: 10, borderRadius: 6, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.12)' },
  progressLeft:  { height: '100%', backgroundColor: '#2563eb' },
  progressRight: { height: '100%', backgroundColor: '#dc2626' },
  bottomRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10, paddingTop: 2 },
  giftBadgeBlue: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(37,99,235,0.35)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(96,165,250,0.5)' },
  giftBadgeRed:  { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(220,38,38,0.35)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(248,113,113,0.5)' },
  giftText:      { color: '#fff', fontSize: 12, fontWeight: '700' },
  winnerLabel:   { flex: 1, color: '#fbbf24', fontSize: 12, fontWeight: '800', textAlign: 'center', marginHorizontal: 6 },
  watchText:     { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '600' },
});
