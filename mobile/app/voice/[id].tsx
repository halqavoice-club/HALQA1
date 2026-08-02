/**
 * HALQA Mobile — Voice Room Screen
 * Live audio room: participants, mic, hand raise, gifts, leaderboard, leave
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, Alert, Image, Modal, ScrollView,
  Animated, Dimensions, TextInput, KeyboardAvoidingView, Platform,
  BackHandler,
} from 'react-native';
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
import { useVoiceStore } from '@/store/voice.store';

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

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────
interface VoiceRoom {
  id: string; name: string; description?: string; hostId: string;
  host: { id: string; name: string; avatar?: string };
  participantsCount: number; topic?: string; isLive: boolean;
  isOpenMic: boolean; micLocked: boolean; reactionsEnabled: boolean; roomLevel: number; commentsEnabled: boolean; slowMode: boolean;
}
interface Participant {
  id: string; name: string; avatar?: string;
  role: 'HOST' | 'MODERATOR' | 'SPEAKER' | 'AUDIENCE';
  isMuted: boolean; isSpeaking: boolean; handRaised: boolean;
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

// ─── Gift Animation Overlay ───────────────────────────────────────────────────
function GiftAnimOverlay({ gift, senderName, onDone }: {
  gift: Gift; senderName: string; onDone: () => void;
}) {
  const scaleAnim  = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 6 }),
      Animated.delay(1800),
      Animated.timing(opacityAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => onDone());
  }, []);

  const rarityColors: Record<string, string> = {
    common: '#94a3b8', rare: '#6366f1', epic: '#8b5cf6',
    legendary: '#f59e0b', ultimate: '#ef4444',
  };
  const glow = rarityColors[gift.rarity] || '#94a3b8';

  return (
    <Animated.View style={[styles.giftOverlay, { opacity: opacityAnim }]}>
      <Animated.View style={[styles.giftAnimCard, { transform: [{ scale: scaleAnim }], borderColor: glow, shadowColor: glow }]}>
        <Text style={styles.giftAnimEmoji}>{gift.emoji}</Text>
        <Text style={styles.giftAnimName}>{gift.name}</Text>
        <Text style={styles.giftAnimSender}>from {senderName}</Text>
        <View style={[styles.giftRarityBadge, { backgroundColor: glow + '33', borderColor: glow }]}>
          <Text style={[styles.giftRarityText, { color: glow }]}>{gift.rarity.toUpperCase()}</Text>
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
  const [isMuted,        setIsMuted]        = useState(true);
  const [handRaised,     setHandRaised]     = useState(false);
  const [participants,   setParticipants]   = useState<Participant[]>([]);
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

  // ── Background music state ───────────────────────────────────────────────────
  const [showBgMusic,   setShowBgMusic]   = useState(false);
  const [showDotMenu,   setShowDotMenu]   = useState(false);
  // Room settings (host only)
  const [showRoomSettings, setShowRoomSettings] = useState(false);
  const [settingsTitle,    setSettingsTitle]    = useState('');
  const [settingsTopic,    setSettingsTopic]    = useState('');
  const [settingsPrivacy,  setSettingsPrivacy]  = useState<'PUBLIC'|'PRIVATE'|'INVITE_ONLY'>('PUBLIC');
  const [settingsSaving,   setSettingsSaving]   = useState(false);
  // Mini indicator — reflects BgMusicPanel's internal state via callback
  const [bgMusicTrack,  setBgMusicTrack]  = useState<{ title: string; isDeviceFile: boolean } | null>(null);
  const [bgMusicPlaying, setBgMusicPlaying] = useState(false);

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
    socket.on('voice:user_joined',   () => queryClient.invalidateQueries({ queryKey: ['voice-room', id] }));
    socket.on('voice:user_left',     () => queryClient.invalidateQueries({ queryKey: ['voice-room', id] }));

    // ── Missing real-time events (now wired) ─────────────────────────────────

    // Mute state changed for a participant
    const onMuteChanged = (d: { userId: string; isMuted: boolean }) => {
      setParticipants(prev => prev.map(p => p.id === d.userId ? { ...p, isMuted: d.isMuted } : p));
    };

    // Role changed (promote/demote, moderator assign, etc.)
    const onRoleChanged = (d: { userId: string; role: string }) => {
      setParticipants(prev => prev.map(p =>
        p.id === d.userId ? { ...p, role: d.role as Participant['role'], isMuted: d.role === 'AUDIENCE' } : p
      ));
      // Invalidate full room for accurate state
      queryClient.invalidateQueries({ queryKey: ['voice-room', id] });
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

    // Room ended — leave automatically
    const onRoomEnded = () => {
      showMessage({ message: '🏁 This room has ended', type: 'info' });
      lk.disconnect();
      clearActiveRoom();
      clearQueuePosition();
      setIsJoined(false);
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
      const newP: Participant = {
        id:         d.userId,
        name:       `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() || 'User',
        avatar:     d.avatarUrl ?? null,
        role:       (d.role ?? 'AUDIENCE') as Participant['role'],
        isMuted:    d.isMuted ?? true,
        isSpeaking: false,
        handRaised: false,
      };
      setParticipants(prev => {
        if (prev.find(p => p.id === d.userId)) return prev;
        return [...prev, newP];
      });
    };

    // Participant left — remove from list
    const onUserLeft = (d: { userId: string }) => {
      setParticipants(prev => prev.filter(p => p.id !== d.userId));
    };

    // Mic pass offer received (incoming)
    const onMicPassOffer = (d: { offerId?: string; offeredBy?: { id: string; firstName: string; lastName: string; avatarUrl?: string | null }; passerId?: string; passerName?: string; passerAvatar?: string | null }) => {
      // Backend sends { offerId, roomId, passerName, passerAvatar } — normalise both formats
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
    // Backend event: voice:mic_passed { roomId, passerId, passerName, targetId, targetName, passerRole }
    const onMicPassResult = (d: { passerId?: string; targetId?: string; targetName?: string; passerRole?: string }) => {
      // If we are the passer, show confirmation
      if (d.passerId === user?.id) {
        showMessage({ message: `🎤 ${d.targetName ?? 'User'} accepted the mic!`, type: 'success' });
      }
      // Update roles in participant list
      if (d.passerRole && d.passerRole !== 'HOST' && d.passerId) {
        setParticipants(prev => prev.map(p =>
          p.id === d.passerId ? { ...p, role: 'AUDIENCE', isMuted: true } : p
        ));
      }
      if (d.targetId) {
        setParticipants(prev => prev.map(p =>
          p.id === d.targetId ? { ...p, role: 'SPEAKER', isMuted: false, handRaised: false } : p
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
    socket.on('voice:hand_raised',    onHandRaised);
    socket.on('voice:room_ended',     onRoomEnded);
    socket.on('voice:open_mic_changed', onOpenMicChanged);
    socket.on('voice:mic_lock_changed', onMicLockChanged);
    socket.on('voice:room_updated',      onRoomUpdated);
    socket.on('voice:join_request',      (d: any) => { if (d.roomId !== id) return; showMessage({ message: `✋ ${d.firstName ?? ''} ${d.lastName ?? ''} wants to join the room`, type: 'info' }); });
    socket.on('voice:join_approved',     (d: any) => { if (d.roomId !== id) return; showMessage({ message: '✅ Your join request was approved!', type: 'success' }); setIsMember(true); setMemberLevel(1); });
    socket.on('voice:removed_from_room', (d: any) => {
      if (d.roomId !== id) return;
      showMessage({ message: '🚫 You were removed from this room', type: 'danger' });
      clearActiveRoom(); clearQueuePosition();
      router.back();
    });
    socket.on('voice:blocked_from_room', (d: any) => {
      if (d.roomId !== id) return;
      showMessage({ message: '⛔ You were blocked from this room', type: 'danger' });
      clearActiveRoom(); clearQueuePosition();
      router.back();
    });
    socket.on('voice:speaker_pinned',    (d: any) => { if (d.roomId !== id) return; setParticipants(prev => prev.map(p => ({ ...p, handRaised: p.id === d.userId ? false : p.handRaised }))); });
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

    return () => {
      socket.emit('voice:leave_room', id);
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
      socket.off('voice:mic_declined');
      socket.off('voice:mic_offer_cancelled');
      socket.off('voice:mic_received');
    };
  }, [isJoined, id, user, gifts, queryClient]);

  const handleJoin = useCallback(async () => {
    if (!room) return;
    setIsConnecting(true);
    try {
      const res = await api.post(`/voice/${id}/join`);
      // Init socket if not already done
      const token = (await import('@/store/auth.store')).useAuthStore.getState().accessToken;
      if (token && !getSocket()?.connected) initSocket(token);

      setIsJoined(true);

      // Store in shared voice store so the tab bar shows the "IN ROOM" badge
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
          commentsEnabled: roomData?.commentsEnabled ?? true,
          slowMode:        roomData?.slowMode ?? false,
          messageType:     (roomData?.messageType ?? 'all') as 'all' | 'followers' | 'none',
          reactionsEnabled: roomData?.reactionsEnabled ?? true,
          roomLevel:       roomData?.roomLevel ?? 1,
          schoolId:        roomData?.schoolId ?? null,
        });
      }

      // Populate participants from response
      const roomData = res.data.data;
      const parts: Participant[] = (roomData?.participants || []).map((p: any) => ({
        id:         p.userId ?? p.id,
        name:       p.user ? `${p.user.firstName} ${p.user.lastName}`.trim() : 'User',
        avatar:     p.user?.avatarUrl ?? null,
        role:       p.role,
        isMuted:    p.isMuted ?? true,
        isSpeaking: false,
        handRaised: p.handRaised ?? false,
      }));
      setParticipants(parts.length > 0 ? parts : [{
        id: room.host.id, name: room.host.name, avatar: room.host.avatar ?? undefined,
        role: 'HOST', isMuted: false, isSpeaking: false, handRaised: false,
      }]);
      await loadChat();
      // Connect LiveKit for real audio (native builds only)
      try {
        const tokenRes = await api.post(`/voice/${id}/livekit-token`);
        const { token: lkToken, livekitUrl } = tokenRes.data.data;
        if (lkToken && livekitUrl) {
          await lk.connect(livekitUrl, lkToken, true /* start muted */);
        }
      } catch { /* non-fatal — audio not available in Expo Go */ }
      showMessage({ message: `Joined ${room.name}`, type: 'success' });
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message ?? 'Failed to join room', type: 'danger' });
    } finally { setIsConnecting(false); }
  }, [id, room, loadChat]);

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
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    // Toggle real LiveKit audio track if connected in native build
    if (lk.connected) {
      if (newMuted) await lk.disableMic();
      else await lk.enableMic();
    }
    try { await api.patch(`/voice/${id}/mute`, { isMuted: newMuted }); } catch {}
  }, [id, isMuted]);

  const toggleHand = useCallback(async () => {
    if (room?.micLocked) { showMessage({ message: '🔒 Mic is locked by the host', type: 'warning' }); return; }
    const newRaised = !handRaised;
    try { await api.patch(`/voice/${id}/raise-hand`, { raised: newRaised }); } catch {}
    setParticipants(prev => prev.map(p =>
      p.id === user?.id ? { ...p, handRaised: newRaised } : p
    ));
  }, [id, handRaised, user]);

  // ── Host/Moderator controls ───────────────────────────────────────────────
  const myRole = participants.find(p => p.id === user?.id)?.role ?? (room?.hostId === user?.id ? 'HOST' : 'AUDIENCE');
  const canModerate = myRole === 'HOST' || myRole === 'MODERATOR';

  const handleMuteAll = useCallback(async () => {
    try { await api.patch(`/voice/${id}/mute-all`); showMessage({ message: '🔇 All speakers muted', type: 'info' }); } catch {}
  }, [id]);

  const handleMuteUser = useCallback(async (targetId: string, currentlyMuted: boolean) => {
    try {
      await api.patch(/voice//mute, { targetUserId: targetId, isMuted: !currentlyMuted });
      setParticipants(prev => prev.map(p => p.id === targetId ? { ...p, isMuted: !currentlyMuted } : p));
      showMessage({ message: !currentlyMuted ? '🔇 Speaker muted' : '🎙️ Speaker unmuted', type: 'info' });
    } catch {}
  }, [id]);

  const handlePromote = useCallback(async (targetId: string, role: 'SPEAKER' | 'AUDIENCE') => {
    try {
      await api.patch(`/voice/${id}/promote`, { targetUserId: targetId, role });
      setParticipants(prev => prev.map(p => p.id === targetId ? { ...p, role, isMuted: role === 'AUDIENCE' } : p));
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
        title:   settingsTitle.trim(),
        topic:   settingsTopic.trim() || null,
        privacy: settingsPrivacy,
      });
      queryClient.setQueryData<any>(['voice-room', id], (old: any) =>
        old ? { ...old, name: settingsTitle.trim(), title: settingsTitle.trim(), topic: settingsTopic.trim() || null, privacy: settingsPrivacy } : old
      );
      showMessage({ message: '✅ Room settings saved', type: 'success' });
      setShowRoomSettings(false);
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to save', type: 'danger' });
    } finally {
      setSettingsSaving(false);
    }
  }, [id, settingsTitle, settingsTopic, settingsPrivacy, queryClient]);

  const handleToggleMicLock = useCallback(async () => {
    const currentLocked = room?.micLocked ?? false;
    try {
      await api.patch(
`/voice/${id}/mic-lock`
, { locked: !currentLocked });
      showMessage({ message: !currentLocked ? '🔒 Mic Locked' : '🔓 Mic Unlocked', type: 'info' });
    } catch (e: any) { showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }); }
  }, [id, room?.micLocked]);


  // ── Room membership constants ─────────────────────────────────────────────
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
    api.get(/voice//members/status).then(r => {
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
      await api.post(/voice//members/join);
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
      await api.delete(/voice//members/leave);
      setIsMember(false); setMemberLevel(0); setMemberCount(c => Math.max(0, c - 1));
      showMessage({ message: 'Left room membership', type: 'info' });
    } catch {} finally { setLeavingMember(false); }
  }, [id, leavingMember]);

  const handleUpgradeMemberLevel = useCallback(async (targetUserId: string, level: number) => {
    try {
      await api.patch(/voice//members//upgrade, { memberLevel: level });
      const meta = MEMBER_LEVEL_META[level];
      showMessage({ message: ${meta?.emoji} Member upgraded to , type: 'success' });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    }
  }, [id]);

  const handleUpgradeRoomLevel = useCallback(async (level: number) => {
    try {
      await api.patch(/voice//members/room-level, { level });
      queryClient.setQueryData<any>(['voice-room', id], (old: any) =>
        old ? { ...old, roomLevel: level } : old
      );
      showMessage({ message: 🎉 Room upgraded to Level ! Max  members, type: 'success' });
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
      await api.patch(`/voice/${id}`, { reactionsEnabled: newVal });
      await api.patch(/voice/, { reactionsEnabled: newVal });
      queryClient.setQueryData<any>(['voice-room', id], (old: any) => old ? { ...old, reactionsEnabled: newVal } : old);
      showMessage({ message: newVal ? '🌹 Reactions enabled' : '🚫 Reactions disabled', type: 'info' });
    } catch {}
  }, [id, room, queryClient]);

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
  const canSendGifts  = isJoined && participants.some(p => ['HOST','MODERATOR','SPEAKER'].includes(p.role));
  const speakers      = participants.filter(p => ['HOST','MODERATOR','SPEAKER'].includes(p.role));
  const audience      = participants.filter(p => p.role === 'AUDIENCE');

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: room.name, headerTintColor: '#4f46e5', headerStyle: { backgroundColor: '#0f0f23' }, headerTitleStyle: { color: '#fff' } }} />

      {/* Gift fly-in animation */}
      {animGift && (
        <GiftAnimOverlay
          gift={animGift.gift}
          senderName={animGift.senderName}
          onDone={() => setAnimGift(null)}
        />
      )}

      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        {/* Room header */}
        <View style={styles.roomHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.roomName} numberOfLines={1}>{room.name}</Text>
            {room.topic ? <Text style={styles.roomTopic} numberOfLines={1}>{room.topic}</Text> : null}
          </View>
          <View style={styles.roomHeaderRight}>
            {room.isLive && <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>}
            <TouchableOpacity style={styles.leaderBtn} onPress={() => setShowLeaderboard(true)}>
              <Text style={{ fontSize: 16 }}>🏆</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.leaderBtn} onPress={() => router.push('/voice/stats' as any)}>
              <Ionicons name="bar-chart-outline" size={16} color="#a5b4fc" />
            </TouchableOpacity>
            {/* Room Level badge */}
            <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: '#7c3aed22', borderWidth: 1, borderColor: '#7c3aed44', marginRight: 4 }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: '#a5b4fc' }}>Lv{room.roomLevel ?? 1}</Text>
            </View>
            {/* Auto-member badge — no join button needed, membership is automatic */}
            {isJoined && isMember && (
              <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: '#22c55e22', borderWidth: 1, borderColor: '#22c55e44', marginRight: 4 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: '#22c55e' }}>
                  {MEMBER_LEVEL_META[memberLevel]?.emoji ?? '⭐'} Member
                </Text>
              </View>
            )}
            {isJoined && !isMember && memberCount >= (ROOM_LEVEL_CAPACITY[room?.roomLevel ?? 1] ?? 500) && (
              <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: '#37415122', borderWidth: 1, borderColor: '#37415144', marginRight: 4 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: '#9ca3af' }}>🔒 Full</Text>
              </View>
            )}
              <Ionicons name="ellipsis-vertical" size={18} color="#a5b4fc" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Persistent music indicator — shown when BgMusicPanel is playing */}
        {bgMusicTrack && (
          <TouchableOpacity
            style={styles.musicBar}
            onPress={() => setShowBgMusic(true)}
            activeOpacity={0.85}
          >
            <View style={styles.musicBarLeft}>
              <Text style={{ fontSize: 14 }}>{bgMusicTrack.isDeviceFile ? '📱' : '🎵'}</Text>
              <Text style={styles.musicBarTitle} numberOfLines={1}>{bgMusicTrack.title}</Text>
            </View>
            <View style={styles.musicBarRight}>
              {bgMusicPlaying
                ? <><View style={styles.musicBarDot} /><Text style={styles.musicBarStatus}>Playing</Text></>
                : <Text style={styles.musicBarStatus}>Paused</Text>
              }
              <Ionicons name="chevron-forward" size={12} color="#4ade80" />
            </View>
          </TouchableOpacity>
        )}

        {/* Tabs: Speakers / Chat */}
        <View style={styles.tabs}>
          <TouchableOpacity style={[styles.tab, !showChat && styles.tabActive]} onPress={() => setShowChat(false)}>
            <Ionicons name="people-outline" size={14} color={!showChat ? '#a5b4fc' : '#6b7280'} />
            <Text style={[styles.tabText, !showChat && styles.tabTextActive]}>Room ({participants.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, showChat && styles.tabActive]} onPress={() => setShowChat(true)}>
            <Ionicons name="chatbubbles-outline" size={14} color={showChat ? '#a5b4fc' : '#6b7280'} />
            <Text style={[styles.tabText, showChat && styles.tabTextActive]}>Chat</Text>
            {chatMessages.length > 0 && <View style={styles.chatBadge}><Text style={styles.chatBadgeText}>{chatMessages.length > 99 ? '99+' : chatMessages.length}</Text></View>}
          </TouchableOpacity>
        </View>

        {!showChat ? (
          /* Participants view */
          <FlatList
            data={[...speakers, ...audience]}
            numColumns={3}
            keyExtractor={p => p.id}
            renderItem={({ item }) => {
              // Calculate queue position for raised-hand audience members
              const raisedAudience = audience.filter(p => p.handRaised);
              const queuePos = item.role === 'AUDIENCE' && item.handRaised
                ? raisedAudience.findIndex(p => p.id === item.id) + 1
                : undefined;
              return <ParticipantTile participant={item} queuePosition={queuePos} />;
            }}
            contentContainerStyle={styles.grid}
            style={{ flex: 1 }}
            ListEmptyComponent={<Text style={styles.emptyText}>{isJoined ? 'Waiting for participants…' : 'Join to see participants'}</Text>}
            ListHeaderComponent={speakers.length > 0 && audience.length > 0 ? (
              <Text style={styles.gridSectionLabel}>🎙 On Stage ({speakers.length})</Text>
            ) : null}
          />
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

        {/* Controls bar */}
        <View style={styles.controls}>
          {!isJoined ? (
            <TouchableOpacity style={styles.joinBtn} onPress={handleJoin} disabled={isConnecting}>
              {isConnecting ? <ActivityIndicator color="#fff" /> : <><Ionicons name="headset" size={20} color="#fff" /><Text style={styles.joinBtnText}>Join Room</Text></>}
            </TouchableOpacity>
          ) : (
            <>
              {/* Hand raise */}
              {/* Hand raise — disabled when mic is locked */}
              <TouchableOpacity
                style={[styles.ctrlBtn, handRaised && styles.ctrlBtnActive, room?.micLocked ? { opacity: 0.4 } : {}]}
                onPress={toggleHand}
                disabled={room?.micLocked ?? false}
                accessibilityLabel={room?.micLocked ? 'Mic locked by host' : handRaised ? 'Lower hand' : 'Raise hand'}
                accessibilityRole="button"
              >
                <Text style={{ fontSize: 20 }}>{room?.micLocked ? '🔒' : '✋'}</Text>
                <Text style={styles.ctrlLabel}>{room?.micLocked ? 'Locked' : handRaised ? 'Lower' : 'Raise'}</Text>
              </TouchableOpacity>

              {/* Mic */}
              <TouchableOpacity
                style={[styles.ctrlBtn, !isMuted && styles.ctrlBtnActive]}
                onPress={toggleMic}
                accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                accessibilityRole="button"
              >
                <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={22} color={isMuted ? '#6b7280' : '#4f46e5'} />
                <Text style={styles.ctrlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
              </TouchableOpacity>

              {/* 🎁 Gift button — only shown when speakers are on stage */}
              {canSendGifts && (
                <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnGift]} onPress={() => setShowGiftPanel(true)}>
                  <Text style={{ fontSize: 22 }}>🎁</Text>
                  <Text style={[styles.ctrlLabel, { color: '#f59e0b' }]}>Gift</Text>
                </TouchableOpacity>
              )}

              {/* Host controls button */}
              {canModerate && (
                <TouchableOpacity style={[styles.ctrlBtn, showHostControls && styles.ctrlBtnActive]}
                  onPress={() => setShowHostControls(true)}>
                  <Ionicons name="shield-outline" size={22} color={showHostControls ? '#4f46e5' : '#6b7280'} />
                  <Text style={styles.ctrlLabel}>Host</Text>
                </TouchableOpacity>
              )}

              {/* Leave */}
              <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnDanger]} onPress={handleLeave}>
                <Ionicons name="exit-outline" size={22} color="#ef4444" />
                <Text style={[styles.ctrlLabel, { color: '#ef4444' }]}>Leave</Text>
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
            ...(isHost ? [{ icon: '⚙️', label: 'Room Settings', onPress: () => { setShowDotMenu(false); setShowRoomSettings(true); } }] : []),
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

      {/* ── Room Settings Modal (host only) ─────────────────────── */}
      <Modal
        visible={showRoomSettings}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowRoomSettings(false)}
        onShow={() => {
          // Seed form fields from current room data when modal opens
          setSettingsTitle(room?.name ?? room?.title ?? '');
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

            {/* Privacy */}
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

          {/* Quick actions */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
            <TouchableOpacity style={{ flex: 1, minWidth: '45%', backgroundColor: '#f59e0b22', borderWidth: 1, borderColor: '#f59e0b44', borderRadius: 12, padding: 12, alignItems: 'center', gap: 6 }}
              onPress={() => handleMuteAll()}>
              <Ionicons name="mic-off" size={22} color="#f59e0b" />
              <Text style={{ color: '#f59e0b', fontSize: 12, fontWeight: '600' }}>Mute All</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1, minWidth: '45%', backgroundColor: '#10b98122', borderWidth: 1, borderColor: '#10b98144', borderRadius: 12, padding: 12, alignItems: 'center', gap: 6 }}
              onPress={handleApproveQueue}>
              <Ionicons name="checkmark-circle" size={22} color="#10b981" />
              <Text style={{ color: '#10b981', fontSize: 12, fontWeight: '600' }}>Approve Hand</Text>
            </TouchableOpacity>
            {/* Open Mic toggle */}
            <TouchableOpacity style={{ flex: 1, minWidth: '45%', backgroundColor: room?.isOpenMic ? '#6366f122' : '#1e1e3a', borderWidth: 1, borderColor: room?.isOpenMic ? '#6366f155' : '#374151', borderRadius: 12, padding: 12, alignItems: 'center', gap: 6 }}
              onPress={handleToggleOpenMic}>
              <Ionicons name="mic" size={22} color={room?.isOpenMic ? '#6366f1' : '#6b7280'} />
              <Text style={{ color: room?.isOpenMic ? '#6366f1' : '#6b7280', fontSize: 12, fontWeight: '600' }}>
                {room?.isOpenMic ? 'Open Mic ON' : 'Open Mic'}
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
              onPress={() => api.patch(/voice/, { slowMode: !(room?.slowMode ?? false) }).then(() => queryClient.setQueryData<any>(['voice-room', id], (old: any) => old ? { ...old, slowMode: !(room?.slowMode ?? false) } : old)).catch(() => {})}>
              <Ionicons name='timer-outline' size={22} color={(room?.slowMode ?? false) ? '#ef4444' : '#6b7280'} />
              <Text style={{ color: (room?.slowMode ?? false) ? '#ef4444' : '#6b7280', fontSize: 12, fontWeight: '600' }}>
                {(room?.slowMode ?? false) ? '⏱ Slow Mode ON' : '⏱ Slow Mode'}
              </Text>
            </TouchableOpacity>
            {/* Message type: all / followers / none */}
            <TouchableOpacity style={{ flex: 1, minWidth: '45%', backgroundColor: '#1e1e3a', borderWidth: 1, borderColor: '#374151', borderRadius: 12, padding: 12, alignItems: 'center', gap: 6 }}
              onPress={() => { const types = ['all','followers','none']; const next = types[(types.indexOf(room?.messageType ?? 'all') + 1) % 3]; api.patch(/voice/, { messageType: next }).then(() => queryClient.setQueryData<any>(['voice-room', id], (old: any) => old ? { ...old, messageType: next } : old)).catch(() => {}); }}>
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
                    Upgrade to Level ?,
                    Max members: ,
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
              <TouchableOpacity style={{ flex: 1, minWidth: '45%', backgroundColor: '#ef444422', borderWidth: 1, borderColor: '#ef444444', borderRadius: 12, padding: 12, alignItems: 'center', gap: 6 }}
                onPress={() => { setShowHostControls(false); handleEndRoom(); }}>
                <Ionicons name="stop-circle" size={22} color="#ef4444" />
                <Text style={{ color: '#ef4444', fontSize: 12, fontWeight: '600' }}>End Room</Text>
              </TouchableOpacity>
            )}
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
                          <Ionicons name="shield-outline" size={16} color="#6b7280" />
                        </TouchableOpacity>
                      )}
                      {/* Transfer Host (HOST only) */}
                      {myRole === 'HOST' && (
                        <TouchableOpacity style={{ padding: 7, backgroundColor: '#f59e0b22', borderRadius: 8 }}
                          onPress={() => { setShowHostControls(false); handleTransferHost(p.id, p.name); }}>
                          <Text style={{ fontSize: 14 }}>👑</Text>
                        </TouchableOpacity>
                      )}
                      {/* Pin Speaker — HOST and MOD can pin any speaker/mod */}
                      {(p.role === 'SPEAKER' || p.role === 'MODERATOR' || p.role === 'HOST') && !isMe && (
                        <TouchableOpacity style={{ padding: 7, backgroundColor: '#0ea5e922', borderRadius: 8 }}
                          onPress={() => handlePinSpeaker(p.id)}
                          title="Pin to stage">
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
    </>
  );
}

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
