import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2, X } from 'lucide-react'
import {
  emptyCertification,
  emptyEducation,
  emptyExperience,
  emptyProject,
  type ResumeContent,
} from '../../types/resume'
import { TextArea, TextField } from '../common/ui'
import type { FieldFlag } from '../../utils/resumePath'

type Update = (next: ResumeContent) => void

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr
  const copy = [...arr]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

function replaceAt<T>(arr: T[], i: number, item: T): T[] {
  return arr.map((x, idx) => (idx === i ? item : x))
}

function Section({
  title,
  kicker,
  children,
  defaultOpen = true,
  count,
  id,
  attention = 0,
}: {
  title: string
  kicker: string
  children: ReactNode
  defaultOpen?: boolean
  count?: number
  /** Matches the first part of a field path ("experience", "personalInfo"), so jumps can open it. */
  id?: string
  /** Number of unresolved conflicts inside; such sections start open and show a badge. */
  attention?: number
}) {
  const [open, setOpen] = useState(defaultOpen || attention > 0)
  return (
    <section className={`panel animate-panel-in ${attention ? 'panel-glow-red' : ''}`}>
      <button type="button" data-section={id} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="flex items-center gap-3">
          <span className="font-label rounded-sm border-2 border-black bg-hero px-1.5 text-xs font-bold text-white">{kicker}</span>
          <span className="font-display text-2xl tracking-wide text-paper">{title}</span>
          {count !== undefined && <span className="chip bg-panel-2 text-slate-300">{count}</span>}
          {attention > 0 && <span className="chip bg-hero text-white">{attention} to confirm</span>}
        </span>
        <ChevronDown className={`h-5 w-5 text-gold transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t-2 border-black px-4 pt-3 pb-4">{children}</div>}
    </section>
  )
}

function EntryToolbar({ index, total, onMove, onRemove, label }: { index: number; total: number; onMove: (to: number) => void; onRemove: () => void; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className="btn btn-ghost btn-icon" onClick={() => onMove(index - 1)} disabled={index === 0} aria-label={`Move ${label} up`}>
        <ArrowUp className="h-4 w-4" />
      </button>
      <button type="button" className="btn btn-ghost btn-icon" onClick={() => onMove(index + 1)} disabled={index === total - 1} aria-label={`Move ${label} down`}>
        <ArrowDown className="h-4 w-4" />
      </button>
      <button type="button" className="btn btn-hero btn-icon" onClick={onRemove} aria-label={`Remove ${label}`}>
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

/** Tag-style input: Enter or comma adds; paste of "a, b, c" adds all. */
function TagInput({ label, values, onChange, placeholder, path }: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string; path?: string }) {
  const [draft, setDraft] = useState('')
  const add = (raw: string) => {
    const parts = raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
    if (!parts.length) return
    const lower = new Set(values.map((v) => v.toLowerCase()))
    onChange([...values, ...parts.filter((p) => !lower.has(p.toLowerCase()))])
    setDraft('')
  }
  return (
    <div>
      <span className="field-label">{label}</span>
      <div className="input flex min-h-11 flex-wrap items-center gap-1.5">
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className="chip bg-gold text-black">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((_, idx) => idx !== i))}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          className="min-w-32 flex-1 bg-transparent text-sm outline-none"
          value={draft}
          placeholder={values.length ? '' : placeholder}
          aria-label={`Add ${label}`}
          data-path={path}
          onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            } else if (e.key === 'Backspace' && !draft && values.length) {
              onChange(values.slice(0, -1))
            }
          }}
          onBlur={() => add(draft)}
        />
      </div>
      <p className="mt-1 text-xs text-slate-500">Press Enter or comma to add. Keep each one a short keyword.</p>
    </div>
  )
}

function BulletEditor({ bullets, onChange, label, pathPrefix }: { bullets: string[]; onChange: (b: string[]) => void; label: string; pathPrefix?: string }) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <div className="space-y-2">
        {bullets.map((b, i) => {
          const words = b.trim() ? b.trim().split(/\s+/).length : 0
          return (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-2.5 text-gold" aria-hidden>
                ●
              </span>
              <div className="flex-1">
                <textarea
                  className="input min-h-10 resize-y py-1.5"
                  rows={1}
                  value={b}
                  aria-label={`${label} bullet ${i + 1}`}
                  data-path={pathPrefix ? `${pathPrefix}.description[${i}]` : undefined}
                  placeholder="Action verb + what you did + measurable result"
                  onChange={(e) => onChange(replaceAt(bullets, i, e.target.value))}
                />
                {words > 35 && <p className="field-error">{words} words. Aim for under 30.</p>}
              </div>
              <button type="button" className="btn btn-ghost btn-icon mt-1" aria-label={`Remove bullet ${i + 1}`} onClick={() => onChange(bullets.filter((_, idx) => idx !== i))}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
      <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => onChange([...bullets, ''])}>
        <Plus className="h-4 w-4" /> Add bullet
      </button>
    </div>
  )
}

const grid = 'grid gap-3 sm:grid-cols-2'

export function ResumeForm({ value: r, onChange, flags }: { value: ResumeContent; onChange: Update; flags?: Record<string, FieldFlag> }) {
  const pi = r.personalInfo
  const setPi = (k: keyof typeof pi, v: string) => onChange({ ...r, personalInfo: { ...pi, [k]: v } })
  const summaryWords = r.summary.trim() ? r.summary.trim().split(/\s+/).length : 0
  /** Field props for a path: a scroll target, plus the conflict message when the documents disagreed. */
  const fp = (path: string) => {
    const f = flags?.[path]
    const base = { 'data-path': path } as Record<string, string>
    if (!f || f.status === 'removed') return base
    const opts = f.conflict.options.map((o) => `“${o.value}” (${o.source})`).join(' vs ')
    if (f.status === 'pending') return { ...base, error: `Your documents disagree: ${opts}. Pick one in “Your documents disagree”, or type the correct value.` }
    return { ...base, success: f.status === 'chosen' ? 'Confirmed' : 'Confirmed (your edit)' }
  }
  const pendingIn = (...prefixes: string[]) =>
    Object.entries(flags ?? {}).filter(([path, f]) => f.status === 'pending' && prefixes.some((p) => path.startsWith(p))).length

  return (
    <div className="space-y-5">
      <Section kicker="01" title="Contact" id="personalInfo" attention={pendingIn('personalInfo', 'targetJobTitle')}>
        <div className={grid}>
          <TextField label="Full name" value={pi.fullName} onChange={(e) => setPi('fullName', e.target.value)} autoComplete="name" {...fp('personalInfo.fullName')} />
          <TextField label="Target job title" value={r.targetJobTitle} onChange={(e) => onChange({ ...r, targetJobTitle: e.target.value })} placeholder="e.g. Full Stack Developer" {...fp('targetJobTitle')} />
          <TextField label="Email" type="email" value={pi.email} onChange={(e) => setPi('email', e.target.value)} autoComplete="email" {...fp('personalInfo.email')} />
          <TextField label="Phone" value={pi.phone} onChange={(e) => setPi('phone', e.target.value)} autoComplete="tel" {...fp('personalInfo.phone')} />
          <TextField label="Location" value={pi.location} onChange={(e) => setPi('location', e.target.value)} placeholder="City, Country" {...fp('personalInfo.location')} />
          <TextField label="LinkedIn" value={pi.linkedin} onChange={(e) => setPi('linkedin', e.target.value)} placeholder="linkedin.com/in/you" {...fp('personalInfo.linkedin')} />
          <TextField label="GitHub" value={pi.github} onChange={(e) => setPi('github', e.target.value)} placeholder="github.com/you" {...fp('personalInfo.github')} />
          <TextField label="Portfolio" value={pi.portfolio} onChange={(e) => setPi('portfolio', e.target.value)} placeholder="yoursite.com" {...fp('personalInfo.portfolio')} />
        </div>
      </Section>

      <Section kicker="02" title="Summary" id="summary">
        <TextArea
          label="Professional summary"
          data-path="summary"
          value={r.summary}
          rows={4}
          onChange={(e) => onChange({ ...r, summary: e.target.value })}
          hint={`${summaryWords} words. 30-80 words works best. Skip "I" and "my".`}
        />
      </Section>

      <Section kicker="03" title="Skills" count={r.skills.length} id="skills">
        <TagInput label="Skills" values={r.skills} onChange={(skills) => onChange({ ...r, skills })} placeholder="React, SQL, Project Management…" path="skills" />
      </Section>

      <Section kicker="04" title="Experience" count={r.experience.length} id="experience" attention={pendingIn('experience')}>
        <div className="space-y-4">
          {r.experience.map((e, i) => {
            const set = (patch: Partial<typeof e>) => onChange({ ...r, experience: replaceAt(r.experience, i, { ...e, ...patch }) })
            return (
              <div key={i} className="rounded-md border-2 border-line bg-ink/40 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-label text-sm font-bold text-gold">{e.jobTitle || e.company || `Role ${i + 1}`}</span>
                  <EntryToolbar
                    index={i}
                    total={r.experience.length}
                    label="role"
                    onMove={(to) => onChange({ ...r, experience: move(r.experience, i, to) })}
                    onRemove={() => onChange({ ...r, experience: r.experience.filter((_, idx) => idx !== i) })}
                  />
                </div>
                <div className={grid}>
                  <TextField label="Job title" value={e.jobTitle} onChange={(ev) => set({ jobTitle: ev.target.value })} {...fp(`experience[${i}].jobTitle`)} />
                  <TextField label="Company" value={e.company} onChange={(ev) => set({ company: ev.target.value })} {...fp(`experience[${i}].company`)} />
                  <TextField label="Start date" value={e.startDate} onChange={(ev) => set({ startDate: ev.target.value })} placeholder="Mar 2023" {...fp(`experience[${i}].startDate`)} />
                  <TextField label="End date" value={e.current ? '' : e.endDate} disabled={e.current} onChange={(ev) => set({ endDate: ev.target.value })} placeholder={e.current ? 'Present' : 'Jun 2024'} {...fp(`experience[${i}].endDate`)} />
                  <TextField label="Location" value={e.location} onChange={(ev) => set({ location: ev.target.value })} placeholder="City, Country" {...fp(`experience[${i}].location`)} />
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={e.current} onChange={(ev) => set({ current: ev.target.checked, endDate: ev.target.checked ? '' : e.endDate })} />I currently work here
                  </label>
                </div>
                <div className="mt-3">
                  <BulletEditor label="Achievements" bullets={e.description} onChange={(description) => set({ description })} pathPrefix={`experience[${i}]`} />
                </div>
              </div>
            )
          })}
          <button type="button" className="btn btn-gold btn-sm" onClick={() => onChange({ ...r, experience: [...r.experience, emptyExperience()] })}>
            <Plus className="h-4 w-4" /> Add role
          </button>
        </div>
      </Section>

      <Section kicker="05" title="Projects" count={r.projects.length} id="projects" attention={pendingIn('projects')}>
        <div className="space-y-4">
          {r.projects.map((p, i) => {
            const set = (patch: Partial<typeof p>) => onChange({ ...r, projects: replaceAt(r.projects, i, { ...p, ...patch }) })
            return (
              <div key={i} className="rounded-md border-2 border-line bg-ink/40 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-label text-sm font-bold text-gold">{p.name || `Project ${i + 1}`}</span>
                  <EntryToolbar
                    index={i}
                    total={r.projects.length}
                    label="project"
                    onMove={(to) => onChange({ ...r, projects: move(r.projects, i, to) })}
                    onRemove={() => onChange({ ...r, projects: r.projects.filter((_, idx) => idx !== i) })}
                  />
                </div>
                <div className={grid}>
                  <TextField label="Project name" value={p.name} onChange={(ev) => set({ name: ev.target.value })} />
                  <TextField label="Link" value={p.url} onChange={(ev) => set({ url: ev.target.value })} placeholder="github.com/you/project" />
                </div>
                <div className="mt-3 space-y-3">
                  <TagInput label="Technologies" values={p.technologies} onChange={(technologies) => set({ technologies })} />
                  <BulletEditor label="Highlights" bullets={p.description} onChange={(description) => set({ description })} pathPrefix={`projects[${i}]`} />
                </div>
              </div>
            )
          })}
          <button type="button" className="btn btn-gold btn-sm" onClick={() => onChange({ ...r, projects: [...r.projects, emptyProject()] })}>
            <Plus className="h-4 w-4" /> Add project
          </button>
        </div>
      </Section>

      <Section kicker="06" title="Education" count={r.education.length} id="education" attention={pendingIn('education')}>
        <div className="space-y-4">
          {r.education.map((e, i) => {
            const set = (patch: Partial<typeof e>) => onChange({ ...r, education: replaceAt(r.education, i, { ...e, ...patch }) })
            return (
              <div key={i} className="rounded-md border-2 border-line bg-ink/40 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-label text-sm font-bold text-gold">{e.degree || e.institution || `Education ${i + 1}`}</span>
                  <EntryToolbar
                    index={i}
                    total={r.education.length}
                    label="education"
                    onMove={(to) => onChange({ ...r, education: move(r.education, i, to) })}
                    onRemove={() => onChange({ ...r, education: r.education.filter((_, idx) => idx !== i) })}
                  />
                </div>
                <div className={grid}>
                  <TextField label="Degree" value={e.degree} onChange={(ev) => set({ degree: ev.target.value })} placeholder="B.E." {...fp(`education[${i}].degree`)} />
                  <TextField label="Field of study" value={e.field} onChange={(ev) => set({ field: ev.target.value })} placeholder="Computer Science" {...fp(`education[${i}].field`)} />
                  <TextField label="Institution" value={e.institution} onChange={(ev) => set({ institution: ev.target.value })} {...fp(`education[${i}].institution`)} />
                  <TextField label="Location" value={e.location} onChange={(ev) => set({ location: ev.target.value })} {...fp(`education[${i}].location`)} />
                  <TextField label="Start" value={e.startDate} onChange={(ev) => set({ startDate: ev.target.value })} placeholder="2018" {...fp(`education[${i}].startDate`)} />
                  <TextField label="End" value={e.endDate} onChange={(ev) => set({ endDate: ev.target.value })} placeholder="2022" {...fp(`education[${i}].endDate`)} />
                  <TextField label="Grade" value={e.grade} onChange={(ev) => set({ grade: ev.target.value })} placeholder="CGPA: 8.4/10" {...fp(`education[${i}].grade`)} />
                </div>
              </div>
            )
          })}
          <button type="button" className="btn btn-gold btn-sm" onClick={() => onChange({ ...r, education: [...r.education, emptyEducation()] })}>
            <Plus className="h-4 w-4" /> Add education
          </button>
        </div>
      </Section>

      <Section kicker="07" title="Certifications" count={r.certifications.length} defaultOpen={r.certifications.length > 0} id="certifications" attention={pendingIn('certifications')}>
        <div className="space-y-3">
          {r.certifications.map((c, i) => {
            const set = (patch: Partial<typeof c>) => onChange({ ...r, certifications: replaceAt(r.certifications, i, { ...c, ...patch }) })
            return (
              <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border-2 border-line bg-ink/40 p-3">
                <TextField className="min-w-48 flex-[2]" label="Name" value={c.name} onChange={(ev) => set({ name: ev.target.value })} {...fp(`certifications[${i}].name`)} />
                <TextField className="min-w-32 flex-1" label="Issuer" value={c.issuer} onChange={(ev) => set({ issuer: ev.target.value })} {...fp(`certifications[${i}].issuer`)} />
                <TextField className="w-28" label="Date" value={c.date} onChange={(ev) => set({ date: ev.target.value })} placeholder="2024" {...fp(`certifications[${i}].date`)} />
                <button type="button" className="btn btn-hero btn-icon mb-1" aria-label="Remove certification" onClick={() => onChange({ ...r, certifications: r.certifications.filter((_, idx) => idx !== i) })}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )
          })}
          <button type="button" className="btn btn-gold btn-sm" onClick={() => onChange({ ...r, certifications: [...r.certifications, emptyCertification()] })}>
            <Plus className="h-4 w-4" /> Add certification
          </button>
        </div>
      </Section>

      <Section kicker="08" title="More sections" count={r.additionalSections.length} defaultOpen={r.additionalSections.length > 0}>
        <div className="space-y-4">
          {r.additionalSections.map((s, i) => {
            const set = (patch: Partial<typeof s>) => onChange({ ...r, additionalSections: replaceAt(r.additionalSections, i, { ...s, ...patch }) })
            return (
              <div key={i} className="rounded-md border-2 border-line bg-ink/40 p-3">
                <div className="mb-2 flex items-end gap-2">
                  <TextField className="flex-1" label="Section title" value={s.title} onChange={(ev) => set({ title: ev.target.value })} list="additional-section-titles" />
                  <EntryToolbar
                    index={i}
                    total={r.additionalSections.length}
                    label="section"
                    onMove={(to) => onChange({ ...r, additionalSections: move(r.additionalSections, i, to) })}
                    onRemove={() => onChange({ ...r, additionalSections: r.additionalSections.filter((_, idx) => idx !== i) })}
                  />
                </div>
                <BulletEditor label="Items" bullets={s.items} onChange={(items) => set({ items })} />
              </div>
            )
          })}
          <datalist id="additional-section-titles">
            {['Achievements', 'Awards', 'Leadership & Activities', 'Volunteering', 'Languages', 'Publications', 'Interests', 'Workshops & Seminars'].map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <button type="button" className="btn btn-gold btn-sm" onClick={() => onChange({ ...r, additionalSections: [...r.additionalSections, { title: 'Achievements', items: [''] }] })}>
            <Plus className="h-4 w-4" /> Add section
          </button>
          <p className="text-xs text-slate-500">Achievements, activities, languages, awards and similar. Each appears with its own heading on the resume.</p>
        </div>
      </Section>
    </div>
  )
}
