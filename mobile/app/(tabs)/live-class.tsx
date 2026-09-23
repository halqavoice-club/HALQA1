/**
 * HALQA Mobile — Live Screen
 *
 * Shows both PUBLIC streams (visible to all users) and SCHOOL class streams
 * (visible to school members). Any authenticated user can go live.
 */
import { useEffect, useState } from 'react';
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import * as ImagePicker from 'expo-image-picker';
import { getAvatarUrl } from '@/lib/avatar';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, TextInput,
  ScrollView, Platform, Switch, Image
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { getSocket } from '@/lib/socket';
import { showMessage } from 'react-native-flash-message';

// ─── Types ────────────────────────────────────────────────────────────────────
interface LiveClass {
  id: string
  streamType: 'SCHOOL' | 'PUBLIC'
  title: string
  description?: string | null
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
  duration: number | null
  scheduledAt: string | null
  coverImageUrl?: string | null
  hostUserId?: string | null
  class?: { id: string; name: string } | null
  teacher?: { user: { id: string; firstName: string; lastName: string; avatarUrl?: string | null } } | null
  hostUser?: { id: string; firstName: string; lastName: string; avatarUrl?: string | null } | null
  _count: { participants: number }
}

// ─── Stream type badge ────────────────────────────────────────────────────────
function StreamTypeBadge({ streamType }: { streamType: 'SCHOOL' | 'PUBLIC' }) {
  const isPublic = streamType === 'PUBLIC';
  return (
    <View style={[styles.typeBadge, isPublic ? styles.typeBadgePublic : styles.typeBadgeSchool]}>
      <Ionicons name={isPublic ? 'globe-outline' : 'school-outline'} size={9} color={isPublic ? '#7c3aed' : '#3730a3'} />
      <Text style={[styles.typeBadgeText, { color: isPublic ? '#7c3aed' : '#3730a3' }]}>
        {isPublic ? 'Public' : 'Class'}
      </Text>
    </View>
  );
}

