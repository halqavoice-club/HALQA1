/**
 * HALQA Mobile — Create Story Screen
 */
import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

const BG_COLORS = ['#4f46e5','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2','#0f172a','#334155'];

export default function CreateStoryScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [text,    setText]    = useState('');
  const [bgColor, setBgColor] = useState('#4f46e5');

  const mutation = useMutation({
    mutationFn: () => api.post('/stories', { type: 'TEXT', text: text.trim(), bgColor, textColor: '#ffffff' }),
    onSuccess: () => {
      showMessage({ message: '✅ Story posted!', type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['stories-feed'] });
      router.back();
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message || 'Failed', type: 'danger' }),
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>New Story</Text>
        <TouchableOpacity
          style={[styles.postBtn, (!text.trim() || mutation.isPending) && styles.postBtnDisabled]}
          onPress={() => mutation.mutate()}
          disabled={!text.trim() || mutation.isPending}
        >
          {mutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.postBtnText}>Share</Text>}
        </TouchableOpacity>
      </View>

      {/* Preview */}
      <View style={[styles.preview, { backgroundColor: bgColor }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Type your story…"
          placeholderTextColor="rgba(255,255,255,0.6)"
          style={styles.storyInput}
          multiline
          autoFocus
          maxLength={280}
          textAlign="center"
        />
      </View>

      {/* Color picker */}
      <View style={styles.colorRow}>
        {BG_COLORS.map(c => (
          <TouchableOpacity
            key={c}
            style={[styles.colorBtn, { backgroundColor: c }, bgColor === c && styles.colorBtnActive]}
            onPress={() => setBgColor(c)}
          />
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#000' },
  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  cancel:           { color: '#fff', fontSize: 16 },
  title:            { color: '#fff', fontSize: 16, fontWeight: '700' },
  postBtn:          { backgroundColor: '#4f46e5', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  postBtnDisabled:  { backgroundColor: '#374151' },
  postBtnText:      { color: '#fff', fontWeight: '700' },
  preview:          { flex: 1, justifyContent: 'center', alignItems: 'center', margin: 16, borderRadius: 20, padding: 24 },
  storyInput:       { fontSize: 24, fontWeight: '700', color: '#fff', textAlign: 'center', width: '100%' },
  colorRow:         { flexDirection: 'row', justifyContent: 'center', gap: 10, padding: 16 },
  colorBtn:         { width: 36, height: 36, borderRadius: 18 },
  colorBtnActive:   { borderWidth: 3, borderColor: '#fff' },
});
