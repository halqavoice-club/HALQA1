'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Globe, Lock, UserCheck, Loader2, Mic } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  onCreate: (data: { title: string; description?: string; privacy: string; topic?: string; coverEmoji?: string }) => Promise<void>
}

const PRIVACY_OPTIONS = [
  { value: 'PUBLIC',      label: 'Public',      desc: 'Anyone can join',          icon: Globe,      color: 'border-green-300 bg-green-50 text-green-700' },
  { value: 'PRIVATE',     label: 'Private',     desc: 'Only invited users',       icon: Lock,       color: 'border-orange-300 bg-orange-50 text-orange-700' },
  { value: 'INVITE_ONLY', label: 'Invite Only', desc: 'Host approves each entry', icon: UserCheck,  color: 'border-blue-300 bg-blue-50 text-blue-700' },
]

const EMOJI_OPTIONS = ['🎙️', '🎵', '📚', '💬', '🌍', '🕌', '📖', '🎓', '🌙', '⭐', '🤝', '💡']

export function CreateRoomModal({ open, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [topic, setTopic] = useState('')
  const [privacy, setPrivacy] = useState('PUBLIC')
  const [coverEmoji, setCoverEmoji] = useState('🎙️')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)
    try {
      await onCreate({ title: title.trim(), description: description.trim() || undefined, privacy, topic: topic.trim() || undefined, coverEmoji })
      // Reset
      setTitle(''); setDescription(''); setTopic(''); setPrivacy('PUBLIC'); setCoverEmoji('🎙️')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
              <Mic className="w-3.5 h-3.5 text-white" />
            </div>
            Start a Voice Room
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Emoji picker */}
          <div>
            <Label className="text-xs text-gray-500 mb-2 block">Room Icon</Label>
            <div className="flex flex-wrap gap-2">
              {EMOJI_OPTIONS.map(e => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setCoverEmoji(e)}
                  className={cn(
                    'w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-all',
                    coverEmoji === e ? 'bg-purple-100 ring-2 ring-purple-400 scale-110' : 'bg-gray-100 hover:bg-gray-200'
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <Label htmlFor="room-title" className="text-sm font-medium">Room Title *</Label>
            <input
              id="room-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Quran Study Circle"
              maxLength={100}
              required
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
            />
          </div>

          {/* Topic */}
          <div>
            <Label htmlFor="room-topic" className="text-sm font-medium">Topic <span className="text-gray-400 font-normal">(optional)</span></Label>
            <input
              id="room-topic"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="e.g. Surah Al-Baqarah discussion"
              maxLength={150}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
            />
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="room-desc" className="text-sm font-medium">Description <span className="text-gray-400 font-normal">(optional)</span></Label>
            <textarea
              id="room-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What will you discuss?"
              rows={2}
              maxLength={300}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent resize-none"
            />
          </div>

          {/* Privacy */}
          <div>
            <Label className="text-sm font-medium mb-2 block">Privacy</Label>
            <div className="grid grid-cols-3 gap-2">
              {PRIVACY_OPTIONS.map(opt => {
                const Icon = opt.icon
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPrivacy(opt.value)}
                    className={cn(
                      'flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-xs font-medium transition-all',
                      privacy === opt.value ? opt.color + ' border-current' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{opt.label}</span>
                    <span className="text-[9px] font-normal opacity-70 text-center leading-tight">{opt.desc}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
              Go Live
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
