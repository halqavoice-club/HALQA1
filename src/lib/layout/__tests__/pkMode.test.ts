/**
 * pkMode.test.ts
 *
 * Unit tests for `buildPKConfig` pure function.
 * Covers Requirements 6.1–6.3 (PK team assignment and format detection).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildPKConfig, computeLayout } from '../computeLayout';
import { generateSpeakers, makeSpeaker, resetSpeakerIndex } from '../layoutTestUtils';
import type { SpeakerSlot } from '../layoutTypes';

beforeEach(() => resetSpeakerIndex(0));

// ---------------------------------------------------------------------------
// teamA / teamB split
// ---------------------------------------------------------------------------
describe('buildPKConfig — team split', () => {
  it('2 speakers → teamA=[0], teamB=[1]', () => {
    const speakers = generateSpeakers(2);
    const config = buildPKConfig(speakers);
    expect(config.teamA).toHaveLength(1);
    expect(config.teamB).toHaveLength(1);
  });

  it('4 speakers → teamA=[0,1], teamB=[2,3]', () => {
    const speakers = generateSpeakers(4);
    const config = buildPKConfig(speakers);
    expect(config.teamA).toHaveLength(2);
    expect(config.teamB).toHaveLength(2);
  });

  it('6 speakers → teamA=[0,1,2], teamB=[3,4,5]', () => {
    const speakers = generateSpeakers(6);
    const config = buildPKConfig(speakers);
    expect(config.teamA).toHaveLength(3);
    expect(config.teamB).toHaveLength(3);
  });

  it('8 speakers → 4 per team', () => {
    const speakers = generateSpeakers(8);
    const config = buildPKConfig(speakers);
    expect(config.teamA).toHaveLength(4);
    expect(config.teamB).toHaveLength(4);
  });

  it('|teamA.length - teamB.length| ≤ 1 for all even counts', () => {
    for (let n = 2; n <= 20; n += 2) {
      resetSpeakerIndex(0);
      const speakers = generateSpeakers(n);
      const config = buildPKConfig(speakers);
      expect(Math.abs(config.teamA.length - config.teamB.length)).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Odd speaker count — teamA gets the extra
// ---------------------------------------------------------------------------
describe('buildPKConfig — odd speaker count', () => {
  it('1 speaker → teamA=[0], teamB=[]', () => {
    const speakers = generateSpeakers(1);
    const config = buildPKConfig(speakers);
    expect(config.teamA).toHaveLength(1);
    expect(config.teamB).toHaveLength(0);
  });

  it('3 speakers → teamA has ceil(3/2)=2, teamB has 1', () => {
    const speakers = generateSpeakers(3);
    const config = buildPKConfig(speakers);
    expect(config.teamA).toHaveLength(2);
    expect(config.teamB).toHaveLength(1);
  });

  it('5 speakers → teamA has 3, teamB has 2', () => {
    const speakers = generateSpeakers(5);
    const config = buildPKConfig(speakers);
    expect(config.teamA).toHaveLength(3);
    expect(config.teamB).toHaveLength(2);
  });

  it('7 speakers → teamA has 4, teamB has 3', () => {
    const speakers = generateSpeakers(7);
    const config = buildPKConfig(speakers);
    expect(config.teamA).toHaveLength(4);
    expect(config.teamB).toHaveLength(3);
  });

  it('for all odd n from 1–19: teamA.length === ceil(n/2)', () => {
    for (let n = 1; n <= 19; n += 2) {
      resetSpeakerIndex(0);
      const speakers = generateSpeakers(n);
      const config = buildPKConfig(speakers);
      expect(config.teamA).toHaveLength(Math.ceil(n / 2));
      expect(config.teamB).toHaveLength(Math.floor(n / 2));
    }
  });
});

// ---------------------------------------------------------------------------
// format detection
// ---------------------------------------------------------------------------
describe('buildPKConfig — format', () => {
  it('1 speaker → format "1v1"', () => {
    expect(buildPKConfig(generateSpeakers(1)).format).toBe('1v1');
  });

  it('2 speakers → format "1v1"', () => {
    expect(buildPKConfig(generateSpeakers(2)).format).toBe('1v1');
  });

  it('3 speakers → teamA=2 → format "2v2"', () => {
    resetSpeakerIndex(0);
    expect(buildPKConfig(generateSpeakers(3)).format).toBe('2v2');
  });

  it('4 speakers → format "2v2"', () => {
    resetSpeakerIndex(0);
    expect(buildPKConfig(generateSpeakers(4)).format).toBe('2v2');
  });

  it('5 speakers → teamA=3 → format "3v3"', () => {
    resetSpeakerIndex(0);
    expect(buildPKConfig(generateSpeakers(5)).format).toBe('3v3');
  });

  it('6 speakers → format "3v3"', () => {
    resetSpeakerIndex(0);
    expect(buildPKConfig(generateSpeakers(6)).format).toBe('3v3');
  });

  it('7 speakers → teamA=4 → format "club"', () => {
    resetSpeakerIndex(0);
    expect(buildPKConfig(generateSpeakers(7)).format).toBe('club');
  });

  it('8 speakers → format "club"', () => {
    resetSpeakerIndex(0);
    expect(buildPKConfig(generateSpeakers(8)).format).toBe('club');
  });

  it('20 speakers → format "club"', () => {
    resetSpeakerIndex(0);
    expect(buildPKConfig(generateSpeakers(20)).format).toBe('club');
  });
});

// ---------------------------------------------------------------------------
// computeLayout in pk mode
// ---------------------------------------------------------------------------
describe('computeLayout pk mode — pkConfig is present', () => {
  it('pk mode produces a pkConfig object', () => {
    const speakers = generateSpeakers(4);
    const result = computeLayout(speakers, 'pk');
    expect(result.pkConfig).toBeDefined();
  });

  it('non-pk mode does not produce pkConfig', () => {
    const speakers = generateSpeakers(4);
    const result = computeLayout(speakers, 'auto');
    expect(result.pkConfig).toBeUndefined();
  });

  it('pk mode: teamA + teamB covers all speakers exactly once', () => {
    const speakers = generateSpeakers(6);
    const result = computeLayout(speakers, 'pk');
    const allIds = result.pkConfig!.teamA.map(s => s.userId)
      .concat(result.pkConfig!.teamB.map(s => s.userId));
    expect(new Set(allIds).size).toBe(speakers.length);
  });

  it('pk mode: isManual is true', () => {
    const result = computeLayout(generateSpeakers(4), 'pk');
    expect(result.isManual).toBe(true);
  });

  it('pk mode: mode is "pk"', () => {
    const result = computeLayout(generateSpeakers(4), 'pk');
    expect(result.mode).toBe('pk');
  });
});
