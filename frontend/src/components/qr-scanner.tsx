'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Loader2 } from 'lucide-react'

interface QrScannerProps {
  onScan: (code: string) => void
  onError?: (error: string) => void
  className?: string
}

export function QrScanner({ onScan, onError, className }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'scanning' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const streamRef = useRef<MediaStream | null>(null)
  const animRef = useRef<number>()

  const startCamera = async () => {
    setStatus('loading')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
        setStatus('scanning')
        scanFrame()
      }
    } catch (e: any) {
      const msg = e.name === 'NotAllowedError'
        ? 'Camera permission denied. Please allow camera access.'
        : e.name === 'NotFoundError'
        ? 'No camera found on this device.'
        : 'Camera error: ' + e.message
      setErrorMsg(msg)
      setStatus('error')
      onError?.(msg)
    }
  }

  const stopCamera = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setStatus('idle')
  }

  const scanFrame = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      animRef.current = requestAnimationFrame(scanFrame)
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.drawImage(video, 0, 0)

    // Use BarcodeDetector API if available (Chrome 83+)
    if ('BarcodeDetector' in window) {
      type BarcodeFormat = 'qr_code' | 'aztec' | 'code_128' | 'data_matrix' | 'ean_13'
      interface BarcodeDetectorAPI {
        detect(source: HTMLCanvasElement): Promise<Array<{ rawValue: string }>>
      }
      interface BarcodeDetectorConstructor {
        new(options: { formats: BarcodeFormat[] }): BarcodeDetectorAPI
      }
      const BarcodeDetectorCtor = (window as Window & { BarcodeDetector: BarcodeDetectorConstructor }).BarcodeDetector
      const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] })
      detector.detect(canvas).then((barcodes) => {
        if (barcodes.length > 0) {
          const code = barcodes[0].rawValue
          stopCamera()
          onScan(code)
          return
        }
        animRef.current = requestAnimationFrame(scanFrame)
      }).catch(() => {
        animRef.current = requestAnimationFrame(scanFrame)
      })
    } else {
      // Fallback: just keep scanning (BarcodeDetector not available)
      animRef.current = requestAnimationFrame(scanFrame)
    }
  }

  useEffect(() => () => stopCamera(), [])

  return (
    <div className={className}>
      {status === 'idle' && (
        <div className="flex flex-col items-center gap-4 p-8 border-2 border-dashed border-gray-300 rounded-xl">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center">
            <Camera className="w-8 h-8 text-gray-400" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">QR Code Scanner</p>
            <p className="text-xs text-gray-400 mt-1">Requires camera permission and HTTPS</p>
          </div>
          <button
            onClick={startCamera}
            className="px-4 py-2 bg-halqa-700 text-white rounded-lg text-sm font-medium hover:bg-halqa-800 transition-colors flex items-center gap-2"
          >
            <Camera className="w-4 h-4" /> Start Camera
          </button>
        </div>
      )}

      {status === 'loading' && (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="w-8 h-8 text-halqa-600 animate-spin" />
          <span className="ml-3 text-sm text-gray-600">Starting camera...</span>
        </div>
      )}

      {status === 'scanning' && (
        <div className="relative rounded-xl overflow-hidden">
          <video ref={videoRef} className="w-full rounded-xl" playsInline muted />
          <canvas ref={canvasRef} className="hidden" />
          {/* Scanning overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-48 border-2 border-white rounded-xl relative">
              <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-halqa-400 rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-halqa-400 rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-halqa-400 rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-halqa-400 rounded-br-lg" />
              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-halqa-400 animate-pulse" />
            </div>
          </div>
          <button
            onClick={stopCamera}
            className="absolute top-3 right-3 p-2 bg-black/50 text-white rounded-lg hover:bg-black/70 transition-colors"
          >
            <CameraOff className="w-4 h-4" />
          </button>
          <p className="absolute bottom-3 left-0 right-0 text-center text-white text-xs bg-black/30 py-1">
            Point camera at QR code
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="p-6 bg-red-50 rounded-xl border border-red-200 text-center">
          <CameraOff className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-red-700">{errorMsg}</p>
          <p className="text-xs text-red-500 mt-1">Use manual entry instead</p>
          <button onClick={() => setStatus('idle')}
            className="mt-3 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-medium hover:bg-red-200 transition-colors">
            Try Again
          </button>
        </div>
      )}
    </div>
  )
}
