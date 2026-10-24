import { describe, expect, it } from 'vitest';
import { checkResumeQuality, WEIGHTS } from '../../src/services/atsChecker.service.js';
import { emptyResumeContent } from '../../src/types/resume.js';
import { sampleResume } from '../fixtures.js';

describe('ATS quality checker', () => {
  it('weights add up to 100', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('scores a strong resume highly with an explainable breakdown', () => {
    const report = checkResumeQuality(sampleResume());
    expect(report.score).toBeGreaterThanOrEqual(85);
    expect(report.scoreType).toBe('estimated');
    expect(report.breakdown).toHaveLength(6);
    for (const c of report.breakdown) {
      expect(c.earned).toBeLessThanOrEqual(c.max);
      expect(c.reasons.length).toBeGreaterThan(0);
    }
    expect(report.disclaimer).toMatch(/not a real employer ATS score/);
  });

  it('scores an empty resume low and explains why', () => {
    const report = checkResumeQuality(emptyResumeContent());
    expect(report.score).toBeLessThan(45);
    const contact = report.breakdown.find((c) => c.key === 'contact')!;
    expect(contact.reasons).toEqual(expect.arrayContaining(['Full name is missing.', 'Email address is missing.']));
  });

  it('flags end dates before start dates and mixed formats', () => {
    const r = sampleResume();
    r.experience[1].startDate = '2022-05';
    r.experience[1].endDate = '2021-01';
    const c = checkResumeQuality(r).breakdown.find((x) => x.key === 'consistency')!;
    expect(c.reasons.join(' ')).toMatch(/end date is before start date/);
    expect(c.reasons.join(' ')).toMatch(/mixed formats/);
  });

  it('flags weak bullets, first-person pronouns and emojis', () => {
    const r = sampleResume();
    r.experience[0].description = ['I was responsible for the website 🚀', 'helped with stuff', 'worked on things for my team'];
    r.experience[1].description = [];
    r.projects = [];
    const report = checkResumeQuality(r);
    const content = report.breakdown.find((c) => c.key === 'content')!;
    expect(content.reasons.join(' ')).toMatch(/action verb/);
    expect(content.reasons.join(' ')).toMatch(/first-person/);
    expect(report.breakdown.find((c) => c.key === 'parsing')!.reasons.join(' ')).toMatch(/Emojis/);
  });

  it('does not penalise freshers for having no work experience when projects exist', () => {
    const r = sampleResume();
    r.experience = [];
    const sections = checkResumeQuality(r).breakdown.find((c) => c.key === 'sections')!;
    expect(sections.earned).toBe(sections.max);
  });

  it('detects duplicate skills via aliases', () => {
    const r = sampleResume();
    r.skills = [...r.skills, 'ReactJS'];
    expect(checkResumeQuality(r).breakdown.find((c) => c.key === 'skills')!.reasons.join(' ')).toMatch(/duplicate/);
  });
});
