import { describe, expect, it } from 'vitest';
import { canonicalSkill, extractSkills, relatedSkills, textMentionsSkill } from '../../src/services/skills.js';

describe('skills normalisation', () => {
  it('maps aliases to canonical names', () => {
    expect(canonicalSkill('reactjs')).toBe('React');
    expect(canonicalSkill(' Node.JS ')).toBe('Node.js');
    expect(canonicalSkill('postgres')).toBe('PostgreSQL');
    expect(canonicalSkill('k8s')).toBe('Kubernetes');
    expect(canonicalSkill('Some Niche Tool')).toBe('Some Niche Tool');
  });

  it('extracts skills with symbol-heavy names', () => {
    const found = extractSkills('We use C++, C#, .NET and CI/CD pipelines.');
    expect(found).toEqual(expect.arrayContaining(['C++', 'C#', '.NET', 'CI/CD']));
  });

  it('does not create false matches from ordinary English words', () => {
    const found = extractSkills('You will go the extra mile, rest well, and express ideas clearly. Java coffee is great? No. The rest of the team.');
    expect(found).not.toContain('Go');
    expect(found).not.toContain('REST API');
    expect(found).not.toContain('Express');
  });

  it('does not confuse Java with JavaScript', () => {
    expect(extractSkills('Strong JavaScript skills')).not.toContain('Java');
    expect(textMentionsSkill('Built services in Java and Spring Boot', 'Java')).toBe(true);
  });

  it('matches weak aliases when written in technical casing', () => {
    expect(extractSkills('Backend in Go and Node')).toEqual(expect.arrayContaining(['Go', 'Node.js']));
    expect(extractSkills('Built a REST service')).toContain('REST API');
  });

  it('treats related technologies as related, not equivalent', () => {
    expect(relatedSkills('Next.js')).toContain('React');
    expect(canonicalSkill('Next.js')).not.toBe('React');
  });
});
