/**
 * HALQA Mobile — LiveClassPollPanel
 * Host creates polls, students vote, everyone sees live results.
 * Mirrors the web LiveClassPoll.tsx logic exactly.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, TextInput,
  ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

// ─── Types (mirrors web Poll / PollEvent) ────────────────────────────────────
export interface PollOption {
  id: string;
  text: string;
  votes: string[]; // userIds who voted for this option
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  isActive: boolean;
  createdAt: number; // timestamp
  totalVotes?: number;
}

export type PollEventType = 'create' | 'vote' | 'close';

export interface PollEvent {
  type: PollEventType;
  poll?: Poll;       // for 'create'
  pollId?: string;   // for 'vote' and 'close'
  optionId?: string; // for 'vote'
  userId?: string;   // for 'vote'
}

interface Props {
  isHost: boolean;
  userId: string | undefined;
  polls: Poll[];
  liveClassId: string;
  onEvent: (event: PollEvent) => void; // called for local + broadcast
}

// ─── Poll Result Bar ──────────────────────────────────────────────────────────
function PollResultBar({ option, total, isVoted }: {
  option: PollOption; total: number; isVoted: boolean;
}) {
  const pct = total > 0 ? Math.round((option.votes.length / total) * 100) : 0;
  return (
    <View style={rb.row}>
      <View style={rb.barBg}>
        <View style={[rb.barFill, { width: `${pct}%` as any, backgroundColor: isVoted ? '#4f46e5' : '#374151' }]} />
        <Text style={rb.label} numberOfLines={1}>{option.text}</Text>
      </View>
      <Text style={rb.pct}>{pct}%</Text>
      {isVoted && <Ionicons name="checkmark-circle" size={14} color="#4f46e5" style={{ marginLeft: 4 }} />}
    </View>
  );
}

const rb = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  barBg:  { flex: 1, height: 32, backgroundColor: '#111827', borderRadius: 8, overflow: 'hidden', position: 'relative', justifyContent: 'center' },
  barFill:{ position: 'absolute', top: 0, left: 0, bottom: 0, borderRadius: 8 },
  label:  { position: 'absolute', paddingHorizontal: 10, color: '#e5e7eb', fontSize: 12, fontWeight: '600' },
  pct:    { width: 36, textAlign: 'right', color: '#9ca3af', fontSize: 12, fontWeight: '700' },
});

// ─── Single Poll Card ─────────────────────────────────────────────────────────
function PollCard({ poll, isHost, userId, onVote, onClose }: {
  poll: Poll; isHost: boolean; userId: string | undefined;
  onVote: (pollId: string, optionId: string) => void;
  onClose: (pollId: string) => void;
}) {
  const myVoteOptionId = poll.options.find(o => userId && o.votes.includes(userId))?.id;
  const hasVoted = !!myVoteOptionId;
  const totalVotes = poll.options.reduce((s, o) => s + o.votes.length, 0);
  const showResults = !poll.isActive || hasVoted || isHost;

  return (
    <View style={pc.card}>
      {/* Header */}
      <View style={pc.header}>
        <View style={[pc.statusDot, { backgroundColor: poll.isActive ? '#10b981' : '#6b7280' }]} />
        <Text style={pc.question} numberOfLines={3}>{poll.question}</Text>
        {isHost && poll.isActive && (
          <TouchableOpacity style={pc.closeBtn} onPress={() => onClose(poll.id)}>
            <Ionicons name="stop-circle" size={16} color="#ef4444" />
          </TouchableOpacity>
        )}
      </View>

      <Text style={pc.votes}>{totalVotes} vote{totalVotes !== 1 ? 's' : ''}{!poll.isActive ? ' · Closed' : ''}</Text>

      {showResults ? (
        /* Results view */
        <View style={{ marginTop: 8 }}>
          {poll.options.map(o => (
            <PollResultBar key={o.id} option={o} total={totalVotes} isVoted={o.id === myVoteOptionId} />
          ))}
        </View>
      ) : (
        /* Voting view — only shown when poll is active and user hasn't voted */
        <View style={{ marginTop: 8, gap: 6 }}>
          {poll.options.map(o => (
            <TouchableOpacity
              key={o.id}
              style={pc.voteBtn}
              onPress={() => onVote(poll.id, o.id)}
            >
              <Text style={pc.voteBtnText}>{o.text}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const pc = StyleSheet.create({
  card:       { backgroundColor: '#1e1e3a', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#374151' },
  header:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  statusDot:  { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  question:   { flex: 1, color: '#e5e7eb', fontSize: 14, fontWeight: '700', lineHeight: 20 },
  closeBtn:   { padding: 4 },
  votes:      { color: '#6b7280', fontSize: 11, marginBottom: 4 },
  voteBtn:    { backgroundColor: '#111827', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#374151' },
  voteBtnText:{ color: '#e5e7eb', fontSize: 13, fontWeight: '600' },
});

// ─── Create Poll Form (host only) ─────────────────────────────────────────────
function CreatePollForm({ onSubmit, onCancel }: {
  onSubmit: (question: string, options: string[]) => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions]   = useState(['', '']);

  const addOption = () => {
    if (options.length < 6) setOptions(o => [...o, '']);
  };
  const removeOption = (i: number) => {
    if (options.length > 2) setOptions(o => o.filter((_, j) => j !== i));
  };
  const updateOption = (i: number, text: string) => {
    setOptions(o => o.map((v, j) => j === i ? text : v));
  };

  const handleCreate = () => {
    const q = question.trim();
    const opts = options.map(o => o.trim()).filter(Boolean);
    if (!q) { showMessage({ message: 'Question is required', type: 'warning' }); return; }
    if (opts.length < 2) { showMessage({ message: 'At least 2 options required', type: 'warning' }); return; }
    onSubmit(q, opts);
  };

  return (
    <View style={cf.form}>
      <Text style={cf.label}>Question</Text>
      <TextInput
        style={cf.input}
        value={question}
        onChangeText={setQuestion}
        placeholder="Ask your class a question…"
        placeholderTextColor="#6b7280"
        multiline
        maxLength={200}
      />
      <Text style={[cf.label, { marginTop: 10 }]}>Answer options</Text>
      {options.map((opt, i) => (
        <View key={i} style={cf.optRow}>
          <TextInput
            style={[cf.input, { flex: 1, marginBottom: 0 }]}
            value={opt}
            onChangeText={t => updateOption(i, t)}
            placeholder={`Option ${i + 1}`}
            placeholderTextColor="#6b7280"
            maxLength={80}
          />
          {options.length > 2 && (
            <TouchableOpacity onPress={() => removeOption(i)} style={cf.removeBtn}>
              <Ionicons name="close-circle" size={20} color="#6b7280" />
            </TouchableOpacity>
          )}
        </View>
      ))}
      {options.length < 6 && (
        <TouchableOpacity style={cf.addBtn} onPress={addOption}>
          <Ionicons name="add-circle-outline" size={16} color="#4f46e5" />
          <Text style={cf.addBtnText}>Add option</Text>
        </TouchableOpacity>
      )}
      <View style={cf.actions}>
        <TouchableOpacity style={cf.cancelBtn} onPress={onCancel}>
          <Text style={cf.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={cf.createBtn} onPress={handleCreate}>
          <Ionicons name="bar-chart" size={14} color="#fff" />
          <Text style={cf.createText}>Launch Poll</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const cf = StyleSheet.create({
  form:       { backgroundColor: '#1e1e3a', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#4f46e544' },
  label:      { color: '#9ca3af', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  input:      { backgroundColor: '#111827', borderRadius: 10, borderWidth: 1, borderColor: '#374151', padding: 10, color: '#e5e7eb', fontSize: 13, marginBottom: 6 },
  optRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  removeBtn:  { padding: 4 },
  addBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, marginBottom: 8 },
  addBtnText: { color: '#4f46e5', fontSize: 13, fontWeight: '600' },
  actions:    { flexDirection: 'row', gap: 8, marginTop: 4 },
  cancelBtn:  { flex: 1, backgroundColor: '#374151', borderRadius: 10, padding: 11, alignItems: 'center' },
  cancelText: { color: '#9ca3af', fontWeight: '600', fontSize: 13 },
  createBtn:  { flex: 2, backgroundColor: '#4f46e5', borderRadius: 10, padding: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  createText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function LiveClassPollPanel({ isHost, userId, polls, liveClassId, onEvent }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);

  const handleCreate = useCallback(async (question: string, options: string[]) => {
    const poll: Poll = {
      id:        `poll-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      question,
      options:   options.map((text, i) => ({ id: `opt-${i}-${Date.now()}`, text, votes: [] })),
      isActive:  true,
      createdAt: Date.now(),
    };
    const event: PollEvent = { type: 'create', poll };
    setBroadcasting(true);
    try {
      await api.post(`/live-classes/${liveClassId}/poll`, { event });
      onEvent(event);
      setShowCreate(false);
      showMessage({ message: '📊 Poll launched!', type: 'success' });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to launch poll', type: 'danger' });
    } finally {
      setBroadcasting(false);
    }
  }, [liveClassId, onEvent]);

  const handleVote = useCallback(async (pollId: string, optionId: string) => {
    if (!userId) return;
    const event: PollEvent = { type: 'vote', pollId, optionId, userId };
    try {
      await api.post(`/live-classes/${liveClassId}/poll`, { event });
      onEvent(event);
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to vote', type: 'danger' });
    }
  }, [liveClassId, userId, onEvent]);

  const handleClose = useCallback(async (pollId: string) => {
    const event: PollEvent = { type: 'close', pollId };
    try {
      await api.post(`/live-classes/${liveClassId}/poll`, { event });
      onEvent(event);
      showMessage({ message: '⏹ Poll closed', type: 'info' });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to close poll', type: 'danger' });
    }
  }, [liveClassId, onEvent]);

  return (
    <View style={{ flex: 1 }}>
      {/* Host: launch poll button */}
      {isHost && !showCreate && (
        <TouchableOpacity
          style={pp.createBtn}
          onPress={() => setShowCreate(true)}
          disabled={broadcasting}
        >
          {broadcasting
            ? <ActivityIndicator color="#fff" size="small" />
            : <><Ionicons name="bar-chart" size={16} color="#fff" /><Text style={pp.createBtnText}>Launch New Poll</Text></>
          }
        </TouchableOpacity>
      )}

      {/* Create form */}
      {showCreate && (
        <CreatePollForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Poll list */}
      {polls.length === 0 && !showCreate ? (
        <View style={pp.empty}>
          <Ionicons name="bar-chart-outline" size={40} color="#374151" />
          <Text style={pp.emptyTitle}>No polls yet</Text>
          {isHost && <Text style={pp.emptySub}>Launch a poll to engage your students</Text>}
          {!isHost && <Text style={pp.emptySub}>The teacher hasn't launched a poll yet</Text>}
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
          {polls.map(poll => (
            <PollCard
              key={poll.id}
              poll={poll}
              isHost={isHost}
              userId={userId}
              onVote={handleVote}
              onClose={handleClose}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const pp = StyleSheet.create({
  createBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#4f46e5', borderRadius: 12, padding: 13, marginBottom: 12 },
  createBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  empty:         { alignItems: 'center', paddingTop: 48, gap: 10 },
  emptyTitle:    { color: '#9ca3af', fontSize: 16, fontWeight: '700' },
  emptySub:      { color: '#6b7280', fontSize: 13, textAlign: 'center' },
});
