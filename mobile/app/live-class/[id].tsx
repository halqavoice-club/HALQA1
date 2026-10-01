/**
 * HALQA Mobile — Live Class Room Screen
 * Full implementation: join/leave, chat, hand raise, teacher host controls
 * Advanced features: Polls, Quran Panel, Whiteboard, View Mode Switch, Screen Share
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, Alert, TextInput, Platform, Image, Modal, ScrollView, BackHandler,
  Share, Dimensions} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';
import { formatDistanceToNow } from 'date-fns';
import { initSocket, getSocket } from '@/lib/socket';
import { useLiveKitAudio } from '@/hooks/useLiveKitAudio';
import { LiveClassPollPanel, type Poll, type PollEvent } from '@/components/live-class/LiveClassPollPanel';
import { LiveClassQuranPanel, type QuranPosition } from '@/components/live-class/LiveClassQuranPanel';
import { LiveClassWhiteboard, type DrawEvent, type WhiteboardHandle } from '@/components/live-class/LiveClassWhiteboard';
import { LiveClassGiftPanel } from '@/components/live-class/LiveClassGiftPanel';
import { SpeakerGrid } from '@/components/voice/layout/SpeakerGrid';
import { useDynamicLayoutStore } from '@/components/voice/layout/useDynamicLayoutStore';
import type { SpeakerSlot } from '../../../src/lib/layout/layoutTypes';
import { LiveVideoGrid, type VideoSpeaker } from '@/components/live-class/LiveVideoGrid';
import { LiveClassShareModal } from '@/components/live-class/LiveClassShareModal';

// ─── Types ────────────────────────────────────────────────────────────────────
interface LiveClass {
  id: string; title: string; description?: string;
  host: { id: string; name: string; avatar?: string };
  // hostUserId — the userId of the creator (permanent; never changes)
  hostUserId?: string;
  // delegatedHostId — optional current operational host (SCHOOL streams only)
  delegatedHostId?: string | null;
  // streamType — 'SCHOOL' or 'PUBLIC'
  streamType?: string;
  participantsCount: number;
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
  scheduledAt?: string; startedAt?: string;
  chatEnabled: boolean; handRaiseEnabled: boolean;
}

interface ChatMessage {
  id: string; userId: string; userName: string;
  message: string; timestamp: Date;
}

interface HandEntry {
  userId: string; firstName: string; lastName: string; avatarUrl?: string;
  raisedAt: string;
}

interface Participant {
  userId: string; firstName: string; lastName: string;
  avatarUrl?: string; role: string; isMuted: boolean; handRaised: boolean;
  /** 0-based seat index on stage. null/undefined means the participant is in the audience. */
  speakerSlot?: number | null;
}

