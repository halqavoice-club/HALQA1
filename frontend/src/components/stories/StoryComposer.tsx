'use client'
import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { storiesApi } from '@/lib/stories'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { X, Image, Type, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import { resolveMediaUrl } from '@/lib/media'

const BG_PRESETS = [
  { label: 'Indigo',  bg: '#6366f1', text: '#ffffff' },
  { label: 'Rose',    bg: '#f43f5e', text: '#ffffff' },
  { label: 'Amber',   bg: '#f59e0b', text: '#1f2937' },
  { label: 'Emerald', bg: '#10b981', text: '#ffffff' },
  { label: 'Cyan',    bg: '#06b6d4', text: '#ffffff' },
  { label: 'Purple',  bg: '#a855f7', text: '#ffffff' },
  { label: 'Night',   bg: '#0f172a', text: '#e2e8f0' },
  { label: 'Slate',   bg: '#334155', text: '#f1f5f9' },
]

interface Props { onClose: () => void }

export function StoryComposer({ onClose }: Props) {
  const { toast }   = useToast()
  const queryClient = useQueryClient()
  const fileRef     = useRef<HTMLInputElement>(null)

  const [mode,      setMode]      = useState<'text' | 'image'>('text')
  const [text,      setText]      = useState('')
  const [preset,    setPreset]    = useState(BG_PRESETS[0])
  const [mediaUrl,  setMediaUrl]  = useState<string | null>(null)
  const [caption,   setCaption]   = useState('')
  const [uploading, setUploading] = useState(false)

  const createMutation = useMutation({
    mutationFn: () => storiesApi.create(
      mode === 'text'
        ? { type: 'TEXT', text: text.trim(), bgColor: preset.bg, textColor: preset.text }
        : { type: 'IMAGE', mediaUrl: mediaUrl!, caption: caption.trim() || undefined }
    ),
    onSuccess: () => {
      toast({ title: '✅ Story posted!' })
      queryClient.invalidateQueries({ queryKey: ['stories-feed'] })
      onClose()
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
  })

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      setMediaUrl(r.data.data.url)
      setMode('image')
    } catch { toast({ title: 'Upload failed', variant: 'destructive' }) }
    finally { setUploading(false) }
  }

  const canPost = mode === 'text' ? text.trim().length > 0 : !!mediaUrl

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4">
      <div className="bg-gray-950 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="text-sm font-bold text-white">Add to Story</h2>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-800 transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Mode switcher */}
        <div className="flex gap-1 p-3 bg-gray-900/50">
          {([['text', <Type className="w-4 h-4" />, 'Text'], ['image', <Image className="w-4 h-4" />, 'Photo']] as any[]).map(([m, icon, label]) => (
            <button key={m} onClick={() => m === 'image' ? fileRef.current?.click() : setMode(m)}
              className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors',
                mode === m ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white')}>
              {icon}{label}
            </button>
          ))}
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFile} />
        </div>

        {/* Preview */}
        <div className="mx-3 rounded-xl overflow-hidden aspect-[9/14]">
          {mode === 'text' ? (
            <div className="w-full h-full flex items-center justify-center p-6 relative"
              style={{ backgroundColor: preset.bg }}>
              <textarea
                value={text} onChange={e => setText(e.target.value)}
                placeholder="What's on your mind?"
                maxLength={280}
                rows={4}
                className="w-full text-center text-lg font-bold bg-transparent outline-none resize-none placeholder-white/50"
                style={{ color: preset.text }}
              />
            </div>
          ) : mediaUrl ? (
            <div className="w-full h-full relative bg-black">
              <img src={resolveMediaUrl(mediaUrl)}
                alt="" className="w-full h-full object-contain" />
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                </div>
              )}
              {/* Caption input */}
              <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70">
                <input value={caption} onChange={e => setCaption(e.target.value)}
                  placeholder="Add a caption…" maxLength={280}
                  className="w-full bg-transparent text-white text-sm outline-none placeholder-white/60 text-center" />
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-800 cursor-pointer"
              onClick={() => fileRef.current?.click()}>
              {uploading
                ? <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
                : <div className="flex flex-col items-center gap-2 text-gray-400">
                    <Image className="w-10 h-10" />
                    <span className="text-sm">Tap to choose photo</span>
                  </div>
              }
            </div>
          )}
        </div>

        {/* Color presets (text mode) */}
        {mode === 'text' && (
          <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto">
            {BG_PRESETS.map(p => (
              <button key={p.bg} onClick={() => setPreset(p)}
                className={cn('w-7 h-7 rounded-full flex-shrink-0 transition-transform border-2',
                  preset.bg === p.bg ? 'scale-125 border-white' : 'border-transparent')}
                style={{ backgroundColor: p.bg }} />
            ))}
          </div>
        )}

        {/* Post button */}
        <div className="p-3">
          <button onClick={() => createMutation.mutate()} disabled={!canPost || createMutation.isPending}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Share to Story
          </button>
        </div>
      </div>
    </div>
  )
}
