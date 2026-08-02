'use client'

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { Pencil, Eraser, Trash2, Minus, Circle, Square as SquareIcon, Download } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface DrawEvent {
  type: 'draw' | 'clear' | 'snapshot'
  tool?: string
  color?: string
  lineWidth?: number
  points?: { x: number; y: number; type: 'start' | 'move' | 'end' }
  dataUrl?: string  // base64 PNG — used for type: 'snapshot'
}

// Imperative handle so parent can call getSnapshot() / loadSnapshot()
export interface WhiteboardHandle {
  getSnapshot: () => string | null   // returns canvas.toDataURL() or null
  loadSnapshot: (dataUrl: string) => void
}

interface Props {
  isHost: boolean
  /** incoming draw events from socket (for students) */
  remoteEvent?: DrawEvent | null
  /** host calls this to broadcast draw events */
  onDraw?: (event: DrawEvent) => void
}

const COLORS  = ['#ffffff', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#000000']
const WIDTHS   = [2, 4, 8, 14]
type Tool = 'pen' | 'eraser' | 'line' | 'rect' | 'circle'

// ─── Component ────────────────────────────────────────────────────────────────
export const LiveClassWhiteboard = forwardRef<WhiteboardHandle, Props>(
function LiveClassWhiteboard({ isHost, remoteEvent, onDraw }, ref) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const overlayRef   = useRef<HTMLCanvasElement>(null) // shape preview layer
  const isDrawing    = useRef(false)
  const lastPoint    = useRef<{ x: number; y: number } | null>(null)
  const shapeStart   = useRef<{ x: number; y: number } | null>(null)
  // ── Stroke counter — snapshot is sent every SNAPSHOT_INTERVAL strokes
  // LC-004 FIX: Reduced from 30 → 5 so students joining mid-class see a board
  // state that is at most 4 strokes old instead of 29 strokes old.
  const strokeCount  = useRef(0)
  const SNAPSHOT_INTERVAL = 5

  const [tool,      setTool]      = useState<Tool>('pen')
  const [color,     setColor]     = useState('#ffffff')
  const [lineWidth, setLineWidth] = useState(4)

  // ── Imperative handle — lets parent get/load snapshots ─────────────────────
  useImperativeHandle(ref, () => ({
    getSnapshot: () => canvasRef.current?.toDataURL('image/png') ?? null,
    loadSnapshot: (dataUrl: string) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0)
      img.src = dataUrl
    },
  }))

  // ── Canvas helpers ──────────────────────────────────────────────────────────
  const getCtx = () => canvasRef.current?.getContext('2d') ?? null
  const getOverlay = () => overlayRef.current?.getContext('2d') ?? null

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#1e1e2e'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, [])

  useEffect(() => { initCanvas() }, [initCanvas])

  // ── Apply remote draw events (students) ────────────────────────────────────
  useEffect(() => {
    if (!remoteEvent) return
    applyDrawEvent(remoteEvent)
  }, [remoteEvent])

  const applyDrawEvent = (ev: DrawEvent) => {
    const ctx = getCtx()
    if (!ctx) return
    if (ev.type === 'snapshot' && ev.dataUrl) {
      // Restore full board from snapshot (used by students joining mid-class)
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0)
      img.src = ev.dataUrl
      return
    }
    if (ev.type === 'clear') {
      ctx.fillStyle = '#1e1e2e'
      ctx.fillRect(0, 0, canvasRef.current!.width, canvasRef.current!.height)
      return
    }
    if (!ev.points || !ev.color || !ev.lineWidth || !ev.tool) return
    const { points: p, color: c, lineWidth: lw, tool: t } = ev

    ctx.save()
    ctx.strokeStyle = t === 'eraser' ? '#1e1e2e' : c
    ctx.fillStyle   = t === 'eraser' ? '#1e1e2e' : c
    ctx.lineWidth   = t === 'eraser' ? lw * 3    : lw
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'

    if (t === 'pen' || t === 'eraser') {
      if (p.type === 'start') { ctx.beginPath(); ctx.moveTo(p.x, p.y) }
      else if (p.type === 'move') { ctx.lineTo(p.x, p.y); ctx.stroke() }
    } else if (p.type === 'end') {
      // Shapes are drawn on end
      drawShape(ctx, t, shapeStart.current ?? p, p, c, lw)
    }
    if (p.type === 'start') shapeStart.current = { x: p.x, y: p.y }
    ctx.restore()
  }

  function drawShape(
    ctx: CanvasRenderingContext2D,
    t: string,
    start: { x: number; y: number },
    end: { x: number; y: number },
    c: string,
    lw: number
  ) {
    ctx.beginPath()
    ctx.strokeStyle = c
    ctx.lineWidth   = lw
    if (t === 'line') {
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
    } else if (t === 'rect') {
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y)
    } else if (t === 'circle') {
      const rx = Math.abs(end.x - start.x) / 2
      const ry = Math.abs(end.y - start.y) / 2
      const cx = start.x + (end.x - start.x) / 2
      const cy = start.y + (end.y - start.y) / 2
      ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI)
      ctx.stroke()
    }
  }

  // ── Pointer events (host only) ──────────────────────────────────────────────
  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!
    const rect   = canvas.getBoundingClientRect()
    const scaleX = canvas.width  / rect.width
    const scaleY = canvas.height / rect.height
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
  }

  const emit = (ev: DrawEvent) => {
    applyDrawEvent(ev)   // apply locally
    onDraw?.(ev)         // broadcast to students
  }

  const onPointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isHost) return
    e.preventDefault()
    isDrawing.current = true
    const pos = getPos(e)
    lastPoint.current  = pos
    shapeStart.current = pos
    const ctx = getCtx()
    if (!ctx) return
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    emit({ type: 'draw', tool, color, lineWidth, points: { ...pos, type: 'start' } })
  }

  const onPointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isHost || !isDrawing.current) return
    e.preventDefault()
    const pos = getPos(e)

    if (tool === 'pen' || tool === 'eraser') {
      const ctx = getCtx()
      if (!ctx) return
      ctx.save()
      ctx.strokeStyle = tool === 'eraser' ? '#1e1e2e' : color
      ctx.lineWidth   = tool === 'eraser' ? lineWidth * 3 : lineWidth
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(lastPoint.current!.x, lastPoint.current!.y)
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
      ctx.restore()
      emit({ type: 'draw', tool, color, lineWidth, points: { ...pos, type: 'move' } })
    } else {
      // Shape preview on overlay
      const ov = getOverlay()
      if (!ov) return
      ov.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height)
      drawShape(ov, tool, shapeStart.current!, pos, color, lineWidth)
    }
    lastPoint.current = pos
  }

  const onPointerUp = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isHost || !isDrawing.current) return
    isDrawing.current = false
    const pos = lastPoint.current!

    if (tool !== 'pen' && tool !== 'eraser') {
      const ov = getOverlay()
      ov?.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height)
      emit({ type: 'draw', tool, color, lineWidth, points: { ...pos, type: 'end' } })
    } else {
      emit({ type: 'draw', tool, color, lineWidth, points: { ...pos, type: 'end' } })
    }

    // ── Periodic snapshot — every SNAPSHOT_INTERVAL strokes ────────────────
    // This keeps Redis up-to-date so students who join mid-class get
    // a reasonably recent board state without replaying all events.
    strokeCount.current += 1
    if (strokeCount.current % SNAPSHOT_INTERVAL === 0) {
      const dataUrl = canvasRef.current?.toDataURL('image/png')
      if (dataUrl) onDraw?.({ type: 'snapshot', dataUrl })
    }
  }

  const clearBoard = () => {
    const ctx = getCtx()
    if (!ctx) return
    ctx.fillStyle = '#1e1e2e'
    ctx.fillRect(0, 0, canvasRef.current!.width, canvasRef.current!.height)
    strokeCount.current = 0  // reset counter after clear
    emit({ type: 'clear' })
  }

  const downloadBoard = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const a = document.createElement('a')
    a.download = 'whiteboard.png'
    a.href = canvas.toDataURL()
    a.click()
  }

  return (
    <div className="flex flex-col bg-gray-950/60 border border-gray-700/50 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 bg-gray-900/80 border-b border-gray-800 flex-wrap">
        {/* Tools */}
        <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
          {([
            { id: 'pen',    icon: <Pencil    className="w-3.5 h-3.5" />, label: 'Pen'     },
            { id: 'eraser', icon: <Eraser    className="w-3.5 h-3.5" />, label: 'Eraser'  },
            { id: 'line',   icon: <Minus     className="w-3.5 h-3.5" />, label: 'Line'    },
            { id: 'rect',   icon: <SquareIcon className="w-3.5 h-3.5" />, label: 'Rect'  },
            { id: 'circle', icon: <Circle    className="w-3.5 h-3.5" />, label: 'Circle'  },
          ] as { id: Tool; icon: React.ReactNode; label: string }[]).map(({ id, icon, label }) => (
            <button
              key={id}
              title={label}
              disabled={!isHost}
              onClick={() => setTool(id)}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                tool === id ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700',
                !isHost && 'opacity-50 cursor-not-allowed'
              )}
            >
              {icon}
            </button>
          ))}
        </div>

        {/* Colors */}
        <div className="flex items-center gap-1">
          {COLORS.map(c => (
            <button
              key={c}
              disabled={!isHost}
              onClick={() => setColor(c)}
              className={cn(
                'w-4 h-4 rounded-full transition-transform border',
                color === c ? 'scale-125 border-white' : 'border-transparent hover:scale-110',
                !isHost && 'opacity-50 cursor-not-allowed'
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        {/* Line widths */}
        <div className="flex items-center gap-1">
          {WIDTHS.map(w => (
            <button
              key={w}
              disabled={!isHost}
              onClick={() => setLineWidth(w)}
              className={cn(
                'w-6 h-6 rounded-md flex items-center justify-center hover:bg-gray-700 transition-colors',
                lineWidth === w ? 'bg-gray-600' : '',
                !isHost && 'opacity-50 cursor-not-allowed'
              )}
            >
              <span
                className="bg-white rounded-full"
                style={{ width: Math.min(w * 1.5, 16), height: Math.min(w * 1.5, 16) }}
              />
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={downloadBoard} title="Download" className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
            <Download className="w-3.5 h-3.5" />
          </button>
          {isHost && (
            <button onClick={clearBoard} title="Clear board" className="p-1.5 rounded-lg hover:bg-red-900/40 text-gray-400 hover:text-red-400 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Canvas area */}
      <div className="relative select-none">
        <canvas
          ref={canvasRef}
          width={800}
          height={450}
          className={cn(
            'w-full block',
            isHost && 'cursor-crosshair'
          )}
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onMouseLeave={onPointerUp}
          onTouchStart={onPointerDown}
          onTouchMove={onPointerMove}
          onTouchEnd={onPointerUp}
        />
        {/* Shape preview overlay */}
        <canvas
          ref={overlayRef}
          width={800}
          height={450}
          className="absolute inset-0 w-full pointer-events-none"
        />
        {!isHost && (
          <div className="absolute bottom-2 right-2 text-[10px] text-gray-500 bg-gray-900/70 px-2 py-0.5 rounded-full">
            View only
          </div>
        )}
      </div>
    </div>
  )
})

// Display name for React DevTools
LiveClassWhiteboard.displayName = 'LiveClassWhiteboard'
