import { z } from 'zod';

// Defaults are only used inside array items (arrays are replaced whole). Top-level and personalInfo
// fields have no defaults so a PATCH that omits them leaves the stored values untouched.
const text = (max: number) => z.string().trim().max(max).default('');
const optText = (max: number) => z.string().trim().max(max).optional();
// Accept "2023", "2023-04", "04/2023", "Apr 2023" etc.; the ATS checker flags inconsistent formats.
const date = text(20);
const list = (max: number, itemMax: number) => z.array(z.string().trim().max(itemMax)).max(max).default([]);

export const resumeContentSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120).optional(),
  templateId: z.enum(['classic', 'modern', 'compact', 'executive', 'minimal', 'bold']).optional(),
  fitToPage: z.boolean().optional(),
  targetJobTitle: optText(150),
  personalInfo: z
    .object({
      fullName: optText(120),
      email: z.union([z.literal(''), z.string().trim().email('Invalid email').max(254)]).optional(),
      phone: optText(40),
      location: optText(120),
      linkedin: optText(300),
      github: optText(300),
      portfolio: optText(300),
    })
    .optional(),
  summary: optText(2000),
  skills: z.array(z.string().trim().max(60)).max(80).optional(),
  experience: z
    .array(
      z.object({
        company: text(150),
        jobTitle: text(150),
        location: text(120),
        startDate: date,
        endDate: date,
        current: z.boolean().default(false),
        description: list(20, 600),
      }),
    )
    .max(30)
    .optional(),
  education: z
    .array(
      z.object({
        institution: text(200),
        degree: text(150),
        field: text(150),
        location: text(120),
        startDate: date,
        endDate: date,
        grade: text(50),
      }),
    )
    .max(15)
    .optional(),
  projects: z
    .array(
      z.object({
        name: text(150),
        description: list(15, 600),
        technologies: list(30, 60),
        url: text(300),
      }),
    )
    .max(20)
    .optional(),
  certifications: z
    .array(z.object({ name: text(200), issuer: text(150), date, url: text(300) }))
    .max(30)
    .optional(),
  additionalSections: z
    .array(z.object({ title: z.string().trim().min(1, 'Section title is required').max(80), items: list(30, 600) }))
    .max(10)
    .optional(),
  source: z.enum(['manual', 'upload', 'ai']).optional(),
});

export const createResumeSchema = resumeContentSchema.extend({
  title: z.string().trim().min(1, 'Title is required').max(120),
});

export const updateResumeSchema = resumeContentSchema;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const jobDescriptionSchema = z.object({
  jobDescription: z.string().trim().min(30, 'Paste a job description of at least 30 characters').max(20000),
});

export const analyzeSchema = z.object({
  jobDescription: z.string().trim().max(20000).optional(),
});

export const improveSchema = z.object({
  jobDescription: z.string().trim().max(20000).optional(),
});

export const exportQuerySchema = z.object({ format: z.enum(['pdf', 'docx']) });

/** Live preview of unsaved content: same renderer as the export. */
export const previewSchema = resumeContentSchema.extend({
  templateId: z.enum(['classic', 'modern', 'compact', 'executive', 'minimal', 'bold']).default('classic'),
  fitToPage: z.boolean().default(false),
});
