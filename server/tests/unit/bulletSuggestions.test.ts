import { describe, expect, it } from 'vitest';
import { suggestBullets } from '../../src/services/bulletSuggestions.service.js';
import { emptyResumeContent, type ResumeContent } from '../../src/types/resume.js';

// Fake person. LinkedIn-style "About" text wraps mid-sentence and is written in first person.
const LINKEDIN_ABOUT = `Summary
I'm a Backend Developer at Demo Freight Solutions, working
with Java, Spring Boot and PostgreSQL. I build shipment tracking APIs used by
logistics partners across India.Alongside my work, I'm learning Kubernetes.
Experience
Demo Freight Solutions
Backend Developer
August 2023 - Present
Demo Institute of Technology
Bachelor of Engineering - BE, Computer Science`;

const RESUME = `PROJECTS
ROUTE PLANNER
Description: Built a route planner that cuts delivery distance using Dijkstra's algorithm.
EDUCATION
Demo Institute of Technology - B.E. Computer Science`;

function content(): ResumeContent {
  return {
    ...emptyResumeContent(),
    experience: [{ company: 'Demo Freight Solutions', jobTitle: 'Backend Developer', location: '', startDate: 'Aug 2023', endDate: '', current: true, description: [] }],
    projects: [
      { name: 'Route Planner', description: [], technologies: [], url: '' },
      { name: 'Chat App', description: ['Built a chat app', 'Added rooms'], technologies: [], url: '' },
    ],
    education: [{ institution: 'Demo Institute of Technology', degree: 'B.E.', field: 'Computer Science', location: '', startDate: '', endDate: '', grade: '' }],
  };
}

describe('bullet suggestions from the candidate’s own documents', () => {
  const out = suggestBullets(content(), [LINKEDIN_ABOUT, RESUME]);

  it('finds sentences about a role with no bullets, rejoining wrapped lines and removing "I"', () => {
    const exp = out.find((s) => s.section === 'experience')!;
    expect(exp.index).toBe(0);
    expect(exp.sentences).toEqual([
      'Work with Java, Spring Boot and PostgreSQL.',
      'Build shipment tracking APIs used by logistics partners across India.',
    ]);
  });

  it('does not pull unrelated sentences or header lines', () => {
    const all = out.flatMap((s) => s.sentences).join(' ');
    expect(all).not.toMatch(/Kubernetes|Institute|August 2023|Bachelor/);
  });

  it('finds project text and skips entries that already have enough bullets', () => {
    expect(out.find((s) => s.section === 'projects' && s.index === 0)?.sentences).toEqual([
      "Built a route planner that cuts delivery distance using Dijkstra's algorithm.",
    ]);
    expect(out.find((s) => s.section === 'projects' && s.index === 1)).toBeUndefined();
  });
});
