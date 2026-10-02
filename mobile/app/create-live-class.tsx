/**
 * HALQA Mobile ΓÇö Create Live Class Screen
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
  { id: 'immediate', label: 'Immediate',  sub: 'Start class right now',        icon: 'Γû╢∩╕Å' },
  { id: 'scheduled', label: 'Scheduled',  sub: 'Choose a future start time',   icon: '≡ƒôà' },
  { id: 'permanent', label: 'Permanent',  sub: 'Always open, no auto-end',     icon: 'ΓÖ╛∩╕Å' },
  { id: 'limited',   label: 'Limited',    sub: 'Auto-ends after a duration',   icon: 'ΓÅ▒∩╕Å' },
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

  // ΓöÇΓöÇ Cover image picker ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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

  // ΓöÇΓöÇ Date/time picker helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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
        showMessage({ message: '≡ƒö┤ Class is live!', type: 'success' });
      } else {
        showMessage({ message: '≡ƒÄÑ Live class created!', type: 'success' });
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
    ? '≡ƒö┤  Start Class Now'
    : '≡ƒô╣  Create Live Class';

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

            {/* ΓöÇΓöÇ Room Type ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */}
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
              placeholder="e.g. Quran Level 2 ΓÇö Chapter 5"
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
              { label: '≡ƒÆ¼ Enable Chat',    value: chatEnabled,  onChange: setChatEnabled },
              { label: 'Γ£ï Hand Raise',      value: handRaise,    onChange: setHandRaise },
              { label: '≡ƒûè∩╕Å Whiteboard',     value: whiteboard,   onChange: setWhiteboard },
              { label: '≡ƒôû Quran Panel',    value: quranPanel,   onChange: setQuranPanel },
              { label: '≡ƒûÑ∩╕Å Screen Share',   value: screenShare,  onChange: setScreenShare },
              { label: 'ΓÅ║∩╕Å Record Class',   value: isRecorded,   onChange: setIsRecorded },
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
                <Text style={[st.iosPickerTabTxt, iosPickerMode === 'date' && st.iosPickerTabTxtActive]}>≡ƒôà Date</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.iosPickerTab, iosPickerMode === 'time' && st.iosPickerTabActive]}
                onPress={() => setIosPickerMode('time')}
              >
                <Text style={[st.iosPickerTabTxt, iosPickerMode === 'time' && st.iosPickerTabTxtActive]}>≡ƒòÉ Time</Text>
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
