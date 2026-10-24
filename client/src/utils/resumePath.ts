import type { Conflict, ResumeContent } from '../types/resume'

// Mirrors getByPath in server/src/services/resumeMerge.service.ts.
const PATH = /^(personalInfo)\.(\w+)$|^(experience|education|projects|certifications)\[(\d+)\]\.(\w+)$|^(summary|targetJobTitle)$/

type Rec = Record<string, unknown>

export function getByPath(r: ResumeContent, path: string): string | undefined {
  const m = path.match(PATH)
  if (!m) return undefined
  if (m[1]) {
    const v = (r.personalInfo as unknown as Rec)[m[2]]
    return typeof v === 'string' ? v : undefined
  }
  if (m[3]) {
    const entry = (r[m[3] as 'experience'] as unknown as Rec[])[Number(m[4])]
    if (!entry) return undefined
    if (m[5] === 'endDate' && entry.current) return 'Present'
    const v = entry[m[5]]
    return typeof v === 'string' ? v : undefined
  }
  return (r as unknown as Record<string, string>)[m[6]]
}

/** Immutably set a string field addressed like "experience[1].startDate". Unknown paths return the input unchanged. */
export function setByPath(r: ResumeContent, path: string, value: string): ResumeContent {
  const m = path.match(PATH)
  if (!m) return r
  if (m[1]) {
    if (!(m[2] in r.personalInfo)) return r
    return { ...r, personalInfo: { ...r.personalInfo, [m[2]]: value } }
  }
  if (m[3]) {
    const key = m[3] as 'experience' | 'education' | 'projects' | 'certifications'
    const list = r[key] as unknown as Rec[]
    const idx = Number(m[4])
    const entry = list[idx]
    if (!entry || typeof entry[m[5]] !== 'string') return r
    let next: Rec = { ...entry, [m[5]]: value }
    // "Present" for an end date means the role is current.
    if (key === 'experience' && m[5] === 'endDate') next = value === 'Present' ? { ...next, endDate: '', current: true } : { ...next, current: false }
    return { ...r, [key]: list.map((e, i) => (i === idx ? next : e)) }
  }
  return { ...r, [m[6]]: value }
}

const SECTION_NAMES: Record<string, string> = {
  personalInfo: 'Contact',
  experience: 'Work Experience',
  education: 'Education',
  projects: 'Projects',
  certifications: 'Certifications',
  summary: 'Summary',
  targetJobTitle: 'Contact',
}

const FIELD_NAMES: Record<string, string> = {
  fullName: 'Full name',
  email: 'Email',
  phone: 'Phone',
  location: 'Location',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  portfolio: 'Portfolio',
  jobTitle: 'Job title',
  company: 'Company',
  startDate: 'Start date',
  endDate: 'End date',
  degree: 'Degree',
  field: 'Field of study',
  institution: 'Institution',
  grade: 'Grade',
  name: 'Name',
  issuer: 'Issuer',
  date: 'Date',
  summary: 'Summary',
  targetJobTitle: 'Target job title',
}

/** Human location of a field: ["Work Experience", "Qspiders — Java Fullstack Development", "Start date"]. */
export function describePath(r: ResumeContent, path: string): string[] {
  const m = path.match(PATH)
  if (!m) return [path]
  if (m[1]) return [SECTION_NAMES.personalInfo, FIELD_NAMES[m[2]] ?? m[2]]
  if (m[3]) {
    const entry = (r[m[3] as 'experience'] as unknown as Rec[])[Number(m[4])] ?? {}
    const s = (k: string) => (typeof entry[k] === 'string' ? (entry[k] as string) : '')
    const label =
      m[3] === 'experience'
        ? [s('company'), s('jobTitle')].filter(Boolean).join(' — ')
        : m[3] === 'education'
          ? [s('institution'), s('degree')].filter(Boolean).join(' — ')
          : s('name')
    return [SECTION_NAMES[m[3]], label || `Entry ${Number(m[4]) + 1}`, FIELD_NAMES[m[5]] ?? m[5]]
  }
  return [SECTION_NAMES[m[6]], FIELD_NAMES[m[6]] ?? m[6]]
}

const LIST_KEYS = ['experience', 'education', 'projects', 'certifications'] as const

