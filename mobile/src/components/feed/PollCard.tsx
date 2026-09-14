/**
 * HALQA Mobile — PollCard
 * Renders a poll embedded in a feed PostCard.
 *
 * pollData shape:
 *   { question, options: [{id, text, votes}], totalVotes, votedOptionId?, endsAt? }
 */
import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

interface PollOption {
  id: string;
  text: string;
  votes: number;
}

interface PollData {
  question: string;
  options: PollOption[];
  totalVotes: number;
  votedOptionId?: string | null;
  endsAt?: string | null;
}

interface Props {
  postId: string;
  pollData: any;
  isOwn: boolean;
}

export function PollCard({ postId, pollData, isOwn }: Props) {
  const qc = useQueryClient();

  const voteMutation = useMutation({
    mutationFn: (optionId: string) => api.post(`/posts/${postId}/poll/vote`, { optionId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['post', postId] });
    },
    onError: (e: any) => {
      showMessage({
        message: e?.response?.data?.message || 'Failed to vote',
        type: 'danger',
      });
    },
  });

  if (!pollData || typeof pollData !== 'object') return null;

  // Normalise options — support legacy string[] arrays
  const rawOptions: PollOption[] = Array.isArray(pollData.options)
    ? pollData.options.map((o: any, i: number) =>
        typeof o === 'string'
          ? { id: String(i), text: o, votes: 0 }
          : { id: o.id ?? String(i), text: o.text ?? o, votes: o.votes ?? 0 }
      )
    : [];

  const data: PollData = {
    question:      pollData.question ?? 'Poll',
    options:       rawOptions,
    totalVotes:    pollData.totalVotes ?? rawOptions.reduce((s, o) => s + o.votes, 0),
    votedOptionId: pollData.votedOptionId ?? null,
    endsAt:        pollData.endsAt ?? null,
  };

  const hasVoted  = !!data.votedOptionId;
  const isExpired = data.endsAt ? new Date(data.endsAt) < new Date() : false;
  const canVote   = !hasVoted && !isExpired && !isOwn && !voteMutation.isPending;
  const showBars  = hasVoted || isExpired || isOwn;

  return (
    <View style={p.container}>
      {/* Header */}
      <View style={p.header}>
        <View style={p.headerLeft}>
          <Ionicons name="bar-chart-outline" size={15} color="#4f46e5" />
          <Text style={p.question} numberOfLines={3}>{data.question}</Text>
        </View>
        {data.endsAt && !isExpired && (
          <View style={p.expiryWrap}>
            <Ionicons name="time-outline" size={11} color="#9ca3af" />
            <Text style={p.expiryText}>
              {formatDistanceToNow(new Date(data.endsAt), { addSuffix: true })}
            </Text>
          </View>
        )}
        {isExpired && (
          <Text style={p.closedBadge}>Closed</Text>
        )}
      </View>

      {/* Options */}
      <View style={p.options}>
        {data.options.map(opt => {
          const pct        = data.totalVotes > 0 ? Math.round((opt.votes / data.totalVotes) * 100) : 0;
          const isSelected = data.votedOptionId === opt.id;

          return (
            <TouchableOpacity
              key={opt.id}
              style={[p.option, isSelected && p.optionSelected, !canVote && p.optionNoHover]}
              onPress={() => canVote && voteMutation.mutate(opt.id)}
              activeOpacity={canVote ? 0.7 : 1}
              disabled={!canVote}
            >
              {/* Progress fill bar */}
              {showBars && (
                <View
                  style={[
                    p.barFill,
                    { width: `${pct}%` as any },
                    isSelected ? p.barFillSelected : p.barFillNeutral,
                  ]}
                />
              )}

              {/* Content */}
              <View style={p.optionContent}>
                <View style={p.optionLeft}>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={14} color="#4f46e5" style={p.checkIcon} />
                  )}
                  <Text
                    style={[p.optionText, isSelected && p.optionTextSelected]}
                    numberOfLines={2}
                  >
                    {opt.text}
                  </Text>
                </View>
                {showBars && (
                  <Text style={[p.pctText, isSelected && p.pctTextSelected]}>
                    {pct}%
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Footer */}
      <View style={p.footer}>
        <Text style={p.footerText}>{data.totalVotes} vote{data.totalVotes !== 1 ? 's' : ''}</Text>
        {hasVoted   && <Text style={p.footerDot}> · You voted</Text>}
        {isOwn      && <Text style={p.footerDot}> · Your poll</Text>}
        {isExpired  && <Text style={p.footerDot}> · Poll closed</Text>}
        {voteMutation.isPending && (
          <ActivityIndicator size="small" color="#4f46e5" style={{ marginLeft: 8 }} />
        )}
      </View>
    </View>
  );
}

const p = StyleSheet.create({
  container:        { backgroundColor: '#f8fafc', borderRadius: 14, borderWidth: 1, borderColor: '#e5e7eb', padding: 12, marginBottom: 8 },
  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  headerLeft:       { flexDirection: 'row', alignItems: 'flex-start', gap: 6, flex: 1 },
  question:         { fontSize: 14, fontWeight: '700', color: '#1e293b', flex: 1, lineHeight: 20 },
  expiryWrap:       { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  expiryText:       { fontSize: 11, color: '#9ca3af' },
  closedBadge:      { fontSize: 11, color: '#9ca3af', flexShrink: 0 },
  options:          { gap: 6 },
  option:           { position: 'relative', borderRadius: 10, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#fff', overflow: 'hidden', minHeight: 42 },
  optionSelected:   { borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
  optionNoHover:    {},
  barFill:          { position: 'absolute', top: 0, left: 0, bottom: 0, borderRadius: 8 },
  barFillSelected:  { backgroundColor: '#c7d2fe' },
  barFillNeutral:   { backgroundColor: '#f1f5f9' },
  optionContent:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, position: 'relative' },
  optionLeft:       { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  checkIcon:        { flexShrink: 0 },
  optionText:       { fontSize: 14, color: '#374151', flex: 1 },
  optionTextSelected: { color: '#3730a3', fontWeight: '600' },
  pctText:          { fontSize: 12, fontWeight: '700', color: '#9ca3af', flexShrink: 0, marginLeft: 8 },
  pctTextSelected:  { color: '#4f46e5' },
  footer:           { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  footerText:       { fontSize: 11, color: '#94a3b8' },
  footerDot:        { fontSize: 11, color: '#94a3b8' },
});

