import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { RotateCcw } from 'lucide-react'
import type { LayoutBox } from '../../types/resume'
import { canSwap } from '../../utils/arrange'

/** Where a drawn PDF page sits inside the overlay, and its size in points. */
export interface PageGeom {
  top: number
  left: number
  /** CSS pixels per point. */
  scale: number
  width: number
  height: number
  canvas: HTMLCanvasElement
}

type Offset = { x: number; y: number }

interface Props {
  boxes: LayoutBox[]
  pages: PageGeom[]
  onMove: (id: string, offset: Offset) => void
  onReset: (id: string) => void
  /** Dropped onto a like block (bullet on bullet, entry on entry, section on section): trade places. */
  onSwap: (id: string, withId: string) => void
}

interface Drag {
  id: string
  pointerId: number
  startX: number
  startY: number
  lastY: number
  touch: boolean
  active: boolean
  timer?: number
}

/** A picture of the block being moved, shown at its new place until the re-rendered PDF arrives. */
interface Ghost {
  /** The render the picture was taken from. */
  boxes: LayoutBox[]
  id: string
  dx: number
  dy: number
  pieces: Array<{ page: number; x: number; y: number; w: number; h: number; src: string }>
}

const HOLD_MS = 280
const round = (n: number) => Math.round(n * 10) / 10
/** Room above a block for its label tag, which is finger-sized on phones (Tailwind's sm breakpoint). */
const TAG_GAP = () => (window.matchMedia?.('(min-width: 640px)').matches ? 30 : 48)

/**
 * Drag-to-position layer over the exact PDF preview. Every block the server reports (name, contacts,
 * icons, sections, entries, bullets) can be dragged; a section's heading drags the whole section, since
 * its entries sit on top of it. Offsets are in PDF points relative to where the block would naturally sit.
 * Dropping a block onto another of its kind swaps the two instead of stacking them.
 */
