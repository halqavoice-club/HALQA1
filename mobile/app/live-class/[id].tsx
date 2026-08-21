/**
 * HALQA Mobile — Live Class Room Screen
 * Full implementation: join/leave, chat, hand raise, teacher host controls
 * Advanced features: Polls, Quran Panel, Whiteboard, View Mode Switch, Screen Share
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, Alert, TextInput, KeyboardAvoidingView,
  Platform, Image, Modal, ScrollView, BackHandler,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

// ─── Types ────────────────────────────────────────────────────────────────────
interface LiveClass {
  id: string; title: string; description?: string;
  host: { id: string; name: string; avatar?: string };
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
}

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
function ParticipantsModal({ visible, participants, myId, onClose, onMute, onKick }: {
  visible: boolean; participants: Participant[]; myId: string; onClose: () => void;
  onMute: (userId: string, muted: boolean) => void; onKick: (userId: string, name: string) => void;
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
            return (
              <View style={styles.pRow}>
                <Image source={{ uri: avatarUrl(p.avatarUrl, `${p.firstName} ${p.lastName}`) }} style={styles.pAvatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pName}>{p.firstName} {p.lastName}{isMe ? ' (you)' : ''}</Text>
                  <Text style={styles.pRole}>{p.role}{p.handRaised ? ' · ✋' : ''}</Text>
                </View>
                {!isMe && (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity style={styles.pBtn} onPress={() => onMute(p.userId, !p.isMuted)}>
                      <Ionicons name={p.isMuted ? 'mic-off' : 'mic'} size={16} color={p.isMuted ? '#ef4444' : '#10b981'} />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.pBtn, { backgroundColor: '#fef2f2' }]}
                      onPress={() => onKick(p.userId, `${p.firstName} ${p.lastName}`)}>
                      <Ionicons name="exit-outline" size={16} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                )}
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

  const isTeacher = ['TEACHER','SCHOOL_ADMIN','SUPER_ADMIN'].includes(user?.role || '');
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
        participantsCount: lc._count?.participants ?? 0,
        chatEnabled: lc.chatEnabled ?? true,
        handRaiseEnabled: lc.handRaiseEnabled ?? true,
      } as LiveClass;
    },
    enabled: !!id,
    refetchInterval: isJoined ? 30000 : 10000,
  });

  const isHost = user?.id === liveClass?.host?.id || isTeacher;

  // Sync isOpenMic from server data
  useEffect(() => {
    if (liveClass) setIsOpenMic((liveClass as any).isOpenMic ?? false);
  }, [(liveClass as any)?.isOpenMic]);

  // ── Load hand queue (teachers only) ─────────────────────────────────────────
  const loadHands = useCallback(async () => {
    if (!isHost || !isJoined) return;
    try {
      const r = await api.get(`/live-classes/${id}/hand/queue`);
      setHands(r.data.data ?? []);
    } catch {}
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
      setIsMuted(false);
      showMessage({ message: '🎙️ You can now speak!', type: 'success' });
      // Re-enable LiveKit mic if connected
      if (lk.connected) lk.enableMic().catch(() => {});
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
        message: d.isOpenMic ? '🎤 Open mic enabled — you can speak!' : '🔇 Open mic disabled',
        type: d.isOpenMic ? 'success' : 'info',
        duration: 2000,
      });
      // If open mic was enabled and we're a student, unmute in LiveKit
      if (d.isOpenMic && !isHost && lk.connected) {
        setIsMuted(false);
        lk.enableMic().catch(() => {});
      }
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

    // New: hand approved — if it's me, unmute
    const onHandApproved = (d: any) => {
      setHands(prev => prev.filter(h => h.userId !== d.userId));
      setParticipants(prev => prev.map(p => p.userId === d.userId ? { ...p, handRaised: false, isMuted: false } : p));
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
    socket.on('liveclass:you_can_speak',    onCanSpeak);
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
            options: p.options.map(o => o.id === ev.optionId
              ? { ...o, votes: o.votes.includes(ev.userId!) ? o.votes : [...o.votes, ev.userId!] }
              : { ...o, votes: o.votes.filter(v => v !== ev.userId) }
            ),
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
    };

    // Screen share started/stopped
    const onScreenShareStarted = () => {
      showMessage({ message: '🖥️ Teacher is sharing their screen', type: 'info', duration: 2000 });
    };
    const onScreenShareStopped = () => {
      showMessage({ message: 'Screen share ended', type: 'info', duration: 1500 });
    };

    socket.on('liveclass:poll',                 onPollEvent);
    socket.on('liveclass:quran_position',       onQuranPosition);
    socket.on('liveclass:draw',                 onDraw);
    socket.on('liveclass:viewmode_changed',     onViewModeChanged);
    socket.on('liveclass:screen_share_started', onScreenShareStarted);
    socket.on('liveclass:screen_share_stopped', onScreenShareStopped);

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
      socket.off('liveclass:you_can_speak',    onCanSpeak);
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
    if (!liveClass) return;
    if (liveClass.status === 'ENDED')     { showMessage({ message: 'Class has ended', type: 'warning' }); return; }
    if (liveClass.status === 'CANCELLED') { showMessage({ message: 'Class was cancelled', type: 'warning' }); return; }
    if (liveClass.status === 'SCHEDULED' && !isHost) { showMessage({ message: 'Class has not started yet', type: 'warning' }); return; }
    setIsConnecting(true);
    try {
      await api.post(`/live-classes/${id}/join`);
      const token = (await import('@/store/auth.store')).useAuthStore.getState().accessToken;
      if (token && !getSocket()?.connected) initSocket(token);
      getSocket()?.emit('liveclass:join_room', id);
      setIsJoined(true);
      // Load chat history
      const chatRes = await api.get(`/live-classes/${id}/messages`, { params: { limit: 50 } });
      const msgs: ChatMessage[] = (chatRes.data.data?.messages ?? chatRes.data.data ?? []).map((m: any) => ({
        id: m.id, userId: m.userId,
        userName: m.user ? `${m.user.firstName} ${m.user.lastName}`.trim() : 'User',
        message: m.body, timestamp: new Date(m.createdAt),
      }));
      setChatMessages([
        { id: 'sys-join', userId: 'system', userName: 'System', message: `Welcome to ${liveClass.title}`, timestamp: new Date() },
        ...msgs,
      ]);
      // Load participants
      const pRes = await api.get(`/live-classes/${id}/participants`);
      setParticipants((pRes.data.data ?? []).map((p: any) => ({
        userId: p.userId, firstName: p.user?.firstName ?? '', lastName: p.user?.lastName ?? '',
        avatarUrl: p.user?.avatarUrl, role: p.role, isMuted: p.isMuted ?? true, handRaised: p.handRaised ?? false,
      })));
      if (isHost) loadHands();
      showMessage({ message: 'Joined live class', type: 'success' });

      // LC-003 FIX: Load cached poll state from Redis so students joining mid-class
      // see polls that were created before they joined.
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

      // Connect LiveKit for real audio (native builds only)
      try {
        const tkRes = await api.post(`/live-classes/${id}/livekit-token`);
        const { token: lkToken, livekitUrl } = tkRes.data.data;
        if (lkToken && livekitUrl) await lk.connect(livekitUrl, lkToken, true);
      } catch { /* non-fatal */ }
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message ?? 'Failed to join', type: 'danger' });
    } finally { setIsConnecting(false); }
  }, [id, liveClass, isHost, loadHands]);

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
      if (!handRaised) { await api.post(`/live-classes/${id}/hand/raise`); setHandRaised(true); showMessage({ message: '✋ Hand raised', type: 'info', duration: 1500 }); }
      else { await api.post(`/live-classes/${id}/hand/lower`); setHandRaised(false); }
    } catch {}
  }, [id, isJoined, handRaised]);

  // NEW: send emoji reaction to all participants
  const REACTIONS = ['👍','❤️','😂','😮','👏','🔥','🎉','💯'];
  const sendReaction = useCallback(async (emoji: string) => {
    const socket = getSocket();
    if (socket) socket.emit('liveclass:reaction', { liveClassId: id, emoji });
  }, [id]);

  // NEW: request to speak (student sends request to host)
  const handleSpeakRequest = useCallback(async () => {
    if (!isJoined || isHost) return;
    try {
      await api.post(`/live-classes/${id}/speak-request`);
      showMessage({ message: '🙋 Speak request sent to host', type: 'info', duration: 2000 });
    } catch {}
  }, [id, isJoined, isHost]);

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
          options: p.options.map(o => o.id === ev.optionId
            ? { ...o, votes: o.votes.includes(ev.userId!) ? o.votes : [...o.votes, ev.userId!] }
            : { ...o, votes: o.votes.filter(v => v !== ev.userId) }
          ),
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
      // Notify other participants via API + socket
      if (user?.id) {
        await api.patch(`/live-classes/${id}/participants/${user.id}/video`, { isVideoOn: next }).catch(() => {});
      }
      const socket = getSocket();
      socket?.emit('liveclass:video_changed', { liveClassId: id, isVideoOn: next });
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
      <Stack.Screen options={{ headerShown: true, title: liveClass.title, headerTintColor: '#4f46e5', headerStyle: { backgroundColor: '#0f0f23' }, headerTitleStyle: { color: '#fff' } }} />
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Tab bar */}
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

        {/* ── STREAM TAB ──────────────────────────────────────────────── */}
        {activeTab === 'video' && (
          <View style={styles.videoArea}>
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
                viewMode === 'audio' ? (
                  /* Audio-only mode: show avatar circles */
                  <View style={styles.audioModeWrap}>
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
                  <>
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
                  </>
                )
              ) : (
                <View style={styles.preJoin}>
                  <Ionicons name="videocam-off-outline" size={48} color="#6b7280" />
                  <Text style={styles.preJoinTitle}>{liveClass.title}</Text>
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
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>{liveClass.title}</Text>
              {liveClass.description ? <Text style={styles.infoDesc}>{liveClass.description}</Text> : null}
            </View>
          </View>
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
          </ScrollView>
        )}

        {/* Bottom controls */}
        {isJoined && (
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
            <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, 8) }]}>
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
              <TouchableOpacity style={[styles.ctrlBtn, !isMuted && styles.ctrlBtnActive]} onPress={async () => {
                const newMuted = !isMuted;
                setIsMuted(newMuted);
                try { await api.patch(`/live-classes/${id}/participants/${user?.id}/mute`, { muted: newMuted }); } catch {}
                if (lk.connected) { if (newMuted) lk.disableMic(); else lk.enableMic(); }
              }}>
                <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={22} color={isMuted ? '#6b7280' : '#4f46e5'} />
                <Text style={styles.ctrlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
              </TouchableOpacity>
              {/* Camera toggle */}
              <TouchableOpacity
                style={[styles.ctrlBtn, isCameraOn && styles.ctrlBtnActive]}
                onPress={handleToggleCamera}
              >
                <Ionicons name={isCameraOn ? 'videocam' : 'videocam-off'} size={22} color={isCameraOn ? '#4f46e5' : '#6b7280'} />
                <Text style={styles.ctrlLabel}>{isCameraOn ? 'Cam On' : 'Camera'}</Text>
              </TouchableOpacity>
              {/* Emoji reactions */}
              <TouchableOpacity style={[styles.ctrlBtn, showReactions && styles.ctrlBtnActive]} onPress={() => setShowReactions(r => !r)}>
                <Text style={{ fontSize: 20 }}>😊</Text>
                <Text style={styles.ctrlLabel}>React</Text>
              </TouchableOpacity>
              {isHost && hands.length > 0 && (
                <TouchableOpacity style={[styles.ctrlBtn, { position: 'relative' }]} onPress={() => setShowHands(true)}>
                  <Text style={{ fontSize: 20 }}>✋</Text>
                  <Text style={styles.ctrlLabel}>Hands</Text>
                  <View style={[styles.badge, { position: 'absolute', top: 4, right: 4 }]}><Text style={styles.badgeText}>{hands.length}</Text></View>
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
              <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnDanger]} onPress={isHost ? handleEndClass : handleLeave}>
                <Ionicons name={isHost ? 'stop' : 'call'} size={22} color="#fff" />
                <Text style={[styles.ctrlLabel, { color: '#fff' }]}>{isHost ? 'End' : 'Leave'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Modals */}
      <HandQueueModal visible={showHands} hands={hands} onClose={() => setShowHands(false)} onApprove={handleApproveHand} onReject={handleRejectHand} />
      <ParticipantsModal visible={showParticipants} participants={participants} myId={user?.id ?? ''} onClose={() => setShowParticipants(false)} onMute={handleMuteParticipant} onKick={handleKickParticipant} />
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
  videoPlaceholder:   { flex: 1, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
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
  livePill:           { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ef444422', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, gap: 5 },
  liveDot:            { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ef4444' },
  liveText:           { color: '#ef4444', fontSize: 12, fontWeight: '700' },
  videoNote:          { color: '#6b7280', fontSize: 12, marginTop: 12, textAlign: 'center', paddingHorizontal: 24 },
  participantCount:   { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  participantCountText: { color: '#a5b4fc', fontSize: 13 },
  viewAllBtn:         { paddingHorizontal: 8, paddingVertical: 2, backgroundColor: '#4f46e522', borderRadius: 8 },
  viewAllText:        { color: '#a5b4fc', fontSize: 11, fontWeight: '600' },
  preJoin:            { alignItems: 'center', gap: 12, paddingHorizontal: 32 },
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
  controls:         { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  ctrlBtn:          { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e1e3a', borderRadius: 14, padding: 10, minWidth: 58, height: 58 },
  ctrlBtnActive:    { backgroundColor: '#4f46e522', borderWidth: 1.5, borderColor: '#4f46e5' },
  ctrlBtnDanger:    { backgroundColor: '#ef4444' },
  ctrlLabel:        { color: '#9ca3af', fontSize: 10, marginTop: 3, fontWeight: '600' },
  // Emoji reaction bar
  reactionBar:      { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8, paddingVertical: 8, backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1e1e3a' },
  reactionBtn:      { padding: 6 },
});
