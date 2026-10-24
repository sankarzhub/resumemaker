import { Check, CircleAlert, Lightbulb, X } from 'lucide-react'
import type { AiSuggestion, CategoryResult, JobMatchReport, MatchStatus, QualityReport } from '../../types/resume'
import { ProgressBar, ScoreBurst } from '../common/ui'

function Breakdown({ items }: { items: CategoryResult[] }) {
  return (
    <ul className="space-y-3">
      {items.map((c) => (
        <li key={c.key}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-label font-bold text-paper">{c.label}</span>
            <span className="font-display text-lg text-gold">
              {c.earned}/{c.max}
            </span>
          </div>
          <ProgressBar earned={c.earned} max={c.max} />
          <ul className="mt-1.5 space-y-0.5 text-xs text-slate-400">
            {c.reasons.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

export function QualityReportView({ report }: { report: QualityReport }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-5">
        <ScoreBurst score={report.score} />
        <div className="max-w-sm flex-1">
          <h3 className="title-action text-3xl">ATS Quality Check</h3>
          <p className="mt-1 text-xs text-muted">{report.disclaimer}</p>
        </div>
      </div>
      <Breakdown items={report.breakdown} />
      {report.warnings.length > 0 && (
        <div>
          <h4 className="font-label mb-1 flex items-center gap-1.5 font-bold text-warn">
            <CircleAlert className="h-4 w-4" /> Fix these
          </h4>
          <ul className="space-y-1 text-sm text-slate-300">
            {report.warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </div>
      )}
      {report.suggestions.length > 0 && (
        <div>
          <h4 className="font-label mb-1 flex items-center gap-1.5 font-bold text-cyan">
            <Lightbulb className="h-4 w-4" /> Tips
          </h4>
          <ul className="space-y-1 text-sm text-slate-300">
            {report.suggestions.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const STATUS: Record<MatchStatus, { label: string; cls: string }> = {
  'listed-and-evidenced': { label: 'Proven', cls: 'bg-good text-black' },
  evidenced: { label: 'In experience', cls: 'bg-good/70 text-black' },
  listed: { label: 'Listed only', cls: 'bg-gold text-black' },
  related: { label: 'Related', cls: 'bg-bolt text-white' },
  'not-evidenced': { label: 'Not found', cls: 'bg-hero text-white' },
}

export function JobMatchView({ report }: { report: JobMatchReport }) {
  const groups = (['required', 'preferred'] as const).map((imp) => ({ imp, skills: report.skills.filter((s) => s.importance === imp) }))
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-5">
        <ScoreBurst score={report.score} label="Job match" />
        <div className="max-w-sm flex-1">
          <h3 className="title-action text-3xl">Job Match</h3>
          {report.titleMatch.jobTitle && <p className="mt-1 text-sm text-slate-300">Role detected: {report.titleMatch.jobTitle}</p>}
          <p className="mt-1 text-xs text-muted">{report.disclaimer}</p>
        </div>
      </div>
      <Breakdown items={report.breakdown} />
      {groups.map(
        (g) =>
          g.skills.length > 0 && (
            <div key={g.imp}>
              <h4 className="font-label mb-2 font-bold text-paper">{g.imp === 'required' ? 'Required skills' : 'Nice to have'}</h4>
              <ul className="grid gap-2 sm:grid-cols-2">
                {g.skills.map((s) => (
                  <li key={s.skill} className="rounded-md border-2 border-black bg-ink/50 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{s.skill}</span>
                      <span className={`chip ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>
                    </div>
                    {s.evidence.length > 0 && <p className="mt-1 text-xs text-slate-400">Found in: {s.evidence.join(', ')}</p>}
                    {s.related.length > 0 && <p className="mt-1 text-xs text-slate-400">You show related: {s.related.join(', ')}</p>}
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
      {report.skills.length === 0 && <p className="text-sm text-muted">No recognised skills found in this job description.</p>}
      {report.suggestions.length > 0 && (
        <div className="bubble">
          <ul className="space-y-1 text-sm">
            {report.suggestions.map((s, i) => (
              <li key={i}>• {s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const SECTION_LABEL: Record<AiSuggestion['section'], string> = { summary: 'Summary', experience: 'Experience', projects: 'Project', skills: 'Add skill' }

export function SuggestionCard({ s, onAccept, onReject }: { s: AiSuggestion; onAccept: () => void; onReject: () => void }) {
  return (
    <li className="panel animate-panel-in p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="chip bg-bolt text-white">{SECTION_LABEL[s.section]}</span>
        <span className="text-xs text-muted">{s.reason}</span>
      </div>
      {s.original && (
        <p className="rounded border-2 border-black bg-hero/10 p-2 text-sm text-slate-400 line-through decoration-hero/70">{s.original}</p>
      )}
      <p className="mt-2 rounded border-2 border-black bg-good/10 p-2 text-sm text-slate-100">{s.suggested}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn-gold btn-sm" onClick={onAccept}>
          <Check className="h-4 w-4" /> Accept
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onReject}>
          <X className="h-4 w-4" /> Reject
        </button>
      </div>
    </li>
  )
}
