import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardPaste, FileText, FileUp, Save, Sparkles, Wand2, X } from 'lucide-react'
import { createResume, importText, uploadResume } from '../api/resumeApi'
import { getErrorMessage } from '../api/axios'
import type { Conflict, DocRole, ImportResult, ResumeContent, TemplateId } from '../types/resume'
import { ConflictsPanel } from '../components/analysis/ConflictsPanel'
import { FixChecklist } from '../components/analysis/FixChecklist'
import { buildChecklist, type AnchoredSuggestion, type FixItem } from '../utils/checklist'
import { anchorConflicts, conflictId, conflictMap, conflictStatus, describePath, jumpToPath, keyEntries, liveConflicts, setByPath, stripKeys } from '../utils/resumePath'
import { Alert, TextArea, TextField } from '../components/common/ui'
import { ResumeForm } from '../components/resume/ResumeForm'
import { PreviewPane } from '../components/resume/PreviewPane'
import { PreviewJump } from '../components/resume/PreviewJump'
import { JobMatchView, QualityReportView } from '../components/analysis/Reports'
import { useAuth } from '../hooks/useAuth'

const ACCEPT = '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp'
const MAX_MB = 5
const MAX_FILES = 4

interface PickedFile {
  file: File
  role: DocRole | 'auto'
}

// LinkedIn's "Save to PDF" export is named Profile.pdf by default.
function guessRole(name: string): PickedFile['role'] {
  return /linkedin|^profile(\s*\(\d+\))?\.pdf$/i.test(name) ? 'linkedin' : 'auto'
}

const ROLE_OPTIONS: Array<{ value: PickedFile['role']; label: string }> = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'resume', label: 'Resume / CV' },
  { value: 'linkedin', label: 'LinkedIn profile PDF' },
  { value: 'other', label: 'Other document' },
]

const LOADING_LINES = ['Reading your document…', 'Finding your skills and experience…', 'Rewriting bullets with action verbs…', 'Formatting for ATS parsers…', 'Almost there…']

