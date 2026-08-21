'use client'

import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { useEducationRole } from '@/hooks/useEducationRole'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { X, Loader2, Video, ImagePlus, Clock, Calendar, Infinity, Timer, Globe, GraduationCap } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Stream mode ──────────────────────────────────────────────────────────────
type StreamMode = 'SCHOOL' | 'PUBLIC'

// ─── Room type ────────────────────────────────────────────────────────────────
type RoomType = 'immediate' | 'scheduled' | 'permanent' | 'limited'

const ROOM_TYPES: { id: RoomType; label: string; sub: string; icon: React.ReactNode }[] = [
  { id: 'immediate', label: 'Immediate',  sub: 'Start now',                          icon: <Video className="w-5 h-5" /> },
  { id: 'scheduled', label: 'Scheduled',  sub: 'Choose a future date and time',      icon: <Calendar className="w-5 h-5" /> },
  { id: 'permanent', label: 'Permanent',  sub: 'Always available, no auto-end',      icon: <Infinity className="w-5 h-5" /> },
  { id: 'limited',   label: 'Limited',    sub: 'Auto-end after a selected duration', icon: <Timer className="w-5 h-5" /> },
]

// ─── Schema ───────────────────────────────────────────────────────────────────
const schema = z.object({
  streamType:         z.enum(['SCHOOL', 'PUBLIC']).default('SCHOOL'),
  classId:            z.string().optional(),
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
  const { isTeacher, isAdmin } = useEducationRole()
  const coverInputRef = useRef<HTMLInputElement>(null)

  // Step flow: mode → type → details
  const [step, setStep]             = useState<'mode' | 'type' | 'details'>('mode')
  const [streamMode, setStreamMode] = useState<StreamMode>('PUBLIC')
  const [roomType, setRoomType]     = useState<RoomType>('immediate')
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [coverFile, setCoverFile]   = useState<File | null>(null)

  // Only fetch classes if the user has a school role
  const canUseSchoolStreams = isTeacher || isAdmin
  const { data: classes = [] } = useQuery({
    queryKey: ['classes-for-liveclass'],
    queryFn: () => api.get('/classes').then(r => r.data.data || []),
    enabled: canUseSchoolStreams,
  })

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      streamType: 'PUBLIC',
      duration: 60, privacy: 'PUBLIC',
      chatEnabled: true, handRaiseEnabled: true,
      quranPanelEnabled: false, whiteboardEnabled: true,
      screenShareEnabled: true, isRecorded: false, maxParticipants: 100,
    },
  })

  const mutation = useMutation({
    mutationFn: async (data: Form) => {
      const payload: Record<string, any> = {
        streamType:         data.streamType,
        title:              data.title,
        description:        data.description,
        duration:           roomType === 'permanent' ? null : data.duration,
        scheduledAt:        roomType === 'scheduled' ? data.scheduledAt : undefined,
        privacy:            data.privacy,
        maxParticipants:    data.maxParticipants,
        chatEnabled:        data.chatEnabled,
        handRaiseEnabled:   data.handRaiseEnabled,
        quranPanelEnabled:  data.quranPanelEnabled,
        whiteboardEnabled:  data.whiteboardEnabled,
        screenShareEnabled: data.screenShareEnabled,
        isRecorded:         data.isRecorded,
      }
      // Only include classId for school streams
      if (data.streamType === 'SCHOOL' && data.classId) {
        payload.classId = data.classId
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
      toast({ title: '✅ Live stream created' })
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

  const handleModeSelect = (mode: StreamMode) => {
    setStreamMode(mode)
    setValue('streamType', mode)
    setStep('type')
  }

  const selectedClassId = watch('classId')
  const selectedClass = classes.find((c: any) => c.id === selectedClassId)

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
            {step !== 'mode' && (
              <button
                type="button"
                onClick={() => setStep(step === 'details' ? 'type' : 'mode')}
                className="p-1.5 rounded-lg hover:bg-gray-100 mr-1"
                aria-label="Go back"
              >
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <Video className="w-5 h-5 text-indigo-600" />
            <h2 className="font-bold text-gray-900">Go Live</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Close">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <AnimatePresence mode="wait">

          {/* ── Step 0: Stream Mode ──────────────────────────────────────────── */}
          {step === 'mode' && (
            <motion.div
              key="mode"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-5 space-y-4"
            >
              <p className="text-sm font-semibold text-gray-700">Who is this stream for?</p>

              <div className="space-y-3">
                {/* Public Stream — available to everyone */}
                <button
                  type="button"
                  onClick={() => handleModeSelect('PUBLIC')}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-all text-left group"
                >
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                    <Globe className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900 group-hover:text-indigo-700">Public Live Stream</p>
                    <p className="text-xs text-gray-500 mt-0.5">Anyone can watch. No school required. Like TikTok Live.</p>
                  </div>
                  <svg className="w-5 h-5 text-gray-300 group-hover:text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {/* School Class Stream — requires school membership */}
                {canUseSchoolStreams ? (
                  <button
                    type="button"
                    onClick={() => handleModeSelect('SCHOOL')}
                    className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-all text-left group"
                  >
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                      <GraduationCap className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900 group-hover:text-indigo-700">School Live Class</p>
                      <p className="text-xs text-gray-500 mt-0.5">For your enrolled class. Includes attendance, whiteboard, polls.</p>
                    </div>
                    <svg className="w-5 h-5 text-gray-300 group-hover:text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ) : (
                  <div className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed">
                    <div className="w-11 h-11 rounded-xl bg-gray-200 flex items-center justify-center flex-shrink-0">
                      <GraduationCap className="w-6 h-6 text-gray-400" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-500">School Live Class</p>
                      <p className="text-xs text-gray-400 mt-0.5">Join a school as a teacher or admin to create school classes.</p>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ── Step 1: Room Type ──────────────────────────────────────────── */}
          {step === 'type' && (
            <motion.div
              key="type"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-5 space-y-4"
            >
              {/* Mode badge */}
              <div className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium',
                streamMode === 'PUBLIC' ? 'bg-purple-50 text-purple-700' : 'bg-indigo-50 text-indigo-700'
              )}>
                {streamMode === 'PUBLIC' ? <Globe className="w-4 h-4" /> : <GraduationCap className="w-4 h-4" />}
                {streamMode === 'PUBLIC' ? 'Public Live Stream' : 'School Live Class'}
              </div>

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
                    <span className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                      roomType === rt.id ? 'border-indigo-600' : 'border-gray-400',
                    )}>
                      {roomType === rt.id && <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />}
                    </span>
                    <span className={cn('flex-shrink-0', roomType === rt.id ? 'text-indigo-600' : 'text-gray-400')}>
                      {rt.icon}
                    </span>
                    <div>
                      <p className={cn('font-semibold text-sm', roomType === rt.id ? 'text-indigo-700' : 'text-gray-800')}>
                        {rt.label}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">{rt.sub}</p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="pt-2 border-t border-gray-100" />
              <Button type="button" className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={() => setStep('details')}>
                Continue
              </Button>
            </motion.div>
          )}

          {/* ── Step 2: Room Details ───────────────────────────────────────── */}
          {step === 'details' && (
            <motion.div
              key="details"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-5 space-y-4">
                {/* Mode + type badge */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium',
                    streamMode === 'PUBLIC' ? 'bg-purple-50 text-purple-700' : 'bg-indigo-50 text-indigo-700'
                  )}>
                    {streamMode === 'PUBLIC' ? <Globe className="w-3.5 h-3.5" /> : <GraduationCap className="w-3.5 h-3.5" />}
                    {streamMode === 'PUBLIC' ? 'Public Stream' : 'School Class'}
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 text-gray-600 text-sm font-medium">
                    {ROOM_TYPES.find(r => r.id === roomType)?.icon}
                    {ROOM_TYPES.find(r => r.id === roomType)?.label}
                  </div>
                </div>

                {/* Class picker — only for school streams */}
                {streamMode === 'SCHOOL' && (
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
                )}

                {/* Title */}
                <div>
                  <Label>{streamMode === 'PUBLIC' ? 'Stream Title *' : 'Class Title *'}</Label>
                  <Input
                    className="mt-1"
                    placeholder={streamMode === 'PUBLIC' ? 'e.g., Arabic Conversation Practice' : 'e.g., Quran Recitation — Surah Al-Baqarah'}
                    {...register('title')}
                  />
                  {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title.message}</p>}
                </div>

                {/* Description */}
                <div>
                  <Label>Description</Label>
                  <textarea
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    rows={2}
                    placeholder="Optional description..."
                    {...register('description')}
                  />
                </div>

                {/* Visibility */}
                <div>
                  <Label>Visibility</Label>
                  <Select defaultValue="PUBLIC" onValueChange={v => setValue('privacy', v as 'PUBLIC' | 'PRIVATE')}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PUBLIC">🌐 Public — anyone can join</SelectItem>
                      <SelectItem value="PRIVATE">🔒 Private — invite only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Scheduled date/time */}
                {roomType === 'scheduled' && (
                  <div>
                    <Label>Scheduled At *</Label>
                    <Input type="datetime-local" className="mt-1" {...register('scheduledAt')} />
                  </div>
                )}

                {/* Duration */}
                {roomType !== 'permanent' && (
                  <div>
                    <Label>{roomType === 'limited' ? 'Auto-end after (min)' : 'Duration (min)'}</Label>
                    <Input type="number" min={1} max={480} className="mt-1" {...register('duration', { valueAsNumber: true })} />
                  </div>
                )}

                {/* Max participants */}
                <div>
                  <Label>Max Viewers</Label>
                  <Input type="number" min={1} max={1000} className="mt-1" placeholder="100" {...register('maxParticipants', { valueAsNumber: true })} />
                </div>

                {/* Cover image */}
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
                          onClick={() => { setCoverPreview(null); setCoverFile(null); if (coverInputRef.current) coverInputRef.current.value = '' }}
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
                    ...(streamMode === 'SCHOOL' ? [
                      { key: 'quranPanelEnabled',  label: '📖 Quran panel' },
                      { key: 'whiteboardEnabled',  label: '🖊️ Whiteboard' },
                    ] : []),
                    { key: 'screenShareEnabled', label: '🖥️ Screen sharing' },
                    { key: 'isRecorded',         label: '🔴 Record stream' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 rounded accent-indigo-600" {...register(key as keyof Form)} />
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
                  <Button
                    type="submit"
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 gap-2"
                    disabled={mutation.isPending}
                  >
                    {mutation.isPending
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
                      : <><Video className="w-4 h-4" /> Go Live</>
                    }
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
