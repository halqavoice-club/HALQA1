/**
 * HALQA Mobile — Room Settings Sheet
 * Host-only bottom sheet for voice room management.
 *
 * Panels:
 *   • Main menu (list of settings sections)
 *   • Chat & Reactions (comments on/off, slow mode, reactions)
 *   • Mic Seats (max speakers)
 *   • Message Type (all / followers / none)
 *   • Member Management (kick, view)
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, FlatList,
  Switch, ActivityIndicator, Pressable, Alert, ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────
interface RoomParticipant {
  userId: string;
  role: string;
  isActive: boolean;
  user: { firstName: string; lastName: string; avatarUrl?: string | null };
}

interface VoiceRoom {
  id: string;
  commentsEnabled?: boolean;
  slowMode?: boolean;
  reactionsEnabled?: boolean;
  maxSpeakers?: number;
  messageType?: string;
  participants?: RoomParticipant[];
}

type Panel = 'main' | 'chat' | 'seats' | 'msgtype' | 'members';

interface Props {
  visible: boolean;
  onClose: () => void;
  room: VoiceRoom;
  onRoomUpdate?: (patch: Partial<VoiceRoom>) => void;
}

// ── Sub-panel: Chat & Reactions ────────────────────────────────────────────────
function ChatPanel({
  room, onBack, onUpdate,
}: { room: VoiceRoom; onBack: () => void; onUpdate: (p: Partial<VoiceRoom>) => void }) {
  const [commentsEnabled,  setComments]   = useState(room.commentsEnabled  ?? true);
  const [slowMode,         setSlowMode]   = useState(room.slowMode         ?? false);
  const [reactionsEnabled, setReactions]  = useState(room.reactionsEnabled ?? true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/voice/${room.id}`, { commentsEnabled, slowMode, reactionsEnabled });
      onUpdate({ commentsEnabled, slowMode, reactionsEnabled });
      showMessage({ message: '✅ Room settings saved', type: 'success', duration: 1500 });
      onBack();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to save', type: 'danger' });
    } finally { setSaving(false); }
  };

  return (
    <View style={rs.panel}>
      <PanelHeader title="Chat & Reactions" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        {[
          { label: 'Allow comments', sub: 'Audience can send chat messages', key: 'comments', val: commentsEnabled, set: setComments },
          { label: 'Slow mode', sub: 'Limit messages to 1 per 5 seconds', key: 'slow', val: slowMode, set: setSlowMode },
          { label: 'Allow reactions', sub: 'Audience can send emoji reactions', key: 'reactions', val: reactionsEnabled, set: setReactions },
        ].map(item => (
          <View key={item.key} style={rs.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={rs.toggleLabel}>{item.label}</Text>
              <Text style={rs.toggleSub}>{item.sub}</Text>
            </View>
            <Switch
              value={item.val}
              onValueChange={item.set as (v: boolean) => void}
              trackColor={{ false: '#e5e7eb', true: '#4ade80' }}
              thumbColor="#fff"
            />
          </View>
        ))}
        <TouchableOpacity style={[rs.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={rs.saveBtnText}>Save</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ── Sub-panel: Mic Seats ───────────────────────────────────────────────────────
function SeatsPanel({
  room, onBack, onUpdate,
}: { room: VoiceRoom; onBack: () => void; onUpdate: (p: Partial<VoiceRoom>) => void }) {
  const [maxSpeakers, setMaxSpeakers] = useState(room.maxSpeakers ?? 10);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/voice/${room.id}`, { maxSpeakers });
      onUpdate({ maxSpeakers });
      showMessage({ message: '✅ Mic seat limit updated', type: 'success', duration: 1500 });
      onBack();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    } finally { setSaving(false); }
  };

  return (
    <View style={rs.panel}>
      <PanelHeader title="Mic Seat Settings" onBack={onBack} />
      <View style={{ padding: 16 }}>
        <Text style={rs.sectionLabel}>Max speakers on stage</Text>
        <View style={rs.seatRow}>
          {[2, 4, 6, 8, 10].map(n => (
            <TouchableOpacity
              key={n}
              style={[rs.seatOpt, maxSpeakers === n && rs.seatOptActive]}
              onPress={() => setMaxSpeakers(n)}
            >
              <Text style={[rs.seatOptText, maxSpeakers === n && { color: '#4f46e5', fontWeight: '800' }]}>{n}</Text>
              {maxSpeakers === n && (
                <Ionicons name="checkmark" size={12} color="#4f46e5" style={{ marginTop: 2 }} />
              )}
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={[rs.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={rs.saveBtnText}>Save</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Sub-panel: Message Type ────────────────────────────────────────────────────
function MessageTypePanel({
  room, onBack, onUpdate,
}: { room: VoiceRoom; onBack: () => void; onUpdate: (p: Partial<VoiceRoom>) => void }) {
  const [selected, setSelected] = useState<'all' | 'followers' | 'none'>(
    (room.messageType as 'all' | 'followers' | 'none') ?? 'all'
  );
  const [saving, setSaving] = useState(false);

  const options: { value: 'all' | 'followers' | 'none'; icon: any; label: string; sub: string }[] = [
    { value: 'all',       icon: 'globe-outline',   label: 'Everyone',       sub: 'All users in the room can send messages' },
    { value: 'followers', icon: 'people-outline',  label: 'Followers only', sub: 'Only your followers can message' },
    { value: 'none',      icon: 'ban-outline',     label: 'Disabled',       sub: 'No one can chat (host/mod exempt)' },
  ];

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/voice/${room.id}`, { messageType: selected });
      onUpdate({ messageType: selected });
      showMessage({ message: '✅ Message type saved', type: 'success', duration: 1500 });
      onBack();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    } finally { setSaving(false); }
  };

  return (
    <View style={rs.panel}>
      <PanelHeader title="Message Type" onBack={onBack} />
      <View style={{ padding: 16, gap: 8 }}>
        {options.map(opt => (
          <TouchableOpacity
            key={opt.value}
            style={[rs.radioRow, selected === opt.value && rs.radioRowActive]}
            onPress={() => setSelected(opt.value)}
            activeOpacity={0.7}
          >
            <View style={[rs.radioIcon, selected === opt.value && rs.radioIconActive]}>
              <Ionicons name={opt.icon} size={18} color={selected === opt.value ? '#4f46e5' : '#6b7280'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[rs.radioLabel, selected === opt.value && { color: '#4f46e5', fontWeight: '700' }]}>
                {opt.label}
              </Text>
              <Text style={rs.radioSub}>{opt.sub}</Text>
            </View>
            <View style={[rs.radioDot, selected === opt.value && rs.radioDotActive]}>
              {selected === opt.value && <View style={rs.radioDotFill} />}
            </View>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[rs.saveBtn, { marginTop: 8 }, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={rs.saveBtnText}>Save</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Sub-panel: Members ─────────────────────────────────────────────────────────
function MembersPanel({ room, onBack }: { room: VoiceRoom; onBack: () => void }) {
  const participants = (room.participants ?? []).filter(p => p.isActive);

  const handleKick = (userId: string, name: string) => {
    Alert.alert(`Remove ${name}?`, 'They will be removed from the room.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/voice/${room.id}/kick/${userId}`);
            showMessage({ message: `${name} removed`, type: 'success', duration: 1500 });
          } catch (e: any) {
            showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
          }
        },
      },
    ]);
  };

  return (
    <View style={rs.panel}>
      <PanelHeader title={`Members (${participants.length})`} onBack={onBack} />
      <FlatList
        data={participants}
        keyExtractor={p => p.userId}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        renderItem={({ item: p }) => {
          const name = `${p.user.firstName} ${p.user.lastName}`;
          const initials = `${p.user.firstName[0] ?? ''}${p.user.lastName[0] ?? ''}`.toUpperCase();
          return (
            <View style={rs.memberRow}>
              <View style={rs.memberAv}>
                <Text style={rs.memberAvTxt}>{initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={rs.memberName} numberOfLines={1}>{name}</Text>
                <Text style={rs.memberRole}>{p.role}</Text>
              </View>
              {p.role !== 'HOST' && (
                <TouchableOpacity
                  style={rs.kickBtn}
                  onPress={() => handleKick(p.userId, name)}
                >
                  <Ionicons name="person-remove-outline" size={16} color="#ef4444" />
                </TouchableOpacity>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={{ color: '#9ca3af', textAlign: 'center', padding: 20 }}>No active members</Text>
        }
      />
    </View>
  );
}

// ── Shared panel header ────────────────────────────────────────────────────────
function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={rs.panelHeader}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="chevron-back" size={22} color="#e5e7eb" />
      </TouchableOpacity>
      <Text style={rs.panelTitle}>{title}</Text>
      <View style={{ width: 22 }} />
    </View>
  );
}

// ── Main Sheet ─────────────────────────────────────────────────────────────────
export function RoomSettingsSheet({ visible, onClose, room, onRoomUpdate }: Props) {
  const [panel, setPanel] = useState<Panel>('main');
  const [localRoom, setLocalRoom] = useState<VoiceRoom>(room);

  const handleUpdate = (patch: Partial<VoiceRoom>) => {
    setLocalRoom(r => ({ ...r, ...patch }));
    onRoomUpdate?.(patch);
  };

  const mainMenuItems = [
    { key: 'chat',    icon: 'chatbubble-outline',  label: 'Chat & Reactions',   sub: 'Comments, slow mode, reactions' },
    { key: 'seats',   icon: 'mic-outline',          label: 'Mic Seat Settings',  sub: `Max ${localRoom.maxSpeakers ?? 10} speakers` },
    { key: 'msgtype', icon: 'filter-outline',        label: 'Message Type',       sub: localRoom.messageType ?? 'all' },
    { key: 'members', icon: 'people-outline',        label: 'Member Management',  sub: `${(localRoom.participants ?? []).filter(p => p.isActive).length} active` },
  ] as const;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => { setPanel('main'); onClose(); }}
    >
      <Pressable style={rs.backdrop} onPress={() => { setPanel('main'); onClose(); }} />
      <View style={rs.sheet}>
        {/* Handle */}
        <View style={rs.handle} />

        {panel === 'main' && (
          <>
            {/* Sheet header */}
            <View style={rs.sheetHeader}>
              <Text style={rs.sheetTitle}>⚙️ Room Settings</Text>
              <TouchableOpacity onPress={() => { setPanel('main'); onClose(); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            {/* Menu items */}
            <View style={{ padding: 12, gap: 6 }}>
              {mainMenuItems.map(item => (
                <TouchableOpacity
                  key={item.key}
                  style={rs.menuItem}
                  onPress={() => setPanel(item.key as Panel)}
                  activeOpacity={0.7}
                >
                  <View style={rs.menuIcon}>
                    <Ionicons name={item.icon} size={20} color="#a5b4fc" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={rs.menuLabel}>{item.label}</Text>
                    <Text style={rs.menuSub} numberOfLines={1}>{item.sub}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#374151" />
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {panel === 'chat' && (
          <ChatPanel room={localRoom} onBack={() => setPanel('main')} onUpdate={handleUpdate} />
        )}
        {panel === 'seats' && (
          <SeatsPanel room={localRoom} onBack={() => setPanel('main')} onUpdate={handleUpdate} />
        )}
        {panel === 'msgtype' && (
          <MessageTypePanel room={localRoom} onBack={() => setPanel('main')} onUpdate={handleUpdate} />
        )}
        {panel === 'members' && (
          <MembersPanel room={localRoom} onBack={() => setPanel('main')} />
        )}
      </View>
    </Modal>
  );
}

const rs = StyleSheet.create({
  backdrop:        { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet:           { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#111827', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%' },
  handle:          { width: 40, height: 4, backgroundColor: '#374151', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  sheetHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  sheetTitle:      { fontSize: 16, fontWeight: '800', color: '#e5e7eb' },
  // Panel
  panel:           { flex: 1 },
  panelHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  panelTitle:      { fontSize: 15, fontWeight: '700', color: '#e5e7eb' },
  // Menu
  menuItem:        { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1f2937', borderRadius: 14, padding: 14 },
  menuIcon:        { width: 36, height: 36, borderRadius: 10, backgroundColor: '#1e1040', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  menuLabel:       { fontSize: 14, fontWeight: '700', color: '#e5e7eb' },
  menuSub:         { fontSize: 12, color: '#6b7280', marginTop: 1, textTransform: 'capitalize' },
  // Toggle row
  toggleRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1f2937', borderRadius: 12, padding: 14, gap: 12 },
  toggleLabel:     { fontSize: 14, fontWeight: '600', color: '#e5e7eb' },
  toggleSub:       { fontSize: 12, color: '#6b7280', marginTop: 2 },
  // Save button
  saveBtn:         { backgroundColor: '#4f46e5', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  saveBtnText:     { color: '#fff', fontWeight: '800', fontSize: 15 },
  sectionLabel:    { fontSize: 13, fontWeight: '600', color: '#9ca3af', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  // Seat options
  seatRow:         { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  seatOpt:         { flex: 1, minWidth: 48, alignItems: 'center', paddingVertical: 12, backgroundColor: '#1f2937', borderRadius: 12, borderWidth: 1.5, borderColor: '#374151' },
  seatOptActive:   { borderColor: '#4f46e5', backgroundColor: '#1e1040' },
  seatOptText:     { fontSize: 18, fontWeight: '700', color: '#9ca3af' },
  // Radio options
  radioRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1f2937', borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: '#1f2937' },
  radioRowActive:  { borderColor: '#4f46e5', backgroundColor: '#1e1040' },
  radioIcon:       { width: 36, height: 36, borderRadius: 10, backgroundColor: '#111827', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  radioIconActive: { backgroundColor: '#1e1040' },
  radioLabel:      { fontSize: 14, fontWeight: '600', color: '#e5e7eb' },
  radioSub:        { fontSize: 12, color: '#6b7280', marginTop: 2 },
  radioDot:        { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#374151', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  radioDotActive:  { borderColor: '#4f46e5' },
  radioDotFill:    { width: 10, height: 10, borderRadius: 5, backgroundColor: '#4f46e5' },
  // Members
  memberRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1f2937', borderRadius: 12, padding: 12 },
  memberAv:        { width: 38, height: 38, borderRadius: 19, backgroundColor: '#1e1040', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  memberAvTxt:     { fontSize: 13, fontWeight: '800', color: '#a5b4fc' },
  memberName:      { fontSize: 14, fontWeight: '600', color: '#e5e7eb' },
  memberRole:      { fontSize: 11, color: '#6b7280', marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.3 },
  kickBtn:         { width: 34, height: 34, borderRadius: 10, backgroundColor: '#fef2f2', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
});

