import type { ReactNode } from 'react'
import type { ResumeContent, TemplateId } from '../../types/resume'
import type { ConflictStatus } from '../../utils/resumePath'
import { formatDateRange, formatResumeDate } from '../../utils/dates'

// Plain, single-column preview that mirrors server/src/services/export.service.ts.
// Do not add comic styling here: this is what ATS systems and recruiters see.

const TITLES = {
  summary: 'Professional Summary',
  skills: 'Skills',
  experience: 'Work Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
}

const displayUrl = (u: string) => u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')

function Heading({ title, accent, upper }: { title: string; accent: string; upper: boolean }) {
  return (
    <h3 className="mt-4 mb-1.5 border-b pb-0.5 text-[12.5px] font-bold" style={{ color: accent, borderColor: accent, letterSpacing: upper ? '0.06em' : undefined }}>
      {upper ? title.toUpperCase() : title}
    </h3>
  )
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-[11px]">
      {items.filter(Boolean).map((b, i) => (
        <li key={i}>{b}</li>
      ))}
    </ul>
  )
}

type Mark = 'pending' | 'ok' | null

const FIELD_LABEL: Record<string, string> = {
  jobTitle: 'job title',
  company: 'company',
  startDate: 'start date',
  endDate: 'end date',
  location: 'location',
  degree: 'degree',
  field: 'field',
  institution: 'institution',
  grade: 'grade',
  fullName: 'name',
  email: 'email',
  phone: 'phone',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  portfolio: 'portfolio',
  targetJobTitle: 'headline',
}

/** Screen-only wrapper outlining an entry with an unresolved (red) or confirmed (green) difference. */
function Marked({ mark, fields, children }: { mark: Mark; fields: string[]; children: ReactNode }) {
  if (!mark) return <>{children}</>
  return (
    <div className={mark === 'pending' ? 'conflict-mark-pending' : 'conflict-mark-ok'}>
      <span className="conflict-mark-tag" aria-hidden>
        {mark === 'pending' ? `⚠ Check ${fields.join(', ')}` : '✓ Confirmed'}
      </span>
      {children}
    </div>
  )
}

