// Plain resume content shape shared by the parser, ATS engine, matcher, AI and export services.
export interface ResumeContent {
  title?: string;
  templateId?: 'classic' | 'modern' | 'compact' | 'executive' | 'minimal' | 'bold';
  fitToPage?: boolean;
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
