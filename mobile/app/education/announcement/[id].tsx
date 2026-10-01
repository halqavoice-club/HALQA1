/**
 * HALQA Mobile — Announcement Detail Screen
 * Route: /education/announcement/[id]
 *
 * Full announcement view: title, content, pinned indicator, author, date.
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import api from '@/lib/api';

interface Announcement {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  publishAt: string;
  createdAt: string;
  authorId: string;
  author?: { id: string; firstName: string; lastName: string };
  school?: { id: string; name: string };
  class?: { id: string; name: string } | null;
}

export default function AnnouncementDetailScreen() {
  const { id }   = useLocalSearchParams<{ id: string }>();
  const router   = useRouter();

  const { data: announcement, isLoading, isError } = useQuery<Announcement>({
    queryKey: ['announcement', id],
    queryFn: () => api.get(`/announcements/${id}`).then(r => r.data.data),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <SafeAreaView style={[s.container, s.center]}>
        <Stack.Screen options={{ title: 'Announcement' }} />
        <ActivityIndicator color="#4f46e5" size="large" />
      </SafeAreaView>
    );
  }

  if (isError || !announcement) {
    return (
      <SafeAreaView style={[s.container, s.center]}>
        <Stack.Screen options={{ title: 'Announcement' }} />
        <Ionicons name="alert-circle-outline" size={48} color="#d1d5db" />
        <Text style={s.errorText}>Announcement not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={s.backLink}>
          <Text style={s.backLinkText}>← Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const publishDate = new Date(announcement.publishAt ?? announcement.createdAt);
  const authorName  = announcement.author
    ? `${announcement.author.firstName} ${announcement.author.lastName}`.trim()
    : 'Admin';

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Announcement', headerBackTitle: 'Back' }} />
      <ScrollView contentContainerStyle={s.scroll}>

        {/* Pinned badge */}
        {announcement.isPinned && (
          <View style={s.pinnedBadge}>
            <Ionicons name="pin" size={12} color="#6366f1" />
            <Text style={s.pinnedText}>Pinned Announcement</Text>
          </View>
        )}

        {/* Title */}
        <Text style={s.title}>{announcement.title}</Text>

        {/* Meta row */}
        <View style={s.metaRow}>
          <View style={s.metaItem}>
            <Ionicons name="person-outline" size={14} color="#9ca3af" />
            <Text style={s.metaText}>{authorName}</Text>
          </View>
          <View style={s.metaDot} />
          <View style={s.metaItem}>
            <Ionicons name="calendar-outline" size={14} color="#9ca3af" />
            <Text style={s.metaText}>{format(publishDate, 'MMMM d, yyyy')}</Text>
          </View>
          {announcement.class && (
            <>
              <View style={s.metaDot} />
              <View style={s.metaItem}>
                <Ionicons name="school-outline" size={14} color="#9ca3af" />
                <Text style={s.metaText}>{announcement.class.name}</Text>
              </View>
            </>
          )}
        </View>

        {/* Divider */}
        <View style={s.divider} />

        {/* Content */}
        <Text style={s.content}>{announcement.content}</Text>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#f9fafb' },
  center:      { justifyContent: 'center', alignItems: 'center', gap: 12 },
  scroll:      { padding: 20 },
  pinnedBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#eef2ff', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start', marginBottom: 12 },
  pinnedText:  { fontSize: 12, fontWeight: '700', color: '#6366f1' },
  title:       { fontSize: 22, fontWeight: '900', color: '#111827', lineHeight: 28, marginBottom: 12 },
  metaRow:     { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 16 },
  metaItem:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText:    { fontSize: 13, color: '#6b7280' },
  metaDot:     { width: 4, height: 4, borderRadius: 2, backgroundColor: '#d1d5db' },
  divider:     { height: 1, backgroundColor: '#e5e7eb', marginBottom: 20 },
  content:     { fontSize: 16, color: '#374151', lineHeight: 26 },
  errorText:   { fontSize: 16, color: '#6b7280', fontWeight: '500' },
  backLink:    { marginTop: 12 },
  backLinkText:{ color: '#4f46e5', fontSize: 15, fontWeight: '600' },
});

