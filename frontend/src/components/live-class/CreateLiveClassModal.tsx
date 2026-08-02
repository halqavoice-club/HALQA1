'use client'

import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { X, Loader2, Video, ImagePlus, Clock, Calendar, Infinity, Timer } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Room type ────────────────────────────────────────────────────────────────
type RoomType = 'immediate' | 'scheduled' | 'permanent' | 'limited'

const ROOM_TYPES: {
  id: RoomType
  label: string
  sub: string
  icon: React.ReactNode
}[] = [
  { id: 'immediate', label: 'Immediate',  sub: 'Start now',                         icon: <Video className="w-5 h-5" /> },
  { id: 'scheduled', label: 'Scheduled',  sub: 'Choose a future date and time',     icon: <Calendar className="w-5 h-5" /> },
  { id: 'permanent', label: 'Permanent',  sub: 'Always available',                  icon: <Infinity className="w-5 h-5" /> },
  { id: 'limited',   label: 'Limited',    sub: 'Auto-end after a selected duration', icon: <Timer className="w-5 h-5" /> },
]

// ─── Schema ───────────────────────────────────────────────────────────────────
const schema = z.object({
  classId:            z.string().min(1, 'Select a class'),
  title:              z.string().min(1, 'Title required').max(120),
  description:        z.string().optional(),
  scheduledAt:        z.string().optional(),
  duration:           z.number().int().min(1).max(480).nullable().optional().default(60),
  privacy:            z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  maxParticipants:    z.number().int().min(1).max(1000).default(100),
  chatEnabled:        z.boolean().default(true),
  handRaiseEnabled:   z.boolean().default(true),
  quranPanelEnabled:  z.boolean().default(false),
  whiteboardEnabled:  z.boolean().default(true),
  screenShareEnabled: z.boolean().default(true),
  isRecorded:         z.boolean().default(false),
})

type Form = z.infer<typeof schema>

interface Props {
  onClose: () => void
  onCreated: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────
export function CreateLiveClassModal({ onClose, onCreated }: Props) {
  const { toast } = useToast()
  const coverInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<'type' | 'details'>('type')
  const [roomType, setRoomType] = useState<RoomType>('immediate')
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)

