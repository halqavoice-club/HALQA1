/**
 * HALQA Mobile — Create Live Class Screen
 * Teachers and School Admins only.
 * Supports room type (immediate/scheduled/permanent/limited),
 * native date/time picker, and cover image upload.
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image,
  SafeAreaView, ScrollView, ActivityIndicator, Platform, Switch, Modal} from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { useQuery } from '@tanstack/react-query';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

// Format a date for display
function fmtDateTime(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

type RoomType = 'immediate' | 'scheduled' | 'permanent' | 'limited';

const ROOM_TYPES: Array<{ id: RoomType; label: string; sub: string; icon: string }> = [
  { id: 'immediate', label: 'Immediate',  sub: 'Start class right now',        icon: '▶️' },
  { id: 'scheduled', label: 'Scheduled',  sub: 'Choose a future start time',   icon: '📅' },
  { id: 'permanent', label: 'Permanent',  sub: 'Always open, no auto-end',     icon: '♾️' },
  { id: 'limited',   label: 'Limited',    sub: 'Auto-ends after a duration',   icon: '⏱️' },
];

export default function CreateLiveClassScreen() {
  const router = useRouter();
  const [title,        setTitle]       = useState('');
  const [description,  setDescription] = useState('');
  const [classId,      setClassId]     = useState('');
  const [roomType,     setRoomType]    = useState<RoomType>('immediate');
  const [scheduledAt,  setScheduledAt] = useState<Date | null>(null);
  const [duration,     setDuration]    = useState(60);
  const [chatEnabled,  setChatEnabled] = useState(true);
  const [handRaise,    setHandRaise]   = useState(true);
  const [whiteboard,   setWhiteboard]  = useState(true);
  const [quranPanel,   setQuranPanel]  = useState(false);
  const [screenShare,  setScreenShare] = useState(true);
  const [isRecorded,   setIsRecorded]  = useState(false);
  const [maxSpeakers,  setMaxSpeakers] = useState(20);
  const [loading,      setLoading]     = useState(false);
  // Cover image
  const [coverUri,     setCoverUri]    = useState<string | null>(null);
  const [coverMime,    setCoverMime]   = useState<string>('image/jpeg');

  // iOS date picker modal state
  const [showIOSPicker,  setShowIOSPicker]  = useState(false);
  const [iosPickerMode,  setIosPickerMode]  = useState<'date' | 'time'>('date');
  const [iosTempDate,    setIosTempDate]    = useState<Date>(new Date());

  const { data: classes = [] } = useQuery({
    queryKey: ['my-classes'],
    queryFn: () => api.get('/classes', { params: { limit: 50 } }).then(r => {
      const raw = r.data.data;
      return Array.isArray(raw) ? raw : raw?.items ?? [];
    }),
  });

  // ── Cover image picker ──────────────────────────────────────────────────────
  const pickCoverImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showMessage({ message: 'Photo library permission required', type: 'warning' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });
    if (!result.canceled && result.assets.length > 0) {
      setCoverUri(result.assets[0].uri);
      setCoverMime(result.assets[0].mimeType ?? 'image/jpeg');
    }
  };

  // ── Date/time picker helpers ─────────────────────────────────────────────────
  const openDatePicker = () => {
    const base = scheduledAt ?? new Date(Date.now() + 30 * 60_000);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: base,
        mode: 'date',
        minimumDate: new Date(),
        onChange: (event, selectedDate) => {
          if (event.type === 'dismissed' || !selectedDate) return;
          DateTimePickerAndroid.open({
            value: selectedDate,
            mode: 'time',
            is24Hour: false,
            onChange: (timeEvent, timeDate) => {
              if (timeEvent.type === 'dismissed' || !timeDate) return;
              setScheduledAt(timeDate);
            },
          });
        },
      });
    } else {
      setIosTempDate(base);
      setIosPickerMode('date');
      setShowIOSPicker(true);
    }
  };

  const clearSchedule = () => setScheduledAt(null);

  const handleCreate = async () => {
    if (!classId) { showMessage({ message: 'Please select a class', type: 'warning' }); return; }
    if (roomType === 'scheduled' && !scheduledAt) {
      showMessage({ message: 'Please set a scheduled date/time', type: 'warning' });
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/live-classes', {
        title:              title.trim() || undefined,
        description:        description.trim() || undefined,
        classId,
        scheduledAt:        roomType === 'scheduled' && scheduledAt ? scheduledAt.toISOString() : undefined,
        duration:           roomType === 'limited' ? duration : null,
        chatEnabled,
        handRaiseEnabled:   handRaise,
        whiteboardEnabled:  whiteboard,
        quranPanelEnabled:  quranPanel,
        screenShareEnabled: screenShare,
        isRecorded,
        maxSpeakers,
      });
      const lc = res.data.data;

      // Upload cover image if selected (non-critical)
      if (coverUri && lc?.id) {
        try {
          const formData = new FormData();
          const filename = coverUri.split('/').pop() ?? 'cover.jpg';
          formData.append('cover', { uri: coverUri, name: filename, type: coverMime } as any);
          await api.post(`/live-classes/${lc.id}/cover`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch (_e) { /* non-critical */ }
      }

      // Immediate / permanent: auto-start and go live right away
      if (roomType === 'immediate' || roomType === 'permanent') {
        await api.post(`/live-classes/${lc.id}/start`);
        showMessage({ message: '🔴 Class is live!', type: 'success' });
      } else {
        showMessage({ message: '🎥 Live class created!', type: 'success' });
      }

      router.replace({ pathname: '/live-class/[id]', params: { id: lc.id } } as any);
    } catch (err: any) {
      showMessage({
        message: err?.response?.data?.message ?? 'Failed to create live class',
        type: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

  const btnLabel = roomType === 'immediate' || roomType === 'permanent'
    ? '🔴  Start Class Now'
    : '📹  Create Live Class';

  return (
    <>
      <Stack.Screen options={{
        title: 'Create Live Class',
        headerShown: true,
        headerTintColor: '#4f46e5',
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { fontWeight: '800' },
      }} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={st.container}>
          <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">

            {/* ── Room Type ──────────────────────────────────────────────── */}
            <Text style={st.label}>Room Type</Text>
            <View style={st.typeGrid}>
              {ROOM_TYPES.map(rt => (
                <TouchableOpacity
                  key={rt.id}
                  style={[st.typeCard, roomType === rt.id && st.typeCardActive]}
                  onPress={() => setRoomType(rt.id)}
                  activeOpacity={0.75}
                >
                  <Text style={st.typeIcon}>{rt.icon}</Text>
                  <Text style={[st.typeLabel, roomType === rt.id && st.typeLabelActive]}>{rt.label}</Text>
                  <Text style={st.typeSub} numberOfLines={1}>{rt.sub}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Scheduled date/time */}
            {roomType === 'scheduled' && (
              <>
                <Text style={st.label}>Schedule *</Text>
                <TouchableOpacity style={st.datePicker} onPress={openDatePicker} activeOpacity={0.8}>
                  <Ionicons name="calendar-outline" size={18} color="#4f46e5" />
                  <Text style={[st.datePickerTxt, !scheduledAt && st.datePickerPlaceholder]}>
                    {scheduledAt ? fmtDateTime(scheduledAt) : 'Tap to set date & time'}
                  </Text>
                  {scheduledAt ? (
                    <TouchableOpacity onPress={clearSchedule} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={18} color="#94a3b8" />
                    </TouchableOpacity>
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
                  )}
                </TouchableOpacity>
              </>
            )}

            {/* Duration picker for limited type */}
            {roomType === 'limited' && (
              <>
                <Text style={st.label}>Duration (minutes)</Text>
                <View style={st.seatRow}>
                  {[30, 60, 90, 120, 180, 240].map(n => (
                    <TouchableOpacity
                      key={n}
                      style={[st.seatOpt, duration === n && st.seatOptActive]}
                      onPress={() => setDuration(n)}
                    >
                      <Text style={[st.seatOptText, duration === n && { color: '#4f46e5', fontWeight: '800' }]}>
                        {n >= 60 ? `${n / 60}h${n % 60 ? `${n % 60}m` : ''}` : `${n}m`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Title */}
            <Text style={st.label}>Title <Text style={{ color: '#94a3b8', fontWeight: '400', textTransform: 'none' }}>(optional)</Text></Text>
            <TextInput style={st.input} value={title} onChangeText={setTitle}
              placeholder="e.g. Quran Level 2 — Chapter 5"
              placeholderTextColor="#94a3b8" maxLength={120} />

            {/* Cover image */}
            <Text style={st.label}>Cover Image <Text style={{ color: '#94a3b8', fontWeight: '400', textTransform: 'none' }}>(optional)</Text></Text>
            <TouchableOpacity style={st.coverPicker} onPress={pickCoverImage} activeOpacity={0.8}>
              {coverUri ? (
                <Image source={{ uri: coverUri }} style={st.coverPreview} resizeMode="cover" />
              ) : (
                <View style={{ alignItems: 'center', gap: 6 }}>
                  <Ionicons name="image-outline" size={28} color="#94a3b8" />
                  <Text style={st.coverPickerText}>Tap to upload cover (16:9)</Text>
                </View>
              )}
            </TouchableOpacity>
            {coverUri && (
              <TouchableOpacity onPress={() => setCoverUri(null)} style={{ marginTop: 4 }}>
                <Text style={{ color: '#ef4444', fontSize: 12 }}>Remove cover</Text>
              </TouchableOpacity>
            )}

            <Text style={st.label}>Description</Text>
            <TextInput style={[st.input, st.inputMulti]} value={description}
              onChangeText={setDescription} placeholder="What will students learn?"
              placeholderTextColor="#94a3b8" multiline numberOfLines={3} maxLength={500} />

            {/* Class selector */}
            <Text style={st.label}>Class *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.chipScroll}>
              {(classes as any[]).map((cls: any) => (
                <TouchableOpacity
                  key={cls.id}
                  style={[st.chip, classId === cls.id && st.chipActive]}
                  onPress={() => setClassId(cls.id)}
                >
                  <Text style={[st.chipTxt, classId === cls.id && st.chipTxtActive]}>
                    {cls.name}
                  </Text>
                </TouchableOpacity>
              ))}
              {classes.length === 0 && (
                <Text style={st.noClasses}>No classes available</Text>
              )}
            </ScrollView>

            {/* Settings toggles */}
            <Text style={st.label}>Settings</Text>
            {[
              { label: '💬 Enable Chat',    value: chatEnabled,  onChange: setChatEnabled },
              { label: '✋ Hand Raise',      value: handRaise,    onChange: setHandRaise },
              { label: '🖊️ Whiteboard',     value: whiteboard,   onChange: setWhiteboard },
              { label: '📖 Quran Panel',    value: quranPanel,   onChange: setQuranPanel },
              { label: '🖥️ Screen Share',   value: screenShare,  onChange: setScreenShare },
              { label: '⏺️ Record Class',   value: isRecorded,   onChange: setIsRecorded },
            ].map(item => (
              <View key={item.label} style={st.toggle}>
                <Text style={st.toggleLabel}>{item.label}</Text>
                <Switch value={item.value} onValueChange={item.onChange}
                  trackColor={{ true: '#6366f1', false: '#e2e8f0' }} thumbColor="#fff" />
              </View>
            ))}

            {/* Max speakers on stage */}
            <Text style={st.label}>Max Speakers on Stage</Text>
            <Text style={st.dateSub}>How many students can speak at the same time (default: 20)</Text>
            <View style={st.seatRow}>
              {[2, 4, 6, 8, 10, 20].map(n => (
                <TouchableOpacity
                  key={n}
                  style={[st.seatOpt, maxSpeakers === n && st.seatOptActive]}
                  onPress={() => setMaxSpeakers(n)}
                >
                  <Text style={[st.seatOptText, maxSpeakers === n && { color: '#4f46e5', fontWeight: '800' }]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Create / Start button */}
            <TouchableOpacity
              style={[st.createBtn, loading && st.createBtnDisabled]}
              onPress={handleCreate}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={st.createBtnTxt}>{btnLabel}</Text>
              }
            </TouchableOpacity>

          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>

      {/* iOS Date/Time Picker Modal */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showIOSPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowIOSPicker(false)}
        >
          <TouchableOpacity
            style={st.iosPickerBackdrop}
            activeOpacity={1}
            onPress={() => setShowIOSPicker(false)}
          />
          <View style={st.iosPickerSheet}>
            <View style={st.iosPickerHandle} />

            <View style={st.iosPickerTabs}>
              <TouchableOpacity
                style={[st.iosPickerTab, iosPickerMode === 'date' && st.iosPickerTabActive]}
                onPress={() => setIosPickerMode('date')}
              >
                <Text style={[st.iosPickerTabTxt, iosPickerMode === 'date' && st.iosPickerTabTxtActive]}>📅 Date</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.iosPickerTab, iosPickerMode === 'time' && st.iosPickerTabActive]}
                onPress={() => setIosPickerMode('time')}
              >
                <Text style={[st.iosPickerTabTxt, iosPickerMode === 'time' && st.iosPickerTabTxtActive]}>🕐 Time</Text>
              </TouchableOpacity>
            </View>

            <DateTimePicker
              value={iosTempDate}
              mode={iosPickerMode}
              display="spinner"
              minimumDate={iosPickerMode === 'date' ? new Date() : undefined}
              onChange={(_, date) => { if (date) setIosTempDate(date); }}
              style={{ backgroundColor: '#fff' }}
              textColor="#111827"
            />

            <View style={st.iosPickerBtns}>
              <TouchableOpacity style={st.iosCancelBtn} onPress={() => setShowIOSPicker(false)}>
                <Text style={st.iosCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={st.iosConfirmBtn}
                onPress={() => {
                  setScheduledAt(iosTempDate);
                  setShowIOSPicker(false);
                }}
              >
                <Text style={st.iosConfirmTxt}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

// Format a date for display
function fmtDateTime(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function CreateLiveClassScreen() {
  const router = useRouter();
  const [title,        setTitle]       = useState('');
  const [description,  setDescription] = useState('');
  const [classId,      setClassId]     = useState('');
  const [scheduledAt,  setScheduledAt] = useState<Date | null>(null);
  const [chatEnabled,  setChatEnabled] = useState(true);
  const [handRaise,    setHandRaise]   = useState(true);
  const [whiteboard,   setWhiteboard]  = useState(true);
  const [quranPanel,   setQuranPanel]  = useState(false);
  const [screenShare,  setScreenShare] = useState(true);
  const [isRecorded,   setIsRecorded]  = useState(false);
  const [maxSpeakers,  setMaxSpeakers] = useState(20);
  const [loading,      setLoading]     = useState(false);
  // Cover image
  const [coverUri,     setCoverUri]    = useState<string | null>(null);
  const [coverMime,    setCoverMime]   = useState<string>('image/jpeg');

  // iOS date picker modal state
  const [showIOSPicker,  setShowIOSPicker]  = useState(false);
  const [iosPickerMode,  setIosPickerMode]  = useState<'date' | 'time'>('date');
  const [iosTempDate,    setIosTempDate]    = useState<Date>(new Date());

  const { data: classes = [] } = useQuery({
    queryKey: ['my-classes'],
    queryFn: () => api.get('/classes', { params: { limit: 50 } }).then(r => {
      const raw = r.data.data;
      return Array.isArray(raw) ? raw : raw?.items ?? [];
    }),
  });

  // ── Cover image picker ──────────────────────────────────────────────────────
  const pickCoverImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showMessage({ message: 'Photo library permission required', type: 'warning' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });
    if (!result.canceled && result.assets.length > 0) {
      setCoverUri(result.assets[0].uri);
      setCoverMime(result.assets[0].mimeType ?? 'image/jpeg');
    }
  };

  // ── Date/time picker helpers ─────────────────────────────────────────────────
  const openDatePicker = () => {
    const base = scheduledAt ?? new Date(Date.now() + 30 * 60_000); // default: 30 min from now
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: base,
        mode: 'date',
        minimumDate: new Date(),
        onChange: (event, selectedDate) => {
          if (event.type === 'dismissed' || !selectedDate) return;
          const withDate = selectedDate;
          // After picking date, open time picker
          DateTimePickerAndroid.open({
            value: withDate,
            mode: 'time',
            is24Hour: false,
            onChange: (timeEvent, timeDate) => {
              if (timeEvent.type === 'dismissed' || !timeDate) return;
              setScheduledAt(timeDate);
            },
          });
        },
      });
    } else {
      // iOS: show inline modal
      setIosTempDate(base);
      setIosPickerMode('date');
      setShowIOSPicker(true);
    }
  };

  const clearSchedule = () => setScheduledAt(null);

  const handleCreate = async () => {
    if (!classId) { showMessage({ message: 'Please select a class', type: 'warning' }); return; }

    setLoading(true);
    try {
      const res = await api.post('/live-classes', {
        title:             title.trim() || undefined,
        description:       description.trim() || undefined,
        classId,
        scheduledAt:       scheduledAt ? scheduledAt.toISOString() : undefined,
        duration:          null,
        chatEnabled,
        handRaiseEnabled:  handRaise,
        whiteboardEnabled: whiteboard,
        quranPanelEnabled: quranPanel,
        screenShareEnabled: screenShare,
        isRecorded,
        maxSpeakers,
      });
      const lc = res.data.data;

      // Upload cover image if selected
      if (coverUri && lc?.id) {
        try {
          const formData = new FormData();
          const filename = coverUri.split('/').pop() ?? 'cover.jpg';
          formData.append('cover', { uri: coverUri, name: filename, type: coverMime } as any);
          await api.post(`/live-classes/${lc.id}/cover`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch (_e) {
          // cover upload failure is non-critical
        }
      }

      showMessage({ message: '🎥 Live class created!', type: 'success' });
      router.replace({ pathname: '/live-class/[id]', params: { id: lc.id } } as any);
    } catch (err: any) {
      showMessage({
        message: err?.response?.data?.message ?? 'Failed to create live class',
        type: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{
        title: 'Create Live Class',
        headerShown: true,
        headerTintColor: '#4f46e5',
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { fontWeight: '800' },
      }} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={st.container}>
          <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">

            {/* Title */}
            <Text style={st.label}>Title <Text style={{ color: '#94a3b8', fontWeight: '400', textTransform: 'none' }}>(optional)</Text></Text>
            <TextInput style={st.input} value={title} onChangeText={setTitle}
              placeholder="e.g. Quran Level 2 — Chapter 5"
              placeholderTextColor="#94a3b8" maxLength={120} />

            {/* Cover image */}
            <Text style={st.label}>Cover Image <Text style={{ color: '#94a3b8', fontWeight: '400', textTransform: 'none' }}>(optional)</Text></Text>
            <TouchableOpacity style={st.coverPicker} onPress={pickCoverImage} activeOpacity={0.8}>
              {coverUri ? (
                <Image source={{ uri: coverUri }} style={st.coverPreview} resizeMode="cover" />
              ) : (
                <View style={{ alignItems: 'center', gap: 6 }}>
                  <Ionicons name="image-outline" size={28} color="#94a3b8" />
                  <Text style={st.coverPickerText}>Tap to upload cover (16:9)</Text>
                </View>
              )}
            </TouchableOpacity>
            {coverUri && (
              <TouchableOpacity onPress={() => setCoverUri(null)} style={{ marginTop: 4 }}>
                <Text style={{ color: '#ef4444', fontSize: 12 }}>Remove cover</Text>
              </TouchableOpacity>
            )}

            <Text style={st.label}>Description</Text>
            <TextInput style={[st.input, st.inputMulti]} value={description}
              onChangeText={setDescription} placeholder="What will students learn?"
              placeholderTextColor="#94a3b8" multiline numberOfLines={3} maxLength={500} />

            {/* Class selector */}
            <Text style={st.label}>Class *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.chipScroll}>
              {(classes as any[]).map((cls: any) => (
                <TouchableOpacity
                  key={cls.id}
                  style={[st.chip, classId === cls.id && st.chipActive]}
                  onPress={() => setClassId(cls.id)}
                >
                  <Text style={[st.chipTxt, classId === cls.id && st.chipTxtActive]}>
                    {cls.name}
                  </Text>
                </TouchableOpacity>
              ))}
              {classes.length === 0 && (
                <Text style={st.noClasses}>No classes available</Text>
              )}
            </ScrollView>

            {/* Schedule date/time */}
            <Text style={st.label}>Schedule (optional)</Text>
            <TouchableOpacity style={st.datePicker} onPress={openDatePicker} activeOpacity={0.8}>
              <Ionicons name="calendar-outline" size={18} color="#4f46e5" />
              <Text style={[st.datePickerTxt, !scheduledAt && st.datePickerPlaceholder]}>
                {scheduledAt ? fmtDateTime(scheduledAt) : 'Tap to schedule start time'}
              </Text>
              {scheduledAt ? (
                <TouchableOpacity onPress={clearSchedule} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={18} color="#94a3b8" />
                </TouchableOpacity>
              ) : (
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              )}
            </TouchableOpacity>
            {!scheduledAt && (
              <Text style={st.dateSub}>Leave empty to start immediately when you go live</Text>
            )}

            {/* Settings toggles */}
            <Text style={st.label}>Settings</Text>
            {[
              { label: '💬 Enable Chat',    value: chatEnabled,  onChange: setChatEnabled },
              { label: '✋ Hand Raise',      value: handRaise,    onChange: setHandRaise },
              { label: '🖊️ Whiteboard',     value: whiteboard,   onChange: setWhiteboard },
              { label: '📖 Quran Panel',    value: quranPanel,   onChange: setQuranPanel },
              { label: '🖥️ Screen Share',   value: screenShare,  onChange: setScreenShare },
              { label: '⏺️ Record Class',   value: isRecorded,   onChange: setIsRecorded },
            ].map(item => (
              <View key={item.label} style={st.toggle}>
                <Text style={st.toggleLabel}>{item.label}</Text>
                <Switch value={item.value} onValueChange={item.onChange}
                  trackColor={{ true: '#6366f1', false: '#e2e8f0' }} thumbColor="#fff" />
              </View>
            ))}

            {/* Max speakers on stage */}
            <Text style={st.label}>Max Speakers on Stage</Text>
            <Text style={st.dateSub}>How many students can speak at the same time (default: 20)</Text>
            <View style={st.seatRow}>
              {[2, 4, 6, 8, 10, 20].map(n => (
                <TouchableOpacity
                  key={n}
                  style={[st.seatOpt, maxSpeakers === n && st.seatOptActive]}
                  onPress={() => setMaxSpeakers(n)}
                >
                  <Text style={[st.seatOptText, maxSpeakers === n && { color: '#4f46e5', fontWeight: '800' }]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Create button */}
            <TouchableOpacity
              style={[st.createBtn, loading && st.createBtnDisabled]}
              onPress={handleCreate}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={st.createBtnTxt}>📹  Create Live Class</Text>
              }
            </TouchableOpacity>

          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>

      {/* iOS Date/Time Picker Modal */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showIOSPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowIOSPicker(false)}
        >
          <TouchableOpacity
            style={st.iosPickerBackdrop}
            activeOpacity={1}
            onPress={() => setShowIOSPicker(false)}
          />
          <View style={st.iosPickerSheet}>
            <View style={st.iosPickerHandle} />

            {/* Mode toggle: Date / Time */}
            <View style={st.iosPickerTabs}>
              <TouchableOpacity
                style={[st.iosPickerTab, iosPickerMode === 'date' && st.iosPickerTabActive]}
                onPress={() => setIosPickerMode('date')}
              >
                <Text style={[st.iosPickerTabTxt, iosPickerMode === 'date' && st.iosPickerTabTxtActive]}>
                  📅 Date
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.iosPickerTab, iosPickerMode === 'time' && st.iosPickerTabActive]}
                onPress={() => setIosPickerMode('time')}
              >
                <Text style={[st.iosPickerTabTxt, iosPickerMode === 'time' && st.iosPickerTabTxtActive]}>
                  🕐 Time
                </Text>
              </TouchableOpacity>
            </View>

            <DateTimePicker
              value={iosTempDate}
              mode={iosPickerMode}
              display="spinner"
              minimumDate={iosPickerMode === 'date' ? new Date() : undefined}
              onChange={(_, date) => { if (date) setIosTempDate(date); }}
              style={{ backgroundColor: '#fff' }}
              textColor="#111827"
            />

            <View style={st.iosPickerBtns}>
              <TouchableOpacity style={st.iosCancelBtn} onPress={() => setShowIOSPicker(false)}>
                <Text style={st.iosCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={st.iosConfirmBtn}
                onPress={() => {
                  setScheduledAt(iosTempDate);
                  setShowIOSPicker(false);
                }}
              >
                <Text style={st.iosConfirmTxt}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const st = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#f8fafc' },
  scroll:               { padding: 16, paddingBottom: 48 },

  label:                { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 8, marginTop: 18, textTransform: 'uppercase', letterSpacing: 0.6 },
  input:                { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 14, fontSize: 15, color: '#1e293b' },
  inputMulti:           { height: 88, textAlignVertical: 'top' },

  // Room type grid
  typeGrid:             { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeCard:             { flex: 1, minWidth: '45%', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#e2e8f0', padding: 10, alignItems: 'center', gap: 3 },
  typeCardActive:       { borderColor: '#6366f1', backgroundColor: '#e0e7ff' },
  typeIcon:             { fontSize: 20 },
  typeLabel:            { fontSize: 12, fontWeight: '700', color: '#374151' },
  typeLabelActive:      { color: '#4338ca' },
  typeSub:              { fontSize: 10, color: '#9ca3af', textAlign: 'center' },

  chipScroll:           { flexGrow: 0, marginBottom: 4 },
  chip:                 { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0', marginRight: 8 },
  chipActive:           { borderColor: '#6366f1', backgroundColor: '#e0e7ff' },
  chipTxt:              { fontSize: 13, fontWeight: '600', color: '#64748b' },
  chipTxtActive:        { color: '#6366f1', fontWeight: '700' },
  noClasses:            { color: '#94a3b8', padding: 8, fontSize: 13 },

  datePicker:           { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 14, paddingVertical: 13 },
  datePickerTxt:        { flex: 1, fontSize: 15, color: '#1e293b', fontWeight: '500' },
  datePickerPlaceholder:{ color: '#9ca3af', fontWeight: '400' },
  dateSub:              { fontSize: 11, color: '#94a3b8', marginTop: 5 },

  toggle:               { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  toggleLabel:          { fontSize: 15, fontWeight: '600', color: '#1e293b' },

  createBtn:            { backgroundColor: '#4f46e5', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 24 },
  createBtnDisabled:    { opacity: 0.6 },
  createBtnTxt:         { color: '#fff', fontSize: 16, fontWeight: '800' },

  // Cover image picker
  coverPicker:          { borderWidth: 1.5, borderColor: '#e2e8f0', borderStyle: 'dashed', borderRadius: 12, backgroundColor: '#f8fafc', height: 110, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  coverPreview:         { width: '100%', height: '100%' },
  coverPickerText:      { color: '#94a3b8', fontSize: 13, fontWeight: '500' },

  // Seat picker (maxSpeakers / duration)
  seatRow:              { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10, marginBottom: 4 },
  seatOpt:              { flex: 1, minWidth: 44, alignItems: 'center', paddingVertical: 11, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#e2e8f0' },
  seatOptActive:        { borderColor: '#6366f1', backgroundColor: '#e0e7ff' },
  seatOptText:          { fontSize: 14, fontWeight: '700', color: '#94a3b8' },

  // iOS picker modal
  iosPickerBackdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  iosPickerSheet:       { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  iosPickerHandle:      { width: 40, height: 4, backgroundColor: '#e2e8f0', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  iosPickerTabs:        { flexDirection: 'row', margin: 12, backgroundColor: '#f1f5f9', borderRadius: 12, padding: 3 },
  iosPickerTab:         { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 9 },
  iosPickerTabActive:   { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  iosPickerTabTxt:      { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  iosPickerTabTxtActive:{ color: '#111827', fontWeight: '700' },
  iosPickerBtns:        { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 8 },
  iosCancelBtn:         { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  iosCancelTxt:         { fontSize: 15, fontWeight: '600', color: '#6b7280' },
  iosConfirmBtn:        { flex: 2, backgroundColor: '#4f46e5', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  iosConfirmTxt:        { fontSize: 15, fontWeight: '800', color: '#fff' },
});





