import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileText, Highlighter, Loader2, Minimize2, Move, RotateCcw } from 'lucide-react'
import { previewPdf, type PdfPreview } from '../../api/resumeApi'
import { getErrorMessage } from '../../api/axios'
import { CONTACT_ICON_OPTIONS, TEMPLATES, type LayoutBox, type ResumeContent, type ResumeLayout, type TemplateId } from '../../types/resume'
import type { ConflictStatus } from '../../utils/resumePath'
import { loadPdfjs } from '../../utils/pdfjs'
import { ResumePreview } from './ResumePreview'
import { PdfArranger, type PageGeom } from './PdfArranger'
import { swapBlocks } from '../../utils/arrange'

const DEBOUNCE_MS = 450

interface Arrange {
  onMove: (id: string, offset: { x: number; y: number }) => void
  onReset: (id: string) => void
  onSwap: (id: string, withId: string) => void
}

/** Renders PDF bytes page by page onto canvases sized to the container, with page labels. */
function PdfPages({ data, pages, boxes, arrange }: { data: ArrayBuffer; pages: number; boxes: LayoutBox[]; arrange?: Arrange }) {
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [error, setError] = useState('')
  // Page positions and the boxes of the same render, swapped in together once the pages are drawn.
  const [drawn, setDrawn] = useState<{ pages: PageGeom[]; boxes: LayoutBox[] } | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = host.current
    if (!el || !width) return
    let cancelled = false
    ;(async () => {
      try {
        const pdfjs = await loadPdfjs()
        // pdf.js transfers the buffer to its worker, so give it a copy.
        const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise
        const frag = document.createDocumentFragment()
        const geom: Array<Omit<PageGeom, 'top' | 'left'> & { wrap: HTMLDivElement }> = []
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          const base = page.getViewport({ scale: 1 })
          const ratio = window.devicePixelRatio || 1
          const viewport = page.getViewport({ scale: (width / base.width) * ratio })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.width = `${width}px`
          canvas.style.height = `${Math.floor(viewport.height / ratio)}px`
          canvas.className = 'block bg-white shadow-2xl'
          canvas.setAttribute('aria-label', `Page ${i} of ${doc.numPages}`)
          await page.render({ canvas, viewport }).promise
          const wrap = document.createElement('div')
          wrap.className = 'relative'
          const label = document.createElement('span')
          label.className = 'pdf-page-label'
          label.textContent = `Page ${i} of ${doc.numPages}`
          wrap.append(canvas, label)
          frag.append(wrap)
          geom.push({ wrap, canvas, scale: width / base.width, width: base.width, height: base.height })
        }
        if (cancelled) return
        el.replaceChildren(frag)
        setDrawn({ pages: geom.map(({ wrap, ...g }) => ({ ...g, top: wrap.offsetTop, left: wrap.offsetLeft })), boxes })
        setError('')
        await doc.destroy()
      } catch {
        if (!cancelled) setError('Could not draw the PDF preview.')
      }
    })()
    return () => {
      cancelled = true
    }
    // A new `boxes` always comes with new `data`, so it need not trigger a redraw itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, width])

  return (
    <div>
      {error && <p className="mb-2 text-sm text-bad">{error}</p>}
      <div className="relative">
        <div ref={host} className="flex flex-col gap-5" role="document" aria-label={`Exact PDF preview, ${pages} page${pages === 1 ? '' : 's'}`} />
        {arrange && drawn && <PdfArranger boxes={drawn.boxes} pages={drawn.pages} onMove={arrange.onMove} onReset={arrange.onReset} onSwap={arrange.onSwap} />}
      </div>
    </div>
  )
}

interface Props {
  content: ResumeContent
  templateId: TemplateId
  fitToPage: boolean
  onTemplate: (t: TemplateId) => void
  onFitToPage: (v: boolean) => void
  /** Contact icons and dragged positions (PDF only). */
  layout: ResumeLayout
  onLayout: (l: ResumeLayout) => void
  /** Swapping entries or bullets on the page reorders them in the resume itself. */
  onContent: (c: ResumeContent) => void
  /** Conflict highlights; when present, a "Highlights" view is offered. */
  marks?: Record<string, ConflictStatus>
}

