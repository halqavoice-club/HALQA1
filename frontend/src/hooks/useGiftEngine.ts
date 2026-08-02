'use client'

/**
 * useGiftEngine.ts — Universal Gift Engine hook
 *
 * Reusable across all live products. Supply a RoomGiftAdapter and get back
 * sendGift / sendGiftToAll wired to the correct endpoints + socket room.
 *
 * Subscribes to the universal `gift:sent` event as well as backward-compat
 * room-type aliases (voice:gift_sent, liveclass:gift_sent).
 */

import { useEffect, useCallback } from 'react'
import { useVoiceStore, type GiftEvent } from '@/store/voice.store'
import type { RoomGiftAdapter } from '@/lib/giftAdapter'
import api from '@/lib/api'
import { getSocket } from '@/lib/socket'

// ─── Low-end device detection ─────────────────────────────────────────────────
function isLowEndDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const cores   = (navigator as any).hardwareConcurrency ?? 4
  const memory  = (navigator as any).deviceMemory ?? 4
  return cores <= 2 || memory <= 2
}

export function useIsLowEndDevice(): boolean {
  return isLowEndDevice()
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseGiftEngineOptions {
  adapter:     RoomGiftAdapter
  onGiftSent?: (event: GiftEvent) => void
}

export function useGiftEngine({ adapter, onGiftSent }: UseGiftEngineOptions) {
  const {
    wallet,
    addGiftEvent,
    deductCoins,
    isGiftPanelOpen,
    toggleGiftPanel,
  } = useVoiceStore()

  // ── Subscribe to gift socket events ────────────────────────────────────
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    // Normalize event to match GiftEvent interface expected by GiftOverlay
    const handler = (raw: any) => {
      const event: GiftEvent = {
        id:          raw.id ?? raw.transactionId ?? `gift-${Date.now()}`,
        roomId:      raw.roomId,
        sender:      raw.sender,
        receiver:    raw.receiver,
        receivers:   raw.receivers,
        isAllStage:  !!raw.receivers?.length,
        receiverCount: raw.receiverCount ?? raw.receivers?.length ?? 1,
        gift:        raw.gift,
        count:       raw.count ?? 1,
        combo:       raw.combo ?? 1,
        coinsSpent:  raw.coinsSpent ?? 0,
        diamondsEarned: raw.diamondsEarned ?? 0,
        priority:    raw.priority ?? 'normal',
        isPremium:   raw.isPremium ?? false,
        holdMs:      raw.holdMs ?? 0,
        timestamp:   raw.timestamp ?? Date.now(),
      }
      addGiftEvent(event)
      onGiftSent?.(event)
    }

    // Universal event (all room types)
    socket.on('gift:sent',           handler)
    socket.on('gift:all',            handler)
    // Room-type-specific aliases (backward compat)
    socket.on('voice:gift_sent',     handler)
    socket.on('liveclass:gift_sent', handler)

    return () => {
      socket.off('gift:sent',           handler)
      socket.off('gift:all',            handler)
      socket.off('voice:gift_sent',     handler)
      socket.off('liveclass:gift_sent', handler)
    }
  }, [adapter.socketRoom, addGiftEvent, onGiftSent])

  // ── sendGift — single recipient ─────────────────────────────────────────
  const sendGift = useCallback(
    async (giftId: string, receiverId: string, count: number, key: string) => {
      try {
        const res = await api.post(adapter.sendUrl, {
          giftId,
          receiverId,
          count,
          idempotencyKey: key,
        })
        const data = res.data?.data
        if (data?.coinsSpentTotal) deductCoins(data.coinsSpentTotal)
        else if (data?.coinsSpent) deductCoins(data.coinsSpent)
        return res
      } catch (err: any) {
        const msg = err?.response?.data?.message || 'Failed to send gift'
        throw new Error(msg)
      }
    },
    [adapter.sendUrl, deductCoins],
  )

  // ── sendGiftToAll — all-stage ───────────────────────────────────────────
  const sendGiftToAll = useCallback(
    async (giftId: string, count: number, key: string) => {
      try {
        const res = await api.post(adapter.sendAllUrl, {
          giftId,
          count,
          idempotencyKey: key,
        })
        const data = res.data?.data
        if (data?.totalCoinsSpent) deductCoins(data.totalCoinsSpent)
        return res
      } catch (err: any) {
        const msg = err?.response?.data?.message || 'Failed to send gift to all'
        throw new Error(msg)
      }
    },
    [adapter.sendAllUrl, deductCoins],
  )

  return {
    sendGift,
    sendGiftToAll,
    wallet,
    isGiftPanelOpen,
    toggleGiftPanel,
    isLowEndDevice: isLowEndDevice(),
    adapter,
  }
}
