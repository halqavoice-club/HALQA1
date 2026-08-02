'use client'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { creatorApi } from '@/lib/creator'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { Coins, X, Loader2 } from 'lucide-react'

const QUICK_AMOUNTS = [10, 50, 100, 500]

interface Props {
  creatorUserId: string
  creatorName:   string
  postId?:       string
  size?:         'sm' | 'md'
}

export function TipButton({ creatorUserId, creatorName, postId, size = 'md' }: Props) {
  const { toast }   = useToast()
  const queryClient = useQueryClient()
  const [open,    setOpen]    = useState(false)
  const [amount,  setAmount]  = useState(50)
  const [message, setMessage] = useState('')

  const tipMutation = useMutation({
    mutationFn: () => creatorApi.sendTip(creatorUserId, amount, message.trim() || undefined, postId),
    onSuccess: () => {
      toast({ title: `💰 Tipped ${amount} coins to ${creatorName}!` })
      setOpen(false); setAmount(50); setMessage('')
      queryClient.invalidateQueries({ queryKey: ['wallet-me'] })
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed to tip', variant: 'destructive' })
  })

  return (
    <>
      <button onClick={() => setOpen(true)}
        className={cn(
          'flex items-center gap-1 font-semibold transition-colors rounded-xl',
          size === 'sm'
            ? 'px-2.5 py-1.5 text-xs bg-amber-50 text-amber-600 hover:bg-amber-100'
            : 'px-4 py-2 text-sm bg-amber-500 text-white hover:bg-amber-600'
        )}>
        <Coins className={size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} />
        Tip
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-amber-500" />
                <h2 className="font-bold text-gray-900 text-sm">Tip {creatorName}</h2>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Quick amounts */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">Quick amounts</p>
                <div className="grid grid-cols-4 gap-2">
                  {QUICK_AMOUNTS.map(a => (
                    <button key={a} onClick={() => setAmount(a)}
                      className={cn('py-2 rounded-xl text-sm font-bold transition-colors border',
                        amount === a ? 'bg-amber-500 text-white border-amber-500' : 'border-gray-200 text-gray-700 hover:border-amber-400')}>
                      🪙 {a}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom amount */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1.5">Custom amount</p>
                <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2 focus-within:border-amber-400 transition-colors">
                  <span className="text-lg">🪙</span>
                  <input type="number" min={1} value={amount}
                    onChange={e => setAmount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="flex-1 text-sm font-semibold text-gray-800 outline-none" />
                  <span className="text-xs text-gray-400">coins</span>
                </div>
              </div>

              {/* Message */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1.5">
                  Message <span className="font-normal text-gray-400">(optional)</span>
                </p>
                <textarea value={message} onChange={e => setMessage(e.target.value)}
                  placeholder={`Say something to ${creatorName}…`}
                  rows={2} maxLength={280}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:border-amber-400 transition-colors" />
              </div>

              {/* Send button */}
              <button onClick={() => tipMutation.mutate()} disabled={!amount || tipMutation.isPending}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                {tipMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Coins className="w-4 h-4" />}
                Send {amount} coins
              </button>
              <p className="text-center text-[11px] text-gray-400">
                {Math.floor(amount * 0.5)} diamonds will be credited to {creatorName}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
