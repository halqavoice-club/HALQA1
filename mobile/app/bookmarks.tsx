/**
 * HALQA Mobile — Bookmarked Posts
 */
import React from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, ActivityIndicator, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import PostCard from '@/components/feed/PostCard';

export default function BookmarksScreen() {
  const router = useRouter();
  const { user } = useAuthStore();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['bookmarks', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      // Must pass the real userId — "me" makes isOwner=false in backend
      const res = await api.get(`/posts/user/${user.id}`, {
        params: { tab: 'bookmarks', limit: 30 }
      });
      const raw = res.data.data;
      return Array.isArray(raw) ? raw : raw?.items ?? [];
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });

  return (
    <>
      <Stack.Screen options={{ title: 'Saved Posts', headerShown: true, headerTintColor: '#4f46e5' }} />
      <SafeAreaView style={styles.container}>
        {isLoading ? (
          <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={data || []}
            keyExtractor={(item: any) => item.id}
            renderItem={({ item }: any) => (
              <PostCard post={item} onNavigateToDetail={() => router.push({ pathname: '/post/[id]', params: { id: item.id } } as any)} />
            )}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="bookmark-outline" size={48} color="#d1d5db" />
                <Text style={styles.emptyText}>No saved posts yet</Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  list:      { paddingBottom: 40 },
  empty:     { alignItems: 'center', padding: 60 },
  emptyText: { fontSize: 15, color: '#94a3b8', marginTop: 12 },
});
