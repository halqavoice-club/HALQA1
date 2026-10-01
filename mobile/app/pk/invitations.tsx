/**
 * Mobile — PK Invitations Screen
 * Route: /pk/invitations
 *
 * Lists all pending PK challenges sent to the current user.
 * Accept navigates to the battle screen. Decline dismisses the challenge.
 * Auto-refreshes every 10s and on new pk:invitation socket events.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, Image, Alert,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { avatarUrl as buildAvatarUrl } from '@/lib/avatar';

interface Invitation {
  id:              string;
  senderId:        string;
  type:            string;
  durationSeconds: number;
  expiresAt:       string;
  status:          string;
  message:         string | null;
  createdAt:       string;
  sender?: {
    id:        string;
    firstName: string;
    lastName:  string;
    avatarUrl: string | null;
  };
}

function CountdownText({ expiresAt }: { expiresAt: string }) {
  const [secs, setSecs] = useState(() => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.floor(ms / 1000));
  });

  useEffect(() => {
    if (secs <= 0) return;
    const t = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [secs > 0]); // eslint-disable-line

  if (secs <= 0) return <Text style={s.expired}>Expired</Text>;
  return (
    <Text style={[s.countdown, secs < 60 && s.countdownUrgent]}>
      {secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`} left
    </Text>
  );
}

export default function PKInvitationsScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [actionMap,   setActionMap]   = useState<Record<string, 'accepting' | 'declining'>>({});

  const fetchInvitations = useCallback(async () => {
    try {
      const res = await api.get('/pk/invitations?status=PENDING');
      const items = Array.isArray(res.data) ? res.data
        : Array.isArray(res.data?.data) ? res.data.data : [];
      setInvitations(items);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchInvitations();
    const interval = setInterval(fetchInvitations, 10_000);
    return () => clearInterval(interval);
  }, [fetchInvitations]);

  // Refresh when new invitation arrives via socket; remove cancelled ones live
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onNew       = () => fetchInvitations();
    const onCancelled = (d: { invitationId: string }) => {
      setInvitations(prev => prev.filter(i => i.id !== d.invitationId));
    };
    socket.on('pk:invitation', onNew);
    socket.on('pk:cancelled',  onCancelled);
    return () => {
      socket.off('pk:invitation', onNew);
      socket.off('pk:cancelled',  onCancelled);
    };
  }, [fetchInvitations]);

  const handleAccept = useCallback(async (inv: Invitation) => {
    setActionMap(m => ({ ...m, [inv.id]: 'accepting' }));
    try {
      const res = await api.post(`/pk/invitations/${inv.id}/accept`);
      const pkMatchId = res.data.data?.match?.id;
      setInvitations(prev => prev.filter(i => i.id !== inv.id));
      if (pkMatchId) router.push(`/pk/${pkMatchId}` as any);
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message || 'Could not accept', type: 'danger' });
      setActionMap(m => { const n = { ...m }; delete n[inv.id]; return n; });
    }
  }, [router]);

  const handleDecline = useCallback(async (inv: Invitation) => {
    Alert.alert('Decline challenge?', `Decline ${inv.sender?.firstName ?? 'this'}'s PK challenge?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive',
        onPress: async () => {
          setActionMap(m => ({ ...m, [inv.id]: 'declining' }));
          try {
            await api.post(`/pk/invitations/${inv.id}/reject`);
            setInvitations(prev => prev.filter(i => i.id !== inv.id));
          } catch {
            setActionMap(m => { const n = { ...m }; delete n[inv.id]; return n; });
          }
        },
      },
    ]);
  }, []);

  const renderItem = ({ item }: { item: Invitation }) => {
    const action  = actionMap[item.id];
    const expired = new Date(item.expiresAt) < new Date();
    const name    = item.sender ? `${item.sender.firstName} ${item.sender.lastName}` : 'Unknown';
    const dur     = `${Math.floor(item.durationSeconds / 60)} min`;

    return (
      <View style={s.card}>
        {/* Sender row */}
        <View style={s.senderRow}>
          <View style={s.avatarWrap}>
            <Image
              source={{ uri: buildAvatarUrl(item.sender?.avatarUrl, name) }}
              style={s.avatar}
            />
            <Text style={s.sword}>⚔️</Text>
          </View>
          <View style={s.senderInfo}>
            <Text style={s.senderName} numberOfLines={1}>{name}</Text>
            <Text style={s.senderMeta}>{dur} · {item.type.replace('_', ' ')}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            {expired
              ? <Text style={s.expired}>Expired</Text>
              : <CountdownText expiresAt={item.expiresAt} />
            }
            <Text style={s.timeAgo}>
              {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
            </Text>
          </View>
        </View>

        {item.message ? (
          <Text style={s.message} numberOfLines={2}>"{item.message}"</Text>
        ) : null}

        {/* Buttons */}
        {!expired ? (
          <View style={s.btnRow}>
            <TouchableOpacity
              style={[s.btn, s.btnDecline]}
              onPress={() => handleDecline(item)}
              disabled={!!action}
              activeOpacity={0.8}
            >
              {action === 'declining'
                ? <ActivityIndicator size="small" color="#94a3b8" />
                : <Text style={s.btnDeclineText}>✕ Decline</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btn, s.btnAccept, !!action && s.btnDisabled]}
              onPress={() => handleAccept(item)}
              disabled={!!action}
              activeOpacity={0.8}
            >
              {action === 'accepting'
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={s.btnAcceptText}>⚔️ Accept</Text>
              }
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={s.expiredLabel}>This challenge has expired</Text>
        )}
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: '⚔️ PK Challenges', headerBackTitle: 'PK' }} />
      <View style={[s.container, { paddingTop: insets.top }]}>
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color="#6366f1" />
          </View>
        ) : invitations.length === 0 ? (
          <View style={s.center}>
            <Text style={s.emptyEmoji}>⚔️</Text>
            <Text style={s.emptyTitle}>No pending challenges</Text>
            <Text style={s.emptySub}>
              When someone challenges you to a PK battle, it will appear here.
            </Text>
            <TouchableOpacity
              style={s.findBtn}
              onPress={() => router.push('/pk' as any)}
              activeOpacity={0.8}
            >
              <Text style={s.findBtnText}>Find Opponent</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={invitations}
            keyExtractor={i => i.id}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}
            showsVerticalScrollIndicator={false}
            onRefresh={fetchInvitations}
            refreshing={loading}
          />
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0f172a' },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  card:         { backgroundColor: '#1e293b', borderRadius: 18, padding: 14, borderWidth: 1, borderColor: 'rgba(99,102,241,0.2)' },
  senderRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatarWrap:   { position: 'relative' },
  avatar:       { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: '#6366f1', backgroundColor: '#1e293b' },
  sword:        { position: 'absolute', bottom: -4, right: -4, fontSize: 16 },
  senderInfo:   { flex: 1, minWidth: 0, gap: 2 },
  senderName:   { color: '#e2e8f0', fontSize: 15, fontWeight: '700' },
  senderMeta:   { color: '#818cf8', fontSize: 12 },
  countdown:    { color: '#f59e0b', fontSize: 11, fontWeight: '700' },
  countdownUrgent: { color: '#ef4444' },
  expired:      { color: '#ef4444', fontSize: 11, fontWeight: '600' },
  timeAgo:      { color: '#475569', fontSize: 10 },
  message:      { color: '#94a3b8', fontSize: 12, fontStyle: 'italic', marginBottom: 10 },
  btnRow:       { flexDirection: 'row', gap: 8 },
  btn:          { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnDecline:   { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  btnDeclineText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  btnAccept:    { backgroundColor: '#4f46e5' },
  btnAcceptText:  { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnDisabled:  { opacity: 0.45 },
  expiredLabel: { color: '#475569', fontSize: 12, textAlign: 'center', marginTop: 4 },
  emptyEmoji:   { fontSize: 56, marginBottom: 8 },
  emptyTitle:   { color: '#e2e8f0', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptySub:     { color: '#64748b', fontSize: 13, textAlign: 'center' },
  findBtn:      { marginTop: 12, backgroundColor: '#4f46e5', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 14 },
  findBtnText:  { color: '#fff', fontWeight: '700', fontSize: 15 },
});
