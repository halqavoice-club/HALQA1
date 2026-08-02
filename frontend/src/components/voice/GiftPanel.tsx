'use client'

/**
 * GiftPanel — IMO/Bigo style compact gift panel
 * Layout: fixed bottom sheet ~45vh
 *   • Recipient tabs row (small avatars)
 *   • Category tabs: Hot | Recent | Activity | SVIP
 *   • 4-col gift grid (scrollable)
 *   • Footer bar: avatar + combo selector + Send button
 */

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useVoiceStore, type GiftDef } from '@/store/voice.store'
import { getAvatarUrl } from '@/lib/avatar'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'

const ALL_STAGE_ID = '__ALL__'
const CATEGORIES = ['Hot', 'Recent', 'SVIP', 'Noble'] as const
type Category = typeof CATEGORIES[number]

/** Minimal shape GiftPanel needs from any participant type */
export interface GiftPanelRecipient {
  userId: string
  role:   string
  user: {
    id?:        string
    firstName:  string
    lastName:   string
    avatarUrl:  string | null
  }
}

interface Props {
  receivers:     GiftPanelRecipient[]
  onClose:       () => void
  onSendGift:    (giftId: string, receiverId: string, count: number, key: string) => Promise<any>
  onSendGiftAll: (giftId: string, count: number, key: string) => Promise<any>
}

