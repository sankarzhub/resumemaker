import { AlertTriangle, Check, CheckCircle2, ChevronRight, Crosshair, PencilLine } from 'lucide-react'
import type { Conflict, ResumeContent } from '../../types/resume'
import { conflictId, conflictStatus, describePath, getByPath } from '../../utils/resumePath'

/**
 * Documents disagreed on these facts. Each card says exactly where the field is, what each document
 * says, what the resume uses right now, and whether the user has settled it.
 */
export function ConflictsPanel({
  conflicts,
  draft,
  choices,
  onChoose,
  onJump,
}: {
  conflicts: Conflict[]
  draft: ResumeContent
  choices: Record<string, string>
  onChoose: (c: Conflict, value: string) => void
  onJump: (path: string) => void
}) {
  const statuses = conflicts.map((c) => conflictStatus(c, draft, choices))
  const open = statuses.filter((s) => s === 'pending').length
  const done = conflicts.length - open

  return (
    <section id="conflicts" className={`panel p-4 ${open ? 'panel-glow-red' : 'panel-glow-gold'}`} aria-labelledby="conflicts-title">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id="conflicts-title" className="title-action flex items-center gap-2 text-2xl">
          {open ? <AlertTriangle className="h-5 w-5 text-hero" /> : <CheckCircle2 className="h-5 w-5 text-good" />}
          {open ? 'Your documents disagree' : 'All differences confirmed'}
        </h3>
        <span className={`chip ${open ? 'bg-hero text-white' : 'bg-good text-black'}`} aria-live="polite">
          {done} of {conflicts.length} confirmed
        </span>
      </div>
      <p className="mb-4 text-sm text-muted">
        {open
          ? 'For each item, pick the correct value (or edit the field yourself). Saving unlocks when every item is confirmed.'
          : 'Every difference is settled. You can still change a choice below.'}
      </p>

      <ol className="space-y-3">
        {conflicts.map((c, i) => {
          const status = statuses[i]
          const id = conflictId(c)
          const where = c.path ? describePath(draft, c.path) : [c.label]
          const current = c.path ? (getByPath(draft, c.path) ?? '') : ''
          const chosenOption = c.options.find((o) => o.value === current)
          return (
            <li
              key={id}
              className={`rounded-md border-2 p-3 transition-colors ${status === 'pending' ? 'border-hero bg-hero/10' : 'border-good/70 bg-good/10'}`}
              data-conflict-id={id}
            >
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-label flex flex-wrap items-center gap-1 text-xs font-bold text-muted" aria-label={`Location: ${where.join(', ')}`}>
                    <span className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-sm border-2 border-black bg-paper text-[11px] text-black">{i + 1}</span>
                    {where.map((w, k) => (
                      <span key={k} className="inline-flex items-center gap-1">
                        {k > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}
                        <span className={k === where.length - 1 ? 'text-paper' : ''}>{w}</span>
                      </span>
                    ))}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {status === 'pending' ? (
                    <span className="chip bg-hero text-white">
                      <AlertTriangle className="h-3 w-3" /> Needs your choice
                    </span>
                  ) : status === 'chosen' ? (
                    <span className="chip bg-good text-black">
                      <Check className="h-3 w-3" /> Confirmed
                    </span>
                  ) : status === 'edited' ? (
                    <span className="chip bg-good text-black">
                      <PencilLine className="h-3 w-3" /> You edited it
                    </span>
                  ) : (
                    <span className="chip bg-panel-2 text-slate-200">Entry removed</span>
                  )}
                  {c.path && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onJump(c.path!)}>
                      <Crosshair className="h-3.5 w-3.5" /> Show me
                    </button>
                  )}
                </div>
              </div>

              {status !== 'removed' && (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={where.join(' / ')}>
                {c.options.map((o) => {
                  const active = choices[id] === o.value || (status !== 'pending' && current === o.value)
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => onChoose(c, o.value)}
                      className={`relative rounded-md border-2 border-black px-3 py-1.5 text-left text-sm transition-transform hover:-translate-y-0.5 ${active ? 'bg-gold text-black' : 'bg-panel-2 text-slate-100'}`}
                      style={{ boxShadow: '3px 3px 0 #000' }}
                    >
                      <span className="flex items-center gap-1.5 font-semibold">
                        {active && <Check className="h-3.5 w-3.5" aria-hidden />}
                        {o.value}
                      </span>
                      <span className={`block text-xs ${active ? 'text-black/70' : 'text-muted'}`}>from {o.source}</span>
                    </button>
                  )
                })}
              </div>
              )}

              <p className="mt-2 text-xs text-slate-300">
                {status === 'removed' ? (
                  <>You deleted the entry this belonged to, so nothing to confirm.</>
                ) : status === 'pending' ? (
                  <>
                    Resume currently shows <strong className="text-paper">“{current || '—'}”</strong> (pre-filled from {chosenOption?.source ?? 'the first document'}). Not confirmed yet.
                  </>
                ) : status === 'chosen' ? (
                  <>
                    ✓ Using <strong className="text-paper">“{current}”</strong>
                    {chosenOption ? ` from ${chosenOption.source}` : ''}.
                  </>
                ) : (
                  <>
                    ✓ Using your own value <strong className="text-paper">“{current || '(empty)'}”</strong>.
                  </>
                )}
              </p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
