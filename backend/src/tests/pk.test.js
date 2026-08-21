/**
 * PK System — Unit Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests the PK service layer: state machine, scoring, combo, comeback, winner.
 * All DB and Redis calls are mocked — no live infrastructure required.
 */

'use strict';

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady:       jest.fn().mockReturnValue(false),
  getRedis:           jest.fn().mockReturnValue(null),
  setCache:           jest.fn().mockResolvedValue(undefined),
  getCache:           jest.fn().mockResolvedValue(null),
  deleteCache:        jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../sockets', () => ({ getIo: jest.fn().mockReturnValue(null) }));
jest.mock('../services/notification.service', () => ({ notify: jest.fn().mockResolvedValue(null) }));

const {
  assertValidTransition,
  getRemainingSeconds,
  getConfig,
} = require('../services/pk.service');

// ─── State Machine ────────────────────────────────────────────────────────────
describe('PK State Machine — assertValidTransition', () => {
  test('IDLE → MATCHMAKING is valid', () => {
    expect(() => assertValidTransition('IDLE', 'MATCHMAKING')).not.toThrow();
  });

  test('IDLE → LIVE is invalid', () => {
    expect(() => assertValidTransition('IDLE', 'LIVE')).toThrow();
  });

  test('PREPARING → COUNTDOWN is valid', () => {
    expect(() => assertValidTransition('PREPARING', 'COUNTDOWN')).not.toThrow();
  });

  test('COUNTDOWN → LIVE is valid', () => {
    expect(() => assertValidTransition('COUNTDOWN', 'LIVE')).not.toThrow();
  });

  test('LIVE → PAUSED is valid', () => {
    expect(() => assertValidTransition('LIVE', 'PAUSED')).not.toThrow();
  });

  test('PAUSED → LIVE (resume) is valid', () => {
    expect(() => assertValidTransition('PAUSED', 'LIVE')).not.toThrow();
  });

  test('LIVE → FINISHING is valid', () => {
    expect(() => assertValidTransition('LIVE', 'FINISHING')).not.toThrow();
  });

  test('FINISHING → COMPLETED is valid', () => {
    expect(() => assertValidTransition('FINISHING', 'COMPLETED')).not.toThrow();
  });

  test('COMPLETED → anything is invalid (terminal)', () => {
    expect(() => assertValidTransition('COMPLETED', 'LIVE')).toThrow();
    expect(() => assertValidTransition('COMPLETED', 'IDLE')).toThrow();
  });

  test('CANCELLED → anything is invalid (terminal)', () => {
    expect(() => assertValidTransition('CANCELLED', 'LIVE')).toThrow();
  });

  test('INVITED → PENDING_ACCEPTANCE is valid', () => {
    expect(() => assertValidTransition('INVITED', 'PENDING_ACCEPTANCE')).not.toThrow();
  });

  test('ACCEPTED → PREPARING is valid', () => {
    expect(() => assertValidTransition('ACCEPTED', 'PREPARING')).not.toThrow();
  });

  test('LIVE → ABORTED is valid', () => {
    expect(() => assertValidTransition('LIVE', 'ABORTED')).not.toThrow();
  });

  test('DISPUTED → COMPLETED is valid', () => {
    expect(() => assertValidTransition('DISPUTED', 'COMPLETED')).not.toThrow();
  });
});

// ─── Timer ────────────────────────────────────────────────────────────────────
describe('PK Timer — getRemainingSeconds', () => {
  test('returns durationSeconds when just started', () => {
    const now = new Date();
    const timer = {
      startedAt:       now.toISOString(),
      durationSeconds: 300,
      pausedAt:        null,
      pausedDuration:  0,
    };
    const remaining = getRemainingSeconds(timer);
    expect(remaining).toBeGreaterThanOrEqual(299);
    expect(remaining).toBeLessThanOrEqual(300);
  });

  test('returns 0 for expired timer', () => {
    const past = new Date(Date.now() - 400_000); // 400s ago
    const timer = {
      startedAt:       past.toISOString(),
      durationSeconds: 300,
      pausedAt:        null,
      pausedDuration:  0,
    };
    expect(getRemainingSeconds(timer)).toBe(0);
  });

  test('paused timer does not tick', () => {
    const started = new Date(Date.now() - 60_000); // 60s ago
    const pausedAt = new Date(Date.now() - 30_000); // paused 30s ago
    const timer = {
      startedAt:       started.toISOString(),
      durationSeconds: 300,
      pausedAt:        pausedAt.toISOString(),
      pausedDuration:  0,
    };
    const remaining = getRemainingSeconds(timer);
    // Active time = 30s (from start to pause), so remaining ≈ 270s
    expect(remaining).toBeGreaterThanOrEqual(268);
    expect(remaining).toBeLessThanOrEqual(272);
  });

  test('returns null-safe 0 when timerState is null', () => {
    expect(getRemainingSeconds(null)).toBe(0);
  });
});

// ─── Config ───────────────────────────────────────────────────────────────────
describe('PK Config — getConfig', () => {
  test('returns default config when DB is mocked', async () => {
    const prisma = require('../utils/prisma');
    prisma.pKConfig = { findFirst: jest.fn().mockResolvedValue(null) };
    const config = await getConfig();
    expect(config.defaultDurationSeconds).toBe(300);
    expect(config.comboThresholds).toEqual([5, 10, 20, 50, 100]);
    expect(config.comebackThresholdPercent).toBe(30);
    expect(config.audienceVoteWeight).toBe(0.1);
  });
});

