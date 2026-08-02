'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Camera, Loader2, X } from 'lucide-react'
import { resolveMediaUrl } from '@/lib/media'

interface SchoolLogoUploadProps {
  schoolId: string
  currentLogoUrl?: string | null
  schoolName: string
  onUpdated?: (logoUrl: string | null) => void
}

export function SchoolLogoUpload({ schoolId, currentLogoUrl, schoolName, onUpdated }: SchoolLogoUploadProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const logoSrc = preview || (currentLogoUrl ? resolveMediaUrl(currentLogoUrl) : null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      toast({ title: 'Only JPEG, PNG, WebP or SVG allowed', variant: 'destructive' }); return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'Logo must be under 2 MB', variant: 'destructive' }); return
    }

    setPreview(URL.createObjectURL(file))
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('logo', file)
      const res = await api.post(`/schools/${schoolId}/logo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      const logoUrl = res.data.data?.logoUrl
      onUpdated?.(logoUrl)
      queryClient.invalidateQueries({ queryKey: ['school'] })
      toast({ title: 'School logo updated' })
    } catch (err: any) {
      toast({ title: err.response?.data?.message || 'Upload failed', variant: 'destructive' })
      setPreview(null)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleRemove = async () => {
    setUploading(true)
    try {
      await api.put(`/schools/${schoolId}`, { logoUrl: null })
      setPreview(null)
      onUpdated?.(null)
      queryClient.invalidateQueries({ queryKey: ['school'] })
      toast({ title: 'Logo removed' })
    } catch {
      toast({ title: 'Failed to remove logo', variant: 'destructive' })
    } finally { setUploading(false) }
  }

  return (
    <div className="flex items-center gap-4">
      {/* Logo preview */}
      <div className="relative">
        <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden bg-gray-50">
          {logoSrc ? (
            <img src={logoSrc} alt={schoolName} className="w-full h-full object-contain p-1" />
          ) : (
            <span className="text-2xl font-bold text-gray-400">{schoolName[0]}</span>
          )}
          {uploading && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-xl">
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            </div>
          )}
        </div>

        {/* Camera button */}
        {!uploading && (
          <button
            onClick={() => fileRef.current?.click()}
            className="absolute -bottom-1 -right-1 w-7 h-7 bg-halqa-700 rounded-full flex items-center justify-center text-white hover:bg-halqa-800 shadow-md"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Remove button */}
        {logoSrc && !uploading && (
          <button
            onClick={handleRemove}
            className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 shadow-md"
          >
            <X className="w-3 h-3" />
          </button>
        )}

        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml"
          className="hidden" onChange={handleFile} />
      </div>

      <div>
        <p className="text-sm font-medium text-gray-900">School Logo</p>
        <p className="text-xs text-gray-400 mt-0.5">JPEG, PNG, WebP or SVG · Max 2 MB</p>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="text-xs text-halqa-600 hover:text-halqa-800 mt-1 disabled:opacity-50"
        >
          {logoSrc ? 'Change logo' : 'Upload logo'}
        </button>
      </div>
    </div>
  )
}