export function ImportPage() {
  const { aiAvailable, uploadTotalMb } = useAuth()
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'file' | 'text'>('file')
  const [files, setFiles] = useState<PickedFile[]>([])
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [anchored, setAnchored] = useState<Conflict[]>([])
  const [suggestions, setSuggestions] = useState<AnchoredSuggestion[]>([])
  const [templateId, setTemplateId] = useState<TemplateId>('classic')
  const [fitToPage, setFitToPage] = useState(false)
  const [initialIssues, setInitialIssues] = useState<Record<string, string>>({})
  const [text, setText] = useState('')
  const [useAi, setUseAi] = useState(true)
  const [jd, setJd] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<'input' | 'working' | 'review'>('input')
  const [lineIdx, setLineIdx] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [draft, setDraft] = useState<ResumeContent | null>(null)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [reviewTab, setReviewTab] = useState<'edit' | 'report'>('edit')

  const aiOn = useAi && aiAvailable

  function pickFiles(list: FileList | null | undefined) {
    setError('')
    if (!list?.length) return
    const next = [...files]
    for (const f of Array.from(list)) {
      if (/\.doc$/i.test(f.name)) {
        setError(`"${f.name}" is an old Word file. Save it as .docx or PDF and upload that.`)
        continue
      }
      if (!/\.(pdf|docx|txt|md|png|jpe?g|webp)$/i.test(f.name)) {
        setError(`"${f.name}" is not supported. Upload a PDF, DOCX, TXT or an image (PNG/JPG).`)
        continue
      }
      if (/\.(png|jpe?g|webp)$/i.test(f.name) && !aiAvailable) {
        setError(`"${f.name}" is an image. Reading images needs the AI option, which isn't set up on this server. Upload the PDF or DOCX instead.`)
        continue
      }
      if (f.size > MAX_MB * 1024 * 1024) {
        setError(`"${f.name}" is too large. The maximum size is ${MAX_MB} MB per file.`)
        continue
      }
      if (next.some((x) => x.file.name === f.name && x.file.size === f.size)) continue
      if (next.length >= MAX_FILES) {
        setError(`You can upload up to ${MAX_FILES} documents.`)
        break
      }
      if (uploadTotalMb && next.reduce((sum, x) => sum + x.file.size, f.size) > uploadTotalMb * 1024 * 1024) {
        setError(`These files add up to more than ${uploadTotalMb} MB, the most this server accepts in one upload. Remove one, or upload a smaller PDF.`)
        continue
      }
      next.push({ file: f, role: guessRole(f.name) })
    }
    setFiles(next)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function start() {
    setError('')
    if (mode === 'file' && !files.length) return setError('Choose at least one file.')
    if (mode === 'text' && text.trim().length < 80) return setError('Paste at least a few lines about your background (80+ characters).')
    setPhase('working')
    setProgress(0)
    setLineIdx(0)
    const ticker = window.setInterval(() => setLineIdx((i) => Math.min(i + 1, LOADING_LINES.length - 1)), aiOn ? 6000 : 900)
    try {
      const opts = { useAi: aiOn, jobDescription: jd.trim() || undefined }
      const res = mode === 'file' ? await uploadResume(files, opts, setProgress) : await importText(text, opts)
      setResult(res)
      // Stable keys per entry so conflicts and suggestions keep pointing at the right role after edits/reorders.
      const keyed = keyEntries(res.draft)
      setDraft(keyed)
      setAnchored(anchorConflicts(res.conflicts, keyed))
      const anchoredSugg: AnchoredSuggestion[] = (res.bulletSuggestions ?? []).flatMap((s) => {
        const entryKey = keyed[s.section][s.index]?._key
        return entryKey ? [{ section: s.section, entryKey, sentences: s.sentences }] : []
      })
      setSuggestions(anchoredSugg)
      setInitialIssues(Object.fromEntries(buildChecklist(keyed, anchoredSugg).map((i) => [i.id, i.title])))
      setChoices({})
      setTitle(`${res.draft.personalInfo.fullName || 'My'} resume${res.draft.targetJobTitle ? ` - ${res.draft.targetJobTitle}` : ''}`.slice(0, 120))
      setPhase('review')
    } catch (err) {
      setError(getErrorMessage(err))
      setPhase('input')
    } finally {
      window.clearInterval(ticker)
    }
  }

  const live = draft ? liveConflicts(anchored, draft) : []
  const flags = draft ? conflictMap(live, draft, choices) : {}
  const pendingConflicts = draft ? live.filter((c) => conflictStatus(c, draft, choices) === 'pending') : []
  const openConflicts = pendingConflicts.length

  function jump(path: string) {
    setReviewTab('edit')
    requestAnimationFrame(() => jumpToPath(path))
  }

  const checklist = draft ? buildChecklist(draft, suggestions) : []
  const openIds = new Set(checklist.map((i) => i.id))
  const fixedTitles = Object.entries(initialIssues)
    .filter(([id]) => !openIds.has(id))
    .map(([, t]) => t)

  /** Append a bullet to an entry, replacing an empty placeholder bullet if there is one. */
  function appendBullet(item: FixItem, text: string) {
    setDraft((d) => {
      if (!d || !item.section || item.index === undefined) return d
      const list = d[item.section] as Array<{ description: string[] }>
      const entry = list[item.index]
      if (!entry) return d
      const description = [...entry.description.filter((b) => b.trim()), text]
      return { ...d, [item.section]: list.map((e, i) => (i === item.index ? { ...e, description } : e)) }
    })
  }

  async function save() {
    if (!draft || !result) return
    if (openConflicts > 0) {
      // Don't silently do nothing: take the user to what still needs a decision.
      setError(`Confirm ${openConflicts} detail(s) where your documents disagree before saving.`)
      const first = document.querySelector<HTMLElement>('#conflicts')
      first?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      first?.classList.remove('flash-field')
      void first?.offsetWidth
      first?.classList.add('flash-field')
      return
    }
    setSaving(true)
    setError('')
    try {
      const r = await createResume({ title: title.trim() || 'Imported resume', ...stripKeys(draft), templateId, fitToPage, source: result.ai.used ? 'ai' : 'upload' })
      navigate(`/resumes/${r.id}`)
    } catch (err) {
      setError(getErrorMessage(err))
      setSaving(false)
    }
  }

  if (phase === 'working') {
    return (
      <div className="flex min-h-[65vh] flex-col items-center justify-center gap-8 text-center">
        <div className="relative h-44 w-44 animate-float">
          <div className="burst absolute inset-0 animate-spin bg-black [animation-duration:8s]" />
          <div className="burst absolute inset-[6px] animate-spin bg-gold [animation-duration:8s]" />
          <Wand2 className="absolute inset-0 m-auto h-14 w-14 text-black" />
        </div>
        <div>
          <h1 className="title-action title-glow text-4xl sm:text-5xl">{aiOn ? 'Forging your resume' : 'Reading your resume'}</h1>
          <p className="bubble mt-6 inline-block text-lg" aria-live="polite">
            {mode === 'file' && progress < 100 ? `Uploading… ${progress}%` : LOADING_LINES[lineIdx]}
          </p>
          {aiOn && <p className="mt-6 text-sm text-muted">Claude is restructuring and rewriting. This can take up to a minute.</p>}
        </div>
      </div>
    )
  }

  if (phase === 'review' && result && draft) {
    return (
      <div className="space-y-6">
        <section className="panel panel-glow-gold p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="caption mb-2 text-xs">{result.ai.used ? 'AI draft ready' : 'Draft ready'}</span>
              <h1 className="title-action text-4xl">Review before saving</h1>
              <p className="mt-1 text-sm text-muted">Check every field: nothing is saved until you click Save. {result.fileName && <>Source: {result.fileName}</>}</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <TextField label="Resume title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-72" maxLength={120} />
              <button type="button" className={`btn text-xl ${openConflicts ? 'btn-ghost' : 'btn-hero'}`} onClick={save} disabled={saving || !title.trim()} aria-describedby={openConflicts ? 'save-blocked' : undefined}>
                <Save className="h-5 w-5" /> {saving ? 'Saving…' : openConflicts ? `Save (${openConflicts} to confirm)` : 'Save resume'}
              </button>
            </div>
          </div>
          {result.sources.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-label text-muted">Built from</span>
              {result.sources.map((s) => (
                <span key={s.name} className={`chip ${s.role === 'linkedin' ? 'bg-bolt text-white' : s.role === 'resume' ? 'bg-gold text-black' : 'bg-panel-2 text-slate-200'}`}>
                  {s.name}
                </span>
              ))}
            </div>
          )}
          {live.length > 0 && (
            <div className="mt-4" id="save-blocked">
              {openConflicts > 0 ? (
                <Alert kind="warn">
                  <p className="mb-1 font-semibold">
                    {openConflicts} of {live.length} detail(s) differ between your documents and still need your choice:
                  </p>
                  <ul className="space-y-1">
                    {pendingConflicts.map((c) => (
                      <li key={conflictId(c)} className="flex flex-wrap items-center gap-2">
                        <span>• {c.path ? describePath(draft, c.path).join(' › ') : c.label}</span>
                        {c.path && (
                          <button type="button" className="inline-flex min-h-10 items-center text-gold underline underline-offset-2 hover:text-white sm:min-h-0" onClick={() => jump(c.path!)}>
                            Show me
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </Alert>
              ) : (
                <Alert kind="success">All {live.length} difference(s) between your documents are confirmed. You can save.</Alert>
              )}
            </div>
          )}
          {error && <div className="mt-4"><Alert>{error}</Alert></div>}
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {(result.notes ?? []).length > 0 && (
              <div className="rounded-md border-2 border-line bg-ink/50 p-3 text-sm">
                <p className="font-label mb-1 font-bold text-paper">How we read it</p>
                <ul className="space-y-0.5 text-slate-300">{result.notes.map((c, i) => <li key={i}>• {c}</li>)}</ul>
              </div>
            )}
            {result.mergeNotes.length > 0 && (
              <div className="rounded-md border-2 border-bolt bg-bolt/10 p-3 text-sm">
                <p className="font-label mb-1 font-bold text-cyan">Merged from your documents</p>
                <ul className="space-y-0.5 text-slate-200">{result.mergeNotes.map((c, i) => <li key={i}>• {c}</li>)}</ul>
              </div>
            )}
            {result.ai.error && <Alert kind="warn">{result.ai.error}</Alert>}
            {result.ai.changes.length > 0 && (
              <div className="rounded-md border-2 border-good bg-good/10 p-3 text-sm">
                <p className="font-label mb-1 font-bold text-good">What changed</p>
                <ul className="space-y-0.5 text-slate-200">{result.ai.changes.map((c, i) => <li key={i}>• {c}</li>)}</ul>
              </div>
            )}
            {result.ai.missingInfo.length > 0 && (
              <div className="rounded-md border-2 border-gold bg-gold/10 p-3 text-sm">
                <p className="font-label mb-1 font-bold text-gold">Add these yourself</p>
                <ul className="space-y-0.5 text-slate-200">{result.ai.missingInfo.map((c, i) => <li key={i}>• {c}</li>)}</ul>
              </div>
            )}
            {result.warnings.length > 0 && !result.ai.used && (
              <div className="rounded-md border-2 border-warn bg-warn/10 p-3 text-sm">
                <p className="font-label mb-1 font-bold text-warn">Check these</p>
                <ul className="space-y-0.5 text-slate-200">{result.warnings.map((c, i) => <li key={i}>• {c}</li>)}</ul>
              </div>
            )}
          </div>
        </section>

        <div className="grid gap-6 pb-20 xl:grid-cols-[1fr_minmax(0,560px)] xl:pb-0">
          <div>
            <div role="tablist" className="flex gap-1 border-b-[3px] border-black">
              <button role="tab" type="button" className="tab" aria-selected={reviewTab === 'edit'} onClick={() => setReviewTab('edit')}>Edit draft</button>
              <button role="tab" type="button" className="tab" aria-selected={reviewTab === 'report'} onClick={() => setReviewTab('report')}>ATS report</button>
            </div>
            <div className="space-y-5 pt-5">
              {live.length > 0 && (
                <ConflictsPanel
                  conflicts={live}
                  draft={draft}
                  choices={choices}
                  onJump={jump}
                  onChoose={(c, value) => {
                    if (!c.path) return
                    setDraft((d) => (d ? setByPath(d, c.path!, value) : d))
                    setChoices((ch) => ({ ...ch, [conflictId(c)]: value }))
                  }}
                />
              )}
              <FixChecklist
                items={checklist}
                doneTitles={fixedTitles}
                onJump={jump}
                onAddBullet={appendBullet}
                onWriteBullet={(item) => {
                  // The new empty bullet lands after the existing non-empty ones.
                  const count = draft[item.section!][item.index!].description.filter((b) => b.trim()).length
                  appendBullet(item, '')
                  jump(`${item.section}[${item.index}].description[${count}]`)
                }}
              />
              {reviewTab === 'edit' ? (
                <ResumeForm value={draft} onChange={setDraft} flags={flags} />
              ) : (
                <div className="space-y-6">
                  <div className="panel p-5"><QualityReportView report={result.quality} /></div>
                  {result.jobMatch && <div className="panel p-5"><JobMatchView report={result.jobMatch} /></div>}
                  <p className="text-xs text-muted">This report reflects the draft as it was generated. Save, then re-run checks from the editor after your changes.</p>
                </div>
              )}
              <details className="panel mt-6 p-4">
                <summary className="font-label cursor-pointer font-bold text-muted">Show extracted text from your document</summary>
                <pre className="mt-3 max-h-80 overflow-auto text-xs whitespace-pre-wrap text-slate-400">{result.rawText}</pre>
              </details>
            </div>
          </div>
          <aside id="live-preview" className="scroll-mt-24 xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:self-start xl:overflow-y-auto xl:pr-2 xl:pb-6">
            <p className="font-label mb-2 text-sm text-muted">Live preview · the exact PDF you will download</p>
            <PreviewPane
              content={draft}
              templateId={templateId}
              fitToPage={fitToPage}
              onTemplate={setTemplateId}
              onFitToPage={setFitToPage}
              marks={Object.fromEntries(Object.entries(flags).map(([path, f]) => [path, f.status]))}
            />
          </aside>
          <PreviewJump targetId="live-preview" />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="text-center">
        <span className="caption mb-3 text-xs">Transformation sequence</span>
        <h1 className="title-action title-glow text-5xl sm:text-6xl">
          Upload. <span className="text-gradient-hero">Transform.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-slate-300">Drop your current resume, a LinkedIn PDF export, or any document about your work. We turn it into a clean, ATS-friendly resume you can review and edit.</p>
      </div>

      {error && <Alert onClose={() => setError('')}>{error}</Alert>}

      <div className="panel panel-glow-blue p-5 sm:p-6">
        <div role="tablist" className="mb-5 flex gap-1 border-b-[3px] border-black">
          <button role="tab" type="button" className="tab" aria-selected={mode === 'file'} onClick={() => setMode('file')}>
            <FileUp className="mr-1 inline h-4 w-4" /> Upload files
          </button>
          <button role="tab" type="button" className="tab" aria-selected={mode === 'text'} onClick={() => setMode('text')}>
            <ClipboardPaste className="mr-1 inline h-4 w-4" /> Paste text
          </button>
        </div>

        {mode === 'file' ? (
          <div className="space-y-4">
            <div
              className={`halftone flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-[3px] border-dashed p-8 text-center transition-colors ${dragOver ? 'border-gold bg-gold/10' : 'border-line hover:border-gold'}`}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                pickFiles(e.dataTransfer.files)
              }}
              role="button"
              tabIndex={0}
              aria-label="Choose resume files"
            >
              <FileUp className="h-12 w-12 text-gold" aria-hidden />
              <p className="font-display text-2xl text-paper">{files.length ? 'Add another document' : 'Drop your files here or click to browse'}</p>
              <p className="max-w-lg text-sm text-muted">
                Your resume, plus your LinkedIn profile PDF (LinkedIn → your profile → More → Save to PDF) or any other document. We merge them into one resume.
              </p>
              <p className="text-xs text-slate-500">
                Up to {MAX_FILES} files · PDF, DOCX or TXT{aiAvailable ? ', or a photo/scan (PNG, JPG) with AI on' : ''} · {uploadTotalMb ? `up to ${uploadTotalMb} MB in total` : `${MAX_MB} MB each`} · any layout: one or two columns, tables, Canva templates
              </p>
              <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => pickFiles(e.target.files)} />
            </div>
            {files.length > 0 && (
              <ul className="space-y-2" aria-label="Selected documents">
                {files.map((f, i) => (
                  <li key={`${f.file.name}-${i}`} className="flex flex-wrap items-center gap-3 rounded-md border-2 border-black bg-ink/60 p-2.5" style={{ boxShadow: '3px 3px 0 #000' }}>
                    <FileText className="h-5 w-5 shrink-0 text-gold" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-semibold">{f.file.name}</span>
                    <span className="text-xs text-muted">{Math.max(1, Math.round(f.file.size / 1024))} KB</span>
                    <select
                      className="input w-auto py-1"
                      value={f.role}
                      aria-label={`Document type for ${f.file.name}`}
                      onChange={(e) => setFiles(files.map((x, idx) => (idx === i ? { ...x, role: e.target.value as PickedFile['role'] } : x)))}
                    >
                      {ROLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-ghost btn-icon" aria-label={`Remove ${f.file.name}`} onClick={() => setFiles(files.filter((_, idx) => idx !== i))}>
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <TextArea
            label="Your resume or background"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your resume, LinkedIn About + Experience, or notes about your jobs, projects, education and skills…"
            hint={`${text.trim().length} characters`}
          />
        )}

        <div className="mt-6 grid gap-5 md:grid-cols-[auto_1fr]">
          <label className={`flex cursor-pointer items-start gap-3 rounded-md border-2 border-black p-3 md:w-72 ${aiOn ? 'bg-gold/15' : 'bg-ink/50'}`}>
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--color-gold)]" checked={aiOn} disabled={!aiAvailable} onChange={(e) => setUseAi(e.target.checked)} />
            <span>
              <span className="font-display flex items-center gap-1.5 text-xl text-paper">
                <Sparkles className="h-4 w-4 text-gold" /> AI power-up
              </span>
              <span className="block text-xs text-muted">
                {aiAvailable ? 'Claude rewrites it into the best ATS-friendly version using only your real facts.' : 'Not available: the server has no AI key. A rule-based draft will be created.'}
              </span>
            </span>
          </label>
          <TextArea
            label="Target job description (optional)"
            rows={4}
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            placeholder="Paste a job posting to tailor emphasis and get a match report"
          />
        </div>

        <button type="button" className="btn btn-hero mt-6 w-full text-2xl" onClick={start} disabled={mode === 'file' ? !files.length : text.trim().length < 80}>
          <Wand2 className="h-6 w-6" />{' '}
          {mode === 'file' && files.length > 1 ? (aiOn ? `Merge & transform ${files.length} documents` : `Merge ${files.length} documents`) : aiOn ? 'Transform my resume' : 'Import my resume'}
        </button>
      </div>
    </div>
  )
}
