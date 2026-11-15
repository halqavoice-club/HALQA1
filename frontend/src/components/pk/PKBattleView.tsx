'use client'

import React, { useCallback } from 'react'
import { PKTimer }        from './PKTimer'
import { PKScoreBar }     from './PKScoreBar'
import { PKCountdown }    from './PKCountdown'
import { PKWinnerOverlay } from './PKWinnerOverlay'
import { Button }         from '@/components/ui/button'
import { usePK }          from '@/hooks/usePK'
import { useAuthStore }   from '@/store/auth.store'
import { usePKStore, PKSide } from '@/store/pk.store'
import { cn }             from '@/lib/utils'
import { useRouter }      from 'next/navigation'

interface PKBattleViewProps {
  pkMatchId: string
}

/**
 * PKBattleView — full battle UI wired to the PK service.
 * Drop into any page to render the complete PK battle interface.
 */
export function PKBattleView({ pkMatchId }: PKBattleViewProps) {
  const router = useRouter()
  const { user } = useAuthStore()
  const {
    match, remainingSeconds, voteScoreA, voteScoreB,
    comboA, comboB, comebackSide, leadingSide,
    countdownSeconds, showWinnerOverlay,
    castVote, startPK, requestRematch,
  } = usePK(pkMatchId)

  const setShowWinnerOverlay = usePKStore(s => s.setShowWinnerOverlay)

  const myParticipant = match?.participants.find(p => p.userId === user?.id)
  const mySide        = myParticipant?.side
  const sideAUser     = match?.participants.find(p => p.side === 'A')
  const sideBUser     = match?.participants.find(p => p.side === 'B')

  const handleRematch = useCallback(async () => {
    const newMatch = await requestRematch()
    if (newMatch) {
      setShowWinnerOverlay(false)
      router.push(`/voice-club/pk/${newMatch.id}`)
    }
  }, [pkMatchId]) // eslint-disable-line

  if (!match) {
    return (
      <div className="flex items-center justify-center h-64 text-white/50">
        Loading PK battle...
      </div>
    )
  }

  const isLive    = match.state === 'LIVE'
  const isPaused  = match.state === 'PAUSED'
  const isDone    = ['COMPLETED', 'ABORTED', 'CANCELLED'].includes(match.state)
  const isFinal30 = remainingSeconds <= 30 && remainingSeconds > 0 && isLive

  return (
    <div className="relative w-full flex flex-col items-center gap-4 bg-gradient-to-b from-slate-900 to-slate-950 rounded-2xl p-4 min-h-[400px]">
      {/* Countdown overlay */}
      {countdownSeconds !== null && countdownSeconds > 0 && (
        <PKCountdown key={countdownSeconds} seconds={countdownSeconds} onDone={() => usePKStore.getState().setCountdown(null)} />
      )}

      {/* Winner overlay */}
      {showWinnerOverlay && user && (
        <PKWinnerOverlay
          match={match}
          myUserId={user.id}
          onRematch={handleRematch}
          onExit={() => { setShowWinnerOverlay(false); router.back() }}
        />
      )}

      {/* State badge */}
      <div className={cn(
        'px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide',
        isLive    ? 'bg-green-600 text-white animate-pulse' :
        isPaused  ? 'bg-yellow-600 text-white' :
        isDone    ? 'bg-slate-700 text-white/60' :
                    'bg-indigo-700 text-white'
      )}>
        {match.state.replace('_', ' ')}
      </div>

      {/* Timer */}
      {(isLive || isPaused) && (
        <PKTimer
          remainingSeconds={remainingSeconds}
          totalSeconds={match.durationSeconds}
          isPaused={isPaused}
          isFinalRound={isFinal30}
        />
      )}

      {/* Score bar */}
      <div className="w-full max-w-md">
        <PKScoreBar
          scoreA={match.scoreA}
          scoreB={match.scoreB}
          comboA={comboA}
          comboB={comboB}
          comebackSide={comebackSide}
          leadingSide={leadingSide}
          voteScoreA={voteScoreA}
          voteScoreB={voteScoreB}
          nameA={sideAUser?.user ? `${sideAUser.user.firstName} ${sideAUser.user.lastName}` : 'Side A'}
          nameB={sideBUser?.user ? `${sideBUser.user.firstName} ${sideBUser.user.lastName}` : 'Side B'}
          avatarA={sideAUser?.user?.avatarUrl}
          avatarB={sideBUser?.user?.avatarUrl}
        />
      </div>

      {/* Vote buttons (audience only, live state) */}
      {isLive && !mySide && (
        <div className="flex gap-4 mt-2">
          <Button
            onClick={() => castVote('A')}
            className="bg-rose-700/80 hover:bg-rose-600 text-white border border-rose-600"
            size="sm"
          >
            🗳️ Vote A
          </Button>
          <Button
            onClick={() => castVote('B')}
            className="bg-blue-700/80 hover:bg-blue-600 text-white border border-blue-600"
            size="sm"
          >
            🗳️ Vote B
          </Button>
        </div>
      )}

      {/* Start button (participants, PREPARING state) */}
      {match.state === 'PREPARING' && myParticipant?.role === 'HOST' && mySide === 'A' && (
        <Button onClick={startPK} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-8">
          ⚔️ Start Battle!
        </Button>
      )}

      {/* Gift score breakdown */}
      {(isLive || isDone) && (
        <div className="flex items-center gap-6 text-xs text-white/40 mt-2">
          <div className="text-center">
            <div className="text-white/60 font-semibold">{match.giftScoreA.toLocaleString()}</div>
            <div>🎁 A gifts</div>
          </div>
          <div className="text-white/20">|</div>
          <div className="text-center">
            <div className="text-white/60 font-semibold">{match.giftScoreB.toLocaleString()}</div>
            <div>🎁 B gifts</div>
          </div>
        </div>
      )}
    </div>
  )
}
