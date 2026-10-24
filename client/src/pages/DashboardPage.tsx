import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Copy, FilePlus2, Pencil, Sparkles, Trash2, Upload } from 'lucide-react'
import { createResume, deleteResume, duplicateResume, listResumes, updateResume } from '../api/resumeApi'
import { getErrorMessage } from '../api/axios'
import type { ResumeListItem } from '../types/resume'
import { Alert, Modal, Spinner, TextField } from '../components/common/ui'
import { useAuth } from '../hooks/useAuth'
import { timeAgo } from '../utils/dates'

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: ResumeListItem[] }

export function DashboardPage() {
  const { user, aiAvailable, deleteAccount } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [renaming, setRenaming] = useState<ResumeListItem | null>(null)
  const [deleting, setDeleting] = useState<ResumeListItem | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [confirmAccount, setConfirmAccount] = useState(false)

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      setState({ kind: 'ready', items: (await listResumes()).items })
    } catch (err) {
      setState({ kind: 'error', message: getErrorMessage(err) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function run(id: string, fn: () => Promise<void>) {
    setBusyId(id)
    setActionError('')
    try {
      await fn()
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const createBlank = () =>
    run('new', async () => {
      const r = await createResume({ title: 'Untitled resume', personalInfo: { fullName: user?.name ?? '', email: user?.email ?? '', phone: '', location: '', linkedin: '', github: '', portfolio: '' } })
      navigate(`/resumes/${r.id}`)
    })

  return (
    <div className="space-y-8">
      {/* Hero banner */}
      <section className="panel panel-glow-red speed-lines relative overflow-hidden p-6 sm:p-8">
        <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-hero/30 blur-3xl" aria-hidden />
        <span className="caption mb-3 text-xs">Mission control</span>
        <h1 className="title-action title-glow text-4xl sm:text-6xl">
          Ready, <span className="text-gradient-hero">{user?.name.split(' ')[0]}</span>?
        </h1>
        <p className="mt-3 max-w-2xl text-slate-300">Upload any resume or document and let ResumeCraft forge an ATS-friendly resume, or build one from scratch.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/import" className="btn btn-hero text-xl">
            <Upload className="h-5 w-5" /> Upload &amp; transform
          </Link>
          <button type="button" className="btn btn-gold text-xl" onClick={createBlank} disabled={busyId === 'new'}>
            <FilePlus2 className="h-5 w-5" /> {busyId === 'new' ? 'Creating…' : 'Start from scratch'}
          </button>
        </div>
        {!aiAvailable && (
          <p className="mt-4 text-xs text-muted">
            <Sparkles className="mr-1 inline h-3.5 w-3.5" />
            AI rewriting is off on this server (no API key). Upload, ATS checks and export still work.
          </p>
        )}
      </section>

      {actionError && <Alert onClose={() => setActionError('')}>{actionError}</Alert>}

      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="title-action text-3xl">Your resumes</h2>
          {state.kind === 'ready' && <span className="font-label text-muted">{state.items.length} total</span>}
        </div>

        {state.kind === 'loading' && <Spinner label="Loading resumes…" />}
        {state.kind === 'error' && <Alert onRetry={load}>{state.message}</Alert>}
        {state.kind === 'ready' && state.items.length === 0 && (
          <div className="panel halftone p-8 text-center">
            <p className="font-display text-3xl text-paper">No resumes yet!</p>
            <p className="mt-2 text-muted">Every story starts on page one. Upload an existing resume or start fresh.</p>
          </div>
        )}
        {state.kind === 'ready' && state.items.length > 0 && (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {state.items.map((r, i) => (
              <li key={r.id} className="panel group animate-panel-in flex flex-col overflow-hidden" style={{ animationDelay: `${i * 60}ms` }}>
                <Link to={`/resumes/${r.id}`} className="halftone-red relative block border-b-[3px] border-black bg-panel-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-2xl tracking-wide text-paper group-hover:text-gold">{r.title}</h3>
                      <p className="truncate text-sm text-slate-400">{[r.fullName, r.targetJobTitle].filter(Boolean).join(' · ') || 'No details yet'}</p>
                    </div>
                    <div className="relative h-14 w-14 shrink-0" title="Estimated ATS quality score">
                      <span className="burst absolute inset-0 bg-black" />
                      <span className={`burst absolute inset-[3px] flex items-center justify-center font-display text-lg text-black ${r.score >= 80 ? 'bg-good' : r.score >= 60 ? 'bg-gold' : 'bg-hero'}`}>{r.score}</span>
                    </div>
                  </div>
                </Link>
                <div className="flex flex-1 flex-col justify-between gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="chip bg-panel-2 text-slate-300">{r.templateId}</span>
                    {r.source !== 'manual' && <span className="chip bg-bolt text-white">{r.source === 'ai' ? 'AI built' : 'Imported'}</span>}
                    <span>Updated {timeAgo(r.updatedAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/resumes/${r.id}`} className="btn btn-gold btn-sm">
                      <Pencil className="h-4 w-4" /> Edit
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setRenaming(r)
                        setNewTitle(r.title)
                      }}
                    >
                      Rename
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busyId === r.id} onClick={() => run(r.id, async () => { await duplicateResume(r.id); await load() })} aria-label={`Duplicate ${r.title}`}>
                      <Copy className="h-4 w-4" />
                    </button>
                    <button type="button" className="btn btn-hero btn-sm" disabled={busyId === r.id} onClick={() => setDeleting(r)} aria-label={`Delete ${r.title}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="pt-4 text-right">
        <button type="button" className="text-xs text-slate-500 underline hover:text-hero" onClick={() => setConfirmAccount(true)}>
          Delete my account and all data
        </button>
      </section>

      {renaming && (
        <Modal title="Rename" onClose={() => setRenaming(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const t = newTitle.trim()
              if (!t) return
              void run(renaming.id, async () => {
                await updateResume(renaming.id, { title: t })
                setRenaming(null)
                await load()
              })
            }}
            className="space-y-4"
          >
            <TextField label="Resume title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} autoFocus maxLength={120} error={newTitle.trim() ? undefined : 'Title is required'} />
            <button className="btn btn-gold w-full" disabled={!newTitle.trim() || busyId === renaming.id}>
              Save
            </button>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal title="Delete resume?" onClose={() => setDeleting(null)}>
          <p className="mb-4 text-sm text-slate-300">
            “{deleting.title}” and its analysis history will be permanently deleted.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              className="btn btn-hero flex-1"
              disabled={busyId === deleting.id}
              onClick={() =>
                run(deleting.id, async () => {
                  await deleteResume(deleting.id)
                  setDeleting(null)
                  await load()
                })
              }
            >
              Delete
            </button>
            <button type="button" className="btn btn-ghost flex-1" onClick={() => setDeleting(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {confirmAccount && (
        <Modal title="Delete account?" onClose={() => setConfirmAccount(false)}>
          <p className="mb-4 text-sm text-slate-300">This permanently deletes your account, all resumes and all analyses. This cannot be undone.</p>
          <button
            type="button"
            className="btn btn-hero w-full"
            onClick={() =>
              run('account', async () => {
                await deleteAccount()
                navigate('/login')
              })
            }
          >
            Delete everything
          </button>
        </Modal>
      )}
    </div>
  )
}
