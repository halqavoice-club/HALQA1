/**
 * mentionUtils.ts — @mention candidate filtering for PostComposer v2
 *
 * filterMentionCandidates() — returns at most 5 users matching the query
 *
 * Requirements: 4.3–4.6
 */

export interface UserSummary {
  id: string
  firstName: string
  lastName: string
  avatarUrl?: string | null
  username?: string | null
}

/**
 * Filter mention candidates from a user list.
 *
 * Preconditions:  query is the string after '@', may be empty
 *
 * Postconditions:
 *   - If query is empty, returns the first 5 users
 *   - Returns users whose firstName + ' ' + lastName contains query (case-insensitive)
 *   - Returns at most 5 results
 *   - No side effects
 *
 * Loop Invariant: All returned candidates satisfy the filter predicate.
 */
export function filterMentionCandidates(
  query: string,
  users: UserSummary[]
): UserSummary[] {
  const MAX = 5

  if (!query.trim()) {
    // Empty query: return first 5 users
    return users.slice(0, MAX)
  }

  const q = query.toLowerCase()
  const results: UserSummary[] = []

  for (const u of users) {
    if (results.length >= MAX) break
    const fullName = `${u.firstName} ${u.lastName}`.toLowerCase()
    if (fullName.includes(q)) {
      results.push(u)
    }
  }

  return results
}
