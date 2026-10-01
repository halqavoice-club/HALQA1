/**
 * DmInputBar (React Native) — full-featured input bar for DM.
 * Mirrors frontend/src/components/dm/DmInputBar.tsx exactly.
 *
 * Supports: text, photo, video, GIF, audio, document, voice recording
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Animated, Platform, Alert, Modal, Pressable, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import api from '@/lib/api';
import { SendMessagePayload } from '@/lib/dm';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ReplyTo { id: string; body?: string | null; msgType?: string; sender: { firstName: string } }
interface EditingMsg { id: string; body?: string | null }

interface Props {
  convId: string | null;
  replyTo: ReplyTo | null;
  editingMsg: EditingMsg | null;
  onSendText: (body: string, replyToId?: string) => Promise<void>;
  onSendMedia: (payload: SendMessagePayload) => Promise<void>;
  onTyping: () => void;
  onClearReply: () => void;
  onCancelEdit: () => void;
  sending: boolean;
}

// ─── MIME → msgType ────────────────────────────────────────────────────────────
function mimeToMsgType(mime: string): string {
  if (mime.startsWith('image/gif')) return 'GIF';
  if (mime.startsWith('image/'))    return 'IMAGE';
  if (mime.startsWith('video/'))    return 'VIDEO';
  if (mime.startsWith('audio/'))    return 'AUDIO';
  return 'FILE';
}

function fmtDur(s: number) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ─── Component ─────────────────────────────────────────────────────────────────
export function DmInputBar({
  convId, replyTo, editingMsg,
  onSendText, onSendMedia, onTyping,
  onClearReply, onCancelEdit,
  sending,
}: Props) {
  const [text, setText] = useState('');
  const [showAttach, setShowAttach] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Voice recording state
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recDuration, setRecDuration] = useState(0);
  const [recBlob, setRecBlob] = useState<{ uri: string; duration: number } | null>(null);
  const recTimer = useRef<ReturnType<typeof setInterval>>();
  const recStart = useRef(0);

  // Cleanup recording on unmount
  useEffect(() => {
    return () => {
      clearInterval(recTimer.current);
      recording?.stopAndUnloadAsync().catch(() => {});
    };
  }, [recording]);

  // ── Upload helper ─────────────────────────────────────────────────────────────
  const uploadFile = useCallback(async (uri: string, name: string, mimeType: string) => {
    if (!convId) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const form = new FormData();
      form.append('file', { uri, name, type: mimeType } as any);
      const res = await api.post('/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e: any) => {
          if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        },
      });
      const record = res.data.data;
      const msgType = mimeToMsgType(mimeType);
      await onSendMedia({
        msgType: msgType as any,
        mediaUrl: record.url,
        mimeType: record.mimeType ?? mimeType,
        fileSize: record.size,
        fileName: record.originalName ?? name,
      });
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Could not upload file');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [convId, onSendMedia]);

  // ── Attach handlers ───────────────────────────────────────────────────────────
  const pickImage = useCallback(async () => {
    setShowAttach(false);
    try {
      const ImagePicker = await import('expo-image-picker');
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission required', 'Allow media library access to send photos.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        quality: 0.85,
        videoMaxDuration: 300,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const name = asset.fileName ?? `media-${Date.now()}.${asset.type === 'video' ? 'mp4' : 'jpg'}`;
      const mime = asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
      await uploadFile(asset.uri, name, mime);
    } catch { /* user cancelled */ }
  }, [uploadFile]);

  const pickDocument = useCallback(async () => {
    setShowAttach(false);
    try {
      const DocPicker = await import('expo-document-picker');
      const result = await DocPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      await uploadFile(file.uri, file.name, file.mimeType ?? 'application/octet-stream');
    } catch { /* user cancelled */ }
  }, [uploadFile]);

  const pickAudio = useCallback(async () => {
    setShowAttach(false);
    try {
      const DocPicker = await import('expo-document-picker');
      const result = await DocPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      await uploadFile(file.uri, file.name, file.mimeType ?? 'audio/mpeg');
    } catch { /* user cancelled */ }
  }, [uploadFile]);

  // ── Voice recording ───────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission required', 'Allow microphone access to record voice messages.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(rec);
      setRecDuration(0);
      recStart.current = Date.now();
      recTimer.current = setInterval(() => {
        setRecDuration(Math.round((Date.now() - recStart.current) / 1000));
      }, 1000);
    } catch (e: any) {
      Alert.alert('Recording failed', e?.message ?? 'Could not start recording');
    }
  }, []);

  const stopRecording = useCallback(async () => {
    clearInterval(recTimer.current);
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      const dur = Math.round((Date.now() - recStart.current) / 1000);
      setRecording(null);
      if (uri) setRecBlob({ uri, duration: dur });
    } catch { setRecording(null); }
  }, [recording]);

  const cancelRecording = useCallback(async () => {
    clearInterval(recTimer.current);
    await recording?.stopAndUnloadAsync().catch(() => {});
    setRecording(null);
    setRecDuration(0);
    setRecBlob(null);
  }, [recording]);

  const sendVoice = useCallback(async () => {
    if (!recBlob || !convId) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', { uri: recBlob.uri, name: `voice-${Date.now()}.m4a`, type: 'audio/mp4' } as any);
      const res = await api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const record = res.data.data;
      await onSendMedia({ msgType: 'VOICE', mediaUrl: record.url, mimeType: record.mimeType ?? 'audio/mp4', fileSize: record.size, duration: recBlob.duration });
    } catch (e: any) { Alert.alert('Failed', e?.message ?? 'Could not send voice message'); }
    finally { setUploading(false); setRecBlob(null); }
  }, [recBlob, convId, onSendMedia]);

  // ── Send text ─────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!text.trim() || !convId || sending) return;
    const body = text.trim();
    setText('');
    await onSendText(body, replyTo?.id);
  }, [text, convId, sending, replyTo, onSendText]);

  const isRecording = !!recording;
  const voiceReady  = !!recBlob;

  return (
    <View style={s.container}>
      {/* Reply preview */}
      {replyTo && !editingMsg && (
        <View style={s.replyBar}>
          <View style={s.replyLine} />
          <View style={{ flex: 1 }}>
            <Text style={s.replyName}>{replyTo.sender.firstName}</Text>
            <Text style={s.replyBody} numberOfLines={1}>
              {replyTo.body || (replyTo.msgType !== 'TEXT' ? `📎 ${replyTo.msgType}` : '')}
            </Text>
          </View>
          <TouchableOpacity onPress={onClearReply} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
            <Ionicons name="close" size={16} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      )}

      {/* Edit banner */}
      {editingMsg && (
        <View style={s.editBanner}>
          <Ionicons name="pencil" size={14} color="#128c7e" />
          <Text style={s.editText} numberOfLines={1}>Editing: {editingMsg.body}</Text>
          <TouchableOpacity onPress={onCancelEdit} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
            <Ionicons name="close" size={16} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      )}

      {/* Upload progress */}
      {uploading && (
        <View style={s.progressBar}>
          <ActivityIndicator size="small" color="#25d366" />
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${uploadProgress}%` as any }]} />
          </View>
          <Text style={s.progressText}>{uploadProgress}%</Text>
        </View>
      )}

      {/* Recording indicator */}
      {isRecording && (
        <View style={s.recBar}>
          <View style={s.recDot} />
          <Text style={s.recTime}>{fmtDur(recDuration)}</Text>
          <Text style={s.recLabel}>Recording…</Text>
          <TouchableOpacity onPress={cancelRecording} style={s.recCancel}>
            <Ionicons name="close" size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
      )}

      {/* Voice message ready */}
      {voiceReady && !uploading && (
        <View style={s.voiceReady}>
          <Ionicons name="mic" size={18} color="#128c7e" />
          <Text style={s.voiceReadyText}>Voice ({fmtDur(recBlob!.duration)}) ready to send</Text>
          <TouchableOpacity onPress={cancelRecording} style={{ marginLeft: 4 }}
            hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </TouchableOpacity>
          <TouchableOpacity onPress={sendVoice} style={s.voiceSendBtn}>
            <Ionicons name="send" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* Main input row */}
      {!isRecording && !voiceReady && (
        <View style={s.inputRow}>
          {/* Attach button */}
          <TouchableOpacity onPress={() => setShowAttach(true)} style={s.iconBtn}>
            <Ionicons name="attach" size={22} color="#9ca3af" />
          </TouchableOpacity>

          {/* Text input */}
          <TextInput
            value={text}
            onChangeText={t => { setText(t); onTyping(); }}
            placeholder={editingMsg ? 'Edit message…' : replyTo ? `Reply to ${replyTo.sender.firstName}…` : 'Type a message'}
            placeholderTextColor="#9ca3af"
            style={s.input}
            multiline
            maxLength={5000}
          />

          {/* Send or Mic */}
          <TouchableOpacity
            style={[s.sendBtn, ((!text.trim() && !editingMsg) || sending || uploading) && s.sendBtnOff]}
            onPress={text.trim() || editingMsg ? handleSend : startRecording}
            disabled={sending || uploading}
          >
            {sending || uploading
              ? <ActivityIndicator size="small" color="#fff" />
              : (text.trim() || editingMsg)
                ? <Ionicons name="send" size={18} color="#fff" />
                : <Ionicons name="mic" size={20} color="#fff" />
            }
          </TouchableOpacity>
        </View>
      )}

      {/* Attach sheet modal */}
      <Modal visible={showAttach} transparent animationType="slide"
        onRequestClose={() => setShowAttach(false)}>
        <Pressable style={s.attachOverlay} onPress={() => setShowAttach(false)}>
          <View style={s.attachSheet}>
            <Text style={s.attachTitle}>Send</Text>
            {[
              { icon: 'image-outline',   label: 'Photo / Video / GIF', onPress: pickImage,    color: '#7c3aed' },
              { icon: 'musical-notes',   label: 'Audio File',           onPress: pickAudio,    color: '#0891b2' },
              { icon: 'document-outline',label: 'Document / File',      onPress: pickDocument, color: '#059669' },
            ].map(({ icon, label, onPress, color }) => (
              <TouchableOpacity key={label} style={s.attachRow} onPress={onPress}>
                <View style={[s.attachIcon, { backgroundColor: `${color}18` }]}>
                  <Ionicons name={icon as any} size={22} color={color} />
                </View>
                <Text style={s.attachLabel}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:     { backgroundColor: '#f0f2f5' },
  replyBar:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f0fdf4', paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#bbf7d0' },
  replyLine:     { width: 3, height: 36, borderRadius: 2, backgroundColor: '#128c7e' },
  replyName:     { fontSize: 11, fontWeight: '700', color: '#128c7e' },
  replyBody:     { fontSize: 12, color: '#6b7280' },
  editBanner:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f0fdf4', paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#bbf7d0' },
  editText:      { flex: 1, fontSize: 13, color: '#128c7e' },
  progressBar:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  progressTrack: { flex: 1, height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, overflow: 'hidden' },
  progressFill:  { height: '100%' as any, backgroundColor: '#25d366', borderRadius: 2 },
  progressText:  { fontSize: 11, color: '#9ca3af', width: 32 },
  recBar:        { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff7f7', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#fecaca' },
  recDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  recTime:       { fontSize: 14, fontWeight: '700', color: '#ef4444' },
  recLabel:      { flex: 1, fontSize: 13, color: '#9ca3af' },
  recCancel:     { padding: 4 },
  voiceReady:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f0fdf4', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#bbf7d0' },
  voiceReadyText:{ flex: 1, fontSize: 13, color: '#128c7e' },
  voiceSendBtn:  { width: 34, height: 34, borderRadius: 17, backgroundColor: '#25d366', alignItems: 'center', justifyContent: 'center' },
  inputRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8 },
  iconBtn:       { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  input:         { flex: 1, backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 10 : 8, fontSize: 15, color: '#111827', maxHeight: 100 },
  sendBtn:       { width: 42, height: 42, borderRadius: 21, backgroundColor: '#25d366', justifyContent: 'center', alignItems: 'center' },
  sendBtnOff:    { backgroundColor: '#a7f3d0' },
  attachOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  attachSheet:   { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36, gap: 4 },
  attachTitle:   { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 8, textAlign: 'center' },
  attachRow:     { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f9fafb' },
  attachIcon:    { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  attachLabel:   { fontSize: 15, color: '#374151', fontWeight: '500' },
});
