import type { AiSuggestion, ResumeContent } from '../types/resume'

/** Apply one accepted AI suggestion to the resume content (pure). */
export function applySuggestion(r: ResumeContent, s: AiSuggestion): ResumeContent {
  if (s.section === 'summary') return { ...r, summary: s.suggested }
  if (s.section === 'skills') return r.skills.some((k) => k.toLowerCase() === s.suggested.toLowerCase()) ? r : { ...r, skills: [...r.skills, s.suggested] }
  const key = s.section
  const list = r[key]
  const entry = list[s.entryIndex]
  if (!entry || entry.description[s.bulletIndex] === undefined) return r
  const description = entry.description.map((b, i) => (i === s.bulletIndex ? s.suggested : b))
  return { ...r, [key]: list.map((e, i) => (i === s.entryIndex ? { ...e, description } : e)) }
}
