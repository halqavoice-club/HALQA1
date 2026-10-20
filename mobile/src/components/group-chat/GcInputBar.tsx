/**
 * GcInputBar (React Native) — full-featured input bar for Group Chat.
 * Mirrors web GcInputBar: text, photo/video, audio, file, voice recording, edit, reply.
 * Wraps the existing upload infrastructure.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Platform, Alert, Modal, Pressable, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import api from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ReplyTo { id: string; body?: string | null; type?: string; sender: { firstName: string } }
interface EditingMsg { id: string; body?: string | null }

interface SendMediaPayload {
  type: string;
  mediaUrl: string;
  mimeType?: string;
  fileSize?: number;
  fileName?: string;
  duration?: number;
}

interface Props {
  convId: string;
  replyTo: ReplyTo | null;
  editingMsg: EditingMsg | null;
  sending: boolean;
  onSendText: (body: string, replyToId?: string) => Promise<void>;
  onSendMedia: (payload: SendMediaPayload) => Promise<void>;
  onEditSubmit: (body: string) => Promise<void>;
  onTyping: () => void;
  onClearReply: () => void;
  onCancelEdit: () => void;
  // Restriction props — enforced in UI when group has admin-only settings
  isAdmin?: boolean;
  onlyAdminsCanSendMessages?: boolean;
  onlyAdminsCanSendMedia?: boolean;
}

const TG_BLUE  = '#2AABEE';
const TG_PANEL = '#232e3c';

function fmtDur(s: number) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function mimeToGcType(mime: string): string {
  if (mime.startsWith('image/gif')) return 'GIF';
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.startsWith('audio/')) return 'AUDIO';
  return 'FILE';
}

export function GcInputBar({
  convId, replyTo, editingMsg, sending,
  onSendText, onSendMedia, onEditSubmit, onTyping, onClearReply, onCancelEdit,
  isAdmin = false,
  onlyAdminsCanSendMessages = false,
  onlyAdminsCanSendMedia = false,
}: Props) {
  const [text, setText] = useState('');
  const [showAttach, setShowAttach] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Restriction checks
  const msgRestricted   = onlyAdminsCanSendMessages && !isAdmin;
  const mediaRestricted = onlyAdminsCanSendMedia && !isAdmin;

  // Voice recording
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recDuration, setRecDuration] = useState(0);
  const [recBlob, setRecBlob] = useState<{ uri: string; duration: number } | null>(null);
  const recTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const recStart = useRef(0);

  // Populate text when entering edit mode
  useEffect(() => {
    if (editingMsg) setText(editingMsg.body ?? '');
    else if (!editingMsg) setText('');
  }, [editingMsg?.id]); // eslint-disable-line

  useEffect(() => {
    return () => {
      clearInterval(recTimer.current);
      recording?.stopAndUnloadAsync().catch(() => {});
    };
  }, [recording]);

  // ── Upload helper ──────────────────────────────────────────────────────────
  const uploadFile = useCallback(async (uri: string, name: string, mimeType: string) => {
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
      const type = mimeToGcType(mimeType);
      await onSendMedia({
        type,
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
  }, [onSendMedia]);

  // ── Pickers ────────────────────────────────────────────────────────────────
  const pickImage = useCallback(async () => {
    setShowAttach(false);
    try {
      const ImagePicker = await import('expo-image-picker');
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission required', 'Allow media library access.'); return; }
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
    } catch { }
  }, [uploadFile]);

  const pickAudio = useCallback(async () => {
    setShowAttach(false);
    try {
      const DocPicker = await import('expo-document-picker');
      const result = await DocPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      await uploadFile(file.uri, file.name, file.mimeType ?? 'audio/mpeg');
    } catch { }
  }, [uploadFile]);

  const pickDocument = useCallback(async () => {
    setShowAttach(false);
    try {
      const DocPicker = await import('expo-document-picker');
      const result = await DocPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      await uploadFile(file.uri, file.name, file.mimeType ?? 'application/octet-stream');
    } catch { }
  }, [uploadFile]);

  // ── Voice recording ────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission required', 'Allow microphone access.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
      setRecDuration(0);
      recStart.current = Date.now();
      recTimer.current = setInterval(() => setRecDuration(Math.round((Date.now() - recStart.current) / 1000)), 1000);
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
    if (!recBlob) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', { uri: recBlob.uri, name: `voice-${Date.now()}.m4a`, type: 'audio/mp4' } as any);
      const res = await api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const record = res.data.data;
      await onSendMedia({ type: 'VOICE', mediaUrl: record.url, mimeType: record.mimeType ?? 'audio/mp4', fileSize: record.size, duration: recBlob.duration });
    } catch (e: any) { Alert.alert('Failed', e?.message ?? 'Could not send voice message'); }
    finally { setUploading(false); setRecBlob(null); }
  }, [recBlob, onSendMedia]);

  // ── Send / edit ────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const body = text.trim();
    if (!body || sending || uploading) return;
    setText('');
    if (editingMsg) {
      await onEditSubmit(body);
    } else {
      await onSendText(body, replyTo?.id);
    }
  }, [text, sending, uploading, editingMsg, replyTo, onSendText, onEditSubmit]);

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
              {replyTo.body || (replyTo.type !== 'TEXT' ? `📎 ${replyTo.type}` : '')}
            </Text>
          </View>
          <TouchableOpacity onPress={onClearReply} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
            <Ionicons name="close" size={16} color="#aab8c2" />
          </TouchableOpacity>
        </View>
      )}

      {/* Edit banner */}
      {editingMsg && (
        <View style={s.editBanner}>
          <Ionicons name="pencil" size={14} color={TG_BLUE} />
          <Text style={s.editText} numberOfLines={1}>Editing: {editingMsg.body}</Text>
          <TouchableOpacity onPress={onCancelEdit} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
            <Ionicons name="close" size={16} color="#aab8c2" />
          </TouchableOpacity>
        </View>
      )}

      {/* Upload progress */}
      {uploading && (
        <View style={s.progressBar}>
          <ActivityIndicator size="small" color={TG_BLUE} />
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

      {/* Voice ready */}
      {voiceReady && !uploading && (
        <View style={s.voiceReady}>
          <Ionicons name="mic" size={18} color={TG_BLUE} />
          <Text style={s.voiceReadyText}>Voice ({fmtDur(recBlob!.duration)}) ready</Text>
          <TouchableOpacity onPress={cancelRecording} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </TouchableOpacity>
          <TouchableOpacity onPress={sendVoice} style={s.voiceSendBtn}>
            <Ionicons name="send" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* Main input row */}
      {!isRecording && !voiceReady && (
        msgRestricted ? (
          /* Restriction notice — member cannot send messages */
          <View style={{ paddingHorizontal: 16, paddingVertical: 14, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#0e1621' }}>
            <Text style={{ color: '#6c8998', fontSize: 13 }}>🔒 Only admins can send messages</Text>
          </View>
        ) : (
        <View style={s.inputRow}>
          {/* Attach — hidden when media is restricted */}
          {!mediaRestricted && (
          <TouchableOpacity onPress={() => setShowAttach(true)} style={s.iconBtn}>
            <Ionicons name="attach" size={22} color="#aab8c2" />
          </TouchableOpacity>
          )}
          <TextInput
            value={text}
            onChangeText={t => { setText(t); onTyping(); }}
            placeholder={editingMsg ? 'Edit message…' : replyTo ? `Reply to ${replyTo.sender.firstName}…` : 'Message'}
            placeholderTextColor="#6c8998"
            style={s.input}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[s.sendBtn, ((!text.trim() && !editingMsg) || sending || uploading) && s.sendBtnOff]}
            onPress={text.trim() || editingMsg ? handleSend : startRecording}
            disabled={sending || uploading}>
            {sending || uploading
              ? <ActivityIndicator size="small" color="#fff" />
              : (text.trim() || editingMsg)
                ? <Ionicons name="send" size={18} color="#fff" />
                : <Ionicons name="mic" size={20} color="#fff" />
            }
          </TouchableOpacity>
        </View>
        )
      )}

      {/* Attach sheet */}
      <Modal visible={showAttach} transparent animationType="slide" onRequestClose={() => setShowAttach(false)}>
        <Pressable style={s.attachOverlay} onPress={() => setShowAttach(false)}>
          <View style={s.attachSheet}>
            <Text style={s.attachTitle}>Send</Text>
            {[
              { icon: 'image-outline',    label: 'Photo / Video / GIF', onPress: pickImage,    color: '#7c3aed' },
              { icon: 'musical-notes',    label: 'Audio File',           onPress: pickAudio,    color: '#0891b2' },
              { icon: 'document-outline', label: 'Document / File',      onPress: pickDocument, color: '#059669' },
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

const s = StyleSheet.create({
  container:     { backgroundColor: TG_PANEL },
  replyBar:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: TG_PANEL, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#0e1621' },
  replyLine:     { width: 3, height: 36, borderRadius: 2, backgroundColor: TG_BLUE },
  replyName:     { fontSize: 11, fontWeight: '700', color: TG_BLUE },
  replyBody:     { fontSize: 12, color: '#aab8c2' },
  editBanner:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: TG_PANEL, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#0e1621' },
  editText:      { flex: 1, fontSize: 13, color: TG_BLUE },
  progressBar:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#0e1621' },
  progressTrack: { flex: 1, height: 4, backgroundColor: '#17212b', borderRadius: 2, overflow: 'hidden' },
  progressFill:  { height: '100%' as any, backgroundColor: TG_BLUE, borderRadius: 2 },
  progressText:  { fontSize: 11, color: '#aab8c2', width: 32 },
  recBar:        { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(239,68,68,0.08)', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#0e1621' },
  recDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  recTime:       { fontSize: 14, fontWeight: '700', color: '#ef4444' },
  recLabel:      { flex: 1, fontSize: 13, color: '#aab8c2' },
  recCancel:     { padding: 4 },
  voiceReady:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#0e1621', backgroundColor: 'rgba(42,171,238,0.08)' },
  voiceReadyText:{ flex: 1, fontSize: 13, color: TG_BLUE },
  voiceSendBtn:  { width: 34, height: 34, borderRadius: 17, backgroundColor: TG_BLUE, alignItems: 'center', justifyContent: 'center' },
  inputRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8 },
  iconBtn:       { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  input:         { flex: 1, backgroundColor: '#17212b', borderRadius: 22, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 10 : 8, fontSize: 15, color: '#e8e8e8', maxHeight: 100 },
  sendBtn:       { width: 42, height: 42, borderRadius: 21, backgroundColor: TG_BLUE, justifyContent: 'center', alignItems: 'center' },
  sendBtnOff:    { backgroundColor: '#1a4a6e' },
  attachOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  attachSheet:   { backgroundColor: '#232e3c', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36, gap: 4 },
  attachTitle:   { fontSize: 16, fontWeight: '700', color: '#e8e8e8', marginBottom: 8, textAlign: 'center' },
  attachRow:     { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#17212b' },
  attachIcon:    { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  attachLabel:   { fontSize: 15, color: '#e8e8e8', fontWeight: '500' },
});
