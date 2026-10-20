'use client'

/**
 * useDmUpload — handles file/media upload for DM messages.
 *
 * Uses the existing api client (axios) so authentication is handled
 * automatically via the request interceptor — no manual token reading.
 *
 * Features:
 *  - Upload progress (0–100) via axios onUploadProgress
 *  - Cancel via AbortController
 *  - Returns upload result including mediaUrl, mimeType, fileSize, fileName
 *  - Derives msgType from MIME type automatically
 */

import { useState, useRef, useCallback } from 'react'
import api from '@/lib/api'
import type { DmMsgType } from '@/lib/dm'

export interface UploadResult {
  mediaUrl: string
  mimeType: string
  fileSize: number
  fileName: string
  msgType: DmMsgType
  duration?: number
  width?: number
  height?: number
}

export interface UploadState {
  uploading: boolean
  progress: number      // 0–100
  error: string | null
}

/** Derive DmMsgType from a MIME type string */
export function mimeToMsgType(mime: string): DmMsgType {
  if (mime.startsWith('image/gif')) return 'GIF'
  if (mime.startsWith('image/'))    return 'IMAGE'
  if (mime.startsWith('video/'))    return 'VIDEO'
  if (
    mime === 'audio/mpeg' || mime === 'audio/mp3' ||
    mime === 'audio/wav'  || mime === 'audio/ogg' ||
    mime === 'audio/aac'  || mime === 'audio/mp4' ||
    mime === 'audio/webm'
  ) return 'AUDIO'
  return 'FILE'
}

export function useDmUpload() {
  const [state, setState] = useState<UploadState>({ uploading: false, progress: 0, error: null })
  const controllerRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
    setState({ uploading: false, progress: 0, error: null })
  }, [])

  const upload = useCallback(async (file: File): Promise<UploadResult | null> => {
    setState({ uploading: true, progress: 0, error: null })
    controllerRef.current = new AbortController()

    try {
      const form = new FormData()
      form.append('file', file)

      // Use existing api client — auth header is injected by the axios interceptor
      const response = await api.post('/upload', form, {        signal: controllerRef.current.signal,
        onUploadProgress: (e: any) => {
          if (e.total) {
            setState(s => ({ ...s, progress: Math.round((e.loaded / e.total) * 100) }))
          }
        },
      })

      const record = response.data.data
      if (!record?.url) throw new Error('Upload succeeded but no URL returned')

      const msgType = mimeToMsgType(file.type)
      setState({ uploading: false, progress: 100, error: null })

      return {
        mediaUrl:  record.url,
        mimeType:  record.mimeType ?? file.type,
        fileSize:  record.size    ?? file.size,
        fileName:  record.originalName ?? file.name,
        msgType,
      }
    } catch (err: any) {
      if (err?.code === 'ERR_CANCELED' || err?.message === 'Cancelled') {
        setState({ uploading: false, progress: 0, error: null })
        return null
      }
      const msg = err?.response?.data?.message ?? err?.message ?? 'Upload failed'
      setState({ uploading: false, progress: 0, error: msg })
      return null
    }
  }, [])

  return { state, upload, cancel }
}
