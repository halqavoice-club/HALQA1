/**
 * postUtils.ts — Pure post helper functions
 *
 * buildShareUrl()   — deterministic shareable URL for a post
 * renderBodyText()  — 3-line / 200-char truncation for "See more" toggle
 *
 * Requirements: 1.2, 3.3
 */

// ─── Share URL ────────────────────────────────────────────────────────────────

/**
 * Build a fully-qualified shareable URL for a post.
 *
 * Preconditions:  postId is a non-empty string (CUID format)
 *
 * Postconditions:
 *   - Returns `${window.location.origin}/feed/post/${postId}` in browser
 *   - Returns `/feed/post/${postId}` (relative) during SSR (window undefined)
 *   - Deterministic: same postId always yields the same URL
 *   - No mutations or side effects
 */
export function buildShareUrl(postId: string): string {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/feed/post/${postId}`
}

// ─── Body Text Truncation ─────────────────────────────────────────────────────

const LINE_LIMIT = 3
const CHAR_LIMIT = 200

/**
 * Return the display text for a post body, truncated when not expanded.
 *
 * Truncation rule (when expanded === false):
 *   Truncate at whichever limit is reached FIRST:
 *     1. The first LINE_LIMIT (3) newlines
 *     2. The first CHAR_LIMIT (200) characters
 *
 * The component is responsible for rendering the "See more" UI — this
 * function does NOT append ellipsis.
 *
 * Preconditions:  body is a string (may be empty)
 *
 * Postconditions:
 *   - renderBodyText(body, true)  === body  (full body returned as-is)
 *   - renderBodyText(body, false).length <= renderBodyText(body, true).length
 *   - No ellipsis appended — caller handles "See more" indicator
 *
 * Loop Invariant: First LINE_LIMIT lines are always displayed when not expanded.
 */
export function renderBodyText(body: string, expanded: boolean): { displayText: string; showToggle: boolean } {
  if (expanded) {
    return { displayText: body, showToggle: false }
  }

  // Find the position of the 3rd newline (0-indexed: we want the char after
  // the 3rd '\n' would be cut, i.e. content up to and including the 3rd line)
  let newlineCount = 0
  let newlineCutIndex = -1

  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\n') {
      newlineCount++
      if (newlineCount >= LINE_LIMIT) {
        newlineCutIndex = i
        break
      }
    }
  }

  // Apply whichever limit is reached first
  let truncated: string
  if (newlineCutIndex !== -1 && newlineCutIndex < CHAR_LIMIT) {
    truncated = body.slice(0, newlineCutIndex)
  } else if (newlineCutIndex === -1) {
    truncated = body.slice(0, CHAR_LIMIT)
  } else {
    truncated = body.slice(0, CHAR_LIMIT)
  }

  const isTruncated = truncated.length < body.length
  return { displayText: truncated, showToggle: isTruncated }
}
