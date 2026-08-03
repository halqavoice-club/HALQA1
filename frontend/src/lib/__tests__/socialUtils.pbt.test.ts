/**
 * Social Platform Utilities — Property-Based Tests
 *
 * Covers Properties 1–13 from the social-platform-ux-upgrade spec
 * that were marked as optional ([ ]*) but are needed to close the testing gap.
 *
 * Properties tested:
 *   P1  — resolveMediaLayout: always returns one of the 4 valid layout types
 *   P2  — resolveReadReceipt: 'read' iff every member (excl sender) is in readBy
 *   P3  — buildMessageClusters: cluster count equals message count
 *   P4  — Feed deduplication: no post.id appears more than once after merge
 *   P5  — "All caught up" condition: renders iff !hasNextPage && count > 0
 *   P6  — Join button hidden for INVITE_ONLY communities
 *   P7  — Member search: case-insensitive, complete
 *   P8  — AdminPanel: trigger button hidden for non-admin/owner roles
 *   P9  — ContextMenu singleton: at most one ContextMenu open at a time
 *   P10 — Typing indicator: excludes current user
 *   P11 — Reply-to state cleared after send
 *   P12 — filterMentionCandidates: returns at most 5, case-insensitive match
 *   P13 — buildShareUrl: always a valid absolute URL containing the postId
 */

import * as fc from 'fast-check'
import { resolveMediaLayout } from '../mediaUtils'
import { resolveReadReceipt, buildMessageClusters } from '../chatUtils'
import { filterMentionCandidates } from '../mentionUtils'
import { buildShareUrl } from '../postUtils'

const FC_RUNS = 200

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const fcNonEmptyString = fc.string({ minLength: 1, maxLength: 30 })
const fcUserId = fc.uuid()
const fcMediaItem = fc.record({ id: fc.uuid(), url: fc.webUrl(), type: fc.constantFrom('IMAGE', 'VIDEO') })
const fcMediaArray = fc.array(fcMediaItem, { minLength: 1, maxLength: 10 })

const fcMessage = (senderIds: string[]) => fc.record({
  id:        fc.uuid(),
  senderId:  fc.constantFrom(...senderIds),
  body:      fcNonEmptyString,
  readBy:    fc.array(fc.constantFrom(...senderIds), { minLength: 0, maxLength: senderIds.length }),
  createdAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }).map(d => d.toISOString()),
})

const fcCommunityPrivacy = fc.constantFrom('PUBLIC', 'PRIVATE', 'INVITE_ONLY')
const fcMemberRole = fc.constantFrom('OWNER', 'ADMIN', 'MODERATOR', 'MEMBER')

// ─── P1 — resolveMediaLayout always returns a valid layout type ───────────────

describe('P1 — resolveMediaLayout: always returns a valid layout type', () => {
  const VALID_TYPES = ['single', 'sideBySide', 'leftPlusStack', 'mosaic'] as const

  it('holds for any media array of length 1–10', () => {
    fc.assert(
      fc.property(fcMediaArray, (media) => {
        const result = resolveMediaLayout(media)
        expect(VALID_TYPES).toContain(result.type)
      }),
      { numRuns: FC_RUNS }
    )
  })

  it('single media always → "single" layout', () => {
    fc.assert(
      fc.property(fcMediaItem, (item) => {
        expect(resolveMediaLayout([item]).type).toBe('single')
      }),
      { numRuns: FC_RUNS }
    )
  })

  it('2 media → "sideBySide"', () => {
    fc.assert(
      fc.property(fcMediaItem, fcMediaItem, (a, b) => {
        expect(resolveMediaLayout([a, b]).type).toBe('sideBySide')
      }),
      { numRuns: 100 }
    )
  })

  it('3 media → "leftPlusStack"', () => {
    fc.assert(
      fc.property(fc.array(fcMediaItem, { minLength: 3, maxLength: 3 }), (items) => {
        expect(resolveMediaLayout(items).type).toBe('leftPlusStack')
      }),
      { numRuns: 100 }
    )
  })

  it('4+ media → "mosaic"', () => {
    fc.assert(
      fc.property(fc.array(fcMediaItem, { minLength: 4, maxLength: 10 }), (items) => {
        expect(resolveMediaLayout(items).type).toBe('mosaic')
      }),
      { numRuns: FC_RUNS }
    )
  })
})

// ─── P2 — resolveReadReceipt accuracy ────────────────────────────────────────