export function PdfArranger({ boxes, pages, onMove, onReset, onSwap }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const [ghostState, setGhost] = useState<Ghost | null>(null)
  const drag = useRef<Drag | null>(null)

  // A new render puts every block where it now belongs, so a picture taken of an older render is dropped.
  const ghost = ghostState && ghostState.boxes === boxes ? ghostState : null

  const byId = useMemo(() => {
    const m = new Map<string, LayoutBox[]>()
    for (const b of boxes) m.set(b.id, [...(m.get(b.id) ?? []), b])
    return m
  }, [boxes])
  // Containers first, so entries and bullets sit on top of (and win over) their section.
  const ordered = useMemo(() => [...boxes].sort((a, b) => b.w * b.h - a.w * a.h), [boxes])

  const rect = (b: LayoutBox) => {
    const p = pages[b.page]
    return { left: p.left + (b.x + b.ox) * p.scale, top: p.top + (b.y + b.oy) * p.scale, width: b.w * p.scale, height: b.h * p.scale }
  }

  /** How far (points) a block may move from where it is now and stay on its page(s). */
  const limits = (id: string) => {
    const lim = { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity }
    for (const b of byId.get(id) ?? []) {
      const p = pages[b.page]
      if (!p) continue
      lim.minX = Math.max(lim.minX, -(b.x + b.ox))
      lim.maxX = Math.min(lim.maxX, p.width - (b.x + b.ox + b.w))
      lim.minY = Math.max(lim.minY, -(b.y + b.oy))
      lim.maxY = Math.min(lim.maxY, p.height - (b.y + b.oy + b.h))
    }
    return lim
  }
  const clampDelta = (id: string, dx: number, dy: number) => {
    const l = limits(id)
    return { dx: Math.min(l.maxX, Math.max(l.minX, dx)), dy: Math.min(l.maxY, Math.max(l.minY, dy)) }
  }

  const snapshot = (id: string): Ghost => {
    const pieces: Ghost['pieces'] = []
    for (const b of byId.get(id) ?? []) {
      const p = pages[b.page]
      if (!p) continue
      const r = rect(b)
      const ratio = p.canvas.width / (p.width * p.scale)
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(r.width * ratio))
      c.height = Math.max(1, Math.round(r.height * ratio))
      c.getContext('2d')?.drawImage(p.canvas, (r.left - p.left) * ratio, (r.top - p.top) * ratio, c.width, c.height, 0, 0, c.width, c.height)
      pieces.push({ page: b.page, x: r.left, y: r.top, w: r.width, h: r.height, src: c.toDataURL() })
    }
    return { boxes, id, dx: 0, dy: 0, pieces }
  }

  /** The block of the same kind under the pointer, if any (the smallest, when they nest). */
  const swapTarget = (id: string, clientX: number, clientY: number): string | null => {
    const from = byId.get(id)?.[0]
    const box = root.current?.getBoundingClientRect()
    if (!from || !box) return null
    const x = clientX - box.left
    const y = clientY - box.top
    let best: { id: string; area: number } | null = null
    for (const b of boxes) {
      if (!pages[b.page] || !canSwap(from, b)) continue
      const r = rect(b)
      if (x < r.left || x > r.left + r.width || y < r.top || y > r.top + r.height) continue
      if (!best || r.width * r.height < best.area) best = { id: b.id, area: r.width * r.height }
    }
    return best?.id ?? null
  }

  const commit = (id: string, dx: number, dy: number) => {
    const b = byId.get(id)?.[0]
    if (!b || (dx === 0 && dy === 0)) return
    const c = clampDelta(id, dx, dy)
    onMove(id, { x: round(b.ox + c.dx), y: round(b.oy + c.dy) })
  }

  const start = (d: Drag) => {
    d.active = true
    setGhost(snapshot(d.id))
    if (d.touch) navigator.vibrate?.(12)
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>, b: LayoutBox) {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.focus({ preventScroll: true })
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelected(b.id)
    const d: Drag = { id: b.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, lastY: e.clientY, touch: e.pointerType !== 'mouse', active: false }
    // On touch, a press-and-hold starts the drag; a quick swipe scrolls the page instead.
    if (d.touch) d.timer = window.setTimeout(() => drag.current === d && start(d), HOLD_MS)
    drag.current = d
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const mx = e.clientX - d.startX
    const my = e.clientY - d.startY
    if (!d.active) {
      if (d.touch) {
        if (Math.hypot(mx, my) > 8) window.clearTimeout(d.timer)
        window.scrollBy(0, d.lastY - e.clientY)
        d.lastY = e.clientY
        return
      }
      if (Math.hypot(mx, my) < 3) return
      start(d)
    }
    const p = pages[byId.get(d.id)?.[0]?.page ?? 0]
    const c = clampDelta(d.id, mx / p.scale, my / p.scale)
    setGhost((g) => (g && g.id === d.id ? { ...g, dx: c.dx, dy: c.dy } : g))
    setTarget(swapTarget(d.id, e.clientX, e.clientY))
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    window.clearTimeout(d.timer)
    drag.current = null
    if (!d.active) return
    setTarget(null)
    const swapWith = swapTarget(d.id, e.clientX, e.clientY)
    if (swapWith) {
      setGhost(null)
      setSelected(null)
      onSwap(d.id, swapWith)
      return
    }
    const p = pages[byId.get(d.id)?.[0]?.page ?? 0]
    const c = clampDelta(d.id, (e.clientX - d.startX) / p.scale, (e.clientY - d.startY) / p.scale)
    if (c.dx === 0 && c.dy === 0) setGhost(null)
    else {
      setGhost((g) => (g ? { ...g, ...c } : g))
      commit(d.id, c.dx, c.dy)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>, b: LayoutBox) {
    const step = e.shiftKey ? 10 : 1
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (move) {
      e.preventDefault()
      setSelected(b.id)
      commit(b.id, move[0], move[1])
    } else if (e.key === 'Escape') setSelected(null)
  }

  const sel = selected ? byId.get(selected)?.[0] : undefined
  const ghostScale = (page: number) => pages[page]?.scale ?? 1

  return (
    <div ref={root} className="pdf-arranger absolute inset-0" onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
      {ghost?.pieces.map((g, i) => (
        <div key={`hole-${i}`} className="pointer-events-none absolute bg-white" style={{ left: g.x, top: g.y, width: g.w, height: g.h }} aria-hidden />
      ))}
      {ghost?.pieces.map((g, i) => (
        <img
          key={`ghost-${i}`}
          src={g.src}
          alt=""
          className="pdf-ghost pointer-events-none absolute"
          style={{ left: g.x + ghost.dx * ghostScale(g.page), top: g.y + ghost.dy * ghostScale(g.page), width: g.w, height: g.h }}
        />
      ))}
      {ordered.map((b, i) => {
        if (!pages[b.page]) return null
        const r = rect(b)
        const isSel = selected === b.id
        return (
          <div
            key={`${b.id}-${b.page}-${i}`}
            role="button"
            tabIndex={0}
            aria-label={`Move ${b.label}`}
            aria-pressed={isSel}
            title={b.label}
            className={`pdf-block ${isSel ? 'is-selected' : ''} ${ghost?.id === b.id ? 'is-dragging' : ''} ${target === b.id ? 'is-drop-target' : ''}`}
            style={{ left: r.left - 2, top: r.top - 2, width: r.width + 4, height: r.height + 4 }}
            onPointerDown={(e) => onPointerDown(e, b)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={(e) => onKeyDown(e, b)}
          />
        )
      })}
      {sel && pages[sel.page] && !ghost && (
        <div className="pdf-block-tag" style={{ left: rect(sel).left, top: Math.max(0, rect(sel).top - TAG_GAP()) }}>
          <span className="truncate">{sel.label}</span>
          {(sel.ox !== 0 || sel.oy !== 0) && (
            <button type="button" className="flex min-h-10 items-center gap-1 underline sm:min-h-0" onClick={() => onReset(sel.id)}>
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          )}
        </div>
      )}
    </div>
  )
}
