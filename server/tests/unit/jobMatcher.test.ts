import { describe, expect, it } from 'vitest';
import { classifyJobSkills, matchResumeToJob } from '../../src/services/jobMatcher.service.js';
import { sampleResume, SAMPLE_JD } from '../fixtures.js';

describe('job matcher', () => {
  it('separates required and preferred skills', () => {
    const skills = classifyJobSkills(SAMPLE_JD);
    expect(skills.get('React')).toBe('required');
    expect(skills.get('GraphQL')).toBe('required');
    expect(skills.get('Kubernetes')).toBe('preferred');
    expect(skills.get('AWS')).toBe('preferred');
  });

  it('traces matches to resume evidence', () => {
    const report = matchResumeToJob(sampleResume(), SAMPLE_JD);
    const react = report.skills.find((s) => s.skill === 'React')!;
    expect(react.status).toBe('listed-and-evidenced');
    expect(react.evidence).toContain('Skills');
    expect(react.evidence.some((e) => e.startsWith('Experience: Software Engineer'))).toBe(true);
  });

  it('reports skills that are not evidenced without inventing them', () => {
    const report = matchResumeToJob(sampleResume(), SAMPLE_JD);
    expect(report.missingSkills).toContain('GraphQL');
    // Kubernetes is not on the resume, but Docker (related) is: reported as related, still not matched.
    expect(report.relatedSkills).toContain('Kubernetes');
    expect(report.matchedSkills).not.toContain('Kubernetes');
    expect(report.matchedSkills).not.toContain('GraphQL');
    expect(report.suggestions.join(' ')).toMatch(/Only add them if you genuinely have/);
  });

  it('marks related-but-different technologies as related, not matched', () => {
    const report = matchResumeToJob(sampleResume(), 'Requirements:\n- Next.js experience\n- Vue.js');
    const next = report.skills.find((s) => s.skill === 'Next.js')!;
    expect(next.status).toBe('related');
    expect(next.related).toContain('React');
    expect(report.matchedSkills).not.toContain('Next.js');
  });

  it('does not match unrelated keywords', () => {
    const report = matchResumeToJob(sampleResume(), 'Requirements: Salesforce, SAP and Tally accounting experience for our finance team.');
    expect(report.matchedSkills).toEqual([]);
    expect(report.score).toBeLessThan(30);
  });

  it('scores a well-aligned resume higher than a misaligned one', () => {
    const good = matchResumeToJob(sampleResume(), 'Full Stack Developer\nRequirements: React, Node.js, MongoDB, TypeScript');
    const bad = matchResumeToJob(sampleResume(), 'Data Scientist\nRequirements: PyTorch, TensorFlow, Spark, Tableau');
    expect(good.score).toBeGreaterThan(80);
    expect(bad.score).toBeLessThan(good.score);
  });
});
