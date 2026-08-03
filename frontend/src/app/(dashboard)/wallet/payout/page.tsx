'use client'

/**
 * Payout Request Page — Diamond → Cash withdrawal
 *
 * Allows hosts to request withdrawal of earned diamonds.
 * Economy: 1 diamond = $0.005 | Minimum: 2,000 diamonds = $10
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Wallet, TrendingUp, Clock, CheckCircle, XCircle } from 'lucide-react'

const DIAMOND_TO_USD  = 0.005
const MIN_DIAMONDS    = 2000

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  PENDING:    { label: 'Pending Review', color: 'bg-yellow-100 text-yellow-800' },
  APPROVED:   { label: 'Approved',       color: 'bg-blue-100 text-blue-800' },
  PROCESSING: { label: 'Processing',     color: 'bg-purple-100 text-purple-800' },
  COMPLETED:  { label: 'Completed',      color: 'bg-green-100 text-green-800' },
  REJECTED:   { label: 'Rejected',       color: 'bg-red-100 text-red-800' },
  CANCELLED:  { label: 'Cancelled',      color: 'bg-gray-100 text-gray-800' },
}

export default function PayoutPage() {
  const { toast }      = useToast()
  const queryClient    = useQueryClient()
  const [diamonds, setDiamonds]   = useState('')
  const [method, setMethod]       = useState<string>('')
  const [account, setAccount]     = useState('')

  // Wallet balance
  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    queryFn:  () => api.get('/wallet/me').then(r => r.data.data),
  })

  // Payout history
  const { data: history } = useQuery({
    queryKey: ['payout-history'],
    queryFn:  () => api.get('/wallet/payout/history').then(r => r.data.data),
  })

  const requestMutation = useMutation({
    mutationFn: (payload: any) => api.post('/wallet/payout/request', payload),
    onSuccess: () => {
      toast({ title: 'Payout requested', description: 'We\'ll process it within 3–5 business days.' })
      queryClient.invalidateQueries({ queryKey: ['wallet'] })
      queryClient.invalidateQueries({ queryKey: ['payout-history'] })
      setDiamonds(''); setMethod(''); setAccount('')
    },
    onError: (err: any) => {
      toast({ title: 'Request failed', description: err.response?.data?.message, variant: 'destructive' })
    }
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/wallet/payout/${id}/cancel`),
    onSuccess: () => {
      toast({ title: 'Payout cancelled', description: 'Diamonds have been refunded.' })
      queryClient.invalidateQueries({ queryKey: ['wallet'] })
      queryClient.invalidateQueries({ queryKey: ['payout-history'] })
    },
    onError: (err: any) => {
      toast({ title: 'Cancel failed', description: err.response?.data?.message, variant: 'destructive' })
    }
  })

  const diamondAmount  = parseInt(diamonds) || 0
  const usdValue       = (diamondAmount * DIAMOND_TO_USD).toFixed(2)
  const canSubmit      = diamondAmount >= MIN_DIAMONDS && method && account.trim()
    && (wallet?.diamonds ?? 0) >= diamondAmount && !requestMutation.isPending

  const pendingRequest = history?.find((r: any) =>
    ['PENDING', 'APPROVED', 'PROCESSING'].includes(r.status)
  )

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Request Payout</h1>
        <p className="text-sm text-gray-500 mt-1">Withdraw your earned diamonds as cash.</p>
      </div>

      {/* Balance card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-indigo-600 dark:text-indigo-300" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Available diamonds</p>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                💎 {(wallet?.diamonds ?? 0).toLocaleString()}
              </p>
              <p className="text-sm text-green-600">
                ≈ ${((wallet?.diamonds ?? 0) * DIAMOND_TO_USD).toFixed(2)} USD
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending request warning */}
      {pendingRequest && (
        <div className="flex items-center gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl">
          <Clock className="w-5 h-5 text-yellow-600 shrink-0" />
          <div className="flex-1 text-sm text-yellow-800 dark:text-yellow-200">
            You have a <strong>{pendingRequest.status.toLowerCase()}</strong> payout request for{' '}
            💎 {pendingRequest.diamonds.toLocaleString()} (${pendingRequest.usdAmount.toFixed(2)}).
          </div>
          {pendingRequest.status === 'PENDING' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => cancelMutation.mutate(pendingRequest.id)}
              disabled={cancelMutation.isPending}
              className="text-red-600 hover:text-red-700"
            >
              Cancel
            </Button>
          )}
        </div>
      )}

      {/* Request form */}
      {!pendingRequest && (
        <Card>
          <CardHeader>
            <CardTitle>New Payout Request</CardTitle>
            <CardDescription>
              Minimum: {MIN_DIAMONDS.toLocaleString()} diamonds (${(MIN_DIAMONDS * DIAMOND_TO_USD).toFixed(2)}).
              Processing takes 3–5 business days.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="diamonds">Diamonds to withdraw</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  id="diamonds"
                  type="number"
                  min={MIN_DIAMONDS}
                  max={wallet?.diamonds ?? 0}
                  value={diamonds}
                  onChange={e => setDiamonds(e.target.value)}
                  placeholder={MIN_DIAMONDS.toString()}
                  className="w-48"
                />
                <span className="text-sm text-gray-500">
                  {diamondAmount >= MIN_DIAMONDS ? `≈ $${usdValue} USD` : `Min ${MIN_DIAMONDS.toLocaleString()}`}
                </span>
              </div>
            </div>

            <div>
              <Label htmlFor="method">Payout method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="method" className="mt-1">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paypal">PayPal</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="stripe">Stripe (coming soon)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {method && (
              <div>
                <Label htmlFor="account">
                  {method === 'paypal' ? 'PayPal email' : 'Bank account / IBAN'}
                </Label>
                <Input
                  id="account"
                  value={account}
                  onChange={e => setAccount(e.target.value)}
                  placeholder={method === 'paypal' ? 'your@paypal.com' : 'Account number or IBAN'}
                  className="mt-1"
                />
              </div>
            )}

            <Button
              onClick={() => requestMutation.mutate({
                diamonds:       diamondAmount,
                method,
                accountDetails: { account }
              })}
              disabled={!canSubmit}
              className="w-full"
            >
              {requestMutation.isPending ? 'Submitting…' : `Request $${usdValue} payout`}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Payout history */}
      {history && history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Payout History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {history.map((req: any) => {
                const cfg = STATUS_CONFIG[req.status] ?? STATUS_CONFIG.PENDING
                return (
                  <div key={req.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-800">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">💎 {req.diamonds.toLocaleString()}</span>
                        <span className="text-xs text-gray-500">${req.usdAmount.toFixed(2)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>
                          {cfg.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {req.method.replace('_', ' ')} ·{' '}
                        {new Date(req.createdAt).toLocaleDateString()}
                        {req.transactionRef && ` · Ref: ${req.transactionRef}`}
                      </p>
                      {req.adminNote && (
                        <p className="text-xs text-gray-500 mt-0.5 italic">{req.adminNote}</p>
                      )}
                    </div>
                    {req.status === 'COMPLETED' && <CheckCircle className="w-5 h-5 text-green-500" />}
                    {req.status === 'REJECTED' && <XCircle className="w-5 h-5 text-red-500" />}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
