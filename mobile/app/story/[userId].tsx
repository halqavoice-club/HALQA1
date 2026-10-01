/**
 * HALQA Mobile — Story Viewer Screen
 * Full-screen story viewer with progress bars, tap-to-advance, swipe-to-close
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, Image, StyleSheet, TouchableOpacity,
  ActivityIndicator, Dimensions, GestureResponderEvent,
  Animated
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const STORY_DURATION = 5000; // 5 seconds per story

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Story {
  id: string;
  mediaUrl?: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'TEXT';
  textContent?: string;
  backgroundColor?: string;
  duration: number;
  viewsCount: number;
  createdAt: string;
}

interface UserStories {
  user: { id: string; name: string; avatar?: string };
  stories: Story[];
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function ProgressBar({ active, completed, duration }: { active: boolean; completed: boolean; duration: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration,
        useNativeDriver: false,
      }).start();
    } else if (completed) {
      progress.setValue(1);
    } else {
      progress.setValue(0);
    }
  }, [active, completed, duration]);

  return (
    <View style={progressStyles.container}>
      <Animated.View
        style={[
          progressStyles.fill,
          { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
        ]}
      />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  container: { flex: 1, height: 2, backgroundColor: 'rgba(255,255,255,0.35)', borderRadius: 2, overflow: 'hidden', marginHorizontal: 2 },
  fill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },
});

// ─── Main Component ────────────────────────────────────────────────────────────
export default function StoryViewerScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading } = useQuery<UserStories>({
    queryKey: ['stories-viewer', userId],
    queryFn: async () => {
      const res = await api.get(`/stories/user/${userId}`);
      return res.data.data;
    },
    enabled: !!userId,
  });

  const stories = data?.stories ?? [];
  const currentStory = stories[currentIndex];
  const duration = (currentStory?.duration ?? 5) * 1000;

  // Auto-advance
  useEffect(() => {
    if (!currentStory) return;
    timerRef.current = setTimeout(() => {
      if (currentIndex < stories.length - 1) {
        setCurrentIndex(i => i + 1);
      } else {
        router.back();
      }
    }, duration);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [currentIndex, currentStory, duration, stories.length, router]);

  // Mark as viewed
  useEffect(() => {
    if (currentStory) {
      api.post(`/stories/${currentStory.id}/view`).catch(() => {});
    }
  }, [currentStory]);

  const goNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (currentIndex < stories.length - 1) setCurrentIndex(i => i + 1);
    else router.back();
  }, [currentIndex, stories.length, router]);

  const goPrev = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (currentIndex > 0) setCurrentIndex(i => i - 1);
  }, [currentIndex]);

  const handleTap = useCallback((e: GestureResponderEvent) => {
    const x = e.nativeEvent.locationX;
    if (x < SCREEN_W / 3) goPrev();
    else goNext();
  }, [goNext, goPrev]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!data || stories.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <Text style={styles.noStoryText}>No stories available</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const bgColor = currentStory?.backgroundColor ?? '#1a1a2e';

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <StatusBar style="light" />
      <Stack.Screen options={{ headerShown: false }} />

      {/* Background media */}
      {currentStory?.mediaType === 'IMAGE' && currentStory.mediaUrl ? (
        <Image
          source={{ uri: currentStory.mediaUrl }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />
      ) : null}

      {/* Gradient overlay */}
      <View style={styles.overlay} />

      {/* Tap areas */}
      <TouchableOpacity
        style={StyleSheet.absoluteFillObject}
        activeOpacity={1}
        onPress={handleTap}
      />

      {/* Progress bars */}
      <View style={styles.progressRow}>
        {stories.map((s, i) => (
          <ProgressBar
            key={s.id}
            active={i === currentIndex}
            completed={i < currentIndex}
            duration={duration}
          />
        ))}
      </View>

      {/* Header */}
      <View style={styles.header}>
        <Image
          source={{ uri: avatarUrl(data.user.avatar, data.user.name) }}
          style={styles.userAvatar}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.userName}>{data.user.name}</Text>
          <Text style={styles.storyCount}>{currentIndex + 1} / {stories.length}</Text>
        </View>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Text story content */}
      {currentStory?.mediaType === 'TEXT' && currentStory.textContent ? (
        <View style={styles.textStoryContent}>
          <Text style={styles.textStoryText}>{currentStory.textContent}</Text>
        </View>
      ) : null}

      {/* Footer: views */}
      <View style={styles.footer}>
        <Ionicons name="eye-outline" size={16} color="rgba(255,255,255,0.7)" />
        <Text style={styles.viewsText}>{currentStory?.viewsCount ?? 0} views</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, backgroundColor: '#0f0f23', alignItems: 'center', justifyContent: 'center', gap: 16 },
  noStoryText: { color: '#9ca3af', fontSize: 16 },
  backBtn: { backgroundColor: '#4f46e5', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  backBtnText: { color: '#fff', fontWeight: '600' },
  overlay: { ...StyleSheet.absoluteFillObject as any, backgroundColor: 'rgba(0,0,0,0.25)' },
  progressRow: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 52, gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, gap: 10 },
  userAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: '#fff', backgroundColor: '#374151' },
  userName: { color: '#fff', fontWeight: '700', fontSize: 15 },
  storyCount: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  textStoryContent: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  textStoryText: { color: '#fff', fontSize: 28, fontWeight: '700', textAlign: 'center', lineHeight: 40, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 },
  footer: { position: 'absolute', bottom: 32, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  viewsText: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
});