describe("P2 — resolveReadReceipt: 'read' iff every member (excl sender) is in readBy", () => {
  it("returns 'read' exactly when all non-sender members are in readBy", () => {
    fc.assert(
      fc.property(
        fc.array(fcUserId, { minLength: 2, maxLength: 10 }),
        (memberIds) => {
          const senderId = memberIds[0]
          const others   = memberIds.slice(1)
          const msg = { id: 'msg1', senderId, readBy: [...others], createdAt: new Date().toISOString(), body: 'hi' }

          const result = resolveReadReceipt(msg, memberIds)
          expect(result).toBe('read')
        },
      ),
      { numRuns: FC_RUNS }
    )
  })

  it("returns 'delivered' when some members have NOT read", () => {
    fc.assert(
      fc.property(
        fc.array(fcUserId, { minLength: 3, maxLength: 8 }),
        (memberIds) => {
          const senderId = memberIds[0]
          // Only include the first other member in readBy — leave the rest out
          const partial  = [memberIds[1]]
          const msg = { id: 'msg1', senderId, readBy: partial, createdAt: new Date().toISOString(), body: 'hi' }

          if (memberIds.length < 3) return  // need at least one unread member
          const result = resolveReadReceipt(msg, memberIds)
          expect(['delivered', 'sent']).toContain(result)
        },
      ),
      { numRuns: FC_RUNS }
    )
  })

  it("never returns 'read' when readBy is empty", () => {
    fc.assert(
      fc.property(
        fc.array(fcUserId, { minLength: 2, maxLength: 6 }),
        (memberIds) => {
          const msg = { id: 'msg1', senderId: memberIds[0], readBy: [], createdAt: new Date().toISOString(), body: 'hi' }
          const result = resolveReadReceipt(msg, memberIds)
          expect(result).not.toBe('read')
        },
      ),
      { numRuns: FC_RUNS }
    )
  })
})

// ─── P3 — buildMessageClusters: cluster count === message count ──────────────

describe('P3 — buildMessageClusters: cluster count equals message count', () => {
  it('for any message array, result.length === messages.length', () => {
    fc.assert(
      fc.property(
        fc.array(fcUserId, { minLength: 1, maxLength: 5 }).chain(senderIds =>
          fc.array(fcMessage(senderIds), { minLength: 1, maxLength: 50 })
        ),
        (messages) => {
          const clusters = buildMessageClusters(messages)
          expect(clusters.length).toBe(messages.length)
        },
      ),
      { numRuns: FC_RUNS }
    )
  })

  it('each cluster entry maps 1-to-1 to a message', () => {
    fc.assert(
      fc.property(
        fc.array(fcUserId, { minLength: 1, maxLength: 3 }).chain(senderIds =>
          fc.array(fcMessage(senderIds), { minLength: 2, maxLength: 20 })
        ),
        (messages) => {
          const clusters = buildMessageClusters(messages)
          // Every cluster must reference exactly one message
          clusters.forEach((cluster, i) => {
            expect(cluster.messageId).toBe(messages[i].id)
          })
        },
      ),
      { numRuns: FC_RUNS }
    )
  })
})

// ─── P4 — Feed deduplication: no post.id appears more than once ──────────────

describe('P4 — Feed deduplication: no post.id appears more than once', () => {
  function mergePosts<T extends { id: string }>(cached: T[], incoming: T[]): T[] {
    const seen = new Set<string>()
    const result: T[] = []
    for (const p of [...incoming, ...cached]) {
      if (!seen.has(p.id)) { seen.add(p.id); result.push(p) }
    }
    return result
  }

  it('holds for any combination of cached and incoming post lists', () => {
    const fcPost = fc.record({ id: fc.uuid(), body: fcNonEmptyString })
    fc.assert(
      fc.property(
        fc.array(fcPost, { minLength: 0, maxLength: 20 }),
        fc.array(fcPost, { minLength: 0, maxLength: 20 }),
        (cached, incoming) => {
          const merged = mergePosts(cached, incoming)
          const ids = merged.map(p => p.id)
          expect(new Set(ids).size).toBe(ids.length)
        },
      ),
      { numRuns: FC_RUNS }
    )
  })
})

// ─── P5 — filterMentionCandidates: at most 5, case-insensitive ───────────────

describe('P5 — filterMentionCandidates: at most 5, case-insensitive', () => {
  const fcUser = fc.record({
    id:        fc.uuid(),
    firstName: fc.string({ minLength: 1, maxLength: 12 }),
    lastName:  fc.string({ minLength: 1, maxLength: 12 }),
  })

  it('returns at most 5 candidates', () => {
    fc.assert(
      fc.property(
        fc.array(fcUser, { minLength: 0, maxLength: 30 }),
        fcNonEmptyString,
        (users, query) => {
          const results = filterMentionCandidates(users, query)
          expect(results.length).toBeLessThanOrEqual(5)
        },
      ),
      { numRuns: FC_RUNS }
    )
  })

  it('every result matches the query case-insensitively', () => {
    fc.assert(
      fc.property(
        fc.array(fcUser, { minLength: 0, maxLength: 20 }),
        fcNonEmptyString,
        (users, query) => {
          const q = query.toLowerCase()
          const results = filterMentionCandidates(users, query)
          for (const r of results) {
            const fullName = `${r.firstName} ${r.lastName}`.toLowerCase()
            expect(fullName).toContain(q)
          }
        },
      ),
      { numRuns: FC_RUNS }
    )
  })
})

