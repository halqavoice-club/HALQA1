/**
 * HALQA Mobile — Stories Bar
 */
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '@/lib/api';
import { getAvatarUrl, avatarColor, getAvatarInitials } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';

export default function StoriesBar() {
  const router = useRouter();
  const { user } = useAuthStore();

  const { data: groups = [] } = useQuery({
    queryKey: ['stories-feed'],
    queryFn: () => api.get('/stories/feed').then(r => r.data.data),
    staleTime: 30_000,
  });

  const myGroup = (groups as any[]).find(g => g.author.id === user?.id);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {/* Add story */}
      <TouchableOpacity style={styles.item} onPress={() => router.push('/create-story' as any)}>
        <View style={[styles.ring, { borderColor: myGroup?.hasUnseen ? '#4f46e5' : '#e5e7eb' }]}>
          <View style={[styles.avatar, { backgroundColor: '#ede9fe' }]}>
            <Text allowFontScaling={false} style={{ fontSize: 16, fontWeight: '700', color: '#4f46e5' }}>
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </Text>
          </View>
        </View>
        <View style={styles.addBadge}>
          <Ionicons name="add" size={12} color="#fff" />
        </View>
        <Text allowFontScaling={false} style={styles.label}>Your story</Text>
      </TouchableOpacity>

      {/* Other stories */}
      {(groups as any[])
        .filter(g => g.author.id !== user?.id)
        .map((group, idx) => {
          const avatarSrc = getAvatarUrl(group.author.avatarUrl);
          const initials  = getAvatarInitials(group.author.firstName, group.author.lastName);
          const bg        = avatarColor(`${group.author.firstName}${group.author.lastName}`);
          return (
            <TouchableOpacity key={group.author.id} style={styles.item}
              onPress={() => router.push({ pathname: '/story/[userId]', params: { userId: group.author.id } } as any)}>
              <View style={[styles.ring, { borderColor: group.hasUnseen ? '#4f46e5' : '#e5e7eb', borderWidth: group.hasUnseen ? 2 : 1 }]}>
                <View style={[styles.avatar, { backgroundColor: bg }]}>
                  {avatarSrc
                    ? <Image source={{ uri: avatarSrc }} style={styles.avatarImg} />
                    : <Text allowFontScaling={false} style={styles.avatarInitials}>{initials}</Text>}
                </View>
              </View>
              <Text allowFontScaling={false} style={styles.label} numberOfLines={1}>{group.author.firstName}</Text>
            </TouchableOpacity>
          );
        })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  content:   { paddingHorizontal: 12, paddingVertical: 10, gap: 12 },
  item:      { alignItems: 'center', width: 60, position: 'relative' },
  ring:      { width: 58, height: 58, borderRadius: 29, borderWidth: 2, borderColor: '#4f46e5', padding: 2, marginBottom: 4 },
  avatar:    { width: '100%', height: '100%', borderRadius: 26, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%', borderRadius: 26 },
  avatarInitials: { fontSize: 18, fontWeight: '700', color: '#fff' },
  addBadge:  { position: 'absolute', bottom: 20, right: 0, backgroundColor: '#4f46e5', borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff' },
  label:     { fontSize: 10, color: '#6b7280', textAlign: 'center', width: 60 },
});
