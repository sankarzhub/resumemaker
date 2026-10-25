import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import * as resumeApi from '../api/resumeApi'
import { PreviewPane } from '../components/resume/PreviewPane'
import { emptyLayout, emptyResumeContent, TEMPLATES } from '../types/resume'

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
    vi.spyOn(resumeApi, 'previewPdf').mockResolvedValue({ data: new ArrayBuffer(8), pages: 1, scale: 1, spacing: 1, fitted: false, boxes: [] })
    const onTemplate = vi.fn()
    render(<PreviewPane content={content} templateId="classic" fitToPage={false} onTemplate={onTemplate} onFitToPage={() => {}} layout={emptyLayout()} onLayout={() => {}} onContent={() => {}} />)
    const group = screen.getByRole('radiogroup', { name: 'Template' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(TEMPLATES.map((t) => t.label))
    await userEvent.click(screen.getByRole('radio', { name: 'Executive' }))
    expect(onTemplate).toHaveBeenCalledWith('executive')
  })

  it('shows the real page count and suggests fitting when the PDF has 2 pages', async () => {
    const spy = vi.spyOn(resumeApi, 'previewPdf').mockResolvedValue({ data: new ArrayBuffer(8), pages: 2, scale: 1, spacing: 1, fitted: false, boxes: [] })
    const onFit = vi.fn()
    render(<PreviewPane content={content} templateId="modern" fitToPage={false} onTemplate={() => {}} onFitToPage={onFit} layout={emptyLayout()} onLayout={() => {}} onContent={() => {}} />)
    expect(await screen.findByText(/2 pages/)).toBeInTheDocument()
    expect(screen.getByText(/Turn on “Fit to one page”/)).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ personalInfo: expect.objectContaining({ fullName: 'Test Person' }) }), 'modern', false, emptyLayout(), expect.anything())
    await userEvent.click(screen.getByLabelText(/Fit to one page/))
    expect(onFit).toHaveBeenCalledWith(true)
  })

  it('switches contact icons and resets dragged positions', async () => {
    vi.spyOn(resumeApi, 'previewPdf').mockResolvedValue({ data: new ArrayBuffer(8), pages: 1, scale: 1, spacing: 1, fitted: false, boxes: [] })
    const onLayout = vi.fn()
    const layout = { contactIcons: 'none' as const, offsets: { name: { x: 10, y: 0 }, 'exp-0': { x: 0, y: 12 } }, sectionOrder: [] }
    render(<PreviewPane content={content} templateId="classic" fitToPage={false} onTemplate={() => {}} onFitToPage={() => {}} layout={layout} onLayout={onLayout} onContent={() => {}} />)
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Contact links' })).getByRole('radio', { name: 'Badges' }))
    expect(onLayout).toHaveBeenLastCalledWith({ ...layout, contactIcons: 'badges' })
    await userEvent.click(screen.getByRole('button', { name: 'Move items' }))
    expect(screen.getByText(/Drag anything on the page/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset all positions (2)' }))
    expect(onLayout).toHaveBeenLastCalledWith({ contactIcons: 'none', offsets: {}, sectionOrder: [] })
  })

  it('reports a fitted one-page result with its text scale', async () => {
    vi.spyOn(resumeApi, 'previewPdf').mockResolvedValue({ data: new ArrayBuffer(8), pages: 1, scale: 0.92, spacing: 0.6, fitted: true, boxes: [] })
    render(<PreviewPane content={content} templateId="classic" fitToPage onTemplate={() => {}} onFitToPage={() => {}} layout={emptyLayout()} onLayout={() => {}} onContent={() => {}} />)
    expect(await screen.findByText(/1 page \(fitted: text 92%, spacing 60%\)/)).toBeInTheDocument()
  })

  it('shows an error with retry when the preview fails', async () => {
    const spy = vi.spyOn(resumeApi, 'previewPdf').mockRejectedValueOnce(new Error('down')).mockResolvedValue({ data: new ArrayBuffer(8), pages: 1, scale: 1, spacing: 1, fitted: false, boxes: [] })
    render(<PreviewPane content={content} templateId="classic" fitToPage={false} onTemplate={() => {}} onFitToPage={() => {}} layout={emptyLayout()} onLayout={() => {}} onContent={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/1 page/)).toBeInTheDocument()
  })
})