/** Give every entry a stable client-side key so conflicts keep pointing at the right entry after edits. */
export function keyEntries(r: ResumeContent): ResumeContent {
  const out = { ...r }
  for (const k of LIST_KEYS) {
    ;(out[k] as Array<{ _key?: string }>) = (r[k] as Array<{ _key?: string }>).map((e, i) => ({ ...e, _key: e._key ?? `${k}-${i}` }))
  }
  return out
}

/** Remember which entry each conflict belongs to (call once, on the freshly keyed draft). */
export function anchorConflicts(conflicts: Conflict[], keyed: ResumeContent): Conflict[] {
  return conflicts.map((c) => {
    const m = c.path?.match(/^(experience|education|projects|certifications)\[(\d+)\]\./)
    const entryKey = m ? (keyed[m[1] as (typeof LIST_KEYS)[number]][Number(m[2])] as { _key?: string } | undefined)?._key : undefined
    return { ...c, id: c.id ?? c.path ?? c.label, entryKey }
  })
}

/** Re-point anchored conflicts at the entry's current index (entries may have been moved or removed). */
export function liveConflicts(anchored: Conflict[], draft: ResumeContent): Conflict[] {
  return anchored.map((c) => {
    if (!c.entryKey || !c.id) return c
    const m = c.id.match(/^(experience|education|projects|certifications)\[\d+\]\.(\w+)$/)
    if (!m) return c
    const idx = (draft[m[1] as (typeof LIST_KEYS)[number]] as Array<{ _key?: string }>).findIndex((e) => e._key === c.entryKey)
    return { ...c, path: idx >= 0 ? `${m[1]}[${idx}].${m[2]}` : null }
  })
}

/** Remove client-only keys before sending content to the server. */
export function stripKeys(r: ResumeContent): ResumeContent {
  const out = { ...r }
  for (const k of LIST_KEYS) {
    ;(out[k] as unknown as Array<Record<string, unknown>>) = (r[k] as unknown as Array<Record<string, unknown>>).map(({ _key: _ignored, ...rest }) => rest)
  }
  return out
}

export type ConflictStatus = 'pending' | 'chosen' | 'edited' | 'removed'

const idOf = (c: Conflict) => c.id ?? c.path ?? c.label

/**
 * A conflict is settled when the user picked one of the options, edited the field themselves (its value
 * no longer matches what we pre-filled), or deleted the entry it belongs to.
 */
export function conflictStatus(c: Conflict, draft: ResumeContent, choices: Record<string, string>): ConflictStatus {
  if (c.path === null) return 'removed'
  if (choices[idOf(c)] !== undefined) return 'chosen'
  const now = getByPath(draft, c.path)
  if (now !== undefined && now.trim() !== c.selected.trim()) return 'edited'
  return 'pending'
}

export function conflictId(c: Conflict): string {
  return idOf(c)
}

export interface FieldFlag {
  status: ConflictStatus
  conflict: Conflict
}

/** Status per current path, for highlighting fields in the form and preview. */
export function conflictMap(conflicts: Conflict[], draft: ResumeContent, choices: Record<string, string>): Record<string, FieldFlag> {
  const out: Record<string, FieldFlag> = {}
  for (const c of conflicts) if (c.path) out[c.path] = { status: conflictStatus(c, draft, choices), conflict: c }
  return out
}

/** Scroll the editor to a field (inputs carry data-path), opening its section if collapsed, and flash it. */
export function jumpToPath(path: string, attempt = 0): boolean {
  const el = document.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
  if (!el) {
    const section = path.split(/[.[]/)[0] === 'targetJobTitle' ? 'personalInfo' : path.split(/[.[]/)[0]
    const toggle = document.querySelector<HTMLButtonElement>(`[data-section="${section}"][aria-expanded="false"]`)
    if (toggle && attempt === 0) {
      toggle.click()
      requestAnimationFrame(() => jumpToPath(path, 1))
      return true
    }
    return false
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.remove('flash-field')
  void el.offsetWidth
  el.classList.add('flash-field')
  if (el instanceof HTMLInputElement && !el.disabled) setTimeout(() => el.focus({ preventScroll: true }), 350)
  return true
}
