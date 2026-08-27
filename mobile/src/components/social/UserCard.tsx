import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import api from '@/lib/api';
import { getAvatarUrl, getAvatarInitials, avatarColor } from '@/lib/avatar';

interface User {
  id: string; firstName: string; lastName: string
  avatarUrl: string | null; role: string; bio?: string | null
  isFollowing?: boolean
}

interface Props { user: User; onPress?: () => void }

export default function UserCard({ user, onPress }: Props) {
  const queryClient = useQueryClient();
  const avatarSrc   = getAvatarUrl(user.avatarUrl);
  const initials    = getAvatarInitials(user.firstName, user.lastName);
  const bg          = avatarColor(`${user.firstName}${user.lastName}`);

  // Local optimistic state — seeded from server, toggles instantly
  const [isFollowing, setIsFollowing] = useState(user.isFollowing ?? false);

  const followMutation = useMutation({
    mutationFn: () => isFollowing
      ? api.delete(`/social/follow/${user.id}`)
      : api.post(`/social/follow/${user.id}`),
    onMutate: () => setIsFollowing(v => !v),   // instant toggle
    onError:  () => {
      setIsFollowing(v => !v);                  // roll back on failure
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['explore-search'] });
      queryClient.invalidateQueries({ queryKey: ['explore-feed']   });
    },
  });

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.avatar, { backgroundColor: bg }]}>
        {avatarSrc
          ? <Image source={{ uri: avatarSrc }} style={styles.avatarImg} />
          : <Text allowFontScaling={false} style={styles.avatarText}>{initials}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text allowFontScaling={false} style={styles.name}>{user.firstName} {user.lastName}</Text>
        <Text allowFontScaling={false} style={styles.role}>{user.role?.toLowerCase().replace(/_/g, ' ')}</Text>
        {user.bio && <Text allowFontScaling={false} style={styles.bio} numberOfLines={1}>{user.bio}</Text>}
      </View>
      <TouchableOpacity
        style={[styles.followBtn, isFollowing && styles.followingBtn]}
        onPress={() => followMutation.mutate()}
        disabled={followMutation.isPending}
      >
        <Text allowFontScaling={false} style={[styles.followText, isFollowing && { color: '#6b7280' }]}>
          {isFollowing ? 'Following' : 'Follow'}
        </Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  avatar:      { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarImg:   { width: 44, height: 44, borderRadius: 22 },
  avatarText:  { fontSize: 16, fontWeight: '700', color: '#fff' },
  name:        { fontSize: 14, fontWeight: '700', color: '#111827' },
  role:        { fontSize: 12, color: '#9ca3af', textTransform: 'capitalize' },
  bio:         { fontSize: 12, color: '#6b7280', marginTop: 2 },
  followBtn:   { backgroundColor: '#4f46e5', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  followingBtn:{ backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' },
  followText:  { fontSize: 12, fontWeight: '700', color: '#fff' },
});