// ─── Edit Stream Modal ────────────────────────────────────────────────────────
function EditStreamModal({ visible, lc, onClose, onUpdated, onDeleted }: {
  visible: boolean;
  lc: { id: string; title: string; description?: string; status: string; coverImageUrl?: string | null } | null;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [coverUri, setCoverUri]   = useState<string | null>(null);
  const [coverMime, setCoverMime] = useState<string>('image/jpeg');

  // Sync fields when modal opens
  useEffect(() => {
    if (lc && visible) {
      setTitle(lc.title ?? '');
      setDescription(lc.description ?? '');
      setConfirmDelete(false);
      // Resolve relative path to absolute URL so Image source works on mobile
      setCoverUri(lc.coverImageUrl ? avatarUrl(lc.coverImageUrl, '') : null);
      setCoverMime('image/jpeg');
    }
  }, [lc, visible]);

  if (!lc) return null;

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

  const handleSave = async () => {
    if (!title.trim()) {
      showMessage({ message: 'Title is required', type: 'warning' });
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/live-classes/${lc.id}`, {
        title: title.trim(),
        description: description.trim() || null,
      });
      // Upload cover if a new local image was selected (uri starts with file:// or content://)
      if (coverUri && (coverUri.startsWith('file://') || coverUri.startsWith('content://'))) {
        try {
          const formData = new FormData();
          const filename = coverUri.split('/').pop() ?? 'cover.jpg';
          formData.append('cover', { uri: coverUri, name: filename, type: coverMime } as any);
          await api.post(`/live-classes/${lc.id}/cover`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch (_e) { /* non-critical */ }
      }
      showMessage({ message: '✅ Stream updated', type: 'success' });
      onUpdated();
      onClose();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to update', type: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (lc.status === 'LIVE') {
      showMessage({ message: 'End the stream first before deleting', type: 'warning' });
      return;
    }
    setDeleting(true);
    try {
      await api.delete(`/live-classes/${lc.id}`);
      showMessage({ message: 'Stream deleted', type: 'success' });
      onDeleted();
      onClose();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to delete', type: 'danger' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* Header */}
          <View style={editStyles.header}>
            <Text style={editStyles.headerTitle}>Edit Stream</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color="#374151" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={editStyles.body} keyboardShouldPersistTaps="handled">
            {/* Cover image */}
            <Text style={editStyles.label}>Cover Image</Text>
            <TouchableOpacity style={editStyles.coverPicker} onPress={pickCoverImage} activeOpacity={0.8}>
              {coverUri ? (
                <Image source={{ uri: coverUri }} style={{ width: '100%', height: '100%', borderRadius: 10 }} resizeMode="cover" />
              ) : (
                <View style={{ alignItems: 'center', gap: 6 }}>
                  <Ionicons name="image-outline" size={28} color="#9ca3af" />
                  <Text style={{ color: '#9ca3af', fontSize: 12 }}>Tap to upload cover (16:9)</Text>
                </View>
              )}
            </TouchableOpacity>
            {coverUri && (
              <TouchableOpacity onPress={() => setCoverUri(null)} style={{ marginTop: 4 }}>
                <Text style={{ color: '#ef4444', fontSize: 12 }}>Remove cover</Text>
              </TouchableOpacity>
            )}

            {/* Title */}
            <Text style={editStyles.label}>Title *</Text>
            <TextInput
              style={editStyles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Stream title"
              placeholderTextColor="#9ca3af"
              maxLength={120}
              returnKeyType="next"
            />

            {/* Description */}
            <Text style={editStyles.label}>Description</Text>
            <TextInput
              style={[editStyles.input, editStyles.inputMulti]}
              value={description}
              onChangeText={setDescription}
              placeholder="Optional description..."
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={3}
              maxLength={500}
            />

            {/* Save button */}
            <TouchableOpacity
              style={[editStyles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={editStyles.saveBtnText}>Save Changes</Text>
              }
            </TouchableOpacity>

            {/* Delete section */}
            <View style={editStyles.deleteSep} />
            {lc.status !== 'LIVE' ? (
              !confirmDelete ? (
                <TouchableOpacity
                  style={editStyles.deleteBtn}
                  onPress={() => setConfirmDelete(true)}
                >
                  <Ionicons name="trash-outline" size={16} color="#ef4444" />
                  <Text style={editStyles.deleteBtnText}>Delete Stream</Text>
                </TouchableOpacity>
              ) : (
                <View style={editStyles.confirmBox}>
                  <Text style={editStyles.confirmText}>
                    This will permanently delete the stream. Are you sure?
                  </Text>
                  <View style={editStyles.confirmBtns}>
                    <TouchableOpacity
                      style={editStyles.confirmCancel}
                      onPress={() => setConfirmDelete(false)}
                    >
                      <Text style={editStyles.confirmCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[editStyles.confirmDelete, deleting && { opacity: 0.6 }]}
                      onPress={handleDelete}
                      disabled={deleting}
                    >
                      {deleting
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={editStyles.confirmDeleteText}>Yes, Delete</Text>
                      }
                    </TouchableOpacity>
                  </View>
                </View>
              )
            ) : (
              <Text style={editStyles.liveNote}>End the stream first to delete it.</Text>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const editStyles = StyleSheet.create({
  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  headerTitle:      { fontSize: 18, fontWeight: '800', color: '#111827' },
  body:             { padding: 20, gap: 4 },
  label:            { fontSize: 12, fontWeight: '700', color: '#6b7280', marginBottom: 6, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  input:            { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12, fontSize: 15, color: '#111827', backgroundColor: '#f9fafb' },
  inputMulti:       { height: 88, textAlignVertical: 'top' },
  coverPicker:      { height: 100, borderWidth: 1.5, borderColor: '#e5e7eb', borderStyle: 'dashed', borderRadius: 12, backgroundColor: '#f9fafb', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  saveBtn:          { backgroundColor: '#4f46e5', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 20 },
  saveBtnText:      { color: '#fff', fontWeight: '800', fontSize: 15 },
  deleteSep:        { height: 1, backgroundColor: '#f3f4f6', marginTop: 24, marginBottom: 16 },
  deleteBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#fecaca', borderRadius: 12, padding: 13 },
  deleteBtnText:    { color: '#ef4444', fontWeight: '600', fontSize: 14 },
  confirmBox:       { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 12, padding: 14, gap: 12 },
  confirmText:      { color: '#b91c1c', fontSize: 14, lineHeight: 20 },
  confirmBtns:      { flexDirection: 'row', gap: 10 },
  confirmCancel:    { flex: 1, backgroundColor: '#f3f4f6', borderRadius: 10, padding: 11, alignItems: 'center' },
  confirmCancelText:{ color: '#374151', fontWeight: '600', fontSize: 14 },
  confirmDelete:    { flex: 2, backgroundColor: '#ef4444', borderRadius: 10, padding: 11, alignItems: 'center' },
  confirmDeleteText:{ color: '#fff', fontWeight: '800', fontSize: 14 },
  liveNote:         { color: '#9ca3af', fontSize: 13, textAlign: 'center', fontStyle: 'italic' },
});

// ─── Chat Message Row ─────────────────────────────────────────────────────────
function ChatRow({ msg, myId, isHost, onDelete }: { msg: ChatMessage; myId: string; isHost: boolean; onDelete: (id: string) => void }) {
  const isMe = msg.userId === myId;
  const isSystem = msg.userId === 'system';
  if (isSystem) return (
    <View style={styles.systemMsg}>
      <Text style={styles.systemMsgText}>{msg.message}</Text>
    </View>
  );
  const canDelete = isMe || isHost;
  return (
    <TouchableOpacity
      activeOpacity={canDelete ? 0.6 : 1}
      onLongPress={canDelete ? () => {
        Alert.alert('Delete message?', 'Remove this message for everyone?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => onDelete(msg.id) },
        ]);
      } : undefined}
    >
      <View style={[styles.chatRow, isMe && styles.chatRowMe]}>
        {!isMe && <Text style={styles.chatName}>{msg.userName}: </Text>}
        <Text style={[styles.chatMsg, isMe && styles.chatMsgMe]}>{msg.message}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Hand Queue Modal (teacher approves/rejects hand raises) ─────────────────
function HandQueueModal({ visible, hands, onClose, onApprove, onReject }: {
  visible: boolean; hands: HandEntry[]; onClose: () => void;
  onApprove: (userId: string) => void; onReject: (userId: string) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>✋ Raised Hands ({hands.length})</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color="#374151" /></TouchableOpacity>
        </View>
        {hands.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>No hands raised</Text>
          </View>
        ) : (
          <FlatList
            data={hands}
            keyExtractor={h => h.userId}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            renderItem={({ item }) => (
              <View style={styles.handRow}>
                <Image source={{ uri: avatarUrl(item.avatarUrl, `${item.firstName} ${item.lastName}`) }}
                  style={styles.handAvatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.handName}>{item.firstName} {item.lastName}</Text>
                  <Text style={styles.handTime}>{formatDistanceToNow(new Date(item.raisedAt), { addSuffix: true })}</Text>
                </View>
                <TouchableOpacity style={styles.approveBtn} onPress={() => onApprove(item.userId)}>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                  <Text style={styles.approveBtnText}>Allow</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rejectBtn} onPress={() => onReject(item.userId)}>
                  <Ionicons name="close" size={16} color="#ef4444" />
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ─── Participants Modal (teacher can mute/kick) ───────────────────────────────
function ParticipantsModal({ visible, participants, myId, onClose, onMute, onKick, onDemote, onInvite, onPromoteMod, onDemoteMod, onTransferHost, isHost, followMap, followLoading, onFollow }: {
  visible: boolean; participants: Participant[]; myId: string; onClose: () => void;
  isHost: boolean;
  onMute:          (userId: string, muted: boolean) => void;
  onKick:          (userId: string, name: string) => void;
  onDemote:        (userId: string, name: string) => void;
  onInvite:        (userId: string, name: string) => void;
  onPromoteMod:    (userId: string, name: string) => void;
  onDemoteMod:     (userId: string, name: string) => void;
  onTransferHost?: (userId: string, name: string) => void;
  /** FOLLOW: keyed by userId — tracks follow state for any participant */
  followMap:     Record<string, boolean>;
  followLoading: Record<string, boolean>;
  onFollow:      (userId: string) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>👥 Participants ({participants.length})</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color="#374151" /></TouchableOpacity>
        </View>
        <FlatList
          data={participants}
          keyExtractor={p => p.userId}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          renderItem={({ item: p }) => {
            const isMe = p.userId === myId;
            const name = `${p.firstName} ${p.lastName}`;
            const isOnStage = p.speakerSlot != null || p.role === 'HOST' || p.role === 'MODERATOR';
            const isModerator = p.role === 'MODERATOR';
            const pIsFollowing = followMap[p.userId] ?? false;
            const pFollowLoading = followLoading[p.userId] ?? false;
            return (
              <View style={styles.pRow}>
                <Image source={{ uri: avatarUrl(p.avatarUrl, name) }} style={styles.pAvatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pName}>{name}{isMe ? ' (you)' : ''}</Text>
                  <Text style={styles.pRole}>
                    {p.role}{p.handRaised ? ' · ✋' : ''}{isOnStage && p.role !== 'HOST' && p.role !== 'MODERATOR' ? ' · 🎙 On Stage' : ''}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  {/* Follow button — shown for every non-self participant */}
                  {!isMe && (
                    <TouchableOpacity
                      style={[
                        styles.pBtn,
                        { backgroundColor: pIsFollowing ? '#f0fdf4' : '#eef2ff', minWidth: 36 },
                      ]}
                      onPress={() => onFollow(p.userId)}
                      disabled={pFollowLoading}
                      accessibilityLabel={pIsFollowing ? `Unfollow ${name}` : `Follow ${name}`}
                    >
                      {pFollowLoading ? (
                        <ActivityIndicator size="small" color="#4f46e5" />
                      ) : (
                        <Ionicons
                          name={pIsFollowing ? 'checkmark' : 'person-add-outline'}
                          size={15}
                          color={pIsFollowing ? '#10b981' : '#4f46e5'}
                        />
                      )}
                    </TouchableOpacity>
                  )}
                  {!isMe && isHost && (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity style={styles.pBtn} onPress={() => onMute(p.userId, !p.isMuted)}>
                      <Ionicons name={p.isMuted ? 'mic-off' : 'mic'} size={16} color={p.isMuted ? '#ef4444' : '#10b981'} />
                    </TouchableOpacity>
                    {/* Moderator badge toggle */}
                    {p.role !== 'HOST' && (
                      <TouchableOpacity
                        style={[styles.pBtn, { backgroundColor: isModerator ? '#fff7ed' : '#f0fdf4' }]}
                        onPress={() => isModerator ? onDemoteMod(p.userId, name) : onPromoteMod(p.userId, name)}
                      >
                        <Ionicons name={isModerator ? 'shield' : 'shield-outline'} size={16} color={isModerator ? '#f97316' : '#10b981'} />
                      </TouchableOpacity>
                    )}
                    {/* Move to/from stage button */}
                    {isOnStage && p.role !== 'HOST' && (
                      <TouchableOpacity style={[styles.pBtn, { backgroundColor: '#fff7ed' }]}
                        onPress={() => onDemote(p.userId, name)}>
                        <Ionicons name="arrow-down-outline" size={16} color="#f97316" />
                      </TouchableOpacity>
                    )}
                    {!isOnStage && (
                      <TouchableOpacity style={[styles.pBtn, { backgroundColor: '#eef2ff' }]}
                        onPress={() => onInvite(p.userId, name)}>
                        <Ionicons name="arrow-up-outline" size={16} color="#4f46e5" />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={[styles.pBtn, { backgroundColor: '#fef2f2' }]}
                      onPress={() => onKick(p.userId, name)}>
                      <Ionicons name="exit-outline" size={16} color="#ef4444" />
                    </TouchableOpacity>
                    {/* Host transfer — only for non-HOST participants; HOST only */}
                    {p.role !== 'HOST' && isHost && onTransferHost && (
                      <TouchableOpacity
                        style={[styles.pBtn, { backgroundColor: '#fefce8' }]}
                        onPress={() => onTransferHost(p.userId, name)}
                        accessibilityLabel={`Make ${name} the host`}
                      >
                        <Ionicons name="ribbon-outline" size={16} color="#ca8a04" />
                      </TouchableOpacity>
                    )}
                  </View>
                  )}
                </View>
              </View>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function LiveClassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const chatRef = useRef<FlatList>(null);

  const [isJoined,      setIsJoined]      = useState(false);
  const [isConnecting,  setIsConnecting]  = useState(false);
  const [isMuted,       setIsMuted]       = useState(true);
  const [isCameraOn,    setIsCameraOn]    = useState(false);
  const [chatText,      setChatText]      = useState('');
  const [chatMessages,  setChatMessages]  = useState<ChatMessage[]>([]);
  const [activeTab,     setActiveTab]     = useState<'video'|'chat'|'whiteboard'|'quran'|'polls'|'controls'>('video');
  const [handRaised,    setHandRaised]    = useState(false);
  const [hands,         setHands]         = useState<HandEntry[]>([]);
  const [participants,  setParticipants]  = useState<Participant[]>([]);
  const [showHands,     setShowHands]     = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  // New feature state
  const [isOpenMic,     setIsOpenMic]     = useState(false);
  const [isRecording,   setIsRecording]   = useState(false);
  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set()); // userId set of active speakers
  const [floatingEmoji, setFloatingEmoji] = useState<{ id: string; emoji: string } | null>(null);
  // Advanced teaching tools
  type ActivePanel = 'whiteboard' | 'quran' | 'polls' | null;
  const [activePanel,     setActivePanel]     = useState<ActivePanel>(null);
  const [viewMode,        setViewMode]        = useState<'video' | 'audio'>('video');
  const [polls,           setPolls]           = useState<Poll[]>([]);
  const [quranPosition,   setQuranPosition]   = useState<QuranPosition | null>(null);
  const [remoteDrawEvent, setRemoteDrawEvent] = useState<DrawEvent | null>(null);
  const whiteboardRef = useRef<WhiteboardHandle>(null);
  const [showReactions, setShowReactions] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showGifts, setShowGifts] = useState(false);
  // "More" bottom sheet — screen share, audio/video mode, whiteboard
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  // DI-01: Attendance state for teachers
  const [attendance, setAttendance] = useState<any[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);

  // ── Full Screen presentation mode ─────────────────────────────────────────
  // LAYOUT-ONLY STATE — purely visual, never mutates stage/LiveKit/socket state.
  // Local to this viewer; not broadcast to other participants (§34).
  const [isFullscreen,   setIsFullscreen]   = useState(false);
  // showFsOverlay: tap-to-show overlay controls in fullscreen; auto-hides after 4s
  const [showFsOverlay,  setShowFsOverlay]  = useState(true);
  const fsOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SPRINT-3: Portrait-first fullscreen height for PUBLIC streams.
  // On PUBLIC streams the video area expands to full portrait screen height
  // (minus status bar + bottom inset). On SCHOOL streams it keeps the existing
  // flex-based layout so the tab bar below remains visible.
  const { height: screenHeight } = Dimensions.get('window');

  // SPRINT-4: Share + Follow state
  // followMap: tracks follow state keyed by userId — works for any participant
  const [followMap,     setFollowMap]     = useState<Record<string, boolean>>({});
  const [followLoading, setFollowLoading] = useState<Record<string, boolean>>({});
  // Share modal
  const [showShareModal, setShowShareModal] = useState(false);

  // ── Spotlight / individual participant maximize ────────────────────────────
  // PRESENTATION ONLY — local UI state. Does NOT change LiveKit connections,
  // speaker slots, roles, maxSpeakers, or any backend state.
  // Each viewer independently selects their own primary participant.
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);

  // SPRINT-4: Share and Follow handlers are declared AFTER useQuery (below)
  // because they depend on liveClass and hostUserId.

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => {
      const next = !prev;
      if (next) {
        // Entering fullscreen: show overlay, start auto-hide timer
        setShowFsOverlay(true);
        if (fsOverlayTimerRef.current) clearTimeout(fsOverlayTimerRef.current);
        fsOverlayTimerRef.current = setTimeout(() => setShowFsOverlay(false), 4000);
      } else {
        // Exiting fullscreen: always show controls
        if (fsOverlayTimerRef.current) { clearTimeout(fsOverlayTimerRef.current); fsOverlayTimerRef.current = null; }
        setShowFsOverlay(true);
      }
      return next;
    });
  }, []);

  // Tap fullscreen area to reveal overlay controls temporarily
  const handleFsTap = useCallback(() => {
    if (!isFullscreen) return;
    setShowFsOverlay(true);
    if (fsOverlayTimerRef.current) clearTimeout(fsOverlayTimerRef.current);
    fsOverlayTimerRef.current = setTimeout(() => setShowFsOverlay(false), 4000);
  }, [isFullscreen]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (fsOverlayTimerRef.current) clearTimeout(fsOverlayTimerRef.current);
    };
  }, []);

  // LiveKit real audio (native builds only — degrades gracefully in Expo Go)
  const lk = useLiveKitAudio();

  // ── Load class info ──────────────────────────────────────────────────────────
  const { data: liveClass, isLoading } = useQuery<LiveClass>({
    queryKey: ['live-class', id],
    queryFn: async () => {
      const res = await api.get(`/live-classes/${id}`);
      const lc = res.data.data;
      const teacherUser = lc.teacher?.user ?? lc.host ?? {};
      return {
        ...lc,
        host: {
          id: teacherUser.id ?? lc.teacherId ?? '',
          name: `${teacherUser.firstName ?? ''} ${teacherUser.lastName ?? ''}`.trim() || 'Teacher',
          avatar: teacherUser.avatarUrl ?? null,
        },
        // Expose hostUserId and streamType for ownership checks
        hostUserId: lc.hostUserId ?? lc.host_user_id ?? null,
        streamType: lc.streamType ?? lc.stream_type ?? 'SCHOOL',
        participantsCount: lc._count?.participants ?? 0,
        chatEnabled: lc.chatEnabled ?? true,
        handRaiseEnabled: lc.handRaiseEnabled ?? true,
      } as LiveClass;
    },
    enabled: !!id,
    refetchInterval: isJoined ? 30000 : 10000,
  });

  // ── Host/role detection ────────────────────────────────────────────────────
  //
  // ARCHITECTURE RULE: Live Class role comes from the PARTICIPANT RECORD,
  // not from global User.role. A SCHOOL_ADMIN in School A viewing a live class
  // in School B is just a STUDENT there — their global role is irrelevant.
  //
  // myParticipantRole: what the SERVER assigned when this user joined.
  // null = not yet joined / data still loading.
  const myParticipantRole = participants.find(p => p.userId === user?.id)?.role ?? null;

  // isCreator: we created this live class (hostUserId matches our userId).
  // Used as a pre-join fallback before participant data is available.
  // liveClass is now in scope (declared above by useQuery).
  const isCreator = !!liveClass && !!user && liveClass.hostUserId === user.id;

  // DEL-HOST: isDelegatedHost — SCHOOL streams only.
  // lc.delegatedHostId is the server-authoritative current delegated host.
  const isDelegatedHost =
    !!liveClass && !!user &&
    liveClass.streamType === 'SCHOOL' &&
    liveClass.delegatedHostId != null &&
    liveClass.delegatedHostId === user.id;

  // isHost: server assigned HOST role when we joined, OR we are the creator,
  // OR we are the currently delegated host.
  // NEVER derived from global User.role — that causes cross-school admin leaks.
  const isHost = myParticipantRole === 'HOST' || isCreator || isDelegatedHost;

  // isTeacher: alias kept for socket event handlers and controls visibility.
  // true if HOST or MODERATOR (both get management controls).
  const isTeacher = isHost || myParticipantRole === 'MODERATOR';

  // ── SPRINT-3/4: liveClass-dependent derivations (must be after useQuery) ──
  const isPublicStream = (liveClass as any)?.streamType === 'PUBLIC';
  // hostUserId: creator's userId — used as the primary follow target
  const hostUserId = (liveClass as any)?.hostUserId ?? liveClass?.host?.id ?? null;
  const isOwnStream = hostUserId === user?.id;
  // isFollowing: convenience alias for the host's follow state
  const isFollowing = hostUserId ? (followMap[hostUserId] ?? false) : false;

  // Auto-clear spotlight when the selected participant leaves or is removed from stage.
  // Uses participants array (available at this point) to check stage presence.
  // A participant is "on stage" if their role is HOST/MODERATOR or speakerSlot is set.
  useEffect(() => {
    if (!selectedParticipantId) return;
    const onStage = participants.find(p =>
      p.userId === selectedParticipantId &&
      (typeof p.speakerSlot === 'number' || p.role === 'HOST' || p.role === 'MODERATOR')
    );
    if (!onStage) setSelectedParticipantId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, selectedParticipantId]);

  // Load initial follow state for the host when liveClass data arrives
  useEffect(() => {
    if (!hostUserId || isOwnStream) return;
    api.get(`/social/counts/${hostUserId}`)
      .then(r => {
        // getSocialCounts returns { isFollowing: boolean }
        const following = r.data?.data?.isFollowing ?? false;
        setFollowMap(prev => ({ ...prev, [hostUserId]: following }));
      })
      .catch(() => {}); // non-fatal — follow button defaults to false
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostUserId]);

  // SPRINT-4: Share handler — opens rich share modal (DM / Group / Community / Feed / Copy)
  const handleShare = useCallback(() => {
    setShowShareModal(true);
  }, []);

  // SPRINT-4: Follow/unfollow any participant by userId
  const handleFollowUser = useCallback(async (targetUserId: string) => {
    if (!targetUserId || targetUserId === user?.id) return;
    setFollowLoading(prev => ({ ...prev, [targetUserId]: true }));
    const currentlyFollowing = followMap[targetUserId] ?? false;
    try {
      if (currentlyFollowing) {
        await api.delete(`/social/follow/${targetUserId}`);
        setFollowMap(prev => ({ ...prev, [targetUserId]: false }));
        showMessage({ message: 'Unfollowed', type: 'info', duration: 1500 });
      } else {
        await api.post(`/social/follow/${targetUserId}`);
        setFollowMap(prev => ({ ...prev, [targetUserId]: true }));
        showMessage({ message: '✅ Following!', type: 'success', duration: 1500 });
      }
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger', duration: 2000 });
    } finally {
      setFollowLoading(prev => ({ ...prev, [targetUserId]: false }));
    }
  }, [followMap, user?.id]);

  // Open DM conversation with a participant
  const openDmWithUser = useCallback(async (targetUserId: string) => {
    try {
      const res = await api.get(`/dm/conversations/${targetUserId}/with`);
      const convId = res.data.data?.id;
      if (convId) router.push({ pathname: '/dm/[id]', params: { id: convId } } as any);
    } catch {
      showMessage({ message: 'Could not open conversation', type: 'danger', duration: 2000 });
    }
  }, [router]);

  // showParticipantSheet is declared after handleKickParticipant/handleDemoteFromStage
  // (those are declared further down and needed in the callback dependency array)

  // Alias for host follow (used in info card / fullscreen strip buttons)
  const handleFollowHost = useCallback(async () => {
    if (!hostUserId) return;
    await handleFollowUser(hostUserId);
  }, [hostUserId, handleFollowUser]);

  // ── Dynamic Layout Store — shared with SpeakerGrid ───────────────────────
  // We access the store directly (not via useDynamicLayout hook) because
  // useDynamicLayout registers socket listeners for voice:seat_changed etc.
  // which are irrelevant in a live class. We only need the store's setSpeakers
  // and the layout result that SpeakerGrid reads from the same store instance.
  const layoutStore = useDynamicLayoutStore();

  // ── Derived active-speaker list ───────────────────────────────────────────
  //
  // A participant is ON STAGE if:
  //   1. speakerSlot is a number (assigned by server), OR
  //   2. role is 'HOST' (hosts are always on stage by definition)
  //
  // MODERATOR + no speakerSlot = still audience (moderators must be explicitly
  // put on stage, unlike the host who is always presenting).
  const activeSpeakers = useMemo((): SpeakerSlot[] => {
    const onStage = participants.filter((p): p is Participant =>
      typeof p.speakerSlot === 'number' || p.role === 'HOST'
    );

    // Stable sort: HOST first (slot 0), then by speakerSlot asc
    return onStage
      .sort((a, b) => {
        if (a.role === 'HOST' && b.role !== 'HOST') return -1;
        if (b.role === 'HOST' && a.role !== 'HOST') return 1;
        const sa = typeof a.speakerSlot === 'number' ? a.speakerSlot : 999;
        const sb = typeof b.speakerSlot === 'number' ? b.speakerSlot : 999;
        return sa - sb;
      })
      .map((p, idx): SpeakerSlot => ({
        userId:      p.userId,
        // HOST gets slot 0 always; others use their assigned slot or sequential index
        seatIndex:   p.role === 'HOST' ? 0 : (typeof p.speakerSlot === 'number' ? p.speakerSlot : idx),
        role:        p.role === 'HOST'      ? 'owner'
                   : p.role === 'MODERATOR' ? 'moderator'
                   : 'speaker',
        displayName: `${p.firstName} ${p.lastName}`.trim() || p.userId,
        avatarUrl:   p.avatarUrl,
        isMuted:     p.isMuted,
        isSpeaking:  speakingUsers.has(p.userId), // Sprint 4: wired to voice:speaking socket
        isOnline:    true,
        connectionQuality: 'good',
      }));
  }, [participants, speakingUsers]);

  // ── VideoSpeaker list for LiveVideoGrid (TikTok-style 4-column grid) ─────
  const videoSpeakers = useMemo((): VideoSpeaker[] =>
    activeSpeakers.map((s): VideoSpeaker => ({
      userId:      s.userId,
      seatIndex:   s.seatIndex,
      displayName: s.displayName,
      avatarUrl:   s.avatarUrl,
      role:        s.role as VideoSpeaker['role'],
      isMuted:     s.isMuted,
      isSpeaking:  s.isSpeaking,
      isOnline:    s.isOnline,
    })),
  [activeSpeakers]);

  // ── Sync activeSpeakers → Dynamic Layout Store ────────────────────────────
  useEffect(() => {
    layoutStore.setSpeakers(activeSpeakers);
  }, [activeSpeakers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Clear layout store on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => { layoutStore.setSpeakers([]); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync isOpenMic from server data
  useEffect(() => {
    if (liveClass) setIsOpenMic((liveClass as any).isOpenMic ?? false);
  }, [(liveClass as any)?.isOpenMic]);

  // DI-01: load attendance when host opens the controls tab
  const loadAttendance = useCallback(async () => {
    if (!isHost || !id) return;
    setLoadingAttendance(true);
    try {
      const r = await api.get(`/live-classes/${id}/attendance`);
      setAttendance(r.data.data ?? []);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to load attendance';
      showMessage({ message: msg, type: 'danger', duration: 3000 });
    } finally {
      setLoadingAttendance(false);
    }
  }, [id, isHost]);

  // ── Load hand queue (teachers only) ─────────────────────────────────────────
  const loadHands = useCallback(async () => {
    if (!isHost || !isJoined) return;
    try {
      const r = await api.get(`/live-classes/${id}/hand/queue`);
      setHands(r.data.data ?? []);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to load hand queue';
      showMessage({ message: msg, type: 'danger', duration: 3000 });
    }
  }, [id, isHost, isJoined]);

  // ── Socket events ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    const socket = getSocket();
    if (!socket) return;
    socket.emit('liveclass:join_room', id);

    const onMsg = (msg: any) => {
      const formatted: ChatMessage = {
        id: msg.id, userId: msg.userId,
        userName: msg.user ? `${msg.user.firstName} ${msg.user.lastName}`.trim() : 'User',
        message: msg.body, timestamp: new Date(msg.createdAt),
      };
      setChatMessages(prev => {
        if (prev.find(m => m.id === msg.id)) return prev;
        return [...prev, formatted];
      });
      setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 100);
    };
    const onHandRaised = (d: any) => {
      if (d.userId !== user?.id) {
        showMessage({ message: `${d.firstName} raised their hand ✋`, type: 'info', duration: 2000 });
      }
      if (isHost) {
        setHands(prev => {
          if (prev.find(h => h.userId === d.userId)) return prev;
          return [...prev, { userId: d.userId, firstName: d.firstName, lastName: d.lastName, avatarUrl: d.avatarUrl, raisedAt: new Date().toISOString() }];
        });
      }
      setParticipants(prev => prev.map(p => p.userId === d.userId ? { ...p, handRaised: true } : p));
    };
    const onHandLowered = (d: any) => {
      setHands(prev => prev.filter(h => h.userId !== d.userId));
      setParticipants(prev => prev.map(p => p.userId === d.userId ? { ...p, handRaised: false } : p));
    };
    const onUserJoined = (d: any) => {
      setParticipants(prev => {
        if (prev.find(p => p.userId === d.userId)) return prev;
        return [...prev, { userId: d.userId, firstName: d.user?.firstName ?? d.firstName ?? '', lastName: d.user?.lastName ?? d.lastName ?? '', avatarUrl: d.user?.avatarUrl, role: d.role ?? 'STUDENT', isMuted: true, handRaised: false }];
      });
    };
    const onUserLeft     = (d: any) => setParticipants(prev => prev.filter(p => p.userId !== d.userId));
    const onMuteAll      = ()       => { setIsMuted(true); showMessage({ message: '🔇 You were muted', type: 'info', duration: 1500 }); };
    const onMuteChanged  = (d: any) => setParticipants(prev => prev.map(p => p.userId === d.userId ? { ...p, isMuted: d.isMuted } : p));
    const onStarted      = ()       => { qc.invalidateQueries({ queryKey: ['live-class', id] }); showMessage({ message: '🔴 Class is now live', type: 'success' }); };
    const onEnded        = ()       => { qc.invalidateQueries({ queryKey: ['live-class', id] }); showMessage({ message: 'Class has ended', type: 'info' }); if (!isHost) router.back(); };
    const onCanSpeak     = ()       => {
      showMessage({ message: '🎙️ You can now speak!', type: 'success' });
      // DO NOT setIsMuted(false) here — isMuted state will be updated after
      // grant_mic triggers a LiveKit reconnect and the new token is applied.
      // Setting it prematurely causes UI/state desync (mic shows unmuted but SFU is still blocking).
    };
    const onKicked       = ()       => { showMessage({ message: 'You were removed from this class', type: 'danger' }); setIsJoined(false); router.back(); };

    // New: class settings updated (chatEnabled, handRaiseEnabled, isOpenMic, etc.)
    const onUpdated = (d: any) => {
      qc.setQueryData(['live-class', id], (old: any) =>
        old ? { ...old, ...(d.liveClass ?? d) } : old
      );
    };

    // New: open mic toggled by host
    const onOpenMicChanged = (d: any) => {
      setIsOpenMic(d.isOpenMic);
      showMessage({
        message: d.isOpenMic
          ? '🎤 Open mic — raise your hand to speak instantly!'
          : '🔇 Open mic disabled',
        type: d.isOpenMic ? 'success' : 'info',
        duration: 2000,
      });
      // MIC-02: Open mic means raiseHand auto-approves with a speakerSlot.
      // No bulk canPublish grant — each user goes through the queue individually.
    };

    // New: recording started/stopped
    const onRecordingStarted = () => {
      setIsRecording(true);
      showMessage({ message: '🔴 Recording started', type: 'info', duration: 2000 });
    };
    const onRecordingStopped = () => {
      setIsRecording(false);
      showMessage({ message: '⏹ Recording stopped', type: 'info', duration: 2000 });
    };

    // New: emoji reaction from another participant
    const onReaction = (d: any) => {
      const id_ = `${Date.now()}-${Math.random()}`;
      setFloatingEmoji({ id: id_, emoji: d.emoji ?? '👏' });
      setTimeout(() => setFloatingEmoji(fe => fe?.id === id_ ? null : fe), 2500);
    };

    // New: speak request from a student (host sees toast)
    const onSpeakRequest = (d: any) => {
      if (isHost) {
        showMessage({
          message: `${d.firstName ?? 'A student'} wants to speak`,
          description: 'Go to Controls → Hands to approve',
          type: 'info',
          duration: 3000,
        });
      }
    };

    // New: hand approved — assign speakerSlot so the user appears in the grid
    const onHandApproved = (d: any) => {
      setHands(prev => prev.filter(h => h.userId !== d.userId));
      setParticipants(prev => prev.map(p =>
        p.userId === d.userId
          ? { ...p, handRaised: false, isMuted: false, speakerSlot: typeof d.speakerSlot === 'number' ? d.speakerSlot : (p.speakerSlot ?? 0) }
          : p
      ));
    };
    const onHandRejected = (d: any) => {
      setHands(prev => prev.filter(h => h.userId !== d.userId));
      setParticipants(prev => prev.map(p => p.userId === d.userId ? { ...p, handRaised: false } : p));
    };

    socket.on('liveclass:message',          onMsg);
    socket.on('liveclass:hand_raised',      onHandRaised);
    socket.on('liveclass:hand_lowered',     onHandLowered);
    socket.on('liveclass:user_joined',      onUserJoined);
    socket.on('liveclass:user_left',        onUserLeft);
    socket.on('liveclass:mute_all',         onMuteAll);
    socket.on('liveclass:mute_changed',     onMuteChanged);
    socket.on('liveclass:started',          onStarted);
    socket.on('liveclass:ended',            onEnded);
    socket.on('liveclass:you_were_kicked',  onKicked);
    socket.on('liveclass:updated',          onUpdated);
    socket.on('liveclass:open_mic_changed', onOpenMicChanged);
    socket.on('liveclass:recording_started', onRecordingStarted);
    socket.on('liveclass:recording_stopped', onRecordingStopped);
    socket.on('liveclass:reaction',          onReaction);
    socket.on('liveclass:speak_request',     onSpeakRequest);
    socket.on('liveclass:hand_approved',     onHandApproved);
    socket.on('liveclass:hand_rejected',     onHandRejected);
    // New bulk events
    socket.on('liveclass:unmute_all',        () => { setIsMuted(false); showMessage({ message: '🎙️ Host unmuted everyone', type: 'info', duration: 1500 }); });
    socket.on('liveclass:all_hands_lowered', () => { setHandRaised(false); setHands([]); setParticipants(prev => prev.map(p => ({ ...p, handRaised: false }))); });
    socket.on('liveclass:message_deleted',   (d: any) => { setChatMessages(prev => prev.filter(m => m.id !== d.messageId)); });

    // ── Advanced teaching tools ────────────────────────────────────────────
    // Poll events (create / vote / close)
    const onPollEvent = (d: any) => {
      const ev: PollEvent = d.event ?? d;
      setPolls(prev => {
        if (ev.type === 'create' && ev.poll) {
          if (prev.find(p => p.id === ev.poll!.id)) return prev;
          return [ev.poll!, ...prev];
        }
        if (ev.type === 'vote' && ev.pollId && ev.optionId && ev.userId) {
          return prev.map(p => p.id === ev.pollId ? {
            ...p,
            // DI-02 FIX: idempotent add — skip if voter already in votes array to
            // prevent duplicate entries when optimistic update and server echo both fire.
            options: p.options.map(o => {
              if (o.id !== ev.optionId) {
                return { ...o, votes: o.votes.filter((v: string) => v !== ev.userId) };
              }
              if (o.votes.includes(ev.userId!)) return o; // already recorded — no-op
              return { ...o, votes: [...o.votes, ev.userId!] };
            }),
          } : p);
        }
        if (ev.type === 'close' && ev.pollId) {
          return prev.map(p => p.id === ev.pollId ? { ...p, isActive: false } : p);
        }
        return prev;
      });
      // Auto-open polls tab for students when a new poll is created
      if (ev.type === 'create' && !isTeacher) {
        setActiveTab('polls' as any);
        showMessage({ message: '📊 Teacher launched a poll!', type: 'info', duration: 2500 });
      }
    };

    // Quran position sync (students scroll to ayah)
    const onQuranPosition = (d: any) => {
      setQuranPosition({ surahNumber: d.surahNumber, ayahNumber: d.ayahNumber });
      if (!isTeacher) {
        setActiveTab('quran' as any);
        showMessage({ message: `📖 Teacher synced to ${d.surahNumber}:${d.ayahNumber}`, type: 'info', duration: 2000 });
      }
    };

    // Whiteboard draw events (students see host strokes)
    const onDraw = (d: any) => {
      const event: DrawEvent = d.event ?? d;
      setRemoteDrawEvent(event);
      if (!isTeacher && event.type !== 'snapshot') {
        // Auto-switch to whiteboard view when host starts drawing
        setActivePanel(prev => prev === 'whiteboard' ? prev : 'whiteboard');
      }
    };

    // View mode changed by host (audio/video)
    const onViewModeChanged = (d: any) => {
      setViewMode(d.viewMode);
      if (!isHost) {
        showMessage({
          message: d.viewMode === 'audio' ? '🔇 Host switched to audio-only view' : '📹 Host switched to video view',
          type: 'info',
          duration: 2500,
        });
      }
    };

    // Screen share started/stopped
    const onScreenShareStarted = () => {
      showMessage({ message: '🖥️ Teacher is sharing their screen', type: 'info', duration: 2000 });
    };
    const onScreenShareStopped = () => {
      showMessage({ message: 'Screen share ended', type: 'info', duration: 1500 });
    };

    // MIC-01: Host approved this user to speak (or open mic enabled).
    // Disconnect LiveKit and reconnect with a fresh token — the new token
    // will have canPublish:true because isMuted is now false in DB.
    const onGrantMic = async (d: any) => {
      if (d.liveClassId !== id) return;
      if (!isJoined) return;
      try {
        lk.disconnect();
        await new Promise(r => setTimeout(r, 400)); // let disconnect settle
        const tkRes = await api.post(`/live-classes/${id}/livekit-token`);
        const { token: lkToken, livekitUrl } = tkRes.data.data;
        if (lkToken && livekitUrl) {
          await lk.connect(livekitUrl, lkToken, true);
          setIsMuted(false);
        }
      } catch {
        showMessage({ message: 'Failed to activate mic — try toggling mic button', type: 'warning', duration: 3000 });
      }
    };

    // MIC-02: Host demoted this user or they dropped mic — return to listen-only.
    // Reconnect with canPublish:false token so SFU enforces subscribe-only.
    const onRevokeMic = async (d: any) => {
      if (d.liveClassId !== id) return;
      if (!isJoined) return;
      setIsMuted(true);
      // Clear speakerSlot so the user leaves the speaker grid immediately
      setParticipants(prev => prev.map(p =>
        p.userId === d.userId ? { ...p, isMuted: true, speakerSlot: null } : p
      ));
      try {
        if (lk.connected) lk.disableMic();
        lk.disconnect();
        await new Promise(r => setTimeout(r, 400));
        const tkRes = await api.post(`/live-classes/${id}/livekit-token`);
        const { token: lkToken, livekitUrl } = tkRes.data.data;
        // startMuted=true → reconnects with mic disabled (listen-only audience state)
        if (lkToken && livekitUrl) await lk.connect(livekitUrl, lkToken, true);
      } catch {
        // non-fatal — token reconnect failed, user stays disconnected until retry
      }
      showMessage({ message: '🎙 Mic dropped — returned to audience', type: 'info', duration: 2000 });
    };

    // MIC-02: A speaker was added to the stage — update participant state with speakerSlot
    const onSpeakerAdded = (d: any) => {
      if (d.liveClassId !== id) return;
      setParticipants(prev => prev.map(p =>
        p.userId === d.userId
          ? { ...p, isMuted: false, speakerSlot: typeof d.speakerSlot === 'number' ? d.speakerSlot : (p.speakerSlot ?? 0) }
          : p
      ));
    };

    // MIC-02: A speaker was removed from the stage — clear speakerSlot so they leave the grid
    const onSpeakerRemoved = (d: any) => {
      if (d.liveClassId !== id) return;
      setParticipants(prev => prev.map(p =>
        p.userId === d.userId ? { ...p, isMuted: true, speakerSlot: null } : p
      ));
    };

    socket.on('liveclass:poll',                 onPollEvent);
    socket.on('liveclass:quran_position',       onQuranPosition);
    socket.on('liveclass:draw',                 onDraw);
    socket.on('liveclass:viewmode_changed',     onViewModeChanged);
    socket.on('liveclass:screen_share_started', onScreenShareStarted);
    socket.on('liveclass:screen_share_stopped', onScreenShareStopped);
    socket.on('liveclass:grant_mic',            onGrantMic);
    socket.on('liveclass:revoke_mic',           onRevokeMic);
    socket.on('liveclass:speaker_added',        onSpeakerAdded);
    socket.on('liveclass:speaker_removed',      onSpeakerRemoved);

    // H-4 FIX: Demotion events — host demoted a speaker (broadcast to room)
    const onSpeakerDemoted = (d: any) => {
      if (d.liveClassId !== id) return;
      setParticipants(prev => prev.map(p =>
        p.userId === d.userId ? { ...p, isMuted: true, speakerSlot: null } : p
      ));
    };
    socket.on('liveclass:speaker_demoted', onSpeakerDemoted);

    // H-4 FIX: You were demoted — private event to the demoted user
    const onYouWereDemoted = (d: any) => {
      if (d.liveClassId !== id) return;
      setParticipants(prev => prev.map(p =>
        p.userId === user?.id ? { ...p, isMuted: true, speakerSlot: null } : p
      ));
      showMessage({ message: '⬇️ You have been moved to the audience', type: 'info', duration: 2000 });
    };
    socket.on('liveclass:you_were_demoted', onYouWereDemoted);

    // DEL-HOST: Delegated host assignment events
    const onHostAssigned = (d: any) => {
      if (d.liveClassId !== id) return;
      // Update liveClass query cache so isDelegatedHost recomputes
      qc.setQueryData(['live-class', id], (old: any) => {
        if (!old) return old;
        return { ...old, delegatedHostId: d.delegatedHostId ?? null };
      });
      qc.invalidateQueries({ queryKey: ['live-class', id] });
      if (d.delegatedHostId === user?.id) {
        showMessage({ message: '🎙 You are now the delegated host', type: 'success', duration: 3000 });
        setParticipants(prev => prev.map(p =>
          p.userId === user?.id ? { ...p, role: 'HOST' } : p
        ));
      }
    };
    const onHostRevoked = (d: any) => {
      if (d.liveClassId !== id) return;
      qc.setQueryData(['live-class', id], (old: any) => {
        if (!old) return old;
        return { ...old, delegatedHostId: null };
      });
      qc.invalidateQueries({ queryKey: ['live-class', id] });
    };
    const onYourHostRevoked = (d: any) => {
      if (d.liveClassId !== id) return;
      qc.setQueryData(['live-class', id], (old: any) => {
        if (!old) return old;
        return { ...old, delegatedHostId: null };
      });
      qc.invalidateQueries({ queryKey: ['live-class', id] });
      setParticipants(prev => prev.map(p =>
        p.userId === user?.id ? { ...p, role: 'MODERATOR' } : p
      ));
      showMessage({ message: '⚠️ Your delegated host role has been revoked', type: 'danger', duration: 3000 });
    };
    socket.on('liveclass:host_assigned',      onHostAssigned);
    socket.on('liveclass:host_revoked',       onHostRevoked);
    socket.on('liveclass:your_host_revoked',  onYourHostRevoked);
    // Sprint 4: wire isSpeaking to real LiveKit audio activity
    // The useLiveKitAudio hook emits voice:speaking when the local participant's speaking
    // state changes. We relay this to all room members via Socket.IO so their grids
    // show the green speaking ring.
    const onVoiceSpeaking = (d: any) => {
      if (!d || !d.roomId) return;
      // Only handle events for this live class room (roomId matches liveClassId)
      if (d.roomId !== id) return;
      setSpeakingUsers(prev => {
        const next = new Set(prev);
        if (d.speaking && d.userId) next.add(d.userId);
        else if (d.userId) next.delete(d.userId);
        return next;
      });
    };
    socket.on('voice:speaking', onVoiceSpeaking);

    return () => {
      socket.emit('liveclass:leave_room', id);
      socket.off('liveclass:message',          onMsg);
      socket.off('liveclass:hand_raised',      onHandRaised);
      socket.off('liveclass:hand_lowered',     onHandLowered);
      socket.off('liveclass:user_joined',      onUserJoined);
      socket.off('liveclass:user_left',        onUserLeft);
      socket.off('liveclass:mute_all',         onMuteAll);
      socket.off('liveclass:mute_changed',     onMuteChanged);
      socket.off('liveclass:started',          onStarted);
      socket.off('liveclass:ended',            onEnded);
      socket.off('liveclass:you_were_kicked',  onKicked);
      socket.off('liveclass:updated',          onUpdated);
      socket.off('liveclass:open_mic_changed', onOpenMicChanged);
      socket.off('liveclass:recording_started', onRecordingStarted);
      socket.off('liveclass:recording_stopped', onRecordingStopped);
      socket.off('liveclass:reaction',          onReaction);
      socket.off('liveclass:speak_request',     onSpeakRequest);
      socket.off('liveclass:hand_approved',     onHandApproved);
      socket.off('liveclass:hand_rejected',     onHandRejected);
      socket.off('liveclass:unmute_all');
      socket.off('liveclass:all_hands_lowered');
      socket.off('liveclass:message_deleted');
      socket.off('liveclass:poll',                 onPollEvent);
      socket.off('liveclass:quran_position',       onQuranPosition);
      socket.off('liveclass:draw',                 onDraw);
      socket.off('liveclass:viewmode_changed',     onViewModeChanged);
      socket.off('liveclass:screen_share_started', onScreenShareStarted);
      socket.off('liveclass:screen_share_stopped', onScreenShareStopped);
      socket.off('liveclass:grant_mic',            onGrantMic);
      socket.off('liveclass:revoke_mic',           onRevokeMic);
      socket.off('liveclass:speaker_added',        onSpeakerAdded);
      socket.off('liveclass:speaker_removed',      onSpeakerRemoved);
      socket.off('liveclass:speaker_demoted',      onSpeakerDemoted);
      socket.off('liveclass:you_were_demoted',     onYouWereDemoted);
      socket.off('liveclass:host_assigned',        onHostAssigned);
      socket.off('liveclass:host_revoked',         onHostRevoked);
      socket.off('liveclass:your_host_revoked',    onYourHostRevoked);
      socket.off('voice:speaking', onVoiceSpeaking);
    };
  }, [id, user, isHost, qc, router, lk]);

  // Refresh hand queue every 30s while joined as host
  useEffect(() => {
    if (!isJoined || !isHost) return;
    loadHands();
    const t = setInterval(loadHands, 30000);
    return () => clearInterval(t);
  }, [isJoined, isHost, loadHands]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const handleJoin = useCallback(async () => {
    // SA-LC-MOBILE-02: SUPER_ADMIN = Platform Administration ONLY.
    // Platform admins cannot join live classes as participants.
    if (user?.role === 'SUPER_ADMIN') {
      showMessage({ message: 'Platform admins cannot join live classes. Use the admin panel.', type: 'warning' });
      return;
    }
    if (!liveClass) return;
    if (liveClass.status === 'ENDED')     { showMessage({ message: 'Class has ended', type: 'warning' }); return; }
    if (liveClass.status === 'CANCELLED') { showMessage({ message: 'Class was cancelled', type: 'warning' }); return; }
    if (liveClass.status === 'SCHEDULED' && !isHost) { showMessage({ message: 'Class has not started yet', type: 'warning' }); return; }
    setIsConnecting(true);

    // ── Step 1: JOIN — this is the only step that can block entry ──────────────
    let joinData: any = null;
    try {
      const joinRes = await api.post(`/live-classes/${id}/join`);
      joinData = joinRes.data.data;
    } catch (err: any) {
      // Surface the exact server error message — not a generic fallback
      const msg = err?.response?.data?.message
        ?? (err?.message?.includes('Network') ? 'Cannot connect to server — check your WiFi' : 'Failed to join');
      showMessage({ message: msg, type: 'danger', duration: 4000 });
      setIsConnecting(false);
      return; // stop here — don't proceed if join failed
    }

    // ── Step 2: Session setup — all non-fatal after join is confirmed ──────────
    const token = useAuthStore.getState().accessToken;
    if (token && !getSocket()?.connected) initSocket(token);
    getSocket()?.emit('liveclass:join_room', id);
    setIsJoined(true);
    setIsConnecting(false);
    showMessage({ message: 'Joined live class', type: 'success' });

    // Use participants from the join response if available (saves a round-trip
    // and ensures speakerSlot is populated from the same transaction)
    const joinParticipants: any[] = joinData?.liveClass?.participants ?? [];
    if (joinParticipants.length > 0) {
      setParticipants(joinParticipants.map((p: any) => ({
        userId:      p.userId,
        firstName:   p.user?.firstName ?? '',
        lastName:    p.user?.lastName ?? '',
        avatarUrl:   p.user?.avatarUrl,
        role:        p.role,
        isMuted:     p.isMuted ?? true,
        handRaised:  p.handRaised ?? false,
        speakerSlot: typeof p.speakerSlot === 'number' ? p.speakerSlot : null,
      })));
    } else {
      // Fallback: separate participants request if join response had none
      api.get(`/live-classes/${id}/participants`).then(pRes => {
        setParticipants((pRes.data.data ?? []).map((p: any) => ({
          userId:      p.userId,
          firstName:   p.user?.firstName ?? '',
          lastName:    p.user?.lastName ?? '',
          avatarUrl:   p.user?.avatarUrl,
          role:        p.role,
          isMuted:     p.isMuted ?? true,
          handRaised:  p.handRaised ?? false,
          speakerSlot: typeof p.speakerSlot === 'number' ? p.speakerSlot : null,
        })));
      }).catch(() => { /* non-fatal — socket events will fill the list */ });
    }

    if (isHost) loadHands();

    // ── Step 3: Load chat history (non-fatal) ─────────────────────────────────
    api.get(`/live-classes/${id}/messages`, { params: { limit: 50 } }).then(chatRes => {
      const msgs: ChatMessage[] = (chatRes.data.data?.messages ?? chatRes.data.data ?? []).map((m: any) => ({
        id: m.id, userId: m.userId,
        userName: m.user ? `${m.user.firstName} ${m.user.lastName}`.trim() : 'User',
        message: m.body, timestamp: new Date(m.createdAt),
      }));
      setChatMessages([
        { id: 'sys-join', userId: 'system', userName: 'System', message: `Welcome to ${liveClass.title}`, timestamp: new Date() },
        ...msgs,
      ]);
    }).catch(() => {
      // Non-fatal — socket will deliver new messages going forward
      setChatMessages([{ id: 'sys-join', userId: 'system', userName: 'System', message: `Welcome to ${liveClass.title}`, timestamp: new Date() }]);
    });

    // ── Step 4: Load cached polls (non-fatal) ─────────────────────────────────
    api.get(`/live-classes/${id}/poll/state`).then(r => {
      const cachedPolls = r.data.data?.polls ?? [];
      if (cachedPolls.length > 0) {
        setPolls(cachedPolls);
        if (!isTeacher && cachedPolls.some((p: any) => p.isActive)) {
          setActiveTab('polls' as any);
          showMessage({ message: '📊 There is an active poll', type: 'info', duration: 2500 });
        }
      }
    }).catch(() => { /* non-fatal */ });

    // ── Step 5: Load whiteboard snapshot (non-fatal) ─────────────────────────
    // The server stores the last snapshot in Redis so late-joining participants
    // can catch up to the current whiteboard state without replaying all strokes.
    // Server returns: { snapshot: 'data:image/png;base64,...' } or { snapshot: null }
    if ((liveClass as any).whiteboardEnabled) {
      api.get(`/live-classes/${id}/whiteboard/state`).then(wbRes => {
        const snapshot: string | null = wbRes.data.data?.snapshot ?? null;
        if (snapshot && whiteboardRef.current) {
          whiteboardRef.current.loadSnapshot(snapshot);
          // Auto-switch to whiteboard tab so the student sees the current state
          setActiveTab('whiteboard' as any);
        }
      }).catch(() => { /* non-fatal — whiteboard starts blank on Redis miss */ });
    }

    // ── Step 6: Connect LiveKit (non-fatal, native build only) ────────────────
    try {
      const tkRes = await api.post(`/live-classes/${id}/livekit-token`);
      const { token: lkToken, livekitUrl } = tkRes.data.data;
      if (lkToken && livekitUrl) await lk.connect(livekitUrl, lkToken, true);
    } catch { /* non-fatal — audio degrades gracefully in Expo Go */ }

  }, [id, liveClass, isHost, isTeacher, loadHands]); // eslint-disable-line

  // ── Auto-join for the creator after immediate/permanent go-live ──────────────
  // When the host lands here right after "Go Live Now", the stream is already LIVE.
  // Skip the lobby and join automatically — no extra tap needed.
  // Guards: fires once (isJoined=false, not connecting), creator only, LIVE status only.
  useEffect(() => {
    if (!liveClass || isJoined || isConnecting) return;
    if (liveClass.status !== 'LIVE') return;
    if (!isCreator) return;
    handleJoin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveClass?.id, liveClass?.status, isCreator]);

  const handleLeave = useCallback(() => {
    Alert.alert('Leave Class', 'Are you sure?', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        getSocket()?.emit('liveclass:leave_room', id);
        lk.disconnect();
        try { await api.post(`/live-classes/${id}/leave`); } catch {}
        setIsJoined(false); router.back();
      }},
    ]);
  }, [id, router]);

  // MOB-004: Android hardware back button — intercept when inside a live class.
  // Without this, pressing back navigates away silently, leaving the user as an
  // active participant in the DB and keeping the LiveKit connection open.
  // Show the same Leave confirmation dialog.

  const handleEndClass = useCallback(async () => {
    Alert.alert('End Class', 'End the class for all participants?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End Class', style: 'destructive', onPress: async () => {
        try { await api.post(`/live-classes/${id}/end`); qc.invalidateQueries({ queryKey: ['live-class', id] }); router.back(); } catch (e: any) { showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }); }
      }},
    ]);
  }, [id, qc, router]);

  useEffect(() => {
    if (!isJoined) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // Teachers end the class instead of just leaving
      if (isHost) {
        handleEndClass();
      } else {
        handleLeave();
      }
      return true; // consumed — prevent default back navigation
    });
    return () => sub.remove();
  }, [isJoined, isHost, handleLeave, handleEndClass]);

  const handleStartClass = useCallback(async () => {
    Alert.alert('Start Class', 'Start the live class now?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start', onPress: async () => {
        try { await api.post(`/live-classes/${id}/start`); qc.invalidateQueries({ queryKey: ['live-class', id] }); showMessage({ message: '🔴 Class started!', type: 'success' }); } catch (e: any) { showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }); }
      }},
    ]);
  }, [id, qc]);

  const handleMuteAll = useCallback(async () => {
    try { await api.patch(`/live-classes/${id}/mute-all`); showMessage({ message: '🔇 All muted', type: 'info' }); } catch {}
  }, [id]);

  // NEW: unmute all
  const handleUnmuteAll = useCallback(async () => {
    try { await api.patch(`/live-classes/${id}/unmute-all`); showMessage({ message: '🎙️ All unmuted', type: 'success' }); } catch {}
  }, [id]);

  // NEW: lower all hands
  const handleLowerAllHands = useCallback(async () => {
    try {
      await api.post(`/live-classes/${id}/hand/lower-all`);
      setHands([]);
      setParticipants(prev => prev.map(p => ({ ...p, handRaised: false })));
      showMessage({ message: '✋ All hands lowered', type: 'info' });
    } catch {}
  }, [id]);

  // NEW: delete a chat message (long-press)
  const handleDeleteMessage = useCallback(async (messageId: string) => {
    try {
      await api.delete(`/live-classes/${id}/messages/${messageId}`);
      setChatMessages(prev => prev.filter(m => m.id !== messageId));
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to delete', type: 'danger' });
    }
  }, [id]);

  const handleApproveHand = useCallback(async (userId: string) => {
    try {
      await api.post(`/live-classes/${id}/hand/approve/${userId}`);
      setHands(prev => prev.filter(h => h.userId !== userId));
      showMessage({ message: '✅ Student can now speak', type: 'success' });
    } catch (e: any) { showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }); }
  }, [id]);

  const handleRejectHand = useCallback(async (userId: string) => {
    try {
      await api.post(`/live-classes/${id}/hand/reject/${userId}`);
      setHands(prev => prev.filter(h => h.userId !== userId));
    } catch {}
  }, [id]);

  const handleMuteParticipant = useCallback(async (userId: string, muted: boolean) => {
    try { await api.patch(`/live-classes/${id}/participants/${userId}/mute`, { muted }); } catch {}
  }, [id]);

  const handleKickParticipant = useCallback((userId: string, name: string) => {
    Alert.alert('Remove Student', `Remove ${name} from the class?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await api.delete(`/live-classes/${id}/participants/${userId}`); setParticipants(prev => prev.filter(p => p.userId !== userId)); } catch {}
      }},
    ]);
  }, [id]);

  // Move an active speaker back to audience — clears speakerSlot so they leave the grid
  const handleDemoteFromStage = useCallback(async (userId: string, name: string) => {
    Alert.alert('Move to Audience', `Move ${name} from stage to audience?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move', onPress: async () => {
        try {
          await api.post(`/live-classes/${id}/demote/${userId}`);
          setParticipants(prev => prev.map(p =>
            p.userId === userId ? { ...p, isMuted: true, speakerSlot: null } : p
          ));
          showMessage({ message: `${name} moved to audience`, type: 'info', duration: 2000 });
        } catch (e: any) {
          showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
        }
      }},
    ]);
  }, [id]);

  // Invite an audience member directly onto the stage (no hand raise needed)
  // Assigns speakerSlot 0 optimistically; the server will broadcast liveclass:speaker_added
  // with the real slot index which will then correct it via the socket handler.
  const handleInviteToStage = useCallback(async (userId: string, name: string) => {
    try {
      const res = await api.post(`/live-classes/${id}/invite/${userId}`);
      const assignedSlot: number | null =
        typeof res?.data?.data?.speakerSlot === 'number' ? res.data.data.speakerSlot : null;
      setParticipants(prev => prev.map(p =>
        p.userId === userId
          ? { ...p, isMuted: false, speakerSlot: assignedSlot }
          : p
      ));
      showMessage({ message: `🎙 ${name} invited to stage`, type: 'success', duration: 2000 });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    }
  }, [id]);

  // Promote a participant to MODERATOR role — NOT IMPLEMENTED (no backend endpoint)
  // PARITY-NOTE: POST /live-classes/:id/moderator/:uid does not exist.
  // Showing a clear message rather than silently failing an API call.
  const handlePromoteModerator = useCallback((_userId: string, name: string) => {
    showMessage({
      message: `Moderator promotion not available`,
      description: 'This feature is not yet implemented.',
      type: 'info',
      duration: 2500,
    });
  }, []);

  // Demote a MODERATOR back to STUDENT — NOT IMPLEMENTED (no backend endpoint)
  const handleDemoteModerator = useCallback((_userId: string, name: string) => {
    showMessage({
      message: `Moderator demotion not available`,
      description: 'This feature is not yet implemented.',
      type: 'info',
      duration: 2500,
    });
  }, []);

  // DEL-HOST: Assign a delegated operational host — CREATOR ONLY.
  // Calls PATCH /live-classes/:id/host. Only wired to UI when isCreator is true.
  // The delegated host gets HOST role for the session; creator retains ownership.
  const handleAssignHost = useCallback((targetUserId: string, name: string) => {
    Alert.alert(
      'Assign Delegated Host',
      `Make ${name} the operational host for this session? You remain the class owner.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Assign',
          onPress: async () => {
            try {
              await api.patch(`/live-classes/${id}/host`, { userId: targetUserId });
              showMessage({ message: `✅ ${name} is now the delegated host`, type: 'success', duration: 2500 });
              qc.invalidateQueries({ queryKey: ['live-class', id] });
            } catch (e: any) {
              showMessage({
                message: e?.response?.data?.message ?? 'Failed to assign delegated host',
                type: 'danger',
                duration: 3000,
              });
            }
          },
        },
      ],
    );
  }, [id, qc]);

  const sendChat = useCallback(async () => {
    if (!chatText.trim() || !user) return;
    const text = chatText.trim(); setChatText('');
    // Fix: use firstName/lastName not user.name (which doesn't exist on auth store)
    const displayName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Me';
    const temp: ChatMessage = { id: `tmp-${Date.now()}`, userId: user.id, userName: displayName, message: text, timestamp: new Date() };
    setChatMessages(prev => [...prev, temp]);
    setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 80);
    try { await api.post(`/live-classes/${id}/messages`, { body: text }); } catch {}
  }, [chatText, user, id]);

  const toggleHand = useCallback(async () => {
    if (!isJoined) return;
    try {
      if (!handRaised) {
        const res = await api.post(`/live-classes/${id}/hand/raise`);
        const autoApproved = res?.data?.data?.autoApproved ?? false;
        if (autoApproved) {
          showMessage({ message: '🎙 You joined the stage!', type: 'success', duration: 2000 });
          // grant_mic socket event will arrive and trigger LiveKit reconnect
        } else {
          setHandRaised(true);
          showMessage({ message: '✋ Hand raised', type: 'info', duration: 1500 });
        }
      } else {
        await api.post(`/live-classes/${id}/hand/lower`);
        setHandRaised(false);
      }
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message ?? 'Failed', type: 'danger', duration: 2000 });
    }
  }, [id, isJoined, handRaised]);

  // NEW: send emoji reaction to all participants
  const REACTIONS = ['👍','❤️','😂','😮','👏','🔥','🎉','💯'];
  const sendReaction = useCallback(async (emoji: string) => {
    const socket = getSocket();
    if (socket) socket.emit('liveclass:reaction', { liveClassId: id, emoji });
  }, [id]);

  // ── Unified participant action sheet (all joined users) ───────────────────
  // React / Follow / DM available to everyone.
  // Spotlight + moderation actions visible to HOST only.
  // Placed here so all required handlers (handleMuteParticipant etc.) are in scope.
  const showParticipantSheet = useCallback((
    speakerUserId: string,
    speakerName: string,
    isCurrentlySelected: boolean,
  ) => {
    const isSelf = speakerUserId === user?.id;
    const currentFollowing = followMap[speakerUserId] ?? false;

    const actions: Array<{ text: string; style?: 'cancel'|'destructive'; onPress?: () => void }> = [
      { text: 'Cancel', style: 'cancel' },
    ];

    // HOST-only: spotlight toggle
    if (isHost) {
      actions.push({
        text: isCurrentlySelected
          ? '⊠ Remove spotlight (back to grid)'
          : '⊡ Spotlight (make primary video)',
        onPress: () => setSelectedParticipantId(isCurrentlySelected ? null : speakerUserId),
      });
    }

    // Everyone: React with emoji (opens reactions picker)
    actions.push({
      text: '😊 React with emoji',
      onPress: () => setShowReactions(true),
    });

    // Everyone (not self): Follow/Unfollow
    if (!isSelf) {
      actions.push({
        text: currentFollowing ? `✓ Unfollow ${speakerName}` : `+ Follow ${speakerName}`,
        onPress: () => handleFollowUser(speakerUserId),
      });
    }

    // Everyone (not self): Send private message
    if (!isSelf) {
      actions.push({
        text: '💬 Send private message',
        onPress: () => openDmWithUser(speakerUserId),
      });
    }

    // HOST-only: moderation
    if (isHost && !isSelf) {
      actions.push(
        { text: '🔇 Mute', onPress: () => handleMuteParticipant(speakerUserId, true) },
        { text: '⬇️ Move to audience', onPress: () => handleDemoteFromStage(speakerUserId, speakerName) },
        { text: '🚫 Remove from class', style: 'destructive', onPress: () => handleKickParticipant(speakerUserId, speakerName) },
      );
    }

    Alert.alert(speakerName, 'Participant actions', actions);
  }, [
    user?.id, isHost, followMap,
    setSelectedParticipantId, setShowReactions,
    handleFollowUser, openDmWithUser,
    handleMuteParticipant, handleDemoteFromStage, handleKickParticipant,
  ]);

  // NEW: request to speak (student sends request to host)
  const handleSpeakRequest = useCallback(async () => {
    if (!isJoined || isHost) return;
    try {
      await api.post(`/live-classes/${id}/speak-request`);
      showMessage({ message: '🙋 Speak request sent to host', type: 'info', duration: 2000 });
    } catch {}
  }, [id, isJoined, isHost]);

  // MIC-02: Drop mic — speaker returns to audience, frees a slot, clears speakerSlot
  const handleDropMic = useCallback(async () => {
    if (!isJoined) return;
    try {
      await api.post(`/live-classes/${id}/drop-mic`);
      setIsMuted(true);
      // Clear own speakerSlot so we leave the grid immediately
      if (user?.id) {
        setParticipants(prev => prev.map(p =>
          p.userId === user.id ? { ...p, isMuted: true, speakerSlot: null } : p
        ));
      }
      showMessage({ message: '🎙 Mic dropped — returned to audience', type: 'info', duration: 2000 });
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message ?? 'Failed to drop mic', type: 'danger', duration: 2000 });
    }
  }, [id, isJoined, user?.id]);

  // NEW: host toggles open mic
  const handleToggleOpenMic = useCallback(async () => {
    try {
      await api.post(`/live-classes/${id}/open-mic`);
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    }
  }, [id]);

  // NEW: host toggles recording
  const handleToggleRecording = useCallback(async () => {
    try {
      if (!isRecording) {
        await api.post(`/live-classes/${id}/recording/start`);
      } else {
        await api.post(`/live-classes/${id}/recording/stop`);
      }
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    }
  }, [id, isRecording]);

  // ── Advanced teaching tool action handlers ──────────────────────────────────

  // Poll event: apply locally + broadcast via API
  const handlePollEvent = useCallback(async (ev: PollEvent) => {
    setPolls(prev => {
      if (ev.type === 'create' && ev.poll) {
        if (prev.find(p => p.id === ev.poll!.id)) return prev;
        return [ev.poll!, ...prev];
      }
      if (ev.type === 'vote' && ev.pollId && ev.optionId && ev.userId) {
        return prev.map(p => p.id === ev.pollId ? {
          ...p,
          options: p.options.map(o => {
            if (o.id !== ev.optionId) {
              // DI-02 FIX: remove this voter from other options (single-choice dedup)
              return { ...o, votes: o.votes.filter((v: string) => v !== ev.userId) };
            }
            // Idempotent add — skip if already present (prevents double from echo)
            if (o.votes.includes(ev.userId!)) return o;
            return { ...o, votes: [...o.votes, ev.userId!] };
          }),
        } : p);
      }
      if (ev.type === 'close' && ev.pollId) {
        return prev.map(p => p.id === ev.pollId ? { ...p, isActive: false } : p);
      }
      return prev;
    });
  }, []);

  // Quran position: set locally + POST to broadcast
  const handleQuranPosition = useCallback(async (pos: QuranPosition) => {
    setQuranPosition(pos);
  }, []);

  // Whiteboard draw: POST to broadcast (host only — panel calls onDraw → this)
  const handleDraw = useCallback(async (event: DrawEvent) => {
    try {
      await api.post(`/live-classes/${id}/whiteboard`, { event });
    } catch {}
  }, [id]);

  // Toggle screen sharing (requires native LiveKit build)
  // P2-05 (PLAT-02): Check platform capability before attempting setScreenShareEnabled.
  // - lk.connected: must have a live LiveKit connection
  // - (lk as any).room: audio-only hook; video/screen share requires full Room instance
  // - setScreenShareEnabled: available in @livekit/react-native v2+ native builds only
  //   It is NOT available in Expo Go — throws synchronously with "not implemented"
  //   On iOS it additionally requires a Broadcast Extension target (native build only)
  // Detection: probe for the function at call time; show a clear message if absent.
  const handleToggleScreenShare = useCallback(async () => {
    if (!lk.connected) {
      showMessage({ message: 'Audio not connected', type: 'warning', duration: 2000 }); return;
    }
    const participant = (lk as any).room?.localParticipant;
    if (!participant || typeof participant.setScreenShareEnabled !== 'function') {
      // Screen share requires a native custom build with @livekit/react-native-webrtc.
      // It is not available in Expo Go or in audio-only builds.
      showMessage({
        message: '📵 Screen share not available',
        description: Platform.OS === 'ios'
          ? 'Screen share requires a custom iOS build with a Broadcast Extension.'
          : 'Screen share requires a custom native build (not available in Expo Go).',
        type: 'info',
        duration: 4000,
      });
      return;
    }
    try {
      const next = !isScreenSharing;
      await participant.setScreenShareEnabled(next);
      setIsScreenSharing(next);
      const socket = getSocket();
      if (socket) {
        socket.emit(next ? 'liveclass:screen_share_started' : 'liveclass:screen_share_stopped',
          { liveClassId: id });
      }
    } catch (e: any) {
      // Catch runtime errors (permission denied, platform restriction, etc.)
      setIsScreenSharing(false); // reset state to avoid stuck UI
      const msg = e?.message?.toLowerCase() ?? '';
      if (msg.includes('permission') || msg.includes('denied')) {
        showMessage({ message: '📵 Screen share permission denied', type: 'warning', duration: 3000 });
      } else if (msg.includes('not supported') || msg.includes('not implemented')) {
        showMessage({
          message: '📵 Screen share not supported on this device/build',
          type: 'info',
          duration: 4000,
        });
      } else {
        showMessage({ message: 'Screen share failed', type: 'danger', duration: 2500 });
      }
    }
  }, [id, lk, isScreenSharing]);

  // ── Camera toggle ─────────────────────────────────────────────────────────
  const handleToggleCamera = useCallback(async () => {
    if (!lk.connected) {
      showMessage({ message: 'Join the class first', type: 'warning', duration: 2000 });
      return;
    }
    const participant = (lk as any).room?.localParticipant;
    if (!participant || typeof participant.setCameraEnabled !== 'function') {
      showMessage({
        message: '📷 Camera requires native build',
        description: 'Run "eas build" or "expo run:android" to enable camera in live classes.',
        type: 'info',
        duration: 5000,
      });
      return;
    }
    try {
      const next = !isCameraOn;
      await participant.setCameraEnabled(next);
      setIsCameraOn(next);
      // MOB-DUP FIX: Removed redundant socket.emit('liveclass:video_changed') here.
      // The API PATCH below calls setVideoState on the backend, which already emits
      // liveclass:video_changed to the room via Socket.IO. Emitting from the client
      // socket as well caused room members to receive the event twice.
      // DB persistence + server-side relay via API is the single canonical path.
      if (user?.id) {
        await api.patch(`/live-classes/${id}/participants/${user.id}/video`, { isVideoOn: next }).catch(() => {});
      }
      showMessage({
        message: next ? '📷 Camera on' : '📷 Camera off',
        type: 'info',
        duration: 1500,
      });
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('permission') || msg.includes('denied')) {
        showMessage({
          message: '📷 Camera permission denied',
          description: 'Go to Settings → Apps → HALQA → Permissions → Camera → Allow',
          type: 'danger',
          duration: 6000,
        });
      } else {
        showMessage({ message: `Camera error: ${e?.message ?? 'unknown'}`, type: 'danger', duration: 3000 });
      }
      setIsCameraOn(false);
    }
  }, [id, lk, isCameraOn, user?.id]);

  if (isLoading) return <View style={styles.centered}><ActivityIndicator size="large" color="#4f46e5" /></View>;
  if (!liveClass) return <View style={styles.centered}><Text style={styles.errorText}>Class not found</Text></View>;

  type TabKey = 'video' | 'chat' | 'whiteboard' | 'quran' | 'polls' | 'controls';
  const tabs: Array<{ key: TabKey; icon: string; label: string }> = [
    { key: 'video',  icon: 'videocam-outline',    label: 'Stream' },
    { key: 'chat',   icon: 'chatbubbles-outline',  label: 'Chat' },
    ...((liveClass as any).whiteboardEnabled || activePanel === 'whiteboard' ? [{ key: 'whiteboard' as TabKey, icon: 'pencil-outline', label: 'Board' }] : []),
    ...((liveClass as any).quranPanelEnabled  || quranPosition !== null     ? [{ key: 'quran'     as TabKey, icon: 'book-outline',   label: 'Quran' }] : []),
    ...(isHost || polls.length > 0 ? [{ key: 'polls' as TabKey, icon: 'bar-chart-outline', label: 'Polls' }] : []),
    ...(isHost ? [{ key: 'controls' as TabKey, icon: 'settings-outline', label: 'Controls' }] : []),
  ];

  return (
    <>
      <Stack.Screen options={{
        headerShown: !isFullscreen,
        title: liveClass.title,
        headerTintColor: '#4f46e5',
        headerStyle: { backgroundColor: '#0f0f23' },
        headerTitleStyle: { color: '#fff' },
      }} />
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Tab bar — hidden in fullscreen */}
        {!isFullscreen && (
          <View style={styles.tabs}>
            {tabs.map(t => (
              <TouchableOpacity key={t.key} style={[styles.tab, activeTab === t.key && styles.tabActive]}
                onPress={() => setActiveTab(t.key as any)}>
                <Ionicons name={t.icon as any} size={16} color={activeTab === t.key ? '#a5b4fc' : '#6b7280'} />
                <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
                {t.key === 'controls' && hands.length > 0 && (
                  <View style={styles.badge}><Text style={styles.badgeText}>{hands.length}</Text></View>
                )}
                {t.key === 'polls' && polls.filter(p => p.isActive).length > 0 && (
                  <View style={styles.badge}><Text style={styles.badgeText}>{polls.filter(p => p.isActive).length}</Text></View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── STREAM TAB ──────────────────────────────────────────────── */}
        {activeTab === 'video' && (
          <TouchableOpacity
            activeOpacity={1}
            onPress={handleFsTap}
            style={[
              styles.videoArea,
              // Fullscreen: expand to fill the whole screen (behind tabs, over header)
              isFullscreen && StyleSheet.absoluteFillObject,
              isFullscreen && { zIndex: 100, backgroundColor: '#000' },
              // SPRINT-3: Portrait-first for PUBLIC streams — full height even before fullscreen
              !isFullscreen && isPublicStream && liveClass.status === 'LIVE' && {
                height: screenHeight * 0.72,
                maxHeight: 560,
              },
            ]}
          >
            {/* Fullscreen: top overlay — back button + title + LIVE + exit fullscreen */}
            {isFullscreen && (
              <View style={[
                fsSt.topBar,
                { opacity: showFsOverlay ? 1 : 0 },
                { paddingTop: insets.top + 4 },
              ]} pointerEvents={showFsOverlay ? 'auto' : 'none'}>
                <TouchableOpacity onPress={handleToggleFullscreen} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="contract-outline" size={22} color="#fff" />
                </TouchableOpacity>
                <Text style={fsSt.topTitle} numberOfLines={1}>{liveClass.title}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {liveClass.status === 'LIVE' && (
                    <View style={styles.livePill}>
                      <View style={styles.liveDot} />
                      <Text style={styles.liveText}>LIVE</Text>
                    </View>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="people-outline" size={14} color="#a5b4fc" />
                    <Text style={{ color: '#a5b4fc', fontSize: 12, fontWeight: '600' }}>
                      {participants.length}
                    </Text>
                  </View>
                </View>
              </View>
            )}
            {/* Recording indicator */}
            {isRecording && (
              <View style={styles.recordingBadge}>
                <View style={styles.recDot} />
                <Text allowFontScaling={false} style={styles.recTxt}>REC</Text>
              </View>
            )}
            {/* Floating emoji reaction */}
            {floatingEmoji && (
              <View style={styles.floatingEmojiWrap} pointerEvents="none">
                <Text style={styles.floatingEmojiText}>{floatingEmoji.emoji}</Text>
              </View>
            )}
            <View style={styles.videoPlaceholder}>
              {isJoined ? (
                activeSpeakers.length > 0 ? (
                  /* ── SPEAKER GRID — shown when at least one participant is on stage ── */
                  <View style={styles.speakerGridWrap}>
                    {/* Live / OpenMic badges */}
                    <View style={styles.speakerGridBadgeRow}>
                      <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>
                      {isOpenMic && <Text allowFontScaling={false} style={styles.openMicBadge}>🎤 Open Mic</Text>}
                      {isRecording && <View style={[styles.livePill, { backgroundColor: '#fef2f2', marginLeft: 4 }]}><View style={[styles.liveDot, { backgroundColor: '#ef4444' }]} /><Text style={[styles.liveText, { color: '#ef4444' }]}>REC</Text></View>}
                      {/* Full screen toggle — expands video to fill entire screen */}
                      {isJoined && (
                        <TouchableOpacity
                          onPress={handleToggleFullscreen}
                          style={fsSt.fsBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityLabel={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
                        >
                          <Ionicons
                            name={isFullscreen ? 'contract-outline' : 'expand-outline'}
                            size={16}
                            color="#e5e7eb"
                          />
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* TikTok-style video grid with Spotlight support.
                        ── SPOTLIGHT MODE: when selectedParticipantId is set,
                           shows primary large tile + horizontal secondary strip.
                        ── GRID MODE: existing 4-column LiveVideoGrid (unchanged).
                        Single tap = spotlight select/deselect.
                        Long press = existing host moderation actions (unchanged). */}
                    {selectedParticipantId && videoSpeakers.find(s => s.userId === selectedParticipantId) ? (() => {
                      const primary = videoSpeakers.find(s => s.userId === selectedParticipantId)!;
                      const secondaries = videoSpeakers.filter(s => s.userId !== selectedParticipantId);
                      return (
                        <View style={{ flex: 1 }}>
                          {/* Primary large tile — tap opens unified action sheet */}
                          <TouchableOpacity
                            activeOpacity={0.9}
                            onPress={() => {
                              // Tap primary tile → full participant action sheet (React/Follow/DM + HOST actions)
                              if (primary.userId === user?.id) return;
                              showParticipantSheet(primary.userId, primary.displayName, true);
                            }}
                            onLongPress={() => {
                              if (primary.userId === user?.id) return;
                              showParticipantSheet(primary.userId, primary.displayName, true);
                            }}
                            style={[
                              styles.speakerGrid,
                              { flex: 1, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: '#4f46e5' },
                            ]}
                            accessibilityLabel={`${primary.displayName} — tap to return to grid`}
                          >
                            {/* Reuse LiveVideoGrid for a single-tile render */}
                            <LiveVideoGrid
                              speakers={[primary]}
                              currentUserId={user?.id ?? ''}
                              isHost={isHost}
                              style={{ flex: 1 }}
                            />
                            {/* "Tap to return" hint — visible to Host only */}
                            {isHost && (
                            <View style={{
                              position: 'absolute', top: 8, right: 8,
                              backgroundColor: 'rgba(79,70,229,0.85)', borderRadius: 8,
                              paddingHorizontal: 8, paddingVertical: 3,
                            }} pointerEvents="none">
                              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                                ✕ Return to grid
                              </Text>
                            </View>
                            )}
                          </TouchableOpacity>

                          {/* Secondary horizontal strip */}
                          {secondaries.length > 0 && (
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              style={{ maxHeight: 90, marginTop: 4 }}
                              contentContainerStyle={{ gap: 4, paddingHorizontal: 2 }}
                            >
                              {secondaries.map(s => (
                                <TouchableOpacity
                                  key={s.userId}
                                  onPress={() => {
                                    // Tap secondary tile → unified action sheet (React/Follow/DM + HOST spotlight/mods)
                                    if (s.userId === user?.id) return;
                                    showParticipantSheet(s.userId, s.displayName, false);
                                  }}
                                  onLongPress={() => {
                                    if (s.userId === user?.id) return;
                                    showParticipantSheet(s.userId, s.displayName, false);
                                  }}
                                  style={{ width: 80, height: 80, borderRadius: 10, overflow: 'hidden' }}
                                  accessibilityLabel={`${s.displayName} — tap to spotlight`}
                                >
                                  <LiveVideoGrid
                                    speakers={[s]}
                                    currentUserId={user?.id ?? ''}
                                    isHost={isHost}
                                    style={{ width: 80, height: 80 }}
                                  />
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                          )}
                        </View>
                      );
                    })() : (
                      // ── GRID MODE (Option A parity: single tap opens action sheet, HOST gets spotlight option) ──
                      <LiveVideoGrid
                        speakers={videoSpeakers}
                        currentUserId={user?.id ?? ''}
                        isHost={isHost}
                        onPressTile={(speaker) => {
                          // Single tap → unified participant action sheet (Option A parity)
                          // Contains: React, Follow, DM (everyone), Spotlight + moderation (HOST only)
                          if (speaker.userId === user?.id) return; // no action on own tile
                          showParticipantSheet(
                            speaker.userId,
                            speaker.displayName,
                            selectedParticipantId === speaker.userId,
                          );
                        }}
                        onLongPressTile={(speaker) => {
                          // Long press → same action sheet (alternative gesture, same actions)
                          if (speaker.userId === user?.id) return;
                          showParticipantSheet(
                            speaker.userId,
                            speaker.displayName,
                            selectedParticipantId === speaker.userId,
                          );
                        }}
                        style={styles.speakerGrid}
                      />
                    )}

                    {/* Participant count + view-all */}
                    <View style={styles.participantCount}>
                      <Ionicons name="people-outline" size={14} color="#a5b4fc" />
                      <Text style={styles.participantCountText}>
                        {participants.length || liveClass.participantsCount} joined · {activeSpeakers.length} on stage
                      </Text>
                      <TouchableOpacity onPress={() => setShowParticipants(true)} style={styles.viewAllBtn}>
                        <Text style={styles.viewAllText}>View all</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Audience status banner for non-stage participants */}
                    {!isHost && !myParticipantRole?.includes('MODERATOR') && (() => {
                      const me = participants.find(p => p.userId === user?.id);
                      if (typeof me?.speakerSlot === 'number') return null; // already on stage
                      return (
                        <View style={styles.audienceBanner}>
                          <Text style={styles.audienceBannerText}>
                            {me?.handRaised ? '✋ Waiting for host approval…' : '👥 You are in the audience'}
                          </Text>
                          <TouchableOpacity
                            style={[styles.audienceBannerBtn, me?.handRaised && { backgroundColor: '#374151' }]}
                            onPress={toggleHand}
                          >
                            <Text style={[styles.audienceBannerBtnText, me?.handRaised && { color: '#fbbf24' }]}>
                              {me?.handRaised ? 'Cancel request' : '✋ Request to speak'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })()}

                    {/* Audience avatar grid — unlimited, 5 columns, scrollable with page */}
                    {(() => {
                      const audienceList = participants.filter(p =>
                        p.role !== 'HOST' && p.role !== 'MODERATOR' &&
                        p.speakerSlot == null && !p.handRaised
                      );
                      if (audienceList.length === 0) return null;
                      return (
                        <View style={{ marginTop: 10, backgroundColor: 'rgba(17,24,39,0.6)', borderRadius: 14, padding: 10, borderWidth: 1, borderColor: '#1e293b' }}>
                          <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '700', marginBottom: 8 }}>
                            👥 Audience ({audienceList.length})
                          </Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {audienceList.map(p => {
                              const name = `${p.firstName} ${p.lastName}`.trim();
                              const initials = `${p.firstName?.[0] ?? ''}${p.lastName?.[0] ?? ''}`.toUpperCase();
                              const src = p.avatarUrl ? avatarUrl(p.avatarUrl, name) : null;
                              return (
                                <View key={p.userId} style={{ width: '17%', alignItems: 'center', gap: 3 }}>
                                  <View style={{ width: 44, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: '#312e81', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#4338ca' }}>
                                    {src
                                      ? <Image source={{ uri: src }} style={{ width: 44, height: 44 }} />
                                      : <Text style={{ color: '#a5b4fc', fontWeight: '700', fontSize: 14 }}>{initials}</Text>
                                    }
                                  </View>
                                  <Text style={{ color: '#9ca3af', fontSize: 8, textAlign: 'center' }} numberOfLines={1}>{name}</Text>
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })()}
                  </View>
                ) : viewMode === 'audio' ? (
                  /* Audio-only mode: show avatar circles (no speakers on stage yet) */
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={styles.hostAudioCircle}>
                      <Image source={{ uri: avatarUrl(liveClass.host.avatar, liveClass.host.name) }} style={styles.hostAvatarLarge} />
                      <View style={styles.audioWave}><Ionicons name="radio-outline" size={16} color="#4f46e5" /></View>
                    </View>
                    <Text style={styles.hostVideoLabel}>{liveClass.host.name}</Text>
                    <Text style={styles.audioModeLabel}>🎵 Audio Mode</Text>
                    {isOpenMic && <Text allowFontScaling={false} style={styles.openMicBadge}>🎤 Open Mic</Text>}
                    {isHost && (
                      <TouchableOpacity style={styles.viewModeToggle} onPress={async () => {
                        const next = (viewMode as string) === 'video' ? 'audio' : 'video' as 'video' | 'audio';
                        setViewMode(next as 'video' | 'audio');
                        const socket = getSocket();
                        socket?.emit('liveclass:viewmode_changed', { liveClassId: id, viewMode: next });
                      }}>
                        <Ionicons name="videocam-outline" size={14} color="#a5b4fc" />
                        <Text style={styles.viewModeToggleText}>Switch to Video</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  /* Video mode — no speakers on stage yet, show host placeholder */
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={styles.hostVideo}>
                      <Image source={{ uri: avatarUrl(liveClass.host.avatar, liveClass.host.name) }} style={styles.hostAvatar} />
                      <Text style={styles.hostVideoLabel}>{liveClass.host.name}</Text>
                      <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>
                      {isOpenMic && <Text allowFontScaling={false} style={styles.openMicBadge}>🎤 Open Mic</Text>}
                    </View>
                    <Text style={styles.videoNote}>📱 Camera available — tap the Camera button below to enable</Text>
                    <View style={styles.participantCount}>
                      <Ionicons name="people-outline" size={14} color="#a5b4fc" />
                      <Text style={styles.participantCountText}>{participants.length || liveClass.participantsCount} joined</Text>
                      <TouchableOpacity onPress={() => setShowParticipants(true)} style={styles.viewAllBtn}>
                        <Text style={styles.viewAllText}>View all</Text>
                      </TouchableOpacity>
                    </View>
                    {isHost && (
                      <TouchableOpacity style={styles.viewModeToggle} onPress={async () => {
                        const next = 'audio';
                        setViewMode(next);
                        const socket = getSocket();
                        socket?.emit('liveclass:viewmode_changed', { liveClassId: id, viewMode: next });
                      }}>
                        <Ionicons name="musical-note-outline" size={14} color="#a5b4fc" />
                        <Text style={styles.viewModeToggleText}>Switch to Audio Mode</Text>
                      </TouchableOpacity>
                    )}
                    {/* Audience status banner — shown to non-host participants not yet on stage */}
                    {!isHost && !myParticipantRole?.includes('MODERATOR') && (() => {
                      const me = participants.find(p => p.userId === user?.id);
                      if (typeof me?.speakerSlot === 'number') return null;
                      return (
                        <View style={styles.audienceBanner}>
                          <Text style={styles.audienceBannerText}>
                            {me?.handRaised ? '✋ Waiting for host approval…' : '👥 You are in the audience'}
                          </Text>
                          <TouchableOpacity
                            style={[styles.audienceBannerBtn, me?.handRaised && { backgroundColor: '#374151' }]}
                            onPress={toggleHand}
                          >
                            <Text style={[styles.audienceBannerBtnText, me?.handRaised && { color: '#fbbf24' }]}>
                              {me?.handRaised ? 'Cancel request' : '✋ Request to speak'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })()}

                    {/* Audience avatar grid — placeholder video mode */}
                    {(() => {
                      const audienceList = participants.filter(p =>
                        p.role !== 'HOST' && p.role !== 'MODERATOR' &&
                        p.speakerSlot == null && !p.handRaised
                      );
                      if (audienceList.length === 0) return null;
                      return (
                        <View style={{ marginTop: 10, backgroundColor: 'rgba(17,24,39,0.6)', borderRadius: 14, padding: 10, borderWidth: 1, borderColor: '#1e293b', width: '100%' }}>
                          <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '700', marginBottom: 8 }}>
                            👥 Audience ({audienceList.length})
                          </Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {audienceList.map(p => {
                              const name = `${p.firstName} ${p.lastName}`.trim();
                              const initials = `${p.firstName?.[0] ?? ''}${p.lastName?.[0] ?? ''}`.toUpperCase();
                              const src = p.avatarUrl ? avatarUrl(p.avatarUrl, name) : null;
                              return (
                                <View key={p.userId} style={{ width: '17%', alignItems: 'center', gap: 3 }}>
                                  <View style={{ width: 44, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: '#312e81', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#4338ca' }}>
                                    {src
                                      ? <Image source={{ uri: src }} style={{ width: 44, height: 44 }} />
                                      : <Text style={{ color: '#a5b4fc', fontWeight: '700', fontSize: 14 }}>{initials}</Text>
                                    }
                                  </View>
                                  <Text style={{ color: '#9ca3af', fontSize: 8, textAlign: 'center' }} numberOfLines={1}>{name}</Text>
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })()}
                  </View>
                )
              ) : (
                <View style={[styles.preJoin, { flex: 1, alignItems: 'center', justifyContent: 'center' }]}>
                  {/* Cover image — shown when available (public streams + school classes) */}
                  {(liveClass as any).coverImageUrl ? (
                    <Image
                      source={{ uri: avatarUrl((liveClass as any).coverImageUrl, liveClass.title) }}
                      style={styles.coverImage}
                      resizeMode="cover"
                      accessibilityLabel={`Cover image for ${liveClass.title}`}
                    />
                  ) : (
                    <Ionicons name="videocam-off-outline" size={48} color="#6b7280" />
                  )}
                  <Text style={styles.preJoinTitle}>{liveClass.title}</Text>
                  {(liveClass as any).streamType === 'PUBLIC' && (
                    <View style={[styles.publicBadge, { marginBottom: 4 }]}>
                      <Text style={styles.publicBadgeText}>🌐 Public Live Stream</Text>
                    </View>
                  )}
                  <Text style={styles.preJoinHost}>Hosted by {liveClass.host.name}</Text>
                  <View style={styles.statusBadge}>
                    <View style={[styles.statusDot, { backgroundColor: liveClass.status === 'LIVE' ? '#10b981' : liveClass.status === 'SCHEDULED' ? '#f59e0b' : '#6b7280' }]} />
                    <Text style={styles.statusText}>{liveClass.status}</Text>
                  </View>
                  {isHost && liveClass.status === 'SCHEDULED' && (
                    <TouchableOpacity style={[styles.joinClassBtn, { backgroundColor: '#10b981' }]} onPress={handleStartClass}>
                      <Ionicons name="play" size={18} color="#fff" />
                      <Text style={styles.joinClassBtnText}>Start Class</Text>
                    </TouchableOpacity>
                  )}
                  {(liveClass.status === 'LIVE' || (isHost && liveClass.status === 'SCHEDULED')) && (
                    <TouchableOpacity style={styles.joinClassBtn} onPress={handleJoin} disabled={isConnecting}>
                      {isConnecting ? <ActivityIndicator color="#fff" /> : <><Ionicons name="enter-outline" size={20} color="#fff" /><Text style={styles.joinClassBtnText}>{liveClass.status === 'LIVE' ? 'Join Class' : 'Enter Room'}</Text></>}
                    </TouchableOpacity>
                  )}
                  {liveClass.status === 'SCHEDULED' && !isHost && liveClass.scheduledAt && (
                    <Text style={styles.scheduledText}>Starts {formatDistanceToNow(new Date(liveClass.scheduledAt), { addSuffix: true })}</Text>
                  )}
                  {liveClass.status === 'ENDED' && <Text style={styles.endedText}>This class has ended</Text>}
                </View>
              )}
            </View>

            {/* ── Persistent fullscreen FAB ─────────────────────────────────
                 Pinned to bottom-right of the video area in ALL states:
                 speaker grid, audio-only, host placeholder, and pre-join.
                 Not shown in fullscreen (top/right-strip handles exit there). */}
            {!isFullscreen && (
              <TouchableOpacity
                onPress={handleToggleFullscreen}
                style={{
                  position: 'absolute',
                  bottom: 10,
                  right: 10,
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 20,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.18)',
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Enter full screen"
                accessibilityRole="button"
              >
                <Ionicons name="expand-outline" size={17} color="#fff" />
              </TouchableOpacity>
            )}
            {/* Info card — hidden in fullscreen (overlay handles it) */}
            {!isFullscreen && (
              <View style={styles.infoCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={styles.infoTitle}>{liveClass.title}</Text>
                  {(liveClass as any).streamType === 'PUBLIC' && (
                    <View style={styles.publicBadge}>
                      <Text style={styles.publicBadgeText}>🌐 Public</Text>
                    </View>
                  )}
                </View>
                {liveClass.description ? <Text style={styles.infoDesc}>{liveClass.description}</Text> : null}
                {/* SPRINT-4: Share + Follow row — available for all stream types */}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {/* Follow host button (hide for own stream) */}
                    {!isOwnStream && hostUserId && (
                      <TouchableOpacity
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 5,
                          backgroundColor: isFollowing ? '#1e293b' : '#ef4444',
                          paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                        }}
                        onPress={handleFollowHost}
                        disabled={followLoading[hostUserId] ?? false}
                        accessibilityLabel={isFollowing ? 'Unfollow host' : 'Follow host'}
                      >
                        {(followLoading[hostUserId] ?? false)
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Ionicons name={isFollowing ? 'checkmark' : 'add'} size={14} color="#fff" />
                        }
                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                          {isFollowing ? 'Following' : 'Follow'}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {/* Share button — opens rich share modal */}
                    <TouchableOpacity
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 5,
                        backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
                        paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                      }}
                      onPress={handleShare}
                      accessibilityLabel="Share stream"
                    >
                      <Ionicons name="share-social-outline" size={14} color="#a5b4fc" />
                      <Text style={{ color: '#a5b4fc', fontWeight: '700', fontSize: 13 }}>Share</Text>
                    </TouchableOpacity>
                  </View>
              </View>
            )}

            {/* ── Full Screen bottom-left info overlay (TikTok style) ── */}
            {isFullscreen && (
              <View
                style={[fsSt.bottomInfo, { bottom: insets.bottom + 80, opacity: showFsOverlay ? 1 : 0 }]}
                pointerEvents="none"
              >
                <Text style={fsSt.bottomTitle} numberOfLines={1}>{liveClass.title}</Text>
                {liveClass.description ? (
                  <Text style={fsSt.bottomDesc} numberOfLines={2}>{liveClass.description}</Text>
                ) : null}
                <Text style={fsSt.bottomMeta}>
                  👥 {participants.length} {(liveClass as any).streamType === 'PUBLIC' ? 'viewers' : 'participants'}
                  {activeSpeakers.length > 0 ? ` · 🗣 ${activeSpeakers.length} on stage` : ''}
                </Text>
              </View>
            )}

            {/* ── Full Screen right-side action strip (TikTok style) ── */}
            {isFullscreen && (
              <View
                style={[fsSt.rightStrip, { bottom: insets.bottom + 80, opacity: showFsOverlay ? 1 : 0 }]}
                pointerEvents={showFsOverlay ? 'auto' : 'none'}
              >
                {/* Gift */}
                <TouchableOpacity style={fsSt.actionBtn} onPress={() => setShowGifts(true)}>
                  <Text style={{ fontSize: 22 }}>🎁</Text>
                  <Text style={fsSt.actionLabel}>Gift</Text>
                </TouchableOpacity>
                {/* SPRINT-4: Follow host button — hide for own stream */}
                {!isOwnStream && hostUserId && (
                  <TouchableOpacity
                    style={fsSt.actionBtn}
                    onPress={handleFollowHost}
                    disabled={followLoading[hostUserId] ?? false}
                    accessibilityLabel={isFollowing ? 'Unfollow host' : 'Follow host'}
                  >
                    <View style={{
                      width: 40, height: 40, borderRadius: 20,
                      backgroundColor: isFollowing ? '#374151' : '#ef4444',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {(followLoading[hostUserId] ?? false)
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={{ fontSize: 18 }}>{isFollowing ? '✓' : '+'}</Text>
                      }
                    </View>
                    <Text style={fsSt.actionLabel}>{isFollowing ? 'Following' : 'Follow'}</Text>
                  </TouchableOpacity>
                )}
                {/* Share button — available for all stream types */}
                <TouchableOpacity style={fsSt.actionBtn} onPress={handleShare} accessibilityLabel="Share stream">
                  <Ionicons name="share-social-outline" size={22} color="#fff" />
                  <Text style={fsSt.actionLabel}>Share</Text>
                </TouchableOpacity>
                {/* Chat */}
                <TouchableOpacity style={fsSt.actionBtn} onPress={() => {
                  handleToggleFullscreen();
                  setActiveTab('chat' as any);
                }}>
                  <Ionicons name="chatbubbles-outline" size={22} color="#fff" />
                  <Text style={fsSt.actionLabel}>Chat</Text>
                </TouchableOpacity>
                {/* Reactions */}
                <TouchableOpacity style={fsSt.actionBtn} onPress={() => setShowReactions(r => !r)}>
                  <Text style={{ fontSize: 22 }}>😊</Text>
                  <Text style={fsSt.actionLabel}>React</Text>
                </TouchableOpacity>
                {/* Exit fullscreen */}
                <TouchableOpacity style={fsSt.actionBtn} onPress={handleToggleFullscreen}>
                  <Ionicons name="contract-outline" size={22} color="#fff" />
                  <Text style={fsSt.actionLabel}>Exit</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Full Screen bottom controls (mic / camera / leave) ─── */}
            {isFullscreen && isJoined && (
              <View
                style={[fsSt.bottomControls, { paddingBottom: insets.bottom + 8, opacity: showFsOverlay ? 1 : 0 }]}
                pointerEvents={showFsOverlay ? 'auto' : 'none'}
              >
                {/* Mic toggle */}
                {(() => {
                  const canPublishSfu = isHost || !!(lk as any).room?.localParticipant?.permissions?.canPublish;
                  if (!canPublishSfu) {
                    return (
                      <TouchableOpacity style={[styles.ctrlBtn, handRaised && styles.ctrlBtnActive]} onPress={toggleHand}>
                        <Text style={{ fontSize: 18 }}>✋</Text>
                        <Text style={styles.ctrlLabel}>{handRaised ? 'Lower' : 'Speak?'}</Text>
                      </TouchableOpacity>
                    );
                  }
                  return (
                    <TouchableOpacity
                      style={[styles.ctrlBtn, !isMuted && styles.ctrlBtnActive]}
                      onPress={async () => {
                        const newMuted = !isMuted;
                        setIsMuted(newMuted);
                        try { await api.patch(`/live-classes/${id}/participants/${user?.id}/mute`, { muted: newMuted }); } catch {}
                        if (lk.connected) { if (newMuted) lk.disableMic(); else lk.enableMic(); }
                      }}
                    >
                      <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={20} color={isMuted ? '#6b7280' : '#4f46e5'} />
                      <Text style={styles.ctrlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
                    </TouchableOpacity>
                  );
                })()}
                {/* Leave / End */}
                <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnDanger]} onPress={isHost ? handleEndClass : handleLeave}>
                  <Ionicons name={isHost ? 'stop' : 'call'} size={20} color="#fff" />
                  <Text style={[styles.ctrlLabel, { color: '#fff' }]}>{isHost ? 'End' : 'Leave'}</Text>
                </TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>
        )}

        {/* ── WHITEBOARD TAB ────────────────────────────────────────────── */}
        {activeTab === 'whiteboard' && (
          <View style={{ flex: 1, backgroundColor: '#111827' }}>
            <LiveClassWhiteboard
              ref={whiteboardRef}
              isHost={isHost}
              remoteEvent={remoteDrawEvent}
              onDraw={handleDraw}
            />
          </View>
        )}

        {/* ── QURAN TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'quran' && (
          <View style={{ flex: 1, backgroundColor: '#0f0f23' }}>
            <LiveClassQuranPanel
              isHost={isHost}
              liveClassId={id ?? ''}
              syncedPosition={quranPosition}
              onPositionChange={handleQuranPosition}
            />
          </View>
        )}

        {/* ── POLLS TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'polls' && (
          <View style={{ flex: 1, backgroundColor: '#0f0f23', padding: 12 }}>
            <LiveClassPollPanel
              isHost={isHost}
              userId={user?.id}
              polls={polls}
              liveClassId={id ?? ''}
              onEvent={handlePollEvent}
            />
          </View>
        )}

        {/* ── CHAT TAB ──────────────────────────────────────────────────── */}
        {activeTab === 'chat' && (
          <View style={styles.chatPanel}>
            <FlatList ref={chatRef} data={chatMessages} keyExtractor={m => m.id}
              renderItem={({ item }) => <ChatRow msg={item} myId={user?.id ?? ''} isHost={isHost} onDelete={handleDeleteMessage} />}
              style={{ flex: 1 }} contentContainerStyle={styles.chatList}
              ListEmptyComponent={<Text style={styles.chatEmpty}>{isJoined ? 'No messages yet' : 'Join to chat'}</Text>}
            />
            {isJoined && liveClass.chatEnabled && (
              <View style={styles.chatInputBar}>
                <TextInput style={styles.chatInput} placeholder="Send a message…" placeholderTextColor="#6b7280"
                  value={chatText} onChangeText={setChatText} onSubmitEditing={sendChat} returnKeyType="send" />
                <TouchableOpacity style={styles.chatSendBtn} onPress={sendChat} disabled={!chatText.trim()}>
                  <Ionicons name="send" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ── HOST CONTROLS TAB ─────────────────────────────────────────── */}
        {activeTab === 'controls' && isHost && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Text style={styles.sectionTitle}>Class Controls</Text>

            {/* Edit stream info */}
            <View style={styles.controlGroup}>
              <TouchableOpacity
                style={[styles.controlBtn, { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' }]}
                onPress={() => setShowEditModal(true)}
              >
                <Ionicons name="pencil-outline" size={18} color="#a5b4fc" />
                <Text style={[styles.controlBtnText, { color: '#a5b4fc' }]}>Edit Title &amp; Description</Text>
              </TouchableOpacity>
            </View>

            {/* Class lifecycle */}
            <View style={styles.controlGroup}>
              {liveClass.status === 'SCHEDULED' && (
                <TouchableOpacity style={[styles.controlBtn, { backgroundColor: '#10b981' }]} onPress={handleStartClass}>
                  <Ionicons name="play" size={18} color="#fff" />
                  <Text style={styles.controlBtnText}>Start Class Now</Text>
                </TouchableOpacity>
              )}
              {liveClass.status === 'LIVE' && (
                <TouchableOpacity style={[styles.controlBtn, { backgroundColor: '#ef4444' }]} onPress={handleEndClass}>
                  <Ionicons name="stop" size={18} color="#fff" />
                  <Text style={styles.controlBtnText}>End Class</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.controlBtn, { backgroundColor: '#f59e0b' }]} onPress={handleMuteAll}>
                <Ionicons name="mic-off" size={18} color="#fff" />
                <Text style={styles.controlBtnText}>Mute All Students</Text>
              </TouchableOpacity>
              {/* Unmute all */}
              <TouchableOpacity style={[styles.controlBtn, { backgroundColor: '#10b981' }]} onPress={handleUnmuteAll}>
                <Ionicons name="mic" size={18} color="#fff" />
                <Text style={styles.controlBtnText}>Unmute All Students</Text>
              </TouchableOpacity>
              {/* Lower all hands */}
              {hands.length > 0 && (
                <TouchableOpacity style={[styles.controlBtn, { backgroundColor: '#6b7280' }]} onPress={handleLowerAllHands}>
                  <Ionicons name="hand-left-outline" size={18} color="#fff" />
                  <Text style={styles.controlBtnText}>Lower All Hands ({hands.length})</Text>
                </TouchableOpacity>
              )}
              {/* Open mic toggle */}
              <TouchableOpacity
                style={[styles.controlBtn, { backgroundColor: isOpenMic ? '#6366f1' : '#374151' }]}
                onPress={handleToggleOpenMic}
              >
                <Ionicons name={isOpenMic ? 'mic' : 'mic-outline'} size={18} color="#fff" />
                <Text style={styles.controlBtnText}>{isOpenMic ? 'Disable Open Mic' : 'Enable Open Mic'}</Text>
              </TouchableOpacity>
              {/* Recording toggle */}
              <TouchableOpacity
                style={[styles.controlBtn, { backgroundColor: isRecording ? '#ef4444' : '#1e293b', borderWidth: 1, borderColor: '#334155' }]}
                onPress={handleToggleRecording}
              >
                <View style={[styles.recDot, !isRecording && { backgroundColor: '#6b7280' }]} />
                <Text style={styles.controlBtnText}>{isRecording ? 'Stop Recording' : 'Start Recording'}</Text>
              </TouchableOpacity>
              {/* Whiteboard toggle */}
              <TouchableOpacity
                style={[styles.controlBtn, { backgroundColor: (liveClass as any).whiteboardEnabled ? '#7c3aed' : '#374151' }]}
                onPress={async () => {
                  try {
                    await api.patch(`/live-classes/${id}`, { whiteboardEnabled: !(liveClass as any).whiteboardEnabled });
                    qc.invalidateQueries({ queryKey: ['live-class', id] });
                    if (!(liveClass as any).whiteboardEnabled) setActiveTab('whiteboard' as any);
                  } catch {}
                }}
              >
                <Ionicons name="pencil-outline" size={18} color="#fff" />
                <Text style={styles.controlBtnText}>{(liveClass as any).whiteboardEnabled ? 'Disable Whiteboard' : 'Enable Whiteboard'}</Text>
              </TouchableOpacity>
              {/* Quran panel toggle */}
              <TouchableOpacity
                style={[styles.controlBtn, { backgroundColor: (liveClass as any).quranPanelEnabled ? '#059669' : '#374151' }]}
                onPress={async () => {
                  try {
                    await api.patch(`/live-classes/${id}`, { quranPanelEnabled: !(liveClass as any).quranPanelEnabled });
                    qc.invalidateQueries({ queryKey: ['live-class', id] });
                    if (!(liveClass as any).quranPanelEnabled) setActiveTab('quran' as any);
                  } catch {}
                }}
              >
                <Ionicons name="book-outline" size={18} color="#fff" />
                <Text style={styles.controlBtnText}>{(liveClass as any).quranPanelEnabled ? 'Disable Quran Panel' : 'Enable Quran Panel'}</Text>
              </TouchableOpacity>
              {/* View mode toggle */}
              <TouchableOpacity
                style={[styles.controlBtn, { backgroundColor: viewMode === 'audio' ? '#1d4ed8' : '#374151' }]}
                onPress={async () => {
                  const next = viewMode === 'video' ? 'audio' : 'video';
                  setViewMode(next);
                  const socket = getSocket();
                  socket?.emit('liveclass:viewmode_changed', { liveClassId: id, viewMode: next });
                }}
              >
                <Ionicons name={viewMode === 'audio' ? 'musical-note-outline' : 'videocam-outline'} size={18} color="#fff" />
                <Text style={styles.controlBtnText}>Mode: {viewMode === 'video' ? 'Switch to Audio' : 'Switch to Video'}</Text>
              </TouchableOpacity>
              {/* Screen share */}
              <TouchableOpacity
                style={[styles.controlBtn, { backgroundColor: isScreenSharing ? '#dc2626' : '#374151' }]}
                onPress={handleToggleScreenShare}
              >
                <Ionicons name="desktop-outline" size={18} color="#fff" />
                <Text style={styles.controlBtnText}>{isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}</Text>
              </TouchableOpacity>
            </View>

            {/* Max speakers on stage */}
            <View style={styles.controlGroup}>
              <Text style={styles.sectionTitle}>🎙 Max Speakers on Stage</Text>
              <Text style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>
                Currently: {(liveClass as any).maxSpeakers ?? 20} · tap to change
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {[2, 4, 6, 8, 10, 20].map(n => {
                  const current = (liveClass as any).maxSpeakers ?? 20;
                  const isActive = current === n;
                  return (
                    <TouchableOpacity
                      key={n}
                      style={{
                        flex: 1, minWidth: 44, alignItems: 'center', paddingVertical: 12,
                        backgroundColor: isActive ? '#4f46e5' : '#1e293b',
                        borderRadius: 12, borderWidth: 1.5,
                        borderColor: isActive ? '#6366f1' : '#334155',
                      }}
                      onPress={async () => {
                        if (isActive) return;
                        try {
                          await api.patch(`/live-classes/${id}`, { maxSpeakers: n });
                          qc.invalidateQueries({ queryKey: ['live-class', id] });
                          showMessage({ message: `🎙 Max speakers set to ${n}`, type: 'success', duration: 1500 });
                        } catch (e: any) {
                          showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
                        }
                      }}
                    >
                      <Text style={{ fontSize: 16, fontWeight: '700', color: isActive ? '#fff' : '#94a3b8' }}>{n}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Hand queue */}
            <Text style={styles.sectionTitle}>✋ Raised Hands ({hands.length})</Text>
            {hands.length === 0 ? (
              <Text style={styles.noHandsText}>No hands raised</Text>
            ) : (
              hands.map(h => (
                <View key={h.userId} style={styles.handRow}>
                  <Image source={{ uri: avatarUrl(h.avatarUrl, `${h.firstName} ${h.lastName}`) }} style={styles.handAvatar} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.handName}>{h.firstName} {h.lastName}</Text>
                    <Text style={styles.handTime}>{formatDistanceToNow(new Date(h.raisedAt), { addSuffix: true })}</Text>
                  </View>
                  <TouchableOpacity style={styles.approveBtn} onPress={() => handleApproveHand(h.userId)}>
                    <Ionicons name="checkmark" size={14} color="#fff" /><Text style={styles.approveBtnText}>Allow</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.rejectBtn} onPress={() => handleRejectHand(h.userId)}>
                    <Ionicons name="close" size={16} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              ))
            )}

            {/* Participants */}
            <Text style={styles.sectionTitle}>👥 Participants ({participants.length})</Text>
            <TouchableOpacity style={[styles.controlBtn, { backgroundColor: '#4f46e5' }]} onPress={() => setShowParticipants(true)}>
              <Ionicons name="people" size={18} color="#fff" />
              <Text style={styles.controlBtnText}>Manage Participants</Text>
            </TouchableOpacity>

            {/* ── DI-01: Attendance report ─────────────────────────────── */}
            {/* Only shown for SCHOOL streams (attendance is tracked per student) */}
            {(liveClass as any).streamType !== 'PUBLIC' && (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 8 }]}>📋 Attendance</Text>
                <TouchableOpacity
                  style={[styles.controlBtn, { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155' }]}
                  onPress={loadAttendance}
                  disabled={loadingAttendance}
                >
                  <Ionicons name="refresh-outline" size={18} color="#a5b4fc" />
                  <Text style={[styles.controlBtnText, { color: '#a5b4fc' }]}>
                    {loadingAttendance ? 'Loading…' : 'Refresh Attendance'}
                  </Text>
                </TouchableOpacity>

                {attendance.length === 0 && !loadingAttendance && (
                  <Text style={styles.noHandsText}>No attendance records yet</Text>
                )}

                {attendance.map((a: any) => {
                  const name = a.student?.user
                    ? `${a.student.user.firstName} ${a.student.user.lastName}`.trim()
                    : 'Unknown';
                  const statusColor =
                    a.status === 'PRESENT'  ? '#10b981' :
                    a.status === 'PARTIAL'  ? '#f59e0b' : '#6b7280';
                  const mins = a.totalMinutes ?? 0;
                  return (
                    <View key={a.id} style={[styles.handRow, { paddingVertical: 10 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.handName}>{name}</Text>
                        <Text style={styles.handTime}>
                          {mins > 0 ? `${mins} min attended` : 'No duration yet'}
                        </Text>
                      </View>
                      <View style={{
                        paddingHorizontal: 10, paddingVertical: 4,
                        backgroundColor: statusColor + '22',
                        borderRadius: 8, borderWidth: 1, borderColor: statusColor + '66',
                      }}>
                        <Text style={{ color: statusColor, fontSize: 11, fontWeight: '700' }}>
                          {a.status}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </>
            )}
          </ScrollView>
        )}

        {/* Bottom controls */}
        {isJoined && !isFullscreen && (
          <View style={{ backgroundColor: '#1a1a2e', borderTopWidth: 1, borderColor: '#1e1e3a' }}>
            {/* Emoji reaction picker (shown when reactions button tapped) */}
            {showReactions && (
              <View style={styles.reactionBar}>
                {REACTIONS.map(e => (
                  <TouchableOpacity key={e} style={styles.reactionBtn} onPress={() => { sendReaction(e); setShowReactions(false); }}>
                    <Text style={{ fontSize: 22 }}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {/* Horizontally scrollable controls row — prevents buttons being clipped on small screens */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.controls, { paddingBottom: Math.max(insets.bottom, 8) }]}
              keyboardShouldPersistTaps="handled"
            >
              {!isHost && liveClass.handRaiseEnabled && (
                <TouchableOpacity style={[styles.ctrlBtn, handRaised && styles.ctrlBtnActive]} onPress={toggleHand}>
                  <Text style={{ fontSize: 20 }}>✋</Text>
                  <Text style={styles.ctrlLabel}>{handRaised ? 'Lower' : 'Raise'}</Text>
                </TouchableOpacity>
              )}
              {/* Speak request — students only, when hand raise is disabled but speak request is available */}
              {!isHost && !liveClass.handRaiseEnabled && (
                <TouchableOpacity style={styles.ctrlBtn} onPress={handleSpeakRequest}>
                  <Ionicons name="chatbubble-outline" size={20} color="#a5b4fc" />
                  <Text style={styles.ctrlLabel}>Speak</Text>
                </TouchableOpacity>
              )}
              {/* MIC-02: canPublishSfu = true only when SFU token allows publishing.
                  isOpenMic is excluded — it means hand-raise auto-approves, NOT that
                  everyone can publish without a speakerSlot. */}
              {(() => {
                const canPublishSfu = isHost ||
                  !!(lk as any).room?.localParticipant?.permissions?.canPublish;
                if (!canPublishSfu) {
                  // Listen-only: show raise hand shortcut instead of a useless mic button
                  return (
                    <TouchableOpacity
                      style={[styles.ctrlBtn, handRaised && styles.ctrlBtnActive]}
                      onPress={toggleHand}
                    >
                      <Text style={{ fontSize: 20 }}>✋</Text>
                      <Text style={styles.ctrlLabel}>{handRaised ? 'Lower' : 'Speak?'}</Text>
                    </TouchableOpacity>
                  );
                }
                return (
                  <TouchableOpacity style={[styles.ctrlBtn, !isMuted && styles.ctrlBtnActive]} onPress={async () => {
                    const newMuted = !isMuted;
                    setIsMuted(newMuted);
                    try { await api.patch(`/live-classes/${id}/participants/${user?.id}/mute`, { muted: newMuted }); } catch {}
                    if (lk.connected) { if (newMuted) lk.disableMic(); else lk.enableMic(); }
                  }}>
                    <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={22} color={isMuted ? '#6b7280' : '#4f46e5'} />
                    <Text style={styles.ctrlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
                  </TouchableOpacity>
                );
              })()}
              {/* Camera toggle */}
              <TouchableOpacity
                style={[styles.ctrlBtn, isCameraOn && styles.ctrlBtnActive]}
                onPress={handleToggleCamera}
              >
                <Ionicons name={isCameraOn ? 'videocam' : 'videocam-off'} size={22} color={isCameraOn ? '#4f46e5' : '#6b7280'} />
                <Text style={styles.ctrlLabel}>{isCameraOn ? 'Cam On' : 'Camera'}</Text>
              </TouchableOpacity>
              {/* MIC-02: Drop Mic — shown for non-host active speakers (canPublish:true) */}
              {!isHost && !!(lk as any).room?.localParticipant?.permissions?.canPublish && (
                <TouchableOpacity
                  style={[styles.ctrlBtn, { backgroundColor: '#f97316' }]}
                  onPress={handleDropMic}
                >
                  <Ionicons name="mic-off-outline" size={22} color="#fff" />
                  <Text style={[styles.ctrlLabel, { color: '#fff' }]}>Drop Mic</Text>
                </TouchableOpacity>
              )}
              {/* Emoji reactions */}
              <TouchableOpacity style={[styles.ctrlBtn, showReactions && styles.ctrlBtnActive]} onPress={() => setShowReactions(r => !r)}>
                <Text style={{ fontSize: 20 }}>😊</Text>
                <Text style={styles.ctrlLabel}>React</Text>
              </TouchableOpacity>
              {/* Gift button — open gift panel */}
              <TouchableOpacity style={styles.ctrlBtn} onPress={() => setShowGifts(true)}>
                <Text style={{ fontSize: 20 }}>🎁</Text>
                <Text style={styles.ctrlLabel}>Gift</Text>
              </TouchableOpacity>
              {/* Hand queue — always visible for host when hand-raise is enabled.
                  Badge shows count when hands are raised. Tapping opens the hand queue modal. */}
              {isHost && liveClass.handRaiseEnabled && (
                <TouchableOpacity
                  style={[styles.ctrlBtn, hands.length > 0 && { backgroundColor: '#d97706' }, { position: 'relative' }]}
                  onPress={() => setShowHands(true)}
                  accessibilityLabel={hands.length > 0 ? `${hands.length} raised hand${hands.length > 1 ? 's' : ''} — tap to review` : 'Hand queue — no raised hands'}
                >
                  <Text style={{ fontSize: 20 }}>✋</Text>
                  <Text style={[styles.ctrlLabel, hands.length > 0 && { color: '#fef3c7' }]}>Hands</Text>
                  {hands.length > 0 && (
                    <View style={[styles.badge, { position: 'absolute', top: 4, right: 4 }]}>
                      <Text style={styles.badgeText}>{hands.length > 9 ? '9+' : hands.length}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}
              {/* Host shortcut: whiteboard */}
              {isHost && (
                <TouchableOpacity
                  style={[styles.ctrlBtn, activeTab === 'whiteboard' && styles.ctrlBtnActive]}
                  onPress={() => setActiveTab(prev => (prev === 'whiteboard' ? 'video' : 'whiteboard') as any)}
                >
                  <Ionicons name="pencil-outline" size={20} color="#a5b4fc" />
                  <Text style={styles.ctrlLabel}>Board</Text>
                </TouchableOpacity>
              )}
              {/* Host shortcut: screen share */}
              {isHost && lk.connected && (
                <TouchableOpacity
                  style={[styles.ctrlBtn, isScreenSharing && { backgroundColor: '#dc262622', borderWidth: 1.5, borderColor: '#dc2626' }]}
                  onPress={handleToggleScreenShare}
                >
                  <Ionicons name="desktop-outline" size={20} color={isScreenSharing ? '#dc2626' : '#a5b4fc'} />
                  <Text style={[styles.ctrlLabel, isScreenSharing && { color: '#dc2626' }]}>Share</Text>
                </TouchableOpacity>
              )}
              {/* More ⋯ button — Screen Share, Audio/Video Mode, Whiteboard */}
              <TouchableOpacity
                style={styles.ctrlBtn}
                onPress={() => setShowMoreSheet(true)}
                accessibilityLabel="More options"
                accessibilityRole="button"
              >
                <Ionicons name="ellipsis-horizontal" size={22} color="#a5b4fc" />
                <Text style={styles.ctrlLabel}>More</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnDanger]} onPress={isHost ? handleEndClass : handleLeave}>
                <Ionicons name={isHost ? 'stop' : 'call'} size={22} color="#fff" />
                <Text style={[styles.ctrlLabel, { color: '#fff' }]}>{isHost ? 'End' : 'Leave'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Modals */}
      {/* ── More Sheet — Screen Share, Audio/Video Mode, Whiteboard ── */}
      <Modal
        visible={showMoreSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMoreSheet(false)}
      >
        <TouchableOpacity
          style={{ flex: 1 }}
          activeOpacity={1}
          onPress={() => setShowMoreSheet(false)}
        />
        <SafeAreaView style={{
          backgroundColor: '#1a1a2e',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          borderTopWidth: 1,
          borderColor: '#334155',
          paddingBottom: insets.bottom + 8,
        }}>
          {/* Handle */}
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#475569' }} />
          </View>
          <Text style={{ color: '#e2e8f0', fontWeight: '800', fontSize: 15, textAlign: 'center', paddingBottom: 14 }}>
            More Options
          </Text>

          {/* Screen Share */}
          <TouchableOpacity
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 14,
              paddingHorizontal: 20, paddingVertical: 15,
              backgroundColor: isScreenSharing ? 'rgba(220,38,38,0.12)' : 'transparent',
            }}
            onPress={() => { setShowMoreSheet(false); handleToggleScreenShare(); }}
          >
            <View style={{
              width: 42, height: 42, borderRadius: 12,
              backgroundColor: isScreenSharing ? '#dc2626' : '#1e293b',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons name="desktop-outline" size={20} color={isScreenSharing ? '#fff' : '#a5b4fc'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#f1f5f9', fontWeight: '700', fontSize: 15 }}>
                {isScreenSharing ? 'Stop Screen Share' : 'Screen Share'}
              </Text>
              <Text style={{ color: '#64748b', fontSize: 12, marginTop: 1 }}>
                {isScreenSharing ? 'Currently sharing your screen' : 'Share your screen with participants'}
              </Text>
            </View>
            {isScreenSharing && (
              <View style={{ backgroundColor: '#dc2626', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>LIVE</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Audio Only / Video Mode toggle */}
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 15 }}
            onPress={() => {
              setShowMoreSheet(false);
              const next = viewMode === 'video' ? 'audio' : 'video';
              setViewMode(next);
              const socket = getSocket();
              socket?.emit('liveclass:viewmode_changed', { liveClassId: id, viewMode: next });
            }}
          >
            <View style={{
              width: 42, height: 42, borderRadius: 12,
              backgroundColor: viewMode === 'audio' ? '#4f46e5' : '#1e293b',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons
                name={viewMode === 'audio' ? 'musical-note-outline' : 'videocam-outline'}
                size={20}
                color={viewMode === 'audio' ? '#fff' : '#a5b4fc'}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#f1f5f9', fontWeight: '700', fontSize: 15 }}>
                {viewMode === 'video' ? 'Switch to Audio Only' : 'Switch to Video Mode'}
              </Text>
              <Text style={{ color: '#64748b', fontSize: 12, marginTop: 1 }}>
                {viewMode === 'video'
                  ? 'Hide video, show only audio and avatars'
                  : 'Show video tiles for all speakers'}
              </Text>
            </View>
            <View style={{
              backgroundColor: viewMode === 'audio' ? '#4f46e522' : 'transparent',
              paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
              borderWidth: 1, borderColor: viewMode === 'audio' ? '#4f46e5' : 'transparent',
            }}>
              <Text style={{ color: viewMode === 'audio' ? '#818cf8' : '#475569', fontSize: 11, fontWeight: '700' }}>
                {viewMode === 'audio' ? 'AUDIO' : 'VIDEO'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Whiteboard */}
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 15 }}
            onPress={() => {
              setShowMoreSheet(false);
              setActiveTab(prev => (prev === 'whiteboard' ? 'video' : 'whiteboard') as any);
            }}
          >
            <View style={{
              width: 42, height: 42, borderRadius: 12,
              backgroundColor: activeTab === 'whiteboard' ? '#7c3aed' : '#1e293b',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons name="pencil-outline" size={20} color={activeTab === 'whiteboard' ? '#fff' : '#a5b4fc'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#f1f5f9', fontWeight: '700', fontSize: 15 }}>
                {activeTab === 'whiteboard' ? 'Close Whiteboard' : 'Open Whiteboard'}
              </Text>
              <Text style={{ color: '#64748b', fontSize: 12, marginTop: 1 }}>
                {activeTab === 'whiteboard'
                  ? 'Return to video/audio view'
                  : 'Collaborative drawing board'}
              </Text>
            </View>
            {activeTab === 'whiteboard' && (
              <View style={{ backgroundColor: '#7c3aed22', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#7c3aed' }}>
                <Text style={{ color: '#a78bfa', fontSize: 10, fontWeight: '800' }}>OPEN</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Divider + Cancel */}
          <View style={{ height: 1, backgroundColor: '#1e293b', marginHorizontal: 20, marginVertical: 6 }} />
          <TouchableOpacity
            style={{ alignItems: 'center', paddingVertical: 14 }}
            onPress={() => setShowMoreSheet(false)}
          >
            <Text style={{ color: '#94a3b8', fontWeight: '700', fontSize: 15 }}>Cancel</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>
      <HandQueueModal visible={showHands} hands={hands} onClose={() => setShowHands(false)} onApprove={handleApproveHand} onReject={handleRejectHand} />
      <ParticipantsModal
        visible={showParticipants}
        participants={participants}
        myId={user?.id ?? ''}
        onClose={() => setShowParticipants(false)}
        onMute={handleMuteParticipant}
        onKick={handleKickParticipant}
        onDemote={handleDemoteFromStage}
        onInvite={handleInviteToStage}
        isHost={isHost}
        onPromoteMod={handlePromoteModerator}
        onDemoteMod={handleDemoteModerator}
        onTransferHost={isCreator ? handleAssignHost : undefined}
        followMap={followMap}
        followLoading={followLoading}
        onFollow={handleFollowUser}
      />
      <LiveClassGiftPanel
        liveClassId={id ?? ''}
        participants={participants.map(p => ({ userId: p.userId, role: p.role, firstName: p.firstName, lastName: p.lastName, avatarUrl: p.avatarUrl }))}
        visible={showGifts}
        onClose={() => setShowGifts(false)}
      />
      <EditStreamModal
        visible={showEditModal}
        lc={liveClass ? {
          id: (liveClass as any).id ?? id ?? '',
          title: liveClass.title,
          description: liveClass.description,
          status: liveClass.status,
          coverImageUrl: (liveClass as any).coverImageUrl ?? null,
        } : null}
        onClose={() => setShowEditModal(false)}
        onUpdated={() => qc.invalidateQueries({ queryKey: ['live-class', id] })}
        onDeleted={() => router.replace('/(tabs)/live-class' as any)}
      />
      {/* ── Share modal — DM / Group / Community / Feed / Copy ─── */}
      <LiveClassShareModal
        visible={showShareModal}
        liveClassId={id ?? ''}
        title={liveClass?.title ?? ''}
        streamType={((liveClass as any)?.streamType ?? 'PUBLIC') as 'SCHOOL' | 'PUBLIC'}
        webUrl={`${process.env.EXPO_PUBLIC_WEB_URL ?? 'https://halqa.app'}/live-class/${id}`}
        onClose={() => setShowShareModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#0f0f23' },
  centered:           { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f0f23' },
  errorText:          { color: '#9ca3af', fontSize: 16 },
  // Tabs
  tabs:               { flexDirection: 'row', backgroundColor: '#1a1a2e', borderBottomWidth: 1, borderColor: '#1e1e3a' },
  tab:                { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 5 },
  tabActive:          { borderBottomWidth: 2, borderColor: '#4f46e5' },
  tabText:            { color: '#6b7280', fontSize: 13, fontWeight: '600' },
  tabTextActive:      { color: '#a5b4fc' },
  badge:              { backgroundColor: '#ef4444', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText:          { color: '#fff', fontSize: 9, fontWeight: '900' },
  // Video area
  videoArea:          { flex: 1, position: 'relative' },
  videoPlaceholder:   { flex: 1, backgroundColor: '#111827' },
  // Speaker grid (active speakers on stage)
  speakerGridWrap:    { flex: 1, backgroundColor: '#0f0f23' },
  speakerGridBadgeRow:{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  speakerGrid:        { flex: 1 },
  // Recording badge overlay
  recordingBadge:     { position: 'absolute', top: 10, left: 12, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(239,68,68,0.85)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, zIndex: 10 },
  recDot:             { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444' },
  recTxt:             { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  // Floating emoji reaction
  floatingEmojiWrap:  { position: 'absolute', top: '35%' as any, left: 0, right: 0, alignItems: 'center', zIndex: 20 },
  floatingEmojiText:  { fontSize: 52 },
  // Open mic badge
  openMicBadge:       { color: '#a5b4fc', fontSize: 11, fontWeight: '700', backgroundColor: '#4f46e522', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  hostVideo:          { alignItems: 'center', gap: 10 },
  hostAvatar:         { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#4f46e5' },
  hostVideoLabel:     { color: '#e5e7eb', fontWeight: '600', fontSize: 16 },
  // Audio-only view mode
  audioModeWrap:      { alignItems: 'center', gap: 12 },
  hostAudioCircle:    { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  hostAvatarLarge:    { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: '#4f46e5' },
  audioWave:          { position: 'absolute', bottom: -4, right: -4, backgroundColor: '#4f46e5', borderRadius: 12, padding: 4 },
  audioModeLabel:     { color: '#9ca3af', fontSize: 13 },
  viewModeToggle:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1e1e3a', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, marginTop: 6 },
  viewModeToggleText: { color: '#a5b4fc', fontSize: 12, fontWeight: '600' },
  // Audience status banner
  audienceBanner:     { marginTop: 12, backgroundColor: '#1a1a2e', borderRadius: 12, padding: 12, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#374151' },
  audienceBannerText: { color: '#9ca3af', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  audienceBannerBtn:  { backgroundColor: '#d97706', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  audienceBannerBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  livePill:           { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ef444422', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, gap: 5 },
  liveDot:            { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ef4444' },
  liveText:           { color: '#ef4444', fontSize: 12, fontWeight: '700' },
  videoNote:          { color: '#6b7280', fontSize: 12, marginTop: 12, textAlign: 'center', paddingHorizontal: 24 },
  participantCount:   { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  participantCountText: { color: '#a5b4fc', fontSize: 13 },
  viewAllBtn:         { paddingHorizontal: 8, paddingVertical: 2, backgroundColor: '#4f46e522', borderRadius: 8 },
  viewAllText:        { color: '#a5b4fc', fontSize: 11, fontWeight: '600' },
  preJoin:            { alignItems: 'center', gap: 12, paddingHorizontal: 32 },
  coverImage:         { width: '100%', height: 180, borderRadius: 16, marginBottom: 8, backgroundColor: '#1e1e3a' },
  preJoinTitle:       { color: '#e5e7eb', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  preJoinHost:        { color: '#9ca3af', fontSize: 14 },
  statusBadge:        { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot:          { width: 8, height: 8, borderRadius: 4 },
  statusText:         { color: '#e5e7eb', fontWeight: '600' },
  joinClassBtn:       { flexDirection: 'row', backgroundColor: '#4f46e5', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 12, alignItems: 'center', gap: 8, marginTop: 4 },
  joinClassBtnText:   { color: '#fff', fontWeight: '700', fontSize: 16 },
  scheduledText:      { color: '#f59e0b', fontWeight: '600' },
  endedText:          { color: '#9ca3af', fontWeight: '500' },
  infoCard:           { backgroundColor: '#1a1a2e', padding: 14, borderTopWidth: 1, borderColor: '#1e1e3a' },
  infoTitle:          { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },
  infoDesc:           { color: '#9ca3af', fontSize: 13, lineHeight: 20, marginTop: 4 },
  publicBadge:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#4c1d95', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, alignSelf: 'flex-start' },
  publicBadgeText:    { color: '#c4b5fd', fontSize: 11, fontWeight: '700' },
  // Chat
  chatPanel:        { flex: 1, backgroundColor: '#0f0f23' },
  chatList:         { padding: 12, gap: 4, paddingBottom: 8 },
  chatRow:          { flexDirection: 'row', paddingVertical: 3 },
  chatRowMe:        { justifyContent: 'flex-end' },
  chatName:         { color: '#a5b4fc', fontWeight: '600', fontSize: 13 },
  chatMsg:          { color: '#e5e7eb', fontSize: 13, flex: 1 },
  chatMsgMe:        { color: '#c7d2fe', textAlign: 'right', flex: 0 },
  chatEmpty:        { textAlign: 'center', color: '#6b7280', marginTop: 40, fontSize: 14 },
  chatInputBar:     { flexDirection: 'row', padding: 8, gap: 8, backgroundColor: '#1a1a2e', borderTopWidth: 1, borderColor: '#1e1e3a' },
  chatInput:        { flex: 1, backgroundColor: '#111827', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, color: '#e5e7eb', fontSize: 14 },
  chatSendBtn:      { width: 38, height: 38, borderRadius: 19, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center' },
  systemMsg:        { alignItems: 'center', paddingVertical: 4 },
  systemMsgText:    { color: '#6b7280', fontSize: 11, fontStyle: 'italic' },
  // Controls tab
  sectionTitle:     { color: '#e5e7eb', fontSize: 14, fontWeight: '700', marginTop: 4 },
  controlGroup:     { gap: 8 },
  controlBtn:       { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 14 },
  controlBtnText:   { color: '#fff', fontWeight: '700', fontSize: 15 },
  noHandsText:      { color: '#6b7280', fontSize: 13, fontStyle: 'italic' },
  handRow:          { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1a1a2e', borderRadius: 12, padding: 10 },
  handAvatar:       { width: 36, height: 36, borderRadius: 18 },
  handName:         { color: '#e5e7eb', fontSize: 14, fontWeight: '600' },
  handTime:         { color: '#6b7280', fontSize: 11 },
  approveBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#10b981', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  approveBtnText:   { color: '#fff', fontSize: 12, fontWeight: '700' },
  rejectBtn:        { padding: 6, backgroundColor: '#fef2f2', borderRadius: 8 },
  // Participants modal
  modalHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  modalTitle:       { fontSize: 17, fontWeight: '700', color: '#111827' },
  emptyWrap:        { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText:        { color: '#9ca3af', fontSize: 15 },
  pRow:             { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  pAvatar:          { width: 36, height: 36, borderRadius: 18 },
  pName:            { fontSize: 14, fontWeight: '600', color: '#111827' },
  pRole:            { fontSize: 11, color: '#9ca3af' },
  pBtn:             { padding: 7, backgroundColor: '#f3f4f6', borderRadius: 8 },
  // Bottom controls
  controls:         { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingTop: 10 },
  ctrlBtn:          { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e1e3a', borderRadius: 14, padding: 8, minWidth: 52, height: 52 },
  ctrlBtnActive:    { backgroundColor: '#4f46e522', borderWidth: 1.5, borderColor: '#4f46e5' },
  ctrlBtnDanger:    { backgroundColor: '#ef4444' },
  ctrlLabel:        { color: '#9ca3af', fontSize: 10, marginTop: 3, fontWeight: '600' },
  // Emoji reaction bar
  reactionBar:      { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8, paddingVertical: 8, backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1e1e3a' },
  reactionBtn:      { padding: 6 },
});

// ─── Full Screen overlay styles ────────────────────────────────────────────────
// Separate StyleSheet so these don't pollute the main styles object.
// These are LAYOUT-ONLY — they never touch LiveKit, stage, or socket state.
const fsSt = StyleSheet.create({
  // Top overlay bar (back + title + live badge + viewer count)
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
    // Gradient-like darkening so text is readable over video
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 101,
  },
  topTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Bottom-left info: host name, title, description, viewer count
  bottomInfo: {
    position: 'absolute',
    left: 16,
    right: 80,   // leave room for right-side action strip
    zIndex: 101,
  },
  bottomTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    marginBottom: 2,
  },
  bottomDesc: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    lineHeight: 17,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    marginBottom: 3,
  },
  bottomMeta: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
  },
  // Right-side action strip: gift, chat, react, exit
  rightStrip: {
    position: 'absolute',
    right: 12,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    zIndex: 101,
  },
  actionBtn: {
    alignItems: 'center',
    gap: 4,
  },
  actionLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    fontWeight: '600',
  },
  // Minimal bottom controls bar in fullscreen (mic + leave)
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingTop: 10,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    zIndex: 101,
  },
  // Full screen toggle button (small, shown in badge row)
  fsBtn: {
    marginLeft: 'auto' as any,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 8,
    padding: 5,
  },
});