/**
 * Preview column: template picker, fit-to-one-page, and the EXACT PDF the export will produce
 * (rendered by the server's PDF engine), so page breaks and page count are never a surprise.
 */
export function PreviewPane({ content, templateId, fitToPage, onTemplate, onFitToPage, layout, onLayout, onContent, marks }: Props) {
  const hasMarks = Boolean(marks && Object.keys(marks).length > 0)
  // Start on the highlights when documents disagree, so the user sees where; the exact PDF is one click away.
  const [view, setView] = useState<'pdf' | 'marks'>(() => (marks && Object.values(marks).some((s) => s === 'pending') ? 'marks' : 'pdf'))
  // With a mouse, dragging is always available. On touch it is opt-in so swiping the preview still scrolls.
  const [arranging, setArranging] = useState(() => Boolean(window.matchMedia?.('(pointer: fine)').matches))
  const [pdf, setPdf] = useState<PdfPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)
  const key = JSON.stringify([content, layout])
  const moved = Object.keys(layout.offsets).length

  const setOffset = (id: string, offset: { x: number; y: number } | null) => {
    const offsets = { ...layout.offsets }
    if (offset && (offset.x !== 0 || offset.y !== 0)) offsets[id] = offset
    else delete offsets[id]
    onLayout({ ...layout, offsets })
  }

  const swap = (a: string, b: string) => {
    const out = swapBlocks(content, layout, a, b)
    if (!out) return
    if (out.content !== content) onContent(out.content)
    onLayout(out.layout)
  }

  const retry = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    const ctrl = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const [c, l] = JSON.parse(key) as [ResumeContent, ResumeLayout]
        const out = await previewPdf(c, templateId, fitToPage, l, ctrl.signal)
        setPdf(out)
        setError('')
      } catch (err) {
        if (!ctrl.signal.aborted) setError(getErrorMessage(err, 'Could not build the PDF preview.'))
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      ctrl.abort()
      window.clearTimeout(timer)
    }
  }, [key, templateId, fitToPage, nonce])

  const selected = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0]
  const pages = pdf?.pages ?? 0

  return (
    <div className="space-y-3">
      {/* Template picker */}
      <div>
        <p className="font-label mb-1.5 text-sm text-muted">Template</p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Template">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={templateId === t.id}
              title={t.description}
              onClick={() => onTemplate(t.id)}
              className={`min-h-10 rounded-md border-2 border-black px-2 py-1.5 text-sm sm:min-h-0 font-semibold transition-transform hover:-translate-y-0.5 ${templateId === t.id ? 'bg-gold text-black' : 'bg-panel-2 text-slate-200'}`}
              style={{ boxShadow: '3px 3px 0 #000', fontFamily: t.id === 'executive' ? 'Georgia, "Times New Roman", serif' : undefined }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate-400">{selected.description} All templates are single-column and ATS-safe.</p>
      </div>

      {/* Page status + fit toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border-2 border-black bg-ink/60 px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm" aria-live="polite">
          {!pdf ? (
            <span className="text-muted">Measuring pages…</span>
          ) : pages === 1 ? (
            <span className="flex items-center gap-1.5 font-semibold text-good">
              <CheckCircle2 className="h-4 w-4" /> 1 page
              {fitToPage && (pdf.scale < 1 || pdf.spacing < 1)
                ? ` (fitted: ${pdf.scale < 1 ? `text ${Math.round(pdf.scale * 100)}%, ` : ''}spacing ${Math.round(pdf.spacing * 100)}%)`
                : ''}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-semibold text-warn">
              <AlertTriangle className="h-4 w-4" /> {pages} pages
              {fitToPage && !pdf.fitted ? ' (too much content to fit at a readable size)' : ''}
            </span>
          )}
        </span>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={fitToPage} onChange={(e) => onFitToPage(e.target.checked)} />
          <Minimize2 className="h-4 w-4 text-gold" aria-hidden /> Fit to one page
        </label>
      </div>
      {pages > 1 && !fitToPage && (
        <p className="text-xs text-slate-400">
          One page is usually best with under 10 years of experience. Turn on “Fit to one page”: it balances spacing and type size so the page is full but not cramped.
        </p>
      )}
      {pages > 1 && fitToPage && pdf && !pdf.fitted && (
        <p className="text-xs text-warn">
          Too much content for one readable page in {selected.label}.{' '}
          {templateId !== 'compact' && (
            <button type="button" className="underline" onClick={() => onTemplate('compact')}>
              Try Compact
            </button>
          )}
          {templateId !== 'compact' ? ', or shorten' : 'Shorten'} the summary or older bullets.
        </p>
      )}

      {/* Contact icons */}
      <div>
        <p className="font-label mb-1.5 text-sm text-muted">Contact links</p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Contact links">
          {CONTACT_ICON_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={layout.contactIcons === o.id}
              title={o.description}
              onClick={() => onLayout({ ...layout, contactIcons: o.id })}
              className={`min-h-10 rounded-md border-2 border-black px-2 py-1.5 text-sm font-semibold transition-transform hover:-translate-y-0.5 sm:min-h-0 ${layout.contactIcons === o.id ? 'bg-gold text-black' : 'bg-panel-2 text-slate-200'}`}
              style={{ boxShadow: '3px 3px 0 #000' }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate-400">{CONTACT_ICON_OPTIONS.find((o) => o.id === layout.contactIcons)?.description} Every link is clickable in the PDF.</p>
      </div>

      {/* Drag-to-position */}
      {view === 'pdf' && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={`btn btn-sm ${arranging ? 'btn-gold' : 'btn-ghost'}`} aria-pressed={arranging} onClick={() => setArranging((a) => !a)}>
              <Move className="h-4 w-4" /> {arranging ? 'Done moving' : 'Move items'}
            </button>
            {moved > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onLayout({ ...layout, offsets: {} })}>
                <RotateCcw className="h-4 w-4" /> Reset all positions ({moved})
              </button>
            )}
          </div>
          {arranging && (
            <p className="text-xs text-slate-400">
              Drag anything on the page to place it exactly. Drop a line on another line (a job on a job, a section heading on a section heading) to swap them. Drag a section heading to move the whole section. Arrow keys nudge the selected item (Shift for bigger steps). On a phone, press and hold, then drag. Swaps change the order in both the PDF and DOCX; free positions apply to the PDF only.
            </p>
          )}
        </div>
      )}

      {/* View toggle */}
      {hasMarks && (
        <div className="flex gap-1" role="tablist" aria-label="Preview mode">
          <button role="tab" type="button" className="tab text-sm" aria-selected={view === 'pdf'} onClick={() => setView('pdf')}>
            <FileText className="mr-1 inline h-3.5 w-3.5" /> Exact PDF
          </button>
          <button role="tab" type="button" className="tab text-sm" aria-selected={view === 'marks'} onClick={() => setView('marks')}>
            <Highlighter className="mr-1 inline h-3.5 w-3.5" /> Highlights
          </button>
        </div>
      )}

      {view === 'marks' && hasMarks ? (
        <>
          <ResumePreview resume={content} template={templateId} marks={marks} />
          <p className="text-xs text-muted">Highlights view marks details to confirm. Spacing here is approximate; switch to “Exact PDF” for real pages.</p>
        </>
      ) : (
        <div className="relative">
          {loading && (
            <span className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs text-white">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating…
            </span>
          )}
          {error && !pdf && (
            <div className="rounded-md border-2 border-hero bg-hero/10 p-3 text-sm">
              {error}{' '}
              <button type="button" className="underline" onClick={retry}>
                Retry
              </button>
            </div>
          )}
          {error && pdf && <p className="mb-2 text-xs text-bad">{error} Showing the last good preview.</p>}
          {pdf && (
            <PdfPages
              data={pdf.data}
              pages={pdf.pages}
              boxes={pdf.boxes}
              arrange={arranging ? { onMove: (id, offset) => setOffset(id, offset), onReset: (id) => setOffset(id, null), onSwap: swap } : undefined}
            />
          )}
          {!pdf && !error && <div className="aspect-[210/297] w-full animate-pulse rounded bg-white/90" aria-hidden />}
        </div>
      )}
    </div>
  )
}
