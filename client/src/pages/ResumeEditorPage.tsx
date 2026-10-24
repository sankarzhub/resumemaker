import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Download, FileText, Gauge, Save, Sparkles, Target } from 'lucide-react'
import { analyzeResume, exportUrl, getResume, improveResume, jobMatch, updateResume } from '../api/resumeApi'
import { getErrorMessage, getErrorStatus } from '../api/axios'
import { toContent, type AiSuggestion, type JobMatchReport, type QualityReport, type Resume, type ResumeContent } from '../types/resume'
import { Alert, FullPageLoader, Spinner, TextArea } from '../components/common/ui'
import { ResumeForm } from '../components/resume/ResumeForm'
import { PreviewPane } from '../components/resume/PreviewPane'
import { PreviewJump } from '../components/resume/PreviewJump'
import { JobMatchView, QualityReportView, SuggestionCard } from '../components/analysis/Reports'
import { useAuth } from '../hooks/useAuth'
import { applySuggestion } from '../utils/suggestions'

type Tab = 'edit' | 'ats' | 'match' | 'ai'
type SaveState = 'saved' | 'dirty' | 'saving' | 'error'
type Async<T> = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'done'; data: T }

const AUTOSAVE_MS = 1200

export function ResumeEditorPage() {
  const { id = '' } = useParams()
  const { aiAvailable } = useAuth()
  const [loadError, setLoadError] = useState<{ message: string; notFound: boolean } | null>(null)
  const [meta, setMeta] = useState<Pick<Resume, 'title' | 'templateId' | 'fitToPage'> | null>(null)
  const [content, setContent] = useState<ResumeContent | null>(null)
  const [save, setSave] = useState<SaveState>('saved')
  const [saveError, setSaveError] = useState('')
  const [tab, setTab] = useState<Tab>('edit')
  const [ats, setAts] = useState<Async<QualityReport>>({ kind: 'idle' })
  const [jd, setJd] = useState('')
  const [match, setMatch] = useState<Async<JobMatchReport>>({ kind: 'idle' })
  const [ai, setAi] = useState<Async<AiSuggestion[]>>({ kind: 'idle' })
  const [aiJd, setAiJd] = useState('')
  const [handled, setHandled] = useState<Record<string, 'accepted' | 'rejected'>>({})
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<{ content?: ResumeContent; meta?: Partial<Pick<Resume, 'title' | 'templateId' | 'fitToPage'>> }>({})

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const r = await getResume(id)
      setMeta({ title: r.title, templateId: r.templateId, fitToPage: Boolean(r.fitToPage) })
      setContent(toContent(r))
    } catch (err) {
      setLoadError({ message: getErrorMessage(err), notFound: getErrorStatus(err) === 404 })
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    const p = pending.current
    if (!p.content && !p.meta) return
    pending.current = {}
    setSave('saving')
    try {
      await updateResume(id, { ...(p.content ?? {}), ...(p.meta ?? {}) })
      setSave((s) => (s === 'saving' ? 'saved' : s))
      setSaveError('')
    } catch (err) {
      // Put the unsaved changes back so the next attempt includes them.
      pending.current = { content: pending.current.content ?? p.content, meta: { ...p.meta, ...pending.current.meta } }
      setSave('error')
      setSaveError(getErrorMessage(err))
    }
  }, [id])

  const schedule = useCallback(() => {
    setSave('dirty')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS)
  }, [flush])

  // Save on leave / tab close.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current.content || pending.current.meta) e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      void flush()
    }
  }, [flush])

  const changeContent = (next: ResumeContent) => {
    setContent(next)
    pending.current.content = next
    schedule()
  }
  const changeMeta = (patch: Partial<Pick<Resume, 'title' | 'templateId' | 'fitToPage'>>) => {
    setMeta((m) => (m ? { ...m, ...patch } : m))
    pending.current.meta = { ...pending.current.meta, ...patch }
    schedule()
  }

  async function runAts() {
    await flush()
    setAts({ kind: 'loading' })
    try {
      setAts({ kind: 'done', data: await analyzeResume(id) })
    } catch (err) {
      setAts({ kind: 'error', message: getErrorMessage(err) })
    }
  }

  async function runMatch() {
    await flush()
    setMatch({ kind: 'loading' })
    try {
      setMatch({ kind: 'done', data: await jobMatch(id, jd) })
    } catch (err) {
      setMatch({ kind: 'error', message: getErrorMessage(err) })
    }
  }

  async function runAi() {
    await flush()
    setAi({ kind: 'loading' })
    setHandled({})
    try {
      setAi({ kind: 'done', data: await improveResume(id, aiJd.trim() || undefined) })
    } catch (err) {
      setAi({ kind: 'error', message: getErrorMessage(err) })
    }
  }

  useEffect(() => {
    if (tab === 'ats' && ats.kind === 'idle') void runAts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
        <h1 className="title-action text-5xl">{loadError.notFound ? 'Resume not found' : 'Could not load'}</h1>
        <Alert onRetry={loadError.notFound ? undefined : load}>{loadError.message}</Alert>
        <Link to="/dashboard" className="btn btn-gold">Back to dashboard</Link>
      </div>
    )
  }
  if (!content || !meta) return <FullPageLoader label="Loading resume…" />

  const tabs: Array<{ key: Tab; label: string; icon: typeof FileText }> = [
    { key: 'edit', label: 'Edit', icon: FileText },
    { key: 'ats', label: 'ATS check', icon: Gauge },
    { key: 'match', label: 'Job match', icon: Target },
    { key: 'ai', label: 'AI boost', icon: Sparkles },
  ]
  const saveLabel = { saved: 'All changes saved', dirty: 'Unsaved changes…', saving: 'Saving…', error: 'Save failed' }[save]
  const openSuggestions = ai.kind === 'done' ? ai.data.filter((s) => !handled[s.id]) : []

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="panel flex flex-wrap items-center gap-3 p-3">
        <Link to="/dashboard" className="btn btn-ghost btn-icon" aria-label="Back to dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <input
          className="font-display min-w-0 flex-1 bg-transparent text-2xl tracking-wide text-paper outline-none focus:text-gold sm:text-3xl"
          value={meta.title}
          aria-label="Resume title"
          maxLength={120}
          onChange={(e) => changeMeta({ title: e.target.value })}
          onBlur={() => !meta.title.trim() && changeMeta({ title: 'Untitled resume' })}
        />
        <span className={`font-label flex items-center gap-1 text-sm ${save === 'error' ? 'text-bad' : save === 'saved' ? 'text-good' : 'text-gold'}`} aria-live="polite">
          {save === 'saved' ? <Check className="h-4 w-4" /> : save === 'saving' ? <Spinner label="" /> : null}
          {saveLabel}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void flush()} disabled={save === 'saved' || save === 'saving'}>
          <Save className="h-4 w-4" /> Save
        </button>
        <a className={`btn btn-hero btn-sm ${save !== 'saved' ? 'pointer-events-none opacity-50' : ''}`} href={exportUrl(id, 'pdf')} download aria-disabled={save !== 'saved'}>
          <Download className="h-4 w-4" /> PDF
        </a>
        <a className={`btn btn-bolt btn-sm ${save !== 'saved' ? 'pointer-events-none opacity-50' : ''}`} href={exportUrl(id, 'docx')} download aria-disabled={save !== 'saved'}>
          <Download className="h-4 w-4" /> DOCX
        </a>
      </div>
      {save === 'error' && <Alert onRetry={() => void flush()}>{saveError}</Alert>}

      <div className="grid gap-6 pb-20 xl:grid-cols-[1fr_minmax(0,560px)] xl:pb-0">
        <div className="min-w-0">
          <div role="tablist" className="flex flex-wrap gap-1 border-b-[3px] border-black">
            {tabs.map((t) => (
              <button key={t.key} role="tab" type="button" className="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
                <t.icon className="mr-1 inline h-4 w-4" />
                {t.label}
              </button>
            ))}
          </div>

          <div className="pt-5">
            {tab === 'edit' && <ResumeForm value={content} onChange={changeContent} />}

            {tab === 'ats' && (
              <div className="panel p-5">
                {ats.kind === 'loading' && <Spinner label="Running ATS checks…" />}
                {ats.kind === 'error' && <Alert onRetry={runAts}>{ats.message}</Alert>}
                {ats.kind === 'done' && (
                  <>
                    <QualityReportView report={ats.data} />
                    <button type="button" className="btn btn-gold btn-sm mt-5" onClick={runAts}>Re-run check</button>
                  </>
                )}
              </div>
            )}

            {tab === 'match' && (
              <div className="space-y-5">
                <div className="panel p-5">
                  <TextArea label="Job description" rows={8} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job posting here" hint="We compare the skills it asks for with evidence in your resume." />
                  <button type="button" className="btn btn-hero mt-4" onClick={runMatch} disabled={jd.trim().length < 30 || match.kind === 'loading'}>
                    <Target className="h-4 w-4" /> {match.kind === 'loading' ? 'Matching…' : 'Match my resume'}
                  </button>
                </div>
                {match.kind === 'error' && <Alert onRetry={runMatch}>{match.message}</Alert>}
                {match.kind === 'done' && <div className="panel p-5"><JobMatchView report={match.data} /></div>}
              </div>
            )}

            {tab === 'ai' && (
              <div className="space-y-5">
                <div className="panel panel-glow-gold p-5">
                  <h3 className="title-action text-3xl">AI Boost</h3>
                  <p className="mt-1 mb-4 text-sm text-muted">Claude suggests sharper wording. Nothing changes until you accept a suggestion, and it never invents facts.</p>
                  {!aiAvailable ? (
                    <Alert kind="info">AI is not configured on this server. Add ANTHROPIC_API_KEY to server/.env to enable it.</Alert>
                  ) : (
                    <>
                      <TextArea label="Tailor to a job description (optional)" rows={4} value={aiJd} onChange={(e) => setAiJd(e.target.value)} />
                      <button type="button" className="btn btn-gold mt-4" onClick={runAi} disabled={ai.kind === 'loading'}>
                        <Sparkles className="h-4 w-4" /> {ai.kind === 'loading' ? 'Thinking…' : 'Get suggestions'}
                      </button>
                    </>
                  )}
                </div>
                {ai.kind === 'loading' && <Spinner label="Claude is reviewing your resume…" />}
                {ai.kind === 'error' && <Alert onRetry={runAi}>{ai.message}</Alert>}
                {ai.kind === 'done' && ai.data.length === 0 && <Alert kind="success">No changes suggested. Your resume reads well!</Alert>}
                {ai.kind === 'done' && ai.data.length > 0 && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="font-label text-muted">
                        {openSuggestions.length} open · {Object.values(handled).filter((v) => v === 'accepted').length} accepted
                      </span>
                      {openSuggestions.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            let next = content
                            for (const s of openSuggestions) next = applySuggestion(next, s)
                            changeContent(next)
                            setHandled((h) => ({ ...h, ...Object.fromEntries(openSuggestions.map((s) => [s.id, 'accepted' as const])) }))
                          }}
                        >
                          Accept all
                        </button>
                      )}
                    </div>
                    <ul className="space-y-4">
                      {openSuggestions.map((s) => (
                        <SuggestionCard
                          key={s.id}
                          s={s}
                          onAccept={() => {
                            changeContent(applySuggestion(content, s))
                            setHandled((h) => ({ ...h, [s.id]: 'accepted' }))
                          }}
                          onReject={() => setHandled((h) => ({ ...h, [s.id]: 'rejected' }))}
                        />
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <aside id="live-preview" className="scroll-mt-24 xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:self-start xl:overflow-y-auto xl:pr-2 xl:pb-6">
          <p className="font-label mb-2 text-sm text-muted">Live preview · the exact PDF you will download</p>
          <PreviewPane
            content={content}
            templateId={meta.templateId}
            fitToPage={meta.fitToPage}
            onTemplate={(templateId) => changeMeta({ templateId })}
            onFitToPage={(fitToPage) => changeMeta({ fitToPage })}
          />
        </aside>
        <PreviewJump targetId="live-preview" />
      </div>
    </div>
  )
}
