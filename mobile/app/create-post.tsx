/**
 * HALQA Mobile — Create Post Screen
 * Supports TEXT, IMAGE, VIDEO posts with media picker,
 * visibility selector, location tag, and character count.
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Platform,
  Image, Alert} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showMessage } from 'react-native-flash-message';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

const BASE_VISIBILITY_OPTIONS = [
  { value: 'PUBLIC',      label: '🌍 Everyone'    },
  { value: 'FOLLOWERS',   label: '👥 Followers'   },
  { value: 'PRIVATE',     label: '🔒 Only me'     },
];

// SCHOOL_ONLY is appended at runtime for users who belong to a school
const SCHOOL_ONLY_OPTION = { value: 'SCHOOL_ONLY', label: '🏫 School only' };

type MediaItem = {
  uri: string;
  type: 'IMAGE' | 'VIDEO' | 'AUDIO';
  mimeType: string;
  name: string;
  size?: number;
};

export default function CreatePostScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  // communityId is passed when navigating from a community detail page
  const { communityId, communityName } = useLocalSearchParams<{
    communityId?: string;
    communityName?: string;
  }>();

  const [body,       setBody]       = useState('');
  const [visibility, setVisibility] = useState('PUBLIC');
  const [showVis,    setShowVis]    = useState(false);
  const [location,   setLocation]   = useState('');
  const [showLoc,    setShowLoc]    = useState(false);
  const [media,      setMedia]      = useState<MediaItem | null>(null);
  const [uploading,  setUploading]  = useState(false);

  // ── Pick image/video from library ──────────────────────────────────────────
  const pickMedia = useCallback(async (source: 'library' | 'camera') => {
    const action = source === 'camera'
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;

    const result = await action({
      mediaTypes: ['images', 'videos'],
      quality: 0.85,
      allowsEditing: false,
      videoMaxDuration: 120,
    });

    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const isVideo = asset.type === 'video';

    // Client-side guard: 50 MB max (matches backend multer limit)
    if (asset.fileSize && asset.fileSize > 50 * 1024 * 1024) {
      showMessage({ message: 'File too large (max 50 MB)', type: 'warning' });
      return;
    }

    setMedia({
      uri: asset.uri,
      type: isVideo ? 'VIDEO' : 'IMAGE',
      mimeType: isVideo ? (asset.mimeType ?? 'video/mp4') : (asset.mimeType ?? 'image/jpeg'),
      name: asset.fileName ?? (isVideo ? 'video.mp4' : 'photo.jpg'),
      size: asset.fileSize,
    });
  }, []);

  // ── Remove selected media ───────────────────────────────────────────────────
  const clearMedia = useCallback(() => setMedia(null), []);

  // ── Submit post ─────────────────────────────────────────────────────────────
  const handlePost = useCallback(async () => {
    if (!body.trim() && !media) {
      showMessage({ message: 'Write something or add media', type: 'warning' });
      return;
    }
    setUploading(true);
    try {
      let mediaPayload: { url: string; type: string; mimeType: string }[] = [];

      if (media) {
        // Step 1: Upload the media file to /upload — get back a URL
        const form = new FormData();
        form.append('file', {
          uri: media.uri,
          type: media.mimeType,
          name: media.name,
        } as any);

        const uploadRes = await api.post('/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120_000, // 2 min for large videos
        });

        const uploadedUrl: string = uploadRes.data?.data?.url;
        if (!uploadedUrl) throw new Error('Upload failed — no URL returned');

        mediaPayload = [{
          url:      uploadedUrl,
          type:     media.type,      // 'IMAGE' | 'VIDEO'
          mimeType: media.mimeType,
        }];
      }

      // Step 2: Create the post with the uploaded media URL(s)
      await api.post('/posts', {
        body:       body.trim() || undefined,
        type:       mediaPayload.length > 0 ? mediaPayload[0].type : 'TEXT',
        visibility,
        media:      mediaPayload,
        ...(location.trim() ? { location: location.trim() } : {}),
        // Include communityId if posting from a community page
        ...(communityId ? { communityId } : {}),
      });

      showMessage({ message: '✅ Posted!', type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      // Also invalidate the community feed if posting in a community
      if (communityId) {
        queryClient.invalidateQueries({ queryKey: ['community-feed'] });
      }
      router.back();
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? 'Failed to post';
      showMessage({ message: msg, type: 'danger' });
    } finally {
      setUploading(false);
    }
  }, [body, media, visibility, location, communityId, queryClient, router]);

  // Build visibility options: include SCHOOL_ONLY only when user has a school
  const VISIBILITY_OPTIONS = user?.schoolId
    ? [...BASE_VISIBILITY_OPTIONS, SCHOOL_ONLY_OPTION]
    : BASE_VISIBILITY_OPTIONS;

  const canPost = (body.trim().length > 0 || !!media) && !uploading;
  const visLabel = VISIBILITY_OPTIONS.find(v => v.value === visibility)?.label ?? '';
  // Screen title changes when posting in a community
  const screenTitle = communityName ? `Post to ${communityName}` : 'New Post';

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.cancelBtn}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.title}>{screenTitle}</Text>
          <TouchableOpacity
            style={[s.postBtn, !canPost && s.postBtnDisabled]}
            onPress={handlePost}
            disabled={!canPost}
          >
            {uploading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.postBtnText}>Post</Text>
            }
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {/* Author row */}
          <View style={s.author}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>
                {(user?.firstName?.charAt(0) ?? '') + (user?.lastName?.charAt(0) ?? '')}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.authorName}>{user?.firstName} {user?.lastName}</Text>
              {/* Visibility picker */}
              <TouchableOpacity style={s.visPicker} onPress={() => setShowVis(v => !v)}>
                <Text style={s.visLabel}>{visLabel}</Text>
                <Ionicons name="chevron-down" size={12} color="#4f46e5" />
              </TouchableOpacity>
              {showVis && (
                <View style={s.visDropdown}>
                  {VISIBILITY_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[s.visOption, visibility === opt.value && s.visOptionActive]}
                      onPress={() => { setVisibility(opt.value); setShowVis(false); }}
                    >
                      <Text style={[s.visOptionText, visibility === opt.value && { color: '#4f46e5', fontWeight: '700' }]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>

          {/* Text input */}
          <TextInput
            style={s.input}
            value={body}
            onChangeText={setBody}
            placeholder="What's on your mind? Use #hashtags and @mentions"
            placeholderTextColor="#9ca3af"
            multiline
            autoFocus
            maxLength={5000}
          />

          {/* Media preview */}
          {media && (
            <View style={s.mediaPreview}>
              {media.type === 'IMAGE' && (
                <Image source={{ uri: media.uri }} style={s.mediaImg} resizeMode="cover" />
              )}
              {media.type === 'VIDEO' && (
                <View style={s.mediaVideo}>
                  <Ionicons name="videocam" size={36} color="#4f46e5" />
                  <Text style={s.mediaVideoName} numberOfLines={1}>{media.name}</Text>
                  {media.size && (
                    <Text style={s.mediaSizeTxt}>
                      {media.size < 1_048_576 ? `${(media.size / 1024).toFixed(0)} KB` : `${(media.size / 1_048_576).toFixed(1)} MB`}
                    </Text>
                  )}
                </View>
              )}
              <TouchableOpacity style={s.mediaRemove} onPress={clearMedia}>
                <Ionicons name="close-circle" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {/* Location input */}
          {showLoc && (
            <View style={s.locRow}>
              <Ionicons name="location-outline" size={16} color="#4f46e5" />
              <TextInput
                style={s.locInput}
                value={location}
                onChangeText={setLocation}
                placeholder="Add location…"
                placeholderTextColor="#9ca3af"
                allowFontScaling={false}
                returnKeyType="done"
              />
              {location ? (
                <TouchableOpacity onPress={() => setLocation('')}>
                  <Ionicons name="close-circle" size={16} color="#9ca3af" />
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </ScrollView>

        {/* Bottom toolbar */}
        <View style={s.toolbar}>
          {/* Photo from library */}
          <TouchableOpacity style={s.toolBtn} onPress={() => pickMedia('library')}>
            <Ionicons name="image-outline" size={22} color={media?.type === 'IMAGE' ? '#4f46e5' : '#6b7280'} />
          </TouchableOpacity>

          {/* Camera */}
          <TouchableOpacity style={s.toolBtn} onPress={() => pickMedia('camera')}>
            <Ionicons name="camera-outline" size={22} color="#6b7280" />
          </TouchableOpacity>

          {/* Location tag */}
          <TouchableOpacity style={s.toolBtn} onPress={() => setShowLoc(v => !v)}>
            <Ionicons name="location-outline" size={22} color={showLoc ? '#4f46e5' : '#6b7280'} />
          </TouchableOpacity>

          <Text style={s.charCount}>{body.length}/5000</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#fff' },
  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  cancelBtn:        { padding: 4 },
  cancelText:       { fontSize: 16, color: '#6b7280' },
  title:            { fontSize: 16, fontWeight: '700', color: '#111827' },
  postBtn:          { backgroundColor: '#4f46e5', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  postBtnDisabled:  { backgroundColor: '#c7d2fe' },
  postBtnText:      { color: '#fff', fontWeight: '700', fontSize: 14 },
  author:           { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16 },
  avatar:           { width: 44, height: 44, borderRadius: 22, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarText:       { fontSize: 16, fontWeight: '700', color: '#4f46e5' },
  authorName:       { fontSize: 14, fontWeight: '700', color: '#111827' },
  visPicker:        { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, backgroundColor: '#ede9fe', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, alignSelf: 'flex-start' },
  visLabel:         { fontSize: 12, fontWeight: '600', color: '#4f46e5' },
  visDropdown:      { position: 'absolute', top: 44, left: 0, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', zIndex: 10, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, elevation: 4, minWidth: 140 },
  visOption:        { paddingHorizontal: 12, paddingVertical: 10 },
  visOptionActive:  { backgroundColor: '#f5f3ff' },
  visOptionText:    { fontSize: 14, color: '#374151' },
  input:            { paddingHorizontal: 16, paddingVertical: 8, fontSize: 16, color: '#111827', minHeight: 120, textAlignVertical: 'top' },
  mediaPreview:     { marginHorizontal: 16, marginBottom: 12, borderRadius: 16, overflow: 'hidden', backgroundColor: '#f8fafc', position: 'relative' },
  mediaImg:         { width: '100%', height: 220, borderRadius: 16 },
  mediaVideo:       { height: 100, justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: '#ede9fe' },
  mediaVideoName:   { fontSize: 13, fontWeight: '600', color: '#4f46e5', paddingHorizontal: 16 },
  mediaSizeTxt:     { fontSize: 11, color: '#9ca3af' },
  mediaRemove:      { position: 'absolute', top: 8, right: 8 },
  locRow:           { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, backgroundColor: '#f9fafb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#e5e7eb' },
  locInput:         { flex: 1, fontSize: 14, color: '#111827' },
  toolbar:          { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  toolBtn:          { padding: 8, borderRadius: 20 },
  charCount:        { marginLeft: 'auto', fontSize: 12, color: '#9ca3af' },
});






