/**
 * mediaUtils.ts — Media grid layout resolution
 *
 * resolveMediaLayout() determines the CSS grid layout type for a post's
 * media attachments based on how many items there are.
 *
 * Layout rules:
 *   1 item  → single        (full-width 16:9)
 *   2 items → sideBySide    (50/50 side-by-side, 1:1 each)
 *   3 items → leftPlusStack (left column full-height + right column 2 stacked)
 *   4+      → mosaic        (2×2 grid, first 4 shown, rest behind +N overlay)
 *
 * Requirements: 1.10–1.13
 */

import type { PostMedia } from '@/lib/posts'

// PostMedia is the canonical MediaItem shape used throughout the project
export type MediaItem = PostMedia

export type MediaLayoutType = 'single' | 'sideBySide' | 'leftPlusStack' | 'mosaic'

export interface MediaLayoutResult {
  /** Which CSS layout variant to apply */
  type: MediaLayoutType
  /** The media items to display — at most 4 */
  items: MediaItem[]
  /** Number of items hidden behind the +N overlay (mosaic only; 0 otherwise) */
  overflow: number
}

/**
 * Resolve which CSS grid layout to use for a media attachment array.
 *
 * Preconditions:  media.length >= 1
 * Postconditions:
 *   - Returns one of the four layout types ('single' | 'sideBySide' | 'leftPlusStack' | 'mosaic')
 *   - items contains at most 4 elements
 *   - overflow >= 0 (non-zero only for mosaic when input has > 4 items)
 *   - No mutations to the input array
 */
export function resolveMediaLayout(media: MediaItem[]): MediaLayoutResult {
  const count = media.length

  if (count === 1) {
    return {
      type: 'single',
      items: [media[0]],
      overflow: 0,
    }
  }

  if (count === 2) {
    return {
      type: 'sideBySide',
      items: [media[0], media[1]],
      overflow: 0,
    }
  }

  if (count === 3) {
    return {
      type: 'leftPlusStack',
      items: [media[0], media[1], media[2]],
      overflow: 0,
    }
  }

  // count >= 4: mosaic — display the first 4 items, hide the rest behind +N overlay
  const displayed = media.slice(0, 4)
  const overflow = count - 4 // >= 0; equals 0 when count is exactly 4

  return {
    type: 'mosaic',
    items: displayed,
    overflow,
  }
}
