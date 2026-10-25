import { api } from './axios'
import type { AiSuggestion, DocRole, ImportResult, JobMatchReport, LayoutBox, QualityReport, Resume, ResumeContent, ResumeLayout, ResumeListItem, TemplateId } from '../types/resume'

// AI calls can take a while on long documents.
const AI_TIMEOUT = 240_000

export interface Paged<T> {
  items: T[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export async function listResumes(page = 1, limit = 50): Promise<Paged<ResumeListItem>> {
  return (await api.get('/resumes', { params: { page, limit } })).data.data
}

export async function getResume(id: string): Promise<Resume> {
  return (await api.get(`/resumes/${id}`)).data.data
}

export async function createResume(input: Partial<ResumeContent> & { title: string; templateId?: TemplateId; fitToPage?: boolean; layout?: ResumeLayout; source?: Resume['source'] }): Promise<Resume> {
  return (await api.post('/resumes', input)).data.data
}

export interface PdfPreview {
  data: ArrayBuffer
  pages: number
  scale: number
  spacing: number
  fitted: boolean
  boxes: LayoutBox[]
}

/** The exact PDF the export would produce, for unsaved content. */
export async function previewPdf(content: ResumeContent, templateId: TemplateId, fitToPage: boolean, layout: ResumeLayout, signal?: AbortSignal): Promise<PdfPreview> {
  const res = await api.post('/resumes/preview', { ...content, templateId, fitToPage, layout }, { signal, timeout: 30_000 })
  const out = res.data.data as Omit<PdfPreview, 'data'> & { pdf: string }
  const bin = atob(out.pdf)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { data: bytes.buffer, pages: out.pages, scale: out.scale, spacing: out.spacing, fitted: out.fitted, boxes: out.boxes ?? [] }
}

export async function updateResume(id: string, input: Partial<ResumeContent> & { title?: string; templateId?: TemplateId; fitToPage?: boolean; layout?: ResumeLayout }): Promise<Resume> {
  return (await api.patch(`/resumes/${id}`, input)).data.data
}

export async function deleteResume(id: string): Promise<void> {
  await api.delete(`/resumes/${id}`)
}

export async function duplicateResume(id: string): Promise<Resume> {
  return (await api.post(`/resumes/${id}/duplicate`)).data.data
}

export async function uploadResume(
  files: Array<{ file: File; role: DocRole | 'auto' }>,
  opts: { useAi: boolean; jobDescription?: string },
  onProgress?: (pct: number) => void,
): Promise<ImportResult> {
  const form = new FormData()
  form.append('useAi', String(opts.useAi))
  if (opts.jobDescription) form.append('jobDescription', opts.jobDescription)
  // Text fields go before files so the server has them when parsing the multipart body.
  form.append('roles', JSON.stringify(files.map((f) => f.role)))
  for (const f of files) form.append('files', f.file)
  const res = await api.post('/resumes/upload', form, {
    timeout: AI_TIMEOUT,
    onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
  })
  return res.data.data
}

export async function importText(text: string, opts: { useAi: boolean; jobDescription?: string }): Promise<ImportResult> {
  return (await api.post('/resumes/import-text', { text, ...opts }, { timeout: AI_TIMEOUT })).data.data
}

export async function analyzeResume(id: string): Promise<QualityReport & { analysisId: string }> {
  return (await api.post(`/resumes/${id}/analyze`, {})).data.data
}

export async function jobMatch(id: string, jobDescription: string): Promise<JobMatchReport & { analysisId: string }> {
  return (await api.post(`/resumes/${id}/job-match`, { jobDescription })).data.data
}

export async function improveResume(id: string, jobDescription?: string): Promise<AiSuggestion[]> {
  return (await api.post(`/resumes/${id}/improve`, { jobDescription: jobDescription || undefined }, { timeout: AI_TIMEOUT })).data.data.suggestions
}

export function exportUrl(id: string, format: 'pdf' | 'docx') {
  const base = import.meta.env.VITE_API_BASE_URL ?? '/api'
  return `${base}/resumes/${id}/export?format=${format}`
}
