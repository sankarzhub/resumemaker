import { describe, expect, it } from 'vitest';
import { getByPath, mergeResumeDrafts, validateConflicts } from '../../src/services/resumeMerge.service.js';
import { cleanExtractedText, guessDocRole, structureResumeText } from '../../src/services/resumeParser.service.js';
import { SAMPLE_LINKEDIN_TEXT, SAMPLE_RESUME_TEXT, sampleResume } from '../fixtures.js';

const resumeDoc = () => ({ name: 'resume.pdf (Resume)', role: 'resume' as const, content: structureResumeText(SAMPLE_RESUME_TEXT).content });
const linkedinDoc = () => ({ name: 'Profile.pdf (LinkedIn)', role: 'linkedin' as const, content: structureResumeText(cleanExtractedText(SAMPLE_LINKEDIN_TEXT)).content });

describe('LinkedIn PDF parsing', () => {
  it('recognises a LinkedIn export', () => {
    expect(guessDocRole(SAMPLE_LINKEDIN_TEXT, 'Profile.pdf')).toBe('linkedin');
    expect(guessDocRole(SAMPLE_RESUME_TEXT, 'resume.pdf')).toBe('resume');
  });

  it('parses LinkedIn-style experience: company, title, dates, location and wrapped paragraphs', () => {
    const { content } = structureResumeText(cleanExtractedText(SAMPLE_LINKEDIN_TEXT));
    expect(content.experience).toHaveLength(3);
    expect(content.experience[0]).toMatchObject({ company: 'Acme Fintech Pvt Ltd', jobTitle: 'Software Engineer', startDate: 'Jun 2022', current: true, location: 'Chennai, Tamil Nadu, India' });
    expect(content.experience[0].description).toEqual(['Led migration of the merchant onboarding flow to React Query, cutting page load time in half.']);
    expect(content.experience[2]).toMatchObject({ company: 'Demo Labs', jobTitle: 'Software Intern', startDate: 'May 2020', endDate: 'Dec 2020' });
    expect(content.skills).toEqual(expect.arrayContaining(['GraphQL', 'Redis', 'Jest']));
    // Name/headline/location follow the sidebar in LinkedIn exports; they must not become skills or certifications.
    expect(content.personalInfo.fullName).toBe('Priya Raman');
    expect(content.personalInfo.location).toBe('Chennai, Tamil Nadu, India');
    expect(content.certifications.map((c) => c.name)).toEqual(['Meta Front-End Developer']);
    expect(content.skills).not.toContain('Priya Raman');
    expect(content.education[0]).toMatchObject({ institution: 'Anna University', degree: 'Bachelor of Engineering', field: 'Computer Science', startDate: '2016', endDate: '2020' });
  });
});

describe('mergeResumeDrafts', () => {
  const result = mergeResumeDrafts([linkedinDoc(), resumeDoc()]);
  const m = result.content;

  it('treats the resume as primary regardless of upload order', () => {
    expect(m.summary).toMatch(/^Full stack developer with 3 years/);
    expect(m.personalInfo.phone).toContain('98765');
  });

  it('adds roles, skills and certifications that only appear in LinkedIn', () => {
    expect(m.experience.map((e) => e.company)).toEqual(['Acme Fintech Pvt Ltd', 'Bright Apps', 'Demo Labs']);
    expect(m.skills).toEqual(expect.arrayContaining(['GraphQL', 'Redis', 'React']));
    expect(m.certifications.map((c) => c.name)).toEqual(expect.arrayContaining(['AWS Certified Cloud Practitioner', 'Meta Front-End Developer']));
    expect(result.notes.join(' ')).toMatch(/Added role "Software Intern at Demo Labs"/);
  });

  it('merges details of the same role without duplicating them', () => {
    const acme = m.experience[0];
    expect(acme.description).toHaveLength(4);
    expect(acme.description).toContain('Led migration of the merchant onboarding flow to React Query, cutting page load time in half.');
    expect(acme.location).toBe('Chennai, Tamil Nadu, India');
    const bright = m.experience[1];
    expect(bright.description.filter((d) => d.startsWith('Developed REST APIs'))).toHaveLength(1);
  });

  it('flags conflicting dates with both options and their sources, without guessing', () => {
    const c = result.conflicts.find((x) => x.path === 'experience[1].startDate');
    expect(c).toBeDefined();
    expect(c!.options).toEqual([
      { source: 'resume.pdf (Resume)', value: 'Jan 2021' },
      { source: 'Profile.pdf (LinkedIn)', value: 'Feb 2021' },
    ]);
    expect(c!.selected).toBe('Jan 2021');
    expect(getByPath(m, c!.path)).toBe('Jan 2021');
  });

  it('does not report compatible values as conflicts', () => {
    // "Jun 2022" vs "June 2022", same email, "2016" vs "2016": all agree.
    expect(result.conflicts.find((x) => x.path === 'experience[0].startDate')).toBeUndefined();
    expect(result.conflicts.find((x) => x.path === 'personalInfo.email')).toBeUndefined();
    expect(result.conflicts.find((x) => x.path.startsWith('education'))).toBeUndefined();
  });

  it('warns when documents seem to belong to different people', () => {
    const other = linkedinDoc();
    other.content.personalInfo.fullName = 'Karthik Someone';
    const r = mergeResumeDrafts([resumeDoc(), other]);
    expect(r.notes[0]).toMatch(/look like different people/);
    expect(r.conflicts.find((c) => c.path === 'personalInfo.fullName')).toBeDefined();
  });

  it('merges extra sections (Achievements, Languages…) from every document without duplicates', () => {
    const a = resumeDoc();
    a.content.additionalSections = [
      { title: 'Languages', items: ['English', 'Tamil'] },
      { title: 'Activities', items: ['NSS volunteer'] },
    ];
    const b = linkedinDoc();
    b.content.additionalSections = [
      { title: 'languages', items: ['Tamil', 'Hindi'] },
      { title: 'Achievements', items: ['Won a state-level hackathon'] },
    ];
    const r = mergeResumeDrafts([a, b]);
    expect(r.content.additionalSections).toEqual([
      { title: 'Languages', items: ['English', 'Tamil', 'Hindi'] },
      { title: 'Activities', items: ['NSS volunteer'] },
      { title: 'Achievements', items: ['Won a state-level hackathon'] },
    ]);
    expect(r.notes.join(' ')).toMatch(/Added the "Achievements" section from Profile\.pdf/);
  });

  it('is a no-op merge for a single document', () => {
    const r = mergeResumeDrafts([resumeDoc()]);
    expect(r.conflicts).toEqual([]);
    expect(r.content.experience).toHaveLength(2);
  });
});

describe('validateConflicts (untrusted AI output)', () => {
  it('drops conflicts with bad paths or a single option and syncs "selected"', () => {
    const r = sampleResume();
    const out = validateConflicts(r, [
      { path: 'experience[1].startDate', label: 'Start', options: [{ source: 'A', value: 'Jan 2021' }, { source: 'B', value: 'Feb 2021' }], selected: 'whatever' },
      { path: 'experience[9].startDate', label: 'Out of range', options: [{ source: 'A', value: 'x' }, { source: 'B', value: 'y' }], selected: 'x' },
      { path: 'constructor.prototype', label: 'Nope', options: [{ source: 'A', value: 'x' }, { source: 'B', value: 'y' }], selected: 'x' },
      { path: 'personalInfo.email', label: 'Same', options: [{ source: 'A', value: 'a@x.com' }, { source: 'B', value: 'A@X.com' }], selected: 'a@x.com' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ path: 'experience[1].startDate', selected: 'Jan 2021' });
  });
});
