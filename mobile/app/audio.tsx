/**
 * HALQA Mobile — Audio Lessons
 * Browse Islamic audio lessons by category/course with built-in player.
 * Teachers/Admins can upload audio directly from their phone.
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView,
  TextInput, ActivityIndicator, RefreshControl, Modal,
  Alert, Platform} from 'react-native';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio as ExpoAudio } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Category { id: string; name: string; slug: string; _count?: { lessons: number } }
interface Course   { id: string; title: string; category: Category }
interface Lesson {
  id: string; title: string; description?: string; audioUrl: string;
  duration?: number; fileSize: number; playCount: number;
  course: Course; category: Category;
  teacher: { user: { id: string; firstName: string; lastName: string } };
  createdAt: string;
}

// ─── Category slug → color ────────────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  tafsiira: '#10b981', riyaada: '#3b82f6', tawhiid: '#8b5cf6',
  usool: '#f97316', buluga: '#f43f5e', tajwiid: '#14b8a6',
  arbina: '#f59e0b',
};
function catCol(slug: string) { return CAT_COLORS[slug] ?? '#6366f1'; }

// ─── Duration formatter ───────────────────────────────────────────────────────
function fmtDur(s?: number) {
  if (!s) return '--:--';
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
}
function fmtSize(b: number) {
  if (b < 1_048_576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1_048_576).toFixed(1)} MB`;
}

// ─── Mini Player Bar ──────────────────────────────────────────────────────────
function PlayerBar({
  lesson, sound, isPlaying, position, duration, speed,
  onToggle, onNext, onPrev, onClose, onSpeedCycle,
}: {
  lesson: Lesson; sound: ExpoAudio.Sound | null;
  isPlaying: boolean; position: number; duration: number; speed: number;
  onToggle: () => void; onNext: () => void; onPrev: () => void;
  onClose: () => void; onSpeedCycle: () => void;
}) {
  const pct = duration > 0 ? position / duration : 0;
  return (
    <View style={pb.container}>
      {/* Progress bar */}
      <View style={pb.progressBg}>
        <View style={[pb.progressFill, { width: `${pct * 100}%` }]} />
      </View>
      <View style={pb.inner}>
        {/* Track info */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={pb.title} numberOfLines={1}>{lesson.title}</Text>
          <Text style={pb.sub} numberOfLines={1}>
            {lesson.teacher?.user?.firstName} · {lesson.category?.name}
          </Text>
          <Text style={pb.time}>{fmtDur(position)} / {fmtDur(duration || lesson.duration)}</Text>
        </View>
        {/* Controls */}
        <View style={pb.controls}>
          <TouchableOpacity onPress={onPrev} style={pb.ctrlBtn}>
            <Ionicons name="play-skip-back" size={18} color="#c4b5fd" />
          </TouchableOpacity>
          <TouchableOpacity onPress={onToggle} style={pb.playBtn}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={20} color="#fff" style={{ marginLeft: isPlaying ? 0 : 2 }} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onNext} style={pb.ctrlBtn}>
            <Ionicons name="play-skip-forward" size={18} color="#c4b5fd" />
          </TouchableOpacity>
          <TouchableOpacity onPress={onSpeedCycle} style={pb.speedBtn}>
            <Text style={pb.speedTxt}>{speed}x</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={pb.ctrlBtn}>
            <Ionicons name="close" size={18} color="#c4b5fd" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const pb = StyleSheet.create({
  container:    { backgroundColor: '#1e1b4b', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  progressBg:   { height: 3, backgroundColor: '#3730a3', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  progressFill: { height: 3, backgroundColor: '#a5b4fc', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  inner:        { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  title:        { color: '#e0e7ff', fontSize: 13, fontWeight: '700' },
  sub:          { color: '#a5b4fc', fontSize: 10, marginTop: 1 },
  time:         { color: '#6d7fb5', fontSize: 10, marginTop: 1 },
  controls:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ctrlBtn:      { padding: 6 },
  playBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center' },
  speedBtn:     { backgroundColor: '#312e81', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  speedTxt:     { color: '#a5b4fc', fontSize: 11, fontWeight: '800' },
});

// ─── Lesson Row ───────────────────────────────────────────────────────────────
function LessonRow({ lesson, isPlaying, onPlay, canEdit, onDelete }: {
  lesson: Lesson; isPlaying: boolean;
  onPlay: () => void; canEdit: boolean; onDelete: () => void;
}) {
  const col = catCol(lesson.category?.slug);
  return (
    <TouchableOpacity
      style={[lr.row, isPlaying && { borderColor: col, borderWidth: 1.5, backgroundColor: col + '10' }]}
      onPress={onPlay}
      activeOpacity={0.8}
    >
      <View style={[lr.playCircle, isPlaying && { backgroundColor: col }]}>
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={16} color={isPlaying ? '#fff' : col} style={{ marginLeft: isPlaying ? 0 : 2 }} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[lr.title, isPlaying && { color: col }]} numberOfLines={1}>{lesson.title}</Text>
        <View style={lr.meta}>
          <Text style={lr.metaTxt}>{fmtDur(lesson.duration)}</Text>
          <Text style={lr.metaTxt}>·</Text>
          <Text style={lr.metaTxt}>{fmtSize(lesson.fileSize)}</Text>
          <View style={[lr.catBadge, { backgroundColor: col + '18' }]}>
            <Text style={[lr.catTxt, { color: col }]}>{lesson.category?.name}</Text>
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <Text style={lr.plays}>{lesson.playCount} ▶</Text>
        {canEdit && (
          <TouchableOpacity style={lr.deleteBtn} onPress={onDelete}>
            <Ionicons name="trash-outline" size={14} color="#ef4444" />
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const lr = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#f1f5f9' },
  playCircle:{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  title:     { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  meta:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, flexWrap: 'wrap' },
  metaTxt:   { fontSize: 10, color: '#94a3b8' },
  catBadge:  { borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  catTxt:    { fontSize: 9, fontWeight: '700' },
  plays:     { fontSize: 10, color: '#94a3b8' },
  deleteBtn: { width: 26, height: 26, borderRadius: 6, backgroundColor: '#fef2f2', justifyContent: 'center', alignItems: 'center' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

// ─── Upload Tab Component ─────────────────────────────────────────────────────
function UploadTab() {
  const queryClient = useQueryClient();
  const [title,       setTitle]       = useState('');
  const [description, setDescription] = useState('');
  const [courseId,    setCourseId]    = useState('');
  const [categoryId,  setCategoryId]  = useState('');
  const [pickedFile,  setPickedFile]  = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [uploading,   setUploading]   = useState(false);
  const [progress,    setProgress]    = useState(0);

  // Fetch categories + courses for selectors
  const { data: categories = [] } = useQuery<any[]>({
    queryKey: ['audio-categories'],
    queryFn: () => api.get('/audio/categories').then(r => r.data.data ?? []),
    staleTime: 5 * 60_000,
  });
  const { data: courses = [] } = useQuery<any[]>({
    queryKey: ['audio-courses', ''],
    queryFn: () => api.get('/audio/courses', { params: { limit: 100 } }).then(r => r.data.data ?? []),
    staleTime: 5 * 60_000,
  });

  const pickAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/*', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      // Validate size — max 50 MB
      if (asset.size && asset.size > 50 * 1024 * 1024) {
        showMessage({ message: 'File too large — max 50 MB', type: 'warning' });
        return;
      }
      setPickedFile(asset);
      // Auto-fill title from filename (strip extension)
      if (!title) {
        const name = asset.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
        setTitle(name);
      }
    } catch {
      showMessage({ message: 'Could not open file picker', type: 'danger' });
    }
  };

  const handleUpload = async () => {
    if (!pickedFile) { showMessage({ message: 'Pick an audio file first', type: 'warning' }); return; }
    if (!title.trim()) { showMessage({ message: 'Enter a lesson title', type: 'warning' }); return; }
    if (!courseId) { showMessage({ message: 'Select a course', type: 'warning' }); return; }

    setUploading(true);
    setProgress(0);
    try {
      // Use FileSystem.uploadAsync for multipart upload with progress tracking
      const baseUrl = api.defaults.baseURL ?? '';
      const token   = (await import('@/store/auth.store')).useAuthStore.getState().accessToken ?? '';
      const url     = `${baseUrl}/audio/lessons`;

      const uploadResult = await FileSystem.uploadAsync(url, pickedFile.uri, {
        httpMethod: 'POST',
        uploadType: 1 as any, // MULTIPART = 1 in expo-file-system
        fieldName: 'audio',
        headers: { Authorization: `Bearer ${token}` },
        parameters: {
          title: title.trim(),
          description: description.trim(),
          courseId,
          ...(categoryId ? { categoryId } : {}),
        },
        mimeType: pickedFile.mimeType ?? 'audio/mpeg',
      });

      if (uploadResult.status >= 200 && uploadResult.status < 300) {
        showMessage({ message: '🎵 Lesson uploaded successfully!', type: 'success' });
        queryClient.invalidateQueries({ queryKey: ['audio-lessons'] });
        // Reset form
        setTitle('');
        setDescription('');
        setCourseId('');
        setCategoryId('');
        setPickedFile(null);
        setProgress(0);
      } else {
        let errMsg = 'Upload failed';
        try { errMsg = JSON.parse(uploadResult.body)?.message ?? errMsg; } catch {}
        showMessage({ message: errMsg, type: 'danger' });
      }
    } catch (e: any) {
      showMessage({ message: e?.message ?? 'Upload failed', type: 'danger' });
    } finally {
      setUploading(false);
    }
  };

  const fmtSize = (b?: number) => {
    if (!b) return '';
    if (b < 1_048_576) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / 1_048_576).toFixed(1)} MB`;
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={up.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Pick file zone */}
        <TouchableOpacity style={[up.dropZone, pickedFile && up.dropZoneActive]} onPress={pickAudio} activeOpacity={0.8}>
          {pickedFile ? (
            <View style={up.fileInfo}>
              <View style={up.fileIconWrap}>
                <Ionicons name="musical-notes" size={28} color="#4f46e5" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={up.fileName} numberOfLines={1}>{pickedFile.name}</Text>
                <Text style={up.fileMeta}>{fmtSize(pickedFile.size)} · {pickedFile.mimeType ?? 'audio'}</Text>
              </View>
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation(); setPickedFile(null); }}
                style={up.clearBtn}
              >
                <Ionicons name="close-circle" size={20} color="#94a3b8" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={up.dropInner}>
              <View style={up.dropIconCircle}>
                <Ionicons name="cloud-upload-outline" size={36} color="#4f46e5" />
              </View>
              <Text style={up.dropTitle}>Tap to pick an audio file</Text>
              <Text style={up.dropSub}>MP3 · WAV · OGG · M4A · AAC  ·  Max 50 MB</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Title */}
        <View style={up.fieldGroup}>
          <Text style={up.label}>Lesson Title *</Text>
          <TextInput
            style={up.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Introduction to Tajwiid Rules"
            placeholderTextColor="#9ca3af"
            allowFontScaling={false}
          />
        </View>

        {/* Description */}
        <View style={up.fieldGroup}>
          <Text style={up.label}>Description</Text>
          <TextInput
            style={[up.input, { height: 80, textAlignVertical: 'top', paddingTop: 10 }]}
            value={description}
            onChangeText={setDescription}
            placeholder="Brief description of this lesson…"
            placeholderTextColor="#9ca3af"
            multiline
            allowFontScaling={false}
          />
        </View>

        {/* Course selector */}
        <View style={up.fieldGroup}>
          <Text style={up.label}>Course *</Text>
          {courses.length === 0 ? (
            <View style={up.emptyPicker}>
              <Ionicons name="alert-circle-outline" size={16} color="#f59e0b" />
              <Text style={up.emptyPickerTxt}>No courses yet — ask an admin to create one</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {courses.map((c: any) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[up.selectorChip, courseId === c.id && up.selectorChipActive]}
                    onPress={() => setCourseId(courseId === c.id ? '' : c.id)}
                  >
                    <Text style={[up.selectorChipTxt, courseId === c.id && up.selectorChipTxtActive]} numberOfLines={1}>
                      {c.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          )}
        </View>

        {/* Category selector (optional) */}
        <View style={up.fieldGroup}>
          <Text style={up.label}>Category <Text style={up.labelOptional}>(optional — auto from course)</Text></Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TouchableOpacity
                style={[up.selectorChip, !categoryId && up.selectorChipActive]}
                onPress={() => setCategoryId('')}
              >
                <Text style={[up.selectorChipTxt, !categoryId && up.selectorChipTxtActive]}>Auto</Text>
              </TouchableOpacity>
              {categories.map((c: any) => (
                <TouchableOpacity
                  key={c.id}
                  style={[up.selectorChip, categoryId === c.id && up.selectorChipActive]}
                  onPress={() => setCategoryId(categoryId === c.id ? '' : c.id)}
                >
                  <Text style={[up.selectorChipTxt, categoryId === c.id && up.selectorChipTxtActive]}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Upload progress bar */}
        {uploading && (
          <View style={up.progressWrap}>
            <View style={up.progressBar}>
              <View style={[up.progressFill, { width: `${progress}%` as any }]} />
            </View>
            <Text style={up.progressTxt}>Uploading…</Text>
          </View>
        )}

        {/* Upload button */}
        <TouchableOpacity
          style={[up.uploadBtn, (!pickedFile || !title.trim() || !courseId || uploading) && up.uploadBtnDisabled]}
          onPress={handleUpload}
          disabled={!pickedFile || !title.trim() || !courseId || uploading}
          activeOpacity={0.8}
        >
          {uploading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
              <Text style={up.uploadBtnTxt}>Upload Lesson</Text>
            </>
          )}
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const up = StyleSheet.create({
  scroll:              { padding: 16, gap: 16, paddingBottom: 40 },
  dropZone:            { borderWidth: 2, borderStyle: 'dashed', borderColor: '#c7d2fe', borderRadius: 16, backgroundColor: '#fafafa', minHeight: 120, justifyContent: 'center', alignItems: 'center' },
  dropZoneActive:      { borderColor: '#4f46e5', backgroundColor: '#eff6ff', borderStyle: 'solid' },
  dropInner:           { alignItems: 'center', gap: 8, padding: 24 },
  dropIconCircle:      { width: 64, height: 64, borderRadius: 32, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center' },
  dropTitle:           { fontSize: 15, fontWeight: '700', color: '#374151' },
  dropSub:             { fontSize: 12, color: '#94a3b8', textAlign: 'center' },
  fileInfo:            { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, width: '100%' },
  fileIconWrap:        { width: 48, height: 48, borderRadius: 12, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  fileName:            { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  fileMeta:            { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  clearBtn:            { padding: 4 },
  fieldGroup:          { gap: 4 },
  label:               { fontSize: 12, fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4 },
  labelOptional:       { fontSize: 11, fontWeight: '500', color: '#94a3b8', textTransform: 'none', letterSpacing: 0 },
  input:               { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#1e293b' },
  emptyPicker:         { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, backgroundColor: '#fffbeb', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#fde68a' },
  emptyPickerTxt:      { fontSize: 12, color: '#92400e', flex: 1 },
  selectorChip:        { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: 'transparent' },
  selectorChipActive:  { backgroundColor: '#ede9fe', borderColor: '#4f46e5' },
  selectorChipTxt:     { fontSize: 12, fontWeight: '600', color: '#6b7280', maxWidth: 120 },
  selectorChipTxtActive: { color: '#4f46e5' },
  progressWrap:        { gap: 6 },
  progressBar:         { height: 6, backgroundColor: '#e2e8f0', borderRadius: 3, overflow: 'hidden' },
  progressFill:        { height: '100%', backgroundColor: '#4f46e5', borderRadius: 3 },
  progressTxt:         { fontSize: 12, color: '#6b7280', textAlign: 'center' },
  uploadBtn:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#4f46e5', borderRadius: 14, paddingVertical: 15 },
  uploadBtnDisabled:   { backgroundColor: '#c7d2fe' },
  uploadBtnTxt:        { color: '#fff', fontSize: 15, fontWeight: '800' },
});

export default function AudioScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  // SA-EDU-04: SUPER_ADMIN is a platform role — not a school-scoped teacher/admin.
  // Audio upload belongs to SCHOOL_ADMIN and TEACHER (school membership roles).
  // Edit/delete of a lesson is only allowed for the teacher who created it.
  const canUpload = ['SCHOOL_ADMIN', 'TEACHER'].includes(user?.role ?? '');

  const [activeTab, setActiveTab] = useState<'browse' | 'upload'>('browse');
  const [search, setSearch]         = useState('');
  const [catFilter, setCatFilter]   = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [speedIdx, setSpeedIdx]     = useState(1);

  // Player state
  const soundRef   = useRef<ExpoAudio.Sound | null>(null);
  const [nowPlaying,  setNowPlaying]  = useState<Lesson | null>(null);
  const [playlist,    setPlaylist]    = useState<Lesson[]>([]);
  const [playIdx,     setPlayIdx]     = useState(0);
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [position,    setPosition]    = useState(0);
  const [duration,    setDuration]    = useState(0);

  // Queries
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['audio-categories'],
    queryFn: () => api.get('/audio/categories').then(r => r.data.data ?? []),
    staleTime: 5 * 60_000,
  });

  const { data: courses = [] } = useQuery<Course[]>({
    queryKey: ['audio-courses', catFilter],
    queryFn: () => api.get('/audio/courses', {
      params: { categoryId: catFilter || undefined, limit: 100 }
    }).then(r => r.data.data ?? []),
  });

  const { data: lessons = [], isLoading, refetch } = useQuery<Lesson[]>({
    queryKey: ['audio-lessons', catFilter, courseFilter, search],
    queryFn: () => api.get('/audio/lessons', {
      params: {
        categoryId: catFilter || undefined,
        courseId: courseFilter || undefined,
        search: search || undefined,
        limit: 200,
      }
    }).then(r => r.data.data ?? []),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/audio/lessons/${id}`),
    onSuccess: () => {
      showMessage({ message: 'Lesson deleted', type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['audio-lessons'] });
      if (nowPlaying) setNowPlaying(null);
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }),
  });

  // Play a lesson
  const playLesson = useCallback(async (lesson: Lesson, list?: Lesson[]) => {
    const pl = list ?? lessons;
    const idx = pl.findIndex(l => l.id === lesson.id);
    setPlaylist(pl);
    setPlayIdx(idx >= 0 ? idx : 0);
    setNowPlaying(lesson);
    setPosition(0);
    setDuration(0);

    // Unload previous
    if (soundRef.current) {
      try { await soundRef.current.unloadAsync(); } catch {}
      soundRef.current = null;
    }

    // Configure audio session (iOS silent mode, background audio)
    try {
      await ExpoAudio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch {}

    try {
      // Build audio URL robustly
      const base = (api.defaults.baseURL ?? '')
        .replace(/\/api\/v\d+\/?$/, '')
        .replace(/\/api\/?$/, '');
      const url = lesson.audioUrl.startsWith('http') ? lesson.audioUrl : `${base}${lesson.audioUrl.startsWith('/') ? '' : '/'}${lesson.audioUrl}`;

      const { sound, status } = await ExpoAudio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true, rate: SPEEDS[speedIdx], progressUpdateIntervalMillis: 800 },
        (s) => {
          if (!s.isLoaded) return;
          setPosition(Math.floor((s.positionMillis ?? 0) / 1000));
          setDuration(Math.floor((s.durationMillis ?? 0) / 1000));
          setIsPlaying(s.isPlaying ?? false);
          if (s.didJustFinish) {
            // auto-advance to next lesson
            setPlayIdx(prev => {
              const next = prev + 1;
              if (next < pl.length) {
                setNowPlaying(pl[next]);
                playLesson(pl[next], pl);
                return next;
              }
              return prev;
            });
          }
        }
      );
      soundRef.current = sound;
      if (status.isLoaded && status.isPlaying) setIsPlaying(true);
    } catch (e: any) {
      showMessage({ message: e?.message ?? 'Failed to load audio', type: 'danger' });
      setNowPlaying(null);
      setIsPlaying(false);
    }
  }, [lessons, speedIdx]);

  const handleToggle = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;
    try {
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) await sound.pauseAsync();
      else await sound.playAsync();
    } catch {}
  }, []);

  const handleNext = useCallback(() => {
    const next = playIdx + 1;
    if (next < playlist.length) {
      setPlayIdx(next);
      playLesson(playlist[next], playlist);
    }
  }, [playIdx, playlist, playLesson]);

  const handlePrev = useCallback(() => {
    const prev = playIdx - 1;
    if (prev >= 0) {
      setPlayIdx(prev);
      playLesson(playlist[prev], playlist);
    }
  }, [playIdx, playlist, playLesson]);

  const handleClose = useCallback(async () => {
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
  }, []);

  const handleSpeedCycle = useCallback(async () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (soundRef.current) {
      try { await soundRef.current.setRateAsync(SPEEDS[next], true); } catch {}
    }
  }, [speedIdx]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { soundRef.current?.unloadAsync(); };
  }, []);

  // Group lessons by course
  const lessonsByCourse = lessons.reduce<Record<string, { courseTitle: string; lessons: Lesson[] }>>((acc, l) => {
    const key = l.course?.id ?? 'none';
    if (!acc[key]) acc[key] = { courseTitle: l.course?.title ?? 'Uncategorized', lessons: [] };
    acc[key].lessons.push(l);
    return acc;
  }, {});

  const playerH = nowPlaying ? 90 : 0;

  return (
    <>
      <Stack.Screen options={{
        headerShown: true, title: 'Audio Lessons',
        headerTintColor: '#4f46e5',
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { color: '#111827', fontWeight: '800' },
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={22} color="#4f46e5" />
          </TouchableOpacity>
        ),
        headerRight: canUpload ? () => (
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4, backgroundColor: activeTab === 'upload' ? '#ede9fe' : '#f1f5f9', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 }}
            onPress={() => setActiveTab(t => t === 'browse' ? 'upload' : 'browse')}
          >
            <Ionicons name={activeTab === 'upload' ? 'list-outline' : 'cloud-upload-outline'} size={15} color="#4f46e5" />
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#4f46e5' }}>
              {activeTab === 'upload' ? 'Browse' : 'Upload'}
            </Text>
          </TouchableOpacity>
        ) : undefined,
      }} />
      <SafeAreaView style={a.container} edges={['bottom']}>

        {activeTab === 'upload' ? (
          <UploadTab />
        ) : (
          <>
            {/* Search */}
            <View style={a.searchRow}>
              <Ionicons name="search-outline" size={16} color="#9ca3af" />
              <TextInput
                value={search} onChangeText={setSearch}
                placeholder="Search lessons…" placeholderTextColor="#9ca3af"
                style={a.searchInput} allowFontScaling={false}
              />
              {search ? <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={16} color="#9ca3af" /></TouchableOpacity> : null}
            </View>

        {/* Category chips */}
        <View style={{ backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={a.catRow}>
            <TouchableOpacity style={[a.catChip, !catFilter && a.catChipActive]} onPress={() => { setCatFilter(''); setCourseFilter(''); }}>
              <Text style={[a.catChipTxt, !catFilter && a.catChipTxtActive]}>All</Text>
            </TouchableOpacity>
            {categories.map(c => {
              const col = catCol(c.slug);
              const active = catFilter === c.id;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[a.catChip, active && { backgroundColor: col + '20', borderColor: col }]}
                  onPress={() => { setCatFilter(catFilter === c.id ? '' : c.id); setCourseFilter(''); }}
                >
                  <Text style={[a.catChipTxt, active && { color: col }]}>
                    {c.name}{c._count?.lessons ? ` (${c._count.lessons})` : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Course filter (shown only when category selected and courses exist) */}
        {catFilter && courses.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[a.catRow, { backgroundColor: '#fafafa' }]}>
            <TouchableOpacity style={[a.catChip, !courseFilter && a.catChipActive]} onPress={() => setCourseFilter('')}>
              <Text style={[a.catChipTxt, !courseFilter && a.catChipTxtActive]}>All Courses</Text>
            </TouchableOpacity>
            {courses.map(c => (
              <TouchableOpacity
                key={c.id}
                style={[a.catChip, courseFilter === c.id && a.catChipActive]}
                onPress={() => setCourseFilter(courseFilter === c.id ? '' : c.id)}
              >
                <Text style={[a.catChipTxt, courseFilter === c.id && a.catChipTxtActive]}>{c.title}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Lesson list */}
        {isLoading ? (
          <View style={a.center}><ActivityIndicator size="large" color="#4f46e5" /></View>
        ) : (
          <FlatList
            data={Object.entries(lessonsByCourse)}
            keyExtractor={([k]) => k}
            contentContainerStyle={{ padding: 12, paddingBottom: playerH + 20 + insets.bottom }}
            refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor="#4f46e5" />}
            renderItem={({ item: [, grp] }) => (
              <View style={{ marginBottom: 16 }}>
                <View style={a.courseHeader}>
                  <Ionicons name="book-outline" size={14} color="#4f46e5" />
                  <Text style={a.courseTitle} numberOfLines={1}>{grp.courseTitle}</Text>
                  <Text style={a.courseCount}>{grp.lessons.length} lesson{grp.lessons.length !== 1 ? 's' : ''}</Text>
                  <TouchableOpacity onPress={() => playLesson(grp.lessons[0], grp.lessons)} style={a.playAllBtn}>
                    <Ionicons name="play" size={12} color="#4f46e5" />
                    <Text style={a.playAllTxt}>Play all</Text>
                  </TouchableOpacity>
                </View>
                {grp.lessons.map(l => (
                  <LessonRow
                    key={l.id}
                    lesson={l}
                    isPlaying={nowPlaying?.id === l.id}
                    onPlay={() => playLesson(l, grp.lessons)}
                    canEdit={canUpload && l.teacher?.user?.id === user?.id}
                    onDelete={() => Alert.alert('Delete Lesson', `Delete "${l.title}"?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(l.id) },
                    ])}
                  />
                ))}
              </View>
            )}
            ListEmptyComponent={
              <View style={a.empty}>
                <Ionicons name="headset-outline" size={48} color="#d1d5db" />
                <Text style={a.emptyTxt}>No audio lessons found</Text>
                {canUpload && <Text style={a.emptySub}>Tap Upload (top right) to add lessons</Text>}
              </View>
            }
          />
        )}

        {/* Mini player — floats above content */}
        {nowPlaying && (
          <View style={{ position: 'absolute', bottom: insets.bottom, left: 0, right: 0 }}>
            <PlayerBar
              lesson={nowPlaying}
              sound={soundRef.current}
              isPlaying={isPlaying}
              position={position}
              duration={duration}
              speed={SPEEDS[speedIdx]}
              onToggle={handleToggle}
              onNext={handleNext}
              onPrev={handlePrev}
              onClose={handleClose}
              onSpeedCycle={handleSpeedCycle}
            />
          </View>
        )}
          </>
        )}
      </SafeAreaView>
    </>
  );
}

const a = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f8fafc' },
  searchRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 9 },
  searchInput:     { flex: 1, fontSize: 14, color: '#1e293b' },
  catRow:          { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  catChip:         { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: 'transparent' },
  catChipActive:   { backgroundColor: '#ede9fe', borderColor: '#7c3aed' },
  catChipTxt:      { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  catChipTxtActive:{ color: '#7c3aed' },
  courseHeader:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  courseTitle:     { flex: 1, fontSize: 13, fontWeight: '700', color: '#374151' },
  courseCount:     { fontSize: 11, color: '#94a3b8' },
  playAllBtn:      { flexDirection: 'row', alignItems: 'center', gap: 3 },
  playAllTxt:      { fontSize: 11, fontWeight: '600', color: '#4f46e5' },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  empty:           { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTxt:        { fontSize: 15, color: '#94a3b8', marginTop: 12 },
  emptySub:        { fontSize: 12, color: '#cbd5e1' },
});





