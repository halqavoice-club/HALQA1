/**
 * layoutTestUtils.ts
 *
 * Test infrastructure shared by all property-based and unit tests for the
 * Dynamic Speaker Layout engine.  No runtime / UI deps — pure TS + fast-check.
 */

import * as fc from 'fast-check';
import type {
  SpeakerSlot,
  SeatData,
  LayoutMode,
  SeatRole,
} from './layoutTypes';

// ---------------------------------------------------------------------------
// makeSpeaker — factory with sensible defaults
// ---------------------------------------------------------------------------

let _autoIndex = 0;

/**
 * Returns a fully-populated `SpeakerSlot` with valid defaults.
 * Pass `overrides` to change any subset of fields.
 *
 * @example
 * const host   = makeSpeaker({ role: 'owner', userId: 'u1' });
 * const muted  = makeSpeaker({ isMuted: true });
 */
export function makeSpeaker(overrides?: Partial<SpeakerSlot>): SpeakerSlot {
  const index = _autoIndex++;
  return {
    userId: `user-${index}`,
    seatIndex: index,
    role: 'speaker',
    displayName: `Speaker ${index}`,
    avatarUrl: undefined,
    countryCode: undefined,
    level: 1,
    isVip: false,
    isMuted: false,
    isSpeaking: false,
    isOnline: true,
    connectionQuality: 'good',
    frameUrl: undefined,
    badgeUrl: undefined,
    isVerified: false,
    isLocked: false,
    isReserved: false,
    ...overrides,
  };
}

// Reset the internal counter — useful in `beforeEach` to keep tests deterministic.
export function resetSpeakerIndex(value = 0): void {
  _autoIndex = value;
}

// ---------------------------------------------------------------------------
// generateSpeakers — array factory
// ---------------------------------------------------------------------------

/**
 * Generates an array of `count` SpeakerSlots.
 *
 * When `withOwner` is `true` (the default) the first speaker has
 * `role: 'owner'`; all subsequent speakers have `role: 'speaker'`.
 */
export function generateSpeakers(
  count: number,
  options?: { withOwner?: boolean },
): SpeakerSlot[] {
  const withOwner = options?.withOwner ?? true;
  const speakers: SpeakerSlot[] = [];

  for (let i = 0; i < count; i++) {
    const role: SeatRole = withOwner && i === 0 ? 'owner' : 'speaker';
    speakers.push(
      makeSpeaker({
        userId: `user-${i}`,
        seatIndex: i,
        role,
        displayName: role === 'owner' ? 'Owner' : `Speaker ${i}`,
      }),
    );
  }

  return speakers;
}

// ---------------------------------------------------------------------------
// flattenPages — utility
// ---------------------------------------------------------------------------

/**
 * Flattens a `pages` array (array-of-arrays of SeatData) into a single flat
 * array, preserving page order and intra-page order.
 */
export function flattenPages(pages: SeatData[][]): SeatData[] {
  return pages.reduce<SeatData[]>((acc, page) => acc.concat(page), []);
}

// ---------------------------------------------------------------------------
// fast-check arbitraries
// ---------------------------------------------------------------------------

/** All valid connection quality values */
const connectionQualities = ['excellent', 'good', 'poor', 'unknown'] as const;

/** All valid layout modes */
const layoutModes: LayoutMode[] = [
  'auto',
  'grid',
  'focus-host',
  'podcast',
  'classroom',
  'pk',
  'compact',
  'minimal',
];

/**
 * Arbitrary that generates a valid `SpeakerSlot`.
 *
 * Roles are restricted to non-empty seat roles so the slot represents a real
 * participant (not a padding slot).  The `userId` and `seatIndex` are kept
 * unique within a single draw by using integer seeds.
 */
