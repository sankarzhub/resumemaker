import { CheckCircle2, ClipboardCheck, Crosshair, PenLine, Plus, Sparkles } from 'lucide-react'
import type { FixItem } from '../../utils/checklist'

/**
 * ATS "fix-it" list: what still needs attention, with one-click jumps and bullet suggestions taken
 * from the user's own documents. Items fixed since the import stay listed with a tick.
 */
export function FixChecklist({
  items,
  doneTitles,
  onJump,
  onAddBullet,
  onWriteBullet,
}: {
  items: FixItem[]
  /** Titles of issues that were present on import and are now fixed. */
  doneTitles: string[]
  onJump: (path: string) => void
  onAddBullet: (item: FixItem, text: string) => void
  onWriteBullet: (item: FixItem) => void
}) {
  const total = items.length + doneTitles.length
  if (total === 0) return null
  return (
    <section className={`panel p-4 ${items.length ? 'panel-glow-blue' : 'panel-glow-gold'}`} aria-labelledby="fix-title" id="fix-checklist">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id="fix-title" className="title-action flex items-center gap-2 text-2xl">
          <ClipboardCheck className="h-5 w-5 text-cyan" /> {items.length ? 'Make it ATS-ready' : 'ATS checklist complete'}
        </h3>
        <span className={`chip ${items.length ? 'bg-bolt text-white' : 'bg-good text-black'}`} aria-live="polite">
          {doneTitles.length} of {total} fixed
        </span>
      </div>
      <p className="mb-4 text-sm text-muted">Optional but recommended. Saving is not blocked by these.</p>

      <ol className="space-y-3">
        {items.map((it) => (
          <li key={it.id} className="rounded-md border-2 border-bolt/70 bg-bolt/10 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-paper">{it.title}</p>
                <p className="text-xs text-slate-400">{it.detail}</p>
              </div>
              {it.kind !== 'bullets' && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onJump(it.path)}>
                  <Crosshair className="h-3.5 w-3.5" /> Fix
                </button>
              )}
            </div>

            {it.kind === 'bullets' && (
              <div className="mt-3 space-y-2">
                {it.suggestions && it.suggestions.length > 0 && (
                  <div>
                    <p className="font-label mb-1 flex items-center gap-1 text-xs font-bold text-cyan">
                      <Sparkles className="h-3.5 w-3.5" /> From your documents
                    </p>
                    <ul className="space-y-1.5">
                      {it.suggestions.map((s) => (
                        <li key={s} className="flex items-start gap-2 rounded border-2 border-black bg-ink/60 p-2 text-sm text-slate-200">
                          <span className="flex-1">{s}</span>
                          <button type="button" className="btn btn-gold btn-sm shrink-0" onClick={() => onAddBullet(it, s)} aria-label={`Add bullet: ${s}`}>
                            <Plus className="h-3.5 w-3.5" /> Add
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onWriteBullet(it)}>
                    <PenLine className="h-3.5 w-3.5" /> Write my own
                  </button>
                  <span className="text-xs text-slate-500">Tip: action verb + what you did + result, e.g. “Built X with Y, cutting Z by 30%”. Only add numbers that are true.</span>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>

      {doneTitles.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-good" aria-label="Fixed">
          {doneTitles.map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" /> <span className="line-through decoration-good/60">{t}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