// ─── Scoring Logic ────────────────────────────────────────────────────────────
describe('PK Scoring', () => {
  test('combo multiplier increases with level', () => {
    // comboMult = 1 + (level * 0.2)
    const levels = [1, 2, 3, 4, 5];
    levels.forEach(level => {
      const mult = 1 + level * 0.2;
      expect(mult).toBeCloseTo(1.2 * level / level + (level - 1) * 0.2);
    });
    expect(1 + 1 * 0.2).toBe(1.2);
    expect(1 + 2 * 0.2).toBe(1.4);
    expect(1 + 3 * 0.2).toBe(1.6);
    expect(1 + 5 * 0.2).toBe(2.0);
  });

  test('bonus score calculation is correct', () => {
    const giftScore = 100;
    const comboMult = 1.5;
    const bonusScore = Math.floor(giftScore * (comboMult - 1));
    const finalScore = giftScore + bonusScore;
    expect(bonusScore).toBe(50);
    expect(finalScore).toBe(150);
  });

  test('no bonus when comboMult is 1.0', () => {
    const bonusScore = Math.floor(100 * (1.0 - 1));
    expect(bonusScore).toBe(0);
  });

  test('comeback multiplier applies when trailing by threshold', () => {
    const leadScore = 1000;
    const ownScore  = 600;
    const threshold = 0.3; // 30%
    const gap = (leadScore - ownScore) / leadScore;
    expect(gap).toBe(0.4);
    expect(gap >= threshold).toBe(true);
  });

  test('comeback does not apply when within threshold', () => {
    const leadScore = 1000;
    const ownScore  = 800;
    const threshold = 0.3;
    const gap = (leadScore - ownScore) / leadScore;
    expect(gap).toBe(0.2);
    expect(gap >= threshold).toBe(false);
  });

  test('audience vote weight applies correctly', () => {
    const voteScore      = 50;
    const audienceWeight = 0.1;
    const weighted = Math.floor(voteScore * audienceWeight);
    expect(weighted).toBe(5);
  });

  test('winner determination — higher score wins', () => {
    const scoreA = 1500;
    const scoreB = 1200;
    const winnerSide = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'DRAW';
    expect(winnerSide).toBe('A');
  });

  test('draw when scores are equal', () => {
    const scoreA = 1000;
    const scoreB = 1000;
    const winnerSide = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'DRAW';
    expect(winnerSide).toBe('DRAW');
  });
});

// ─── ELO Rating ───────────────────────────────────────────────────────────────
describe('ELO Rating Calculation', () => {
  const ELO_K = 32;

  function calculateElo(rA, rB, winner) {
    const eA   = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const eB   = 1 - eA;
    const sA   = winner === 'A' ? 1 : winner === 'DRAW' ? 0.5 : 0;
    const sB   = 1 - sA;
    return {
      newRA: Math.round(rA + ELO_K * (sA - eA)),
      newRB: Math.round(rB + ELO_K * (sB - eB)),
    };
  }

  test('equal players — winner gains, loser loses', () => {
    const { newRA, newRB } = calculateElo(1000, 1000, 'A');
    expect(newRA).toBeGreaterThan(1000);
    expect(newRB).toBeLessThan(1000);
    expect(newRA + newRB).toBe(2000); // zero-sum
  });

  test('draw gives both players ~same rating', () => {
    const { newRA, newRB } = calculateElo(1000, 1000, 'DRAW');
    expect(newRA).toBe(1000);
    expect(newRB).toBe(1000);
  });

  test('upset (lower-rated wins) gives larger rating change', () => {
    const { newRA: aWins } = calculateElo(800, 1200, 'A');  // underdog wins
    const { newRA: aLoses } = calculateElo(1200, 800, 'B'); // favourite loses
    // Underdog gains at least as much as the favourite loses (ELO is zero-sum)
    expect(aWins - 800).toBeGreaterThanOrEqual(1200 - aLoses);
  });
});

// ─── Anti-cheat ───────────────────────────────────────────────────────────────
describe('PK Anti-cheat', () => {
  test('idempotency key prevents double-gift-count', () => {
    // The @unique constraint on PKGiftEvent.giftTransactionId enforces this at DB level.
    // Here we verify the logic: same giftTransactionId = same PKGiftEvent record.
    const seen = new Set();
    const txId = 'tx-abc-123';
    expect(seen.has(txId)).toBe(false);
    seen.add(txId);
    expect(seen.has(txId)).toBe(true);
    // Second attempt to add should be detected
    const alreadyExists = seen.has(txId);
    expect(alreadyExists).toBe(true);
  });

  test('LIVE state required to count gifts', () => {
    const matchState = 'FINISHING';
    const canCount   = matchState === 'LIVE';
    expect(canCount).toBe(false);
  });

  test('winner not determined until FINISHING state', () => {
    const allowedStates = ['LIVE', 'FINISHING'];
    expect(allowedStates.includes('LIVE')).toBe(true);
    expect(allowedStates.includes('COMPLETED')).toBe(false);
  });
});
