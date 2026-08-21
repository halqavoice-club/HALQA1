'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { PKMatchmakingModal } from '@/components/pk/PKMatchmakingModal'
import { usePK } from '@/hooks/usePK'
import { usePKStore } from '@/store/pk.store'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { getSocket } from '@/lib/socket'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * PK Hub page — /voice-club/pk
 * Shows matchmaking, leaderboard, history, stats tabs.
 */
export default function PKHubPage() {
  const router  = useRouter()
  const { user } = useAuthStore()
  const [showMatchmaking, setShowMatchmaking] = useState(false)
  const [leaderboard, setLeaderboard]         = useState<any[]>([])
  const [history, setHistory]                 = useState<any[]>([])
  const [myStats, setMyStats]                 = useState<any>(null)
  const [loadingLb, setLoadingLb]             = useState(true)
  const [loadingHistory, setLoadingHistory]   = useState(true)

  const store = usePKStore()

  // Load data
  useEffect(() => {
    api.get('/pk/leaderboards?scope=weekly&limit=20')
      .then(r => setLeaderboard(r.data.data?.leaderboard || []))
      .finally(() => setLoadingLb(false))

    api.get('/pk/history?limit=10')
      .then(r => setHistory(r.data.data || []))
      .finally(() => setLoadingHistory(false))

    if (user?.id) {
      api.get(`/pk/stats/${user.id}`)
        .then(r => setMyStats(r.data.data || null))
    }
  }, [user?.id])

  // Listen for match found via socket
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const handler = (data: { pkMatchId: string }) => {
      store.setInQueue(false)
      setShowMatchmaking(false)
      router.push(`/voice-club/pk/${data.pkMatchId}`)
    }
    socket.on('pk:matched', handler)
    return () => { socket.off('pk:matched', handler) }
  }, []) // eslint-disable-line

  const handleJoinQueue = async (opts: { type: string; durationSeconds: number }) => {
    try {
      await api.post('/pk/matchmaking/join', opts)
      store.setInQueue(true, opts.type as any)
    } catch (e: any) {
      console.warn(e?.response?.data?.message)
    }
  }

  const handleLeaveQueue = async () => {
    await api.post('/pk/matchmaking/leave')
    store.setInQueue(false)
    setShowMatchmaking(false)
  }

  const RANK_COLORS: Record<string, string> = {
    BRONZE: 'text-amber-600', SILVER: 'text-slate-400', GOLD: 'text-yellow-400',
    PLATINUM: 'text-cyan-400', DIAMOND: 'text-blue-400', MASTER: 'text-purple-400',
    GRANDMASTER: 'text-red-400',
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-extrabold">⚔️ PK Battle</h1>
        <Button
          onClick={() => setShowMatchmaking(true)}
          className="bg-indigo-600 hover:bg-indigo-500 font-bold"
        >
          {store.inQueue ? '🔍 Searching...' : '⚔️ Find Match'}
        </Button>
      </div>

      {/* My Stats card */}
      {myStats && (
        <div className="bg-slate-800/60 border border-white/10 rounded-xl p-4 mb-6 flex items-center justify-between">
          <div>
            <p className="text-white/50 text-xs uppercase tracking-wide">My Rank</p>
            <p className={`text-2xl font-extrabold ${RANK_COLORS[myStats.rank] || 'text-white'}`}>
              {myStats.rank}
            </p>
            <p className="text-white/40 text-xs">Rating: {myStats.rating}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-white/60">{myStats.wins}W – {myStats.losses}L</p>
            <p className="text-xs text-white/40">
              Win rate: {myStats.totalPKs > 0 ? Math.round((myStats.wins / myStats.totalPKs) * 100) : 0}%
            </p>
            <p className="text-xs text-white/40">Streak: {myStats.currentStreak > 0 ? `+${myStats.currentStreak}` : myStats.currentStreak}</p>
          </div>
        </div>
      )}

      <Tabs defaultValue="leaderboard">
        <TabsList className="w-full bg-slate-800 border border-white/10">
          <TabsTrigger value="leaderboard" className="flex-1">🏆 Leaderboard</TabsTrigger>
          <TabsTrigger value="history"     className="flex-1">📜 History</TabsTrigger>
        </TabsList>

        <TabsContent value="leaderboard" className="mt-4 space-y-2">
          {loadingLb ? (
            <div className="text-center text-white/40 py-12">Loading...</div>
          ) : leaderboard.length === 0 ? (
            <div className="text-center text-white/40 py-12">No rankings yet. Be the first to play!</div>
          ) : (
            leaderboard.map((entry: any, i: number) => (
              <div key={entry.userId} className="flex items-center gap-3 bg-slate-800/40 rounded-xl p-3">
                <span className="text-lg font-black text-white/30 w-6 text-center">{i + 1}</span>
                {entry.user?.avatarUrl
                  ? <img src={entry.user.avatarUrl} className="w-9 h-9 rounded-full object-cover" alt="" />
                  : <div className="w-9 h-9 rounded-full bg-indigo-700 flex items-center justify-center text-white text-sm font-bold">
                      {entry.user?.firstName?.[0] || '?'}
                    </div>
                }
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold truncate">
                    {entry.user?.firstName} {entry.user?.lastName}
                  </p>
                  <p className="text-white/40 text-xs">{entry.wins}W · {entry.score.toLocaleString()} pts</p>
                </div>
                <span className="text-indigo-400 font-bold text-sm">{entry.rating}</span>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-2">
          {loadingHistory ? (
            <div className="text-center text-white/40 py-12">Loading...</div>
          ) : history.length === 0 ? (
            <div className="text-center text-white/40 py-12">No battles yet. Challenge someone!</div>
          ) : (
            history.map((h: any) => (
              <div
                key={h.id}
                className="flex items-center justify-between bg-slate-800/40 rounded-xl p-3 cursor-pointer hover:bg-slate-700/40"
                onClick={() => router.push(`/voice-club/pk/${h.pkMatchId}`)}
              >
                <div>
                  <p className="text-white text-sm font-semibold">
                    {h.winnerSide === 'DRAW' ? '🤝 Draw'
                      : h.winnerId === user?.id ? '🏆 Win'
                      : '💪 Loss'}
                  </p>
                  <p className="text-white/40 text-xs">{new Date(h.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-white font-mono text-sm">{h.scoreA.toLocaleString()} vs {h.scoreB.toLocaleString()}</p>
                  <p className="text-white/40 text-xs">{Math.floor(h.durationSeconds / 60)}m battle</p>
                </div>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Matchmaking modal */}
      {showMatchmaking && (
        <PKMatchmakingModal
          isSearching={store.inQueue}
          onJoin={handleJoinQueue}
          onLeave={handleLeaveQueue}
          onClose={() => setShowMatchmaking(false)}
        />
      )}
    </div>
  )
}
