import type { ResumeDoc } from '../models/Resume.js';
import type { ResumeContent } from '../types/resume.js';
import type { Template } from '../services/export.service.js';

/** Convert a stored resume document into the plain content shape the services use. */
export function toResumeContent(doc: ResumeDoc): ResumeContent & { title: string; templateId: Template; fitToPage: boolean } {
  const o = doc.toObject();
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const pi = (o.personalInfo ?? {}) as Record<string, unknown>;
  return {
    title: o.title,
    templateId: (o.templateId as Template) ?? 'classic',
    fitToPage: Boolean(o.fitToPage),
    targetJobTitle: s(o.targetJobTitle),
    personalInfo: {
      fullName: s(pi.fullName),
      email: s(pi.email),
      phone: s(pi.phone),
      location: s(pi.location),
      linkedin: s(pi.linkedin),
      github: s(pi.github),
      portfolio: s(pi.portfolio),
    },
    summary: s(o.summary),
    skills: (o.skills ?? []).map(s),
    experience: (o.experience ?? []).map((e) => ({
      company: s(e.company),
      jobTitle: s(e.jobTitle),
      location: s(e.location),
      startDate: s(e.startDate),
      endDate: s(e.endDate),
      current: Boolean(e.current),
      description: (e.description ?? []).map(s),
    })),
    education: (o.education ?? []).map((e) => ({
      institution: s(e.institution),
      degree: s(e.degree),
      field: s(e.field),
      location: s(e.location),
      startDate: s(e.startDate),
      endDate: s(e.endDate),
      grade: s(e.grade),
    })),
    projects: (o.projects ?? []).map((p) => ({
      name: s(p.name),
      description: (p.description ?? []).map(s),
      technologies: (p.technologies ?? []).map(s),
      url: s(p.url),
    })),
    certifications: (o.certifications ?? []).map((c) => ({ name: s(c.name), issuer: s(c.issuer), date: s(c.date), url: s(c.url) })),
    additionalSections: (o.additionalSections ?? []).map((a) => ({ title: s(a.title), items: (a.items ?? []).map(s) })),
  };
}

export function serializeResume(doc: ResumeDoc) {
  return {
    id: doc.id as string,
    ...toResumeContent(doc),
    source: doc.source,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
