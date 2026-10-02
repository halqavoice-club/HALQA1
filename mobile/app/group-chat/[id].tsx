/**
 * HALQA Mobile — Group Chat Thread (Telegram-parity)
 *
 * Features added to match web:
 *  - Pinned message banner (tap to scroll, X to dismiss)
 *  - Message delete in long-press action sheet
 *  - Forward message (group picker modal)
 *  - File / image attachment via expo-document-picker + POST /upload
 *  - Admin actions: kick member, promote/demote (from members modal)
 *  - Context menu: Reply / React / Pin / Forward / Delete
 *  - SCHOOL_ONLY / CLASS_ONLY privacy shown in header tag
 *  - Read receipt per message (resolveReadReceipt parity)
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  Platform, ActivityIndicator, Modal, Pressable, Alert, Image,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import {
  useInfiniteQuery, useMutation, useQueryClient, useQuery,
} from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, isToday, isYesterday } from 'date-fns';
import { showMessage } from 'react-native-flash-message';
import api, { getBaseURL } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';
import { DmMediaBubble } from '@/components/dm/DmMediaBubble';
import { GcInputBar } from '@/components/group-chat/GcInputBar';
import { MobileShareSheet } from '@/components/chat/MobileShareSheet';

// ─── Resolve relative upload URLs ─────────────────────────────────────────────
const BACKEND_BASE = getBaseURL().replace('/api/v1', '');
function resolveUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return `${BACKEND_BASE}${url}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface GcUser  { id: string; firstName: string; lastName: string; avatarUrl: string | null }
interface GcReply { id: string; body: string | null; sender: GcUser }
interface GcReact { id: string; type: string; userId: string; user: GcUser }
interface GcMsg {
  id: string; conversationId: string; senderId: string; sender: GcUser;
  type: string; body: string | null; mediaUrl?: string | null;
  mimeType?: string | null; fileSize?: number | null;
  fileName?: string | null; duration?: number | null;
  replyToId: string | null; replyTo: GcReply | null;
  reactions: GcReact[]; deletedAt: string | null; createdAt: string;
  isPinned?: boolean; readBy?: string[];
  // Phase 6: structured entity reference (VOICE_ROOM_SHARE)
  refEntityType?: string | null;
  refEntityId?: string | null;
  voiceRoomData?: {
    id: string;
    title: string;
    coverEmoji?: string | null;
    coverImageUrl?: string | null;
    privacy?: string | null;
    status?: string | null;
    hostId?: string | null;
    maxSpeakers?: number | null;
  } | null;
}
interface GcMember { userId: string; role: string; user: GcUser }
interface GcConv {
  id: string; name: string; description: string | null; privacy: string;
  memberCount: number; members: GcMember[]; createdBy: string;
  avatarUrl: string | null;
  onlyAdminsCanSendMessages?: boolean;
  onlyAdminsCanSendMedia?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TG_BLUE   = '#2AABEE';
const TG_DARK   = '#17212b';
const TG_PANEL  = '#232e3c';
const TG_OUT    = '#2b5278';
const TG_IN     = '#182533';
const QUICK_EMOJI = ['👍','❤️','😂','😮','😢','🙏','🔥','👏'];

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d');
}

function initials(u: GcUser) {
  return `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase();
}

function privacyLabel(p: string) {
  if (p === 'PUBLIC') return '🌐';
  if (p === 'PRIVATE') return '🔒';
  if (p === 'SCHOOL_ONLY') return '🏫';
  if (p === 'CLASS_ONLY') return '📚';
  return '';
}

// ─── Reaction pills ────────────────────────────────────────────────────────────
function Reactions({ reactions, myId, onToggle }: {
  reactions: GcReact[]; myId: string; onToggle: (type: string) => void;
}) {
  if (!reactions?.length) return null;
  const grouped = reactions.reduce<Record<string,number>>((a,r) => {
    a[r.type] = (a[r.type] ?? 0) + 1; return a;
  }, {});
  return (
    <View style={s.reactRow}>
      {Object.entries(grouped).map(([type, count]) => {
        const mine = reactions.some(r => r.type === type && r.userId === myId);
        return (
          <TouchableOpacity key={type} onPress={() => onToggle(type)}
            style={[s.reactPill, mine && s.reactPillMine]}>
            <Text style={s.reactEmoji}>{type}</Text>
            {count > 1 && <Text style={[s.reactCount, mine && { color: TG_BLUE }]}>{count}</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Date separator ───────────────────────────────────────────────────────────
function DateSep({ iso }: { iso: string }) {
  const d = new Date(iso);
  const label = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'MMMM d, yyyy');
  return (
    <View style={s.dateSep}>
      <Text style={s.dateText}>{label}</Text>
    </View>
  );
}

// ─── Typing indicator ──────────────────────────────────────────────────────────
function TypingRow({ names }: { names: string[] }) {
  if (!names.length) return null;
  const label = names.length === 1
    ? `${names[0]} is typing…`
    : `${names.length} people are typing…`;
  return (
    <View style={s.typingRow}>
      <View style={s.typingDots}>
        {[0,1,2].map(i => <View key={i} style={[s.typingDot, { opacity: 0.4 + i * 0.2 }]} />)}
      </View>
      <Text style={s.typingText}>{label}</Text>
    </View>
  );
}

// ─── Message bubble ────────────────────────────────────────────────────────────
function Bubble({ msg, isMe, showAvatar, showName, myId, onLongPress, onReact }: {
  msg: GcMsg; isMe: boolean; showAvatar: boolean; showName: boolean;
  myId: string; onLongPress: () => void; onReact: (type: string) => void;
}) {
  const renderContent = () => {
    // DmMediaBubble handles all types: TEXT, IMAGE, VIDEO, GIF, VOICE, AUDIO, FILE, VOICE_ROOM_SHARE
    // It accepts the same interface shape (msg.msgType → msg.type alias below)
    const mediaMsgShape = {
      body: msg.body,
      msgType: msg.type as any,  // DmMediaBubble uses msgType, we have type
      mediaUrl: msg.mediaUrl,
      mimeType: msg.mimeType,
      fileSize: msg.fileSize,
      fileName: msg.fileName,
      duration: msg.duration,
      // Phase 6: forward structured entity reference fields for VOICE_ROOM_SHARE
      refEntityType: msg.refEntityType,
      refEntityId:   msg.refEntityId,
      voiceRoomData: msg.voiceRoomData,
    };
    return <DmMediaBubble msg={mediaMsgShape as any} isMe={isMe} />;
  };

  return (
    <View style={[s.msgRow, isMe && s.msgRowMe]}>
      {/* Avatar column */}
      <View style={s.avatarCol}>
        {!isMe && showAvatar ? (
          <View style={s.avCircle}>
            <Text style={s.avText}>{initials(msg.sender)}</Text>
          </View>
        ) : !isMe ? <View style={{ width: 30 }} /> : null}
      </View>

      <View style={[s.bubbleCol, isMe && s.bubbleColMe]}>
        {/* Sender name */}
        {!isMe && showName && (
          <Text style={s.senderName}>{msg.sender.firstName} {msg.sender.lastName}</Text>
        )}

        {/* Reply preview */}
        {msg.replyTo && (
          <View style={[s.replyBox, isMe && s.replyBoxMe]}>
            <View style={[s.replyBar, { backgroundColor: TG_BLUE }]} />
            <View style={{ flex: 1 }}>
              <Text style={[s.replyName, { color: TG_BLUE }]}>{msg.replyTo.sender.firstName}</Text>
              <Text style={s.replyBody} numberOfLines={1}>{msg.replyTo.body ?? '📎 Media'}</Text>
            </View>
          </View>
        )}

        {/* Bubble */}
        <TouchableOpacity activeOpacity={0.85} onLongPress={onLongPress} delayLongPress={350}
          style={[s.bubble, isMe ? s.bubbleMe : s.bubbleThem]}>
          {renderContent()}
          <View style={s.metaRow}>
            <Text style={s.timeText}>{fmtTime(msg.createdAt)}</Text>
            {msg.isPinned && <Ionicons name="pin" size={9} color={TG_BLUE} style={{ marginLeft: 3 }} />}
            {/* Read receipt ticks for own messages */}
            {isMe && (
              <View style={{ flexDirection: 'row', marginLeft: 3 }}>
                {(msg.readBy?.length ?? 0) > 0 ? (
                  <>
                    <Ionicons name="checkmark" size={11} color={TG_BLUE} style={{ marginRight: -5 }} />
                    <Ionicons name="checkmark" size={11} color={TG_BLUE} />
                  </>
                ) : (
                  <>
                    <Ionicons name="checkmark" size={11} color="#6c8998" style={{ marginRight: -5 }} />
                    <Ionicons name="checkmark" size={11} color="#6c8998" />
                  </>
                )}
              </View>
            )}
          </View>
        </TouchableOpacity>

        {/* Reactions */}
        <Reactions reactions={msg.reactions} myId={myId} onToggle={onReact} />
      </View>
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function GroupChatThreadScreen() {
  const { id: convId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const flatRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingEmit = useRef(0);

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<GcMsg | null>(null);
  const [editingMsg, setEditingMsg] = useState<GcMsg | null>(null);
  const [selected, setSelected] = useState<GcMsg | null>(null);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [showMembers, setShowMembers] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'info' | 'members' | 'permissions'>('info');
  const [pinnedDismissed, setPinnedDismissed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showForward, setShowForward] = useState(false);
  const [forwardMsg, setForwardMsg] = useState<GcMsg | null>(null);
  // In-thread search
  const [showSearch, setShowSearch] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<GcMsg[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  // ── Load conversation ──────────────────────────────────────────────────────
  const { data: conv } = useQuery<GcConv>({
    queryKey: ['group-conv', convId],
    queryFn: () => api.get(`/group-chat/conversations/${convId}`).then(r => r.data.data),
    enabled: !!convId,
  });

  // ── Load messages ──────────────────────────────────────────────────────────
  const { data, fetchNextPage, hasNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['group-messages', convId],
    queryFn: ({ pageParam }) =>
      api.get(`/group-chat/conversations/${convId}/messages`, {
        params: { before: pageParam, limit: 50 },
      }).then(r => {
        // Map reads → readBy so read receipts render correctly (BUG-8 fix parity)
        const msgs: any[] = r.data.data ?? [];
        return msgs.map(m => ({
          ...m,
          readBy: Array.isArray(m.reads) ? m.reads.map((rd: any) => rd.userId) : (m.readBy ?? []),
        }));
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: GcMsg[]) =>
      page?.length === 50 ? page[0]?.createdAt : undefined,
    enabled: !!convId,
  });

  const rawMessages: GcMsg[] = (data?.pages.flatMap(p => p) ?? []).slice().reverse();

  // Build date-separated list
  type Item = GcMsg | { _sep: string };
  const listItems: Item[] = [];
  let lastDate = '';
  for (const msg of rawMessages) {
    const d = msg.createdAt.slice(0, 10);
    if (d !== lastDate) { listItems.push({ _sep: msg.createdAt }); lastDate = d; }
    listItems.push(msg);
  }

  const pinnedMsg = rawMessages.find(m => m.isPinned);
  const currentMember = conv?.members?.find(m => m.userId === user?.id);
  const isAdmin = currentMember?.role === 'ADMIN' || currentMember?.role === 'OWNER';
  const isOwner = currentMember?.role === 'OWNER';

  // ── Mark read ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!convId || !rawMessages.length) return;
    const ids = rawMessages.slice(-20).map(m => m.id);
    api.post(`/group-chat/conversations/${convId}/read`, { messageIds: ids }).catch(() => {});
  }, [convId, rawMessages.length]); // eslint-disable-line

  // ── Socket ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !convId) return;
    socket.emit('group:join', convId);

    const onMsg = (msg: GcMsg) => {
      if (msg.conversationId !== convId) return;
      qc.invalidateQueries({ queryKey: ['group-messages', convId] });
      qc.invalidateQueries({ queryKey: ['group-conversations'] });
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    };
    const onReact = () => qc.invalidateQueries({ queryKey: ['group-messages', convId] });
    const onDeleted = (data: { conversationId: string }) => {
      if (data.conversationId === convId) qc.invalidateQueries({ queryKey: ['group-messages', convId] });
    };
    const onPinned = (data: { conversationId: string }) => {
      if (data.conversationId === convId) qc.invalidateQueries({ queryKey: ['group-messages', convId] });
    };
    const onEdited = (data: { conversationId: string; messageId: string; newBody: string }) => {
      if (data.conversationId !== convId) return;
      qc.setQueryData(['group-messages', convId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((pg: any[]) =>
            pg.map(m => m.id === data.messageId ? { ...m, body: data.newBody } : m)
          ),
        };
      });
    };
    const onTypingStart = ({ convId: cid, userId: tid, userName }: any) => {
      if (cid !== convId || tid === user?.id) return;
      const name = userName || tid; // fallback to userId if name missing
      setTypingNames(prev => prev.includes(name) ? prev : [...prev, name]);
    };
    // BUG-5 FIX: server typing_stop sends `userId` not `userName` — look up by userId
    const onTypingStop = ({ convId: cid, userId: tid }: any) => {
      if (cid !== convId) return;
      // Remove any entry that starts with the userId (in case name is missing, we stored userId as fallback)
      // More robust: re-query conv members for the name matching this userId
      setTypingNames(prev => {
        // Try to find the member's name from conv to match against stored name
        const member = conv?.members?.find(m => m.userId === tid);
        const nameToRemove = member ? `${member.user.firstName}` : tid;
        return prev.filter(n => n !== nameToRemove && n !== tid);
      });
    };

    socket.on('group:message', onMsg);
    socket.on('group:reaction', onReact);
    socket.on('group:message_deleted', onDeleted);
    socket.on('group:message_pinned', onPinned);
    socket.on('group:message_edited', onEdited);
    socket.on('group:typing_start', onTypingStart);
    socket.on('group:typing_stop', onTypingStop);

    // Role/ownership/settings changes → refresh conversation
    const onRoleChanged = (data: { conversationId: string }) => {
      if (data.conversationId === convId) qc.invalidateQueries({ queryKey: ['group-conv', convId] });
    };
    const onOwnershipTransferred = (data: { conversationId: string }) => {
      if (data.conversationId === convId) {
        qc.invalidateQueries({ queryKey: ['group-conv', convId] });
        showMessage({ message: 'Group ownership has been transferred', type: 'info', duration: 2500 });
      }
    };
    const onSettingsUpdated = (data: { conversationId: string }) => {
      if (data.conversationId === convId) qc.invalidateQueries({ queryKey: ['group-conv', convId] });
    };
    const onGroupDeleted = (data: { conversationId: string; name: string }) => {
      if (data.conversationId === convId) {
        showMessage({ message: `Group "${data.name}" has been deleted`, type: 'warning', duration: 3000 });
        router.back();
      }
    };
    socket.on('group:member_role_changed', onRoleChanged);
    socket.on('group:ownership_transferred', onOwnershipTransferred);
    socket.on('group:settings_updated', onSettingsUpdated);
    socket.on('group:permissions_updated', onSettingsUpdated);
    socket.on('group:deleted', onGroupDeleted);
    // BUG-9 FIX: Refresh conversation when members are added or removed
    const onMemberChanged = (data: { conversationId: string }) => {
      if (data.conversationId === convId) qc.invalidateQueries({ queryKey: ['group-conv', convId] });
    };
    socket.on('group:member_added', onMemberChanged);
    socket.on('group:member_removed', onMemberChanged);

    return () => {
      socket.emit('group:leave', convId);
      socket.off('group:message', onMsg);
      socket.off('group:reaction', onReact);
      socket.off('group:message_deleted', onDeleted);
      socket.off('group:message_pinned', onPinned);
      socket.off('group:message_edited', onEdited);
      socket.off('group:typing_start', onTypingStart);
      socket.off('group:typing_stop', onTypingStop);
      socket.off('group:member_role_changed', onRoleChanged);
      socket.off('group:ownership_transferred', onOwnershipTransferred);
      socket.off('group:settings_updated', onSettingsUpdated);
      socket.off('group:permissions_updated', onSettingsUpdated);
      socket.off('group:deleted', onGroupDeleted);
      socket.off('group:member_added', onMemberChanged);
      socket.off('group:member_removed', onMemberChanged);
    };
  }, [convId, user?.id, qc]);

  // ── In-thread search ───────────────────────────────────────────────────────
  const handleSearch = useCallback((q: string) => {
    setSearchQ(q);
    clearTimeout(searchTimer.current);
    if (!q.trim() || !convId) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const r = await api.get(`/group-chat/conversations/${convId}/search`, { params: { q: q.trim(), limit: 20 } });
        setSearchResults(r.data.data ?? []);
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 400);
  }, [convId]);

  // ── Typing emit ────────────────────────────────────────────────────────────
  const handleTextChange = useCallback((val: string) => {
    setText(val);
    if (!convId) return;
    const socket = getSocket();
    if (!socket) return;
    const now = Date.now();
    if (now - lastTypingEmit.current > 2500) {
      socket.emit('group:typing_start', { convId, userId: user?.id, userName: user?.firstName });
      lastTypingEmit.current = now;
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socket.emit('group:typing_stop', { convId, userId: user?.id, userName: user?.firstName });
      lastTypingEmit.current = 0;
    }, 2500);
  }, [convId, user]);

  // ── Send ───────────────────────────────────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      api.post(`/group-chat/conversations/${convId}/messages`, {
        body, type: 'TEXT', replyToId: replyTo?.id,
      }),
    onSuccess: () => {
      setText(''); setReplyTo(null);
      const socket = getSocket();
      socket?.emit('group:typing_stop', { convId, userId: user?.id, userName: user?.firstName });
      qc.invalidateQueries({ queryKey: ['group-messages', convId] });
      qc.invalidateQueries({ queryKey: ['group-conversations'] });
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    },
    onError: () => showMessage({ message: 'Failed to send', type: 'danger' }),
  });

  // ── Delete ─────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (msgId: string) => api.delete(`/group-chat/messages/${msgId}`),
    onMutate: async (msgId: string) => {
      // Optimistically remove from cache immediately — don't wait for refetch
      qc.setQueryData(['group-messages', convId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((pg: any[]) => pg.filter((m: any) => m.id !== msgId)),
        };
      });
    },
    onSuccess: () => {
      showMessage({ message: 'Deleted', type: 'info', duration: 1500 });
    },
    onError: () => {
      // Revert by refetching on failure
      qc.invalidateQueries({ queryKey: ['group-messages', convId] });
      showMessage({ message: 'Failed to delete', type: 'danger' });
    },
  });

  // ── Pin ────────────────────────────────────────────────────────────────────
  const pinMutation = useMutation({
    mutationFn: ({ msgId, pin }: { msgId: string; pin: boolean }) =>
      api.post(`/group-chat/conversations/${convId}/messages/${msgId}/pin`, { pin }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-messages', convId] });
      setPinnedDismissed(false);
    },
    onError: () => showMessage({ message: 'Failed to pin', type: 'danger' }),
  });

  // ── React ──────────────────────────────────────────────────────────────────
  const reactMutation = useMutation({
    mutationFn: ({ msgId, type }: { msgId: string; type: string }) =>
      api.post(`/group-chat/messages/${msgId}/reactions`, { type }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['group-messages', convId] }),
  });

  // ── Edit ───────────────────────────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: ({ msgId, body }: { msgId: string; body: string }) =>
      api.patch(`/group-chat/messages/${msgId}`, { body }),
    onSuccess: (_, { msgId, body }) => {
      qc.setQueryData(['group-messages', convId], (old: any) => {
        if (!old) return old;
        return { ...old, pages: old.pages.map((pg: any[]) =>
          pg.map(m => m.id === msgId ? { ...m, body, isEdited: true } : m)
        )};
      });
      setEditingMsg(null);
      showMessage({ message: 'Edited', type: 'success', duration: 1200 });
    },
    onError: (err: any) => showMessage({ message: err?.response?.data?.message ?? 'Edit failed', type: 'danger' }),
  });

  // ── File upload ────────────────────────────────────────────────────────────
  const handleAttach = useCallback(async () => {
    if (!convId) return;
    try {
      const DocPicker = await import('expo-document-picker');
      const result = await DocPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      setUploading(true);
      const form = new FormData();
      form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as any);
      const res = await api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const fileUrl: string = res.data.data?.url;
      if (!fileUrl) throw new Error('No URL');
      const isImage = /\.(jpe?g|png|gif|webp)$/i.test(fileUrl);
      const isVideo = /\.(mp4|webm|mov)$/i.test(fileUrl);
      const type = isImage ? 'IMAGE' : isVideo ? 'VIDEO' : 'DOCUMENT';
      await api.post(`/group-chat/conversations/${convId}/messages`, {
        type, mediaUrl: fileUrl, mimeType: file.mimeType, fileSize: file.size,
      });
      qc.invalidateQueries({ queryKey: ['group-messages', convId] });
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e: any) {
      if (!e?.message?.includes('canceled'))
        showMessage({ message: e?.message ?? 'Upload failed', type: 'danger' });
    } finally { setUploading(false); }
  }, [convId, qc]);

  // ── Forward — handled by MobileShareSheet ─────────────────────────────────
  // (MobileShareSheet manages DM + Group + Feed + Community forwarding)

  // ── Admin: kick member ─────────────────────────────────────────────────────
  const kickMutation = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/group-chat/conversations/${convId}/members/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-conv', convId] });
      showMessage({ message: 'Member removed', type: 'success' });
    },
    onError: () => showMessage({ message: 'Failed to remove', type: 'danger' }),
  });

  // ── Update group settings ──────────────────────────────────────────────────
  const updateGroupMutation = useMutation({
    mutationFn: (data: { name?: string; description?: string; privacy?: string; avatarUrl?: string }) =>
      api.patch(`/group-chat/conversations/${convId}`, data),
    onMutate: async (data) => {
      // Optimistic update: patch conv query cache immediately
      qc.setQueryData(['group-conv', convId], (old: any) =>
        old ? { ...old, ...data } : old
      );
      qc.setQueryData(['group-conversations'], (old: any) => {
        if (!old) return old;
        return (old as any[]).map((c: any) => c.id === convId ? { ...c, ...data } : c);
      });
    },
    onSuccess: (_, data) => {
      qc.invalidateQueries({ queryKey: ['group-conv', convId] });
      qc.invalidateQueries({ queryKey: ['group-conversations'] });
      showMessage({ message: data.avatarUrl ? 'Group photo updated' : 'Group updated', type: 'success', duration: 1500 });
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ['group-conv', convId] });
      showMessage({ message: e?.response?.data?.message ?? 'Failed to update', type: 'danger' });
    },
  });

  // ── Delete group (OWNER only) ──────────────────────────────────────────────
  const deleteGroupMutation = useMutation({
    mutationFn: () => api.delete(`/group-chat/conversations/${convId}`),
    onSuccess: () => {
      showMessage({ message: 'Group deleted', type: 'success', duration: 1500 });
      router.back();
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Failed to delete group', type: 'danger' }),
  });

  // ── Promote / demote member ────────────────────────────────────────────────
  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'ADMIN' | 'MEMBER' | 'OWNER' }) =>
      api.patch(`/group-chat/conversations/${convId}/members/${userId}/role`, { role }),
    onSuccess: (_, { role }) => {
      qc.invalidateQueries({ queryKey: ['group-conv', convId] });
      const msg = role === 'OWNER' ? 'Ownership transferred' : role === 'ADMIN' ? 'Promoted to admin' : 'Demoted to member';
      showMessage({ message: msg, type: 'success', duration: 1500 });
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }),
  });

  // ── Update permissions ─────────────────────────────────────────────────────
  const updatePermsMutation = useMutation({
    mutationFn: (data: { onlyAdminsCanSendMessages?: boolean; onlyAdminsCanSendMedia?: boolean }) =>
      api.patch(`/group-chat/conversations/${convId}/permissions`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-conv', convId] });
      showMessage({ message: 'Permissions updated', type: 'success', duration: 1500 });
    },
    onError: () => showMessage({ message: 'Failed to update permissions', type: 'danger' }),
  });

  // ── Long-press handler ─────────────────────────────────────────────────────
  const handleLongPress = useCallback((msg: GcMsg) => {
    setSelected(msg);
  }, []);

  const handleSheetAction = useCallback((action: string) => {
    if (!selected) return;
    setSelected(null);
    switch (action) {
      case 'reply':
        setReplyTo(selected);
        setTimeout(() => inputRef.current?.focus(), 100);
        break;
      case 'copy':
        import('expo-clipboard').then(({ setStringAsync }) => {
          setStringAsync(selected.body ?? '');
          showMessage({ message: 'Copied', type: 'success', duration: 1200 });
        }).catch(() => {});
        break;
      case 'edit':
        setEditingMsg(selected);
        setReplyTo(null);
        break;
      case 'pin':
        if (isAdmin) pinMutation.mutate({ msgId: selected.id, pin: !selected.isPinned });
        break;
      case 'forward':
        setForwardMsg(selected);
        setShowForward(true);
        break;
      case 'delete':
        Alert.alert('Delete message', 'Remove this message?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(selected.id) },
        ]);
        break;
    }
  }, [selected, isAdmin, pinMutation, deleteMutation]);

  // ── Render item ────────────────────────────────────────────────────────────
  const renderItem = useCallback(({ item, index }: { item: Item; index: number }) => {
    if ('_sep' in item) return <DateSep iso={item._sep} />;
    const msg = item as GcMsg;
    const isMe = msg.senderId === user?.id;
    const prev = listItems[index - 1];
    const prevMsg = prev && !('_sep' in prev) ? prev as GcMsg : null;
    const showAvatar = !prevMsg || prevMsg.senderId !== msg.senderId;
    return (
      <Bubble
        msg={msg} isMe={isMe} showAvatar={showAvatar} showName={showAvatar && !isMe}
        myId={user?.id ?? ''}
        onLongPress={() => handleLongPress(msg)}
        onReact={(type) => reactMutation.mutate({ msgId: msg.id, type })}
      />
    );
  }, [user?.id, listItems, handleLongPress, reactMutation]);

  const isOwnSelected = selected?.senderId === user?.id;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top:10, bottom:10, left:10, right:10 }}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={s.headerAv} onPress={() => setShowMembers(true)}>
          {conv?.avatarUrl ? (
            <Image
              source={{ uri: resolveUrl(conv.avatarUrl) ?? undefined }}
              style={{ width: 38, height: 38, borderRadius: 19 }}
            />
          ) : (
            <View style={s.avCircle}>
              <Text style={s.avText}>{(conv?.name ?? '?').slice(0,2).toUpperCase()}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={s.headerCenter} onPress={() => setShowMembers(true)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={s.headerName} numberOfLines={1}>{conv?.name ?? '…'}</Text>
            {conv && <Text style={s.privacyTag}>{privacyLabel(conv.privacy)}</Text>}
          </View>
          <Text style={s.headerSub}>
            {typingNames.length > 0
              ? `${typingNames[0]} typing…`
              : `${conv?.memberCount ?? 0} members`}
          </Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <TouchableOpacity style={s.headerBtn} onPress={() => { setShowSearch(v => !v); setSearchQ(''); setSearchResults([]); }}>
            <Ionicons name="search-outline" size={20} color="#aab8c2" />
          </TouchableOpacity>
          <TouchableOpacity style={s.headerBtn} onPress={() => setShowMembers(true)}>
            <Ionicons name="people-outline" size={20} color="#aab8c2" />
          </TouchableOpacity>
          {/* Three-dot menu */}
          <TouchableOpacity style={s.headerBtn} onPress={() => {
            const opts: string[] = [];
            if (isAdmin) opts.push('Group Settings');
            if (isAdmin) opts.push('Add Member');
            opts.push('Group Info');
            opts.push('Leave Group');
            Alert.alert(
              conv?.name ?? 'Options',
              undefined,
              [
                ...(isAdmin ? [{ text: 'Group Settings', onPress: () => { setSettingsTab('info'); setShowSettings(true); } }] : []),
                ...(isAdmin ? [{ text: 'Add Member', onPress: () => setShowMembers(true) }] : []),
                { text: 'Group Info', onPress: () => setShowMembers(true) },
                ...(isOwner ? [{
                  text: 'Delete Group', style: 'destructive' as const, onPress: () =>
                    Alert.alert('Delete Group', 'Delete this group permanently? All messages will be lost.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => deleteGroupMutation.mutate() },
                    ])
                }] : []),
                {
                  text: 'Leave Group', style: 'destructive' as const, onPress: () =>
                    Alert.alert('Leave Group', 'Leave this group?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Leave', style: 'destructive', onPress: async () => {
                        try {
                          await api.delete(`/group-chat/conversations/${convId}/members/${user?.id}`);
                          router.back();
                        } catch { showMessage({ message: 'Failed to leave', type: 'danger' }); }
                      }},
                    ])
                },
                { text: 'Cancel', style: 'cancel' as const },
              ]
            );
          }}>
            <Ionicons name="ellipsis-vertical" size={20} color="#aab8c2" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── In-thread search bar ── */}
      {showSearch && (
        <View style={{ backgroundColor: TG_PANEL, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="search-outline" size={16} color={TG_BLUE} />
          <TextInput
            autoFocus
            value={searchQ}
            onChangeText={handleSearch}
            placeholder="Search in conversation…"
            placeholderTextColor="#6c8998"
            style={{ flex: 1, color: '#e8e8e8', fontSize: 14 }}
          />
          {searchLoading && <ActivityIndicator size="small" color={TG_BLUE} />}
          {searchQ.length > 0 && !searchLoading && (
            <Text style={{ color: '#6c8998', fontSize: 11 }}>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</Text>
          )}
          <TouchableOpacity onPress={() => { setShowSearch(false); setSearchQ(''); setSearchResults([]); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={18} color="#aab8c2" />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Search results overlay ── */}
      {showSearch && searchResults.length > 0 && (
        <View style={{ backgroundColor: TG_DARK, maxHeight: 200, borderBottomWidth: 1, borderBottomColor: '#0e1621' }}>
          <FlatList
            data={searchResults}
            keyExtractor={m => m.id}
            renderItem={({ item }) => (
              <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0e1621' }}>
                <Text style={{ fontSize: 11, color: '#6c8998', marginBottom: 2 }}>
                  {item.sender.firstName} · {format(new Date(item.createdAt), 'MMM d, HH:mm')}
                </Text>
                <Text style={{ fontSize: 14, color: '#e8e8e8' }} numberOfLines={2}>{item.body}</Text>
              </View>
            )}
          />
        </View>
      )}

      {/* ── Pinned message ── */}
      {pinnedMsg && !pinnedDismissed && (
        <TouchableOpacity style={s.pinBanner} activeOpacity={0.8}>
          <Ionicons name="pin" size={14} color={TG_BLUE} />
          <View style={{ flex: 1 }}>
            <Text style={s.pinLabel}>Pinned Message</Text>
            <Text style={s.pinBody} numberOfLines={1}>{pinnedMsg.body}</Text>
          </View>
          {isAdmin && (
            <TouchableOpacity onPress={() => pinMutation.mutate({ msgId: pinnedMsg.id, pin: false })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={16} color="#aab8c2" />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setPinnedDismissed(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 6 }}>
            <Ionicons name="eye-off-outline" size={16} color="#aab8c2" />
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        {/* ── Messages ── */}
        {isLoading ? (
          <View style={s.center}><ActivityIndicator color={TG_BLUE} /></View>
        ) : (
          <FlatList
            ref={flatRef} data={listItems}
            keyExtractor={(item, i) => ('_sep' in item ? `sep-${i}` : (item as GcMsg).id)}
            renderItem={renderItem}
            contentContainerStyle={s.msgList}
            onEndReached={() => { if (hasNextPage) fetchNextPage(); }}
            onEndReachedThreshold={0.2}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={s.emptyWrap}>
                <Ionicons name="chatbubbles-outline" size={48} color="#2b4255" />
                <Text style={s.emptyText}>No messages yet. Say something! 👋</Text>
              </View>
            }
          />
        )}

        <TypingRow names={typingNames} />

        {/* ── GcInputBar: text + all media + voice + edit + reply ── */}
        <GcInputBar
          convId={convId}
          replyTo={replyTo}
          editingMsg={editingMsg}
          sending={sendMutation.isPending || editMutation.isPending}
          isAdmin={isAdmin}
          onlyAdminsCanSendMessages={conv?.onlyAdminsCanSendMessages}
          onlyAdminsCanSendMedia={conv?.onlyAdminsCanSendMedia}
          onSendText={async (body, replyToId) => {
            setReplyTo(null);
            getSocket()?.emit('group:typing_stop', { convId, userId: user?.id, userName: user?.firstName });
            sendMutation.mutate(body);
          }}
          onSendMedia={async (payload) => {
            await api.post(`/group-chat/conversations/${convId}/messages`, payload);
            qc.invalidateQueries({ queryKey: ['group-messages', convId] });
            qc.invalidateQueries({ queryKey: ['group-conversations'] });
            setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
          }}
          onEditSubmit={async (body) => {
            if (editingMsg) editMutation.mutate({ msgId: editingMsg.id, body });
          }}
          onTyping={() => {
            const socket = getSocket();
            if (!socket) return;
            const now = Date.now();
            if (now - lastTypingEmit.current > 2500) {
              socket.emit('group:typing_start', { convId, userId: user?.id, userName: user?.firstName });
              lastTypingEmit.current = now;
            }
            if (typingTimer.current) clearTimeout(typingTimer.current);
            typingTimer.current = setTimeout(() => {
              socket.emit('group:typing_stop', { convId, userId: user?.id, userName: user?.firstName });
              lastTypingEmit.current = 0;
            }, 2500);
          }}
          onClearReply={() => setReplyTo(null)}
          onCancelEdit={() => setEditingMsg(null)}
        />
      </KeyboardAvoidingView>

      {/* ── Long-press action sheet ── */}
      <Modal visible={!!selected} transparent animationType="fade"
        onRequestClose={() => setSelected(null)}>
        <Pressable style={s.overlay} onPress={() => setSelected(null)}>
          <View style={s.sheet}>
            {/* Quick reactions */}
            <Text style={s.sheetTitle}>React</Text>
            <View style={s.emojiRow}>
              {QUICK_EMOJI.map(e => (
                <TouchableOpacity key={e} style={s.emojiBtn}
                  onPress={() => {
                    if (selected) reactMutation.mutate({ msgId: selected.id, type: e });
                    setSelected(null);
                  }}>
                  <Text style={s.emojiText}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.sheetDivider} />

            {/* Actions */}
            {(() => {
              // ADMIN cannot delete messages sent by the OWNER
              const selectedSenderMember = conv?.members?.find(m => m.userId === selected?.senderId);
              const selectedSenderIsOwner = selectedSenderMember?.role === 'OWNER';
              const canDeleteSelected = isOwnSelected || (isAdmin && (isOwner || !selectedSenderIsOwner));
              return [
                { icon: 'return-down-forward-outline', label: 'Reply', action: 'reply' },
                { icon: 'copy-outline', label: 'Copy', action: 'copy' },
                { icon: 'arrow-redo-outline', label: 'Forward', action: 'forward' },
                ...(isAdmin ? [{ icon: 'pin-outline', label: selected?.isPinned ? 'Unpin' : 'Pin', action: 'pin' }] : []),
                ...(isOwnSelected ? [{ icon: 'pencil-outline', label: 'Edit', action: 'edit' }] : []),
                ...(canDeleteSelected ? [{ icon: 'trash-outline', label: 'Delete', action: 'delete', danger: true }] : []),
              ];
            })().map(({ icon, label, action, danger }) => (
              <TouchableOpacity key={action} style={s.sheetRow}
                onPress={() => handleSheetAction(action)}>
                <Ionicons name={icon as any} size={18} color={(danger as any) ? '#ef4444' : TG_BLUE} />
                <Text style={[s.sheetRowText, (danger as any) && { color: '#ef4444' }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* ── Settings modal ── */}
      <Modal visible={showSettings} animationType="slide" presentationStyle="formSheet"
        onRequestClose={() => setShowSettings(false)}>
        <SafeAreaView style={[s.membersModal, { backgroundColor: TG_DARK }]} edges={['top']}>
          <View style={s.membersHeader}>
            <Text style={s.membersTitle}>Group Settings</Text>
            <TouchableOpacity onPress={() => setShowSettings(false)}>
              <Ionicons name="close" size={24} color="#aab8c2" />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#0e1621' }}>
            {(['info', 'members', 'permissions'] as const).map(tab => (
              <TouchableOpacity key={tab} style={{ flex: 1, paddingVertical: 12, alignItems: 'center',
                borderBottomWidth: 2, borderBottomColor: settingsTab === tab ? TG_BLUE : 'transparent' }}
                onPress={() => setSettingsTab(tab)}>
                <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5,
                  color: settingsTab === tab ? TG_BLUE : '#6c8998' }}>
                  {tab}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView style={{ flex: 1 }}>
            {/* ── INFO TAB ── */}
            {settingsTab === 'info' && (
              <View>
                <GroupInfoEditor
                  conv={conv}
                  canEdit={isAdmin}
                  onSave={(data) => updateGroupMutation.mutate(data)}
                  saving={updateGroupMutation.isPending}
                />
                {/* Delete group — OWNER only */}
                {isOwner && (
                  <View style={{ padding: 16, paddingTop: 0 }}>
                    <TouchableOpacity
                      style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' }}
                      onPress={() => Alert.alert('Delete Group', 'Delete this group permanently? All messages will be lost. This cannot be undone.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => { setShowSettings(false); deleteGroupMutation.mutate(); } },
                      ])}>
                      <Text style={{ color: '#ef4444', fontWeight: '700', fontSize: 15 }}>Delete Group</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* ── MEMBERS TAB ── */}
            {settingsTab === 'members' && (
              <View>
                {/* Add member (admin) */}
                {isAdmin && (
                  <AddMemberRow
                    convId={convId}
                    existingMemberIds={conv?.members?.map(m => m.userId)}
                    onAdded={() => qc.invalidateQueries({ queryKey: ['group-conv', convId] })}
                  />
                )}
                <View style={{ height: 1, backgroundColor: '#0e1621', marginVertical: 8 }} />
                {(conv?.members ?? []).map(m => (
                  <View key={m.userId} style={s.memberRow}>
                    <View style={s.memberAv}>
                      <Text style={s.memberAvText}>{initials(m.user)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.memberName}>{m.user.firstName} {m.user.lastName}</Text>
                      <Text style={[s.memberRole, {
                        color: m.role === 'OWNER' ? TG_BLUE : m.role === 'ADMIN' ? '#a78bfa' : '#6c8998'
                      }]}>{m.role.toLowerCase()}</Text>
                    </View>
                    {/* Owner actions: promote/demote + kick */}
                    {isAdmin && m.role !== 'OWNER' && m.userId !== user?.id && (
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {currentMember?.role === 'OWNER' && (
                          <>
                            <TouchableOpacity style={[s.kickBtn, { backgroundColor: 'rgba(42,171,238,0.12)', borderRadius: 8 }]}
                              onPress={() => Alert.alert(
                                m.role === 'ADMIN' ? 'Demote to Member?' : 'Promote to Admin?',
                                `${m.user.firstName} will ${m.role === 'ADMIN' ? 'lose admin rights' : 'become an admin'}`,
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  { text: 'Confirm', onPress: () => updateRoleMutation.mutate({ userId: m.userId, role: m.role === 'ADMIN' ? 'MEMBER' : 'ADMIN' }) },
                                ]
                              )}>
                              <Ionicons name={m.role === 'ADMIN' ? 'chevron-down' : 'shield-outline'} size={16} color={TG_BLUE} />
                            </TouchableOpacity>
                            <TouchableOpacity style={[s.kickBtn, { backgroundColor: 'rgba(245,158,11,0.12)', borderRadius: 8 }]}
                              onPress={() => Alert.alert(
                                'Transfer Ownership',
                                `Transfer group ownership to ${m.user.firstName}? You will become an admin.`,
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  { text: 'Transfer', style: 'destructive', onPress: () => updateRoleMutation.mutate({ userId: m.userId, role: 'OWNER' }) },
                                ]
                              )}>
                              <Ionicons name="ribbon-outline" size={16} color="#f59e0b" />
                            </TouchableOpacity>
                          </>
                        )}
                        <TouchableOpacity style={s.kickBtn}
                          onPress={() => Alert.alert('Remove member', `Remove ${m.user.firstName}?`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Remove', style: 'destructive', onPress: () => kickMutation.mutate(m.userId) },
                          ])}>
                          <Ionicons name="person-remove-outline" size={16} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* ── PERMISSIONS TAB ── */}
            {settingsTab === 'permissions' && (
              <View style={{ padding: 16, gap: 16 }}>
                <Text style={{ fontSize: 12, color: '#6c8998', marginBottom: 4 }}>
                  Control what members can do in this group.
                </Text>
                {isAdmin ? (
                  <>
                    {/* Restrict messages */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                      paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#0e1621' }}>
                      <View style={{ flex: 1, marginRight: 12 }}>
                        <Text style={{ fontSize: 15, fontWeight: '600', color: '#e8e8e8' }}>Restrict Messages</Text>
                        <Text style={{ fontSize: 12, color: '#6c8998', marginTop: 2 }}>Only admins can send messages</Text>
                      </View>
                      <TouchableOpacity
                        style={{ width: 48, height: 26, borderRadius: 13, justifyContent: 'center',
                          backgroundColor: conv?.onlyAdminsCanSendMessages ? TG_BLUE : '#374151' }}
                        onPress={() => updatePermsMutation.mutate({ onlyAdminsCanSendMessages: !conv?.onlyAdminsCanSendMessages })}>
                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff',
                          position: 'absolute', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2,
                          transform: [{ translateX: conv?.onlyAdminsCanSendMessages ? 25 : 4 }] }} />
                      </TouchableOpacity>
                    </View>
                    {/* Restrict media */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 }}>
                      <View style={{ flex: 1, marginRight: 12 }}>
                        <Text style={{ fontSize: 15, fontWeight: '600', color: '#e8e8e8' }}>Restrict Media</Text>
                        <Text style={{ fontSize: 12, color: '#6c8998', marginTop: 2 }}>Only admins can send photos, videos, files</Text>
                      </View>
                      <TouchableOpacity
                        style={{ width: 48, height: 26, borderRadius: 13, justifyContent: 'center',
                          backgroundColor: conv?.onlyAdminsCanSendMedia ? TG_BLUE : '#374151' }}
                        onPress={() => updatePermsMutation.mutate({ onlyAdminsCanSendMedia: !conv?.onlyAdminsCanSendMedia })}>
                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff',
                          position: 'absolute', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2,
                          transform: [{ translateX: conv?.onlyAdminsCanSendMedia ? 25 : 4 }] }} />
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <View style={{ gap: 12 }}>
                    <Text style={{ fontSize: 14, color: '#e8e8e8' }}>
                      Messages: <Text style={{ color: TG_BLUE }}>{conv?.onlyAdminsCanSendMessages ? 'Admins only' : 'All members'}</Text>
                    </Text>
                    <Text style={{ fontSize: 14, color: '#e8e8e8' }}>
                      Media: <Text style={{ color: TG_BLUE }}>{conv?.onlyAdminsCanSendMedia ? 'Admins only' : 'All members'}</Text>
                    </Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ── Members modal ── */}
      <Modal visible={showMembers} animationType="slide" presentationStyle="formSheet"
        onRequestClose={() => setShowMembers(false)}>
        <SafeAreaView style={s.membersModal} edges={['top']}>
          <View style={s.membersHeader}>
            <Text style={s.membersTitle}>{conv?.name} · {conv?.memberCount} members</Text>
            <TouchableOpacity onPress={() => setShowMembers(false)}>
              <Ionicons name="close" size={24} color="#aab8c2" />
            </TouchableOpacity>
          </View>
          <ScrollView>
            {/* Leave Group */}
            <TouchableOpacity style={[s.memberRow, { paddingVertical: 14 }]}
              onPress={() => Alert.alert('Leave Group', 'Leave this group?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Leave', style: 'destructive', onPress: async () => {
                    try {
                      await api.delete(`/group-chat/conversations/${convId}/members/${user?.id}`);
                      setShowMembers(false);
                      router.back();
                    } catch { showMessage({ message: 'Failed to leave', type: 'danger' }); }
                  }
                },
              ])}>
              <View style={[s.memberAv, { backgroundColor: '#ef4444' }]}>
                <Ionicons name="log-out-outline" size={18} color="#fff" />
              </View>
              <Text style={[s.memberName, { color: '#ef4444' }]}>Leave Group</Text>
            </TouchableOpacity>

            {/* Add Member (admin only) */}
            {isAdmin && (
              <AddMemberRow
                convId={convId}
                existingMemberIds={conv?.members?.map(m => m.userId)}
                onAdded={() => qc.invalidateQueries({ queryKey: ['group-conv', convId] })}
              />
            )}

            <View style={{ height: 1, backgroundColor: '#0e1621', marginVertical: 8 }} />

            {(conv?.members ?? []).map(m => (
              <View key={m.userId} style={s.memberRow}>
                <View style={s.memberAv}>
                  <Text style={s.memberAvText}>{initials(m.user)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.memberName}>{m.user.firstName} {m.user.lastName}</Text>
                  <Text style={s.memberRole}>{m.role.toLowerCase()}</Text>
                </View>
                {(m.role === 'OWNER' || m.role === 'ADMIN') && (
                  <View style={s.adminBadge}><Text style={s.adminBadgeText}>Admin</Text></View>
                )}
                {isAdmin && m.userId !== user?.id && m.role !== 'OWNER' && (
                  <TouchableOpacity
                    style={s.kickBtn}
                    onPress={() => Alert.alert('Remove member', `Remove ${m.user.firstName}?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => kickMutation.mutate(m.userId) },
                    ])}>
                    <Ionicons name="person-remove-outline" size={16} color="#ef4444" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ── MobileShareSheet — DM, Group, Feed, Community ── */}
      <MobileShareSheet
        visible={showForward}
        payload={forwardMsg ? {
          body:     forwardMsg.body,
          type:     forwardMsg.type ?? 'TEXT',
          msgType:  forwardMsg.type ?? 'TEXT',
          mediaUrl: forwardMsg.mediaUrl,
          mimeType: forwardMsg.mimeType,
          fileSize: forwardMsg.fileSize,
          duration: forwardMsg.duration,
        } : null}
        onClose={() => { setShowForward(false); setForwardMsg(null); }}
      />
    </SafeAreaView>
  );
}

// ── Group Info Editor — used in the Settings modal Info tab ──────────────────
function GroupInfoEditor({
  conv, canEdit, onSave, saving
}: {
  conv: GcConv | undefined; canEdit: boolean;
  onSave: (data: { name?: string; description?: string; privacy?: string; avatarUrl?: string }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(conv?.name ?? '');
  const [desc, setDesc] = useState(conv?.description ?? '');
  const [privacy, setPrivacy] = useState(conv?.privacy ?? 'PRIVATE');
  const [localAvatar, setLocalAvatar] = useState<string | null>(conv?.avatarUrl ?? null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // Sync if conv loads after component mounts
  useEffect(() => {
    if (conv) {
      setName(conv.name);
      setDesc(conv.description ?? '');
      setPrivacy(conv.privacy);
      setLocalAvatar(conv.avatarUrl ?? null);
    }
  }, [conv?.id]);

  const handlePickAvatar = async () => {
    try {
      const ImagePicker = await import('expo-image-picker');
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showMessage({ message: 'Permission required to access photos', type: 'warning' });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setAvatarUploading(true);
      const form = new FormData();
      const fileName = asset.fileName ?? `group-avatar-${Date.now()}.jpg`;
      form.append('file', { uri: asset.uri, name: fileName, type: asset.mimeType ?? 'image/jpeg' } as any);
      const res = await api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const url: string = res.data?.data?.url;
      if (!url) throw new Error('No URL');
      setLocalAvatar(url);
      onSave({ avatarUrl: url });
    } catch (e: any) {
      if (!e?.message?.includes('cancel'))
        showMessage({ message: 'Failed to upload photo', type: 'danger' });
    } finally {
      setAvatarUploading(false);
    }
  };

  if (!canEdit) {
    return (
      <View style={{ padding: 16, gap: 12 }}>
        <View style={{ alignItems: 'center', paddingVertical: 12 }}>
          {localAvatar ? (
            <Image source={{ uri: localAvatar }} style={{ width: 72, height: 72, borderRadius: 36 }} />
          ) : (
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#2AABEE', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 24, fontWeight: '700', color: '#fff' }}>
                {(conv?.name ?? '?').slice(0, 2).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={{ marginTop: 10, fontSize: 17, fontWeight: '700', color: '#e8e8e8' }}>{conv?.name}</Text>
          {conv?.description ? <Text style={{ fontSize: 13, color: '#aab8c2', textAlign: 'center', marginTop: 4 }}>{conv.description}</Text> : null}
          <Text style={{ fontSize: 12, color: '#6c8998', marginTop: 6 }}>
            {privacyLabel(conv?.privacy ?? '')} {conv?.memberCount} members
          </Text>
        </View>
      </View>
    );
  }

  const privacyOpts = [
    { value: 'PRIVATE', label: 'Private', icon: 'lock-closed' as const },
    { value: 'PUBLIC', label: 'Public', icon: 'globe' as const },
    { value: 'SCHOOL_ONLY', label: 'School', icon: 'school' as const },
    { value: 'CLASS_ONLY', label: 'Class', icon: 'book' as const },
  ];

  return (
    <View style={{ padding: 16, gap: 16 }}>
      {/* Clickable avatar */}
      <TouchableOpacity onPress={handlePickAvatar} disabled={avatarUploading}
        style={{ alignItems: 'center', paddingBottom: 8 }}>
        <View style={{ position: 'relative' }}>
          {localAvatar ? (
            <Image source={{ uri: localAvatar }} style={{ width: 80, height: 80, borderRadius: 40 }} />
          ) : (
            <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#2AABEE', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 26, fontWeight: '700', color: '#fff' }}>
                {(name || conv?.name || '?').slice(0, 2).toUpperCase()}
              </Text>
            </View>
          )}
          {/* Camera overlay */}
          <View style={{ position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: 13,
            backgroundColor: '#2AABEE', alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: '#17212b' }}>
            {avatarUploading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="camera" size={14} color="#fff" />}
          </View>
        </View>
        <Text style={{ fontSize: 11, color: '#6c8998', marginTop: 6 }}>
          {avatarUploading ? 'Uploading…' : 'Tap to change photo'}
        </Text>
      </TouchableOpacity>

      <View>
        <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#6c8998', marginBottom: 6 }}>Group Name</Text>
        <TextInput
          value={name} onChangeText={setName}
          placeholder="Group name" placeholderTextColor="#6c8998"
          style={{ backgroundColor: '#17212b', color: '#e8e8e8', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: '#2b4255' }}
        />
      </View>

      <View>
        <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#6c8998', marginBottom: 6 }}>Description</Text>
        <TextInput
          value={desc} onChangeText={setDesc} multiline numberOfLines={3}
          placeholder="Optional description" placeholderTextColor="#6c8998" textAlignVertical="top"
          style={{ backgroundColor: '#17212b', color: '#e8e8e8', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, height: 80, borderWidth: 1, borderColor: '#2b4255' }}
        />
      </View>

      <View>
        <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#6c8998', marginBottom: 8 }}>Privacy</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {privacyOpts.map(opt => (
            <TouchableOpacity key={opt.value}
              onPress={() => setPrivacy(opt.value)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                backgroundColor: privacy === opt.value ? 'rgba(42,171,238,0.18)' : '#17212b',
                borderWidth: 1, borderColor: privacy === opt.value ? '#2AABEE' : '#2b4255' }}>
              <Ionicons name={opt.icon} size={14} color={privacy === opt.value ? '#2AABEE' : '#6c8998'} />
              <Text style={{ fontSize: 13, fontWeight: '500', color: privacy === opt.value ? '#2AABEE' : '#aab8c2' }}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity
        disabled={!name.trim() || saving}
        onPress={() => onSave({ name: name.trim(), description: desc.trim() || undefined, privacy })}
        style={{ backgroundColor: saving || !name.trim() ? '#1a4a6e' : '#2AABEE', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 }}>
        {saving
          ? <ActivityIndicator color="#fff" size="small" />
          : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Save Changes</Text>}
      </TouchableOpacity>
    </View>
  );
}

// ── Add member row ─────────────────────────────────────────────────────────────
function AddMemberRow({ convId, existingMemberIds, onAdded }: {
  convId: string;
  existingMemberIds?: string[];
  onAdded: () => void;
}) {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const { data: results = [] } = useQuery({
    queryKey: ['users-search-add', search],
    // /social/search is platform-wide — works for any authenticated user
    queryFn: () => api.get('/social/search', { params: { q: search, limit: 8 } }).then(r => r.data.data ?? []),
    enabled: search.length >= 2,
  });

  // Filter out users already in the group
  const filteredResults = (results as any[]).filter(
    (u: any) => !(existingMemberIds ?? []).includes(u.id)
  );

  return (
    <View style={{ padding: 12 }}>
      <Text style={{ color: TG_BLUE, fontWeight: '700', fontSize: 12, marginBottom: 6 }}>ADD MEMBER</Text>
      <TextInput
        value={search} onChangeText={setSearch}
        placeholder="Search by name…" placeholderTextColor="#6c8998"
        style={{ backgroundColor: '#17212b', color: '#e8e8e8', borderRadius: 10, padding: 10, fontSize: 14 }}
      />
      {search.length >= 2 && filteredResults.length === 0 && (results as any[]).length > 0 && (
        <Text style={{ color: '#6c8998', fontSize: 12, paddingVertical: 8, textAlign: 'center' }}>
          All matching users are already members
        </Text>
      )}
      {filteredResults.map((u: any) => (
        <TouchableOpacity key={u.id}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}
          disabled={adding}
          onPress={async () => {
            setAdding(true);
            try {
              await api.post(`/group-chat/conversations/${convId}/members`, { userId: u.id });
              setSearch('');
              onAdded();
              showMessage({ message: `${u.firstName} added`, type: 'success', duration: 1500 });
            } catch (e: any) {
              showMessage({ message: e?.response?.data?.message ?? 'Failed to add member', type: 'danger' });
            } finally { setAdding(false); }
          }}>
          <View style={[s.memberAv, { backgroundColor: TG_BLUE }]}>
            <Text style={s.memberAvText}>{`${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase()}</Text>
          </View>
          <Text style={s.memberName}>{u.firstName} {u.lastName}</Text>
          <Ionicons name="person-add-outline" size={18} color={TG_BLUE} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0e1621' },

  // Header
  header:           { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: TG_PANEL },
  headerAv:         { marginRight: 2 },
  avCircle:         { width: 38, height: 38, borderRadius: 19, backgroundColor: TG_BLUE, alignItems: 'center', justifyContent: 'center' },
  avText:           { fontSize: 13, fontWeight: '700', color: '#fff' },
  headerCenter:     { flex: 1 },
  headerName:       { fontSize: 15, fontWeight: '700', color: '#fff' },
  privacyTag:       { fontSize: 13 },
  headerSub:        { fontSize: 11, color: TG_BLUE, marginTop: 1 },
  headerBtn:        { padding: 6 },

  // Pin banner
  pinBanner:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(42,171,238,0.1)', borderBottomWidth: 1, borderBottomColor: '#0e1621' },
  pinLabel:         { fontSize: 10, fontWeight: '700', color: TG_BLUE },
  pinBody:          { fontSize: 12, color: '#aab8c2' },

  // Messages
  msgList:          { padding: 8, gap: 1, paddingBottom: 12 },
  msgRow:           { flexDirection: 'row', marginVertical: 1, alignItems: 'flex-end', gap: 4 },
  msgRowMe:         { justifyContent: 'flex-end' },
  avatarCol:        { width: 34, alignItems: 'center', alignSelf: 'flex-end', paddingBottom: 2 },
  bubbleCol:        { maxWidth: '72%' },
  bubbleColMe:      { alignItems: 'flex-end' },
  senderName:       { fontSize: 11, fontWeight: '700', color: TG_BLUE, marginBottom: 2, marginLeft: 2 },
  replyBox:         { flexDirection: 'row', borderRadius: 8, padding: 6, marginBottom: 2, gap: 6, backgroundColor: 'rgba(255,255,255,0.05)' },
  replyBoxMe:       { backgroundColor: 'rgba(255,255,255,0.08)' },
  replyBar:         { width: 3, borderRadius: 2 },
  replyName:        { fontSize: 10, fontWeight: '700' },
  replyBody:        { fontSize: 11, color: '#aab8c2' },
  bubble:           { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMe:         { backgroundColor: TG_OUT, borderBottomRightRadius: 4 },
  bubbleThem:       { backgroundColor: TG_IN, borderBottomLeftRadius: 4 },
  bubbleText:       { fontSize: 15, color: '#e8e8e8', lineHeight: 21 },
  metaRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 2 },
  timeText:         { fontSize: 10, color: '#6c8998' },
  attachImg:        { width: 200, height: 150, borderRadius: 8 },
  fileRow:          { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fileText:         { fontSize: 13, maxWidth: 160, color: '#ccc' },
  reactRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 },
  reactPill:        { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  reactPillMine:    { backgroundColor: 'rgba(42,171,238,0.2)' },
  reactEmoji:       { fontSize: 13 },
  reactCount:       { fontSize: 10, fontWeight: '700', color: '#aab8c2' },

  // Date sep
  dateSep:          { alignItems: 'center', marginVertical: 8 },
  dateText:         { fontSize: 11, color: '#6c8998', backgroundColor: 'rgba(17,27,38,0.8)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },

  // Typing
  typingRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 4 },
  typingDots:       { flexDirection: 'row', gap: 3 },
  typingDot:        { width: 5, height: 5, borderRadius: 3, backgroundColor: TG_BLUE },
  typingText:       { fontSize: 11, color: TG_BLUE, fontStyle: 'italic' },

  // Reply preview
  replyPreview:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: TG_PANEL, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#0e1621' },
  replyPreviewBar:  { width: 3, height: 36, borderRadius: 2, backgroundColor: TG_BLUE },
  replyPreviewName: { fontSize: 11, fontWeight: '700' },
  replyPreviewBody: { fontSize: 12, color: '#aab8c2' },

  // Input bar
  inputBar:         { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8, backgroundColor: TG_PANEL },
  inputIcon:        { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  input:            { flex: 1, backgroundColor: '#17212b', borderRadius: 22, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 10 : 8, fontSize: 15, color: '#e8e8e8', maxHeight: 100 },
  sendBtn:          { width: 42, height: 42, borderRadius: 21, backgroundColor: TG_BLUE, justifyContent: 'center', alignItems: 'center' },
  sendBtnOff:       { backgroundColor: '#1a4a6e' },

  // Empty
  emptyWrap:        { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText:        { color: '#6c8998', fontSize: 14 },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Action sheet
  overlay:          { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet:            { backgroundColor: TG_PANEL, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  sheetTitle:       { fontSize: 13, fontWeight: '600', color: '#aab8c2', textAlign: 'center', marginBottom: 12 },
  emojiRow:         { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 4 },
  emojiBtn:         { padding: 8 },
  emojiText:        { fontSize: 26 },
  sheetDivider:     { height: 1, backgroundColor: '#17212b', marginVertical: 8 },
  sheetRow:         { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#17212b' },
  sheetRowText:     { fontSize: 15, color: '#e8e8e8', fontWeight: '500' },

  // Members modal
  membersModal:     { flex: 1, backgroundColor: TG_DARK },
  membersHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#0e1621' },
  membersTitle:     { fontSize: 16, fontWeight: '700', color: '#fff', flex: 1 },
  memberRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#0e1621' },
  memberAv:         { width: 40, height: 40, borderRadius: 20, backgroundColor: TG_BLUE, alignItems: 'center', justifyContent: 'center' },
  memberAvText:     { fontSize: 14, fontWeight: '700', color: '#fff' },
  memberName:       { fontSize: 15, fontWeight: '600', color: '#fff' },
  memberRole:       { fontSize: 11, color: '#6c8998', textTransform: 'capitalize' },
  adminBadge:       { backgroundColor: 'rgba(42,171,238,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  adminBadgeText:   { fontSize: 10, fontWeight: '700', color: TG_BLUE },
  kickBtn:          { padding: 6 },
});
