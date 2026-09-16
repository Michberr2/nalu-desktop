import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react'

export type ResizeDelta = { start: DOMRect; dx: number; dy: number }

/** A visible macOS-style grip. Movement is applied by the owning split layout. */
export default function ResizeGrip({ label, axis = 'x', corner = 'right', onResize, onReset, target, edge = false, value, min, max }: {
  label: string
  axis?: 'x' | 'y' | 'both'
  corner?: 'left' | 'right'
  onResize: (delta: ResizeDelta) => void
  onReset: () => void
  target?: () => HTMLElement | null
  edge?: boolean
  value?: number
  min?: number
  max?: number
}) {
  const [dragging, setDragging] = useState(false)
  const latest = useRef({ onResize, target }); latest.current = { onResize, target }
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => { stop.current?.() }, [])

  const begin = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    stop.current?.()
    const handle = event.currentTarget
    const panel = latest.current.target?.() || handle.parentElement
    if (!panel) return
    const start = panel.getBoundingClientRect(), x = event.clientX, y = event.clientY
    const cursor = document.body.style.cursor, selection = document.body.style.userSelect
    document.body.style.cursor = axis === 'both' ? 'nwse-resize' : axis === 'x' ? 'ew-resize' : 'ns-resize'
    document.body.style.userSelect = 'none'
    handle.focus(); handle.setPointerCapture(event.pointerId); setDragging(true)
    const apply = (e: globalThis.PointerEvent) => latest.current.onResize({ start, dx: axis === 'y' ? 0 : e.clientX - x, dy: axis === 'x' ? 0 : e.clientY - y })
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== event.pointerId || !(e.buttons & 1)) return
      apply(e)
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', end)
      handle.removeEventListener('lostpointercapture', end)
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
      document.body.style.cursor = cursor; document.body.style.userSelect = selection
      stop.current = null; setDragging(false)
    }
    // Commit the release position too: Chromium can coalesce the last move.
    const up = (e: globalThis.PointerEvent) => { if (e.pointerId === event.pointerId) { apply(e); end() } }
    const cancel = (e: globalThis.PointerEvent) => { if (e.pointerId === event.pointerId) { latest.current.onResize({ start, dx: 0, dy: 0 }); end() } }
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); latest.current.onResize({ start, dx: 0, dy: 0 }); end() }
    }
    stop.current = end
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', end)
    handle.addEventListener('lostpointercapture', end)
  }
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === 'Home') { event.preventDefault(); onReset(); return }
    const step = event.shiftKey ? 5 : 20
    const dx = axis !== 'y' ? ({ ArrowLeft: -step, ArrowRight: step }[event.key] || 0) : 0
    const dy = axis !== 'x' ? ({ ArrowUp: -step, ArrowDown: step }[event.key] || 0) : 0
    if (!dx && !dy) return
    event.preventDefault(); event.stopPropagation()
    const panel = latest.current.target?.() || event.currentTarget.parentElement
    if (panel) onResize({ start: panel.getBoundingClientRect(), dx, dy })
  }
  return <button type="button" className={`${edge ? 'panel-resize-edge' : 'panel-resize-grip'} resize-${corner} resize-${axis}${dragging ? ' is-resizing' : ''}`}
    aria-label={label} role={edge ? 'separator' : undefined}
    aria-orientation={edge ? axis === 'x' ? 'vertical' : 'horizontal' : undefined}
    aria-valuenow={edge ? value : undefined} aria-valuemin={edge ? min : undefined} aria-valuemax={edge ? max : undefined}
    title={`${label} · Drag or use arrow keys. Double-click to reset.`}
    onPointerDown={begin} onKeyDown={keyboard} onDoubleClick={onReset}>
    {!edge && <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path d="M4 14 14 4M9 14l5-5m0 5h.01" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>}
  </button>
}
