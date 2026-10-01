/**
 * MobileShareSheet — unified share/forward bottom sheet for React Native.
 *
 * Destinations:
 *   DM         → forward to a 1:1 DM conversation
 *   Group      → forward to a group chat
 *   Feed       → create a public post with the media
 *   Community  → post to a community the user belongs to
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, FlatList,
  TextInput, ActivityIndicator, Pressable, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface MobileSharePayload {
  body?: string | null;
  msgType?: string;
  type?: string;
  mediaUrl?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  fileName?: string | null;
  duration?: number | null;
}

interface Props {
  visible: boolean;
  payload: MobileSharePayload | null;
  onClose: () => void;
}

type Tab = 'dm' | 'group' | 'feed' | 'community';

const TAB_ICONS: Record<Tab, string> = {
  dm:        'chatbubble-outline',
  group:     'people-outline',
  feed:      'globe-outline',
  community: 'grid-outline',
};
const TAB_LABELS: Record<Tab, string> = {
  dm: 'DM', group: 'Groups', feed: 'Feed', community: 'Community',
};

// ─── Component ─────────────────────────────────────────────────────────────────
export function MobileShareSheet({ visible, payload, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('dm');
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [commSearch, setCommSearch] = useState('');
  const [communities, setCommunities] = useState<any[]>([]);
  const [commLoading, setCommLoading] = useState(false);

  // Reset when opened
  useEffect(() => {
    if (visible) { setTab('dm'); setSearch(''); setSent(null); setCaption(''); setCommSearch(''); setCommunities([]); }
  }, [visible]);

  // ── Load lists ────────────────────────────────────────────────────────────────
  const { data: dmConvs = [] } = useQuery({
    queryKey: ['dm-conversations'],
    queryFn: () => api.get('/dm/conversations').then(r => r.data.data ?? []),
    enabled: visible,
    staleTime: 60000,
  });

  const { data: groupConvs = [] } = useQuery({
    queryKey: ['group-conversations'],
    queryFn: () => api.get('/group-chat/conversations').then(r => r.data.data ?? []),
    enabled: visible,
    staleTime: 60000,
  });

  // ── Build media fields ────────────────────────────────────────────────────────
  const mediaFields = useCallback(() => {
    if (!payload) return {};
    const t = payload.msgType ?? payload.type ?? 'TEXT';
    if (t === 'TEXT' || !payload.mediaUrl) return {};
    return {
      mediaUrl: payload.mediaUrl,
      mimeType: payload.mimeType,
      fileSize: payload.fileSize,
      fileName: payload.fileName,
      duration: payload.duration,
    };
  }, [payload]);

  // ── Forward to DM ─────────────────────────────────────────────────────────────
  const forwardDm = useCallback(async (convId: string) => {
    if (!payload || sending) return;
    setSending(true);
    try {
      const msgType = payload.msgType ?? payload.type ?? 'TEXT';
      const p: any = { msgType };
      if (payload.body?.trim()) p.body = payload.body.trim();
      const m = mediaFields();
      if ((m as any).mediaUrl) Object.assign(p, m);
      if (!p.body && !p.mediaUrl) throw new Error('Nothing to forward');
      await api.post(`/dm/conversations/${convId}/messages`, p);
      setSent(convId);
      showMessage({ message: 'Forwarded to DM', type: 'success', duration: 1500 });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    } finally { setSending(false); }
  }, [payload, sending, mediaFields]);

  // ── Forward to Group ──────────────────────────────────────────────────────────
  const forwardGroup = useCallback(async (convId: string) => {
    if (!payload || sending) return;
    setSending(true);
    try {
      const type = payload.type ?? payload.msgType ?? 'TEXT';
      const p: any = { type };
      if (payload.body?.trim()) p.body = payload.body.trim();
      const m = mediaFields();
      if ((m as any).mediaUrl) Object.assign(p, m);
      if (!p.body && !p.mediaUrl) throw new Error('Nothing to forward');
      await api.post(`/group-chat/conversations/${convId}/messages`, p);
      setSent(convId);
      showMessage({ message: 'Forwarded to group', type: 'success', duration: 1500 });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    } finally { setSending(false); }
  }, [payload, sending, mediaFields]);

  // ── Share to Feed ─────────────────────────────────────────────────────────────
  const shareToFeed = useCallback(async () => {
    if (!payload || sending) return;
    setSending(true);
    try {
      const m = mediaFields() as any;
      const mediaArr = m.mediaUrl ? [{
        url: m.mediaUrl,
        type: (payload.msgType ?? payload.type ?? 'TEXT').toUpperCase() === 'VIDEO' ? 'VIDEO' : 'IMAGE',
        mimeType: m.mimeType,
        size: m.fileSize,
        duration: m.duration,
      }] : [];
      const body = caption.trim() || payload.body?.trim() || '';
      if (!body && !mediaArr.length) throw new Error('Nothing to share');
      await api.post('/posts', {
        body: body || null,
        type: mediaArr.length ? (mediaArr[0].type === 'VIDEO' ? 'VIDEO' : 'IMAGE') : 'TEXT',
        visibility: 'PUBLIC',
        media: mediaArr,
      });
      setSent('feed');
      showMessage({ message: 'Posted to Feed', type: 'success', duration: 1500 });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    } finally { setSending(false); }
  }, [payload, sending, caption, mediaFields]);

  // ── Share to Community ────────────────────────────────────────────────────────
  const loadCommunities = useCallback(async (q: string) => {
    if (!q.trim()) { setCommunities([]); return; }
    setCommLoading(true);
    try {
      const r = await api.get('/communities', { params: { search: q, limit: 8, memberOnly: true } });
      setCommunities(r.data.data ?? []);
    } catch { setCommunities([]); }
    finally { setCommLoading(false); }
  }, []);

  const shareToCommunity = useCallback(async (communityId: string) => {
    if (!payload || sending) return;
    setSending(true);
    try {
      const m = mediaFields() as any;
      const mediaArr = m.mediaUrl ? [{
        url: m.mediaUrl,
        type: (payload.msgType ?? payload.type ?? 'TEXT').toUpperCase() === 'VIDEO' ? 'VIDEO' : 'IMAGE',
        mimeType: m.mimeType,
        size: m.fileSize,
        duration: m.duration,
      }] : [];
      const body = caption.trim() || payload.body?.trim() || '';
      if (!body && !mediaArr.length) throw new Error('Nothing to share');
      await api.post('/posts', {
        body: body || null,
        type: mediaArr.length ? (mediaArr[0].type === 'VIDEO' ? 'VIDEO' : 'IMAGE') : 'TEXT',
        visibility: 'COMMUNITY',
        communityId,
        media: mediaArr,
      });
      setSent(communityId);
      showMessage({ message: 'Shared to Community', type: 'success', duration: 1500 });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    } finally { setSending(false); }
  }, [payload, sending, caption, mediaFields]);

  // ── Filter ────────────────────────────────────────────────────────────────────
  const filteredDms = (dmConvs as any[]).filter(c =>
    `${c.other?.firstName} ${c.other?.lastName}`.toLowerCase().includes(search.toLowerCase())
  );
  const filteredGroups = (groupConvs as any[]).filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase())
  );

  const msgType = payload?.msgType ?? payload?.type ?? 'TEXT';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.container} edges={['top']}>

        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>Share to…</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color="#6b7280" />
          </TouchableOpacity>
        </View>

        {/* Preview */}
        {payload && (
          <View style={s.preview}>
            <Text style={s.previewLabel}>SHARING</Text>
            <Text style={s.previewText} numberOfLines={1}>
              {msgType !== 'TEXT' && payload.mediaUrl
                ? `📎 ${msgType}${payload.fileName ? ` — ${payload.fileName}` : ''}`
                : payload.body?.slice(0, 80) || '(empty)'}
            </Text>
          </View>
        )}

        {/* Tabs */}
        <View style={s.tabs}>
          {(['dm', 'group', 'feed', 'community'] as Tab[]).map(t => (
            <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]}
              onPress={() => { setTab(t); setSearch(''); setSent(null); }}>
              <Ionicons name={TAB_ICONS[t] as any} size={18}
                color={tab === t ? '#0d9488' : '#9ca3af'} />
              <Text style={[s.tabLabel, tab === t && s.tabLabelActive]}>{TAB_LABELS[t]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── DM tab ── */}
        {tab === 'dm' && (
          <>
            <View style={s.searchWrap}>
              <Ionicons name="search-outline" size={15} color="#9ca3af" />
              <TextInput value={search} onChangeText={setSearch}
                placeholder="Search conversations…" placeholderTextColor="#9ca3af"
                style={s.searchInput} />
            </View>
            <FlatList
              data={filteredDms}
              keyExtractor={(c: any) => c.id}
              renderItem={({ item }: { item: any }) => (
                <TouchableOpacity style={s.row} onPress={() => forwardDm(item.id)} disabled={sending}>
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>
                      {`${item.other?.firstName?.[0] ?? ''}${item.other?.lastName?.[0] ?? ''}`.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={s.rowName} numberOfLines={1}>
                    {item.other?.firstName} {item.other?.lastName}
                  </Text>
                  {sent === item.id
                    ? <Ionicons name="checkmark-circle" size={20} color="#10b981" />
                    : sending ? <ActivityIndicator size="small" color="#d1d5db" /> : null}
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={s.empty}>No conversations</Text>}
            />
          </>
        )}

        {/* ── Group tab ── */}
        {tab === 'group' && (
          <>
            <View style={s.searchWrap}>
              <Ionicons name="search-outline" size={15} color="#9ca3af" />
              <TextInput value={search} onChangeText={setSearch}
                placeholder="Search groups…" placeholderTextColor="#9ca3af"
                style={s.searchInput} />
            </View>
            <FlatList
              data={filteredGroups}
              keyExtractor={(c: any) => c.id}
              renderItem={({ item }: { item: any }) => (
                <TouchableOpacity style={s.row} onPress={() => forwardGroup(item.id)} disabled={sending}>
                  <View style={[s.avatar, { backgroundColor: '#e0e7ff' }]}>
                    <Text style={[s.avatarText, { color: '#4f46e5' }]}>
                      {(item.name || '?').slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.rowSub}>{item.memberCount} members</Text>
                  </View>
                  {sent === item.id ? <Ionicons name="checkmark-circle" size={20} color="#10b981" /> : null}
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={s.empty}>No groups</Text>}
            />
          </>
        )}

        {/* ── Feed tab ── */}
        {tab === 'feed' && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.feedContent}>
            <Text style={s.feedHint}>Share as a public post. Add an optional caption:</Text>
            <TextInput
              value={caption} onChangeText={setCaption}
              placeholder="Add a caption… (optional)"
              placeholderTextColor="#9ca3af"
              style={s.captionInput}
              multiline maxLength={2000}
            />
            <TouchableOpacity
              style={[s.shareBtn, (sending || !!sent) && s.shareBtnDone]}
              onPress={shareToFeed}
              disabled={sending || !!sent}
            >
              {sending
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.shareBtnText}>{sent ? '✓ Posted to Feed' : 'Post to Feed'}</Text>}
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ── Community tab ── */}
        {tab === 'community' && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.feedContent} keyboardShouldPersistTaps="handled">
            <TextInput
              value={caption} onChangeText={setCaption}
              placeholder="Add a caption… (optional)"
              placeholderTextColor="#9ca3af"
              style={[s.captionInput, { marginBottom: 10 }]}
              multiline maxLength={2000}
            />
            <View style={s.searchWrap}>
              <Ionicons name="search-outline" size={15} color="#9ca3af" />
              <TextInput
                value={commSearch}
                onChangeText={q => { setCommSearch(q); loadCommunities(q); }}
                placeholder="Search your communities…"
                placeholderTextColor="#9ca3af"
                style={s.searchInput}
              />
              {commLoading && <ActivityIndicator size="small" color="#9ca3af" />}
            </View>
            {communities.map((c: any) => (
              <TouchableOpacity key={c.id} style={s.row} onPress={() => shareToCommunity(c.id)} disabled={sending}>
                <View style={[s.avatar, { backgroundColor: '#f3e8ff' }]}>
                  <Text style={[s.avatarText, { color: '#7c3aed' }]}>
                    {(c.name || '?').slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <Text style={s.rowName} numberOfLines={1}>{c.name}</Text>
                {sent === c.id ? <Ionicons name="checkmark-circle" size={20} color="#10b981" /> : null}
              </TouchableOpacity>
            ))}
            {commSearch.length >= 2 && communities.length === 0 && !commLoading && (
              <Text style={s.empty}>No communities found</Text>
            )}
          </ScrollView>
        )}

      </SafeAreaView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#fff' },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  title:        { fontSize: 17, fontWeight: '700', color: '#111827' },
  preview:      { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#f9fafb', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  previewLabel: { fontSize: 9, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', marginBottom: 2 },
  previewText:  { fontSize: 13, color: '#374151' },
  tabs:         { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  tab:          { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 3 },
  tabActive:    { borderBottomWidth: 2, borderBottomColor: '#0d9488' },
  tabLabel:     { fontSize: 10, fontWeight: '600', color: '#9ca3af' },
  tabLabelActive: { color: '#0d9488' },
  searchWrap:   { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, marginBottom: 4, backgroundColor: '#f9fafb', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 12, paddingVertical: 9 },
  searchInput:  { flex: 1, fontSize: 14, color: '#111827' },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  avatar:       { width: 40, height: 40, borderRadius: 20, backgroundColor: '#d1fae5', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText:   { fontSize: 14, fontWeight: '700', color: '#065f46' },
  rowName:      { flex: 1, fontSize: 14, fontWeight: '600', color: '#111827' },
  rowSub:       { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  empty:        { textAlign: 'center', color: '#9ca3af', fontSize: 14, paddingTop: 40 },
  feedContent:  { padding: 16, gap: 12 },
  feedHint:     { fontSize: 13, color: '#6b7280', marginBottom: 4 },
  captionInput: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#111827', minHeight: 80, textAlignVertical: 'top' },
  shareBtn:     { backgroundColor: '#0d9488', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  shareBtnDone: { backgroundColor: '#10b981' },
  shareBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
