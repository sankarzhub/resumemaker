import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { applySuggestion } from '../utils/suggestions'
import { ResumePreview } from '../components/resume/ResumePreview'
import { ResumeForm } from '../components/resume/ResumeForm'
import { SuggestionCard } from '../components/analysis/Reports'
import { emptyResumeContent, type ResumeContent } from '../types/resume'
import * as authApi from '../api/authApi'
import { AuthProvider } from '../hooks/useAuth'
import { LoginPage, RegisterPage } from '../pages/AuthPages'
import { DashboardPage } from '../pages/DashboardPage'
import * as resumeApi from '../api/resumeApi'

function sample(): ResumeContent {
  return {
    ...emptyResumeContent(),
    targetJobTitle: 'Developer',
    personalInfo: { ...emptyResumeContent().personalInfo, fullName: 'Test Person', email: 'test@example.com', linkedin: 'https://www.linkedin.com/in/test/' },
    summary: 'Old summary',
    skills: ['React'],
    experience: [{ company: 'Acme', jobTitle: 'Engineer', location: '', startDate: '2022-03', endDate: '', current: true, description: ['did things', 'second'] }],
  }
}

afterEach(() => vi.restoreAllMocks())

describe('applySuggestion', () => {
  it('replaces exactly the targeted bullet', () => {
    const next = applySuggestion(sample(), { id: 's0', section: 'experience', entryIndex: 0, bulletIndex: 0, original: 'did things', suggested: 'Built things', reason: '' })
    expect(next.experience[0].description).toEqual(['Built things', 'second'])
  })
  it('updates the summary and adds new skills without duplicates', () => {
    let r = applySuggestion(sample(), { id: 'a', section: 'summary', entryIndex: -1, bulletIndex: -1, original: 'Old summary', suggested: 'New summary', reason: '' })
    r = applySuggestion(r, { id: 'b', section: 'skills', entryIndex: -1, bulletIndex: -1, original: '', suggested: 'Node.js', reason: '' })
    r = applySuggestion(r, { id: 'c', section: 'skills', entryIndex: -1, bulletIndex: -1, original: '', suggested: 'react', reason: '' })
    expect(r.summary).toBe('New summary')
    expect(r.skills).toEqual(['React', 'Node.js'])
  })
  it('ignores out-of-range targets', () => {
    const r = sample()
    expect(applySuggestion(r, { id: 'x', section: 'projects', entryIndex: 3, bulletIndex: 0, original: '', suggested: 'x', reason: '' })).toBe(r)
  })
})

describe('ResumePreview', () => {
  it('renders standard headings, formatted dates and plain links', () => {
    render(<ResumePreview resume={sample()} />)
    expect(screen.getByText('Test Person')).toBeInTheDocument()
    expect(screen.getByText('PROFESSIONAL SUMMARY')).toBeInTheDocument()
    expect(screen.getByText('WORK EXPERIENCE')).toBeInTheDocument()
    expect(screen.getByText('Mar 2022 - Present')).toBeInTheDocument()
    expect(screen.getByText(/linkedin\.com\/in\/test/)).toBeInTheDocument()
    expect(screen.queryByText('PROJECTS')).not.toBeInTheDocument()
  })

  it('renders additional sections with their own headings', () => {
    render(<ResumePreview resume={{ ...sample(), additionalSections: [{ title: 'Achievements', items: ['Won a hackathon'] }, { title: 'Empty', items: [''] }] }} />)
    expect(screen.getByText('ACHIEVEMENTS')).toBeInTheDocument()
    expect(screen.getByText('Won a hackathon')).toBeInTheDocument()
    expect(screen.queryByText('EMPTY')).not.toBeInTheDocument()
  })
})

describe('ResumeForm', () => {
  it('adds skills with Enter and comma', async () => {
    const onChange = vi.fn()
    render(<ResumeForm value={sample()} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Add Skills'), 'TypeScript{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ skills: ['React', 'TypeScript'] }))
  })

  it('adds a new experience entry', async () => {
    const onChange = vi.fn()
    render(<ResumeForm value={sample()} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /add role/i }))
    expect(onChange.mock.lastCall![0].experience).toHaveLength(2)
  })
})

describe('SuggestionCard', () => {
  it('shows original vs suggested with accept/reject', async () => {
    const accept = vi.fn()
    const reject = vi.fn()
    render(<SuggestionCard s={{ id: 'a', section: 'summary', entryIndex: -1, bulletIndex: -1, original: 'Before', suggested: 'After', reason: 'Clearer' }} onAccept={accept} onReject={reject} />)
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText('After')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /accept/i }))
    await userEvent.click(screen.getByRole('button', { name: /reject/i }))
    expect(accept).toHaveBeenCalledOnce()
    expect(reject).toHaveBeenCalledOnce()
  })
})

function withProviders(ui: React.ReactNode) {
  return render(
    <AuthProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </AuthProvider>,
  )
}

describe('auth forms', () => {
  beforeEach(() => {
    vi.spyOn(authApi, 'fetchMe').mockRejectedValue(new Error('401'))
  })

  it('shows validation messages for an empty login form', async () => {
    withProviders(<LoginPage />)
    await userEvent.click(await screen.findByRole('button', { name: /log in/i }))
    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
  })

  it('shows the server error when login fails', async () => {
    const { AxiosError } = await import('axios')
    vi.spyOn(authApi, 'login').mockRejectedValue(
      new AxiosError('x', '401', undefined, undefined, { status: 401, data: { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' } } } as never),
    )
    withProviders(<LoginPage />)
    await userEvent.type(await screen.findByLabelText('Email'), 'a@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument()
  })

  it('checks that passwords match on register', async () => {
    withProviders(<RegisterPage />)
    await userEvent.type(await screen.findByLabelText('Full name'), 'A')
    await userEvent.type(screen.getByLabelText('Email'), 'a@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'Passw0rd!')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Different1')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
  })
})

describe('dashboard states', () => {
  beforeEach(() => {
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue({ id: '1', name: 'Asha Demo', email: 'asha@example.com' })
    vi.spyOn(authApi, 'fetchConfig').mockResolvedValue({ aiAvailable: false })
  })

  it('shows an error with retry, then recovers', async () => {
    const list = vi.spyOn(resumeApi, 'listResumes').mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ items: [], page: 1, limit: 50, total: 0, totalPages: 0 })
    withProviders(<DashboardPage />)
    await userEvent.click(await screen.findByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.getByText('No resumes yet!')).toBeInTheDocument())
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('lists resumes with their estimated score', async () => {
    vi.spyOn(resumeApi, 'listResumes').mockResolvedValue({
      items: [{ id: 'r1', title: 'Dev CV', templateId: 'classic', targetJobTitle: 'Dev', fullName: 'Asha Demo', source: 'ai', score: 87, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() }],
      page: 1,
      limit: 50,
      total: 1,
      totalPages: 1,
    })
    withProviders(<DashboardPage />)
    expect(await screen.findByText('Dev CV')).toBeInTheDocument()
    expect(screen.getByText('87')).toBeInTheDocument()
    expect(screen.getByText('AI built')).toBeInTheDocument()
  })
})
