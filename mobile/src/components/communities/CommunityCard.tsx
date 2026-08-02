import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '@/lib/api';
import { getBaseURL } from '@/lib/api';

interface Community {
  id: string; slug: string; name: string; description: string | null
  avatarUrl: string | null; memberCount: number; category: string | null
  isVerified: boolean; myRole?: string | null
  privacy: 'PUBLIC' | 'PRIVATE' | 'INVITE_ONLY'
}

const BASE = getBaseURL().replace('/api/v1', '');

export default function CommunityCard({ community }: { community: Community }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const joinMutation = useMutation({
    mutationFn: () => community.myRole
      ? api.post(`/communities/${community.id}/leave`)
      : api.post(`/communities/${community.id}/join`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['explore-feed'] }),
  });

  const avatarSrc = community.avatarUrl
    ? (community.avatarUrl.startsWith('http') ? community.avatarUrl : BASE + community.avatarUrl)
    : null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push({ pathname: '/community/[slug]', params: { slug: community.slug } } as any)}
      activeOpacity={0.7}
    >
      <View style={[styles.avatar, { backgroundColor: '#ede9fe' }]}>
        {avatarSrc
          ? <Image source={{ uri: avatarSrc }} style={styles.avatarImg} />
          : <Text allowFontScaling={false} style={{ fontSize: 18, fontWeight: '700', color: '#4f46e5' }}>{community.name.slice(0, 2).toUpperCase()}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text allowFontScaling={false} style={styles.name} numberOfLines={1}>{community.name}</Text>
          {community.isVerified && <Ionicons name="checkmark-circle" size={14} color="#4f46e5" />}
        </View>
        <Text allowFontScaling={false} style={styles.meta}>
          {community.memberCount.toLocaleString()} members
          {community.category ? ` · ${community.category}` : ''}
        </Text>
        {community.description && <Text allowFontScaling={false} style={styles.desc} numberOfLines={1}>{community.description}</Text>}
      </View>
      {community.myRole !== 'OWNER' && community.privacy !== 'INVITE_ONLY' && (
        <TouchableOpacity
          style={[styles.joinBtn, community.myRole && styles.joinedBtn]}
          onPress={() => joinMutation.mutate()}
          disabled={joinMutation.isPending}
        >
          <Text allowFontScaling={false} style={[styles.joinText, community.myRole && { color: '#6b7280' }]}>
            {community.myRole ? 'Joined' : '+ Join'}
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  avatar:    { width: 44, height: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarImg: { width: 44, height: 44, borderRadius: 10 },
  name:      { fontSize: 14, fontWeight: '700', color: '#111827', flex: 1 },
  meta:      { fontSize: 12, color: '#9ca3af' },
  desc:      { fontSize: 12, color: '#6b7280', marginTop: 2 },
  joinBtn:   { backgroundColor: '#4f46e5', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  joinedBtn: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' },
  joinText:  { fontSize: 12, fontWeight: '700', color: '#fff' },
});