export function GiftPanel({ receivers, onClose, onSendGift, onSendGiftAll }: Props) {
  const { wallet }  = useVoiceStore()
  const { toast }   = useToast()

  const [gifts,         setGifts]         = useState<GiftDef[]>([])
  const [selectedGift,  setSelectedGift]  = useState<GiftDef | null>(null)
  const [receiverMode,  setReceiverMode]  = useState<string>(ALL_STAGE_ID)
  const [count,         setCount]         = useState(1)
  const [sending,       setSending]       = useState(false)
  const [loadingGifts,  setLoadingGifts]  = useState(true)
  const [category,      setCategory]      = useState<Category>('Hot')

  useEffect(() => {
    if (receivers.length === 1) setReceiverMode(receivers[0].userId)
    else setReceiverMode(ALL_STAGE_ID)
  }, [receivers.length]) // eslint-disable-line

  const loadGifts = useCallback(() => {
    setLoadingGifts(true)
    api.get('/gifts')
      .then(r => {
        const data: GiftDef[] = r.data.data ?? []
        setGifts(data)
        if (data.length > 0) setSelectedGift(data[0])
      })
      .catch(() => {})
      .finally(() => setLoadingGifts(false))
  }, [])

  useEffect(() => { loadGifts() }, []) // eslint-disable-line

  const isAllStage    = receiverMode === ALL_STAGE_ID
  const effectiveCnt  = selectedGift?.comboEnabled ? count : 1
  const receiverCount = isAllStage ? Math.max(receivers.length, 1) : 1
  const totalCost     = (selectedGift?.priceCoins ?? 0) * effectiveCnt * receiverCount
  const canAfford     = (wallet?.coins ?? 0) >= totalCost

  const handleSend = useCallback(async () => {
    if (!selectedGift || sending) return
    if (!canAfford) {
      toast({ title: `Need 🪙 ${totalCost.toLocaleString()} — you have 🪙 ${(wallet?.coins ?? 0).toLocaleString()}`, variant: 'destructive' })
      return
    }
    setSending(true)
    try {
      const sendCount = selectedGift.comboEnabled ? count : 1
      const key = `${Date.now()}-${selectedGift.id}`
      if (isAllStage) {
        await onSendGiftAll(selectedGift.id, sendCount, `all-${key}`)
        toast({ title: `${selectedGift.emoji} Sent to everyone on stage!` })
      } else {
        await onSendGift(selectedGift.id, receiverMode, sendCount, key)
        const target = receivers.find(r => r.userId === receiverMode)
        toast({ title: `${selectedGift.emoji} Sent to ${target?.user.firstName ?? 'recipient'}` })
      }
    } catch (err: any) {
      toast({ title: err?.message || 'Failed to send gift', variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }, [selectedGift, receiverMode, count, canAfford, sending, isAllStage, totalCost, wallet?.coins, receivers, onSendGift, onSendGiftAll]) // eslint-disable-line

  const host     = receivers.find(r => r.role === 'HOST')
  const speakers = receivers.filter(r => r.role !== 'HOST')
  const displayGifts = gifts // all gifts — category is visual only for now

  // Selected receiver display info
  const selectedReceiver = isAllStage ? null : receivers.find(r => r.userId === receiverMode)
  const receiverLabel = isAllStage
    ? `All Stage (${receivers.length})`
    : selectedReceiver ? selectedReceiver.user.firstName : 'Select'

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="gift-panel-backdrop"
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 299 }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 340 }}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          width: '100%',
          background: '#fff',
          borderRadius: '16px 16px 0 0',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.18)',
          zIndex: 300,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          height: 'min(430px, 60dvh)',
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, background: '#e5e7eb', borderRadius: 2, margin: '6px auto 0', flexShrink: 0 }} />

        {/* Recipient row + coin balance — fixed 52px */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px 4px', flexShrink: 0, height: 52, borderBottom: '1px solid #f3f4f6', overflow: 'hidden' }}>
          {/* "All stage" chip */}
          {receivers.length > 1 && (
            <button
              onClick={() => setReceiverMode(ALL_STAGE_ID)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', borderRadius: 20,
                border: `1.5px solid ${isAllStage ? '#7c3aed' : '#e5e7eb'}`,
                background: isAllStage ? '#ede9fe' : '#f9fafb',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 14 }}>🎪</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: isAllStage ? '#7c3aed' : '#6b7280' }}>All ({receivers.length})</span>
            </button>
          )}
          {/* Individual receiver chips */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flex: 1, scrollbarWidth: 'none' }}>
            {[...(host ? [host] : []), ...speakers].map(r => {
              const selected = receiverMode === r.userId
              const src = getAvatarUrl(r.user.avatarUrl)
              return (
                <button key={r.userId}
                  onClick={() => setReceiverMode(r.userId)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                    flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                    borderRadius: 8, outline: selected ? '2px solid #7c3aed' : 'none',
                  }}
                >
                  <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#6366f1' }}>
                    {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : `${r.user.firstName[0]}${r.user.lastName[0]}`}
                  </div>
                  <span style={{ fontSize: 9, color: selected ? '#7c3aed' : '#6b7280', maxWidth: 36, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: selected ? 700 : 400 }}>
                    {r.user.firstName}
                  </span>
                </button>
              )
            })}
          </div>
          {/* Coin balance */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, background: '#fefce8', borderRadius: 20, padding: '3px 8px', border: '1px solid #fde68a' }}>
            <span style={{ fontSize: 12 }}>🪙</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#92400e' }}>{(wallet?.coins ?? 0).toLocaleString()}</span>
          </div>
        </div>

        {/* Category tabs — fixed 36px */}
        <div style={{ display: 'flex', gap: 0, padding: '0 12px', flexShrink: 0, height: 36, borderBottom: '1px solid #f3f4f6', alignItems: 'stretch' }}>
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)} style={{
              flex: 1, padding: '8px 4px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: category === cat ? '#7c3aed' : '#9ca3af',
              borderBottom: `2px solid ${category === cat ? '#7c3aed' : 'transparent'}`,
              transition: 'all 0.15s',
            }}>{cat}</button>
          ))}
        </div>

        {/* Gift grid — fills remaining space, footer is always visible */}
        <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '6px 8px 2px' }}>
          {loadingGifts ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#9ca3af', fontSize: 13 }}>Loading gifts…</div>
          ) : displayGifts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#9ca3af', fontSize: 13 }}>No gifts available</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {displayGifts.map(gift => {
                const isSel = selectedGift?.id === gift.id
                return (
                  <button key={gift.id}
                    onClick={() => { setSelectedGift(gift); setCount(1) }}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                      padding: '8px 4px 6px', border: `1.5px solid ${isSel ? '#7c3aed' : '#f1f5f9'}`,
                      borderRadius: 10, background: isSel ? '#faf5ff' : '#fff',
                      cursor: 'pointer', transition: 'all 0.12s', position: 'relative',
                    }}
                  >
                    <span style={{ fontSize: 28, lineHeight: 1 }}>{gift.emoji}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#374151', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gift.name}</span>
                    <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <span style={{ fontSize: 9 }}>🪙</span>{gift.priceCoins}
                    </span>
                    {isSel && <div style={{ position: 'absolute', top: 3, right: 3, width: 6, height: 6, borderRadius: 3, background: '#7c3aed' }} />}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer: recipient | count | send — always anchored at bottom, fixed 60px */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 12px', borderTop: '1px solid #f3f4f6',
          background: '#fff', flexShrink: 0, height: 60,
          boxSizing: 'border-box',
        }}>
          {/* Recipient mini display */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, overflow: 'hidden' }}>
              {isAllStage ? '🎪' : (() => {
                const r = receivers.find(x => x.userId === receiverMode)
                const src = r ? getAvatarUrl(r.user.avatarUrl) : null
                return src ? <img src={src} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} /> : (r ? `${r.user.firstName[0]}` : '?')
              })()}
            </div>
            <div style={{ minWidth: 0, overflow: 'hidden' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{receiverLabel}</div>
              {selectedGift && <div style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap' }}>🪙 {totalCost.toLocaleString()} total</div>}
            </div>
          </div>

          {/* Count selector — compact */}
          {selectedGift?.comboEnabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              <button onClick={() => setCount(c => Math.max(1, c - 1))} style={{ width: 24, height: 24, borderRadius: 12, border: '1px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#374151', padding: 0 }}>−</button>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', minWidth: 18, textAlign: 'center' }}>{count}</span>
              <button onClick={() => setCount(c => Math.min(99, c + 1))} style={{ width: 24, height: 24, borderRadius: 12, border: '1px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#374151', padding: 0 }}>+</button>
            </div>
          )}

          {/* Send button — always visible, never shrinks */}
          <button
            onClick={handleSend}
            disabled={!selectedGift || !canAfford || sending || receivers.length === 0}
            style={{
              padding: '10px 20px', borderRadius: 24, border: 'none',
              background: (!selectedGift || !canAfford || sending || receivers.length === 0) ? '#d1d5db' : '#3b82f6',
              color: '#fff', fontSize: 14, fontWeight: 800,
              cursor: (!selectedGift || !canAfford || sending) ? 'not-allowed' : 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              transition: 'background 0.15s',
            }}
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </motion.div>
    </>
  )
}
