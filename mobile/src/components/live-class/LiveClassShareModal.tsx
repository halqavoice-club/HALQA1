/**
 * LiveClassShareModal — Share a Live Class / Live Stream to DM, Group Chat,
 * Community, Feed, or copy link. Works for both SCHOOL and PUBLIC stream types.
 *
 * Mirrors the web LiveClassShareSheet and the mobile Voice Club share pattern.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, FlatList,
  TextInput, ActivityIndicator, Platform, ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import * as Clipboard from 'expo-clipboard';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';

type Tab = 'dm' | 'group' | 'community' | 'feed' | 'copy';

interface Props {
  visible: boolean;
  liveClassId: string;
  title: string;
  streamType: 'SCHOOL' | 'PUBLIC';
  webUrl: string;
  onClose: () => void;
}

export function LiveClassShareModal({ visible, liveClassId, title, streamType, webUrl, onClose }: Props) {
  const [tab, setTab]       = useState<Tab>('dm');
  const [search, setSearch] = useState('');
  const [note, setNote]     = useState('');
  const [sending, setSending] = useState<string | null>(null);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'dm',        label: 'Friend',    icon: 'person-outline' },
    { id: 'group',     label: 'Group',     icon: 'people-outline' },
    { id: 'community', label: 'Community', icon: 'earth-outline' },
    { id: 'feed',      label: 'Feed',      icon: 'megaphone-outline' },
    { id: 'copy',      label: 'Copy',      icon: 'copy-outline' },
  ];

  // ── Friends ──────────────────────────────────────────────────────────────
  const { data: friends = [] } = useQuery({
    queryKey: ['dm-friends-share-lc-mobile'],
    queryFn: () => api.get('/social/friends?limit=100').then(r => r.data.data ?? []),
    staleTime: 30_000,
    enabled: visible,
  });

  // ── Group Chats ───────────────────────────────────────────────────────────
  const { data: groups = [] } = useQuery({
    queryKey: ['group-convs-share-lc-mobile'],
    queryFn: () => api.get('/group-chat/conversations?limit=50').then(r => r.data.data ?? []),
    staleTime: 30_000,
    enabled: visible,
  });

  // ── Communities ───────────────────────────────────────────────────────────
  const { data: communities = [] } = useQuery({
    queryKey: ['my-communities-share-lc-mobile'],
    queryFn: () => api.get('/communities/mine').then(r => r.data.data?.items ?? r.data.data ?? []),
    staleTime: 60_000,
    enabled: visible && tab === 'community',
  });

  const sendDM = useCallback(async (friend: any) => {
    setSending(friend.id);
    try {
      const convRes = await api.get(`/dm/conversations/${friend.id}/with`);
      const convId = convRes.data.data?.id;
      if (!convId) throw new Error('Could not start conversation');
      await api.post(`/dm/conversations/${convId}/messages`, {
        msgType: 'LIVE_CLASS_SHARE', refEntityType: 'LiveClass', refEntityId: liveClassId,
        body: note.trim() || null,
      });
      showMessage({ message: `✅ Sent to ${friend.firstName}`, type: 'success' });
      onClose();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to send', type: 'danger' });
    } finally { setSending(null); }
  }, [liveClassId, note, onClose]);

  const sendGroup = useCallback(async (group: any) => {
    setSending(group.id);
    try {
      await api.post(`/group-chat/conversations/${group.id}/messages`, {
        type: 'LIVE_CLASS_SHARE', refEntityType: 'LiveClass', refEntityId: liveClassId,
        body: note.trim() || null,
      });
      showMessage({ message: `✅ Sent to ${group.name}`, type: 'success' });
      onClose();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to send', type: 'danger' });
    } finally { setSending(null); }
  }, [liveClassId, note, onClose]);

  const postFeed = useCallback(async () => {
    setSending('feed');
    try {
      await api.post('/posts', {
        type: 'LIVE_CLASS_SHARE', refEntityType: 'LiveClass', refEntityId: liveClassId,
        body: note.trim() || null, visibility: 'PUBLIC',
      });
      showMessage({ message: '✅ Posted to your feed', type: 'success' });
      onClose();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to post', type: 'danger' });
    } finally { setSending(null); }
  }, [liveClassId, note, onClose]);

  const postCommunity = useCallback(async (community: any) => {
    setSending(community.id);
    try {
      await api.post('/posts', {
        type: 'LIVE_CLASS_SHARE', refEntityType: 'LiveClass', refEntityId: liveClassId,
        communityId: community.id, body: note.trim() || null, visibility: 'PUBLIC',
      });
      showMessage({ message: `✅ Shared to ${community.name}`, type: 'success' });
      onClose();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to share', type: 'danger' });
    } finally { setSending(null); }
  }, [liveClassId, note, onClose]);

  const copyLink = useCallback(async () => {
    await Clipboard.setStringAsync(webUrl);
    showMessage({ message: '🔗 Link copied!', type: 'success', duration: 1500 });
  }, [webUrl]);

  const filteredFriends     = friends.filter((f: any) =>
    !search || `${f.firstName} ${f.lastName}`.toLowerCase().includes(search.toLowerCase())
  );
  const filteredGroups      = groups.filter((g: any) =>
    !search || (g.name ?? '').toLowerCase().includes(search.toLowerCase())
  );
  const filteredCommunities = communities.filter((c: any) =>
    !search || (c.name ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const streamEmoji = streamType === 'PUBLIC' ? '🌐' : '🎓';
  const shortTitle  = title.length > 40 ? title.slice(0, 40) + '…' : title;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.container}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.headerTitle}>Share</Text>
            <Text style={s.headerSub} numberOfLines={1}>{streamEmoji} {shortTitle}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={24} color="#374151" />
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabRow}>
          {tabs.map(t => (
            <TouchableOpacity
              key={t.id}
              style={[s.tabBtn, tab === t.id && s.tabBtnActive]}
              onPress={() => { setTab(t.id); setSearch(''); }}
            >
              <Ionicons name={t.icon as any} size={14} color={tab === t.id ? '#4f46e5' : '#6b7280'} />
              <Text style={[s.tabBtnText, tab === t.id && s.tabBtnTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Search */}
        {(tab === 'dm' || tab === 'group' || tab === 'community') && (
          <View style={s.searchRow}>
            <Ionicons name="search-outline" size={15} color="#9ca3af" style={{ marginRight: 6 }} />
            <TextInput
              style={s.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={tab === 'dm' ? 'Search friends…' : tab === 'group' ? 'Search groups…' : 'Search communities…'}
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
            />
          </View>
        )}

        {/* Note input (DM / Group / Community / Feed) */}
        {tab !== 'copy' && (
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <TextInput
              style={s.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="Add a note (optional)…"
              placeholderTextColor="#9ca3af"
              multiline
              maxLength={500}
              numberOfLines={2}
            />
          </View>
        )}

        {/* Content */}
        {tab === 'dm' && (
          <FlatList
            data={filteredFriends as any[]}
            keyExtractor={f => f.id}
            contentContainerStyle={{ padding: 12, gap: 8 }}
            ListEmptyComponent={<Text style={s.empty}>No friends found</Text>}
            renderItem={({ item: f }) => (
              <View style={s.row}>
                <View style={s.avatar}>
                  {f.avatarUrl
                    ? <Image source={{ uri: avatarUrl(f.avatarUrl, `${f.firstName} ${f.lastName}`) }} style={s.avatarImg} />
                    : <Text style={s.avatarText}>{f.firstName?.[0]}{f.lastName?.[0]}</Text>}
                </View>
                <Text style={s.rowName} numberOfLines={1}>{f.firstName} {f.lastName}</Text>
                <TouchableOpacity style={[s.sendBtn, sending === f.id && s.sendBtnDisabled]}
                  onPress={() => sendDM(f)} disabled={!!sending}>
                  {sending === f.id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.sendBtnText}>Send</Text>}
                </TouchableOpacity>
              </View>
            )}
          />
        )}

        {tab === 'group' && (
          <FlatList
            data={filteredGroups as any[]}
            keyExtractor={g => g.id}
            contentContainerStyle={{ padding: 12, gap: 8 }}
            ListEmptyComponent={<Text style={s.empty}>No groups found</Text>}
            renderItem={({ item: g }) => (
              <View style={s.row}>
                <View style={[s.avatar, { backgroundColor: '#ede9fe' }]}>
                  {g.avatarUrl
                    ? <Image source={{ uri: avatarUrl(g.avatarUrl, g.name) }} style={s.avatarImg} />
                    : <Text style={s.avatarText}>{g.name?.[0] ?? '?'}</Text>}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.rowName} numberOfLines={1}>{g.name}</Text>
                  {!!g.memberCount && <Text style={s.rowSub}>{g.memberCount} members</Text>}
                </View>
                <TouchableOpacity style={[s.sendBtn, sending === g.id && s.sendBtnDisabled]}
                  onPress={() => sendGroup(g)} disabled={!!sending}>
                  {sending === g.id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.sendBtnText}>Send</Text>}
                </TouchableOpacity>
              </View>
            )}
          />
        )}

        {tab === 'community' && (
          <FlatList
            data={filteredCommunities as any[]}
            keyExtractor={c => c.id}
            contentContainerStyle={{ padding: 12, gap: 8 }}
            ListEmptyComponent={<Text style={s.empty}>{communities.length === 0 ? 'Not in any communities' : 'No communities found'}</Text>}
            renderItem={({ item: c }) => (
              <View style={s.row}>
                <View style={[s.avatar, { backgroundColor: '#faf5ff' }]}>
                  {c.avatarUrl
                    ? <Image source={{ uri: avatarUrl(c.avatarUrl, c.name) }} style={s.avatarImg} />
                    : <Text style={[s.avatarText, { color: '#7c3aed' }]}>{c.name?.[0] ?? '?'}</Text>}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.rowName} numberOfLines={1}>{c.name}</Text>
                  <Text style={s.rowSub}>{c.privacy} · {c._count?.members ?? ''} members</Text>
                </View>
                <TouchableOpacity style={[s.sendBtn, sending === c.id && s.sendBtnDisabled]}
                  onPress={() => postCommunity(c)} disabled={!!sending}>
                  {sending === c.id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.sendBtnText}>Share</Text>}
                </TouchableOpacity>
              </View>
            )}
          />
        )}

        {tab === 'feed' && (
          <View style={{ padding: 16 }}>
            <Text style={s.feedHint}>
              A live stream card will appear in your feed — others can tap to join directly.
            </Text>
            <TouchableOpacity
              style={[s.feedBtn, !!sending && { opacity: 0.6 }]}
              onPress={postFeed}
              disabled={!!sending}
            >
              {sending === 'feed'
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.feedBtnText}>📢 Post to Feed</Text>}
            </TouchableOpacity>
          </View>
        )}

        {tab === 'copy' && (
          <View style={{ padding: 16 }}>
            <View style={s.urlBox}>
              <Text style={s.urlText} selectable numberOfLines={2}>{webUrl}</Text>
            </View>
            <TouchableOpacity style={s.feedBtn} onPress={copyLink}>
              <Text style={s.feedBtnText}>📋 Copy Link</Text>
            </TouchableOpacity>
            <Text style={s.copyHint}>
              Anyone with this link can join the {streamType === 'PUBLIC' ? 'stream' : 'class'}
            </Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#fff' },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  headerTitle:    { fontSize: 18, fontWeight: '800', color: '#111827' },
  headerSub:      { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  tabRow:         { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  tabBtn:         { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  tabBtnActive:   { borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
  tabBtnText:     { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  tabBtnTextActive: { color: '#4f46e5' },
  searchRow:      { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 4, backgroundColor: '#f3f4f6', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: '#e5e7eb' },
  searchInput:    { flex: 1, fontSize: 14, color: '#111827', padding: 0 },
  noteInput:      { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 10, fontSize: 13, color: '#111827', backgroundColor: '#f9fafb', textAlignVertical: 'top', minHeight: 56 },
  row:            { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#f3f4f6' },
  avatar:         { width: 42, height: 42, borderRadius: 21, backgroundColor: '#e0e7ff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarImg:      { width: 42, height: 42 },
  avatarText:     { fontSize: 14, fontWeight: '700', color: '#6366f1' },
  rowName:        { flex: 1, fontSize: 13, fontWeight: '600', color: '#1e293b' },
  rowSub:         { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  sendBtn:        { backgroundColor: '#4f46e5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7, minWidth: 56, alignItems: 'center' },
  sendBtnDisabled:{ backgroundColor: '#e5e7eb' },
  sendBtnText:    { color: '#fff', fontWeight: '700', fontSize: 12 },
  feedHint:       { fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 18 },
  feedBtn:        { backgroundColor: '#4f46e5', borderRadius: 14, padding: 15, alignItems: 'center' },
  feedBtnText:    { color: '#fff', fontWeight: '800', fontSize: 15 },
  urlBox:         { backgroundColor: '#f8fafc', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#e5e7eb', marginBottom: 12 },
  urlText:        { fontSize: 12, color: '#64748b' },
  copyHint:       { textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 10 },
  empty:          { textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 32 },
});
