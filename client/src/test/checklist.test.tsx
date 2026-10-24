import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { buildChecklist } from '../utils/checklist'
import { FixChecklist } from '../components/analysis/FixChecklist'
import { emptyExperience, emptyProject, emptyResumeContent, type ResumeContent } from '../types/resume'
import { keyEntries } from '../utils/resumePath'

function draft(): ResumeContent {
  return keyEntries({
    ...emptyResumeContent(),
    personalInfo: { ...emptyResumeContent().personalInfo, fullName: 'Test Person', email: 't@example.com', phone: '9876543210', location: '' },
    summary: 'Short summary.',
    skills: ['Java', 'SQL'],
    experience: [
      { ...emptyExperience(), jobTitle: 'Junior Developer', company: 'Demo Co', startDate: 'Jul 2025', endDate: '', current: false, description: [] },
      { ...emptyExperience(), jobTitle: 'Intern', company: 'Beta', startDate: 'Jan 2024', endDate: 'Jun 2024', description: ['Built a tool', 'Wrote tests'] },
    ],
    projects: [{ ...emptyProject(), name: 'Chat App', description: [] }],
  })
}

describe('buildChecklist', () => {
  it('lists what ATS checks need, in reading order', () => {
    const items = buildChecklist(draft(), [])
    expect(items.map((i) => i.id.split(':')[0] + (i.id.includes(':') ? ':' : ''))).toEqual(['contact:', 'summary', 'skills', 'bullets:', 'endDate:', 'bullets:'])
    expect(items.find((i) => i.kind === 'summary')!.title).toBe('Expand your summary')
    expect(items.find((i) => i.id === 'bullets:experience-0')!.title).toBe('Add bullet points: Junior Developer at Demo Co')
  })

  it('offers only suggestions that are not already bullets', () => {
    const d = draft()
    const s = [{ section: 'experience' as const, entryKey: 'experience-0', sentences: ['Develop dashboards for sales teams.', 'Already there.'] }]
    d.experience[0].description = ['Already there.']
    expect(buildChecklist(d, s).find((i) => i.id === 'bullets:experience-0')!.suggestions).toEqual(['Develop dashboards for sales teams.'])
  })

  it('drops items as they get fixed', () => {
    const d = draft()
    d.experience[0] = { ...d.experience[0], current: true, description: ['Built APIs', 'Wrote docs'] }
    const ids = buildChecklist(d, []).map((i) => i.id)
    expect(ids).not.toContain('bullets:experience-0')
    expect(ids).not.toContain('endDate:experience-0')
  })
})

describe('FixChecklist', () => {
  it('adds a suggested bullet with one click and shows fixed items', async () => {
    const onAdd = vi.fn()
    const items = buildChecklist(draft(), [{ section: 'experience', entryKey: 'experience-0', sentences: ['Develop dashboards for sales teams.'] }])
    render(<FixChecklist items={items} doneTitles={['Add your phone number']} onJump={() => {}} onAddBullet={onAdd} onWriteBullet={() => {}} />)
    expect(screen.getByText(`1 of ${items.length + 1} fixed`)).toBeInTheDocument()
    expect(screen.getByText('From your documents')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add bullet: Develop dashboards for sales teams.' }))
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'bullets:experience-0', section: 'experience', index: 0 }), 'Develop dashboards for sales teams.')
    expect(screen.getByText('Add your phone number')).toBeInTheDocument()
  })
})
