'use client'

import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { X, Loader2, ImagePlus, PenLine, Trash2, AlertTriangle } from 'lucide-react'

// ─── Schema ───────────────────────────────────────────────────────────────────
const schema = z.object({
  title: z.string().min(1, 'Title required').max(120),
  description: z.string().optional().nullable(),
})
type Form = z.infer<typeof schema>

interface Props {
  lc: {
    id: string
    title: string
    description: string | null
    coverImageUrl: string | null
    status: string
  }
  onClose: () => void
  onUpdated?: () => void
  onDeleted?: () => void
}

export function EditLiveClassModal({ lc, onClose, onUpdated, onDeleted }: Props) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const coverInputRef = useRef<HTMLInputElement>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(lc.coverImageUrl)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const canDelete = lc.status !== 'LIVE'

  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: lc.title,
      description: lc.description ?? '',
    },
  })

  // ── Save title / description ──────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (data: Form) => {
      await api.patch(`/live-classes/${lc.id}`, {
        title: data.title,
        description: data.description || null,
      })
      // Upload cover separately if changed
      if (coverFile) {
        const fd = new FormData()
        fd.append('cover', coverFile)
        await api.post(`/live-classes/${lc.id}/cover`, fd)
      }
    },
    onSuccess: () => {
      toast({ title: '✅ Stream updated' })
      queryClient.invalidateQueries({ queryKey: ['live-classes'] })
      queryClient.invalidateQueries({ queryKey: ['live-class', lc.id] })
      onUpdated?.()
      onClose()
    },
    onError: (e: any) => {
      toast({ title: e?.response?.data?.message || 'Failed to update', variant: 'destructive' })
    },
  })

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/live-classes/${lc.id}`),
    onSuccess: () => {
      toast({ title: 'Stream deleted' })
      queryClient.invalidateQueries({ queryKey: ['live-classes'] })
      onDeleted?.()
      onClose()
    },
    onError: (e: any) => {
      toast({ title: e?.response?.data?.message || 'Failed to delete', variant: 'destructive' })
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

  const onSubmit = (data: Form) => {
    saveMutation.mutate(data)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 30 }}
        className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <PenLine className="w-4 h-4 text-indigo-600" />
            <h2 className="font-bold text-gray-900">Edit Stream</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Close">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">
          {/* Cover image */}
          <div>
            <Label>Cover Image</Label>
            <div className="mt-1 flex items-center gap-3">
              {coverPreview ? (
                <div className="relative w-20 h-20 rounded-xl overflow-hidden border border-gray-200 flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={coverPreview} alt="Cover" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => { setCoverPreview(null); setCoverFile(null); if (coverInputRef.current) coverInputRef.current.value = '' }}
                    className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center hover:bg-black/80"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ) : (
                <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 flex-shrink-0">
                  <ImagePlus className="w-6 h-6 text-gray-300" />
                </div>
              )}
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-xl hover:border-indigo-400 hover:bg-indigo-50 transition-colors text-sm text-gray-500"
              >
                <ImagePlus className="w-4 h-4" />
                {coverPreview ? 'Change cover' : 'Upload cover'}
              </button>
            </div>
            <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
          </div>

          {/* Title */}
          <div>
            <Label>Title *</Label>
            <Input className="mt-1" placeholder="Stream title" {...register('title')} />
            {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title.message}</p>}
          </div>

          {/* Description */}
          <div>
            <Label>Description</Label>
            <textarea
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
              rows={3}
              placeholder="Optional description..."
              {...register('description')}
            />
          </div>

          {/* Save button */}
          <Button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-700 gap-2"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              : 'Save Changes'
            }
          </Button>
        </form>

        {/* Delete section */}
        {canDelete && (
          <div className="px-5 pb-5">
            <div className="border-t border-gray-100 pt-4">
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 transition-colors text-sm font-medium"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Stream
                </button>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">This will permanently delete the stream. Are you sure?</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                      onClick={() => deleteMutation.mutate()}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending
                        ? <><Loader2 className="w-3 h-3 animate-spin" /> Deleting...</>
                        : 'Yes, Delete'
                      }
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {lc.status === 'LIVE' && (
          <div className="px-5 pb-5">
            <p className="text-xs text-center text-gray-400">End the stream first to delete it.</p>
          </div>
        )}
      </motion.div>
    </div>
  )
}
