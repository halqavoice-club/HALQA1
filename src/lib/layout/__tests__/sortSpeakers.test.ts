/**
 * sortSpeakers.test.ts
 *
 * Unit tests for `sortSpeakers` pure function.
 * Covers Requirements 10.1–10.6 (speaker sort order + pinning).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sortSpeakers } from '../computeLayout';
import { makeSpeaker, resetSpeakerIndex } from '../layoutTestUtils';
import type { SpeakerSlot } from '../layoutTypes';

beforeEach(() => resetSpeakerIndex(0));

// ---------------------------------------------------------------------------
// Owner always first
// ---------------------------------------------------------------------------
describe('sortSpeakers — owner always index 0', () => {
  it('owner in the middle is moved to index 0', () => {
    const speakers: SpeakerSlot[] = [
      makeSpeaker({ userId: 'u1', seatIndex: 0, role: 'speaker' }),
      makeSpeaker({ userId: 'u2', seatIndex: 1, role: 'owner' }),
      makeSpeaker({ userId: 'u3', seatIndex: 2, role: 'speaker' }),
    ];
    const sorted = sortSpeakers(speakers, null);
    expect(sorted[0].role).toBe('owner');
    expect(sorted[0].userId).toBe('u2');
  });

  it('owner at the end is moved to index 0', () => {
    const speakers: SpeakerSlot[] = [
      makeSpeaker({ userId: 'a', seatIndex: 0, role: 'speaker' }),
      makeSpeaker({ userId: 'b', seatIndex: 1, role: 'speaker' }),
      makeSpeaker({ userId: 'owner', seatIndex: 2, role: 'owner' }),
    ];
    const sorted = sortSpeakers(speakers, null);
    expect(sorted[0].role).toBe('owner');
  });

  it('array with only an owner returns a single-element array with that owner', () => {
    const speakers: SpeakerSlot[] = [
      makeSpeaker({ userId: 'o', seatIndex: 0, role: 'owner' }),
    ];
    const sorted = sortSpeakers(speakers, null);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].role).toBe('owner');
  });

  it('does not mutate the original array', () => {
    const speakers: SpeakerSlot[] = [
      makeSpeaker({ userId: 's', seatIndex: 0, role: 'speaker' }),
      makeSpeaker({ userId: 'o', seatIndex: 1, role: 'owner' }),
    ];
    const original = [...speakers];
    sortSpeakers(speakers, null);
    expect(speakers[0].userId).toBe(original[0].userId);
  });
});

// ---------------------------------------------------------------------------
// Moderators second, sorted by seatIndex
// ---------------------------------------------------------------------------
describe('sortSpeakers — moderators after owner', () => {
  it('moderators appear before regular speakers', () => {
    const speakers: SpeakerSlot[] = [
      makeSpeaker({ userId: 's1', seatIndex: 0, role: 'speaker' }),
      makeSpeaker({ userId: 'o', seatIndex: 1, role: 'owner' }),
      makeSpeaker({ userId: 'm1', seatIndex: 2, role: 'moderator' }),
    ];
    const sorted = sortSpeakers(speakers, null);
    expect(sorted[0].role).toBe('owner');
    expect(sorted[1].role).toBe('moderator');
    expect(sorted[2].role).toBe('speaker');
  });

  it('multiple moderators are sorted by seatIndex ascending', () => {
    const speakers: SpeakerSlot[] = [
      makeSpeaker({ userId: 'o', seatIndex: 0, role: 'owner' }),
      makeSpeaker({ userId: 'm3', seatIndex: 30, role: 'moderator' }),
      makeSpeaker({ userId: 'm1', seatIndex: 10, role: 'moderator' }),
      makeSpeaker({ userId: 'm2', seatIndex: 20, role: 'moderator' }),
    ];
    const sorted = sortSpeakers(speakers, null);
    expect(sorted[1].userId).toBe('m1');
    expect(sorted[2].userId).toBe('m2');
    expect(sorted[3].userId).toBe('m3');
  });
});

// ---------------------------------------------------------------------------
// Active speakers (isSpeaking && !isMuted) promoted over muted
// ---------------------------------------------------------------------------
describe('sortSpeakers — active speakers before muted', () => {
  it('speaking unmuted speaker comes before muted speaker', () => {
    const speakers: SpeakerSlot[] = [
      makeSpeaker({ userId: 'o', seatIndex: 0, role: 'owner' }),
      makeSpeaker({ userId: 'muted', seatIndex: 1, role: 'speaker', isMuted: true, isSpeaking: false }),
      makeSpeaker({ userId: 'active', seatIndex: 2, role: 'speaker', isMuted: false, isSpeaking: true }),
    ];
    const sorted = sortSpeakers(speakers, null);
    const activeIdx = sorted.findIndex(s => s.userId === 'active');
    const mutedIdx = sorted.findIndex(s => s.userId === 'muted');
    expect(activeIdx).toBeLessThan(mutedIdx);
  });

  it('muted speaker who is "speaking" is not considered active', () => {
    // isMuted=true means they cannot be an active speaker regardless of isSpeaking
    const speakers: SpeakerSlot[] = [
      makeSpeaker({ userId: 'o', seatIndex: 0, role: 'owner' }),
      makeSpeaker({ userId: 'unmuted_quiet', seatIndex: 1, role: 'speaker', isMuted: false, isSpeaking: false }),
      makeSpeaker({ userId: 'muted_speaking', seatIndex: 2, role: 'speaker', isMuted: true, isSpeaking: true }),
    ];
    const sorted = sortSpeakers(speakers, null);
    // Both are in the "rest" category — the rank for muted_speaking (isMuted=true) = 3
    // unmuted_quiet (isSpeaking=false) rank = 3, both same rank, stable by seatIndex
    const unmutedIdx = sorted.findIndex(s => s.userId === 'unmuted_quiet');
    const mutedIdx = sorted.findIndex(s => s.userId === 'muted_speaking');
    expect(unmutedIdx).toBeLessThan(mutedIdx); // seatIndex 1 < 2
  });

  it('complete sort order: owner → moderator → active → muted', () => {
    const speakers: SpeakerSlot[] = [
      makeSpeaker({ userId: 'muted1', seatIndex: 4, role: 'speaker', isMuted: true }),
      makeSpeaker({ userId: 'active1', seatIndex: 3, role: 'speaker', isSpeaking: true, isMuted: false }),
      makeSpeaker({ userId: 'mod1', seatIndex: 2, role: 'moderator' }),
      makeSpeaker({ userId: 'owner1', seatIndex: 1, role: 'owner' }),
    ];
    const sorted = sortSpeakers(speakers, null);
    expect(sorted[0].role).toBe('owner');
    expect(sorted[1].role).toBe('moderator');
    expect(sorted[2].userId).toBe('active1');
    expect(sorted[3].userId).toBe('muted1');
  });
});

// ---------------------------------------------------------------------------
// Empty array
// ---------------------------------------------------------------------------
describe('sortSpeakers — edge cases', () => {
  it('empty array returns empty array', () => {
    expect(sortSpeakers([], null)).toEqual([]);
  });

  it('single speaker returns that speaker', () => {
    const s = makeSpeaker({ userId: 'solo', seatIndex: 0, role: 'speaker' });
    expect(sortSpeakers([s], null)).toEqual([s]);
  });
});

// ---------------------------------------------------------------------------
// Pinned speaker at index 1
// ---------------------------------------------------------------------------
describe('sortSpeakers — pinnedUserId at index 1', () => {
  it('pinned speaker is moved to index 1 after the owner', () => {
    const speakers: SpeakerSlot[] = [
      makeSpeaker({ userId: 'owner', seatIndex: 0, role: 'owner' }),
      makeSpeaker({ userId: 'mod', seatIndex: 1, role: 'moderator' }),
      makeSpeaker({ userId: 'pinned', seatIndex: 2, role: 'speaker', isMuted: true }),
      makeSpeaker({ userId: 'other', seatIndex: 3, role: 'speaker', isMuted: true }),
    ];
    const sorted = sortSpeakers(speakers, 'pinned');
    expect(sorted[0].userId).toBe('owner');
    expect(sorted[1].userId).toBe('pinned');
  });

  it('pinned moderator is still moved to index 1 (overrides natural moderator order)', () => {
    const speakers: SpeakerSlot[] = [
      makeSpeaker({ userId: 'owner', seatIndex: 0, role: 'owner' }),
      makeSpeaker({ userId: 'mod1', seatIndex: 1, role: 'moderator' }),
      makeSpeaker({ userId: 'mod2', seatIndex: 2, role: 'moderator' }),
    ];
    // pin mod2 which would naturally be at index 2
    const sorted = sortSpeakers(speakers, 'mod2');
    expect(sorted[0].userId).toBe('owner');
    expect(sorted[1].userId).toBe('mod2');
  });

  it('null pinnedUserId applies no pin', () => {
    const speakers: SpeakerSlot[] = [
      makeSpeaker({ userId: 'owner', seatIndex: 0, role: 'owner' }),
      makeSpeaker({ userId: 'mod', seatIndex: 1, role: 'moderator' }),
      makeSpeaker({ userId: 'sp', seatIndex: 2, role: 'speaker' }),
    ];
    const sorted = sortSpeakers(speakers, null);
    expect(sorted[0].userId).toBe('owner');
    expect(sorted[1].userId).toBe('mod');
    expect(sorted[2].userId).toBe('sp');
  });

  it('pinnedUserId not found in array has no effect', () => {
    const speakers: SpeakerSlot[] = [
      makeSpeaker({ userId: 'owner', seatIndex: 0, role: 'owner' }),
      makeSpeaker({ userId: 'sp', seatIndex: 1, role: 'speaker' }),
    ];
    const sorted = sortSpeakers(speakers, 'nonexistent');
    expect(sorted[0].userId).toBe('owner');
    expect(sorted[1].userId).toBe('sp');
  });

  it('pinning the owner (index 0) has no effect — already at index 0', () => {
    const speakers: SpeakerSlot[] = [
      makeSpeaker({ userId: 'owner', seatIndex: 0, role: 'owner' }),
      makeSpeaker({ userId: 'sp', seatIndex: 1, role: 'speaker' }),
    ];
    const sorted = sortSpeakers(speakers, 'owner');
    // owner is at index 0; pinnedIdx=0, condition pinnedIdx > 1 is false → no move
    expect(sorted[0].userId).toBe('owner');
  });
});
