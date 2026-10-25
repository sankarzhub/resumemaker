export type TemplateId = 'classic' | 'modern' | 'compact' | 'executive' | 'minimal' | 'bold'

/** Template ids match TEMPLATE_IDS in server/src/services/export.service.ts. */
export const TEMPLATES: Array<{ id: TemplateId; label: string; description: string }> = [
  { id: 'classic', label: 'Classic', description: 'Lato, centered header, hairline rules. Safe for any role.' },
  { id: 'modern', label: 'Modern', description: 'Inter with blue accents, left-aligned. Clean and contemporary.' },
  { id: 'compact', label: 'Compact', description: 'Tighter type and spacing. Fits more on one page.' },
  { id: 'executive', label: 'Executive', description: 'Source Serif, centered headings, deep red accents. Formal.' },
  { id: 'minimal', label: 'Minimal', description: 'Generous white space, quiet headings, no rules.' },
  { id: 'bold', label: 'Bold', description: 'Teal header band and heading bars. Stands out, still ATS-safe.' },
]

export type ContactIcons = 'none' | 'inline' | 'badges'

export const CONTACT_ICON_OPTIONS: Array<{ id: ContactIcons; label: string; description: string }> = [
  { id: 'none', label: 'Text', description: 'Contact details as plain text. Safest for ATS.' },
  { id: 'inline', label: 'Icons + text', description: 'A small clickable icon before each contact detail.' },
  { id: 'badges', label: 'Badges', description: 'Clickable LinkedIn, GitHub, email, phone and website icons top-right. Email and phone stay as text for ATS.' },
]

/** PDF-only presentation: contact icons and dragged block offsets (points, by block id). Matches the server. */
export interface ResumeLayout {
  contactIcons: ContactIcons
  offsets: Record<string, { x: number; y: number }>
  /** Section keys in print order ("experience", "extra-0"…); sections not listed follow in the default order. */
  sectionOrder: string[]
}

export const emptyLayout = (): ResumeLayout => ({ contactIcons: 'none', offsets: {}, sectionOrder: [] })

/** One movable block on one PDF page, in points from the page's top-left (see server LayoutBox). */
export interface LayoutBox {
  id: string
  label: string
  page: number
  x: number
  y: number
  w: number
  h: number
  ox: number
  oy: number
  parent?: string
}

export interface PersonalInfo {
  fullName: string
  email: string
  phone: string
  location: string
  linkedin: string
  github: string
  portfolio: string
}

/** Client-only identity for an entry while reviewing an import (stripped by the server on save). */
interface Keyed {
  _key?: string
}

export interface Experience extends Keyed {
  company: string
  jobTitle: string
  location: string
  startDate: string
  endDate: string
  current: boolean
  description: string[]
}

export interface Education extends Keyed {
  institution: string
  degree: string
  field: string
  location: string
  startDate: string
  endDate: string
  grade: string
}

export interface Project extends Keyed {
  name: string
  description: string[]
  technologies: string[]
  url: string
}

export interface Certification extends Keyed {
  name: string
  issuer: string
  date: string
  url: string
}

export interface AdditionalSection {
  title: string
  items: string[]
}

export interface ResumeContent {
  targetJobTitle: string
  personalInfo: PersonalInfo
  summary: string
  skills: string[]
  experience: Experience[]
  education: Education[]
  projects: Project[]
  certifications: Certification[]
  /** Achievements, Activities, Languages, Awards, Volunteering, Publications… */
  additionalSections: AdditionalSection[]
}

export interface Resume extends ResumeContent {
  id: string
  title: string
  templateId: TemplateId
  fitToPage: boolean
  layout: ResumeLayout
  source: 'manual' | 'upload' | 'ai'
  createdAt: string
  updatedAt: string
}

export interface ResumeListItem {
  id: string
  title: string
  templateId: TemplateId
  targetJobTitle: string
  fullName: string
  source: Resume['source']
  score: number
  updatedAt: string
  createdAt: string
}

export interface CategoryResult {
  key: string
  label: string
  earned: number
  max: number
  reasons: string[]
}

export interface QualityReport {
  score: number
  scoreType: 'estimated'
  breakdown: CategoryResult[]
  warnings: string[]
  suggestions: string[]
  disclaimer: string
}

export type MatchStatus = 'listed-and-evidenced' | 'listed' | 'evidenced' | 'related' | 'not-evidenced'

export interface SkillMatch {
  skill: string
  importance: 'required' | 'preferred'
  status: MatchStatus
  evidence: string[]
  related: string[]
}

export interface JobMatchReport {
  score: number
  scoreType: 'estimated'
  breakdown: CategoryResult[]
  skills: SkillMatch[]
  matchedSkills: string[]
  relatedSkills: string[]
  missingSkills: string[]
  titleMatch: { jobTitle: string | null; resumeTitles: string[]; matches: boolean }
  suggestions: string[]
  disclaimer: string
}

export interface AiSuggestion {
  id: string
  section: 'summary' | 'experience' | 'projects' | 'skills'
  entryIndex: number
  bulletIndex: number
  original: string
  suggested: string
  reason: string
}

export type DocRole = 'resume' | 'linkedin' | 'other'

export interface Conflict {
  /** Where the field is right now, e.g. "experience[1].startDate"; null if the user removed that entry. */
  path: string | null
  label: string
  options: Array<{ source: string; value: string }>
  selected: string
  /** Stable id (the path when the draft was created), used to remember choices across edits/reorders. */
  id?: string
  /** Client-side: the _key of the entry the field belongs to. */
  entryKey?: string
}

export interface ImportResult {
  draft: ResumeContent
  heuristicDraft: ResumeContent
  rawText: string
  warnings: string[]
  detectedSections: string[]
  sources: Array<{ name: string; role: DocRole; fileKind?: string; detectedSections: string[]; chars: number }>
  conflicts: Conflict[]
  mergeNotes: string[]
  /** What the reader did or left out (multi-column layout, removed personal details, starter summary…). */
  notes: string[]
  /** Sentences from the user's own documents that could become bullets for entries with too few. */
  bulletSuggestions?: Array<{ section: 'experience' | 'projects'; index: number; sentences: string[] }>
  ai: { requested: boolean; used: boolean; changes: string[]; missingInfo: string[]; error?: string }
  quality: QualityReport
  jobMatch: JobMatchReport | null
  fileName?: string
}

export function emptyResumeContent(): ResumeContent {
  return {
    targetJobTitle: '',
    personalInfo: { fullName: '', email: '', phone: '', location: '', linkedin: '', github: '', portfolio: '' },
    summary: '',
    skills: [],
    experience: [],
    education: [],
    projects: [],
    certifications: [],
    additionalSections: [],
  }
}

export const emptyExperience = (): Experience => ({ company: '', jobTitle: '', location: '', startDate: '', endDate: '', current: false, description: [''] })
export const emptyEducation = (): Education => ({ institution: '', degree: '', field: '', location: '', startDate: '', endDate: '', grade: '' })
export const emptyProject = (): Project => ({ name: '', description: [''], technologies: [], url: '' })
export const emptyCertification = (): Certification => ({ name: '', issuer: '', date: '', url: '' })

/** Strip id/metadata so a Resume can be sent back as content. */
export function toContent(r: ResumeContent): ResumeContent {
  return {
    targetJobTitle: r.targetJobTitle ?? '',
    personalInfo: { ...r.personalInfo },
    summary: r.summary,
    skills: r.skills,
    experience: r.experience,
    education: r.education,
    projects: r.projects,
    certifications: r.certifications,
    additionalSections: r.additionalSections ?? [],
  }
}
