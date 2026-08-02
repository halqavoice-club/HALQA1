'use client'

/**
 * HALQA — Voice Club Offline Event Buffer (Phase 6)
 *
 * When the network drops briefly, DO NOT immediately leave the room.
 * Instead buffer critical events (emoji reactions, hand raises, chat messages)
 * and replay them when the connection returns.
 *
 * Handles:
 *   - Deduplication (idempotency keys)
 *   - Max buffer size (prevents memory buildup on long outages)
 *   - TTL per event type (stale events are discarded)
 *   - Priority ordering (hand raises > chat > reactions)
 *
 * ADDITIVE ONLY — does not change any existing socket event names or payloads.
 */

export type BufferedEventType = 'voice:reaction' | 'voice:message' | 'voice:queue:raise' | 'voice:queue:cancel'

interface BufferedEvent {
  id: string           // idempotency key
  type: BufferedEventType
  payload: any
  queuedAt: number     // Date.now()
  ttlMs: number        // discard if older than this
  priority: number     // lower = higher priority
}

// TTL per event type
const EVENT_TTL: Record<BufferedEventType, number> = {
  'voice:queue:raise':  60_000,  // hand raise — keep for 60s
  'voice:queue:cancel': 60_000,
  'voice:message':      30_000,  // chat — keep for 30s
  'voice:reaction':      5_000,  // emoji — 5s (stale reactions are useless)
}

// Priority (lower = send first after reconnect)
const EVENT_PRIORITY: Record<BufferedEventType, number> = {
  'voice:queue:raise':  1,
  'voice:queue:cancel': 1,
  'voice:message':      2,
  'voice:reaction':     3,
}

const MAX_BUFFER_SIZE = 50  // cap to avoid memory buildup

class VoiceOfflineBuffer {
  private buffer: BufferedEvent[] = []
  private flushCallbacks: Array<(event: BufferedEvent) => void> = []

  /** Add event to buffer. Returns false if buffer is full or event is duplicate. */
  enqueue(type: BufferedEventType, payload: any, idKey?: string): boolean {
    const id = idKey ?? `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Dedup
    if (this.buffer.find(e => e.id === id)) return false

    // Cap size — drop lowest-priority oldest events
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      const idx = this.buffer.reduce((worst, e, i) =>
        e.priority >= this.buffer[worst].priority && e.queuedAt <= this.buffer[worst].queuedAt ? i : worst, 0)
      this.buffer.splice(idx, 1)
    }

    this.buffer.push({
      id,
      type,
      payload,
      queuedAt:  Date.now(),
      ttlMs:     EVENT_TTL[type],
      priority:  EVENT_PRIORITY[type],
    })

    return true
  }

  /**
   * Flush all non-expired events in priority order.
   * Called when connection is restored.
   * @param sender Function that sends one event (returns true if sent successfully)
   */
  async flush(sender: (event: BufferedEvent) => Promise<boolean>): Promise<number> {
    const now = Date.now()
    // Remove expired events
    this.buffer = this.buffer.filter(e => (now - e.queuedAt) < e.ttlMs)

    // Sort by priority, then queuedAt
    const toSend = [...this.buffer].sort((a, b) =>
      a.priority !== b.priority ? a.priority - b.priority : a.queuedAt - b.queuedAt
    )

    let sent = 0
    for (const event of toSend) {
      try {
        const ok = await sender(event)
        if (ok) {
          this.buffer = this.buffer.filter(e => e.id !== event.id)
          sent++
        }
      } catch {
        break // network still down — stop trying
      }
    }
    return sent
  }

  /** How many events are pending */
  get size(): number { return this.buffer.length }

  /** Clear all buffered events */
  clear(): void { this.buffer = [] }

  /** Pending event types summary for debug */
  summary(): string {
    const counts: Record<string, number> = {}
    this.buffer.forEach(e => { counts[e.type] = (counts[e.type] ?? 0) + 1 })
    return Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(', ')
  }
}

// Singleton — one buffer per browser tab / app instance
export const voiceOfflineBuffer = new VoiceOfflineBuffer()
