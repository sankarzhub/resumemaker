import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import * as resumeApi from '../api/resumeApi'
import { PreviewPane } from '../components/resume/PreviewPane'
import { emptyResumeContent, TEMPLATES } from '../types/resume'

// jsdom has no canvas/ResizeObserver; the PDF drawing itself is covered by the E2E test.
vi.mock('../utils/pdfjs', () => ({ loadPdfjs: () => new Promise(() => {}) }))
class RO {
  observe() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', RO)

const content = { ...emptyResumeContent(), personalInfo: { ...emptyResumeContent().personalInfo, fullName: 'Test Person' } }

describe('PreviewPane', () => {
  afterEach(() => vi.restoreAllMocks())

  it('offers all six ATS-safe templates', async () => {
    vi.spyOn(resumeApi, 'previewPdf').mockResolvedValue({ data: new ArrayBuffer(8), pages: 1, scale: 1, spacing: 1, fitted: false })
    const onTemplate = vi.fn()
    render(<PreviewPane content={content} templateId="classic" fitToPage={false} onTemplate={onTemplate} onFitToPage={() => {}} />)
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(TEMPLATES.map((t) => t.label))
    await userEvent.click(screen.getByRole('radio', { name: 'Executive' }))
    expect(onTemplate).toHaveBeenCalledWith('executive')
  })

  it('shows the real page count and suggests fitting when the PDF has 2 pages', async () => {
    const spy = vi.spyOn(resumeApi, 'previewPdf').mockResolvedValue({ data: new ArrayBuffer(8), pages: 2, scale: 1, spacing: 1, fitted: false })
    const onFit = vi.fn()
    render(<PreviewPane content={content} templateId="modern" fitToPage={false} onTemplate={() => {}} onFitToPage={onFit} />)
    expect(await screen.findByText(/2 pages/)).toBeInTheDocument()
    expect(screen.getByText(/Turn on “Fit to one page”/)).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ personalInfo: expect.objectContaining({ fullName: 'Test Person' }) }), 'modern', false, expect.anything())
    await userEvent.click(screen.getByLabelText(/Fit to one page/))
    expect(onFit).toHaveBeenCalledWith(true)
  })

  it('reports a fitted one-page result with its text scale', async () => {
    vi.spyOn(resumeApi, 'previewPdf').mockResolvedValue({ data: new ArrayBuffer(8), pages: 1, scale: 0.92, spacing: 0.6, fitted: true })
    render(<PreviewPane content={content} templateId="classic" fitToPage onTemplate={() => {}} onFitToPage={() => {}} />)
    expect(await screen.findByText(/1 page \(fitted: text 92%, spacing 60%\)/)).toBeInTheDocument()
  })

  it('shows an error with retry when the preview fails', async () => {
    const spy = vi.spyOn(resumeApi, 'previewPdf').mockRejectedValueOnce(new Error('down')).mockResolvedValue({ data: new ArrayBuffer(8), pages: 1, scale: 1, spacing: 1, fitted: false })
    render(<PreviewPane content={content} templateId="classic" fitToPage={false} onTemplate={() => {}} onFitToPage={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/1 page/)).toBeInTheDocument()
  })
})
