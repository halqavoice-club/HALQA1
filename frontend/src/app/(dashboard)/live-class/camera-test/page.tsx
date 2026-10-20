'use client'
/**
 * Camera Diagnostic Page — /live-class/camera-test
 * Tests camera access step by step without LiveKit.
 * Open this page to see exactly why camera is failing.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

type Step = {
  id: string
  label: string
  status: 'pending' | 'running' | 'ok' | 'fail' | 'warn'
  detail: string
}

export default function CameraTestPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [steps, setSteps] = useState<Step[]>([
    { id: 'https',      label: '1. Secure context (HTTPS / localhost)',   status: 'pending', detail: '' },
    { id: 'policy',     label: '2. Permissions-Policy header',            status: 'pending', detail: '' },
    { id: 'api',        label: '3. getUserMedia API available',           status: 'pending', detail: '' },
    { id: 'permission', label: '4. Camera permission state',              status: 'pending', detail: '' },
    { id: 'open',       label: '5. Open camera stream',                   status: 'pending', detail: '' },
    { id: 'render',     label: '6. Render video in <video> element',      status: 'pending', detail: '' },
  ])
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  function setStep(id: string, status: Step['status'], detail: string) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status, detail } : s))
  }

  async function runDiagnostic() {
    setRunning(true)
    setDone(false)
    setSteps(s => s.map(x => ({ ...x, status: 'pending', detail: '' })))
    if (stream) { stream.getTracks().forEach(t => t.stop()); setStream(null) }

    // ── Step 1: Secure context ────────────────────────────────────────────────
    setStep('https', 'running', '')
    await delay(300)
    const isSecure = window.isSecureContext
    const proto    = window.location.protocol
    const host     = window.location.hostname
    if (isSecure) {
      setStep('https', 'ok', `✅ ${proto}//${host} — isSecureContext = true`)
    } else {
      setStep('https', 'fail',
        `❌ ${proto}//${host} — isSecureContext = false.\n` +
        `Camera/mic require HTTPS or localhost.\n` +
        `Fix: open http://localhost:3000 instead of http://${host}:${window.location.port}`)
      setRunning(false); setDone(true); return
    }

    // ── Step 2: Permissions-Policy header ────────────────────────────────────
    setStep('policy', 'running', '')
    await delay(200)
    try {
      // document.featurePolicy was deprecated but still useful for diagnosis
      const fp = (document as any).featurePolicy || (document as any).permissionsPolicy
      if (fp) {
        const allowed = fp.allowedFeatures?.() ?? []
        const cameraAllowed = fp.allowsFeature?.('camera', window.location.origin)
        if (cameraAllowed === false) {
          setStep('policy', 'fail',
            `❌ Permissions-Policy BLOCKS camera for this origin.\n` +
            `Allowed features: ${allowed.join(', ')}\n\n` +
            `Fix: In next.config.js change:\n` +
            `  camera=(self)  →  camera=*\n` +
            `Then restart the Next.js dev server.`)
        } else if (cameraAllowed === true) {
          setStep('policy', 'ok',
            `✅ Permissions-Policy allows camera.\nAllowed features include: ${allowed.slice(0,6).join(', ')}`)
        } else {
          setStep('policy', 'warn',
            `⚠️ Could not determine policy state via featurePolicy API.\n` +
            `Current next.config.js sets: camera=*  (correct value).\n` +
            `If you still get permission errors, restart the dev server.`)
        }
      } else {
        // Fallback: check via fetch HEAD to see the response header
        try {
          const res = await fetch(window.location.href, { method: 'HEAD' })
          const pp = res.headers.get('permissions-policy')
          if (pp) {
            const blocked = pp.includes('camera=()') || (pp.includes('camera=(') && !pp.includes('camera=(*)') && !pp.includes('camera=*'))
            if (blocked) {
              setStep('policy', 'fail',
                `❌ Permissions-Policy header blocks camera: "${pp}"\n` +
                `Fix: Set camera=* in next.config.js and restart the dev server.`)
            } else {
              setStep('policy', 'ok', `✅ Permissions-Policy: "${pp}"`)
            }
          } else {
            setStep('policy', 'warn',
              `⚠️ No Permissions-Policy header found (may be cached).\n` +
              `Expected: camera=*, microphone=*, display-capture=*\n` +
              `Restart the Next.js dev server if you just changed next.config.js.`)
          }
        } catch {
          setStep('policy', 'warn',
            `⚠️ Could not fetch headers to check policy.\n` +
            `Ensure next.config.js has camera=* and restart the dev server.`)
        }
      }
    } catch (e: any) {
      setStep('policy', 'warn', `⚠️ Could not check Permissions-Policy: ${e.message}`)
    }
    await delay(200)    // ── Step 3: API available ─────────────────────────────────────────────────
    setStep('api', 'running', '')
    await delay(200)
    if (!navigator.mediaDevices?.getUserMedia) {
      setStep('api', 'fail', '❌ navigator.mediaDevices.getUserMedia is not available.\nThis browser does not support WebRTC camera access.')
      setRunning(false); setDone(true); return
    }
    setStep('api', 'ok', '✅ navigator.mediaDevices.getUserMedia is available')

    // ── Step 4: Permission state ──────────────────────────────────────────────
    setStep('permission', 'running', '')
    await delay(200)
    try {
      const perm = await navigator.permissions.query({ name: 'camera' as PermissionName })
      const permDetail = `Permissions API says: "${perm.state}"`
      if (perm.state === 'denied') {
        setStep('permission', 'fail',
          `❌ ${permDetail}\n` +
          `The browser has camera blocked for this site.\n` +
          `Fix: click the camera icon in the address bar → Allow → Reload`)
        setRunning(false); setDone(true); return
      } else if (perm.state === 'granted') {
        setStep('permission', 'ok', `✅ ${permDetail}`)
      } else {
        setStep('permission', 'warn', `⚠️ ${permDetail} — browser will show a popup when we request camera`)
      }
    } catch (e: any) {
      // Firefox doesn't support permissions.query for 'camera'
      setStep('permission', 'warn', `⚠️ Permissions API not supported — will try directly (${e.message})`)
    }

    // Enumerate devices
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices()
      const cameras = allDevices.filter(d => d.kind === 'videoinput')
      setDevices(cameras)
    } catch {}

    // ── Step 4: Open camera ───────────────────────────────────────────────────
    setStep('open', 'running', '')
    await delay(200)
    let mediaStream: MediaStream
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      })
      setStream(mediaStream)
      const tracks = mediaStream.getVideoTracks()
      setStep('open', 'ok',
        `✅ Stream opened — ${tracks.length} video track(s)\n` +
        tracks.map(t => `  • ${t.label} (${t.readyState})`).join('\n'))
    } catch (e: any) {
      const name = (e?.name || '').toLowerCase()
      let fix = ''
      if (name === 'notallowederror') {
        fix = '\nFix: click the camera icon in the address bar → Allow → Reload'
      } else if (name === 'notfounderror') {
        fix = '\nFix: connect a camera/webcam and try again'
      } else if (name === 'notreadableerror') {
        fix = '\nFix: close any other app using the camera (Zoom, Teams, Meet, OBS)'
      } else if (name === 'overconstrainederror') {
        fix = '\nFix: try a different browser or camera'
      }
      setStep('open', 'fail', `❌ ${e.name}: ${e.message}${fix}`)
      setRunning(false); setDone(true); return
    }

    // ── Step 5: Render video ──────────────────────────────────────────────────
    setStep('render', 'running', '')
    await delay(300)
    if (videoRef.current) {
      videoRef.current.srcObject = mediaStream!
      await videoRef.current.play().catch(() => {})
      const w = videoRef.current.videoWidth
      const h = videoRef.current.videoHeight
      setTimeout(() => {
        const w2 = videoRef.current?.videoWidth ?? 0
        const h2 = videoRef.current?.videoHeight ?? 0
        if (w2 > 0 && h2 > 0) {
          setStep('render', 'ok', `✅ Video rendering at ${w2}×${h2}px — camera is working!`)
        } else {
          setStep('render', 'warn', `⚠️ Video element attached but no frame received yet (${w}×${h}). Check the preview below.`)
        }
      }, 1000)
    } else {
      setStep('render', 'warn', '⚠️ Video ref not ready')
    }

    setRunning(false)
    setDone(true)
  }

  function stopStream() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); setStream(null) }
    if (videoRef.current) videoRef.current.srcObject = null
  }

  useEffect(() => () => { stopStream() }, [])

  const statusIcon = (s: Step['status']) => ({
    pending: '⬜', running: '🔄', ok: '✅', fail: '❌', warn: '⚠️'
  }[s])

  const statusColor = (s: Step['status']) => ({
    pending: 'text-gray-500',
    running: 'text-yellow-400',
    ok:      'text-green-400',
    fail:    'text-red-400',
    warn:    'text-yellow-400',
  }[s])

  const overallOk = done && steps.every(s => s.status === 'ok' || s.status === 'warn')

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">📷 Camera Diagnostic</h1>
        <p className="text-gray-500 text-sm mt-1">
          Step-by-step test of camera access — independent of LiveKit.
          Run this to find exactly why your camera isn't working.
        </p>
      </div>

      {/* Context info */}
      <div className="bg-gray-50 rounded-xl p-4 text-sm font-mono space-y-1">
        <p><span className="text-gray-500">URL:</span> {typeof window !== 'undefined' ? window.location.href : ''}</p>
        <p><span className="text-gray-500">Secure:</span> {typeof window !== 'undefined' ? String(window.isSecureContext) : '?'}</p>
        <p><span className="text-gray-500">Protocol:</span> {typeof window !== 'undefined' ? window.location.protocol : '?'}</p>
        <p><span className="text-gray-500">Cameras found:</span> {devices.length > 0 ? devices.map(d => d.label || `Camera (${d.deviceId.slice(0,6)})`).join(', ') : 'Run test to enumerate'}</p>
      </div>

      {/* Steps */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {steps.map(step => (
          <div key={step.id} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-lg w-6 text-center flex-shrink-0">
                {step.status === 'running' ? (
                  <span className="inline-block animate-spin">🔄</span>
                ) : statusIcon(step.status)}
              </span>
              <span className={`font-medium text-sm ${statusColor(step.status)}`}>
                {step.label}
              </span>
            </div>
            {step.detail && (
              <pre className={`mt-2 ml-9 text-xs whitespace-pre-wrap font-mono ${
                step.status === 'fail' ? 'text-red-600' :
                step.status === 'warn' ? 'text-yellow-600' :
                'text-gray-600'
              }`}>{step.detail}</pre>
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={runDiagnostic}
          disabled={running}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm disabled:opacity-50 transition-colors"
        >
          {running ? '⏳ Running…' : overallOk ? '🔄 Run Again' : '▶ Run Camera Test'}
        </button>
        {stream && (
          <button
            onClick={stopStream}
            className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold text-sm transition-colors"
          >
            Stop Camera
          </button>
        )}
      </div>

      {/* Result summary */}
      {done && (
        <div className={`rounded-xl p-4 ${overallOk ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          {overallOk ? (
            <p className="text-green-700 font-semibold">
              ✅ Camera is working! If it still doesn't work in the live room, the issue is with LiveKit connection, not camera permissions.
            </p>
          ) : (
            <div className="text-red-700 text-sm">
              <p className="font-semibold mb-1">❌ Camera access failed. See the failed step above for the fix.</p>
              {steps.find(s => s.status === 'fail')?.detail?.includes('localhost') && (
                <p className="mt-2 font-mono bg-red-100 rounded px-3 py-2">
                  Quick fix: Change your URL to <strong>http://localhost:3000</strong>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Live video preview */}
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-2">Camera Preview</p>
        <div className="relative bg-gray-900 rounded-xl overflow-hidden aspect-video max-w-sm">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          {!stream && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
              Run the test to see your camera here
            </div>
          )}
        </div>
      </div>

      {/* How to fix each error */}
      <div className="bg-blue-50 rounded-xl p-4 text-sm space-y-3">
        <p className="font-semibold text-blue-800">Common fixes:</p>
        <div className="space-y-2 text-blue-700">
          <p><strong>"NotAllowedError" / "Permission denied"</strong><br/>
            Even if you allowed it: click the 🔒 padlock in the browser address bar → Camera → Allow → Reload the page.
            Or go to Chrome Settings → Privacy → Camera → find localhost and remove the block.
          </p>
          <p><strong>Running on http://192.168.x.x (not localhost)</strong><br/>
            Camera requires HTTPS or localhost. Change your browser URL to <code>http://localhost:3000</code>.
          </p>
          <p><strong>"NotReadableError" / "Camera busy"</strong><br/>
            Close all other apps using the camera: Zoom, Teams, Meet, OBS, Discord, Skype.
          </p>
          <p><strong>"NotFoundError" / "No camera"</strong><br/>
            Connect a USB webcam or enable your built-in camera in Device Manager.
          </p>
        </div>
      </div>
    </div>
  )
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }
