/** "inline": a small icon before each contact; "badges": clickable brand icons top-right (like a LinkedIn badge). */
export type ContactIcons = 'none' | 'inline' | 'badges';

/** PDF-only presentation choices. Offsets are points by block id (e.g. "exp-0"), relative to the natural position. */
export interface ResumeLayout {
  contactIcons: ContactIcons;
  offsets: Record<string, { x: number; y: number }>;
  /** Section keys in reading order ("experience", "extra-0"…); sections not listed follow in the default order. */
  sectionOrder: string[];
}

export const emptyLayout = (): ResumeLayout => ({ contactIcons: 'none', offsets: {}, sectionOrder: [] });

// Plain resume content shape shared by the parser, ATS engine, matcher, AI and export services.
export interface ResumeContent {
  title?: string;
  templateId?: 'classic' | 'modern' | 'compact' | 'executive' | 'minimal' | 'bold';
  fitToPage?: boolean;
  layout?: ResumeLayout;
  targetJobTitle?: string;
  personalInfo: {
    fullName: string;
    email: string;
    phone: string;
    location: string;
    linkedin: string;
    github: string;
    portfolio: string;
  };
  summary: string;
  skills: string[];
  experience: Array<{
    company: string;
    jobTitle: string;
    location: string;
    startDate: string;
    endDate: string;
    current: boolean;
    description: string[];
  }>;
  education: Array<{
    institution: string;
    degree: string;
    field: string;
    location: string;
    startDate: string;
    endDate: string;
    grade: string;
  }>;
  projects: Array<{ name: string; description: string[]; technologies: string[]; url: string }>;
  certifications: Array<{ name: string; issuer: string; date: string; url: string }>;
  /** Anything else real resumes carry: Achievements, Activities, Languages, Awards, Volunteering, Publications… */
  additionalSections: Array<{ title: string; items: string[] }>;
}

export function emptyResumeContent(): ResumeContent {
  return {
    personalInfo: { fullName: '', email: '', phone: '', location: '', linkedin: '', github: '', portfolio: '' },
    summary: '',
    skills: [],
    experience: [],
    education: [],
    projects: [],
    certifications: [],
    additionalSections: [],
  };
}
