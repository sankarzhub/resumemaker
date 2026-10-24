import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { anchorConflicts, conflictMap, conflictStatus, describePath, keyEntries, liveConflicts, setByPath, stripKeys } from '../utils/resumePath'
import { ConflictsPanel } from '../components/analysis/ConflictsPanel'
import { ResumeForm } from '../components/resume/ResumeForm'
import { ResumePreview } from '../components/resume/ResumePreview'
import { emptyExperience, emptyResumeContent, type Conflict, type ResumeContent } from '../types/resume'

const base = (): ResumeContent => ({
  ...emptyResumeContent(),
  experience: [
    { ...emptyExperience(), jobTitle: 'Engineer', company: 'Acme', startDate: 'Jan 2021', endDate: 'May 2022', description: ['Built things'] },
    { ...emptyExperience(), jobTitle: 'Intern', company: 'Beta', startDate: 'Jan 2020', endDate: 'Dec 2020', description: ['Tested things'] },
  ],
})

const conflict = (): Conflict => ({
  path: 'experience[0].startDate',
  label: 'Acme: start date',
  options: [
    { source: 'cv.pdf (Resume)', value: 'Jan 2021' },
    { source: 'Profile.pdf (LinkedIn)', value: 'Feb 2021' },
  ],
  selected: 'Jan 2021',
})

describe('setByPath / describePath', () => {
  it('sets nested fields immutably', () => {
    const r = base()
    const next = setByPath(r, 'experience[0].startDate', 'Feb 2021')
    expect(next.experience[0].startDate).toBe('Feb 2021')
    expect(r.experience[0].startDate).toBe('Jan 2021')
    expect(setByPath(r, 'personalInfo.email', 'a@b.co').personalInfo.email).toBe('a@b.co')
  })

  it('treats "Present" end dates as current roles', () => {
    const next = setByPath(base(), 'experience[0].endDate', 'Present')
    expect(next.experience[0]).toMatchObject({ current: true, endDate: '' })
    expect(setByPath(next, 'experience[0].endDate', 'Dec 2023').experience[0]).toMatchObject({ current: false, endDate: 'Dec 2023' })
  })

  it('ignores unknown or out-of-range paths', () => {
    const r = base()
    expect(setByPath(r, 'experience[5].startDate', 'x')).toBe(r)
    expect(setByPath(r, '__proto__.polluted', 'x')).toBe(r)
    expect(setByPath(r, 'personalInfo.notAField', 'x')).toBe(r)
  })

  it('describes exactly where a field is', () => {
    expect(describePath(base(), 'experience[0].startDate')).toEqual(['Work Experience', 'Acme — Engineer', 'Start date'])
    expect(describePath(base(), 'personalInfo.phone')).toEqual(['Contact', 'Phone'])
  })
})

describe('conflict tracking', () => {
  it('is pending until the user picks a value or edits the field', () => {
    const r = base()
    const c = conflict()
    expect(conflictStatus(c, r, {})).toBe('pending')
    expect(conflictStatus(c, r, { [c.path!]: 'Feb 2021' })).toBe('chosen')
    expect(conflictStatus(c, setByPath(r, c.path!, 'Mar 2021'), {})).toBe('edited')
  })

  it('follows the entry when roles are reordered, and settles when it is deleted', () => {
    const keyed = keyEntries(base())
    const [anchored] = anchorConflicts([conflict()], keyed)
    const moved = { ...keyed, experience: [keyed.experience[1], keyed.experience[0]] }
    expect(liveConflicts([anchored], moved)[0].path).toBe('experience[1].startDate')
    const removed = { ...keyed, experience: [keyed.experience[1]] }
    const live = liveConflicts([anchored], removed)[0]
    expect(live.path).toBeNull()
    expect(conflictStatus(live, removed, {})).toBe('removed')
  })

  it('strips client-only keys before saving', () => {
    const saved = stripKeys(keyEntries(base()))
    expect(JSON.stringify(saved)).not.toContain('_key')
  })
})

describe('ConflictsPanel', () => {
  it('shows where each difference is, its status, and what the resume currently uses', async () => {
    const onChoose = vi.fn()
    const onJump = vi.fn()
    render(<ConflictsPanel conflicts={[conflict()]} draft={base()} choices={{}} onChoose={onChoose} onJump={onJump} />)
    expect(screen.getByText('0 of 1 confirmed')).toBeInTheDocument()
    expect(screen.getByText('Needs your choice')).toBeInTheDocument()
    expect(screen.getByLabelText(/Location: Work Experience, Acme — Engineer, Start date/)).toBeInTheDocument()
    expect(screen.getByText(/Not confirmed yet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Feb 2021/ }))
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ path: 'experience[0].startDate' }), 'Feb 2021')
    await userEvent.click(screen.getByRole('button', { name: /show me/i }))
    expect(onJump).toHaveBeenCalledWith('experience[0].startDate')
  })

  it('shows confirmed with the chosen value and its source', () => {
    const draft = setByPath(base(), 'experience[0].startDate', 'Feb 2021')
    render(<ConflictsPanel conflicts={[conflict()]} draft={draft} choices={{ 'experience[0].startDate': 'Feb 2021' }} onChoose={() => {}} onJump={() => {}} />)
    expect(screen.getByText('All differences confirmed')).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByText(/from Profile\.pdf \(LinkedIn\)\./)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Feb 2021/ })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('conflict highlighting in the form and preview', () => {
  it('marks the exact form field and the preview entry', () => {
    const r = base()
    const flags = conflictMap([conflict()], r, {})
    render(
      <>
        <ResumeForm value={r} onChange={() => {}} flags={flags} />
        <ResumePreview resume={r} marks={{ 'experience[0].startDate': 'pending' }} />
      </>,
    )
    const startInputs = screen.getAllByLabelText('Start date')
    expect(startInputs[0]).toHaveAttribute('aria-invalid', 'true')
    expect(startInputs[0]).toHaveAttribute('data-path', 'experience[0].startDate')
    expect(startInputs[1]).not.toHaveAttribute('aria-invalid')
    expect(screen.getByText(/Your documents disagree: “Jan 2021” \(cv\.pdf \(Resume\)\) vs “Feb 2021”/)).toBeInTheDocument()
    expect(screen.getByText('1 to confirm')).toBeInTheDocument()
    expect(screen.getByText('⚠ Check start date')).toBeInTheDocument()
  })
})