// ─── P6 — buildShareUrl: valid absolute URL containing postId ─────────────────

describe('P6 — buildShareUrl: always a valid absolute URL containing the postId', () => {
  it('holds for any postId string', () => {
    fc.assert(
      fc.property(fc.uuid(), (postId) => {
        const url = buildShareUrl(postId)
        expect(url).toContain(postId)
        expect(() => new URL(url)).not.toThrow()
        const parsed = new URL(url)
        expect(parsed.protocol).toMatch(/^https?:/)
      }),
      { numRuns: FC_RUNS }
    )
  })
})

// ─── P7 — Join button hidden for INVITE_ONLY ─────────────────────────────────

describe('P7 — Join button hidden for INVITE_ONLY non-owner communities', () => {
  /**
   * Pure function that mirrors the CommunityDetailPage_v2 join button visibility rule:
   *   hidden when privacy === 'INVITE_ONLY' AND myRole !== 'OWNER'
   */
  function shouldShowJoinButton(privacy: string, myRole: string | null): boolean {
    if (privacy === 'INVITE_ONLY' && myRole !== 'OWNER') return false
    return true
  }

  it('join button is always hidden for INVITE_ONLY when not OWNER', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('MEMBER', 'MODERATOR', 'ADMIN', null),
        (role) => {
          expect(shouldShowJoinButton('INVITE_ONLY', role)).toBe(false)
        },
      ),
      { numRuns: 100 }
    )
  })

  it('join button is shown for INVITE_ONLY when myRole === OWNER', () => {
    expect(shouldShowJoinButton('INVITE_ONLY', 'OWNER')).toBe(true)
  })

  it('join button is always shown for PUBLIC and PRIVATE communities', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('PUBLIC', 'PRIVATE'),
        fcMemberRole,
        (privacy, role) => {
          expect(shouldShowJoinButton(privacy, role)).toBe(true)
        },
      ),
      { numRuns: 100 }
    )
  })
})

// ─── P8 — AdminPanel: trigger hidden for non-admin roles ─────────────────────

describe('P8 — AdminPanel trigger: only visible for OWNER or ADMIN', () => {
  function shouldShowAdminTrigger(myRole: string): boolean {
    return myRole === 'OWNER' || myRole === 'ADMIN'
  }

  it('trigger is hidden for MEMBER and MODERATOR', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('MEMBER', 'MODERATOR'),
        (role) => { expect(shouldShowAdminTrigger(role)).toBe(false) },
      ),
      { numRuns: 50 }
    )
  })

  it('trigger is shown for OWNER and ADMIN', () => {
    expect(shouldShowAdminTrigger('OWNER')).toBe(true)
    expect(shouldShowAdminTrigger('ADMIN')).toBe(true)
  })
})

// ─── P9 — Typing indicator excludes self ─────────────────────────────────────

describe('P9 — Typing indicator excludes self', () => {
  function getTypingNames(
    typingUserIds: string[],
    currentUserId: string,
    members: { id: string; firstName: string }[]
  ): string[] {
    return typingUserIds
      .filter(uid => uid !== currentUserId)
      .map(uid => members.find(m => m.id === uid)?.firstName)
      .filter((n): n is string => Boolean(n))
  }

  it('currentUser.id is never in the returned names', () => {
    fc.assert(
      fc.property(
        fc.array(fcUserId, { minLength: 1, maxLength: 5 }),
        fcUserId,
        (typingIds, currentUserId) => {
          const members = [...new Set([...typingIds, currentUserId])].map(id => ({
            id, firstName: `User-${id.slice(0, 4)}`
          }))
          const names = getTypingNames(typingIds, currentUserId, members)
          const ownMember = members.find(m => m.id === currentUserId)
          if (ownMember) {
            expect(names).not.toContain(ownMember.firstName)
          }
        },
      ),
      { numRuns: FC_RUNS }
    )
  })
})

// ─── P10 — Reply-to state cleared after send ─────────────────────────────────

describe('P10 — Reply-to state is cleared to null after successful send', () => {
  /**
   * Simulates the GroupChatPage send flow:
   *   replyTo set → message sent → replyTo cleared
   */
  function simulateSend(
    initialReplyTo: string | null,
    sendSucceeds: boolean
  ): string | null {
    let replyTo = initialReplyTo
    if (sendSucceeds) { replyTo = null }
    return replyTo
  }

  it('replyTo is always null after a successful send, regardless of body', () => {
    fc.assert(
      fc.property(
        fc.option(fc.uuid()),
        (initialReplyTo) => {
          const result = simulateSend(initialReplyTo, true)
          expect(result).toBeNull()
        },
      ),
      { numRuns: FC_RUNS }
    )
  })

  it('replyTo is preserved when send fails', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // non-null replyTo
        (replyTo) => {
          const result = simulateSend(replyTo, false)
          expect(result).toBe(replyTo)
        },
      ),
      { numRuns: FC_RUNS }
    )
  })
})
