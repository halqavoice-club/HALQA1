'use client'

/**
 * useDmVoiceRecorder — browser MediaRecorder-based voice message recording.
 *
 * Usage:
 *   const { state, start, stop, cancel, audioBlob } = useDmVoiceRecorder()
 */

import { useState, useRef, useCallback } from 'react'

export type RecordingState = 'idle' | 'requesting' | 'recording' | 'stopped' | 'error'

export interface VoiceRecorderState {
  status: RecordingState
  duration: number    // seconds elapsed
  error: string | null
}

export function useDmVoiceRecorder() {
  const [state, setState] = useState<VoiceRecorderState>({ status: 'idle', duration: 0, error: null })
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<BlobEvent['data'][]>([])
  const timerRef    = useRef<ReturnType<typeof setInterval>>()
  const startTimeRef = useRef<number>(0)

  const start = useCallback(async () => {
    setAudioBlob(null)
    chunksRef.current = []

    setState({ status: 'requesting', duration: 0, error: null })

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // Pick best supported MIME type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : 'audio/webm'

      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setAudioBlob(blob)
        clearInterval(timerRef.current)
        const dur = Math.round((Date.now() - startTimeRef.current) / 1000)
        setState(s => ({ ...s, status: 'stopped', duration: dur }))
      }

      recorder.start(100)
      startTimeRef.current = Date.now()
      setState({ status: 'recording', duration: 0, error: null })

      // Update elapsed time every second
      timerRef.current = setInterval(() => {
        const secs = Math.round((Date.now() - startTimeRef.current) / 1000)
        setState(s => ({ ...s, duration: secs }))
      }, 1000)

    } catch (err: any) {
      const msg = err?.message?.includes('Permission')
        ? 'Microphone permission denied'
        : err?.message ?? 'Could not start recording'
      setState({ status: 'error', duration: 0, error: msg })
    }
  }, [])

  const stop = useCallback(() => {
    recorderRef.current?.stop()
    clearInterval(timerRef.current)
  }, [])

  const cancel = useCallback(() => {
    recorderRef.current?.stop()
    clearInterval(timerRef.current)
    setAudioBlob(null)
    setState({ status: 'idle', duration: 0, error: null })
  }, [])

  const reset = useCallback(() => {
    setAudioBlob(null)
    setState({ status: 'idle', duration: 0, error: null })
  }, [])

  return { state, audioBlob, start, stop, cancel, reset }
}
