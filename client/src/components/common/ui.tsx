import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, RotateCcw, X } from 'lucide-react'

export function Spinner({ label = 'Loading…', className = '' }: { label?: string; className?: string }) {
  return (
    <span role="status" className={`inline-flex items-center gap-2 text-muted ${className}`}>
      <Loader2 className="h-5 w-5 animate-spin text-gold" aria-hidden />
      <span className="font-label">{label}</span>
    </span>
  )
}

export function FullPageLoader({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  )
}

type AlertKind = 'error' | 'success' | 'info' | 'warn'
const ALERT_STYLE: Record<AlertKind, string> = {
  error: 'bg-hero/15 border-hero text-red-100',
  success: 'bg-good/15 border-good text-emerald-100',
  info: 'bg-bolt/15 border-bolt text-blue-100',
  warn: 'bg-warn/15 border-warn text-amber-100',
}
const ALERT_ICON = { error: AlertTriangle, success: CheckCircle2, info: Info, warn: AlertTriangle }

export function Alert({ kind = 'error', children, onRetry, onClose }: { kind?: AlertKind; children: ReactNode; onRetry?: () => void; onClose?: () => void }) {
  const Icon = ALERT_ICON[kind]
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-md border-2 px-3 py-2 text-sm ${ALERT_STYLE[kind]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex-1">{children}</div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-ghost btn-sm">
          <RotateCcw className="h-3.5 w-3.5" /> Retry
        </button>
      )}
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="text-current/70 hover:text-current">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
  /** Positive confirmation shown under the field (green), e.g. "Confirmed from LinkedIn". */
  success?: string
}

export function TextField({ label, error, hint, success, className = '', ...props }: FieldProps) {
  const id = useId()
  const describedBy = error ? `${id}-err` : success ? `${id}-ok` : undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        className={`input ${success && !error ? 'border-good' : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {hint && !error && !success && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {success && !error && (
        <p id={`${id}-ok`} className="mt-1 flex items-center gap-1 text-xs font-medium text-good">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {success}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="field-error flex items-start gap-1">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
        </p>
      )}
    </div>
  )
}

interface AreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  hint?: string
}

export function TextArea({ label, hint, className = '', ...props }: AreaProps) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <textarea id={id} className="input min-h-24 resize-y leading-relaxed" {...props} />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

/** "POW!"-style starburst showing an estimated score. */
export function ScoreBurst({ score, label = 'Estimated', size = 120 }: { score: number; label?: string; size?: number }) {
  const color = score >= 80 ? 'bg-good' : score >= 60 ? 'bg-gold' : 'bg-hero'
  const word = score >= 80 ? 'POW!' : score >= 60 ? 'BAM!' : 'OOF!'
  return (
    <div className="relative inline-flex animate-pow flex-col items-center" style={{ width: size }} aria-label={`${label} score ${score} out of 100`} role="img">
      <div className="relative" style={{ width: size, height: size }}>
        <div className="burst absolute inset-0 bg-black" />
        <div className={`burst absolute inset-[5px] ${color} flex items-center justify-center`}>
          <div className="text-center leading-none">
            <div className="font-display text-black" style={{ fontSize: size * 0.34 }}>
              {score}
            </div>
            <div className="font-label text-[10px] font-bold text-black/80">/ 100</div>
          </div>
        </div>
      </div>
      <span className="caption mt-1 text-xs" aria-hidden>
        {word}
      </span>
    </div>
  )
}

export function ProgressBar({ earned, max }: { earned: number; max: number }) {
  const pct = max ? Math.round((earned / max) * 100) : 0
  const color = pct >= 80 ? 'bg-good' : pct >= 55 ? 'bg-gold' : 'bg-hero'
  return (
    <div className="h-3 w-full overflow-hidden rounded-sm border-2 border-black bg-ink" role="progressbar" aria-valuenow={earned} aria-valuemin={0} aria-valuemax={max}>
      <div className={`h-full ${color} halftone transition-all duration-700`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function SectionTitle({ kicker, title, children }: { kicker?: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {kicker && <span className="caption mb-2 text-xs">{kicker}</span>}
        <h2 className="title-action text-3xl sm:text-4xl">{title}</h2>
      </div>
      {children}
    </div>
  )
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="panel panel-glow-red w-full max-w-md animate-panel-in p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="title-action text-2xl">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