  const { data: classes = [] } = useQuery({
    queryKey: ['classes-for-liveclass'],
    queryFn: () => api.get('/classes').then(r => r.data.data || []),
  })

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      duration: 60, privacy: 'PUBLIC',
      chatEnabled: true, handRaiseEnabled: true,
      quranPanelEnabled: false, whiteboardEnabled: true,
      screenShareEnabled: true, isRecorded: false, maxParticipants: 100,
    },
  })

  const mutation = useMutation({
    mutationFn: async (data: Form) => {
      // Map roomType to the fields the backend understands:
      // - immediate: no scheduledAt, normal duration
      // - scheduled: scheduledAt set, normal duration
      // - permanent: no scheduledAt, duration=9999 (effectively unlimited)
      // - limited:   no scheduledAt, duration = user-chosen value (auto-end)
      const payload = {
        classId:            data.classId,
        title:              data.title,
        description:        data.description,
        duration:           roomType === 'permanent' ? null : data.duration,
        scheduledAt:        roomType === 'scheduled'  ? data.scheduledAt : undefined,
        privacy:            data.privacy,
        maxParticipants:    data.maxParticipants,
        chatEnabled:        data.chatEnabled,
        handRaiseEnabled:   data.handRaiseEnabled,
        quranPanelEnabled:  data.quranPanelEnabled,
        whiteboardEnabled:  data.whiteboardEnabled,
        screenShareEnabled: data.screenShareEnabled,
        isRecorded:         data.isRecorded,
      }
      const res = await api.post('/live-classes', payload)
      const lc = res.data.data

      if (coverFile && lc?.id) {
        const fd = new FormData()
        fd.append('cover', coverFile)
        await api.post(`/live-classes/${lc.id}/cover`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        }).catch(() => {})
      }
      return res
    },
    onSuccess: () => {
      toast({ title: '✅ Live class created' })
      onCreated()
    },
    onError: (e: any) => {
      toast({ title: e?.response?.data?.message || 'Failed to create', variant: 'destructive' })
    },
  })

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverFile(file)
    const reader = new FileReader()
    reader.onload = ev => setCoverPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            {step === 'details' && (
              <button
                type="button"
                onClick={() => setStep('type')}
                className="p-1.5 rounded-lg hover:bg-gray-100 mr-1"
              >
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <Video className="w-5 h-5 text-indigo-600" />
            <h2 className="font-bold text-gray-900">Create Live Class Room</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <AnimatePresence mode="wait">
          {step === 'type' ? (
            /* ── Step 1: Room Type ──────────────────────────────────────── */
            <motion.div
              key="type"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-5 space-y-4"
            >
              <p className="text-sm font-semibold text-gray-700">Room Type</p>

              <div className="space-y-2">
                {ROOM_TYPES.map(rt => (
                  <button
                    key={rt.id}
                    type="button"
                    onClick={() => setRoomType(rt.id)}
                    className={cn(
                      'w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left',
                      roomType === rt.id
                        ? 'border-indigo-600 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300 bg-white',
                    )}
                  >
                    {/* Radio indicator */}
                    <span className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                      roomType === rt.id ? 'border-indigo-600' : 'border-gray-400',
                    )}>
                      {roomType === rt.id && (
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                      )}
                    </span>

                    {/* Icon */}
                    <span className={cn(
                      'flex-shrink-0',
                      roomType === rt.id ? 'text-indigo-600' : 'text-gray-400',
                    )}>
                      {rt.icon}
                    </span>

                    {/* Text */}
                    <div>
                      <p className={cn(
                        'font-semibold text-sm',
                        roomType === rt.id ? 'text-indigo-700' : 'text-gray-800',
                      )}>
                        {rt.label}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">{rt.sub}</p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="pt-2 border-t border-gray-100" />

              <Button
                type="button"
                className="w-full bg-indigo-600 hover:bg-indigo-700"
                onClick={() => setStep('details')}
              >
                Continue
              </Button>
            </motion.div>

          ) : (
            /* ── Step 2: Room Details ───────────────────────────────────── */
            <motion.div
              key="details"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-5 space-y-4">
                {/* Room type badge */}
                <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 rounded-xl text-indigo-700 text-sm font-medium">
                  {ROOM_TYPES.find(r => r.id === roomType)?.icon}
                  {ROOM_TYPES.find(r => r.id === roomType)?.label} room
                </div>

                {/* Class */}
                <div>
                  <Label>Class *</Label>
                  <Select onValueChange={v => setValue('classId', v)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select a class" />
                    </SelectTrigger>
                    <SelectContent>
                      {classes.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.classId && <p className="text-xs text-red-500 mt-1">{errors.classId.message}</p>}
                </div>

                {/* Room name / title */}
                <div>
                  <Label>Room Name *</Label>
                  <Input className="mt-1" placeholder="e.g. Quran Recitation — Surah Al-Baqarah" {...register('title')} />
                  {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title.message}</p>}
                </div>

                {/* Category (description) */}
                <div>
                  <Label>Category</Label>
                  <textarea
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    rows={2}
                    placeholder="Optional description or category..."
                    {...register('description')}
                  />
                </div>

                {/* Public / Private */}
                <div>
                  <Label>Visibility</Label>
                  <Select
                    defaultValue="PUBLIC"
                    onValueChange={v => setValue('privacy', v as 'PUBLIC' | 'PRIVATE')}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PUBLIC">🌐 Public — anyone can join</SelectItem>
                      <SelectItem value="PRIVATE">🔒 Private — invite only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Scheduled date/time — only for 'scheduled' type */}
                {roomType === 'scheduled' && (
                  <div>
                    <Label>Scheduled At *</Label>
                    <Input type="datetime-local" className="mt-1" {...register('scheduledAt')} />
                  </div>
                )}

                {/* Duration — hidden for 'permanent' */}
                {roomType !== 'permanent' && (
                  <div>
                    <Label>
                      {roomType === 'limited' ? 'Auto-end after (min)' : 'Duration (min)'}
                    </Label>
                    <Input
                      type="number" min={1} max={480} className="mt-1"
                      {...register('duration', { valueAsNumber: true })}
                    />
                  </div>
                )}

                {/* Maximum Members */}
                <div>
                  <Label>Maximum Members</Label>
                  <Input
                    type="number" min={1} max={1000} className="mt-1"
                    placeholder="100"
                    {...register('maxParticipants', { valueAsNumber: true })}
                  />
                </div>

                {/* Cover Image */}
                <div>
                  <Label>Cover Image (optional)</Label>
                  <div className="mt-1 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => coverInputRef.current?.click()}
                      className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-xl hover:border-indigo-400 hover:bg-indigo-50 transition-colors text-sm text-gray-500"
                    >
                      <ImagePlus className="w-4 h-4" />
                      {coverPreview ? 'Change' : 'Upload cover'}
                    </button>
                    {coverPreview && (
                      <div className="relative w-14 h-14 rounded-xl overflow-hidden border border-gray-200">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={coverPreview} alt="Cover" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => {
                            setCoverPreview(null)
                            setCoverFile(null)
                            if (coverInputRef.current) coverInputRef.current.value = ''
                          }}
                          className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center"
                        >
                          <X className="w-2.5 h-2.5 text-white" />
                        </button>
                      </div>
                    )}
                  </div>
                  <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
                </div>

                {/* Feature toggles */}
                <div className="space-y-2">
                  <Label>Features</Label>
                  {[
                    { key: 'chatEnabled',        label: '💬 Chat' },
                    { key: 'handRaiseEnabled',   label: '✋ Hand raise queue' },
                    { key: 'quranPanelEnabled',  label: '📖 Quran panel' },
                    { key: 'whiteboardEnabled',  label: '🖊️ Whiteboard' },
                    { key: 'screenShareEnabled', label: '🖥️ Screen sharing for all' },
                    { key: 'isRecorded',         label: '🔴 Record class' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 rounded accent-indigo-600" {...register(key as keyof Form)} />
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 gap-2"
                    disabled={mutation.isPending}
                  >
                    {mutation.isPending
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
                      : <><Video className="w-4 h-4" /> Create Class</>}
                  </Button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
