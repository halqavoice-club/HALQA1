/**
 * HALQA Mobile — Voice Room Screen
 * Live audio room: participants, mic, hand raise, gifts, leaderboard, leave
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, Alert, Image, Modal, ScrollView,
  Animated, Dimensions, TextInput, Platform,
  BackHandler} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio as ExpoAudio } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';
import { initSocket, getSocket } from '@/lib/socket';
import { useLiveKitAudio } from '@/hooks/useLiveKitAudio';
import { useNetworkQuality, qualityToPollInterval } from '@/hooks/useNetworkQuality';
import MicPassModal, { type MicPassUser } from '@/components/voice/MicPassModal';
import { MemberManagementPanel } from '@/components/voice/MemberManagementPanel';
import { useVoiceStore } from '@/store/voice.store';
import { GiftLeaderboard, type LeaderEntry } from '@/components/voice/GiftLeaderboard';
import { RoomSettingsSheet } from '@/components/voice/RoomSettingsSheet';
import { LiveVideoGrid, type VideoSpeaker } from '@/components/live-class/LiveVideoGrid';
import { MobilePKPanel, MobilePKBanner } from '@/components/voice/PKComponents';

// ─── Background Music Panel ───────────────────────────────────────────────────
function BgMusicPanel({ visible, roomId, onClose, onNowPlayingChange }: {
  visible: boolean; roomId: string; onClose: () => void;
  onNowPlayingChange?: (track: { title: string; isDeviceFile: boolean } | null, playing: boolean) => void;
}) {
  const [search,     setSearch]     = useState('');
  const [catFilter,  setCatFilter]  = useState('');
  const [nowPlaying, setNowPlaying] = useState<any>(null);
  const [isPlaying,  setIsPlaying]  = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [volume,     setVolume]     = useState(40);
  const [position,   setPosition]   = useState(0);
  const [duration,   setDuration]   = useState(0);
  const [activeTab,  setActiveTab]  = useState<'library' | 'device'>('library');
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const { data: categories = [] } = useQuery<any[]>({
    queryKey: ['audio-categories'],
    queryFn: () => api.get('/audio/categories').then(r => r.data.data ?? []),
    staleTime: 5 * 60_000,
  });

  const { data: lessons = [], isLoading: lessonsLoading } = useQuery<any[]>({
    queryKey: ['audio-lessons-music', catFilter, search],
    queryFn: () => api.get('/audio/lessons', {
      params: { categoryId: catFilter || undefined, search: search || undefined, limit: 100 }
    }).then(r => r.data.data ?? []),
    staleTime: 5 * 60_000,
  });

  // Resolve audio URL robustly from api baseURL
  const resolveAudioUrl = (audioUrl: string): string => {
    if (!audioUrl) return '';
    if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) return audioUrl;
    // Strip /api/v1, /api/v2, /api from baseURL to get server root
    const base = (api.defaults.baseURL ?? '')
      .replace(/\/api\/v\d+\/?$/, '')
      .replace(/\/api\/?$/, '');
    return `${base}${audioUrl.startsWith('/') ? '' : '/'}${audioUrl}`;
  };

  // ── Pick audio from device ─────────────────────────────────────────────────
  const pickFromDevice = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/*', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      // Validate — max 100 MB for device files
      if (asset.size && asset.size > 100 * 1024 * 1024) {
        showMessage({ message: 'File too large — max 100 MB', type: 'warning' });
        return;
      }
      // Build a pseudo-lesson object from the device file
      const deviceLesson = {
        id:       `device-${Date.now()}`,
        title:    asset.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        audioUrl: asset.uri,   // local URI — expo-av can play this directly
        category: { name: 'Device File' },
        course:   { title: asset.name },
        isDeviceFile: true,
      };
      playLesson(deviceLesson);
    } catch (e: any) {
      showMessage({ message: 'Could not open file picker', type: 'danger' });
    }
  };

  const playLesson = async (lesson: any) => {
    setLoading(true);

    // Configure audio session — required on iOS for background playback
    try {
      await ExpoAudio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (e) {
      // Non-fatal — continue even if audio mode fails (e.g. in Expo Go)
    }

    // Unload any previous sound
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch {}
      soundRef.current = null;
    }

    setNowPlaying(lesson);
    setIsPlaying(false);
    setPosition(0);
    setDuration(0);

    try {
      // For device files use the local URI directly; for remote lessons resolve the URL
      const url = lesson.isDeviceFile ? lesson.audioUrl : resolveAudioUrl(lesson.audioUrl);
      if (!url) throw new Error('No audio URL for this lesson');

      const { sound, status } = await ExpoAudio.Sound.createAsync(
        { uri: url },
        {
          shouldPlay: true,
          volume: volume / 100,
          progressUpdateIntervalMillis: 1000,
        },
        (playbackStatus) => {
          if (!playbackStatus.isLoaded) return;
          setPosition(Math.floor((playbackStatus.positionMillis ?? 0) / 1000));
          setDuration(Math.floor((playbackStatus.durationMillis ?? 0) / 1000));
          setIsPlaying(playbackStatus.isPlaying ?? false);
          // Restart when finished (manual loop — more compatible than isLooping)
          if (playbackStatus.didJustFinish) {
            sound.replayAsync().catch(() => {});
          }
        }
      );

      soundRef.current = sound;

      // Set volume explicitly after creation
      await sound.setVolumeAsync(volume / 100);

      if (status.isLoaded && status.isPlaying) {
        setIsPlaying(true);
      }

      // Announce in room chat (only for library lessons, not device files)
      if (!lesson.isDeviceFile) {
        api.post(`/voice/${roomId}/messages`, {
          body: `🎵 Now playing: ${lesson.title}`,
        }).catch(() => {});
      }

    } catch (err: any) {
      const msg = err?.message ?? 'Failed to load audio';
      showMessage({ message: msg, type: 'danger' });
      setNowPlaying(null);
      setIsPlaying(false);
    } finally {
      setLoading(false);
    }
  };

  const togglePlay = async () => {
    const sound = soundRef.current;
    if (!sound) return;
    try {
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) {
        await sound.pauseAsync();
      } else {
        await sound.playAsync();
      }
    } catch {}
  };

  const stop = async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch {}
      soundRef.current = null;
    }
    setNowPlaying(null);
    setIsPlaying(false);
    setPosition(0);
    setDuration(0);
  };

  // Live volume adjustment
  useEffect(() => {
    soundRef.current?.setVolumeAsync(volume / 100).catch(() => {});
  }, [volume]);

  // Notify parent of now-playing state so it can show a persistent indicator
  useEffect(() => {
    onNowPlayingChange?.(
      nowPlaying ? { title: nowPlaying.title, isDeviceFile: !!nowPlaying.isDeviceFile } : null,
      isPlaying
    );
  }, [nowPlaying, isPlaying]); // eslint-disable-line

  // Pause when panel is closed (don't stop — let music keep playing in bg)
  // Actually keep playing when closed — host may want bg music while using room
  // Only stop on explicit stop button or unmount

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // Never return null — unmounting would destroy soundRef and stop playback.
  // The Modal handles its own visibility; this component stays alive in the tree.

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={bm.backdrop} activeOpacity={1} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={bm.sheet}>
        <View style={bm.handle} />
        <Text style={bm.title}>🎵 Background Music</Text>

        {/* Now playing bar */}
        {nowPlaying && (
          <View style={bm.nowPlayingCard}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={bm.npTitle} numberOfLines={1}>
                {nowPlaying.isDeviceFile ? '📱' : '🎵'} {nowPlaying.title}
              </Text>
              <Text style={bm.npTime}>{fmtTime(position)} / {fmtTime(duration || nowPlaying.duration || 0)}</Text>
            </View>
            <TouchableOpacity style={bm.playBtn} onPress={togglePlay} disabled={loading}>
              {loading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name={isPlaying ? 'pause' : 'play'} size={16} color="#fff" />}
            </TouchableOpacity>
            <TouchableOpacity style={bm.stopBtn} onPress={stop} disabled={loading}>
              <Ionicons name="stop" size={16} color="#ef4444" />
            </TouchableOpacity>
          </View>
        )}

        {/* Volume bar (only when playing) */}
        {nowPlaying && (
          <View style={bm.volRow}>
            <Ionicons name="volume-medium-outline" size={14} color="#4ade80" />
            <View style={{ flex: 1, height: 3, backgroundColor: '#1e1e3a', borderRadius: 2, overflow: 'hidden' }}>
              <View style={{ height: 3, backgroundColor: '#22c55e', width: `${volume}%` as any }} />
            </View>
            <TouchableOpacity onPress={() => setVolume(v => Math.max(0, v - 10))}>
              <Ionicons name="remove-circle-outline" size={20} color="#4ade80" />
            </TouchableOpacity>
            <Text style={bm.volTxt}>{volume}%</Text>
            <TouchableOpacity onPress={() => setVolume(v => Math.min(100, v + 10))}>
              <Ionicons name="add-circle-outline" size={20} color="#4ade80" />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Tab bar: Library / Device ── */}
        <View style={bm.tabs}>
          <TouchableOpacity
            style={[bm.tabBtn, activeTab === 'library' && bm.tabBtnActive]}
            onPress={() => setActiveTab('library')}
          >
            <Ionicons name="library-outline" size={14} color={activeTab === 'library' ? '#a5b4fc' : '#6b7280'} />
            <Text style={[bm.tabTxt, activeTab === 'library' && bm.tabTxtActive]}>Lesson Library</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[bm.tabBtn, activeTab === 'device' && bm.tabBtnActive]}
            onPress={() => setActiveTab('device')}
          >
            <Ionicons name="phone-portrait-outline" size={14} color={activeTab === 'device' ? '#a5b4fc' : '#6b7280'} />
            <Text style={[bm.tabTxt, activeTab === 'device' && bm.tabTxtActive]}>From Device</Text>
          </TouchableOpacity>
        </View>

        {/* ── Library Tab ── */}
        {activeTab === 'library' && (
          <>
            {/* Category chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={bm.catRow}>
              <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 2 }}>
                {[{ id: '', name: 'All' }, ...categories].map((c: any) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[bm.catChip, catFilter === c.id && bm.catChipActive]}
                    onPress={() => setCatFilter(c.id)}
                  >
                    <Text style={[bm.catChipTxt, catFilter === c.id && bm.catChipTxtActive]}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Search */}
            <View style={bm.searchRow}>
              <Ionicons name="search-outline" size={14} color="#6b7280" />
              <TextInput
                value={search} onChangeText={setSearch}
                placeholder="Search lessons…" placeholderTextColor="#6b7280"
                style={bm.searchInput} allowFontScaling={false}
              />
              {search ? <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={14} color="#6b7280" /></TouchableOpacity> : null}
            </View>

            {lessonsLoading ? (
              <ActivityIndicator color="#7c3aed" style={{ margin: 20 }} />
            ) : (
              <FlatList
                data={lessons}
                keyExtractor={(l: any) => l.id}
                style={bm.list}
                renderItem={({ item: lesson }: any) => {
                  const isNP = nowPlaying?.id === lesson.id;
                  const isThisLoading = loading && isNP;
                  return (
                    <TouchableOpacity
                      style={[bm.lessonRow, isNP && bm.lessonRowActive]}
                      onPress={() => isNP ? togglePlay() : playLesson(lesson)}
                      activeOpacity={0.8}
                      disabled={loading}
                    >
                      <View style={[bm.lessonPlay, isNP && { backgroundColor: '#7c3aed' }]}>
                        {isThisLoading
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Ionicons
                              name={isNP && isPlaying ? 'pause' : 'play'}
                              size={14}
                              color={isNP ? '#fff' : '#7c3aed'}
                              style={{ marginLeft: isNP && isPlaying ? 0 : 1 }}
                            />
                        }
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[bm.lessonTitle, isNP && { color: '#a5b4fc' }]} numberOfLines={1}>{lesson.title}</Text>
                        <Text style={bm.lessonSub} numberOfLines={1}>{lesson.category?.name} · {lesson.course?.title}</Text>
                      </View>
                      {isNP && !isThisLoading && (
                        <View style={bm.playingBadge}>
                          <Text style={bm.playingBadgeTxt}>{isPlaying ? '▶ Playing' : '⏸ Paused'}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <Text style={{ color: '#6b7280', textAlign: 'center', padding: 20, fontSize: 13 }}>
                    No audio lessons found
                  </Text>
                }
              />
            )}
          </>
        )}

        {/* ── Device Tab ── */}
        {activeTab === 'device' && (
          <View style={bm.deviceTab}>
            {/* Big pick button */}
            <TouchableOpacity style={bm.pickBtn} onPress={pickFromDevice} disabled={loading} activeOpacity={0.8}>
              <View style={bm.pickIconCircle}>
                <Ionicons name="folder-open-outline" size={36} color="#a5b4fc" />
              </View>
              <Text style={bm.pickTitle}>Pick Audio from Device</Text>
              <Text style={bm.pickSub}>MP3 · WAV · OGG · M4A · AAC · Max 100 MB</Text>
              {loading && <ActivityIndicator color="#a5b4fc" style={{ marginTop: 8 }} />}
            </TouchableOpacity>

            {/* Show currently playing device file info */}
            {nowPlaying?.isDeviceFile && (
              <View style={bm.devicePlayingCard}>
                <Ionicons name="musical-notes" size={20} color="#a5b4fc" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={bm.devicePlayingTitle} numberOfLines={1}>{nowPlaying.title}</Text>
                  <Text style={bm.devicePlayingMeta}>Playing from your device</Text>
                </View>
                <TouchableOpacity
                  style={[bm.playBtn, { marginLeft: 4 }]}
                  onPress={togglePlay}
                  disabled={loading}
                >
                  <Ionicons name={isPlaying ? 'pause' : 'play'} size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            )}

            {/* Tips */}
            <View style={bm.deviceTips}>
              <Text style={bm.deviceTipsTitle}>💡 Tips</Text>
              <Text style={bm.deviceTip}>• Music plays only on your device</Text>
              <Text style={bm.deviceTip}>• Room participants hear it through your mic if LiveKit is connected</Text>
              <Text style={bm.deviceTip}>• Use volume control above to balance your voice and music</Text>
              <Text style={bm.deviceTip}>• Tap the file area again to swap tracks</Text>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const bm = StyleSheet.create({
  backdrop:           { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet:              { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, maxHeight: SCREEN_H * 0.85 },
  handle:             { width: 40, height: 4, backgroundColor: '#374151', borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  title:              { color: '#e5e7eb', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  nowPlayingCard:     { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#0f2e1a', borderRadius: 12, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: '#166534' },
  npTitle:            { color: '#4ade80', fontSize: 13, fontWeight: '700' },
  npTime:             { color: '#16a34a', fontSize: 10, marginTop: 1 },
  playBtn:            { width: 32, height: 32, borderRadius: 16, backgroundColor: '#22c55e', justifyContent: 'center', alignItems: 'center' },
  stopBtn:            { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fef2f2', justifyContent: 'center', alignItems: 'center' },
  // Tab bar
  tabs:               { flexDirection: 'row', backgroundColor: '#111827', borderRadius: 12, padding: 3, marginBottom: 10 },
  tabBtn:             { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 9 },
  tabBtnActive:       { backgroundColor: '#1e1040' },
  tabTxt:             { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  tabTxtActive:       { color: '#a5b4fc' },
  // Library tab
  volRow:             { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, paddingHorizontal: 4 },
  volTxt:             { color: '#4ade80', fontSize: 11, fontWeight: '700', minWidth: 30, textAlign: 'center' },
  catRow:             { flexGrow: 0, marginBottom: 10 },
  catChip:            { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151' },
  catChipActive:      { backgroundColor: '#2e1065', borderColor: '#7c3aed' },
  catChipTxt:         { fontSize: 11, fontWeight: '600', color: '#9ca3af' },
  catChipTxtActive:   { color: '#a5b4fc' },
  searchRow:          { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#111827', borderRadius: 10, borderWidth: 1, borderColor: '#374151', paddingHorizontal: 10, paddingVertical: 7, marginBottom: 8 },
  searchInput:        { flex: 1, fontSize: 13, color: '#e5e7eb' },
  list:               { maxHeight: 300 },
  lessonRow:          { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#111827', borderRadius: 12, padding: 10, marginBottom: 4, borderWidth: 1, borderColor: '#1e1e3a' },
  lessonRowActive:    { borderColor: '#7c3aed', backgroundColor: '#1e1040' },
  lessonPlay:         { width: 30, height: 30, borderRadius: 15, backgroundColor: '#1e1e3a', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  lessonTitle:        { fontSize: 13, fontWeight: '600', color: '#e5e7eb' },
  lessonSub:          { fontSize: 10, color: '#6b7280', marginTop: 1 },
  playingBadge:       { backgroundColor: '#2e1065', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  playingBadgeTxt:    { fontSize: 9, fontWeight: '800', color: '#a5b4fc' },
  // Device tab
  deviceTab:          { paddingBottom: 8 },
  pickBtn:            { alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#111827', borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: '#4f46e5', paddingVertical: 28, paddingHorizontal: 20, marginBottom: 12 },
  pickIconCircle:     { width: 72, height: 72, borderRadius: 36, backgroundColor: '#1e1040', justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  pickTitle:          { color: '#e5e7eb', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  pickSub:            { color: '#6b7280', fontSize: 11, textAlign: 'center' },
  devicePlayingCard:  { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1e1040', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#4f46e5' },
  devicePlayingTitle: { color: '#a5b4fc', fontSize: 13, fontWeight: '700' },
  devicePlayingMeta:  { color: '#6b7280', fontSize: 10, marginTop: 2 },
  deviceTips:         { backgroundColor: '#111827', borderRadius: 12, padding: 12, gap: 4 },
  deviceTipsTitle:    { color: '#a5b4fc', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  deviceTip:          { color: '#6b7280', fontSize: 11, lineHeight: 17 },
});

// ─── Types ────────────────────────────────────────────────────────────────────
interface VoiceRoom {
  id: string; name: string; title?: string; description?: string; hostId: string;
  host: { id: string; name: string; avatar?: string };
  participantsCount: number; topic?: string; isLive: boolean; privacy?: string;
  isOpenMic: boolean; micLocked: boolean; reactionsEnabled: boolean; roomLevel: number;
  commentsEnabled: boolean; slowMode: boolean; messageType?: string;
}
interface Participant {
  id: string; name: string; avatar?: string;
  role: 'HOST' | 'MODERATOR' | 'SPEAKER' | 'AUDIENCE';
  isMuted: boolean; isSpeaking: boolean; handRaised: boolean;
  mutedByModerator: boolean;  // true = muted by HOST/MOD; self-unmute is blocked
  isActive: boolean;          // true for all active participants in the room
  seatNumber: number | null;  // 1–12 when on stage; null when in audience (authoritative)
  _joinedAt?: string;         // for deterministic sort (not required but helps)
}
interface Gift {
  id: string; name: string; emoji: string; priceCoins: number;
  animationType: string; rarity: string; isPremium: boolean; priority: string;
}
interface GiftLeaderItem {
  user: { id: string; firstName: string; lastName: string; avatarUrl?: string };
  totalCoins: number; giftCount: number;
}
interface ChatMsg {
  id: string; body: string;
  user: { id: string; firstName: string; lastName: string; avatarUrl?: string };
  createdAt: string;
}

// ─── Gift Animation Overlay — rarity & animationType aware (MOB-5 fix) ──────
// Each rarity tier has distinct visual treatment:
//   common/standard  — simple scale + fade (original behaviour)
//   rare             — blue glow + bounce
//   epic             — purple glow + bigger scale + particle burst label
//   legendary        — gold glow + full-screen tint + shake + longer hold
//   ultimate         — red glow + full-screen overlay + rotation + max hold
// animationType is also respected for UI hints (rocket, cinematic, etc.)
function GiftAnimOverlay({ gift, senderName, onDone }: {
  gift: Gift; senderName: string; onDone: () => void;
}) {
  const scaleAnim   = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const shakeAnim   = useRef(new Animated.Value(0)).current;
  const rotateAnim  = useRef(new Animated.Value(0)).current;

  const rarityColors: Record<string, string> = {
    common:    '#94a3b8',
    standard:  '#60a5fa',
    rare:      '#6366f1',
    epic:      '#8b5cf6',
    legendary: '#f59e0b',
    ultimate:  '#ef4444',
  };
  const glow = rarityColors[gift.rarity] ?? '#94a3b8';

  // Hold duration by rarity — longer for rarer gifts
  const holdMs = gift.rarity === 'ultimate'  ? 3500
               : gift.rarity === 'legendary' ? 2800
               : gift.rarity === 'epic'      ? 2200
               : gift.rarity === 'rare'      ? 1800
               :                               1400;

  // Spring tension by rarity — more dramatic for higher tiers
  const tension = gift.rarity === 'ultimate'  ? 120
                : gift.rarity === 'legendary' ? 100
                : gift.rarity === 'epic'      ? 80
                :                               60;

  useEffect(() => {
    // Build animation sequence based on rarity
    const enterAnim = gift.rarity === 'ultimate' || gift.rarity === 'legendary'
      ? Animated.parallel([
          Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension, friction: 5 }),
          // Shake for legendary/ultimate
          Animated.sequence([
            Animated.timing(shakeAnim, { toValue: 8,  duration: 60, useNativeDriver: true }),
            Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
            Animated.timing(shakeAnim, { toValue: 6,  duration: 50, useNativeDriver: true }),
            Animated.timing(shakeAnim, { toValue: -6, duration: 50, useNativeDriver: true }),
            Animated.timing(shakeAnim, { toValue: 0,  duration: 40, useNativeDriver: true }),
          ]),
        ])
      : gift.rarity === 'epic'
      ? Animated.parallel([
          Animated.spring(scaleAnim, { toValue: 1.1, useNativeDriver: true, tension, friction: 5 }),
          Animated.spring(rotateAnim, { toValue: 1, useNativeDriver: true, tension: 40, friction: 8 }),
        ])
      : Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension, friction: 6 });

    Animated.sequence([
      enterAnim,
      Animated.delay(holdMs),
      Animated.timing(opacityAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start(() => onDone());
  }, []); // eslint-disable-line

  const rotateDeg = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '5deg'],
  });

  // Full-screen background tint for legendary/ultimate
  const isFullscreen = gift.rarity === 'ultimate' || gift.rarity === 'legendary';
  // Emoji scale boost for higher rarities
  const emojiSize = gift.rarity === 'ultimate' ? 80
                  : gift.rarity === 'legendary' ? 72
                  : gift.rarity === 'epic'      ? 64
                  : 56;

  // Rarity label decorators
  const rarityDecorator = gift.rarity === 'ultimate'  ? '✨ ULTIMATE ✨'
                        : gift.rarity === 'legendary' ? '🌟 LEGENDARY'
                        : gift.rarity === 'epic'      ? '💫 EPIC'
                        : gift.rarity === 'rare'      ? '💠 RARE'
                        : gift.rarity.toUpperCase();

  // animationType hint (shown as subtitle for rocket/cinematic/etc.)
  const animHint = gift.animationType === 'rocket_launch'    ? '🚀 Launching!'
                 : gift.animationType === 'rocket_cinematic' ? '🚀 Cinematic!'
                 : gift.animationType === 'racing'           ? '🏎️ Racing!'
                 : gift.animationType === 'spotlight'        ? '🔦 Spotlight!'
                 : gift.animationType === 'cinematic'        ? '🎬 Cinematic!'
                 : gift.animationType === 'fullscreen'       ? '🌟 Fullscreen!'
                 : null;

  return (
    <Animated.View style={[
      styles.giftOverlay,
      { opacity: opacityAnim },
      // Full-screen tint overlay for legendary/ultimate
      isFullscreen && { backgroundColor: glow + '18' },
    ]}>
      <Animated.View style={[
        styles.giftAnimCard,
        {
          transform: [
            { scale: scaleAnim },
            { translateX: shakeAnim },
            { rotate: rotateDeg },
          ],
          borderColor: glow,
          shadowColor: glow,
          // Bigger card for higher rarity
          ...(gift.rarity === 'ultimate'  && { minWidth: 220, padding: 32, borderWidth: 3 }),
          ...(gift.rarity === 'legendary' && { minWidth: 200, padding: 28, borderWidth: 2.5 }),
          ...(gift.rarity === 'epic'      && { minWidth: 190, padding: 24 }),
        },
      ]}>
        <Text style={[styles.giftAnimEmoji, { fontSize: emojiSize }]}>{gift.emoji}</Text>
        <Text style={[styles.giftAnimName, gift.rarity === 'ultimate' && { fontSize: 22, color: glow }]}>
          {gift.name}
        </Text>
        <Text style={styles.giftAnimSender}>from {senderName}</Text>
        {animHint && (
          <Text style={{ color: glow, fontSize: 12, fontWeight: '700', marginTop: 4 }}>{animHint}</Text>
        )}
        <View style={[styles.giftRarityBadge, {
          backgroundColor: glow + '33',
          borderColor: glow,
          marginTop: gift.rarity === 'ultimate' ? 16 : 12,
          paddingHorizontal: gift.rarity === 'ultimate' ? 18 : 14,
        }]}>
          <Text style={[styles.giftRarityText, { color: glow }]}>{rarityDecorator}</Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// ─── Gift Panel (Bottom Sheet) — IMO/Bigo compact style ────────────────────
function GiftPanel({ visible, gifts, wallet, roomId, speakers, onClose, onSent }: {
  visible: boolean; gifts: Gift[]; wallet: any;
  roomId: string; speakers: Participant[];
  onClose: () => void; onSent: (g: Gift, receiver: Participant) => void;
}) {
  const CATEGORIES_GIFT = ['Hot', 'Recent', 'SVIP'] as const;
  type GiftCat = typeof CATEGORIES_GIFT[number];

  const [selectedGift,     setSelectedGift]     = useState<Gift | null>(null);
  const [selectedReceiver, setSelectedReceiver] = useState<Participant | null>(null);
  const [count,            setCount]            = useState(1);
  const [sending,          setSending]          = useState(false);
  const [category,         setCategory]         = useState<GiftCat>('Hot');
  const ALL = '__ALL__';
  const [receiverMode,     setReceiverMode]     = useState<string>(ALL);

  const eligibles = speakers.filter(p => ['HOST','MODERATOR','SPEAKER'].includes(p.role));

  useEffect(() => {
    if (eligibles.length === 1) setReceiverMode(eligibles[0].id);
    else setReceiverMode(ALL);
    if (gifts.length > 0 && !selectedGift) setSelectedGift(gifts[0]);
  }, [visible]); // eslint-disable-line

  const isAll         = receiverMode === ALL;
  const receiverCount = isAll ? Math.max(eligibles.length, 1) : 1;
  const totalCost     = (selectedGift?.priceCoins ?? 0) * count * receiverCount;
  const canAfford     = (wallet?.coins ?? 0) >= totalCost;

  const displayReceiver = isAll ? null : eligibles.find(p => p.id === receiverMode);
  const receiverLabel   = isAll ? `All Stage (${eligibles.length})` : (displayReceiver?.name.split(' ')[0] ?? 'Select');

  const handleSend = async () => {
    if (!selectedGift || sending) return;
    if (!canAfford) { showMessage({ message: `Need 🪙 ${totalCost.toLocaleString()}`, type: 'warning' }); return; }
    setSending(true);
    try {
      if (isAll) {
        await api.post(`/voice/${roomId}/gifts/all`, {
          giftId: selectedGift.id, count,
          idempotencyKey: `all-${Date.now()}-${selectedGift.id}`,
        });
        showMessage({ message: `${selectedGift.emoji} Sent to all on stage!`, type: 'success' });
      } else {
        await api.post(`/voice/${roomId}/gifts`, {
          giftId: selectedGift.id, receiverId: receiverMode, count,
          idempotencyKey: `${Date.now()}-${selectedGift.id}-${receiverMode}`,
        });
        showMessage({ message: `${selectedGift.emoji} ${selectedGift.name} sent!`, type: 'success' });
        if (displayReceiver) onSent(selectedGift, displayReceiver);
      }
      setCount(1); onClose();
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message || 'Failed', type: 'danger' });
    } finally { setSending(false); }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={gp.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={gp.sheet}>
        {/* Handle */}
        <View style={gp.handle} />

        {/* Recipient row + balance */}
        <View style={gp.recipientRow}>
          {/* All stage chip */}
          {eligibles.length > 1 && (
            <TouchableOpacity
              style={[gp.recipientChip, isAll && gp.recipientChipActive]}
              onPress={() => setReceiverMode(ALL)}
            >
              <Text style={{ fontSize: 14 }}>🎪</Text>
              <Text style={[gp.recipientChipTxt, isAll && { color: '#7c3aed', fontWeight: '700' }]}>
                All ({eligibles.length})
              </Text>
            </TouchableOpacity>
          )}
          {/* Individual chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
            {eligibles.map(p => {
              const sel = receiverMode === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={gp.personChip}
                  onPress={() => setReceiverMode(p.id)}
                >
                  <Image source={{ uri: avatarUrl(p.avatar, p.name) }} style={[gp.personAvatar, sel && { borderColor: '#7c3aed', borderWidth: 2 }]} />
                  <Text style={[gp.personName, sel && { color: '#7c3aed' }]} numberOfLines={1}>{p.name.split(' ')[0]}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {/* Coin balance */}
          <View style={gp.coinBadge}>
            <Text style={gp.coinTxt}>🪙 {(wallet?.coins ?? 0).toLocaleString()}</Text>
          </View>
        </View>

        {/* Category tabs */}
        <View style={gp.catBar}>
          {CATEGORIES_GIFT.map(cat => (
            <TouchableOpacity key={cat} style={gp.catBtn} onPress={() => setCategory(cat)}>
              <Text style={[gp.catTxt, category === cat && gp.catTxtActive]}>{cat}</Text>
              {category === cat && <View style={gp.catUnderline} />}
            </TouchableOpacity>
          ))}
        </View>

        {/* Gift grid — flex 1 so footer stays anchored */}
        <View style={{ flex: 1, minHeight: 0 }}>
          <FlatList
            data={gifts}
            keyExtractor={g => g.id}
            numColumns={4}
            contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 4 }}
            renderItem={({ item: g }) => {
              const isSel = selectedGift?.id === g.id;
              return (
                <TouchableOpacity
                  style={[gp.giftBtn, isSel && gp.giftBtnActive]}
                  onPress={() => { setSelectedGift(g); setCount(1); }}
                  activeOpacity={0.8}
                >
                  <Text style={gp.giftEmoji}>{g.emoji}</Text>
                  <Text style={gp.giftName} numberOfLines={1}>{g.name}</Text>
                  <Text style={gp.giftPrice}>🪙{g.priceCoins}</Text>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={{ color: '#9ca3af', textAlign: 'center', padding: 20 }}>No gifts</Text>}
          />
        </View>

        {/* Footer: recipient | count | Send */}
        <View style={gp.footer}>
          <View style={gp.footerLeft}>
            <View style={gp.footerAvWrap}>
              {isAll
                ? <Text style={{ fontSize: 18 }}>🎪</Text>
                : <Image source={{ uri: avatarUrl(displayReceiver?.avatar, displayReceiver?.name ?? 'User') }} style={gp.footerAv} />
              }
            </View>
            <View>
              <Text style={gp.footerRecipient} numberOfLines={1}>{receiverLabel}</Text>
              {selectedGift && <Text style={gp.footerCost}>🪙 {totalCost.toLocaleString()}</Text>}
            </View>
          </View>

          {/* Count +/- */}
          <View style={gp.countRow}>
            <TouchableOpacity style={gp.countBtn} onPress={() => setCount(c => Math.max(1, c - 1))}>
              <Text style={gp.countBtnTxt}>−</Text>
            </TouchableOpacity>
            <Text style={gp.countVal}>{count}</Text>
            <TouchableOpacity style={gp.countBtn} onPress={() => setCount(c => Math.min(99, c + 1))}>
              <Text style={gp.countBtnTxt}>+</Text>
            </TouchableOpacity>
          </View>

          {/* Send */}
          <TouchableOpacity
            style={[gp.sendBtn, (!selectedGift || !canAfford || sending || eligibles.length === 0) && gp.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!selectedGift || !canAfford || sending || eligibles.length === 0}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={gp.sendBtnTxt}>Send</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const gp = StyleSheet.create({
  backdrop:          { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:             { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden', height: SCREEN_H * 0.50 },
  handle:            { width: 36, height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, alignSelf: 'center', marginVertical: 8 },
  // Recipient row
  recipientRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  recipientChip:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1.5, borderColor: '#e5e7eb', flexShrink: 0 },
  recipientChipActive: { borderColor: '#7c3aed', backgroundColor: '#faf5ff' },
  recipientChipTxt:  { fontSize: 11, fontWeight: '600', color: '#6b7280' },
  personChip:        { alignItems: 'center', gap: 2, flexShrink: 0 },
  personAvatar:      { width: 28, height: 28, borderRadius: 14, backgroundColor: '#e0e7ff' },
  personName:        { fontSize: 9, color: '#6b7280', maxWidth: 36, textAlign: 'center' },
  coinBadge:         { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#fefce8', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#fde68a', flexShrink: 0 },
  coinTxt:           { fontSize: 11, fontWeight: '700', color: '#92400e' },
  // Category tabs
  catBar:            { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  catBtn:            { flex: 1, alignItems: 'center', paddingVertical: 8, position: 'relative' },
  catTxt:            { fontSize: 12, fontWeight: '600', color: '#9ca3af' },
  catTxtActive:      { color: '#7c3aed' },
  catUnderline:      { position: 'absolute', bottom: 0, left: '20%', right: '20%', height: 2, backgroundColor: '#7c3aed', borderRadius: 1 },
  // Gift grid
  grid:              { flex: 1 },
  giftBtn:           { flex: 1, margin: 3, alignItems: 'center', padding: 6, borderRadius: 10, borderWidth: 1.5, borderColor: '#f1f5f9', backgroundColor: '#fff', height: 72 },
  giftBtnActive:     { borderColor: '#7c3aed', backgroundColor: '#faf5ff' },
  giftEmoji:         { fontSize: 24, lineHeight: 28 },
  giftName:          { fontSize: 10, color: '#374151', fontWeight: '600', textAlign: 'center', marginTop: 2 },
  giftPrice:         { fontSize: 10, color: '#f59e0b', fontWeight: '700' },
  // Footer
  footer:            { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6', backgroundColor: '#fff' },
  footerLeft:        { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  footerAvWrap:      { width: 34, height: 34, borderRadius: 17, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', flexShrink: 0 },
  footerAv:          { width: 34, height: 34, borderRadius: 17 },
  footerRecipient:   { fontSize: 12, fontWeight: '700', color: '#111827' },
  footerCost:        { fontSize: 10, color: '#9ca3af' },
  countRow:          { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  countBtn:          { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', justifyContent: 'center', alignItems: 'center' },
  countBtnTxt:       { fontSize: 15, fontWeight: '700', color: '#374151', lineHeight: 18 },
  countVal:          { fontSize: 14, fontWeight: '800', color: '#111827', minWidth: 22, textAlign: 'center' },
  sendBtn:           { paddingHorizontal: 22, paddingVertical: 10, borderRadius: 24, backgroundColor: '#3b82f6', flexShrink: 0 },
  sendBtnDisabled:   { backgroundColor: '#d1d5db' },
  sendBtnTxt:        { color: '#fff', fontSize: 15, fontWeight: '800' },
});

// ─── Leaderboard Panel ────────────────────────────────────────────────────────
function LeaderboardPanel({ visible, roomId, onClose }: {
  visible: boolean; roomId: string; onClose: () => void;
}) {
  const { data: leaders = [] } = useQuery<GiftLeaderItem[]>({
    queryKey: ['gift-leaderboard', roomId],
    queryFn:  () => api.get(`/voice/${roomId}/gifts/leaderboard`, { params: { limit: 10 } }).then(r => r.data.data),
    enabled:  visible,
    staleTime: 15_000,
  });

  if (!visible) return null;

  const medals = ['🥇','🥈','🥉'];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.giftPanel, { paddingBottom: 32 }]}>
        <View style={styles.giftPanelHandle} />
        <Text style={[styles.giftPanelTitle, { marginBottom: 16 }]}>🏆  Top Gifters</Text>
        {leaders.length === 0 ? (
          <Text style={[styles.noReceivers, { marginTop: 20 }]}>No gifts sent yet</Text>
        ) : leaders.map((item, i) => (
          <View key={item.user.id} style={styles.leaderRow}>
            <Text style={styles.leaderRank}>{medals[i] || `#${i + 1}`}</Text>
            <Image source={{ uri: avatarUrl(item.user.avatarUrl, `${item.user.firstName} ${item.user.lastName}`) }} style={styles.leaderAvatar} />
            <View style={styles.leaderInfo}>
              <Text style={styles.leaderName}>{item.user.firstName} {item.user.lastName}</Text>
              <Text style={styles.leaderCoins}>🪙 {item.totalCoins.toLocaleString()} coins · {item.giftCount} gifts</Text>
            </View>
          </View>
        ))}
      </View>
    </Modal>
  );
}

// ─── Participant Tile ─────────────────────────────────────────────────────────
function ParticipantTile({ participant, queuePosition }: { participant: Participant; queuePosition?: number }) {
  const roleColor = participant.role === 'HOST' ? '#f59e0b'
    : participant.role === 'MODERATOR' ? '#10b981'
    : participant.role === 'SPEAKER'   ? '#6366f1' : '#6b7280';
  return (
    <View style={[styles.tile, participant.isSpeaking && styles.tileSpeaking]}>
      <View style={styles.tileAvatarWrap}>
        <Image source={{ uri: avatarUrl(participant.avatar, participant.name) }} style={styles.tileAvatar} />
        {participant.isSpeaking && <View style={styles.speakingRing} />}
        {participant.handRaised && <View style={styles.handBadge}><Text style={{ fontSize: 12 }}>✋</Text></View>}
        {/* Queue position badge for audience waiting */}
        {queuePosition !== undefined && participant.role === 'AUDIENCE' && (
          <View style={styles.queueBadge}>
            <Text style={styles.queueBadgeText}>#{queuePosition}</Text>
          </View>
        )}
      </View>
      <Text style={styles.tileName} numberOfLines={1}>{participant.name.split(' ')[0]}</Text>
      <View style={[styles.roleTag, { backgroundColor: roleColor + '22' }]}>
        <Text style={[styles.roleText, { color: roleColor }]}>{participant.role}</Text>
      </View>
      {participant.isMuted && <Ionicons name="mic-off" size={10} color="#ef4444" style={{ marginTop: 2 }} />}
      {queuePosition !== undefined && participant.role === 'AUDIENCE' && (
        <Text style={styles.queueLabel}>In queue</Text>
      )}
    </View>
  );
}

// ─── Speaking Ring — animated pulsing green ring (mirrors web .vc-speaking-ring) ──
function SpeakingRing({ size }: { size: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale,   { toValue: 1.18, duration: 500, useNativeDriver: true }),
          Animated.timing(scale,   { toValue: 1,    duration: 500, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.6, duration: 500, useNativeDriver: true }),
        ]),
      ])
    ).start();
    return () => { scale.stopAnimation(); opacity.stopAnimation(); };
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top:    -(size * 0.07),
        left:   -(size * 0.07),
        width:  size * 1.14,
        height: size * 1.14,
        borderRadius: size * 0.57,
        borderWidth: 3,
        borderColor: '#22c55e',
        opacity,
        transform: [{ scale }],
        zIndex: 0,
      }}
    />
  );
}

// ─── FloatingEmojiItem — animated emoji that pops, floats up, drifts, and fades ──
// Phase 8: replaces the static Animated.Text used in Phase 7.
// Uses RN Animated.Value for native-driver-compatible transform + opacity animation.
// Duration: 2.5s total — pop (0.12s) + float (2.38s).
// Pop: scale 0.6 → 1.1 → 1.0 (overshoot-settle feel).
// Float: translateY 0 → -160, with slight x-drift.
// Fade: opacity 1 → 1 → 0 (holds visible, then fades near end).
function FloatingEmojiItem({ emoji, x }: { emoji: string; x: number }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const scale      = useRef(new Animated.Value(0.6)).current;
  const opacity    = useRef(new Animated.Value(0)).current;
  const rotate     = useRef(new Animated.Value(0)).current;

  // Controlled randomization within safe bounds
  const driftX  = (x - 40) * 0.6;  // x is 10–80, so drift is -18 to +24px
  const rot     = (Math.random() * 14 - 7);  // ±7°
  const dur     = 2400 + Math.random() * 400; // 2.4–2.8s total

  useEffect(() => {
    // Pop phase: quick scale 0.6 → 1.1 → 1.0
    const popIn = Animated.sequence([
      Animated.timing(scale, { toValue: 1.1, duration: dur * 0.10, easing: (t) => t, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1.0, duration: dur * 0.06, easing: (t) => t, useNativeDriver: true }),
    ]);
    // Float up + drift + rotate — runs in parallel with pop then continues
    const floatUp  = Animated.timing(translateY, { toValue: -160, duration: dur, easing: (t) => t, useNativeDriver: true });
    const drift    = Animated.timing(translateX, { toValue: driftX, duration: dur * 0.7, easing: (t) => t * t, useNativeDriver: true });
    const tilt     = Animated.timing(rotate, { toValue: rot, duration: dur * 0.4, easing: (t) => t, useNativeDriver: true });
    // Fade: appear, hold, fade out (last 40%)
    const fadeIn   = Animated.timing(opacity, { toValue: 1, duration: dur * 0.08, useNativeDriver: true });
    const hold     = Animated.delay(dur * 0.52);
    const fadeOut  = Animated.timing(opacity, { toValue: 0, duration: dur * 0.40, useNativeDriver: true });

    Animated.parallel([
      Animated.sequence([popIn]),
      floatUp,
      drift,
      tilt,
      Animated.sequence([fadeIn, hold, fadeOut]),
    ]).start();
  }, []); // eslint-disable-line

  const rotateDeg = rotate.interpolate({ inputRange: [-15, 15], outputRange: ['-15deg', '15deg'] });

  return (
    <Animated.Text
      style={{
        position: 'absolute',
        bottom: 0,
        right: 0,
        fontSize: 30,
        opacity,
        transform: [
          { translateY },
          { translateX },
          { scale },
          { rotate: rotateDeg },
        ],
        pointerEvents: 'none',
      } as any}
    >
      {emoji}
    </Animated.Text>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function VoiceRoomScreen() {
  const { id }   = useLocalSearchParams<{ id: string }>();
  const router   = useRouter();
  const { user } = useAuthStore();
  const insets   = useSafeAreaInsets();
  const queryClient = useQueryClient();

  // ── Voice store — shared with tab bar for active-room badge ──────────────
  const { setActiveRoom, updateActiveRoom, clearActiveRoom, setQueuePosition, clearQueuePosition, setSpeaking } = useVoiceStore();

  const [isJoined,       setIsJoined]       = useState(false);
  const [showHostControls, setShowHostControls] = useState(false);
  // Phase 1+12: adaptive poll interval based on network quality
  const { quality: netQuality } = useNetworkQuality();
  // LiveKit real audio (native builds only — degrades gracefully in Expo Go)
  const lk = useLiveKitAudio();
  const [isConnecting,   setIsConnecting]   = useState(false);
  // isMuted is derived from participants (single source of truth) — no separate useState
  const [handRaised,     setHandRaised]     = useState(false);
  const [participants,   setParticipants]   = useState<Participant[]>([]);
  const [lockedSeats,    setLockedSeats]    = useState<number[]>([]);  // individual seat indices locked by host
  const [showGiftPanel,  setShowGiftPanel]  = useState(false);
  const [showLeaderboard,setShowLeaderboard]= useState(false);
  const [showChat,       setShowChat]       = useState(false);
  const [chatText,       setChatText]       = useState('');
  const [chatMessages,   setChatMessages]   = useState<ChatMsg[]>([]);
  const [animGift,       setAnimGift]       = useState<{ gift: Gift; senderName: string } | null>(null);
  const chatListRef = useRef<FlatList>(null);

  // ── Mic pass state ──────────────────────────────────────────────────────────
  const [showMicPassOffer,    setShowMicPassOffer]    = useState(false);
  const [micPassTarget,       setMicPassTarget]       = useState<MicPassUser | null>(null);
  const [showMicPassIncoming, setShowMicPassIncoming] = useState(false);
  const [micPassOfferedBy,    setMicPassOfferedBy]    = useState<MicPassUser | null>(null);
  const [micPassOfferId,      setMicPassOfferId]      = useState<string | null>(null);

  // ── Emoji reaction state ─────────────────────────────────────────────────────
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<{ id: string; emoji: string; x: number }[]>([]);

  // ── Background music state ───────────────────────────────────────────────────
  const [showBgMusic,   setShowBgMusic]   = useState(false);
  const [showDotMenu,   setShowDotMenu]   = useState(false);
  const [showMembersPanel, setShowMembersPanel] = useState(false); // FIX-L12a: member management
  const [showShare,     setShowShare]     = useState(false);    // Share room sheet
  // Room settings (host only)
  const [showRoomSettings, setShowRoomSettings] = useState(false);
  const [settingsTitle,    setSettingsTitle]    = useState('');
  const [settingsDescription, setSettingsDescription] = useState('');
  const [settingsTopic,    setSettingsTopic]    = useState('');
  const [settingsPrivacy,  setSettingsPrivacy]  = useState<'PUBLIC'|'PRIVATE'|'INVITE_ONLY'>('PUBLIC');
  const [settingsSaving,   setSettingsSaving]   = useState(false);
  // Mini indicator — reflects BgMusicPanel's internal state via callback
  const [bgMusicTrack,  setBgMusicTrack]  = useState<{ title: string; isDeviceFile: boolean } | null>(null);
  const [bgMusicPlaying, setBgMusicPlaying] = useState(false);

  // ── PK Battle state ──────────────────────────────────────────────────────────
  const [showPKPanel,          setShowPKPanel]          = useState(false);
  const [activePKMatchId,      setActivePKMatchId]      = useState<string | null>(null);
  const [activePKParticipants, setActivePKParticipants] = useState<Array<{
    userId: string; side: 'A' | 'B';
    user: { firstName: string; lastName: string; avatarUrl: string | null }
  }>>([]);
  const [activePKDuration, setActivePKDuration] = useState(300);

  // Fetch room
  const { data: room, isLoading } = useQuery<VoiceRoom>({
    queryKey: ['voice-room', id],
    queryFn: async () => {
      const res = await api.get(`/voice/${id}`);
      const r = res.data.data;
      const hostP = r.participants?.find((p: any) => p.role === 'HOST');
      return {
        ...r, name: r.title ?? r.name,
        host: {
          id: r.hostId ?? hostP?.userId ?? '',
          name: hostP ? `${hostP.user?.firstName ?? ''} ${hostP.user?.lastName ?? ''}`.trim() : 'Host',
          avatar: hostP?.user?.avatarUrl ?? null,
        },
        isLive: r.status === 'LIVE',
        participantsCount: r._count?.participants ?? 0,
        isOpenMic: r.isOpenMic ?? false,
        commentsEnabled: r.commentsEnabled ?? true,
        reactionsEnabled: r.reactionsEnabled ?? true,
        roomLevel: r.roomLevel ?? 1,
        slowMode: r.slowMode ?? false,
      } as VoiceRoom;
    },
    enabled: !!id,
    // Phase 12: slow down polling on poor networks to save battery+data
    refetchInterval: isJoined ? qualityToPollInterval(netQuality, 15000) || 60000 : false,
  });

  // Fetch gifts catalog
  const { data: gifts = [] } = useQuery<Gift[]>({
    queryKey: ['gifts-catalog'],
    queryFn:  () => api.get('/gifts').then(r => r.data.data ?? []),
    staleTime: 5 * 60_000,
  });

  // Fetch gift leaderboard — used in the header widget + LeaderboardPanel
  const { data: leaders = [] } = useQuery<GiftLeaderItem[]>({
    queryKey: ['gift-leaderboard', id],
    queryFn:  () => api.get(`/voice/${id}/gifts/leaderboard`, { params: { limit: 10 } }).then(r => r.data.data ?? []),
    enabled:  isJoined && !!id,
    staleTime: 15_000,
    refetchInterval: isJoined ? 30_000 : false,
  });

  // Fetch wallet
  const { data: wallet } = useQuery({
    queryKey: ['wallet-me'],
    queryFn:  () => api.get('/wallet/me').then(r => r.data.data),
    enabled:  isJoined,
  });

  // Fetch chat history on join
  const loadChat = useCallback(async () => {
    try {
      const res = await api.get(`/voice/${id}/messages`, { params: { limit: 50 } });
      setChatMessages(res.data.data || []);
    } catch {}
  }, [id]);

  // Socket: real-time events
  useEffect(() => {
    if (!isJoined || !user) return;
    const socket = getSocket();
    if (!socket) return;

    socket.emit('voice:join_room', id);

    // PH24C-005 FIX: Re-join the socket room after a reconnect.
    // When the socket disconnects and reconnects (network blip, token refresh,
    // app foreground), the socket no longer belongs to voice:${id}.
    // Without this handler, Phase 24B guards (socket.rooms.has(...)) silently
    // drop all voice events (reactions, speaking, role changes) after reconnect.
    // Matches web useVoiceRoom.ts: socket.on('connect', onReconnect).
    const onReconnect = () => {
      socket.emit('voice:join_room', id);
      // Re-fetch room state so participant list and roles reflect server truth
      // after a disconnect (stale data risk while socket was down).
      queryClient.invalidateQueries({ queryKey: ['voice-room', id] });
    };
    socket.on('connect', onReconnect);

    // Real-time gift animation
    const onGift = (payload: any) => {
      const giftData = gifts.find(g => g.id === payload.gift?.id) || payload.gift;
      if (giftData) {
        setAnimGift({ gift: giftData, senderName: payload.sender?.firstName || 'Someone' });
        // Refresh wallet balance after receiving a gift
        queryClient.invalidateQueries({ queryKey: ['wallet-me'] });
        queryClient.invalidateQueries({ queryKey: ['gift-leaderboard', id] });
      }
    };

    // Real-time chat
    const onMsg = (payload: any) => {
      const msg = payload.message || payload;
      setChatMessages(prev => {
        if (prev.find(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setTimeout(() => chatListRef.current?.scrollToEnd({ animated: true }), 100);
    };

    socket.on('voice:gift_sent',     onGift);
    socket.on('voice:premium_gift',  onGift);
    socket.on('voice:message',       onMsg);
    // FIX: removed duplicate unguarded voice:user_joined / voice:user_left handlers here.
    // The real handlers (onUserJoined / onUserLeft) registered below include roomId guards
    // and proper participant state updates. The duplicates below only invalidated queries
    // without checking roomId, causing cross-room query noise.

    // ── Real-time events ─────────────────────────────────────────────────────

    // Mute state changed for a participant (also carries seatNumber when dropping mic)
    const onMuteChanged = (d: { userId: string; isMuted: boolean; mutedByModerator?: boolean; seatNumber?: number | null }) => {
      setParticipants(prev => prev.map(p => {
        if (p.id !== d.userId) return p;
        const u: Participant = { ...p, isMuted: d.isMuted };
        if (d.mutedByModerator !== undefined) u.mutedByModerator = d.mutedByModerator;
        if (d.seatNumber !== undefined) u.seatNumber = d.seatNumber ?? null;
        return u;
      }));
      if (d.userId === user?.id) {
        if (lk.connected) {
          if (d.isMuted) lk.disableMic().catch(() => {});
          else lk.enableMic().catch(() => {});
        }
      }
    };

    // Role changed — carries seatNumber for seat assignment.
    // Used for both voice:role_changed (room-wide) and voice:your_role_changed (personal).
    // voice:your_role_changed may not include userId in older server versions;
    // fall back to user?.id so the promoted user's own seat always appears.
    const onRoleChanged = (d: { userId?: string; role: string; seatNumber?: number | null }) => {
      const targetId = d.userId ?? user?.id;
      if (!targetId) return;
      setParticipants(prev => {
        const updated = prev.map(p => {
          if (p.id !== targetId) return p;
          const u: Participant = { ...p, role: d.role as Participant['role'] };
          if (d.seatNumber !== undefined) u.seatNumber = d.seatNumber ?? null;
          if (d.role === 'AUDIENCE') { u.isMuted = true; u.seatNumber = null; }
          else if (d.role === 'SPEAKER' && d.seatNumber != null) u.isMuted = false;
          return u;
        });
        return updated;
      });
      queryClient.invalidateQueries({ queryKey: ['voice-room', id] });
      if (targetId === user?.id && lk.connected) {
        if (d.role === 'AUDIENCE') lk.disableMic().catch(() => {});
        else if (d.role === 'SPEAKER') lk.enableMic().catch(() => {});
      }
    };

    // Kicked — if it's me, leave immediately
    const onKicked = (d: { userId: string }) => {
      if (d.userId === user?.id) {
        showMessage({ message: '🚫 You were removed from this room', type: 'danger' });
        lk.disconnect();
        api.post(`/voice/${id}/leave`).catch(() => {});
        clearActiveRoom();
        clearQueuePosition();
        setIsJoined(false);
        router.back();
      } else {
        setParticipants(prev => prev.filter(p => p.id !== d.userId));
      }
    };

    // Hand raised/lowered
    const onHandRaised = (d: { userId: string; raised: boolean }) => {
      setParticipants(prev => prev.map(p => p.id === d.userId ? { ...p, handRaised: d.raised } : p));
    };

    // RT-FIX-6: Moderator removed — clear seatNumber so stage grid stays consistent.
    // Backend emits voice:moderator_removed when HOST removes a MODERATOR.
    // The demoted user's seat must be cleared immediately on all clients.
    const onModeratorRemoved = (d: { roomId: string; userId: string }) => {
      if (d.roomId !== id) return;
      setParticipants(prev => prev.map(p =>
        p.id === d.userId
          ? { ...p, role: 'AUDIENCE' as const, isMuted: true, seatNumber: null, handRaised: false }
          : p
      ));
    };

    // Room went IDLE (all left) or was explicitly terminated by host/admin
    // PERMANENT ROOMS: voice:room_ended fires when host calls endRoom() (ENDED terminal state)
    // OR when the room transitions LIVE → IDLE after 5-min grace (empty room sleep).
    // We do NOT force the user out — they can stay and wait for others to rejoin.
    // Only clear the UI if the room is truly ENDED (terminal — host archived it).
    const onRoomEnded = () => {
      showMessage({ message: '🔔 Room is now offline — it will be back when the host returns', type: 'info', duration: 3000 });
      // Do NOT call router.back() — the room is permanent and can be rejoined.
      // The participant list will empty itself naturally via voice:user_left events.
      // The room header will reflect IDLE status once the user polls or reconnects.
      setIsJoined(false);
      lk.disconnect();
      clearQueuePosition();
      // Leave the screen so they go back to the lobby (room stays in DB as IDLE)
      router.back();
    };

    // Open mic mode changed
    const onOpenMicChanged = (d: { isOpenMic: boolean }) => {
      queryClient.setQueryData<any>(['voice-room', id], (old: any) =>
        old ? { ...old, isOpenMic: d.isOpenMic } : old
      );
    };

    // Mic lock changed
    const onMicLockChanged = (d: { micLocked: boolean }) => {
      queryClient.setQueryData<any>(['voice-room', id], (old: any) =>
        old ? { ...old, micLocked: d.micLocked } : old
      );
      showMessage({ message: d.micLocked ? '🔒 Mic locked by host' : '🔓 Mic unlocked', type: 'info' });
    };

    // Seat lock changed (individual seat)
    const onSeatLockChanged = (d: { roomId: string; seatIndex: number; locked: boolean; lockedSeats: number[] }) => {
      if (d.roomId !== id) return;
      setLockedSeats(d.lockedSeats ?? []);
    };

    // Room settings updated (commentsEnabled, reactionsEnabled, etc.)
    const onRoomUpdated = (d: any) => {
      if (d.roomId !== id) return;
      queryClient.setQueryData<any>(['voice-room', id], (old: any) =>
        old ? {
          ...old,
          ...(d.commentsEnabled  !== undefined && { commentsEnabled:  d.commentsEnabled }),
          ...(d.reactionsEnabled !== undefined && { reactionsEnabled: d.reactionsEnabled }),
          ...(d.isOpenMic        !== undefined && { isOpenMic:        d.isOpenMic }),
          ...(d.micLocked        !== undefined && { micLocked:        d.micLocked }),
          ...(d.slowMode         !== undefined && { slowMode:         d.slowMode }),
          ...(d.messageType      !== undefined && { messageType:      d.messageType }),
        } : old
      );
    };

    // New participant joined — add to list
    const onUserJoined = (d: any) => {
      // SEAT SYNC FIX: Deterministic sort key — role asc then joinedAt asc
      const PARTICIPANT_ROLE_ORDER: Record<string, number> = { HOST: 0, MODERATOR: 1, SPEAKER: 2, AUDIENCE: 3 };
      const newP = {
        id:               d.userId,
        name:             `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() || 'User',
        avatar:           d.avatarUrl ?? null,
        role:             (d.role ?? 'AUDIENCE') as Participant['role'],
        isMuted:          d.isMuted ?? true,
        isSpeaking:       false,
        handRaised:       false,
        mutedByModerator: d.mutedByModerator ?? false,
        isActive:         true,
        seatNumber:       d.seatNumber != null ? Number(d.seatNumber) : null,
        _joinedAt:        d.joinedAt ?? new Date().toISOString(),
      };
      setParticipants(prev => {
        if (prev.find(p => p.id === d.userId)) return prev;
        // Insert in deterministic sorted position so all clients see identical seat layout
        const updated = [...prev, newP as any];
        return updated.sort((a: any, b: any) => {
          const ra = PARTICIPANT_ROLE_ORDER[a.role] ?? 9;
          const rb = PARTICIPANT_ROLE_ORDER[b.role] ?? 9;
          if (ra !== rb) return ra - rb;
          return (a._joinedAt ?? '').localeCompare(b._joinedAt ?? '');
        });
      });
    };

    // Participant left — remove from list
    const onUserLeft = (d: { userId: string }) => {
      setParticipants(prev => prev.filter(p => p.id !== d.userId));
    };

    // Mic pass offer received (incoming)
    const onMicPassOffer = (d: { offerId?: string; offeredBy?: { id: string; firstName: string; lastName: string; avatarUrl?: string | null }; passerId?: string; passerName?: string; passerAvatar?: string | null }) => {      // Backend sends { offerId, roomId, passerName, passerAvatar } — normalise both formats
      const offererId = d.offeredBy?.id ?? d.passerId ?? '';
      const offererName = d.offeredBy
        ? `${d.offeredBy.firstName} ${d.offeredBy.lastName}`.trim()
        : d.passerName ?? 'Host';
      const offererAvatar = d.offeredBy?.avatarUrl ?? d.passerAvatar ?? null;
      setMicPassOfferedBy({ id: offererId, name: offererName, avatar: offererAvatar });
      setMicPassOfferId(d.offerId ?? null);
      setShowMicPassIncoming(true);
    };

    // Mic pass accepted — someone accepted the mic offer we (sender) sent.
    // Backend event: voice:mic_passed { roomId, passerId, passerName, targetId, targetName, passerRole, seatNumber }
    const onMicPassResult = (d: { passerId?: string; targetId?: string; targetName?: string; passerRole?: string; seatNumber?: number | null }) => {
      // If we are the passer, show confirmation
      if (d.passerId === user?.id) {
        showMessage({ message: `🎤 ${d.targetName ?? 'User'} accepted the mic!`, type: 'success' });
      }
      // Update roles in participant list — passer releases seat, target takes it
      if (d.passerRole && d.passerRole !== 'HOST' && d.passerId) {
        setParticipants(prev => prev.map(p =>
          p.id === d.passerId ? { ...p, role: 'AUDIENCE' as const, isMuted: true, seatNumber: null } : p
        ));
      }
      if (d.targetId) {
        setParticipants(prev => prev.map(p =>
          p.id === d.targetId ? {
            ...p, role: 'SPEAKER' as const, isMuted: false, handRaised: false,
            seatNumber: d.seatNumber != null ? Number(d.seatNumber) : p.seatNumber,
          } : p
        ));
      }
      setShowMicPassOffer(false);
    };


    // Member count updates
    const onMemberJoined = (d: { roomId: string; memberCount: number }) => {
      if (d.roomId !== id) return;
      setMemberCount(d.memberCount);
    };
    const onMemberLeft = (d: { roomId: string; memberCount: number }) => {
      if (d.roomId !== id) return;
      setMemberCount(d.memberCount);
    };
    const onRoomLevelUpgraded = (d: { roomId: string; roomLevel: number }) => {
      if (d.roomId !== id) return;
      queryClient.setQueryData<any>(['voice-room', id], (old: any) =>
        old ? { ...old, roomLevel: d.roomLevel } : old
      );
    };
    // BUG FIX: backend emits 'voice:mic_offer' / 'voice:mic_passed', not
    // 'voice:mic_pass_offer' / 'voice:mic_pass_result'.  Using wrong names
    // means mic-pass offers silently never arrived on mobile.
    socket.on('voice:mic_offer',    onMicPassOffer);
    socket.on('voice:mic_passed',   onMicPassResult);
    // mic_declined: recipient said no — notify the passer
    socket.on('voice:mic_declined', (d: { roomId: string; targetName?: string }) => {
      if (d.roomId !== id) return;
      showMessage({ message: `${d.targetName ?? 'User'} declined the mic`, type: 'info' });
      setShowMicPassOffer(false);
    });
    // mic_offer_cancelled: passer changed mind — dismiss incoming modal
    socket.on('voice:mic_offer_cancelled', (d: { roomId: string }) => {
      if (d.roomId !== id) return;
      setShowMicPassIncoming(false);
      setMicPassOfferedBy(null);
      setMicPassOfferId(null);
      showMessage({ message: 'Mic offer was cancelled', type: 'info' });
    });
    // mic_received: server confirms we are now on stage
    socket.on('voice:mic_received', (d: { roomId: string; message?: string }) => {
      if (d.roomId !== id) return;
      showMessage({ message: '🎙️ You\'re now on stage!', type: 'success' });
    });

    socket.on('voice:mute_changed',   onMuteChanged);
    socket.on('voice:role_changed',   onRoleChanged);
    socket.on('voice:your_role_changed', onRoleChanged);
    socket.on('voice:kicked',         onKicked);
    socket.on('voice:moderator_removed', onModeratorRemoved);  // RT-FIX-6
    socket.on('voice:hand_raised',    onHandRaised);
    socket.on('voice:room_ended',     onRoomEnded);
    socket.on('voice:open_mic_changed', onOpenMicChanged);
    socket.on('voice:mic_lock_changed', onMicLockChanged);
    socket.on('voice:seat_lock_changed', onSeatLockChanged);
    socket.on('voice:room_updated',      onRoomUpdated);
    socket.on('voice:join_request',      (d: any) => { if (d.roomId !== id) return; showMessage({ message: `✋ ${d.firstName ?? ''} ${d.lastName ?? ''} wants to join the room`, type: 'info' }); });
    socket.on('voice:join_approved',     (d: any) => { if (d.roomId !== id) return; showMessage({ message: '✅ Your join request was approved!', type: 'success' }); setIsMember(true); setMemberLevel(1); });
    socket.on('voice:removed_from_room', (d: any) => {
      if (d.roomId !== id) return;
      showMessage({ message: '🚫 You were removed from this room', type: 'danger' });
      clearActiveRoom(); clearQueuePosition();
      router.back();
    });
    // voice:blocked_from_room — emitted by room-member.controller.js blockMember()
    socket.on('voice:blocked_from_room', (d: any) => {
      if (d.roomId !== id) return;
      showMessage({ message: '⛔ You were blocked from this room', type: 'danger' });
      clearActiveRoom(); clearQueuePosition();
      router.back();
    });
    socket.on('voice:speaker_pinned',    (d: any) => { if (d.roomId !== id) return; setParticipants(prev => prev.map(p => ({ ...p, handRaised: p.id === d.userId ? false : p.handRaised }))); });

    // ── Emoji reactions (broadcast from other participants) ───────────────────
    // Parity with web: voice:reaction { userId, emoji } is broadcast by the backend
    // to all room members when any participant sends a reaction.
    // Rate-limited on backend: 10 per 2s. reactionsEnabled is checked on backend.
    const onReaction = (d: { userId: string; emoji: string }) => {
      // Don't show own reactions from other sockets (already shown locally)
      if (d.userId === user?.id) return;
      const reactionId = `${Date.now()}-${Math.random()}`;
      const x = 10 + Math.random() * 70; // random horizontal position 10–80%
      setFloatingEmojis(prev => [...prev.slice(-9), { id: reactionId, emoji: d.emoji, x }]);
      setTimeout(() => {
        setFloatingEmojis(prev => prev.filter(e => e.id !== reactionId));
      }, 2500);
    };
    socket.on('voice:reaction', onReaction);
    // Queue position — update shared store so the tab bar can show it
    socket.on('voice:queue_position',    (d: any) => { if (d.roomId !== id) return; setQueuePosition(d.position ?? 0); });
    // Queue resolved (promoted or rejected) — clear position
    socket.on('voice:queue_rejected',    (d: any) => { if (d.roomId !== id) return; clearQueuePosition(); showMessage({ message: d.message ?? 'Your request was declined', type: 'warning' }); });
    socket.on('voice:promoted_to_speaker', (d: any) => { if (d.roomId !== id) return; clearQueuePosition(); showMessage({ message: '🎙️ You\'re on stage!', type: 'success' }); });
    socket.on('voice:member_joined',       onMemberJoined);
    socket.on('voice:member_left',         onMemberLeft);
    socket.on('voice:room_level_upgraded', onRoomLevelUpgraded);
    socket.on('voice:user_joined',    onUserJoined);
    socket.on('voice:user_left',      onUserLeft);

    // FIX-MOB-1: voice:banned — emitted by banParticipant() on two channels:
    //   1. Room-wide: voice:{roomId} → { roomId, userId } — remove participant for others
    //   2. Personal:  user:{banned}  → { roomId, reason } — evict the banned user
    // Previously missing: banned user's mobile UI was never evicted.
    socket.on('voice:banned', (d: { roomId: string; userId?: string; reason?: string }) => {
      if (d.roomId !== id) return;
      if (d.userId && d.userId !== user?.id) {
        // Another participant was banned — remove them from the list
        setParticipants(prev => prev.filter(p => p.id !== d.userId));
      } else {
        // I was banned — evict me
        showMessage({ message: `⛔ You were banned from this room${d.reason ? ': ' + d.reason : ''}`, type: 'danger', duration: 4000 });
        lk.disconnect();
        api.post(`/voice/${id}/leave`).catch(() => {});
        clearActiveRoom();
        clearQueuePosition();
        setIsJoined(false);
        router.back();
      }
    });

    // FIX-MOB-2: voice:status_changed — room transitions (LIVE↔IDLE).
    // Previously missing: mobile never reflected room status changes.
    socket.on('voice:status_changed', (d: { roomId: string; status: string }) => {
      if (d.roomId !== id) return;
      queryClient.setQueryData<any>(['voice-room', id], (old: any) =>
        old ? { ...old, isLive: d.status === 'LIVE', status: d.status } : old
      );
    });

    // FIX-MOB-3: voice:queue_updated — FIFO speaker queue state.
    // Previously missing: mobile speakerQueue in useVoiceStore was always stale.
    socket.on('voice:queue_updated', (d: { roomId: string; queue: any[]; queueLength: number }) => {
      if (d.roomId !== id) return;
      useVoiceStore.getState().setSpeakerQueue(d.queue ?? []);
    });

    // MODERATOR ASSIGNMENT — realtime update for all participants
    // voice:moderator_assigned: HOST assigned someone as MODERATOR
    socket.on('voice:moderator_assigned', (d: { roomId: string; userId: string; firstName?: string; lastName?: string }) => {
      if (d.roomId !== id) return;
      // Update the participant's role to MODERATOR — does NOT change seatNumber
      setParticipants(prev => prev.map(p =>
        p.id === d.userId ? { ...p, role: 'MODERATOR' as const } : p
      ));
      if (d.userId === user?.id) {
        showMessage({ message: '🛡️ You are now a moderator!', type: 'success' });
      }
    });

    // MODERATOR REMOVAL — realtime update for all participants
    // voice:moderator_removed: HOST removed someone's MODERATOR role
    socket.on('voice:moderator_removed', (d: { roomId: string; userId: string; message?: string }) => {
      if (d.roomId !== id) return;
      // Demote to AUDIENCE — does NOT change seatNumber (they keep their seat if on stage)
      setParticipants(prev => prev.map(p =>
        p.id === d.userId ? { ...p, role: 'AUDIENCE' as const } : p
      ));
      if (d.userId === user?.id) {
        showMessage({ message: d.message ?? 'Your moderator role has been removed.', type: 'info' });
      }
    });

    // YOU ARE MODERATOR — personal notification when the local user is made mod
    socket.on('voice:you_are_moderator', (d: { roomId: string; message?: string }) => {
      if (d.roomId !== id) return;
      showMessage({ message: d.message ?? '🛡️ You are now a moderator!', type: 'success' });
    });

    // YOU ARE HOST — personal notification when the local user becomes host
    socket.on('voice:you_are_host', (d: { roomId: string; message?: string }) => {
      if (d.roomId !== id) return;
      showMessage({ message: d.message ?? '👑 You are now the host!', type: 'success' });
    });

    // ── PK room events ────────────────────────────────────────────────────────
    socket.on('pk:room:started', (d: {
      pkMatchId: string; durationSeconds: number;
      participants: Array<{ userId: string; side: 'A' | 'B'; user: { firstName: string; lastName: string; avatarUrl: string | null } }>
    }) => {
      setActivePKMatchId(d.pkMatchId);
      setActivePKDuration(d.durationSeconds);
      setActivePKParticipants(d.participants);
    });

    socket.on('pk:room:ended', (d: { pkMatchId: string }) => {
      setTimeout(() => {
        setActivePKMatchId(prev => prev === d.pkMatchId ? null : prev);
      }, 6500);
    });

    // ATOMIC STAGE STATE: authoritative snapshot after seat changes — reconcile any stale state
    socket.on('voice:stage_state', (d: {
      roomId: string;
      stageParticipants: Array<{
        userId: string; role: string; isMuted: boolean; seatNumber: number | null;
        isPinned: boolean; handRaised: boolean; mutedByModerator: boolean;
      }>;
      stageCount: number;
    }) => {
      if (d.roomId !== id) return;
      // Apply authoritative seatNumber for every stage participant
      setParticipants(prev => {
        const updated = [...prev];
        // First clear all seatNumbers (stage_state is authoritative)
        const inStageIds = new Set(d.stageParticipants.map(sp => sp.userId));
        for (let i = 0; i < updated.length; i++) {
          if (!inStageIds.has(updated[i].id)) {
            updated[i] = { ...updated[i], seatNumber: null };
          }
        }
        // Apply each stage participant's authoritative state
        d.stageParticipants.forEach(sp => {
          const idx = updated.findIndex(p => p.id === sp.userId);
          if (idx >= 0) {
            updated[idx] = {
              ...updated[idx],
              role: sp.role as Participant['role'],
              isMuted: sp.isMuted,
              mutedByModerator: sp.mutedByModerator,
              handRaised: sp.handRaised,
              seatNumber: sp.seatNumber,
            };
          }
        });
        return updated;
      });
    });

    return () => {
      socket.emit('voice:leave_room', id);
      // PH24C-005: remove the reconnect handler so it doesn't fire after unmount
      socket.off('connect', onReconnect);
      socket.off('voice:gift_sent',    onGift);
      socket.off('voice:premium_gift', onGift);
      socket.off('voice:message',      onMsg);
      socket.off('voice:mute_changed',     onMuteChanged);
      socket.off('voice:role_changed',     onRoleChanged);
      socket.off('voice:your_role_changed', onRoleChanged);
      socket.off('voice:kicked',           onKicked);
      socket.off('voice:hand_raised',      onHandRaised);
      socket.off('voice:room_ended',       onRoomEnded);
      socket.off('voice:open_mic_changed', onOpenMicChanged);
      socket.off('voice:mic_lock_changed', onMicLockChanged);
      socket.off('voice:seat_lock_changed', onSeatLockChanged);
      socket.off('voice:room_updated',      onRoomUpdated);
      socket.off('voice:join_request');
      socket.off('voice:join_approved');
      socket.off('voice:removed_from_room');
      socket.off('voice:blocked_from_room');
      socket.off('voice:speaker_pinned');
      socket.off('voice:queue_position');
      socket.off('voice:queue_rejected');
      socket.off('voice:promoted_to_speaker');
      socket.off('voice:member_joined',       onMemberJoined);
      socket.off('voice:member_left',         onMemberLeft);
      socket.off('voice:room_level_upgraded', onRoomLevelUpgraded);
      socket.off('voice:user_joined',      onUserJoined);
      socket.off('voice:user_left',        onUserLeft);
      socket.off('voice:mic_offer',           onMicPassOffer);
      socket.off('voice:mic_passed',          onMicPassResult);
      socket.off('pk:room:started');
      socket.off('pk:room:ended');
      socket.off('voice:mic_declined');
      socket.off('voice:mic_offer_cancelled');
      socket.off('voice:mic_received');
      // FIX-MOB-1/2/3: cleanup for the three newly-added handlers
      socket.off('voice:banned');
      socket.off('voice:status_changed');
      socket.off('voice:moved_to_audience');
      socket.off('voice:stage_state');
      socket.off('voice:queue_updated');
      // MODERATOR realtime events
      socket.off('voice:moderator_assigned');
      socket.off('voice:moderator_removed');
      socket.off('voice:you_are_moderator');
      socket.off('voice:you_are_host');
      // Emoji reactions
      socket.off('voice:reaction', onReaction);
    };
  }, [isJoined, id, user, gifts, queryClient]);

  const handleJoin = useCallback(async () => {
    // SA-VOICE-MOBILE-01: SUPER_ADMIN = Platform Administration ONLY.
    // Platform admins cannot join voice rooms as participants.
    if (user?.role === 'SUPER_ADMIN') {
      showMessage({ message: 'Platform admins cannot join voice rooms. Use the admin panel.', type: 'warning' });
      return;
    }
    if (!room) return;
    setIsConnecting(true);
    try {
      const res = await api.post(`/voice/${id}/join`);
      // Init socket if not already done
      const token = (await import('@/store/auth.store')).useAuthStore.getState().accessToken;
      if (token && !getSocket()?.connected) initSocket(token);

      setIsJoined(true);

      // Store in shared voice store so the tab bar shows the "IN ROOM" badge
      const roomData = res.data.data;
      if (room && id) {
        setActiveRoom({
          id:              id,
          title:           room.name ?? room.title ?? '',
          status:          (roomData?.status ?? 'LIVE') as any,
          privacy:         (roomData?.privacy ?? 'PUBLIC') as any,
          coverEmoji:      roomData?.coverEmoji ?? null,
          coverImageUrl:   roomData?.coverImageUrl ?? null,
          topic:           roomData?.topic ?? null,
          hostId:          roomData?.hostId ?? room.host?.id ?? '',
          isOpenMic:       roomData?.isOpenMic ?? false,
          micLocked:       roomData?.micLocked ?? false,
          lockedSeats:     Array.isArray(roomData?.lockedSeats) ? roomData.lockedSeats : [],
          commentsEnabled: roomData?.commentsEnabled ?? true,
          slowMode:        roomData?.slowMode ?? false,
          messageType:     (roomData?.messageType ?? 'all') as 'all' | 'followers' | 'none',
          reactionsEnabled: roomData?.reactionsEnabled ?? true,
          roomLevel:       roomData?.roomLevel ?? 1,
          schoolId:        roomData?.schoolId ?? null,
        });
      }

      const parts = (roomData?.participants || []).map((p: any) => ({
        id:               p.userId ?? p.id,
        name:             p.user ? `${p.user.firstName} ${p.user.lastName}`.trim() : 'User',
        avatar:           p.user?.avatarUrl ?? null,
        role:             p.role,
        isMuted:          p.isMuted ?? true,
        isSpeaking:       false,
        handRaised:       p.handRaised ?? false,
        mutedByModerator: p.mutedByModerator ?? false,
        isActive:         p.isActive !== false,
        seatNumber:       p.seatNumber != null ? Number(p.seatNumber) : null,
        _joinedAt:        p.joinedAt ?? '',
      }));
      setParticipants(parts.length > 0 ? parts : [{
        id: room.host.id, name: room.host.name, avatar: room.host.avatar ?? undefined,
        role: 'HOST', isMuted: false, isSpeaking: false, handRaised: false,
        mutedByModerator: false,
        isActive: true, seatNumber: null,
        _joinedAt: '',
      }]);
      if (Array.isArray(roomData?.lockedSeats)) {
        setLockedSeats(roomData.lockedSeats);
      }
      await loadChat();
      // Connect LiveKit for real audio (native builds only)
      try {
        const tokenRes = await api.post(`/voice/${id}/livekit-token`);
        const { token: lkToken, livekitUrl } = tokenRes.data.data;
        if (lkToken && livekitUrl) {
          // PH19-002 FIX: pass tokenFetcher so every reconnect path obtains
          // a fresh token from the authoritative backend endpoint rather than
          // reusing the stale cached token.
          //
          // tokenFetcher calls POST /voice/:id/livekit-token — the same endpoint
          // that issued the initial token. The backend verifies:
          //   1. Room exists and is not ENDED
          //   2. Caller has an active VoiceParticipant record (isActive:true)
          //
          // A kicked/banned user will have isActive:false in the DB by the time
          // their Disconnected event fires and reconnect is attempted. The backend
          // returns 403, which causes tokenFetcher to throw, which halts retries.
          const tokenFetcher = async (): Promise<string> => {
            const res = await api.post(`/voice/${id}/livekit-token`);
            const token = res.data?.data?.token;
            if (!token) throw new Error('No token in response');
            return token;
          };
          await lk.connect(livekitUrl, lkToken, true /* start muted */, id, tokenFetcher);
        }
      } catch { /* non-fatal — audio not available in Expo Go */ }
      showMessage({ message: `Joined ${room.name ?? room.title}`, type: 'success' });
    } catch (err: any) {
      const code = err?.response?.data?.errors?.code;
      if (code === 'VOICE_ROOM_ALREADY_ACTIVE') {
        // Show native conflict dialog — names room B (the active one) clearly.
        // The conflict data lives under response.data.errors (not response.data directly).
        const activeRoomEmoji = err?.response?.data?.errors?.activeRoomEmoji ?? '🎙️';
        const activeRoomTitle = err?.response?.data?.errors?.activeRoomTitle ?? 'another room';
        const activeRoomId    = err?.response?.data?.errors?.activeRoomId    ?? '';
        const activeRoomTopic = err?.response?.data?.errors?.activeRoomTopic ?? null;
        const subtitle = activeRoomTopic
          ? `"${activeRoomTitle}" · ${activeRoomTopic}`
          : `"${activeRoomTitle}"`;

        Alert.alert(
          `${activeRoomEmoji} You're already in a room`,
          `You are currently in ${subtitle}.\n\nLeave that Voice Club to join this one?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Leave & Join',
              style: 'destructive',
              onPress: async () => {
                setIsConnecting(true);
                try {
                  // 1. Disconnect LiveKit from room B
                  lk.disconnect();
                  // 2. Leave room B on server
                  try { await api.post(`/voice/${activeRoomId}/leave`); } catch {}
                  // 3. Leave Socket.IO room B
                  const socket = getSocket();
                  if (socket) socket.emit('voice:leave_room', activeRoomId);
                  // 4. Clear store
                  clearActiveRoom();
                  // 5. Join room A (this room)
                  await handleJoin();
                } finally {
                  setIsConnecting(false);
                }
              },
            },
          ],
          { cancelable: true }
        );
        return;
      }
      showMessage({
        message: err?.response?.data?.message ?? 'Failed to join room',
        type: 'danger',
      });
    } finally { setIsConnecting(false); }
  }, [id, room, loadChat, lk, clearActiveRoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLeave = useCallback(() => {
    Alert.alert('Leave Room', 'Are you sure you want to leave?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        try { await api.post(`/voice/${id}/leave`); } catch {}
        lk.disconnect();
        clearActiveRoom();
        clearQueuePosition();
        setIsJoined(false);
        router.back();
      }},
    ]);
  }, [id, router, clearActiveRoom, clearQueuePosition]);

  // MOB-004: Android hardware back button — intercept when inside a live room.
  // Without this, pressing the Android back button navigates away silently,
  // leaving the user as an active participant in the DB and keeping the
  // LiveKit connection open (ghost participant + media leak).
  // Show the same confirmation dialog as the Leave button.
  useEffect(() => {
    if (!isJoined) return; // only intercept when inside the room
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleLeave(); // shows Alert — user must confirm leave
      return true;   // true = event consumed, default back prevented
    });
    return () => sub.remove();
  }, [isJoined, handleLeave]);

  const toggleMic = useCallback(async () => {
    // LOCAL-ONLY mic toggle for HOST/MOD on stage.
    // Does NOT call backend and does NOT update participants.isMuted.
    // This keeps HOST/MOD visible on stage (amOnStage depends on !isMuted in participants).
    // "End Mic" button is the only action that sets isMuted=true in DB → moves to audience.
    // For SPEAKERs, this also only toggles LiveKit (they stay SPEAKER until demoted).
    // GUARD: if the participant was muted by a moderator, they cannot self-unmute locally.
    const me = participants.find(p => p.id === user?.id);
    if (me?.mutedByModerator && me?.isMuted) {
      showMessage({ message: '🔒 You were muted by a moderator', type: 'warning' });
      return;
    }
    if (lk.connected) {
      const currentMuted = me?.isMuted ?? true;
      if (currentMuted) await lk.enableMic();
      else await lk.disableMic();
    }
  }, [participants, user?.id]);

  const toggleHand = useCallback(async () => {
    if (room?.micLocked) { showMessage({ message: '🔒 Mic is locked by the host', type: 'warning' }); return; }
    const newRaised = !handRaised;
    setHandRaised(newRaised);
    try { await api.patch(`/voice/${id}/raise-hand`, { raised: newRaised }); } catch {}
    setParticipants(prev => prev.map(p =>
      p.id === user?.id ? { ...p, handRaised: newRaised } : p
    ));
  }, [id, handRaised, user]);

  // handleGrabMic — for normal AUDIENCE users when Free Stage (isOpenMic) is ON.
  // Calls POST /grab-mic directly. Backend either seats them instantly (free seat)
  // or enqueues them (stage full). Queue result is reflected via voice:hand_raised socket.
  const handleGrabMic = useCallback(async () => {
    if (room?.micLocked) { showMessage({ message: '🔒 Mic is locked by the host', type: 'warning' }); return; }
    try {
      const res = await api.post(`/voice/${id}/grab-mic`);
      const { queued, position } = res.data.data ?? {};
      if (queued) {
        setHandRaised(true);
        setParticipants(prev => prev.map(p =>
          p.id === user?.id ? { ...p, handRaised: true } : p
        ));
        showMessage({
          message: `✋ You're #${position ?? '?'} in the queue — waiting for a seat`,
          type: 'info',
        });
      } else {
        showMessage({ message: '🎤 You are on stage!', type: 'success' });
      }
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to take mic', type: 'danger' });
    }
  }, [id, room?.micLocked, user?.id]);

  // ── Host/Moderator controls ───────────────────────────────────────────────
  const myRole = participants.find(p => p.id === user?.id)?.role ?? (room?.hostId === user?.id ? 'HOST' : 'AUDIENCE');
  const canModerate = myRole === 'HOST' || myRole === 'MODERATOR';

  const handleMuteAll = useCallback(async () => {
    try { await api.patch(`/voice/${id}/mute-all`); showMessage({ message: '🔇 All speakers muted', type: 'info' }); } catch {}
  }, [id]);

  const handleMuteUser = useCallback(async (targetId: string, currentlyMuted: boolean) => {
    try {
      await api.patch(`/voice/${id}/mute`, { targetUserId: targetId, isMuted: !currentlyMuted });
      // Optimistic update: also set mutedByModerator so the target's mic button locks correctly
      setParticipants(prev => prev.map(p =>
        p.id === targetId
          ? { ...p, isMuted: !currentlyMuted, mutedByModerator: !currentlyMuted }
          : p
      ));
      showMessage({ message: !currentlyMuted ? '🔇 Speaker muted' : '🎙️ Speaker unmuted', type: 'info' });
    } catch {}
  }, [id]);

  const handlePromote = useCallback(async (targetId: string, role: 'SPEAKER' | 'AUDIENCE') => {
    try {
      await api.patch(`/voice/${id}/promote`, { targetUserId: targetId, role });
      setParticipants(prev => prev.map(p =>
        p.id === targetId
          ? {
              ...p,
              role,
              isMuted: role === 'AUDIENCE',
              mutedByModerator: false,   // clear flag on any role change
              // For SPEAKER promotion: do NOT set seatNumber optimistically — it's null in the
              // audience and the backend assigns the real seat. The voice:role_changed socket
              // event (or voice:stage_state) will provide the authoritative seatNumber.
              // For AUDIENCE demotion: always clear seatNumber immediately.
              seatNumber: role === 'AUDIENCE' ? null : p.seatNumber,
            }
          : p
      ));
      showMessage({ message: role === 'SPEAKER' ? '🎙️ Promoted to speaker' : 'Moved to audience', type: 'success' });
    } catch (e: any) { showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }); }
  }, [id]);

  const handleKick = useCallback((targetId: string, name: string) => {
    Alert.alert('Remove', `Remove ${name} from the room?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await api.delete(`/voice/${id}/kick/${targetId}`); setParticipants(prev => prev.filter(p => p.id !== targetId)); } catch {}
      }},
    ]);
  }, [id]);

  const handleBan = useCallback((targetId: string, name: string) => {
    Alert.alert(
      'Ban from Room',
      `Ban ${name}? They will be removed and cannot rejoin this room.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Ban', style: 'destructive', onPress: async () => {
          try {
            await api.post(`/voice/${id}/ban/${targetId}`, { reason: '' });
            setParticipants(prev => prev.filter(p => p.id !== targetId));
            showMessage({ message: `⛔ ${name} banned from room`, type: 'success' });
          } catch (e: any) {
            showMessage({ message: e?.response?.data?.message ?? 'Failed to ban', type: 'danger' });
          }
        }},
      ]
    );
  }, [id]);

  const handleUnban = useCallback(async (targetId: string, name: string) => {
    try {
      await api.delete(`/voice/${id}/ban/${targetId}`);
      showMessage({ message: `✅ ${name} unbanned`, type: 'success' });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to unban', type: 'danger' });
    }
  }, [id]);

  const handleUnmuteAll = useCallback(async () => {
    try {
      await api.patch(`/voice/${id}/unmute-all`);
      showMessage({ message: '🎙️ All speakers unmuted', type: 'info' });
    } catch {}
  }, [id]);

  const handleEndRoom = useCallback(async () => {
    Alert.alert('End Room', 'End the room for everyone?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End', style: 'destructive', onPress: async () => {
        try { await api.patch(`/voice/${id}/end`); } catch {}
        lk.disconnect();
        clearActiveRoom();
        clearQueuePosition();
        setIsJoined(false);
        router.back();
      }},
    ]);
  }, [id, router, clearActiveRoom, clearQueuePosition]);

  const handleApproveQueue = useCallback(async () => {
    try { await api.post(`/voice/${id}/queue/approve`); showMessage({ message: '✅ Next speaker approved', type: 'success' }); } catch {}
  }, [id]);

  // Approve a SPECIFIC queued user — handles both AUDIENCE→SPEAKER and
  // MODERATOR→unmuted-on-stage. The generic PATCH /promote rejects MODERATOR targets.
  const handleApproveQueueUser = useCallback(async (targetId: string) => {
    try {
      await api.post(`/voice/${id}/queue/approve/${targetId}`);
      showMessage({ message: '🎙️ Approved to stage', type: 'success' });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to approve', type: 'danger' });
    }
  }, [id]);

  const handleAssignMod = useCallback(async (targetId: string, name: string) => {
    try {
      await api.post(`/voice/${id}/moderator/${targetId}`);
      setParticipants(prev => prev.map(p => p.id === targetId ? { ...p, role: 'MODERATOR' as const } : p));
      showMessage({ message: `🛡️ ${name} is now a moderator`, type: 'success' });
    } catch (e: any) { showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }); }
  }, [id]);

  const handleRemoveMod = useCallback(async (targetId: string, name: string) => {
    try {
      await api.delete(`/voice/${id}/moderator/${targetId}`);
      setParticipants(prev => prev.map(p => p.id === targetId ? { ...p, role: 'AUDIENCE' as const } : p));
      showMessage({ message: `${name} removed from moderators`, type: 'info' });
    } catch (e: any) { showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }); }
  }, [id]);

  const handleTransferHost = useCallback((targetId: string, name: string) => {
    Alert.alert('Transfer Host', `Make ${name} the new host?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Transfer', style: 'destructive', onPress: async () => {
        try {
          await api.post(`/voice/${id}/transfer/${targetId}`);
          showMessage({ message: `👑 Host transferred to ${name}`, type: 'success' });
        } catch (e: any) { showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }); }
      }},
    ]);
  }, [id]);

  // NEW: pin speaker to top of stage grid
  const handlePinSpeaker = useCallback(async (targetId: string) => {
    try {
      await api.patch(`/voice/${id}/pin/${targetId}`);
      showMessage({ message: '📌 Speaker pinned to stage', type: 'success' });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to pin', type: 'danger' });
    }
  }, [id]);

  const handleToggleOpenMic = useCallback(async () => {
    const currentOpenMic = room?.isOpenMic ?? false;
    try {
      await api.patch(`/voice/${id}/open-mic`, { enabled: !currentOpenMic });
      showMessage({ message: !currentOpenMic ? '🎤 Open Mic enabled' : '🎤 Open Mic disabled', type: 'info' });
    } catch (e: any) { showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }); }
  }, [id, room?.isOpenMic]);

  // NEW: save room settings (title / topic / privacy)
  const handleSaveRoomSettings = useCallback(async () => {
    if (!settingsTitle.trim()) { showMessage({ message: 'Title is required', type: 'warning' }); return; }
    setSettingsSaving(true);
    try {
      await api.patch(`/voice/${id}`, {
        title:       settingsTitle.trim(),
        description: settingsDescription.trim() || null,
        topic:       settingsTopic.trim() || null,
        privacy:     settingsPrivacy,
      });
      queryClient.setQueryData<any>(['voice-room', id], (old: any) =>
        old ? { ...old, name: settingsTitle.trim(), title: settingsTitle.trim(), description: settingsDescription.trim() || null, topic: settingsTopic.trim() || null, privacy: settingsPrivacy } : old
      );
      showMessage({ message: '✅ Room settings saved', type: 'success' });
      setShowRoomSettings(false);
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to save', type: 'danger' });
    } finally {
      setSettingsSaving(false);
    }
  }, [id, settingsTitle, settingsDescription, settingsTopic, settingsPrivacy, queryClient]);

  const handleToggleMicLock = useCallback(async () => {
    const currentLocked = room?.micLocked ?? false;
    try {
      await api.patch(`/voice/${id}/mic-lock`, { locked: !currentLocked });
      showMessage({ message: !currentLocked ? '🔒 Mic Locked' : '🔓 Mic Unlocked', type: 'info' });
    } catch (e: any) { showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }); }
  }, [id, room?.micLocked]);

  // Toggle individual seat lock (HOST or MODERATOR only)
  const handleToggleSeatLock = useCallback((seatIndex: number) => {
    if (!(myRole === 'HOST' || myRole === 'MODERATOR')) return;
    if (room?.micLocked) {
      // micLocked already covers all seats — per-seat toggle not meaningful
      showMessage({ message: '🔒 Mic is globally locked — unlock mic first', type: 'info' });
      return;
    }
    const isLocked = lockedSeats.includes(seatIndex);
    Alert.alert(
      isLocked ? `🔓 Unlock Seat ${seatIndex + 1}` : `🔒 Lock Seat ${seatIndex + 1}`,
      isLocked
        ? `Allow speakers to occupy seat ${seatIndex + 1}?`
        : `Prevent anyone from taking seat ${seatIndex + 1}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isLocked ? 'Unlock' : 'Lock',
          style: isLocked ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await api.patch(`/voice/${id}/seat-lock`, { seatIndex });
              // Optimistic update — server will confirm via socket
              setLockedSeats(prev =>
                isLocked ? prev.filter(s => s !== seatIndex) : [...prev, seatIndex]
              );
              showMessage({ message: isLocked ? `🔓 Seat ${seatIndex + 1} unlocked` : `🔒 Seat ${seatIndex + 1} locked`, type: 'info' });
            } catch (e: any) {
              showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
            }
          },
        },
      ]
    );
  }, [id, lockedSeats, room?.micLocked, myRole]);


  const ROOM_LEVEL_CAPACITY: Record<number, number> = { 1:500,2:1000,3:2000,4:3500,5:5000,6:8000,7:12000,8:18000,9:25000,10:50000 };
  const MEMBER_LEVEL_META: Record<number, { label: string; emoji: string; color: string }> = {
    1:{label:'Fan',emoji:'⭐',color:'#9ca3af'},2:{label:'Regular',emoji:'🌟',color:'#6366f1'},
    3:{label:'VIP',emoji:'💎',color:'#06b6d4'},4:{label:'Super',emoji:'🔥',color:'#f59e0b'},5:{label:'Legend',emoji:'👑',color:'#ef4444'}
  };

  // ── Membership state ──────────────────────────────────────────────────────
  const [isMember,        setIsMember]        = useState(false);
  const [memberLevel,     setMemberLevel]      = useState(0);
  const [memberCount,     setMemberCount]      = useState(0);
  const [joiningMember,   setJoiningMember]    = useState(false);
  const [leavingMember,   setLeavingMember]    = useState(false);

  // Fetch membership status on join
  useEffect(() => {
    api.get(`/voice/${id}/members/status`).then(r => {
      const d = r.data.data;
      setIsMember(d?.isMember ?? false);
      setMemberLevel(d?.member?.memberLevel ?? 0);
      setMemberCount(d?.currentCount ?? 0);
    }).catch(() => {});
  }, [isJoined, id]);

  const handleJoinMembership = useCallback(async () => {
    if (joiningMember || !id) return;
    setJoiningMember(true);
    try {
      await api.post(`/voice/${id}/members/join`);
      setIsMember(true); setMemberLevel(1); setMemberCount(c => c + 1);
      showMessage({ message: '⭐ You joined as a permanent member!', type: 'success' });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to join', type: 'danger' });
    } finally { setJoiningMember(false); }
  }, [id, joiningMember]);

  const handleLeaveMembership = useCallback(async () => {
    if (leavingMember || !id) return;
    setLeavingMember(true);
    try {
      await api.delete(`/voice/${id}/members/leave`);
      setIsMember(false); setMemberLevel(0); setMemberCount(c => Math.max(0, c - 1));
      showMessage({ message: 'Left room membership', type: 'info' });
    } catch {} finally { setLeavingMember(false); }
  }, [id, leavingMember]);

  const handleUpgradeMemberLevel = useCallback(async (targetUserId: string, level: number) => {
    try {
      await api.patch(`/voice/${id}/members/${targetUserId}/upgrade`, { memberLevel: level });
      const meta = MEMBER_LEVEL_META[level];
      showMessage({ message: `${meta?.emoji} Member upgraded to ${meta?.label ?? level}`, type: 'success' });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    }
  }, [id]);

  const handleUpgradeRoomLevel = useCallback(async (level: number) => {
    try {
      await api.patch(`/voice/${id}/members/room-level`, { level });
      queryClient.setQueryData<any>(['voice-room', id], (old: any) =>
        old ? { ...old, roomLevel: level } : old
      );
      showMessage({ message: `🎉 Room upgraded to Level ${level}! Max ${ROOM_LEVEL_CAPACITY[level] ?? '?'} members`, type: 'success' });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Upgrade failed', type: 'danger' });
    }
  }, [id, queryClient]);
  const handleToggleChat = useCallback(async () => {
    if (!room) return;
    const newVal = !(room.commentsEnabled ?? true);
    try {
      await api.patch(`/voice/${id}`, { commentsEnabled: newVal });
      queryClient.setQueryData<any>(['voice-room', id], (old: any) => old ? { ...old, commentsEnabled: newVal } : old);
      showMessage({ message: newVal ? '💬 Chat enabled' : '🔇 Chat disabled', type: 'info' });
    } catch {}
  }, [id, room, queryClient]);

  const handleToggleReactions = useCallback(async () => {
    if (!room) return;
    const newVal = !(room.reactionsEnabled ?? true);
    try {
      await api.patch(`/voice/${id}`, { reactionsEnabled: newVal });
      queryClient.setQueryData<any>(['voice-room', id], (old: any) => old ? { ...old, reactionsEnabled: newVal } : old);
      showMessage({ message: newVal ? '🌹 Reactions enabled' : '🚫 Reactions disabled', type: 'info' });
    } catch {}
  }, [id, room, queryClient]);

  // ── Emoji reaction sender ────────────────────────────────────────────────────
  // Same REACTIONS list as web VoiceRoomView for full parity.
  const VOICE_REACTIONS = ['❤️', '😂', '😮', '👏', '🔥', '🌹', '✅', '🎉'] as const;

  const sendReaction = useCallback((emoji: string) => {
    setShowEmojiPicker(false);
    // Show locally immediately (don't wait for server echo)
    const reactionId = `local-${Date.now()}-${Math.random()}`;
    const x = 10 + Math.random() * 70;
    setFloatingEmojis(prev => [...prev.slice(-9), { id: reactionId, emoji, x }]);
    setTimeout(() => {
      setFloatingEmojis(prev => prev.filter(e => e.id !== reactionId));
    }, 2500);
    // Broadcast to room via socket — backend validates reactionsEnabled + room membership
    const socket = getSocket();
    if (socket && id) {
      socket.emit('voice:reaction', { roomId: id, emoji });
    }
  }, [id]);

  const handleGiftAllStage = useCallback(async (giftId: string, count: number) => {
    try {
      await api.post(`/voice/${id}/gifts/all`, {
        giftId,
        count,
        idempotencyKey: `all-${Date.now()}-${giftId}`,
      });
      showMessage({ message: '🎁 Gift sent to everyone on stage!', type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['wallet-me'] });
      queryClient.invalidateQueries({ queryKey: ['gift-leaderboard', id] });
    } catch (e: any) { showMessage({ message: e?.response?.data?.message ?? 'Failed to send', type: 'danger' }); }
  }, [id, queryClient]);

  // Pass mic to a specific audience member
  const handlePassMic = useCallback((targetP: Participant) => {
    setMicPassTarget({ id: targetP.id, name: targetP.name, avatar: targetP.avatar });
    setShowHostControls(false);
    setShowMicPassOffer(true);
  }, []);

  const sendChatMsg = useCallback(async () => {
    const text = chatText.trim();
    setChatText('');
    try {
      await api.post(`/voice/${id}/messages`, { body: text });
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message || 'Failed to send', type: 'danger' });
    }
  }, [id, chatText]);

  if (isLoading) return <View style={styles.centered}><ActivityIndicator size="large" color="#4f46e5" /></View>;
  if (!room)     return <View style={styles.centered}><Text style={styles.errorText}>Room not found</Text></View>;

  const myParticipant = participants.find(p => p.id === user?.id);
  const amHostOrMod   = myParticipant?.role === 'HOST' || myParticipant?.role === 'MODERATOR';
  // On stage = has a seatNumber (authoritative from backend).
  const amOnStage     = myParticipant?.seatNumber != null;
  // Single source of truth for mute state — derived from participants, never separate state
  const isMuted       = myParticipant?.isMuted ?? true;

  // ── AUTHORITATIVE SEAT LAYOUT ────────────────────────────────────────────
  // Seats are rendered directly from participant.seatNumber (1–12).
  // No client-side ordering — the backend is the single source of truth.
  const maxSpeakerSlots = (room as any)?.maxSpeakers ?? 12;

  const speakerSlotArray: Array<Participant | null> = Array.from(
    { length: maxSpeakerSlots },
    (_, i) => {
      const seatNum = i + 1; // index 0 = Seat 1
      return participants.find(p => p.isActive && Number(p.seatNumber) === seatNum) ?? null;
    }
  );

  // On stage = has a seatNumber; Audience = seatNumber is null
  const speakers = participants.filter(p => p.isActive && p.seatNumber != null);
  const audience = participants.filter(p => p.isActive && p.seatNumber == null);
  const canSendGifts = isJoined && speakers.length > 0;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Floating emoji reactions overlay (pointer-events: none) ─────────────
          Phase 8: Each emoji animates with pop-spawn, float upward, side drift,
          rotation, and fade-out — matching the web VoiceRoomView experience.  */}
      {floatingEmojis.length > 0 && (
        <View pointerEvents="none" style={{ position: 'absolute', bottom: 120, right: 12, zIndex: 50, width: 80 }}>
          {floatingEmojis.map(fe => (
            <FloatingEmojiItem key={fe.id} emoji={fe.emoji} x={fe.x} />
          ))}
        </View>
      )}

      {/* Gift fly-in animation */}
      {animGift && (
        <GiftAnimOverlay
          gift={animGift.gift}
          senderName={animGift.senderName}
          onDone={() => setAnimGift(null)}
        />
      )}

      <View style={[mobStyles.container, { paddingBottom: insets.bottom }]}>
        {/* Room header — white card matching target design */}
        <View style={mobStyles.header}>
          <View style={mobStyles.headerLeft}>
            {/* Cover emoji / image */}
            <View style={mobStyles.headerEmoji}>
              <Text style={{ fontSize: 26 }}>{(room as any).coverEmoji ?? '🎙️'}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={mobStyles.headerTitle} numberOfLines={1}>{room.name}</Text>
              {/* "● Live Room" subtitle */}
              <View style={mobStyles.liveSubtitle}>
                <View style={mobStyles.liveSubtitleDot} />
                <Text style={mobStyles.liveSubtitleText}>
                  {room.isLive ? 'Live Room' : 'Idle'}
                </Text>
              </View>
            </View>
          </View>
          <View style={mobStyles.headerRight}>
            {/* Member badge (e.g. "⭐ Mentor") */}
            {isJoined && isMember && (
              <View style={mobStyles.memberBadge}>
                <Text style={mobStyles.memberBadgeText}>
                  {MEMBER_LEVEL_META[memberLevel]?.emoji ?? '⭐'} {MEMBER_LEVEL_META[memberLevel]?.label ?? 'Member'}
                </Text>
              </View>
            )}
            {/* Lv1 pill */}
            <View style={mobStyles.levelBadge}>
              <Text style={mobStyles.levelBadgeText}>Lv{room.roomLevel ?? 1}</Text>
            </View>
            {/* Three-dot menu */}
            <TouchableOpacity style={mobStyles.dotMenuBtn} onPress={() => setShowRoomSettings(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="ellipsis-vertical" size={18} color="#374151" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Persistent music indicator — shown when BgMusicPanel is playing */}
        {bgMusicTrack && (
          <TouchableOpacity
            style={mobStyles.musicBar}
            onPress={() => setShowBgMusic(true)}
            activeOpacity={0.85}
          >
            <View style={mobStyles.musicBarLeft}>
              <Text style={{ fontSize: 14 }}>{bgMusicTrack.isDeviceFile ? '📱' : '🎵'}</Text>
              <Text style={mobStyles.musicBarTitle} numberOfLines={1}>{bgMusicTrack.title}</Text>
            </View>
            <View style={mobStyles.musicBarRight}>
              {bgMusicPlaying
                ? <><View style={mobStyles.musicBarDot} /><Text style={mobStyles.musicBarStatus}>Playing</Text></>
                : <Text style={mobStyles.musicBarStatus}>Paused</Text>
              }
              <Ionicons name="chevron-forward" size={12} color="#22c55e" />
            </View>
          </TouchableOpacity>
        )}

        {/* Chat tab toggle — shown only when inside room */}
        {isJoined && (
          <View style={mobStyles.tabs}>
            <TouchableOpacity style={[mobStyles.tab, !showChat && mobStyles.tabActive]} onPress={() => setShowChat(false)}>
              <Ionicons name="people-outline" size={14} color={!showChat ? '#6366f1' : '#9ca3af'} />
              <Text style={[mobStyles.tabText, !showChat && mobStyles.tabTextActive]}>Room</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[mobStyles.tab, showChat && mobStyles.tabActive]} onPress={() => setShowChat(true)}>
              <Ionicons name="chatbubbles-outline" size={14} color={showChat ? '#6366f1' : '#9ca3af'} />
              <Text style={[mobStyles.tabText, showChat && mobStyles.tabTextActive]}>Chat</Text>
              {chatMessages.length > 0 && (
                <View style={mobStyles.chatBadge}>
                  <Text style={mobStyles.chatBadgeText}>{chatMessages.length > 99 ? '99+' : chatMessages.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        )}

        {!showChat ? (
          /* ── Participants / Stage view ── */
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>

            {/* ── Stage header bar ── */}
            <View style={mobStyles.stageBar}>
              <View style={mobStyles.stageBarLeft}>
                {/* Microphone icon */}
                <View style={mobStyles.stageMicIcon}>
                  <Ionicons name="mic" size={13} color="#6366f1" />
                </View>
                <Text style={mobStyles.stageBarLabel}>ON STAGE</Text>
                <View style={mobStyles.stageCountBadge}>
                  <Text style={mobStyles.stageCountText}>{speakers.length}</Text>
                </View>
              </View>
              <View style={mobStyles.stageBarRight}>
                {/* 👑 Lv1 · 500 members */}
                <View style={mobStyles.levelMembersPill}>
                  <Text style={mobStyles.levelMembersText}>
                    👑 Lv{room.roomLevel ?? 1} · {(ROOM_LEVEL_CAPACITY[room.roomLevel ?? 1] ?? 500).toLocaleString()} members
                  </Text>
                </View>
                {/* 👥 1 / 12 — stage full when all maxSpeakers seats are taken */}
                <View style={[mobStyles.participantsPill, speakers.length >= ((room as any)?.maxSpeakers ?? 12) && mobStyles.participantsPillFull]}>
                  <Text style={[mobStyles.participantsPillText, speakers.length >= ((room as any)?.maxSpeakers ?? 12) && { color: '#dc2626' }]}>
                    👥 {speakers.length} / {(room as any)?.maxSpeakers ?? 12}
                  </Text>
                </View>
              </View>
            </View>

            {/* ── Speakers grid card — white, rounded bottom, 4 columns ── */}
            <View style={mobStyles.speakersCard}>
              <View style={mobStyles.speakersGrid}>
                {speakerSlotArray.map((speaker, i) => {
                  const isMe = speaker?.id === user?.id;
                  const seatLocked = lockedSeats.includes(i);
                  const isLocked   = (room.micLocked ?? false) || seatLocked;

                  if (speaker) {
                    /* ── Filled seat ── */
                    return (
                      <TouchableOpacity
                        key={speaker.id}
                        style={mobStyles.speakerSlot}
                        activeOpacity={0.8}
                        onLongPress={() => {
                          if (!canModerate || isMe) return;
                          Alert.alert(speaker.name, 'Actions', [
                            { text: 'Cancel', style: 'cancel' },
                            { text: speaker.isMuted ? '🎙️ Unmute' : '🔇 Mute', onPress: () => handleMuteUser(speaker.id, speaker.isMuted) },
                            { text: '⬇️ Move to audience', onPress: () => handlePromote(speaker.id, 'AUDIENCE') },
                            ...(myRole === 'HOST' && speaker.role !== 'MODERATOR' ? [{ text: '🛡️ Make Mod', onPress: () => handleAssignMod(speaker.id, speaker.name) }] : []),
                            ...(myRole === 'HOST' && speaker.role === 'MODERATOR' ? [{ text: '🛡️ Remove Mod', onPress: () => handleRemoveMod(speaker.id, speaker.name) }] : []),
                            ...(myRole === 'HOST' ? [{ text: '🎙️ Pass Mic', onPress: () => handlePassMic(speaker) }] : []),
                            { text: '🚫 Remove', style: 'destructive' as const, onPress: () => handleKick(speaker.id, speaker.name) },
                          ]);
                        }}
                      >
                        <View style={[mobStyles.avatarWrap, speaker.isSpeaking && mobStyles.avatarSpeaking]}>
                          {/* Gap 2 fix: pulsing speaking ring — mirrors web's .vc-speaking-ring */}
                          {speaker.isSpeaking && !speaker.isMuted && (
                            <SpeakingRing size={SLOT_SIZE} />
                          )}
                          <Image
                            source={{ uri: avatarUrl(speaker.avatar, speaker.name) }}
                            style={[
                              mobStyles.avatarImg,
                              // Gap 2 fix: green border when speaking (mirrors web's .vc-speaking-ring)
                              speaker.isSpeaking && !speaker.isMuted && {
                                borderColor: '#22c55e',
                                borderWidth: 3,
                              },
                            ]}
                          />
                          {/* Crown for host */}
                          {speaker.role === 'HOST' && (
                            <Text style={mobStyles.crownBadge}>👑</Text>
                          )}
                          {/* Shield for mod */}
                          {speaker.role === 'MODERATOR' && (
                            <Text style={[mobStyles.crownBadge, { fontSize: 11 }]}>🛡️</Text>
                          )}
                          {/* Gap 3 fix: hand raised indicator on stage slots */}
                          {speaker.handRaised && (
                            <Text style={mobStyles.handRaisedBadge}>✋</Text>
                          )}
                          {/* Mute indicator */}
                          <View style={[mobStyles.muteBadge, speaker.isMuted ? mobStyles.muteBadgeMuted : mobStyles.muteBadgeLive]}>
                            <Ionicons
                              name={speaker.isMuted ? 'mic-off' : 'mic'}
                              size={9}
                              color={speaker.isMuted ? '#6b7280' : '#16a34a'}
                            />
                          </View>
                          {/* "You" indicator */}
                          {isMe && (
                            <View style={mobStyles.meBadge}>
                              <Text style={mobStyles.meBadgeText}>You</Text>
                            </View>
                          )}
                        </View>
                        <Text style={mobStyles.slotName} numberOfLines={1}>
                          {isMe ? 'You' : speaker.name.split(' ')[0]}
                        </Text>
                        {/* Role label below name — matches web's vc-role-label */}
                        {!isMe && (
                          <Text style={[
                            mobStyles.roleLabel,
                            speaker.role === 'HOST'      && mobStyles.roleLabelHost,
                            speaker.role === 'MODERATOR' && mobStyles.roleLabelMod,
                            speaker.role === 'SPEAKER'   && mobStyles.roleLabelSpeaker,
                          ]} numberOfLines={1}>
                            {speaker.role === 'HOST'      ? '👑 Host'
                             : speaker.role === 'MODERATOR' ? '🛡️ Mod'
                             : '🎙️ Speaker'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  }

                  /* ── Empty seat ── */
                  return (
                    <TouchableOpacity
                      key={`empty-${i}`}
                      style={mobStyles.speakerSlot}
                      activeOpacity={0.7}
                      onPress={() => {
                        if (canModerate && !(room.micLocked ?? false)) {
                          handleToggleSeatLock(i);
                        }
                      }}
                    >
                      <View style={[
                        mobStyles.emptySlot,
                        isLocked && mobStyles.emptySlotLocked,
                        // Gap 7 fix: yellow outline for individually locked seat (matches web)
                        seatLocked && !(room.micLocked ?? false) && mobStyles.emptySlotSeatLocked,
                      ]}>
                        {isLocked ? (
                          <Ionicons name="lock-closed" size={22} color="#9ca3af" />
                        ) : (
                          <Ionicons name="mic-outline" size={22} color="#94a3b8" />
                        )}
                        {/* "● Open" label */}
                        {!isLocked && (
                          <View style={mobStyles.openLabel}>
                            <View style={mobStyles.openDot} />
                            <Text style={mobStyles.openLabelText}>Open</Text>
                          </View>
                        )}
                      </View>
                      <Text style={mobStyles.slotNum}>{i + 1}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* ── Audience section ── */}
            <View style={mobStyles.audienceSection}>
              <View style={mobStyles.audienceHeader}>
                <Ionicons name="people-outline" size={14} color="#374151" />
                <Text style={mobStyles.audienceLabel}>AUDIENCE · {audience.length}</Text>
              </View>
              {audience.length === 0 ? (
                <Text style={mobStyles.audienceEmpty}>No listeners yet</Text>
              ) : (
                <View style={mobStyles.audienceGrid}>
                  {audience.map(p => (
                    <View key={p.id} style={mobStyles.audienceItem}>
                      <Image
                        source={{ uri: avatarUrl(p.avatar, p.name) }}
                        style={[mobStyles.audienceAvatar, p.handRaised && mobStyles.audienceAvatarHand]}
                      />
                      {p.handRaised && (
                        <View style={mobStyles.handBadgeAud}>
                          <Text style={{ fontSize: 10 }}>✋</Text>
                        </View>
                      )}
                      <Text style={mobStyles.audienceName} numberOfLines={1}>
                        {p.id === user?.id ? 'You' : p.name.split(' ')[0]}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        ) : (
          /* Chat view */
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <FlatList
              ref={chatListRef}
              data={chatMessages}
              keyExtractor={m => m.id}
              style={{ flex: 1 }}
              contentContainerStyle={styles.chatList}
              renderItem={({ item }) => (
                <View style={styles.chatRow}>
                  <Image source={{ uri: avatarUrl(item.user?.avatarUrl, `${item.user.firstName} ${item.user.lastName}`) }} style={styles.chatAvatar} />
                  <View style={styles.chatBubble}>
                    <Text style={styles.chatSenderName}>{item.user.firstName}</Text>
                    <Text style={styles.chatMsgText}>{item.body}</Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>{isJoined ? 'No messages yet' : 'Join to see chat'}</Text>}
            />
            {isJoined && room.commentsEnabled && (
              <View style={styles.chatInputBar}>
                <TextInput
                  style={styles.chatInput}
                  value={chatText}
                  onChangeText={setChatText}
                  placeholder="Say something…"
                  placeholderTextColor="#6b7280"
                  returnKeyType="send"
                  onSubmitEditing={sendChatMsg}
                />
                <TouchableOpacity style={styles.chatSendBtn} onPress={sendChatMsg} disabled={!chatText.trim()}>
                  <Ionicons name="send" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
          </KeyboardAvoidingView>
        )}

        {/* Controls bar — light theme */}
        <View style={mobStyles.controls}>
          {!isJoined ? (
            user?.role === 'SUPER_ADMIN' ? (
              <View style={[mobStyles.joinBtn, { backgroundColor: '#92400e', flexDirection: 'column', gap: 2, paddingVertical: 10 }]}>
                <Text style={[mobStyles.joinBtnText, { fontSize: 12 }]}>Platform admins cannot join voice rooms</Text>
                <Text style={{ color: '#fde68a', fontSize: 10 }}>Use admin panel to manage rooms</Text>
              </View>
            ) : (
              <TouchableOpacity style={mobStyles.joinBtn} onPress={handleJoin} disabled={isConnecting}>
                {isConnecting ? <ActivityIndicator color="#fff" /> : <><Ionicons name="headset" size={20} color="#fff" /><Text style={mobStyles.joinBtnText}>Join Room</Text></>}
              </TouchableOpacity>
            )
          ) : (
            <>
              {/* Stage control — behaviour depends on role */}
              {amHostOrMod ? (
                amOnStage ? (
                  /* HOST/MOD on stage — "End Mic" button */
                  <TouchableOpacity
                    style={[mobStyles.ctrlBtn, { backgroundColor: '#fef3c7', borderWidth: 1.5, borderColor: '#fde68a' }]}
                    onPress={async () => {
                      // Optimistic update — move HOST/MOD to audience immediately
                      // amOnStage = amHostOrMod && !myParticipant.isMuted
                      // We must update both local isMuted state AND participants array
                      // [removed redundant setIsMuted]  //setIsMuted(true);
                      setParticipants(prev => prev.map(p =>
                        p.id === user?.id ? { ...p, isMuted: true } : p
                      ));
                      if (lk.connected) await lk.disableMic();
                      try {
                        await api.post(`/voice/${id}/drop-mic`);
                        showMessage({ message: '⬇️ Left the stage', type: 'info' });
                      } catch (e: any) {
                        // Rollback on API error
                        // [removed redundant setIsMuted]  //setIsMuted(false);
                        setParticipants(prev => prev.map(p =>
                          p.id === user?.id ? { ...p, isMuted: false } : p
                        ));
                        if (lk.connected) await lk.enableMic();
                        showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
                      }
                    }}
                  >
                    <Text style={{ fontSize: 20 }}>🎤</Text>
                    <Text style={[mobStyles.ctrlLabel, { color: '#d97706' }]}>End Mic</Text>
                  </TouchableOpacity>
                ) : (
                  /* HOST/MOD in audience — "Take Stage" button */
                  <TouchableOpacity
                    style={[mobStyles.ctrlBtn, mobStyles.ctrlBtnActive, room?.micLocked ? { opacity: 0.4 } : {}]}
                    onPress={async () => {
                      if (room?.micLocked) {
                        showMessage({ message: '🔒 Mic is locked', type: 'warning' });
                        return;
                      }
                      // Optimistic update — show HOST as on-stage immediately
                      // [removed redundant setIsMuted]  //setIsMuted(false);
                      setParticipants(prev => prev.map(p =>
                        p.id === user?.id ? { ...p, isMuted: false } : p
                      ));
                      if (lk.connected) await lk.enableMic();
                      try {
                        await api.post(`/voice/${id}/grab-mic`);
                        showMessage({ message: '🎤 You are on stage!', type: 'success' });
                      } catch (e: any) {
                        // Rollback on error
                        // [removed redundant setIsMuted]  //setIsMuted(true);
                        setParticipants(prev => prev.map(p =>
                          p.id === user?.id ? { ...p, isMuted: true } : p
                        ));
                        if (lk.connected) await lk.disableMic();
                        showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
                      }
                    }}
                    disabled={room?.micLocked ?? false}
                  >
                    <Text style={{ fontSize: 20 }}>{room?.micLocked ? '🔒' : '🎤'}</Text>
                    <Text style={[mobStyles.ctrlLabel, { color: '#6366f1' }]}>
                      {room?.micLocked ? 'Locked' : 'Go Live'}
                    </Text>
                  </TouchableOpacity>
                )
              ) : (
                /* Normal user — context-aware:
                   Free Stage ON + seat available → grab mic instantly (no approval)
                   Free Stage ON + stage full     → queue (waiting for seat)
                   Free Stage OFF                 → raise hand (waiting for HOST/MOD approval)
                   Already in queue               → lower hand to cancel */
                <TouchableOpacity
                  style={[
                    mobStyles.ctrlBtn,
                    handRaised && mobStyles.ctrlBtnActive,
                    room?.micLocked ? { opacity: 0.4 } : {},
                    // Green tint when free stage and seat available
                    (!handRaised && room?.isOpenMic && speakers.length < ((room as any)?.maxSpeakers ?? 12) && !(room?.micLocked))
                      ? { backgroundColor: '#6366f122', borderColor: '#6366f155' }
                      : {},
                  ]}
                  onPress={() => {
                    if (room?.micLocked) { showMessage({ message: '🔒 Mic is locked by the host', type: 'warning' }); return; }
                    if (handRaised) {
                      // Lower hand — cancel queue
                      toggleHand();
                      return;
                    }
                    if (room?.isOpenMic) {
                      // Free Stage ON: grab mic directly (backend handles queue if full)
                      handleGrabMic();
                    } else {
                      // Free Stage OFF: raise hand for approval
                      toggleHand();
                    }
                  }}
                  disabled={room?.micLocked ?? false}
                >
                  <Text style={{ fontSize: 22 }}>
                    {room?.micLocked ? '🔒'
                     : handRaised ? '✋'
                     : room?.isOpenMic && speakers.length < ((room as any)?.maxSpeakers ?? 12) ? '🎙️'
                     : '✋'}
                  </Text>
                  <Text style={[
                    mobStyles.ctrlLabel,
                    !handRaised && room?.isOpenMic && speakers.length < ((room as any)?.maxSpeakers ?? 12) && !(room?.micLocked)
                      ? { color: '#6366f1' }
                      : {},
                  ]}>
                    {room?.micLocked
                      ? 'Locked'
                      : handRaised
                        ? 'Waiting'
                        : room?.isOpenMic && speakers.length < ((room as any)?.maxSpeakers ?? 12)
                          ? 'Take Seat'
                          : room?.isOpenMic
                            ? 'Stage Full'
                            : 'Raise Hand'}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Mic — only shown when on stage */}
              {amOnStage && (
                <TouchableOpacity
                  style={[
                    mobStyles.ctrlBtn,
                    lk.micEnabled && mobStyles.ctrlBtnActive,
                    (myParticipant?.mutedByModerator && myParticipant?.isMuted) && { opacity: 0.5 },
                  ]}
                  onPress={toggleMic}
                  disabled={!!(myParticipant?.mutedByModerator && myParticipant?.isMuted)}
                >
                  <Ionicons
                    name={myParticipant?.mutedByModerator && myParticipant?.isMuted ? 'lock-closed' : lk.micEnabled ? 'mic' : 'mic-off'}
                    size={22}
                    color={myParticipant?.mutedByModerator && myParticipant?.isMuted ? '#ef4444' : lk.micEnabled ? '#6366f1' : '#6b7280'}
                  />
                  <Text style={mobStyles.ctrlLabel}>
                    {myParticipant?.mutedByModerator && myParticipant?.isMuted ? 'Mod Muted' : lk.micEnabled ? 'Mute' : 'Unmute'}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Gift button */}
              {canSendGifts && (
                <TouchableOpacity style={[mobStyles.ctrlBtn, mobStyles.ctrlBtnGift]} onPress={() => setShowGiftPanel(true)}>
                  <Text style={{ fontSize: 22 }}>🎁</Text>
                  <Text style={[mobStyles.ctrlLabel, { color: '#d97706' }]}>Gift</Text>
                </TouchableOpacity>
              )}

              {/* ⚔️ PK Battle button — host only */}
              {myRole === 'HOST' && (
                <TouchableOpacity
                  style={[mobStyles.ctrlBtn, activePKMatchId ? { backgroundColor: '#ef444422', borderWidth: 1.5, borderColor: '#ef444466' } : {}]}
                  onPress={() => setShowPKPanel(true)}
                >
                  <Text style={{ fontSize: 22 }}>⚔️</Text>
                  <Text style={[mobStyles.ctrlLabel, activePKMatchId ? { color: '#ef4444' } : {}]}>
                    {activePKMatchId ? 'PK LIVE' : 'PK'}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Host controls */}
              {canModerate && (
                <TouchableOpacity style={[mobStyles.ctrlBtn, showHostControls && mobStyles.ctrlBtnActive]}
                  onPress={() => setShowHostControls(true)}>
                  <Ionicons name="shield-outline" size={22} color={showHostControls ? '#6366f1' : '#6b7280'} />
                  <Text style={mobStyles.ctrlLabel}>Host</Text>
                </TouchableOpacity>
              )}

              {/* Emoji Reactions button — matches web VoiceRoomView reaction button.
                  Disabled (opacity 0.4) when reactionsEnabled is false (same as web). */}
              <TouchableOpacity
                style={[mobStyles.ctrlBtn, showEmojiPicker && mobStyles.ctrlBtnActive]}
                onPress={() => {
                  if (room?.reactionsEnabled ?? true) {
                    setShowEmojiPicker(v => !v);
                  }
                }}
                disabled={!(room?.reactionsEnabled ?? true)}
              >
                <Text style={{ fontSize: 22, opacity: (room?.reactionsEnabled ?? true) ? 1 : 0.4 }}>🌹</Text>
                <Text style={[mobStyles.ctrlLabel, { opacity: (room?.reactionsEnabled ?? true) ? 1 : 0.4 }]}>React</Text>
              </TouchableOpacity>

              {/* Share / Invite */}
              <TouchableOpacity style={mobStyles.ctrlBtn} onPress={() => setShowShare(true)}>
                <Text style={{ fontSize: 22 }}>📨</Text>
                <Text style={mobStyles.ctrlLabel}>Invite</Text>
              </TouchableOpacity>

              {/* Leave */}
              <TouchableOpacity style={[mobStyles.ctrlBtn, mobStyles.ctrlBtnDanger]} onPress={handleLeave}>
                <Ionicons name="exit-outline" size={22} color="#ef4444" />
                <Text style={[mobStyles.ctrlLabel, { color: '#ef4444' }]}>Leave</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Gift panel modal */}
      <GiftPanel
        visible={showGiftPanel}
        gifts={gifts}
        wallet={wallet}
        roomId={id!}
        speakers={speakers}
        onClose={() => setShowGiftPanel(false)}
        onSent={(g, r) => {
          setAnimGift({ gift: g, senderName: user?.name || 'You' });
          queryClient.invalidateQueries({ queryKey: ['wallet-me'] });
          queryClient.invalidateQueries({ queryKey: ['gift-leaderboard', id] });
        }}
      />

      {/* Leaderboard modal */}
      <LeaderboardPanel
        visible={showLeaderboard}
        roomId={id!}
        onClose={() => setShowLeaderboard(false)}
      />

      {/* ── Emoji Reaction Picker Modal ───────────────────────────────────────────
          Appears when user taps the React button in the bottom bar.
          Same REACTIONS list as web for full parity.
          Dismissed on tap-outside or after picking an emoji.               */}
      <Modal
        visible={showEmojiPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEmojiPicker(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, justifyContent: 'flex-end' }}
          activeOpacity={1}
          onPress={() => setShowEmojiPicker(false)}
        >
          <View style={{
            backgroundColor: '#1a1a2e',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 20,
            paddingBottom: insets.bottom + 20,
          }}>
            <View style={{ width: 40, height: 4, backgroundColor: '#374151', borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />
            <Text style={{ color: '#e5e7eb', fontSize: 14, fontWeight: '700', marginBottom: 14, textAlign: 'center' }}>
              React to the room
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', flexWrap: 'wrap', gap: 8 }}>
              {VOICE_REACTIONS.map(emoji => (
                <TouchableOpacity
                  key={emoji}
                  onPress={() => sendReaction(emoji)}
                  style={{ padding: 10, borderRadius: 12, backgroundColor: '#111827', minWidth: 52, alignItems: 'center' }}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 28 }}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Mic Pass Modals ─────────────────────────────────────── */}
      {/* Host offering mic to a specific user */}
      {micPassTarget && (
        <MicPassModal
          visible={showMicPassOffer}
          mode="offer"
          roomId={id!}
          target={micPassTarget}
          onClose={() => { setShowMicPassOffer(false); setMicPassTarget(null); }}
        />
      )}
      {/* Incoming mic pass offer for current user */}
      {micPassOfferedBy && (
        <MicPassModal
          visible={showMicPassIncoming}
          mode="incoming"
          roomId={id!}
          offeredBy={micPassOfferedBy}
          offerId={micPassOfferId ?? undefined}
          onClose={() => { setShowMicPassIncoming(false); setMicPassOfferedBy(null); setMicPassOfferId(null); }}
          onAccepted={() => {
            setShowMicPassIncoming(false);
            setMicPassOfferedBy(null);
            setMicPassOfferId(null);
            // Optimistically update own role to SPEAKER
            if (user?.id) {
              setParticipants(prev => prev.map(p => p.id === user.id ? { ...p, role: 'SPEAKER', isMuted: false } : p));
            }
          }}
        />
      )}

      {/* ── Three-dot dropdown menu ──────────────────────────────── */}
      <Modal visible={showDotMenu} transparent animationType="fade" onRequestClose={() => setShowDotMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} activeOpacity={1} onPress={() => setShowDotMenu(false)} />
        <View style={{
          position: 'absolute', top: 64, right: 12,
          backgroundColor: '#1e1e3a', borderRadius: 14, overflow: 'hidden',
          borderWidth: 1, borderColor: '#374151', minWidth: 200,
        }}>
          {[
            { icon: '🏆', label: 'Leaderboard',       onPress: () => { setShowDotMenu(false); setShowLeaderboard(true); } },
            { icon: '📊', label: 'My Stats',           onPress: () => { setShowDotMenu(false); router.push('/voice/stats' as any); } },
            { icon: '🎵', label: 'Background Music',   onPress: () => { setShowDotMenu(false); setShowBgMusic(true); } },
            ...(canModerate ? [{ icon: '⭐', label: 'Members', onPress: () => { setShowDotMenu(false); setShowMembersPanel(true); } }] : []),
            ...(myRole === 'HOST' ? [{ icon: '⚙️', label: 'Room Settings', onPress: () => { setShowDotMenu(false); setShowRoomSettings(true); } }] : []),
          ].map((item, i, arr) => (
            <TouchableOpacity
              key={i}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 16,
                borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: '#374151' }}
              onPress={item.onPress}
            >
              <Text style={{ fontSize: 18 }}>{item.icon}</Text>
              <Text style={{ color: '#e5e7eb', fontSize: 14, fontWeight: '600' }}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      {/* ── Background Music Panel ───────────────────────────────── */}
      <BgMusicPanel
        visible={showBgMusic}
        roomId={id!}
        onClose={() => setShowBgMusic(false)}
        onNowPlayingChange={(track, playing) => { setBgMusicTrack(track); setBgMusicPlaying(playing); }}
      />

      {/* ── Member Management Panel (FIX-L12a) ──────────────────── */}
      {isJoined && (
        <MemberManagementPanel
          visible={showMembersPanel}
          roomId={id!}
          myRole={myRole as 'HOST' | 'MODERATOR' | 'SPEAKER' | 'AUDIENCE'}
          onClose={() => setShowMembersPanel(false)}
        />
      )}

      {/* ── Room Settings Modal (host only) ─────────────────────── */}
      <Modal
        visible={showRoomSettings}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowRoomSettings(false)}
        onShow={() => {
          // Seed form fields from current room data when modal opens
          setSettingsTitle(room?.name ?? room?.title ?? '');
          setSettingsDescription(room?.description ?? '');
          setSettingsTopic(room?.topic ?? '');
          setSettingsPrivacy((room?.privacy ?? 'PUBLIC') as 'PUBLIC'|'PRIVATE'|'INVITE_ONLY');
        }}
      >
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#0f0f23' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e3a' }}>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>⚙️ Room Settings</Text>
            <TouchableOpacity onPress={() => setShowRoomSettings(false)}>
              <Ionicons name="close" size={24} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
            {/* Title */}
            <View>
              <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Room Title *</Text>
              <TextInput
                style={{ backgroundColor: '#1e1e3a', color: '#e5e7eb', borderRadius: 12, padding: 12, fontSize: 15, borderWidth: 1, borderColor: '#374151' }}
                value={settingsTitle}
                onChangeText={setSettingsTitle}
                placeholder="Enter room title…"
                placeholderTextColor="#6b7280"
                maxLength={120}
              />
            </View>

            {/* Topic */}
            <View>
              <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Topic (optional)</Text>
              <TextInput
                style={{ backgroundColor: '#1e1e3a', color: '#e5e7eb', borderRadius: 12, padding: 12, fontSize: 15, borderWidth: 1, borderColor: '#374151' }}
                value={settingsTopic}
                onChangeText={setSettingsTopic}
                placeholder="e.g. Quran recitation, discussion…"
                placeholderTextColor="#6b7280"
                maxLength={100}
              />
            </View>

            {/* Description */}
            <View>
              <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Description (optional)</Text>
              <TextInput
                style={{ backgroundColor: '#1e1e3a', color: '#e5e7eb', borderRadius: 12, padding: 12, fontSize: 14, borderWidth: 1, borderColor: '#374151', minHeight: 80, textAlignVertical: 'top' }}
                value={settingsDescription}
                onChangeText={setSettingsDescription}
                placeholder="Tell people what your room is about…"
                placeholderTextColor="#6b7280"
                maxLength={500}
                multiline
                numberOfLines={3}
              />
              <Text style={{ color: '#6b7280', fontSize: 10, textAlign: 'right', marginTop: 3 }}>
                {settingsDescription.length}/500
              </Text>
            </View>

            {/* Cover Image */}
            <View>
              <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Cover Image (optional)</Text>
              {/* Current cover preview */}
              {(room as any)?.coverImageUrl ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <Image
                    source={{ uri: (room as any).coverImageUrl }}
                    style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: '#1e1e3a' }}
                  />
                  <Text style={{ color: '#6b7280', fontSize: 12, flex: 1 }}>Current cover image</Text>
                  <TouchableOpacity
                    style={{ backgroundColor: '#ef444422', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#ef444444' }}
                    onPress={async () => {
                      try {
                        await api.patch(`/voice/${id}`, { coverImageUrl: null });
                        queryClient.setQueryData<any>(['voice-room', id], (old: any) => old ? { ...old, coverImageUrl: null } : old);
                        showMessage({ message: '🗑️ Cover image removed', type: 'info' });
                      } catch { showMessage({ message: 'Failed to remove cover', type: 'danger' }); }
                    }}
                  >
                    <Ionicons name="trash-outline" size={14} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              ) : null}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#1e1e3a', borderRadius: 12, padding: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#374151' }}
                onPress={async () => {
                  try {
                    const result = await DocumentPicker.getDocumentAsync({
                      type: ['image/jpeg', 'image/png', 'image/webp'],
                      copyToCacheDirectory: true,
                    });
                    if (result.canceled || !result.assets?.[0]) return;
                    const asset = result.assets[0];
                    if (asset.size && asset.size > 2 * 1024 * 1024) {
                      showMessage({ message: 'Image must be under 2 MB', type: 'warning' }); return;
                    }
                    const formData = new FormData();
                    // Determine content type — Expo DocumentPicker may return undefined/null on some Android devices
                    const mimeType = (asset.mimeType && asset.mimeType !== 'undefined')
                      ? asset.mimeType
                      : asset.name?.endsWith('.png') ? 'image/png'
                      : asset.name?.endsWith('.webp') ? 'image/webp'
                      : 'image/jpeg';
                    formData.append('cover', { uri: asset.uri, name: asset.name ?? 'cover.jpg', type: mimeType } as any);
                    // No Content-Type header needed — React Native's FormData + axios
                    // sets multipart/form-data with the correct boundary automatically
                    const res = await api.post(`/voice/${id}/cover`, formData);
                    const newUrl = res.data.data?.coverImageUrl;
                    if (newUrl) {
                      queryClient.setQueryData<any>(['voice-room', id], (old: any) => old ? { ...old, coverImageUrl: newUrl } : old);
                      showMessage({ message: '🖼️ Cover image updated!', type: 'success' });
                    }
                  } catch (e: any) {
                    showMessage({ message: e?.response?.data?.message ?? 'Upload failed', type: 'danger' });
                  }
                }}
              >
                <Ionicons name="image-outline" size={20} color="#6b7280" />
                <Text style={{ color: '#9ca3af', fontSize: 14, fontWeight: '600' }}>
                  {(room as any)?.coverImageUrl ? 'Change Cover Image' : 'Upload Cover Image'}
                </Text>
              </TouchableOpacity>
              <Text style={{ color: '#6b7280', fontSize: 10, marginTop: 4 }}>JPG, PNG, WebP · Max 2 MB</Text>
            </View>
            <View>
              <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Privacy</Text>
              {([
                { value: 'PUBLIC',       label: '🌍 Public',       sub: 'Anyone can join' },
                { value: 'PRIVATE',      label: '🔒 Private',      sub: 'Invite-only entry' },
                { value: 'INVITE_ONLY',  label: '✉️ Invite Only',  sub: 'Members must request' },
              ] as const).map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setSettingsPrivacy(opt.value)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    backgroundColor: settingsPrivacy === opt.value ? '#4f46e522' : '#1e1e3a',
                    borderRadius: 12, padding: 12, marginBottom: 6,
                    borderWidth: 1.5,
                    borderColor: settingsPrivacy === opt.value ? '#4f46e5' : '#374151',
                  }}
                >
                  <View style={{
                    width: 18, height: 18, borderRadius: 9, borderWidth: 2,
                    borderColor: settingsPrivacy === opt.value ? '#4f46e5' : '#6b7280',
                    backgroundColor: settingsPrivacy === opt.value ? '#4f46e5' : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {settingsPrivacy === opt.value && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' }} />}
                  </View>
                  <View>
                    <Text style={{ color: '#e5e7eb', fontSize: 14, fontWeight: '600' }}>{opt.label}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 11, marginTop: 1 }}>{opt.sub}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Save button */}
            <TouchableOpacity
              style={{
                backgroundColor: settingsSaving ? '#374151' : '#4f46e5',
                borderRadius: 14, padding: 15, alignItems: 'center',
                flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 4,
              }}
              onPress={handleSaveRoomSettings}
              disabled={settingsSaving}
            >
              {settingsSaving
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Ionicons name="checkmark-circle" size={18} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Save Changes</Text></>
              }
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Host Controls Modal ──────────────────────────────────── */}
      <Modal visible={showHostControls} animationType="slide" presentationStyle="formSheet"
        onRequestClose={() => setShowHostControls(false)}>
        <View style={{ flex: 1, backgroundColor: '#0f0f23' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e3a' }}>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>🛡️ Host Controls</Text>
            <TouchableOpacity onPress={() => setShowHostControls(false)}>
              <Ionicons name="close" size={24} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          {/* ── Raised Hands Queue ─────────────────────────────────────────────
               Shows only participants who have raised their hand (in queue),
               sorted by raise time (FIFO). Each row has per-user Approve + Reject.
               Matches the web Hands drawer. Supports 100+ with max-height scroll. */}
          {participants.filter(p => p.handRaised && p.seatNumber == null).length > 0 && (() => {
            const raisedHand = participants
              .filter(p => p.handRaised && p.seatNumber == null)
              .sort((a, b) => (a._joinedAt ?? '').localeCompare(b._joinedAt ?? ''));
            return (
              <View style={{ borderBottomWidth: 1, borderBottomColor: '#1e1e3a' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
                  <Text style={{ color: '#f59e0b', fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    ✋ Raised Hands ({raisedHand.length})
                  </Text>
                  <TouchableOpacity
                    style={{ backgroundColor: '#10b98122', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#10b98144' }}
                    onPress={handleApproveQueue}
                  >
                    <Text style={{ color: '#10b981', fontSize: 11, fontWeight: '700' }}>Approve Next</Text>
                  </TouchableOpacity>
                </View>
                {/* Max 280dp height — scrollable for 100+ entries */}
                <FlatList
                  data={raisedHand}
                  keyExtractor={p => p.id + '_hand'}
                  style={{ maxHeight: 280 }}
                  contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8, gap: 4 }}
                  renderItem={({ item: p, index }) => (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1e1e3a', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#f59e0b22' }}>
                      {/* Position number */}
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#f59e0b22', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Text style={{ color: '#f59e0b', fontSize: 11, fontWeight: '800' }}>{index + 1}</Text>
                      </View>
                      {/* Avatar */}
                      <Image source={{ uri: avatarUrl(p.avatar, p.name) }} style={{ width: 32, height: 32, borderRadius: 16, flexShrink: 0 }} />
                      {/* Name + role */}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: '#e5e7eb', fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{p.name}</Text>
                        <Text style={{ color: p.role === 'MODERATOR' ? '#10b981' : '#9ca3af', fontSize: 10, fontWeight: '600' }}>{p.role}</Text>
                      </View>
                      {/* Approve button — always enabled; backend is authoritative for seat count */}
                      <TouchableOpacity
                        style={{ backgroundColor: '#10b98133', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#10b98166' }}
                        onPress={() => handleApproveQueueUser(p.id)}
                      >
                        <Text style={{ color: '#10b981', fontSize: 11, fontWeight: '700' }}>
                          ✅
                        </Text>
                      </TouchableOpacity>
                      {/* Reject button */}
                      <TouchableOpacity
                        style={{ backgroundColor: '#ef444422', borderRadius: 8, padding: 6, borderWidth: 1, borderColor: '#ef444444' }}
                        onPress={async () => {
                          try {
                            await api.delete(`/voice/${id}/queue/reject/${p.id}`);
                          } catch { /* non-fatal */ }
                        }}
                      >
                        <Ionicons name="close" size={14} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  )}
                />
              </View>
            );
          })()}

          {/* Quick actions */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
            <TouchableOpacity style={{ flex: 1, minWidth: '45%', backgroundColor: '#f59e0b22', borderWidth: 1, borderColor: '#f59e0b44', borderRadius: 12, padding: 12, alignItems: 'center', gap: 4 }}
              onPress={() => handleMuteAll()}>
              <Ionicons name="mic-off" size={22} color="#f59e0b" />
              <Text style={{ color: '#f59e0b', fontSize: 12, fontWeight: '600' }}>Mute All</Text>
              <Text style={{ color: '#6b7280', fontSize: 9 }}>Silence speakers on stage</Text>
            </TouchableOpacity>
            {/* Unmute All */}
            <TouchableOpacity style={{ flex: 1, minWidth: '45%', backgroundColor: '#22c55e22', borderWidth: 1, borderColor: '#22c55e44', borderRadius: 12, padding: 12, alignItems: 'center', gap: 4 }}
              onPress={handleUnmuteAll}>
              <Ionicons name="mic" size={22} color="#22c55e" />
              <Text style={{ color: '#22c55e', fontSize: 12, fontWeight: '600' }}>Unmute All</Text>
              <Text style={{ color: '#6b7280', fontSize: 9 }}>Unsilence speakers on stage</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1, minWidth: '45%', backgroundColor: '#10b98122', borderWidth: 1, borderColor: '#10b98144', borderRadius: 12, padding: 12, alignItems: 'center', gap: 4 }}
              onPress={handleApproveQueue}>
              <Ionicons name="checkmark-circle" size={22} color="#10b981" />
              <Text style={{ color: '#10b981', fontSize: 12, fontWeight: '600' }}>Approve Hand</Text>
              <Text style={{ color: '#6b7280', fontSize: 9 }}>Next in queue → stage</Text>
            </TouchableOpacity>
            {/* Free Stage (Open Mic) toggle */}
            <TouchableOpacity style={{ flex: 1, minWidth: '45%', backgroundColor: room?.isOpenMic ? '#6366f122' : '#1e1e3a', borderWidth: 1, borderColor: room?.isOpenMic ? '#6366f155' : '#374151', borderRadius: 12, padding: 12, alignItems: 'center', gap: 4 }}
              onPress={handleToggleOpenMic}>
              <Ionicons name="mic" size={22} color={room?.isOpenMic ? '#6366f1' : '#6b7280'} />
              <Text style={{ color: room?.isOpenMic ? '#6366f1' : '#6b7280', fontSize: 12, fontWeight: '600' }}>
                {room?.isOpenMic ? 'Free Stage ON' : 'Free Stage OFF'}
              </Text>
              <Text style={{ color: '#6b7280', fontSize: 9, textAlign: 'center' }}>
                {room?.isOpenMic ? 'Anyone can join freely' : 'Approval required'}
              </Text>
            </TouchableOpacity>
            {/* Lock Mic toggle */}
            <TouchableOpacity style={{ flex: 1, minWidth: '45%', backgroundColor: room?.micLocked ? '#f59e0b22' : '#1e1e3a', borderWidth: 1, borderColor: room?.micLocked ? '#f59e0b55' : '#374151', borderRadius: 12, padding: 12, alignItems: 'center', gap: 6 }}
              onPress={handleToggleMicLock}>
              <Ionicons name={room?.micLocked ? 'lock-closed' : 'lock-open'} size={22} color={room?.micLocked ? '#f59e0b' : '#6b7280'} />
              <Text style={{ color: room?.micLocked ? '#f59e0b' : '#6b7280', fontSize: 12, fontWeight: '600' }}>
                {room?.micLocked ? '🔒 Mic Locked' : '🔓 Lock Mic'}
              </Text>
            </TouchableOpacity>
            {/* Enable/Disable Chat */}
            <TouchableOpacity style={{ flex: 1, minWidth: '45%', backgroundColor: (room?.commentsEnabled ?? true) ? '#6366f122' : '#1e1e3a', borderWidth: 1, borderColor: (room?.commentsEnabled ?? true) ? '#6366f155' : '#374151', borderRadius: 12, padding: 12, alignItems: 'center', gap: 6 }}
              onPress={handleToggleChat}>
              <Ionicons name={(room?.commentsEnabled ?? true) ? 'chatbubble' : 'chatbubble-outline'} size={22} color={(room?.commentsEnabled ?? true) ? '#6366f1' : '#6b7280'} />
              <Text style={{ color: (room?.commentsEnabled ?? true) ? '#6366f1' : '#6b7280', fontSize: 12, fontWeight: '600' }}>
                {(room?.commentsEnabled ?? true) ? '💬 Chat ON' : '🔇 Chat OFF'}
              </Text>
            </TouchableOpacity>
            {/* Slow Mode toggle */}
            <TouchableOpacity style={{ flex: 1, minWidth: '45%', backgroundColor: (room?.slowMode ?? false) ? '#ef444422' : '#1e1e3a', borderWidth: 1, borderColor: (room?.slowMode ?? false) ? '#ef444444' : '#374151', borderRadius: 12, padding: 12, alignItems: 'center', gap: 6 }}
              onPress={() => api.patch(`/voice/${id}`, { slowMode: !(room?.slowMode ?? false) }).then(() => queryClient.setQueryData<any>(['voice-room', id], (old: any) => old ? { ...old, slowMode: !(room?.slowMode ?? false) } : old)).catch(() => {})}>
              <Ionicons name='timer-outline' size={22} color={(room?.slowMode ?? false) ? '#ef4444' : '#6b7280'} />
              <Text style={{ color: (room?.slowMode ?? false) ? '#ef4444' : '#6b7280', fontSize: 12, fontWeight: '600' }}>
                {(room?.slowMode ?? false) ? '⏱ Slow Mode ON' : '⏱ Slow Mode'}
              </Text>
            </TouchableOpacity>
            {/* Message type: all / followers / none */}
            <TouchableOpacity style={{ flex: 1, minWidth: '45%', backgroundColor: '#1e1e3a', borderWidth: 1, borderColor: '#374151', borderRadius: 12, padding: 12, alignItems: 'center', gap: 6 }}
              onPress={() => { const types = ['all','followers','none']; const next = types[(types.indexOf(room?.messageType ?? 'all') + 1) % 3]; api.patch(`/voice/${id}`, { messageType: next }).then(() => queryClient.setQueryData<any>(['voice-room', id], (old: any) => old ? { ...old, messageType: next } : old)).catch(() => {}); }}>
              <Ionicons name='people-outline' size={22} color='#6b7280' />
              <Text style={{ color: '#a5b4fc', fontSize: 12, fontWeight: '600' }}>
                {room?.messageType === 'all' ? '🌍 All Chat' : room?.messageType === 'followers' ? '👥 Followers' : '🔇 No Chat'}
              </Text>
            </TouchableOpacity>
            {/* Enable/Disable Reactions */}
            <TouchableOpacity style={{ flex: 1, minWidth: '45%', backgroundColor: (room?.reactionsEnabled ?? true) ? '#10b98122' : '#1e1e3a', borderWidth: 1, borderColor: (room?.reactionsEnabled ?? true) ? '#10b98155' : '#374151', borderRadius: 12, padding: 12, alignItems: 'center', gap: 6 }}
              onPress={handleToggleReactions}>
              <Ionicons name={(room?.reactionsEnabled ?? true) ? 'happy' : 'happy-outline'} size={22} color={(room?.reactionsEnabled ?? true) ? '#10b981' : '#6b7280'} />
              <Text style={{ color: (room?.reactionsEnabled ?? true) ? '#10b981' : '#6b7280', fontSize: 12, fontWeight: '600' }}>
                {(room?.reactionsEnabled ?? true) ? '🌹 React ON' : '🚫 React OFF'}
              </Text>
            </TouchableOpacity>
            {/* Upgrade Room Level (HOST only) */}
            {myRole === 'HOST' && (room?.roomLevel ?? 1) < 10 && (
              <TouchableOpacity
                style={{ flex: 1, minWidth: '45%', backgroundColor: '#7c3aed22', borderWidth: 1, borderColor: '#7c3aed55', borderRadius: 12, padding: 12, alignItems: 'center', gap: 6 }}
                onPress={() => {
                  const nextLevel = (room?.roomLevel ?? 1) + 1;
                  Alert.alert(
                    `Upgrade to Level ${nextLevel}?`,
                    `Max members: ${ROOM_LEVEL_CAPACITY[nextLevel] ?? '?'}`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Upgrade', onPress: () => handleUpgradeRoomLevel(nextLevel) }
                    ]
                  );
                }}>
                <Ionicons name='arrow-up-circle' size={22} color='#a5b4fc' />
                <Text style={{ color: '#a5b4fc', fontSize: 12, fontWeight: '600' }}>
                  Upgrade Lv{(room?.roomLevel ?? 1)+1}
                </Text>
              </TouchableOpacity>
            )}
            {myRole === 'HOST' && (
              // Rooms are PERMANENT — "End Room" terminates the room forever.
              // Hosts should just "Leave" — the room stays as IDLE and can be rejoined.
              // This button is intentionally hidden from the UI to prevent accidental termination.
              // SUPER_ADMIN can terminate via the admin panel if needed.
              null
            )}
            {/* Members management — FIX-L12a */}
            <TouchableOpacity
              style={{ flex: 1, minWidth: '45%', backgroundColor: '#6366f122', borderWidth: 1, borderColor: '#6366f155', borderRadius: 12, padding: 12, alignItems: 'center', gap: 6 }}
              onPress={() => { setShowHostControls(false); setShowMembersPanel(true); }}
            >
              <Ionicons name="people" size={22} color="#a5b4fc" />
              <Text style={{ color: '#a5b4fc', fontSize: 12, fontWeight: '600' }}>Members</Text>
            </TouchableOpacity>
          </View>

          {/* Participant list with actions */}
          <Text style={{ color: '#6b7280', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 16, paddingBottom: 8 }}>
            Participants ({participants.length})
          </Text>
          <FlatList
            data={participants}
            keyExtractor={p => p.id}
            contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 32, gap: 6 }}
            renderItem={({ item: p }) => {
              const isMe = p.id === user?.id;
              const roleColor = p.role === 'HOST' ? '#f59e0b' : p.role === 'MODERATOR' ? '#10b981' : p.role === 'SPEAKER' ? '#6366f1' : '#6b7280';
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1e1e3a', borderRadius: 12, padding: 10 }}>
                  <Image source={{ uri: avatarUrl(p.avatar, p.name) }} style={{ width: 36, height: 36, borderRadius: 18 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#e5e7eb', fontSize: 14, fontWeight: '600' }}>{p.name}{isMe ? ' (you)' : ''}</Text>
                    <Text style={{ color: roleColor, fontSize: 11, fontWeight: '700' }}>{p.role}{p.handRaised ? ' · ✋' : ''}</Text>
                  </View>
                  {!isMe && p.role !== 'HOST' && (
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 120 }}>
                {/* Upgrade member level (HOST only) */}
                {myRole === 'HOST' && (
                  <TouchableOpacity
                    style={{ padding: 7, backgroundColor: '#7c3aed22', borderRadius: 8 }}
                    onPress={() => {
                      const levels = ['⭐Fan','🌟Regular','💎VIP','🔥Super','👑Legend'];
                      Alert.alert('Upgrade Member', 'Select level:', [
                        { text: 'Cancel', style: 'cancel' },
                        ...levels.map((l, i) => ({ text: l, onPress: () => handleUpgradeMemberLevel(p.id, i+1) }))
                      ]);
                    }}>
                    <Ionicons name='star' size={16} color='#a5b4fc' />
                  </TouchableOpacity>
                )}
                      {/* Mute / Unmute individual speaker */}
                      {(p.role === 'SPEAKER' || p.role === 'MODERATOR') && (
                        <TouchableOpacity style={{ padding: 7, backgroundColor: p.isMuted ? '#22c55e22' : '#ef444422', borderRadius: 8 }}
                          onPress={() => handleMuteUser(p.id, p.isMuted)}>
                          <Ionicons name={p.isMuted ? 'mic' : 'mic-off'} size={16} color={p.isMuted ? '#22c55e' : '#ef4444'} />
                        </TouchableOpacity>
                      )}
                      {/* Promote to Speaker / Demote to Audience */}
                      {p.role === 'AUDIENCE' && (
                        <TouchableOpacity style={{ padding: 7, backgroundColor: '#6366f122', borderRadius: 8 }}
                          onPress={() => handlePromote(p.id, 'SPEAKER')}>
                          <Ionicons name="mic" size={16} color="#6366f1" />
                        </TouchableOpacity>
                      )}
                      {/* Pass Mic — offer mic to audience member (HOST only) */}
                      {myRole === 'HOST' && p.role === 'AUDIENCE' && (
                        <TouchableOpacity style={{ padding: 7, backgroundColor: '#4f46e522', borderRadius: 8 }}
                          onPress={() => handlePassMic(p)}>
                          <Text style={{ fontSize: 14 }}>🎙️</Text>
                        </TouchableOpacity>
                      )}
                      {/* Demote to Audience — MOD can only demote SPEAKER, HOST can demote SPEAKER + MOD */}
                      {(p.role === 'SPEAKER' || (p.role === 'MODERATOR' && myRole === 'HOST')) && (
                        <TouchableOpacity style={{ padding: 7, backgroundColor: '#f59e0b22', borderRadius: 8 }}
                          onPress={() => handlePromote(p.id, 'AUDIENCE')}>
                          <Ionicons name="mic-off" size={16} color="#f59e0b" />
                        </TouchableOpacity>
                      )}
                      {/* Assign / Remove Moderator (HOST only) */}
                      {myRole === 'HOST' && p.role !== 'MODERATOR' && (
                        <TouchableOpacity style={{ padding: 7, backgroundColor: '#10b98122', borderRadius: 8 }}
                          onPress={() => handleAssignMod(p.id, p.name)}>
                          <Ionicons name="shield" size={16} color="#10b981" />
                        </TouchableOpacity>
                      )}
                      {myRole === 'HOST' && p.role === 'MODERATOR' && (
                        <TouchableOpacity style={{ padding: 7, backgroundColor: '#6b728022', borderRadius: 8 }}
                          onPress={() => handleRemoveMod(p.id, p.name)}>
                          <Ionicons name="shield-checkmark-outline" size={16} color="#9ca3af" />
                        </TouchableOpacity>
                      )}
                      {/* Ban from room (HOST/MOD only) */}
                      <TouchableOpacity style={{ padding: 7, backgroundColor: '#ef444422', borderRadius: 8 }}
                        onPress={() => handleBan(p.id, p.name)}>
                        <Ionicons name="ban-outline" size={16} color="#ef4444" />
                      </TouchableOpacity>
                      {/* Kick from room */}
                      <TouchableOpacity style={{ padding: 7, backgroundColor: '#f97316' + '22', borderRadius: 8 }}
                        onPress={() => handleKick(p.id, p.name)}>
                        <Ionicons name="log-out-outline" size={16} color="#f97316" />
                      </TouchableOpacity>
                      {/* Transfer Host (HOST only) */}
                      {myRole === 'HOST' && (
                        <TouchableOpacity style={{ padding: 7, backgroundColor: '#f59e0b22', borderRadius: 8 }}
                          onPress={() => { setShowHostControls(false); handleTransferHost(p.id, p.name); }}>
                          <Text style={{ fontSize: 14 }}>👑</Text>
                        </TouchableOpacity>
                      )}
                      {/* Pin Speaker — HOST and MOD can pin any speaker/mod */}
                      {p.role !== 'AUDIENCE' && !isMe && (
                        <TouchableOpacity style={{ padding: 7, backgroundColor: '#0ea5e922', borderRadius: 8 }}
                          onPress={() => handlePinSpeaker(p.id)}>
                          <Ionicons name="pin" size={16} color="#0ea5e9" />
                        </TouchableOpacity>
                      )}
                      {/* Kick — HOST can kick anyone (not HOST); MOD can only kick SPEAKER/AUDIENCE, not MOD */}
                      {(myRole === 'HOST' || (myRole === 'MODERATOR' && p.role !== 'MODERATOR')) && (
                        <TouchableOpacity style={{ padding: 7, backgroundColor: '#ef444422', borderRadius: 8 }}
                          onPress={() => { setShowHostControls(false); handleKick(p.id, p.name); }}>
                          <Ionicons name="exit-outline" size={16} color="#ef4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            }}
          />
        </View>
      </Modal>

      {/* ── Share / Invite Room Sheet ─────────────────────────────────────── */}
      <VoiceShareSheetMobile
        visible={showShare}
        roomId={id!}
        roomTitle={room?.name ?? room?.title ?? ''}
        onClose={() => setShowShare(false)}
      />

      {/* ── PK Battle Panel (host only) ──────────────────────────────────── */}
      {myRole === 'HOST' && id && (
        <MobilePKPanel
          visible={showPKPanel}
          onClose={() => setShowPKPanel(false)}
          roomId={id}
          speakers={speakers}
          myUserId={user?.id ?? ''}
          onPKStarted={(pkMatchId, participants, durationSeconds) => {
            setActivePKMatchId(pkMatchId);
            setActivePKParticipants(participants);
            setActivePKDuration(durationSeconds);
          }}
        />
      )}

      {/* ── PK Live Score Banner ─────────────────────────────────────────── */}
      {activePKMatchId && (
        <MobilePKBanner
          pkMatchId={activePKMatchId}
          participants={activePKParticipants}
          durationSeconds={activePKDuration}
          onDismiss={() => setActivePKMatchId(null)}
          onWatch={() => router.push(`/pk/${activePKMatchId}` as any)}
        />
      )}
    </>
  );
}

// ─── Voice Share Sheet (Mobile) ──────────────────────────────────────────────
// Share a Voice Club room to DM, Group Chat, Feed, Community, or native Share.
// Reuses existing backend endpoints — same contract as web VoiceShareSheet.
//
// BUG-003 FIX: roomUrl now uses EXPO_PUBLIC_WEB_URL (web app origin), not the API URL.
// BUG-005 FIX: Feed/Community share uses LIVE_ROOM_SHARE type for rich LiveCard.
// Community: new tab using GET /communities/mine + POST /posts { communityId }.
type ShareTab = 'dm' | 'group' | 'feed' | 'community' | 'copy';

function VoiceShareSheetMobile({ visible, roomId, roomTitle, onClose }: {
  visible: boolean; roomId: string; roomTitle: string; onClose: () => void;
}) {
  const [tab, setTab]           = useState<ShareTab>('dm');
  const [search, setSearch]     = useState('');
  const [sending, setSending]   = useState<string | null>(null);
  const [feedNote, setFeedNote] = useState('');

  // BUG-003 FIX: Use the configured web app URL, NOT the API server URL.
  // EXPO_PUBLIC_WEB_URL must be set in mobile/.env (e.g. http://localhost:3000 in dev,
  // https://app.halqa.com in production).
  const webBase = (process.env.EXPO_PUBLIC_WEB_URL ?? '').replace(/\/$/, '');
  const roomUrl = `${webBase}/voice-club/${roomId}`;
  // Plain-text link for DM/Group (text messages, not structured cards)
  const shareBody = `🎙️ Join me in "${roomTitle}" on Halqa Voice Club!\n${roomUrl}`;

  // ── Fetch DM conversations ─────────────────────────────────────────────────
  // Use friends list so ALL friends appear, even if no conversation exists yet.
  // GET /social/friends returns: [{ id, firstName, lastName, avatarUrl }]
  const { data: dmConvs = [] } = useQuery<any[]>({
    queryKey: ['dm-friends-share-mob'],
    queryFn:  () => api.get('/social/friends?limit=100').then(r => {
      const friends: any[] = r.data.data ?? []
      return friends.map((f: any) => ({ id: f.id, otherUser: f }))
    }),
    enabled:  visible && tab === 'dm',
    staleTime: 30_000,
  });

  // ── Fetch Group chats ──────────────────────────────────────────────────────
  const { data: groupConvs = [] } = useQuery<any[]>({
    queryKey: ['group-conversations-share-mob'],
    queryFn:  () => api.get('/group-chat/conversations?limit=50').then(r => r.data.data ?? []),
    enabled:  visible && tab === 'group',
    staleTime: 30_000,
  });

  // ── Fetch user's communities ───────────────────────────────────────────────
  const { data: myCommunities = [] } = useQuery<any[]>({
    queryKey: ['my-communities-share-mob'],
    queryFn:  () => api.get('/communities/mine').then(r => r.data.data?.items ?? r.data.data ?? []),
    enabled:  visible && tab === 'community',
    staleTime: 60_000,
  });

  const sendDM = async (conv: any) => {
    const friendUserId = conv.id; // conv.id is the friend's userId (from friends list)
    setSending(friendUserId);
    try {
      // Task 6: Get or create a DM conversation with this friend first.
      // conv.id is the friend's userId, NOT a conversation id.
      const convRes = await api.get(`/dm/conversations/${friendUserId}/with`);
      const convId = convRes.data.data?.id;
      if (!convId) throw new Error('Could not start conversation');
      // Send structured VOICE_ROOM_SHARE — only roomId is authoritative
      await api.post(`/dm/conversations/${convId}/messages`, {
        msgType:       'VOICE_ROOM_SHARE',
        refEntityType: 'VoiceRoom',
        refEntityId:   roomId,
        body:          feedNote.trim() || null,
      });
      showMessage({ message: `✅ Sent to ${conv.otherUser?.firstName ?? 'DM'}`, type: 'success' });
      onClose();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    } finally { setSending(null); }
  };

  const sendGroup = async (conv: any) => {
    setSending(conv.id);
    try {
      // Phase 6: send structured VOICE_ROOM_SHARE — only roomId is authoritative
      await api.post(`/group-chat/conversations/${conv.id}/messages`, {
        type:          'VOICE_ROOM_SHARE',
        refEntityType: 'VoiceRoom',
        refEntityId:   roomId,
        body:          feedNote.trim() || null,
      });
      showMessage({ message: `✅ Sent to ${conv.name ?? 'Group'}`, type: 'success' });
      onClose();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    } finally { setSending(null); }
  };

  // BUG-005 FIX: Feed share uses LIVE_ROOM_SHARE so LiveCard renders a rich room card.
  const postFeed = async () => {
    setSending('feed');
    try {
      await api.post('/posts', {
        type:          'LIVE_ROOM_SHARE',
        refEntityType: 'VoiceRoom',
        refEntityId:   roomId,
        body:          feedNote.trim() || null,
        visibility:    'PUBLIC',
      });
      showMessage({ message: '✅ Posted to your feed', type: 'success' });
      onClose();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    } finally { setSending(null); }
  };

  // Community share — same LIVE_ROOM_SHARE type with communityId
  const postCommunity = async (community: any) => {
    setSending(community.id);
    try {
      await api.post('/posts', {
        type:          'LIVE_ROOM_SHARE',
        refEntityType: 'VoiceRoom',
        refEntityId:   roomId,
        communityId:   community.id,
        body:          feedNote.trim() || null,
        visibility:    'PUBLIC',
      });
      showMessage({ message: `✅ Shared to ${community.name}`, type: 'success' });
      onClose();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    } finally { setSending(null); }
  };

  // Native Share sheet — uses correct web URL
  const nativeShare = async () => {
    try {
      const { Share } = require('react-native');
      await Share.share({ message: shareBody, url: roomUrl });
    } catch { /* user cancelled */ }
  };

  const filteredDM          = search ? dmConvs.filter((c: any)       => `${c.otherUser?.firstName} ${c.otherUser?.lastName}`.toLowerCase().includes(search.toLowerCase())) : dmConvs;
  const filteredGroup       = search ? groupConvs.filter((c: any)    => (c.name ?? '').toLowerCase().includes(search.toLowerCase())) : groupConvs;
  const filteredCommunities = search ? myCommunities.filter((c: any) => (c.name ?? '').toLowerCase().includes(search.toLowerCase())) : myCommunities;

  const TABS: { id: ShareTab; label: string; emoji: string }[] = [
    { id: 'dm',        label: 'Friend',    emoji: '👤' },
    { id: 'group',     label: 'Group',     emoji: '👥' },
    { id: 'feed',      label: 'Feed',      emoji: '📢' },
    { id: 'community', label: 'Community', emoji: '🏘️' },
    { id: 'copy',      label: 'Share',     emoji: '🔗' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={vss.backdrop} activeOpacity={1} onPress={onClose} />
      <KeyboardAvoidingView style={vss.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Handle */}
        <View style={vss.handle} />

        {/* Header */}
        <View style={vss.header}>
          <View style={{ flex: 1 }}>
            <Text style={vss.title}>Share Room</Text>
            <Text style={vss.subtitle} numberOfLines={1}>🎙️ {roomTitle}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {/* Tab bar */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={vss.tabsScroll} contentContainerStyle={vss.tabsContent}>
          {TABS.map(t => (
            <TouchableOpacity
              key={t.id}
              style={[vss.tabBtn, tab === t.id && vss.tabBtnActive]}
              onPress={() => { setTab(t.id); setSearch(''); }}
            >
              <Text style={[vss.tabTxt, tab === t.id && vss.tabTxtActive]}>{t.emoji} {t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Search (DM / Group / Community) */}
        {(tab === 'dm' || tab === 'group' || tab === 'community') && (
          <View style={vss.searchRow}>
            <Ionicons name="search-outline" size={14} color="#94a3b8" />
            <TextInput
              style={vss.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={tab === 'dm' ? 'Search friends…' : tab === 'group' ? 'Search groups…' : 'Search communities…'}
              placeholderTextColor="#94a3b8"
              allowFontScaling={false}
            />
          </View>
        )}

        {/* Content */}
        <View style={{ flex: 1, minHeight: 0 }}>

          {/* DM */}
          {tab === 'dm' && (
            <View style={{ flex: 1 }}>
              {/* Optional note for the Voice Club share */}
              <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
                <TextInput
                  style={[vss.feedInput, { minHeight: 48, marginBottom: 0 }]}
                  value={feedNote}
                  onChangeText={setFeedNote}
                  placeholder="Add a note (optional)…"
                  placeholderTextColor="#94a3b8"
                  multiline
                  numberOfLines={2}
                  maxLength={500}
                />
              </View>
              {filteredDM.length === 0
                ? <Text style={vss.empty}>No conversations found</Text>
                : <FlatList
                    data={filteredDM}
                    keyExtractor={(c: any) => c.id}
                    contentContainerStyle={{ paddingBottom: 20 }}
                    renderItem={({ item: conv }: any) => (
                      <View style={vss.row}>
                        <Image
                          source={{ uri: avatarUrl(conv.otherUser?.avatarUrl, `${conv.otherUser?.firstName ?? ''} ${conv.otherUser?.lastName ?? ''}`) }}
                          style={vss.avatar}
                        />
                        <Text style={vss.name} numberOfLines={1}>{conv.otherUser?.firstName} {conv.otherUser?.lastName}</Text>
                        <TouchableOpacity
                          style={[vss.sendBtn, sending === conv.id && vss.sendBtnDisabled]}
                          onPress={() => sendDM(conv)}
                          disabled={!!sending}
                        >
                          {sending === conv.id
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Text style={vss.sendBtnTxt}>Send</Text>
                          }
                        </TouchableOpacity>
                      </View>
                    )}
                  />
              }
            </View>
          )}

          {/* Group */}
          {tab === 'group' && (
            <View style={{ flex: 1 }}>
              {/* Optional note for the Voice Club share */}
              <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
                <TextInput
                  style={[vss.feedInput, { minHeight: 48, marginBottom: 0 }]}
                  value={feedNote}
                  onChangeText={setFeedNote}
                  placeholder="Add a note (optional)…"
                  placeholderTextColor="#94a3b8"
                  multiline
                  numberOfLines={2}
                  maxLength={500}
                />
              </View>
              {filteredGroup.length === 0
                ? <Text style={vss.empty}>No groups found</Text>
                : <FlatList
                    data={filteredGroup}
                    keyExtractor={(c: any) => c.id}
                    contentContainerStyle={{ paddingBottom: 20 }}
                    renderItem={({ item: conv }: any) => (
                      <View style={vss.row}>
                        <Image
                          source={{ uri: avatarUrl(conv.avatarUrl, conv.name ?? 'G') }}
                          style={vss.avatar}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={vss.name} numberOfLines={1}>{conv.name}</Text>
                          {conv.memberCount ? <Text style={vss.meta}>{conv.memberCount} members</Text> : null}
                        </View>
                        <TouchableOpacity
                          style={[vss.sendBtn, sending === conv.id && vss.sendBtnDisabled]}
                          onPress={() => sendGroup(conv)}
                          disabled={!!sending}
                        >
                          {sending === conv.id
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Text style={vss.sendBtnTxt}>Send</Text>
                          }
                        </TouchableOpacity>
                      </View>
                    )}
                  />
              }
            </View>
          )}

          {/* Feed */}
          {tab === 'feed' && (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
              <Text style={vss.feedLabel}>Add a note (optional)</Text>
              <Text style={[vss.feedLabel, { color: '#94a3b8', fontSize: 11, marginBottom: 8 }]}>
                A Voice Club card will appear in the feed — recipients can tap &quot;Join&quot; directly.
              </Text>
              <TextInput
                style={vss.feedInput}
                value={feedNote}
                onChangeText={setFeedNote}
                placeholder="Say something about the room…"
                placeholderTextColor="#94a3b8"
                multiline
                numberOfLines={3}
                maxLength={500}
              />
              <TouchableOpacity
                style={[vss.postBtn, !!sending && vss.postBtnDisabled]}
                onPress={postFeed}
                disabled={!!sending}
              >
                {sending === 'feed'
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={vss.postBtnTxt}>📢 Post to Feed</Text>
                }
              </TouchableOpacity>
            </ScrollView>
          )}

          {/* Community */}
          {tab === 'community' && (
            filteredCommunities.length === 0 ? (
              <Text style={vss.empty}>
                {myCommunities.length === 0 ? 'You are not a member of any communities' : 'No communities found'}
              </Text>
            ) : (
              <View style={{ flex: 1 }}>
                {/* Optional note */}
                <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
                  <TextInput
                    style={[vss.feedInput, { minHeight: 52, marginBottom: 0 }]}
                    value={feedNote}
                    onChangeText={setFeedNote}
                    placeholder="Add a note (optional)…"
                    placeholderTextColor="#94a3b8"
                    multiline
                    numberOfLines={2}
                    maxLength={500}
                  />
                </View>
                <FlatList
                  data={filteredCommunities}
                  keyExtractor={(c: any) => c.id}
                  contentContainerStyle={{ paddingBottom: 20 }}
                  renderItem={({ item: community }: any) => (
                    <View style={vss.row}>
                      <Image
                        source={{ uri: avatarUrl(community.avatarUrl, community.name ?? 'C') }}
                        style={vss.avatar}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={vss.name} numberOfLines={1}>{community.name}</Text>
                        <Text style={vss.meta}>{community.privacy}</Text>
                      </View>
                      <TouchableOpacity
                        style={[vss.sendBtn, sending === community.id && vss.sendBtnDisabled]}
                        onPress={() => postCommunity(community)}
                        disabled={!!sending}
                      >
                        {sending === community.id
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text style={vss.sendBtnTxt}>Share</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  )}
                />
              </View>
            )
          )}

          {/* Copy / Share */}
          {tab === 'copy' && (
            <View style={{ padding: 16 }}>
              <View style={vss.linkBox}>
                <Text style={vss.linkTxt} numberOfLines={3}>{shareBody}</Text>
              </View>
              <TouchableOpacity style={vss.postBtn} onPress={nativeShare}>
                <Text style={vss.postBtnTxt}>🔗 Share / Copy Link</Text>
              </TouchableOpacity>
              <Text style={vss.copyHint}>Uses your device&apos;s share sheet</Text>
            </View>
          )}

        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── VoiceShareSheetMobile styles ────────────────────────────────────────────
// Referenced as `vss.*` inside VoiceShareSheetMobile above.
const vss = StyleSheet.create({
  // Modal backdrop
  backdrop:       { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  // Bottom sheet container
  sheet:          { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '72%' as any, flex: 0 },
  // Drag handle
  handle:         { width: 40, height: 4, backgroundColor: '#e2e8f0', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 0 },
  // Header row
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 0 },
  title:          { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  subtitle:       { fontSize: 12, color: '#94a3b8', marginTop: 2, flex: 1 },
  // Tab bar
  tabsScroll:     { flexGrow: 0 },
  tabsContent:    { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 0 },
  tabBtn:         { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  tabBtnActive:   { borderColor: '#7c3aed', backgroundColor: '#ede9fe' },
  tabTxt:         { fontSize: 12, fontWeight: '600', color: '#64748b' },
  tabTxtActive:   { color: '#7c3aed' },
  // Search row
  searchRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 10, backgroundColor: '#f9fafb', borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 10, paddingVertical: 8 },
  searchInput:    { flex: 1, fontSize: 13, color: '#1e293b', padding: 0 },
  // Empty state
  empty:          { textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 24 },
  // Shared list row (DM / Group / Community)
  row:            { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  avatar:         { width: 42, height: 42, borderRadius: 21, backgroundColor: '#e0e7ff' },
  name:           { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  meta:           { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  sendBtn:        { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, backgroundColor: '#7c3aed' },
  sendBtnDisabled:{ backgroundColor: '#f1f5f9' },
  sendBtnTxt:     { fontSize: 12, fontWeight: '600', color: '#fff' },
  // Feed / Community note input
  feedLabel:      { fontSize: 12, color: '#64748b', marginBottom: 4 },
  feedInput:      { width: '100%' as any, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', fontSize: 13, color: '#374151', backgroundColor: '#f9fafb', minHeight: 72, textAlignVertical: 'top' },
  // Post button
  postBtn:        { marginTop: 12, paddingVertical: 12, borderRadius: 12, backgroundColor: '#7c3aed', alignItems: 'center', justifyContent: 'center' },
  postBtnDisabled:{ backgroundColor: '#f1f5f9' },
  postBtnTxt:     { fontSize: 14, fontWeight: '700', color: '#fff' },
  // Copy / Share tab
  linkBox:        { backgroundColor: '#f8fafc', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  linkTxt:        { fontSize: 12, color: '#64748b' },
  copyHint:       { textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 8 },
});

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Layout
  container:        { flex: 1, backgroundColor: '#0f0f23' },
  centered:         { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f0f23' },
  errorText:        { color: '#9ca3af' },

  // Room header
  roomHeader:       { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: '#1e1e3a' },
  roomName:         { fontSize: 18, fontWeight: '800', color: '#fff', flex: 1 },
  roomTopic:        { fontSize: 12, color: '#a5b4fc', marginTop: 2 },
  roomHeaderRight:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  liveBadge:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ef444422', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, gap: 4 },
  liveDot:          { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ef4444' },
  liveText:         { color: '#ef4444', fontSize: 11, fontWeight: '700' },
  leaderBtn:        { backgroundColor: '#1e1e3a', borderRadius: 10, padding: 8 },
  // Mini music bar
  musicBar:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#0f2e1a', paddingHorizontal: 14, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#166534' },
  musicBarLeft:     { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  musicBarTitle:    { color: '#4ade80', fontSize: 12, fontWeight: '600', flex: 1 },
  musicBarRight:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  musicBarDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  musicBarStatus:   { color: '#4ade80', fontSize: 10, fontWeight: '700' },

  // Tabs
  tabs:             { flexDirection: 'row', backgroundColor: '#1a1a2e', borderBottomWidth: 1, borderColor: '#1e1e3a' },
  tab:              { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, gap: 5 },
  tabActive:        { borderBottomWidth: 2, borderColor: '#4f46e5' },
  tabText:          { color: '#6b7280', fontSize: 13, fontWeight: '600' },
  tabTextActive:    { color: '#a5b4fc' },
  chatBadge:        { backgroundColor: '#4f46e5', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  chatBadgeText:    { color: '#fff', fontSize: 10, fontWeight: '700' },

  // Participant grid
  grid:             { padding: 10 },
  gridSectionLabel: { color: '#6b7280', fontSize: 12, fontWeight: '700', paddingLeft: 4, paddingBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  tile:             { flex: 1, margin: 5, alignItems: 'center', backgroundColor: '#1e1e3a', borderRadius: 14, padding: 10 },
  tileSpeaking:     { borderWidth: 2, borderColor: '#4f46e5' },
  tileAvatarWrap:   { position: 'relative', marginBottom: 6 },
  tileAvatar:       { width: 52, height: 52, borderRadius: 26, backgroundColor: '#374151' },
  speakingRing:     { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: 30, borderWidth: 2, borderColor: '#4f46e5' },
  handBadge:        { position: 'absolute', bottom: -4, right: -4, backgroundColor: '#fff', borderRadius: 8, padding: 2 },
  tileName:         { color: '#e5e7eb', fontSize: 11, fontWeight: '600', textAlign: 'center' },
  roleTag:          { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginTop: 3 },
  roleText:         { fontSize: 9, fontWeight: '700' },
  emptyText:        { textAlign: 'center', color: '#6b7280', marginTop: 40 },
  queueBadge:       { position: 'absolute', top: -4, left: -4, backgroundColor: '#4f46e5', borderRadius: 8, paddingHorizontal: 4, paddingVertical: 1, minWidth: 18, alignItems: 'center' },
  queueBadgeText:   { color: '#fff', fontSize: 9, fontWeight: '800' },
  queueLabel:       { color: '#6366f1', fontSize: 8, fontWeight: '700', marginTop: 2 },
  // Empty speaker slot
  emptySlot:        { width: 56, height: 56, borderRadius: 28, backgroundColor: '#111827', borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#374151', alignItems: 'center', justifyContent: 'center' },
  emptySlotLocked:  { backgroundColor: '#1a1020', borderColor: '#7c3aed', borderStyle: 'solid' },
  emptySlotHint:    { fontSize: 7, color: '#6b7280', marginTop: 2, textAlign: 'center' },
  emptySlotNum:     { fontSize: 9, color: '#6b7280', marginTop: 4, fontWeight: '600' },

  // Chat
  chatList:         { padding: 10, gap: 8 },
  chatRow:          { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  chatAvatar:       { width: 32, height: 32, borderRadius: 16, backgroundColor: '#374151' },
  chatBubble:       { flex: 1, backgroundColor: '#1e1e3a', borderRadius: 12, padding: 10 },
  chatSenderName:   { color: '#a5b4fc', fontSize: 11, fontWeight: '700', marginBottom: 3 },
  chatMsgText:      { color: '#e5e7eb', fontSize: 13 },
  chatInputBar:     { flexDirection: 'row', padding: 8, gap: 8, backgroundColor: '#1a1a2e', borderTopWidth: 1, borderColor: '#1e1e3a' },
  chatInput:        { flex: 1, backgroundColor: '#111827', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, color: '#e5e7eb', fontSize: 14 },
  chatSendBtn:      { width: 38, height: 38, borderRadius: 19, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center' },

  // Controls
  controls:         { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#1a1a2e', borderTopWidth: 1, borderColor: '#1e1e3a' },
  joinBtn:          { flex: 1, flexDirection: 'row', backgroundColor: '#4f46e5', paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 8 },
  joinBtnText:      { color: '#fff', fontWeight: '700', fontSize: 16 },
  ctrlBtn:          { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e1e3a', borderRadius: 14, padding: 10, minWidth: 64, height: 64 },
  ctrlBtnActive:    { backgroundColor: '#4f46e522', borderWidth: 1.5, borderColor: '#4f46e5' },
  ctrlBtnGift:      { backgroundColor: '#f59e0b22', borderWidth: 1.5, borderColor: '#f59e0b55' },
  ctrlBtnDanger:    { borderWidth: 1.5, borderColor: '#ef444433' },
  ctrlLabel:        { color: '#9ca3af', fontSize: 10, marginTop: 3, fontWeight: '600' },

  // Gift overlay animation
  giftOverlay:      { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 999, pointerEvents: 'none' },
  giftAnimCard:     { backgroundColor: '#0f0f23', borderRadius: 24, padding: 28, alignItems: 'center', borderWidth: 2, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 20, elevation: 20, minWidth: 180 },
  giftAnimEmoji:    { fontSize: 64, marginBottom: 8 },
  giftAnimName:     { color: '#fff', fontSize: 20, fontWeight: '800' },
  giftAnimSender:   { color: '#9ca3af', fontSize: 13, marginTop: 4 },
  giftRarityBadge:  { marginTop: 12, paddingHorizontal: 14, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  giftRarityText:   { fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  // Gift panel (bottom sheet)
  modalBackdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  giftPanel:        { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 12, maxHeight: SCREEN_H * 0.72 },
  giftPanelHandle:  { width: 40, height: 4, backgroundColor: '#374151', borderRadius: 2, alignSelf: 'center', marginBottom: 10 },
  giftPanelHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  giftPanelTitle:   { color: '#e5e7eb', fontSize: 16, fontWeight: '800' },
  coinBadge:        { backgroundColor: '#4f46e522', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#4f46e555' },
  coinText:         { color: '#a5b4fc', fontWeight: '700', fontSize: 13 },
  giftSectionLabel: { color: '#6b7280', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 2 },

  // Receiver selector
  receiverRow:      { flexGrow: 0, marginBottom: 10 },
  receiverChip:     { alignItems: 'center', marginRight: 12, backgroundColor: '#111827', borderRadius: 14, padding: 10, width: 72, borderWidth: 1.5, borderColor: '#1e1e3a' },
  receiverChipActive:{ borderColor: '#f59e0b', backgroundColor: '#f59e0b22' },
  receiverAvatar:   { width: 36, height: 36, borderRadius: 18, backgroundColor: '#374151', marginBottom: 4 },
  receiverName:     { color: '#e5e7eb', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  receiverRole:     { color: '#6b7280', fontSize: 9, marginTop: 1 },
  noReceivers:      { color: '#6b7280', fontSize: 13, textAlign: 'center', padding: 8 },

  // Gift grid
  giftGrid:         { maxHeight: 180 },
  giftItem:         { flex: 1, margin: 4, alignItems: 'center', backgroundColor: '#111827', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#1e1e3a' },
  giftItemEmoji:    { fontSize: 28, marginBottom: 4 },
  giftItemName:     { color: '#9ca3af', fontSize: 10, fontWeight: '600', textAlign: 'center' },
  giftItemPrice:    { fontSize: 11, fontWeight: '700', marginTop: 2 },

  // Count selector
  countRow:         { marginTop: 4 },
  countBtns:        { flexDirection: 'row', gap: 8, marginBottom: 6 },
  countBtn:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#111827', borderWidth: 1, borderColor: '#1e1e3a' },
  countBtnActive:   { borderColor: '#f59e0b', backgroundColor: '#f59e0b22' },
  countBtnText:     { color: '#9ca3af', fontWeight: '700', fontSize: 13 },
  totalCost:        { color: '#a5b4fc', fontSize: 13, fontWeight: '600', marginTop: 4 },

  // Send gift button
  sendGiftBtn:       { backgroundColor: '#f59e0b', borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 8 },
  sendGiftBtnDisabled:{ backgroundColor: '#374151' },
  sendGiftBtnText:   { color: '#fff', fontWeight: '800', fontSize: 15 },
  sendAllBtn:        { backgroundColor: '#7c3aed', borderRadius: 12, padding: 10, alignItems: 'center', marginTop: 6 },
  sendAllBtnText:    { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Leaderboard
  leaderRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#1e1e3a', gap: 12 },
  leaderRank:       { fontSize: 22, width: 32, textAlign: 'center' },
  leaderAvatar:     { width: 44, height: 44, borderRadius: 22, backgroundColor: '#374151' },
  leaderInfo:       { flex: 1 },
  leaderName:       { color: '#e5e7eb', fontSize: 14, fontWeight: '700' },
  leaderCoins:      { color: '#9ca3af', fontSize: 12, marginTop: 2 },
});

// ─── Mobile UI styles — light theme matching the target screenshot ────────────
const SLOT_SIZE = Math.floor((SCREEN_W - 32 - 24) / 4); // 4 columns, 16px side padding, 8px gaps

const mobStyles = StyleSheet.create({
  // ── Root container ──────────────────────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: '#eef0f8', // light blue-grey matching target
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e8eaf0',
    gap: 8,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  headerEmoji: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#f0f0ff',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1a1a2e',
    lineHeight: 20,
  },
  liveSubtitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  liveSubtitleDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#22c55e',
  },
  liveSubtitleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#22c55e',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  memberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#22c55e',
    backgroundColor: '#f0fdf4',
  },
  memberBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#22c55e',
  },
  levelBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#f5f3ff',
    borderWidth: 1,
    borderColor: '#ddd6fe',
  },
  levelBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#5b21b6',
  },
  dotMenuBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Music bar ────────────────────────────────────────────────────────────────
  musicBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#bbf7d0',
  },
  musicBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  musicBarTitle: {
    color: '#16a34a',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  musicBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  musicBarDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  musicBarStatus: {
    color: '#16a34a',
    fontSize: 10,
    fontWeight: '700',
  },

  // ── Tabs (Room / Chat) ───────────────────────────────────────────────────────
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 5,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#6366f1',
  },
  tabText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#6366f1',
  },
  chatBadge: {
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  chatBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },

  // ── Stage bar ────────────────────────────────────────────────────────────────
  stageBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#eef0f8',
  },
  stageBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stageMicIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ede9fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageBarLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#6366f1',
    letterSpacing: 0.5,
  },
  stageCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
    backgroundColor: '#ede9fe',
  },
  stageCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6366f1',
  },
  stageBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  levelMembersPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#f5f3ff',
    borderWidth: 1,
    borderColor: '#ddd6fe',
  },
  levelMembersText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#5b21b6',
  },
  participantsPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  participantsPillFull: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
  },
  participantsPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#374151',
  },

  // ── Speakers grid card ───────────────────────────────────────────────────────
  speakersCard: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
    marginBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
  },
  speakersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  // ── Individual speaker slot ──────────────────────────────────────────────────
  speakerSlot: {
    width: SLOT_SIZE,
    alignItems: 'center',
    gap: 4,
  },
  avatarWrap: {
    position: 'relative',
    width: SLOT_SIZE,
    height: SLOT_SIZE,
    borderRadius: SLOT_SIZE / 2,
    overflow: 'visible',
  },
  avatarSpeaking: {
    // Speaking ring handled via borderColor on avatarImg
  },
  avatarImg: {
    width: SLOT_SIZE,
    height: SLOT_SIZE,
    borderRadius: SLOT_SIZE / 2,
    backgroundColor: '#e0e7ff',
    borderWidth: 2.5,
    borderColor: '#e0e7ff',
  },
  crownBadge: {
    position: 'absolute',
    top: -8,
    right: -4,
    fontSize: 14,
    zIndex: 3,
  },
  // Gap 3 fix: hand raised badge on stage slots (mirrors web ✋ top-left)
  handRaisedBadge: {
    position: 'absolute',
    top: -6,
    left: -4,
    fontSize: 13,
    zIndex: 3,
  },
  muteBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  muteBadgeLive: {
    backgroundColor: '#dcfce7',
  },
  muteBadgeMuted: {
    backgroundColor: '#f3f4f6',
  },
  meBadge: {
    position: 'absolute',
    bottom: 2,
    left: -2,
    backgroundColor: '#6366f1',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  meBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
  },
  slotName: {
    fontSize: 11,
    fontWeight: '500',
    color: '#374151',
    textAlign: 'center',
    maxWidth: SLOT_SIZE,
  },

  // ── Role label below name — matches web .vc-role-label ──────────────────────
  roleLabel: {
    fontSize: 9,
    fontWeight: '700',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    textAlign: 'center',
    marginTop: 1,
    overflow: 'hidden',
  } as any,
  roleLabelHost: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
  },
  roleLabelMod: {
    backgroundColor: '#ede9fe',
    color: '#5b21b6',
  },
  roleLabelSpeaker: {
    backgroundColor: '#dcfce7',
    color: '#166534',
  },

  // ── Empty slot ───────────────────────────────────────────────────────────────
  emptySlot: {
    width: SLOT_SIZE,
    height: SLOT_SIZE,
    borderRadius: SLOT_SIZE / 2,
    borderWidth: 2,
    borderColor: '#22c55e',
    borderStyle: 'dashed',
    backgroundColor: '#f8faff',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  emptySlotLocked: {
    borderColor: '#d1d5db',
    backgroundColor: '#f3f4f6',
    borderStyle: 'solid',
  },
  // Gap 7 fix: individually seat-locked outline — matches web's yellow outline
  emptySlotSeatLocked: {
    borderColor: '#f59e0b',
    borderWidth: 2.5,
    borderStyle: 'solid',
  },
  openLabel: {
    position: 'absolute',
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  openDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#22c55e',
  },
  openLabelText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#22c55e',
  },
  slotNum: {
    fontSize: 10,
    color: '#9ca3af',
    fontWeight: '600',
    textAlign: 'center',
  },

  // ── Audience section ─────────────────────────────────────────────────────────
  audienceSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  audienceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  audienceLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  audienceEmpty: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  audienceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  audienceItem: {
    alignItems: 'center',
    gap: 3,
    position: 'relative',
    width: 52,
  },
  audienceAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e0e7ff',
    borderWidth: 2,
    borderColor: '#e0e7ff',
  },
  audienceAvatarHand: {
    borderColor: '#fde68a',
  },
  handBadgeAud: {
    position: 'absolute',
    top: -4,
    left: -4,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  audienceName: {
    fontSize: 10,
    color: '#6b7280',
    textAlign: 'center',
    maxWidth: 52,
  },

  // ── Controls bar — light theme ───────────────────────────────────────────────
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  joinBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  joinBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  ctrlBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 14,
    padding: 10,
    minWidth: 60,
    height: 60,
  },
  ctrlBtnActive: {
    backgroundColor: '#ede9fe',
    borderWidth: 1.5,
    borderColor: '#6366f1',
  },
  ctrlBtnGift: {
    backgroundColor: '#fffbeb',
    borderWidth: 1.5,
    borderColor: '#fde68a',
  },
  ctrlBtnDanger: {
    backgroundColor: '#fef2f2',
    borderWidth: 1.5,
    borderColor: '#fecaca',
  },
  ctrlLabel: {
    color: '#6b7280',
    fontSize: 10,
    marginTop: 3,
    fontWeight: '600',
  },
});