// ─── Class card ───────────────────────────────────────────────────────────────
function ClassCard({ lc, onPress, onLongPress, onHostPress, liveViewerCount }: {
  lc: LiveClass; onPress: () => void; onLongPress?: () => void; onHostPress?: (userId: string) => void;
  /** SPRINT-1: real-time viewer count from socket; overrides _count.participants when set */
  liveViewerCount?: number;
}) {
  const isLive = lc.status === 'LIVE';
  const hostId = lc.teacher?.user?.id ?? lc.hostUser?.id ?? null;
  const hostName = lc.teacher?.user
    ? `${lc.teacher.user.firstName} ${lc.teacher.user.lastName}`
    : lc.hostUser
    ? `${lc.hostUser.firstName} ${lc.hostUser.lastName}`
    : null;
  const hostAvatar = lc.teacher?.user?.avatarUrl ?? lc.hostUser?.avatarUrl ?? null;
  const hostInitials = hostName
    ? hostName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
    : '?';
  const contextLine = lc.streamType === 'SCHOOL' && lc.class?.name
    ? lc.class.name
    : null;
  // Use live socket count when available, otherwise fall back to polled count
  const displayCount = liveViewerCount ?? lc._count.participants;

  return (
    <TouchableOpacity
      style={[styles.card, isLive && styles.liveCard]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      <View style={styles.cardContent}>
        <View style={[
          styles.iconArea,
          isLive
            ? { backgroundColor: '#fef2f2' }
            : lc.streamType === 'PUBLIC'
            ? { backgroundColor: '#f5f3ff' }
            : { backgroundColor: '#ede9fe' },
        ]}>
          {lc.coverImageUrl ? (
            <Image source={{ uri: getAvatarUrl(lc.coverImageUrl) ?? '' }} style={{ width: 48, height: 48, borderRadius: 10 }} resizeMode="cover" />
          ) : (
            <Ionicons
              name="videocam-outline"
              size={24}
              color={isLive ? '#ef4444' : lc.streamType === 'PUBLIC' ? '#7c3aed' : '#4f46e5'}
            />
          )}
        </View>

        <View style={{ flex: 1 }}>
          <View style={styles.cardTopRow}>
            {isLive && (
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
            <StreamTypeBadge streamType={lc.streamType} />
          </View>
          <Text style={styles.cardTitle} numberOfLines={1}>{lc.title}</Text>
          {contextLine && <Text style={styles.cardMeta}>{contextLine}</Text>}
          {hostName && (
            <TouchableOpacity
              style={styles.hostRow}
              onPress={hostId && onHostPress ? (e) => { e.stopPropagation?.(); onHostPress(hostId); } : undefined}
              activeOpacity={hostId && onHostPress ? 0.6 : 1}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            >
              {hostAvatar ? (
                <Image source={{ uri: hostAvatar }} style={styles.hostAvatar} />
              ) : (
                <View style={styles.hostAvatarPlaceholder}>
                  <Text style={styles.hostAvatarInitials}>{hostInitials}</Text>
                </View>
              )}
              <Text style={[styles.cardTeacher, hostId && onHostPress && styles.cardTeacherLink]} numberOfLines={1}>
                {hostName}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ alignItems: 'flex-end', minWidth: 48 }}>
          <Text style={styles.cardParticipants}>
            {displayCount}{' '}
            <Ionicons name="people-outline" size={11} color="#9ca3af" />
            {liveViewerCount !== undefined && isLive && (
              <Text style={{ color: '#ef4444' }}> •</Text>
            )}
          </Text>
          {lc.duration && (
            <Text style={styles.cardTime}>{lc.duration}m</Text>
          )}
          {lc.scheduledAt && !isLive && (
            <Text style={styles.cardTime}>
              {formatDistanceToNow(new Date(lc.scheduledAt), { addSuffix: true })}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Edit Stream Modal (from list) ───────────────────────────────────────────
function EditCardModal({ visible, lc, onClose, onDone }: {
  visible: boolean;
  lc: LiveClass | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (lc && visible) {
      setTitle(lc.title ?? '');
      setDescription(lc.description ?? '');
      setConfirmDelete(false);
    }
  }, [lc, visible]);

  if (!lc) return null;

  const handleSave = async () => {
    if (!title.trim()) { showMessage({ message: 'Title is required', type: 'warning' }); return; }
    setSaving(true);
    try {
      await api.patch(`/live-classes/${lc.id}`, { title: title.trim(), description: description.trim() || null });
      showMessage({ message: '✅ Stream updated', type: 'success' });
      onDone(); onClose();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to update', type: 'danger' });
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/live-classes/${lc.id}`);
      showMessage({ message: 'Stream deleted', type: 'success' });
      onDone(); onClose();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to delete', type: 'danger' });
    } finally { setDeleting(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={editCardStyles.header}>
            <Text style={editCardStyles.headerTitle}>Edit Stream</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color="#374151" /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <Text style={editCardStyles.label}>Title *</Text>
            <TextInput style={editCardStyles.input} value={title} onChangeText={setTitle}
              placeholder="Stream title" placeholderTextColor="#9ca3af" maxLength={120} />
            <Text style={editCardStyles.label}>Description</Text>
            <TextInput style={[editCardStyles.input, { height: 80, textAlignVertical: 'top' }]}
              value={description} onChangeText={setDescription} placeholder="Optional description..."
              placeholderTextColor="#9ca3af" multiline maxLength={500} />
            <TouchableOpacity style={[editCardStyles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={editCardStyles.saveBtnText}>Save Changes</Text>}
            </TouchableOpacity>

            {lc.status !== 'LIVE' && (
              <>
                <View style={editCardStyles.sep} />
                {!confirmDelete ? (
                  <TouchableOpacity style={editCardStyles.deleteBtn} onPress={() => setConfirmDelete(true)}>
                    <Ionicons name="trash-outline" size={16} color="#ef4444" />
                    <Text style={editCardStyles.deleteBtnText}>Delete Stream</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={editCardStyles.confirmBox}>
                    <Text style={editCardStyles.confirmText}>Permanently delete this stream?</Text>
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                      <TouchableOpacity style={editCardStyles.confirmCancel} onPress={() => setConfirmDelete(false)}>
                        <Text style={{ color: '#374151', fontWeight: '600' }}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[editCardStyles.confirmDelete, deleting && { opacity: 0.6 }]}
                        onPress={handleDelete} disabled={deleting}>
                        {deleting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '800' }}>Yes, Delete</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </>
            )}
            {lc.status === 'LIVE' && (
              <Text style={{ color: '#9ca3af', textAlign: 'center', marginTop: 16, fontSize: 13 }}>
                End the stream first to delete it.
              </Text>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const editCardStyles = StyleSheet.create({
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  headerTitle:   { fontSize: 18, fontWeight: '800', color: '#111827' },
  label:         { fontSize: 12, fontWeight: '700', color: '#6b7280', marginBottom: 6, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  input:         { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12, fontSize: 15, color: '#111827', backgroundColor: '#f9fafb' },
  saveBtn:       { backgroundColor: '#4f46e5', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 20 },
  saveBtnText:   { color: '#fff', fontWeight: '800', fontSize: 15 },
  sep:           { height: 1, backgroundColor: '#f3f4f6', marginTop: 24, marginBottom: 16 },
  deleteBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#fecaca', borderRadius: 12, padding: 13 },
  deleteBtnText: { color: '#ef4444', fontWeight: '600', fontSize: 14 },
  confirmBox:    { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 12, padding: 14 },
  confirmText:   { color: '#b91c1c', fontSize: 14 },
  confirmCancel: { flex: 1, backgroundColor: '#f3f4f6', borderRadius: 10, padding: 11, alignItems: 'center' },
  confirmDelete: { flex: 2, backgroundColor: '#ef4444', borderRadius: 10, padding: 11, alignItems: 'center' },
});

// ─── Go Live Modal ────────────────────────────────────────────────────────────
function GoLiveModal({ visible, onClose, onCreated }: {
  visible: boolean; onClose: () => void; onCreated: (lcId: string) => void
}) {
  const router = useRouter();
  const [title, setTitle]             = useState('');
  const [description, setDesc]        = useState('');
  const [chatEnabled, setChat]        = useState(true);
  const [handRaiseEnabled, setHandRaise] = useState(true);
  const [whiteboardEnabled, setWhiteboard] = useState(true);
  const [quranPanelEnabled, setQuranPanel] = useState(false);
  const [screenShareEnabled, setScreenShare] = useState(true);
  const [isRecorded, setIsRecorded]   = useState(false);
  const [maxSpeakers, setMaxSpeakers] = useState(20);
  const [roomType, setRoomType]       = useState<'immediate' | 'scheduled' | 'permanent' | 'limited'>('immediate');
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [duration, setDuration]       = useState(60);
  const [loading, setLoading]         = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [coverUri, setCoverUri]       = useState<string | null>(null);
  const [coverMime, setCoverMime]     = useState<string>('image/jpeg');

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setTitle(''); setDesc(''); setChat(true); setHandRaise(true);
      setWhiteboard(true); setQuranPanel(false); setScreenShare(true); setIsRecorded(false);
      setMaxSpeakers(20); setRoomType('immediate');
      setScheduledAt(null); setShowDatePicker(false); setDuration(60);
      setCoverUri(null); setCoverMime('image/jpeg');
    }
  }, [visible]);

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

  const ROOM_TYPES: Array<{ id: typeof roomType; label: string; sub: string; icon: string }> = [
    { id: 'immediate', label: 'Immediate',  sub: 'Go live right now',        icon: '▶️' },
    { id: 'scheduled', label: 'Scheduled',  sub: 'Choose a future time',     icon: '📅' },
    { id: 'permanent', label: 'Permanent',  sub: 'Always open, no auto-end', icon: '♾️' },
    { id: 'limited',   label: 'Limited',    sub: 'Auto-ends after duration',  icon: '⏱️' },
  ];

  const handleCreate = async () => {
    if (roomType === 'scheduled' && !scheduledAt) {
      showMessage({ message: 'Please set a scheduled date/time', type: 'warning' });
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/live-classes', {
        streamType: 'PUBLIC',
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        chatEnabled,
        handRaiseEnabled,
        whiteboardEnabled,
        quranPanelEnabled,
        screenShareEnabled,
        isOpenMic: true,
        isRecorded,
        maxSpeakers,
        scheduledAt: roomType === 'scheduled' && scheduledAt ? scheduledAt.toISOString() : undefined,
        duration: roomType === 'limited' ? duration : null,
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

      // Immediate and permanent: auto-start then navigate directly to the live room
      if (roomType === 'immediate' || roomType === 'permanent') {
        await api.post(`/live-classes/${lc.id}/start`);
        showMessage({ message: '🔴 You\'re live!', type: 'success' });
        onCreated(lc.id);
        router.push({ pathname: '/live-class/[id]', params: { id: lc.id } } as any);
      } else {
        showMessage({ message: '📅 Stream scheduled!', type: 'success' });
        onCreated(lc.id);
      }
    } catch (e: any) {
      showMessage({
        message: e?.response?.data?.message || 'Failed to go live',
        type: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={styles.modalBox}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Go Live</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 500 }} keyboardShouldPersistTaps="handled">
            {/* Type info */}
            <View style={styles.infoBox}>
              <Ionicons name="globe-outline" size={16} color="#7c3aed" />
              <Text style={styles.infoText}>
                Public stream — anyone can watch. No school required.
              </Text>
            </View>

            {/* Room type selector */}
            <Text style={styles.fieldLabel}>Stream Type</Text>
            <View style={glStyles.typeGrid}>
              {ROOM_TYPES.map(rt => (
                <TouchableOpacity
                  key={rt.id}
                  style={[glStyles.typeCard, roomType === rt.id && glStyles.typeCardActive]}
                  onPress={() => setRoomType(rt.id)}
                  activeOpacity={0.7}
                >
                  <Text style={glStyles.typeIcon}>{rt.icon}</Text>
                  <Text style={[glStyles.typeLabel, roomType === rt.id && glStyles.typeLabelActive]}>
                    {rt.label}
                  </Text>
                  <Text style={glStyles.typeSub} numberOfLines={1}>{rt.sub}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Scheduled date/time picker */}
            {roomType === 'scheduled' && (
              <>
                <Text style={styles.fieldLabel}>Scheduled At *</Text>
                <TouchableOpacity
                  style={glStyles.datePicker}
                  onPress={() => {
                    const base = scheduledAt ?? new Date(Date.now() + 30 * 60_000);
                    if (Platform.OS === 'android') {
                      const { DateTimePickerAndroid } = require('@react-native-community/datetimepicker');
                      DateTimePickerAndroid.open({
                        value: base, mode: 'date', minimumDate: new Date(),
                        onChange: (_: any, d?: Date) => {
                          if (!d) return;
                          DateTimePickerAndroid.open({
                            value: d, mode: 'time', is24Hour: false,
                            onChange: (__: any, t?: Date) => { if (t) setScheduledAt(t); },
                          });
                        },
                      });
                    } else {
                      setShowDatePicker(true);
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="calendar-outline" size={16} color="#4f46e5" />
                  <Text style={[glStyles.datePickerText, !scheduledAt && { color: '#9ca3af' }]}>
                    {scheduledAt
                      ? scheduledAt.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : 'Tap to set date & time'}
                  </Text>
                </TouchableOpacity>
                {/* iOS date picker sheet */}
                {Platform.OS === 'ios' && showDatePicker && (() => {
                  const { default: DateTimePicker } = require('@react-native-community/datetimepicker');
                  return (
                    <View style={glStyles.iosPickerWrap}>
                      <DateTimePicker
                        value={scheduledAt ?? new Date(Date.now() + 30 * 60_000)}
                        mode="datetime"
                        display="spinner"
                        minimumDate={new Date()}
                        onChange={(_: any, d?: Date) => { if (d) setScheduledAt(d); }}
                        style={{ backgroundColor: '#fff' }}
                        textColor="#111827"
                      />
                      <TouchableOpacity
                        style={glStyles.iosPickerDone}
                        onPress={() => setShowDatePicker(false)}
                      >
                        <Text style={glStyles.iosPickerDoneText}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })()}
              </>
            )}

            <Text style={styles.fieldLabel}>Title <Text style={{ color: '#9ca3af', fontWeight: '400' }}>(optional)</Text></Text>
            <TextInput
              style={styles.input}
              placeholder="What are you streaming about?"
              placeholderTextColor="#9ca3af"
              value={title}
              onChangeText={setTitle}
              maxLength={100}
            />

            <Text style={styles.fieldLabel}>Description (optional)</Text>
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              placeholder="Tell viewers what to expect..."
              placeholderTextColor="#9ca3af"
              value={description}
              onChangeText={setDesc}
              multiline
              maxLength={500}
            />

            {/* Cover image */}
            <Text style={styles.fieldLabel}>Cover Image (optional)</Text>
            <TouchableOpacity
              style={glStyles.coverPicker}
              onPress={pickCoverImage}
              activeOpacity={0.8}
            >
              {coverUri ? (
                <Image source={{ uri: coverUri }} style={{ width: '100%', height: '100%', borderRadius: 10 }} resizeMode="cover" />
              ) : (
                <View style={{ alignItems: 'center', gap: 4 }}>
                  <Ionicons name="image-outline" size={24} color="#9ca3af" />
                  <Text style={{ color: '#9ca3af', fontSize: 12 }}>Tap to upload (16:9)</Text>
                </View>
              )}
            </TouchableOpacity>
            {coverUri && (
              <TouchableOpacity onPress={() => setCoverUri(null)} style={{ marginTop: 2 }}>
                <Text style={{ color: '#ef4444', fontSize: 11 }}>Remove cover</Text>
              </TouchableOpacity>
            )}

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>💬 Live chat</Text>
              <Switch
                value={chatEnabled}
                onValueChange={setChat}
                trackColor={{ false: '#e5e7eb', true: '#c4b5fd' }}
                thumbColor={chatEnabled ? '#7c3aed' : '#9ca3af'}
              />
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>✋ Hand Raise</Text>
              <Switch
                value={handRaiseEnabled}
                onValueChange={setHandRaise}
                trackColor={{ false: '#e5e7eb', true: '#c4b5fd' }}
                thumbColor={handRaiseEnabled ? '#7c3aed' : '#9ca3af'}
              />
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>🖊️ Whiteboard</Text>
              <Switch
                value={whiteboardEnabled}
                onValueChange={setWhiteboard}
                trackColor={{ false: '#e5e7eb', true: '#c4b5fd' }}
                thumbColor={whiteboardEnabled ? '#7c3aed' : '#9ca3af'}
              />
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>📖 Quran Panel</Text>
              <Switch
                value={quranPanelEnabled}
                onValueChange={setQuranPanel}
                trackColor={{ false: '#e5e7eb', true: '#c4b5fd' }}
                thumbColor={quranPanelEnabled ? '#7c3aed' : '#9ca3af'}
              />
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>🖥️ Screen Share</Text>
              <Switch
                value={screenShareEnabled}
                onValueChange={setScreenShare}
                trackColor={{ false: '#e5e7eb', true: '#c4b5fd' }}
                thumbColor={screenShareEnabled ? '#7c3aed' : '#9ca3af'}
              />
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>⏺️ Record Stream</Text>
              <Switch
                value={isRecorded}
                onValueChange={setIsRecorded}
                trackColor={{ false: '#e5e7eb', true: '#c4b5fd' }}
                thumbColor={isRecorded ? '#7c3aed' : '#9ca3af'}
              />
            </View>

            {/* Duration picker — only for limited type */}
            {roomType === 'limited' && (
              <>
                <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
                  Duration (minutes)
                </Text>
                <View style={glStyles.speakerRow}>
                  {[30, 60, 90, 120, 180, 240].map(n => (
                    <TouchableOpacity
                      key={n}
                      style={[glStyles.speakerOpt, duration === n && glStyles.speakerOptActive]}
                      onPress={() => setDuration(n)}
                    >
                      <Text style={[glStyles.speakerOptText, duration === n && glStyles.speakerOptTextActive]}>
                        {n >= 60 ? `${n / 60}h${n % 60 ? `${n % 60}m` : ''}` : `${n}m`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
              Max Speakers on Stage
            </Text>
            <View style={glStyles.speakerRow}>
              {[2, 4, 6, 10, 20].map(n => (
                <TouchableOpacity
                  key={n}
                  style={[glStyles.speakerOpt, maxSpeakers === n && glStyles.speakerOptActive]}
                  onPress={() => setMaxSpeakers(n)}
                >
                  <Text style={[glStyles.speakerOptText, maxSpeakers === n && glStyles.speakerOptTextActive]}>
                    {n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <TouchableOpacity
            style={[styles.goLiveBtn, loading && { opacity: 0.6 }]}
            onPress={handleCreate}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Ionicons name="videocam" size={18} color="#fff" />
                  <Text style={styles.goLiveBtnText}>
                    {roomType === 'immediate' || roomType === 'permanent' ? 'Go Live Now' : 'Schedule Stream'}
                  </Text>
                </>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function LiveClassScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [showGoLive, setShowGoLive] = useState(false);
  const [editingLc, setEditingLc]   = useState<LiveClass | null>(null);
  // SPRINT-1: real-time viewer counts keyed by liveClassId
  const [viewerCounts, setViewerCounts] = useState<Record<string, number>>({});
  // Search + status filter
  const [search, setSearch]             = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'LIVE' | 'SCHEDULED' | 'ENDED'>('all');

  // SA-LC-MOBILE-01: SUPER_ADMIN = Platform Administration ONLY — cannot create live classes.
  // Any other authenticated user can go live (public stream).
  const canCreate = !!user && user.role !== 'SUPER_ADMIN';

  // Can create a SCHOOL live class — requires TEACHER or SCHOOL_ADMIN role.
  // Checks both the legacy global role and the school memberships array
  // so MEMBER users who joined a school as a teacher also see the button.
  const isSchoolStaff = !!user && (
    ['TEACHER', 'SCHOOL_ADMIN'].includes(user.role) ||
    (user.schoolMemberships ?? []).some(
      (m: { role: string; status: string }) =>
        m.status === 'ACTIVE' && ['TEACHER', 'SCHOOL_ADMIN'].includes(m.role)
    )
  );

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['live-classes'],
    queryFn: () =>
      api.get('/live-classes', { params: { limit: 50 } })
        .then(r => r.data.data?.items || []),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Real-time socket updates
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const schoolId = user?.schoolId;
    if (schoolId) socket.emit('school:join', schoolId);
    socket.emit('feed:join:public');  // listen for public stream notifications

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['live-classes'] });
    // SPRINT-1: real-time viewer count — update local state without a full refetch
    const onViewerCount = (d: { liveClassId: string; count: number }) => {
      setViewerCounts(prev => ({ ...prev, [d.liveClassId]: d.count }));
    };
    // Show a toast when any stream goes live (parity with web)
    const onStarted = (d: { liveClassId?: string; title?: string }) => {
      refresh();
      if (d.title) {
        showMessage({ message: `🔴 ${d.title} is now live!`, type: 'info', duration: 3000 });
      }
    };
    socket.on('liveclass:started',      onStarted);
    socket.on('liveclass:scheduled',    refresh);
    socket.on('liveclass:ended',        refresh);
    socket.on('liveclass:updated',      refresh);
    socket.on('liveclass:viewer_count', onViewerCount);

    return () => {
      if (schoolId) socket.emit('school:leave', schoolId);
      socket.emit('feed:leave:public');
      socket.off('liveclass:started',      onStarted);
      socket.off('liveclass:scheduled',    refresh);
      socket.off('liveclass:ended',        refresh);
      socket.off('liveclass:updated',      refresh);
      socket.off('liveclass:viewer_count', onViewerCount);
    };
  }, [queryClient, user?.schoolId]);

  const allClasses: LiveClass[] = data || [];

  // Apply search + status filter
  const classes = allClasses.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      (c.class?.name ?? '').toLowerCase().includes(q) ||
      ((c.teacher?.user
        ? `${c.teacher.user.firstName} ${c.teacher.user.lastName}`
        : c.hostUser
        ? `${c.hostUser.firstName} ${c.hostUser.lastName}`
        : ''
      ).toLowerCase().includes(q))
    );
  });

  // SPRINT-2: sort live PUBLIC streams by real-time viewer count (highest first)
  const liveAll   = classes.filter(c => c.status === 'LIVE');
  const livePublicSorted = [...liveAll.filter(c => c.streamType === 'PUBLIC')]
    .sort((a, b) => (viewerCounts[b.id] ?? b._count.participants) - (viewerCounts[a.id] ?? a._count.participants));
  const liveSchool = liveAll.filter(c => c.streamType === 'SCHOOL');
  const live       = [...livePublicSorted, ...liveSchool];
  const scheduled  = classes.filter(c => c.status === 'SCHEDULED');
  const past       = classes.filter(c => c.status === 'ENDED').slice(0, 10);

  // Build flat list with section markers
  type ListItem = LiveClass & { _section: string };
  const listData: ListItem[] = [
    ...live.map(c => ({ ...c, _section: 'live' })),
    ...scheduled.map(c => ({ ...c, _section: 'scheduled' })),
    ...past.map(c => ({ ...c, _section: 'past' })),
  ];

  const allItems = [...live, ...scheduled, ...past.slice(0, 10)];

  const STATUS_FILTERS: Array<{ key: typeof statusFilter; label: string }> = [
    { key: 'all',       label: 'All' },
    { key: 'LIVE',      label: '🔴 Live' },
    { key: 'SCHEDULED', label: 'Upcoming' },
    { key: 'ENDED',     label: 'Past' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Live</Text>
          <Text style={styles.subtitle}>
            {live.length > 0 ? `${live.length} live now` : 'Public streams & classes'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          {/* Teachers and school admins can create a school live class */}
          {isSchoolStaff && (
            <TouchableOpacity
              style={styles.createClassBtn}
              onPress={() => router.push('/create-live-class' as any)}
              accessibilityLabel="Create school live class"
              accessibilityRole="button"
            >
              <Ionicons name="school-outline" size={15} color="#4f46e5" />
              <Text style={styles.createClassBtnText}>Class</Text>
            </TouchableOpacity>
          )}
          {/* Any authenticated user (except SUPER_ADMIN) can start a public stream */}
          {canCreate && (
            <TouchableOpacity
              style={styles.goLiveHeaderBtn}
              onPress={() => setShowGoLive(true)}
              accessibilityLabel="Go live — start a public stream"
              accessibilityRole="button"
            >
              <Ionicons name="radio-outline" size={16} color="#fff" />
              <Text style={styles.goLiveHeaderText}>Go Live</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Search bar ─────────────────────────────────────────────────── */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={16} color="#9ca3af" />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search streams..."
            placeholderTextColor="#9ca3af"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color="#9ca3af" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Status filter tabs ─────────────────────────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {STATUS_FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterTab, statusFilter === f.key && styles.filterTabActive]}
            onPress={() => setStatusFilter(f.key)}
          >
            <Text style={[styles.filterTabText, statusFilter === f.key && styles.filterTabTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={c => c.id}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#4f46e5" />
          }
          renderItem={({ item, index }: { item: ListItem; index: number }) => {
            const SECTIONS = [
              { key: 'live',      label: '🔴 Live Now' },
              { key: 'scheduled', label: '📅 Upcoming' },
              { key: 'past',      label: '✅ Past' },
            ];
            const prevSection = index > 0 ? allItems[index - 1] as any : null;
            const showHeader = index === 0 || item._section !== prevSection?._section;
            const section = SECTIONS.find(s => s.key === item._section);
            return (
              <View>
                {showHeader && section && (
                  <Text style={styles.sectionHeader}>{section.label}</Text>
                )}
                <ClassCard
                  lc={item}
                  onPress={() => {
                    router.push({ pathname: '/live-class/[id]', params: { id: item.id } } as any);
                  }}
                  onHostPress={(userId) =>
                    router.push({ pathname: '/profile/[id]', params: { id: userId } } as any)
                  }
                  onLongPress={() => {
                    const isOwner =
                      (item.hostUser?.id && item.hostUser.id === user?.id) ||
                      (item.hostUserId && item.hostUserId === user?.id);
                    if (isOwner && item.status !== 'ENDED' && item.status !== 'CANCELLED') {
                      setEditingLc(item);
                    }
                  }}
                  liveViewerCount={viewerCounts[item.id]}
                />
              </View>
            );
          }}
          contentContainerStyle={{ paddingBottom: 100 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="videocam-off-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyTitle}>
                {search ? `No results for "${search}"` : 'No live streams yet'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {search ? 'Try a different search term' : 'Tap "Go Live" to start broadcasting'}
              </Text>
              {canCreate && !search && (
                <View style={styles.emptyActions}>
                  <TouchableOpacity style={[styles.goLiveHeaderBtn, { marginTop: 16 }]} onPress={() => setShowGoLive(true)}>
                    <Ionicons name="radio-outline" size={16} color="#fff" />
                    <Text style={styles.goLiveHeaderText}>Go Live</Text>
                  </TouchableOpacity>
                  {isSchoolStaff && (
                    <TouchableOpacity
                      style={[styles.createClassBtn, { marginTop: 16 }]}
                      onPress={() => router.push('/create-live-class' as any)}
                    >
                      <Ionicons name="school-outline" size={15} color="#4f46e5" />
                      <Text style={styles.createClassBtnText}>Create Class</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          }
        />
      )}

      <GoLiveModal
        visible={showGoLive}
        onClose={() => setShowGoLive(false)}
        onCreated={(_lcId: string) => {
          setShowGoLive(false);
          queryClient.invalidateQueries({ queryKey: ['live-classes'] });
        }}
      />
      <EditCardModal
        visible={!!editingLc}
        lc={editingLc}
        onClose={() => setEditingLc(null)}
        onDone={() => queryClient.invalidateQueries({ queryKey: ['live-classes'] })}
      />
    </SafeAreaView>
  );
}

const glStyles = StyleSheet.create({
  typeGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  typeCard:         { flex: 1, minWidth: '45%', backgroundColor: '#f9fafb', borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', padding: 10, alignItems: 'center', gap: 3 },
  typeCardActive:   { borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
  typeIcon:         { fontSize: 20 },
  typeLabel:        { fontSize: 12, fontWeight: '700', color: '#374151' },
  typeLabelActive:  { color: '#4338ca' },
  typeSub:          { fontSize: 10, color: '#9ca3af', textAlign: 'center' },
  datePicker:       { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f9fafb', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 12, paddingVertical: 12, marginBottom: 4 },
  coverPicker:      { height: 90, borderWidth: 1.5, borderColor: '#e5e7eb', borderStyle: 'dashed', borderRadius: 10, backgroundColor: '#f9fafb', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', marginBottom: 4 },
  datePickerText:   { flex: 1, fontSize: 14, color: '#1e293b', fontWeight: '500' },
  iosPickerWrap:    { backgroundColor: '#f9fafb', borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
  iosPickerDone:    { backgroundColor: '#4f46e5', padding: 12, alignItems: 'center', borderRadius: 10, margin: 8 },
  iosPickerDoneText:{ color: '#fff', fontWeight: '700', fontSize: 14 },
  // maxSpeakers picker (GoLiveModal parity with web + create-live-class)
  speakerRow:         { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8, marginBottom: 4 },
  speakerOpt:         { flex: 1, minWidth: 44, alignItems: 'center', paddingVertical: 10, backgroundColor: '#f9fafb', borderRadius: 10, borderWidth: 1.5, borderColor: '#e5e7eb' },
  speakerOptActive:   { borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
  speakerOptText:     { fontSize: 15, fontWeight: '700', color: '#9ca3af' },
  speakerOptTextActive:{ color: '#4f46e5' },
});

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#f9fafb' },
  header:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  title:             { fontSize: 22, fontWeight: '900', color: '#111827' },
  subtitle:          { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  headerActions:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  createClassBtn:    { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#eef2ff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#c7d2fe' },
  createClassBtnText:{ color: '#4f46e5', fontWeight: '700', fontSize: 13 },
  goLiveHeaderBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#4f46e5', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  goLiveHeaderText:  { color: '#fff', fontWeight: '700', fontSize: 13 },
  // Search + filter
  searchRow:         { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  searchBox:         { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f3f4f6', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: '#e5e7eb' },
  searchInput:       { flex: 1, fontSize: 14, color: '#111827', padding: 0 },
  filterRow:         { paddingHorizontal: 12, paddingBottom: 6, gap: 6 },
  filterTab:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' },
  filterTabActive:   { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  filterTabText:     { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  filterTabTextActive: { color: '#fff' },
  sectionHeader:     { fontSize: 13, fontWeight: '700', color: '#6b7280', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  card:              { backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: '#f3f4f6' },
  liveCard:          { borderColor: '#fecaca' },
  cardContent:       { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  iconArea:          { width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  cardTopRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' },
  liveBadge:         { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#fef2f2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  liveDot:           { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#ef4444' },
  liveText:          { fontSize: 9, fontWeight: '900', color: '#ef4444' },
  typeBadge:         { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  typeBadgePublic:   { backgroundColor: '#f5f3ff' },
  typeBadgeSchool:   { backgroundColor: '#ede9fe' },
  typeBadgeText:     { fontSize: 9, fontWeight: '700' },
  cardTitle:         { fontSize: 14, fontWeight: '700', color: '#111827' },
  cardMeta:          { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  cardTeacher:       { fontSize: 12, color: '#6b7280', marginTop: 1 },
  hostRow:           { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  hostAvatar:        { width: 16, height: 16, borderRadius: 8 },
  hostAvatarPlaceholder: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#e0e7ff', alignItems: 'center', justifyContent: 'center' },
  hostAvatarInitials:{ fontSize: 7, fontWeight: '700', color: '#4f46e5' },
  cardTeacherLink:   { color: '#7c3aed' },
  cardParticipants:  { fontSize: 12, color: '#9ca3af' },
  cardTime:          { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  center:            { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:             { alignItems: 'center', padding: 60 },
  emptyTitle:        { fontSize: 16, fontWeight: '600', color: '#9ca3af', marginTop: 12 },
  emptySubtitle:     { fontSize: 13, color: '#d1d5db', marginTop: 4 },
  emptyActions:      { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  // Modal
  modalOverlay:      { flex: 1, justifyContent: 'flex-end' },
  modalBox:          { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  modalHeader:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle:        { fontSize: 18, fontWeight: '800', color: '#111827' },
  infoBox:           { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#f5f3ff', borderRadius: 12, padding: 12, marginBottom: 16 },
  infoText:          { fontSize: 13, color: '#6d28d9', flex: 1, lineHeight: 18 },
  fieldLabel:        { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 12 },
  input:             { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12, fontSize: 15, color: '#111827', backgroundColor: '#f9fafb' },
  toggleRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#f3f4f6', marginTop: 12 },
  toggleLabel:       { fontSize: 14, color: '#374151', fontWeight: '500' },
  goLiveBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#4f46e5', borderRadius: 14, paddingVertical: 16, marginTop: 20 },
  goLiveBtnText:     { color: '#fff', fontWeight: '800', fontSize: 16 },
});






