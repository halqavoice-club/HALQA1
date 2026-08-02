/**
 * HALQA Mobile — Blocked Users Screen
 * Matches the web settings/blocked page:
 * Lists all blocked users with unblock capability.
 */
import React from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, Image, Alert
} from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';

type BlockedUser = {
  id: string; firstName: string; lastName: string;
  avatarUrl?: string | null; role: string; blockedAt: string;
};

export default function BlockedUsersScreen() {
  const qc = useQueryClient();

  const { data: blocked = [], isLoading, refetch, isRefetching } = useQuery<BlockedUser[]>({
    queryKey: ['blocked-users'],
    queryFn:  () => api.get('/social/blocked').then(r => r.data.data ?? []),
    staleTime: 60 * 1000,
  });

  const unblockMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/social/block/${userId}`),
    onSuccess:  (_, userId) => {
      showMessage({ message: 'User unblocked', type: 'success' });
      qc.setQueryData<BlockedUser[]>(['blocked-users'], prev =>
        (prev ?? []).filter(u => u.id !== userId)
      );
    },
    onError: (err: any) => showMessage({ message: err?.response?.data?.message || 'Failed', type: 'danger' }),
  });

  const handleUnblock = (user: BlockedUser) => {
    Alert.alert(
      'Unblock User',
      `Unblock ${user.firstName} ${user.lastName}? They will be able to follow you and send messages.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unblock', onPress: () => unblockMutation.mutate(user.id) }
      ]
    );
  };

  const ROLE_LABELS: Record<string, string> = {
    SUPER_ADMIN: 'Super Admin', SCHOOL_ADMIN: 'School Admin',
    TEACHER: 'Teacher', STUDENT: 'Student',
    GUARDIAN: 'Guardian', REPRESENTATIVE: 'Representative',
  };

  const renderItem = ({ item }: { item: BlockedUser }) => (
    <View style={styles.row}>
      <Image
        source={{ uri: avatarUrl(item.avatarUrl, `${item.firstName} ${item.lastName}`) }}
        style={styles.avatar}
      />
      <View style={styles.info}>
        <Text style={styles.name}>{item.firstName} {item.lastName}</Text>
        <Text style={styles.meta}>
          {ROLE_LABELS[item.role] || item.role} · blocked {formatDistanceToNow(new Date(item.blockedAt), { addSuffix: true })}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.unblockBtn, unblockMutation.isPending && unblockMutation.variables === item.id && { opacity: 0.5 }]}
        onPress={() => handleUnblock(item)}
        disabled={unblockMutation.isPending && unblockMutation.variables === item.id}
      >
        {unblockMutation.isPending && unblockMutation.variables === item.id
          ? <ActivityIndicator size="small" color="#6366f1" />
          : <>
              <Ionicons name="shield-checkmark-outline" size={13} color="#6366f1" />
              <Text style={styles.unblockBtnText}>Unblock</Text>
            </>
        }
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Blocked Users', headerShown: true, headerTintColor: '#4f46e5' }} />
      <SafeAreaView style={styles.container}>
        <View style={styles.headerCard}>
          <Ionicons name="shield-checkmark-outline" size={20} color="#6366f1" />
          <Text style={styles.headerText}>
            Blocked users can't follow you, send friend requests, or message you.
          </Text>
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={blocked}
            keyExtractor={u => u.id}
            renderItem={renderItem}
            refreshing={isRefetching}
            onRefresh={refetch}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="shield-outline" size={48} color="#d1d5db" />
                <Text style={styles.emptyTitle}>No blocked users</Text>
                <Text style={styles.emptyText}>You can block users from their profile page.</Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#f8fafc' },
  headerCard:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#e0e7ff', margin: 12, padding: 14, borderRadius: 12 },
  headerText:     { flex: 1, fontSize: 13, color: '#3730a3', lineHeight: 18 },
  list:           { paddingBottom: 40 },
  row:            { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  avatar:         { width: 48, height: 48, borderRadius: 24, backgroundColor: '#e0e7ff' },
  info:           { flex: 1 },
  name:           { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  meta:           { fontSize: 12, color: '#94a3b8', marginTop: 2, textTransform: 'capitalize' },
  unblockBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#e0e7ff', borderRadius: 20 },
  unblockBtnText: { color: '#6366f1', fontWeight: '700', fontSize: 12 },
  empty:          { alignItems: 'center', padding: 60 },
  emptyTitle:     { fontSize: 16, fontWeight: '700', color: '#374151', marginTop: 12 },
  emptyText:      { fontSize: 13, color: '#94a3b8', marginTop: 6, textAlign: 'center' },
});
