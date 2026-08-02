/**
 * chatUtils.ts — Group Chat pure utility functions
 *
 * resolveReadReceipt() — determines delivery/read status of a message
 * buildMessageClusters() — groups consecutive messages by sender for avatar clustering
 *
 * Requirements: 8.2, 8.6–8.9
 */

import type { GcMessage } from '@/store/groupChat.store'

export type ReadReceiptStatus = 'sent' | 'delivered' | 'read'

/**
 * Determine the read-receipt status of a sent message.
 *
 * Preconditions:
 *   - msg.senderId exists in conversationMemberIds
 *   - msg.readBy is a valid array (may be empty)
 *
 * Postconditions:
 *   - Returns 'read'      if ALL members (excluding sender) are in msg.readBy
 *   - Returns 'delivered' if AT LEAST ONE member (excluding sender) is in msg.readBy
 *   - Returns 'sent'      otherwise
 *   - No mutations to input parameters
 */
export function resolveReadReceipt(
  msg: GcMessage,
  conversationMemberIds: string[]
): ReadReceiptStatus {
  // Only other members matter — exclude the sender
  const otherMembers = conversationMemberIds.filter(id => id !== msg.senderId)

  if (otherMembers.length === 0) {
    // No other members — treat as delivered (edge case: solo chat)
    return 'delivered'
  }

  const readSet = new Set(msg.readBy ?? [])

  const allRead = otherMembers.every(id => readSet.has(id))
  if (allRead) return 'read'

  const anyRead = otherMembers.some(id => readSet.has(id))
  if (anyRead) return 'delivered'

  return 'sent'
}

// ─── Message Cluster Detection ────────────────────────────────────────────────

export interface MessageCluster {
  msg: GcMessage
  /** True only on the first bubble of each consecutive-same-sender cluster */
  showAvatar: boolean
}

const CLUSTER_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Group consecutive messages by sender within a 5-minute window.
 * Avatar is shown only on the first bubble of each cluster.
 *
 * Postcondition: buildMessageClusters(messages).length === messages.length
 *   (every message maps to exactly one cluster entry)
 */
export function buildMessageClusters(messages: GcMessage[]): MessageCluster[] {
  const result: MessageCluster[] = []
  let prev: GcMessage | null = null

  for (const msg of messages) {
    const isNewCluster =
      prev === null ||
      msg.senderId !== prev.senderId ||
      (new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime()) > CLUSTER_WINDOW_MS

    result.push({ msg, showAvatar: isNewCluster })
    prev = msg
  }

  return result
}
