import { canSwap, sectionKeys, swapBlocks } from '../utils/arrange'
import { emptyExperience, emptyLayout, emptyResumeContent, type LayoutBox, type ResumeContent } from '../types/resume'

const box = (id: string, parent?: string): LayoutBox => ({ id, label: id, page: 0, x: 0, y: 0, w: 10, h: 10, ox: 0, oy: 0, parent })

function resume(): ResumeContent {
  return {
    ...emptyResumeContent(),
    summary: 'Hi',
    experience: [
      { ...emptyExperience(), jobTitle: 'A', description: ['a1', 'a2', 'a3'] },
      { ...emptyExperience(), jobTitle: 'B', description: ['b1'] },
    ],
    additionalSections: [{ title: 'Awards', items: ['x', 'y'] }],
  }
}

describe('swapping blocks on the page', () => {
  it('only pairs like with like in the same place', () => {
    expect(canSwap(box('exp-0-b0', 'exp-0'), box('exp-0-b2', 'exp-0'))).toBe(true)
    expect(canSwap(box('exp-0-b0', 'exp-0'), box('exp-1-b0', 'exp-1'))).toBe(false)
    expect(canSwap(box('exp-0', 'sec-experience'), box('exp-1', 'sec-experience'))).toBe(true)
    expect(canSwap(box('exp-0', 'sec-experience'), box('edu-0', 'sec-education'))).toBe(false)
    expect(canSwap(box('sec-skills'), box('sec-education'))).toBe(true)
    expect(canSwap(box('name'), box('headline'))).toBe(false)
  })

  it('swaps bullets within an entry instead of stacking them', () => {
    const out = swapBlocks(resume(), emptyLayout(), 'exp-0-b0', 'exp-0-b2')!
    expect(out.content.experience[0].description).toEqual(['a3', 'a2', 'a1'])
    expect(out.content.experience[1].description).toEqual(['b1'])
  })

  it('swaps entries and carries their saved positions with them', () => {
    const layout = { ...emptyLayout(), offsets: { 'exp-0': { x: 5, y: 5 }, 'exp-0-b1': { x: 3, y: 0 }, 'exp-1-b0': { x: 0, y: 9 }, name: { x: 1, y: 1 } } }
    const out = swapBlocks(resume(), layout, 'exp-0', 'exp-1')!
    expect(out.content.experience.map((e) => e.jobTitle)).toEqual(['B', 'A'])
    // The swapped pair land in their slots; positions inside them follow the entry.
    expect(out.layout.offsets).toEqual({ 'exp-1-b1': { x: 3, y: 0 }, 'exp-0-b0': { x: 0, y: 9 }, name: { x: 1, y: 1 } })
  })

  it('swaps whole sections through the saved section order', () => {
    const r = resume()
    const out = swapBlocks(r, emptyLayout(), 'sec-summary', 'sec-extra-0')!
    expect(out.content).toBe(r)
    expect(sectionKeys(r, out.layout)).toEqual(['extra-0', 'skills', 'experience', 'projects', 'education', 'certifications', 'summary'])
  })

  it('swaps items of an extra section', () => {
    const out = swapBlocks(resume(), emptyLayout(), 'extra-0-b0', 'extra-0-b1')!
    expect(out.content.additionalSections[0].items).toEqual(['y', 'x'])
  })
})