export function ResumePreview({
  resume,
  template = 'classic',
  marks,
}: {
  resume: ResumeContent
  template?: TemplateId
  /** Conflict status by field path, e.g. { "experience[2].startDate": "pending" }. Screen-only. */
  marks?: Record<string, ConflictStatus>
}) {
  const p = resume.personalInfo
  // Approximates the PDF templates (server/src/services/export.service.ts); the Exact PDF view is authoritative.
  const accent = ({ modern: '#1F3A8A', bold: '#0F766E', minimal: '#555555' } as Partial<Record<TemplateId, string>>)[template] ?? '#111111'
  const center = template === 'classic' || template === 'executive'
  const contacts = [p.location, p.phone, p.email, p.linkedin && displayUrl(p.linkedin), p.github && displayUrl(p.github), p.portfolio && displayUrl(p.portfolio)].filter(Boolean)
  // Keep original indexes so conflict paths ("experience[2]") line up with what is rendered.
  const exp = resume.experience.map((e, idx) => ({ e, idx })).filter(({ e }) => e.jobTitle || e.company || e.description.some(Boolean))
  const projects = resume.projects.filter((x) => x.name || x.description.some(Boolean))
  const edu = resume.education.map((e, idx) => ({ e, idx })).filter(({ e }) => e.institution || e.degree)
  const certs = resume.certifications.filter((c) => c.name)
  const skills = resume.skills.map((s) => s.trim()).filter(Boolean)

  const markFor = (...prefixes: string[]): { mark: Mark; fields: string[] } => {
    const hits = Object.entries(marks ?? {}).filter(([k, s]) => s !== 'removed' && prefixes.some((pre) => k === pre || k.startsWith(pre)))
    if (!hits.length) return { mark: null, fields: [] }
    const pending = hits.filter(([, s]) => s === 'pending')
    return { mark: pending.length ? 'pending' : 'ok', fields: pending.map(([k]) => FIELD_LABEL[k.split('.').pop()!] ?? k) }
  }

  const heading = (title: string) => <Heading title={title} accent={accent} upper={template !== 'modern'} />

  return (
    <article
      className="resume-paper mx-auto min-h-[640px] w-full p-[7%] text-[11px] shadow-2xl"
      style={template === 'executive' ? { fontFamily: 'Georgia, "Times New Roman", serif' } : undefined}
      aria-label="Resume preview"
    >
      <Marked {...markFor('personalInfo.', 'targetJobTitle')}>
        <header className={center ? 'text-center' : ''}>
          <h1 className="text-[22px] leading-tight font-bold" style={{ color: template === 'modern' || template === 'bold' ? accent : '#111' }}>
            {p.fullName || 'Your Name'}
          </h1>
          {resume.targetJobTitle && <p className="text-[12px] text-[#444]">{resume.targetJobTitle}</p>}
          {contacts.length > 0 && <p className="mt-1 text-[10.5px] text-[#444]">{contacts.join('  |  ')}</p>}
        </header>
      </Marked>

      {resume.summary.trim() && (
        <section>
          {heading(TITLES.summary)}
          <p>{resume.summary}</p>
        </section>
      )}
      {skills.length > 0 && (
        <section>
          {heading(TITLES.skills)}
          <p>{skills.join(', ')}</p>
        </section>
      )}
      {exp.length > 0 && (
        <section>
          {heading(TITLES.experience)}
          {exp.map(({ e, idx }) => (
            <Marked key={idx} {...markFor(`experience[${idx}].`)}>
              <div className="mt-2">
                <p className="text-[11.5px] font-bold">{[e.jobTitle, e.company].filter(Boolean).join(', ')}</p>
                <p className="text-[10.5px] text-[#444]">{[e.location, formatDateRange(e.startDate, e.endDate, e.current)].filter(Boolean).join('  |  ')}</p>
                <Bullets items={e.description} />
              </div>
            </Marked>
          ))}
        </section>
      )}
      {projects.length > 0 && (
        <section>
          {heading(TITLES.projects)}
          {projects.map((pr, i) => (
            <div key={i} className="mt-2">
              <p className="text-[11.5px] font-bold">{pr.name}</p>
              {(pr.technologies.length > 0 || pr.url) && (
                <p className="text-[10.5px] text-[#444]">
                  {[pr.technologies.length ? `Technologies: ${pr.technologies.join(', ')}` : '', pr.url ? displayUrl(pr.url) : ''].filter(Boolean).join('  |  ')}
                </p>
              )}
              <Bullets items={pr.description} />
            </div>
          ))}
        </section>
      )}
      {edu.length > 0 && (
        <section>
          {heading(TITLES.education)}
          {edu.map(({ e, idx }) => (
            <Marked key={idx} {...markFor(`education[${idx}].`)}>
            <div className="mt-2">
              <p className="text-[11.5px] font-bold">{[e.degree, e.field].filter(Boolean).join(' in ') || e.institution}</p>
              <p className="text-[10.5px] text-[#444]">
                {[[e.degree || e.field ? e.institution : '', e.location].filter(Boolean).join(', '), formatDateRange(e.startDate, e.endDate, false), e.grade]
                  .filter(Boolean)
                  .join('  |  ')}
              </p>
            </div>
            </Marked>
          ))}
        </section>
      )}
      {certs.length > 0 && (
        <section>
          {heading(TITLES.certifications)}
          <Bullets items={certs.map((c) => [c.name, c.issuer, formatResumeDate(c.date)].filter(Boolean).join(' - '))} />
        </section>
      )}
      {(resume.additionalSections ?? [])
        .filter((s) => s.title.trim() && s.items.some((i) => i.trim()))
        .map((s, i) => (
          <section key={`${s.title}-${i}`}>
            {heading(s.title.trim())}
            <Bullets items={s.items} />
          </section>
        ))}
    </article>
  )
}