export const fcSpeakerSlot: fc.Arbitrary<SpeakerSlot> = fc.record({
  userId: fc.string({ minLength: 1, maxLength: 32 }),
  seatIndex: fc.nat({ max: 999 }),
  role: fc.constantFrom<SeatRole>('owner', 'moderator', 'speaker'),
  displayName: fc.string({ minLength: 1, maxLength: 50 }),
  avatarUrl: fc.option(fc.string({ minLength: 5, maxLength: 30 }), { nil: undefined }),
  countryCode: fc.option(
    fc.stringMatching(/^[A-Z]{2}$/),
    { nil: undefined },
  ),
  level: fc.option(fc.nat({ max: 100 }), { nil: undefined }),
  isVip: fc.option(fc.boolean(), { nil: undefined }),
  isMuted: fc.boolean(),
  isSpeaking: fc.boolean(),
  isOnline: fc.boolean(),
  connectionQuality: fc.constantFrom(...connectionQualities),
  frameUrl: fc.constant(undefined),
  badgeUrl: fc.constant(undefined),
  isVerified: fc.option(fc.boolean(), { nil: undefined }),
  isLocked: fc.option(fc.boolean(), { nil: undefined }),
  isReserved: fc.option(fc.boolean(), { nil: undefined }),
});

/**
 * Arbitrary that generates an array of `SpeakerSlot`s with:
 * - 1 to 50 entries (covers all grid sizes and pagination)
 * - Unique `userId` values (no duplicates)
 * - Unique `seatIndex` values (no seat collisions)
 * - Exactly one `owner` in the first position
 *
 * This is the primary input arbitrary used by almost all property tests.
 * NOTE: fc.webUrl() is intentionally omitted from avatarUrl/frameUrl/badgeUrl
 * as it is extremely slow to generate. Tests that need URL fields use
 * fc.option(fc.string(), { nil: undefined }) instead.
 */
export const fcSpeakersArray: fc.Arbitrary<SpeakerSlot[]> = fc
  .integer({ min: 1, max: 50 })
  .chain((count) =>
    fc
      .uniqueArray(
        fc.record({
          userId: fc.string({ minLength: 1, maxLength: 16 }),
          seatIndex: fc.nat({ max: 999 }),
          role: fc.constantFrom<SeatRole>('moderator', 'speaker'),
          displayName: fc.string({ minLength: 1, maxLength: 20 }),
          avatarUrl: fc.option(fc.string({ minLength: 5, maxLength: 30 }), { nil: undefined }),
          countryCode: fc.option(
            fc.stringMatching(/^[A-Z]{2}$/),
            { nil: undefined },
          ),
          level: fc.option(fc.nat({ max: 100 }), { nil: undefined }),
          isVip: fc.option(fc.boolean(), { nil: undefined }),
          isMuted: fc.boolean(),
          isSpeaking: fc.boolean(),
          isOnline: fc.boolean(),
          connectionQuality: fc.constantFrom(...connectionQualities),
          frameUrl: fc.constant(undefined),
          badgeUrl: fc.constant(undefined),
          isVerified: fc.option(fc.boolean(), { nil: undefined }),
          isLocked: fc.option(fc.boolean(), { nil: undefined }),
          isReserved: fc.option(fc.boolean(), { nil: undefined }),
        }),
        { minLength: count - 1, maxLength: count - 1, selector: (s) => s.userId },
      )
      .map<SpeakerSlot[]>((rest) => {
        // Prepend the owner as the first speaker
        const owner: SpeakerSlot = {
          userId: 'owner-0',
          seatIndex: 0,
          role: 'owner',
          displayName: 'Owner',
          isMuted: false,
          isSpeaking: false,
          isOnline: true,
          connectionQuality: 'good',
        };
        // Re-index seatIndex so there are no collisions with the owner's index
        const nonOwner = rest.map((s, i) => ({
          ...s,
          seatIndex: i + 1,
          userId: s.userId === 'owner-0' ? `speaker-${i + 1}` : s.userId,
        }));
        return [owner, ...nonOwner];
      }),
  );

/**
 * Arbitrary that generates any valid `LayoutMode` value.
 */
export const fcLayoutMode: fc.Arbitrary<LayoutMode> =
  fc.constantFrom(...layoutModes);
