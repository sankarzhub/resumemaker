import type { ResumeContent } from '../types/resume'

/** Bullet suggestions from the server, re-anchored to entries by their client key. */
export interface AnchoredSuggestion {
  section: 'experience' | 'projects'
  entryKey: string
  sentences: string[]
}

export type FixKind = 'bullets' | 'endDate' | 'contact' | 'summary' | 'skills'

export interface FixItem {
  id: string
  kind: FixKind
  title: string
  detail: string
  /** Field to jump to. */
  path: string
  /** For bullet items: where new bullets go, and suggestions from the user's documents not yet added. */
  section?: 'experience' | 'projects'
  index?: number
  suggestions?: string[]
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0)

const CONTACT: Array<[keyof ResumeContent['personalInfo'], string, string]> = [
  ['fullName', 'Add your name', 'Recruiters and ATS systems need it at the top.'],
  ['email', 'Add your email', 'The main way recruiters contact you.'],
  ['phone', 'Add your phone number', 'Most applications expect one.'],
  ['location', 'Add your city', 'Many recruiters filter candidates by location.'],
]

/**
 * What still needs attention, in the order a recruiter reads the resume. Every item can be fixed
 * from the editor; nothing here edits the resume by itself.
 */
export function buildChecklist(r: ResumeContent, suggestions: AnchoredSuggestion[]): FixItem[] {
  const items: FixItem[] = []
  for (const [field, title, detail] of CONTACT) {
    if (!r.personalInfo[field].trim()) items.push({ id: `contact:${field}`, kind: 'contact', title, detail, path: `personalInfo.${field}` })
  }

  const sw = words(r.summary)
  if (sw === 0) items.push({ id: 'summary', kind: 'summary', title: 'Write a short summary', detail: '2-4 sentences (30-80 words) about your role, strengths and focus.', path: 'summary' })
  else if (sw < 25 || sw > 90) items.push({ id: 'summary', kind: 'summary', title: sw < 25 ? 'Expand your summary' : 'Shorten your summary', detail: `It has ${sw} words; aim for 30-80.`, path: 'summary' })

  const skills = r.skills.filter((s) => s.trim()).length
  if (skills < 5) items.push({ id: 'skills', kind: 'skills', title: 'List more skills', detail: `You have ${skills}. Most resumes list 8-20 relevant skills.`, path: 'skills' })

  const sugg = (section: 'experience' | 'projects', key: string | undefined, existing: string[]) => {
    const have = new Set(existing.map(norm))
    return (suggestions.find((s) => s.section === section && s.entryKey === key)?.sentences ?? []).filter((s) => !have.has(norm(s)))
  }

  r.experience.forEach((e, i) => {
    if (!e.jobTitle.trim() && !e.company.trim()) return
    const name = [e.jobTitle, e.company].filter(Boolean).join(' at ')
    const key = e._key ?? `experience-${i}`
    const count = e.description.filter((d) => d.trim()).length
    if (count < 2) {
      items.push({
        id: `bullets:${key}`,
        kind: 'bullets',
        title: `Add bullet points: ${name}`,
        detail: count === 0 ? 'This role has no bullets. ATS checks expect 2-5 bullets describing what you did and the result.' : 'Only 1 bullet. Add at least one more.',
        path: `experience[${i}].description[${Math.max(0, count)}]`,
        section: 'experience',
        index: i,
        suggestions: sugg('experience', e._key, e.description),
      })
    }
    if (e.startDate.trim() && !e.endDate.trim() && !e.current) {
      items.push({ id: `endDate:${key}`, kind: 'endDate', title: `Add an end date: ${name}`, detail: 'Or tick “I currently work here” if it is ongoing.', path: `experience[${i}].endDate` })
    }
  })

  r.projects.forEach((p, i) => {
    if (!p.name.trim()) return
    const key = p._key ?? `projects-${i}`
    if (p.description.filter((d) => d.trim()).length === 0) {
      items.push({
        id: `bullets:${key}`,
        kind: 'bullets',
        title: `Describe the project: ${p.name}`,
        detail: 'Add 1-3 bullets: what you built, with which tools, and the outcome.',
        path: `projects[${i}].description[0]`,
        section: 'projects',
        index: i,
        suggestions: sugg('projects', p._key, p.description),
      })
    }
  })
  return items
}
