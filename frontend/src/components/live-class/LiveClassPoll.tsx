'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { BarChart2, Plus, X, CheckCircle, Loader2 } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface Poll {
  id:        string
  question:  string
  options:   PollOption[]
  isActive:  boolean
  createdAt: string
}

export interface PollOption {
  id:    string
  text:  string
  votes: string[] // array of userIds who voted
}

export interface PollEvent {
  type:     'create' | 'vote' | 'close'
  poll?:    Poll
  pollId?:  string
  optionId?: string
  userId?:  string
}

interface Props {
  isHost:    boolean
  userId:    string | undefined
  polls:     Poll[]
  onEvent:   (ev: PollEvent) => void
}

// ─── Poll results bar ──────────────────────────────────────────────────────────
function ResultBar({ option, total, isWinner }: { option: PollOption; total: number; isWinner: boolean }) {
  const pct = total === 0 ? 0 : Math.round((option.votes.length / total) * 100)
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className={cn('truncate', isWinner ? 'text-indigo-300 font-semibold' : 'text-gray-300')}>{option.text}</span>
        <span className="text-gray-500 ml-2 flex-shrink-0">{option.votes.length} ({pct}%)</span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', isWinner ? 'bg-indigo-500' : 'bg-gray-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ─── Create poll form ──────────────────────────────────────────────────────────
function CreatePollForm({ onSubmit, onCancel }: { onSubmit: (q: string, opts: string[]) => void; onCancel: () => void }) {
  const [question, setQuestion] = useState('')
  const [options,  setOptions]  = useState(['', ''])

  const addOption   = () => options.length < 6 && setOptions([...options, ''])
  const removeOpt   = (i: number) => options.length > 2 && setOptions(options.filter((_, idx) => idx !== i))
  const updateOpt   = (i: number, v: string) => setOptions(options.map((o, idx) => idx === i ? v : o))

  const canSubmit = question.trim() && options.filter(o => o.trim()).length >= 2

  return (
    <div className="space-y-3 p-3 bg-gray-900/60 rounded-xl border border-gray-700/50">
      <div className="flex items-center gap-2">
        <BarChart2 className="w-4 h-4 text-indigo-400" />
        <span className="text-xs font-bold text-indigo-400">New Poll</span>
      </div>

      <input
        autoFocus
        value={question}
        onChange={e => setQuestion(e.target.value)}
        placeholder="Ask a question…"
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 outline-none focus:border-indigo-500"
        maxLength={120}
      />

      <div className="space-y-1.5">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={opt}
              onChange={e => updateOpt(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-indigo-500"
              maxLength={80}
            />
            {options.length > 2 && (
              <button onClick={() => removeOpt(i)} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-colors">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      {options.length < 6 && (
        <button onClick={addOption} className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-400 transition-colors">
          <Plus className="w-3 h-3" /> Add option
        </button>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex-1 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors">
          Cancel
        </button>
        <button
          onClick={() => canSubmit && onSubmit(question.trim(), options.filter(o => o.trim()))}
          disabled={!canSubmit}
          className="flex-1 text-xs text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-colors"
        >
          Launch Poll
        </button>
      </div>
    </div>
  )
}

// ─── Single poll card ──────────────────────────────────────────────────────────
function PollCard({ poll, isHost, userId, onVote, onClose }: {
  poll: Poll; isHost: boolean; userId: string | undefined
  onVote: (pollId: string, optionId: string) => void
  onClose: (pollId: string) => void
}) {
  const totalVotes = poll.options.reduce((s, o) => s + o.votes.length, 0)
  const myVote     = poll.options.find(o => userId && o.votes.includes(userId))
  const maxVotes   = Math.max(...poll.options.map(o => o.votes.length))

  return (
    <div className={cn('p-3 rounded-xl border space-y-2', poll.isActive ? 'bg-indigo-950/30 border-indigo-700/40' : 'bg-gray-900/40 border-gray-700/30')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-1.5">
          <BarChart2 className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
          <span className="text-xs font-semibold text-gray-200">{poll.question}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {poll.isActive && <span className="text-[10px] text-indigo-400 bg-indigo-900/40 px-1.5 py-0.5 rounded-full font-bold">LIVE</span>}
          {!poll.isActive && <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded-full">Closed</span>}
          {isHost && poll.isActive && (
            <button onClick={() => onClose(poll.id)} className="p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-colors" title="Close poll">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Voting — show vote buttons if active and not voted yet */}
      {poll.isActive && !myVote && !isHost ? (
        <div className="space-y-1">
          {poll.options.map(opt => (
            <button
              key={opt.id}
              onClick={() => onVote(poll.id, opt.id)}
              className="w-full text-left text-xs text-gray-300 hover:text-white bg-gray-800 hover:bg-indigo-900/40 border border-gray-700 hover:border-indigo-600/50 px-3 py-2 rounded-lg transition-colors"
            >
              {opt.text}
            </button>
          ))}
        </div>
      ) : (
        /* Results */
        <div className="space-y-2">
          {poll.options.map(opt => (
            <div key={opt.id} className="relative">
              {myVote?.id === opt.id && (
                <CheckCircle className="absolute -left-1 -top-1 w-3 h-3 text-indigo-400" />
              )}
              <ResultBar
                option={opt}
                total={totalVotes}
                isWinner={!poll.isActive && opt.votes.length === maxVotes && maxVotes > 0}
              />
            </div>
          ))}
          <p className="text-[10px] text-gray-600">{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</p>
        </div>
      )}

      {poll.isActive && myVote && !isHost && (
        <p className="text-[10px] text-indigo-400 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" /> You voted: {myVote.text}
        </p>
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────
export function LiveClassPollPanel({ isHost, userId, polls, onEvent }: Props) {
  const [showCreate, setShowCreate] = useState(false)

  const handleCreate = (question: string, options: string[]) => {
    const poll: Poll = {
      id:       Math.random().toString(36).slice(2),
      question,
      options:  options.map((text, i) => ({ id: `opt-${i}-${Date.now()}`, text, votes: [] })),
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    onEvent({ type: 'create', poll })
    setShowCreate(false)
  }

  const handleVote = (pollId: string, optionId: string) => {
    onEvent({ type: 'vote', pollId, optionId, userId })
  }

  const handleClose = (pollId: string) => {
    onEvent({ type: 'close', pollId })
  }

  if (polls.length === 0 && !showCreate && !isHost) return null

  return (
    <div className="space-y-2">
      {/* Create button for host */}
      {isHost && !showCreate && (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-950/30 hover:bg-indigo-950/50 border border-indigo-700/30 px-3 py-2 rounded-xl transition-colors w-full"
        >
          <BarChart2 className="w-3.5 h-3.5" />
          Launch a poll
        </button>
      )}

      {showCreate && isHost && (
        <CreatePollForm onSubmit={handleCreate} onCancel={() => setShowCreate(false)} />
      )}

      {polls.map(poll => (
        <PollCard
          key={poll.id}
          poll={poll}
          isHost={isHost}
          userId={userId}
          onVote={handleVote}
          onClose={handleClose}
        />
      ))}
    </div>
  )
}
