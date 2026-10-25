import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';

const str = (maxlength: number) => ({ type: String, trim: true, default: '', maxlength });

const experienceSchema = new Schema(
  {
    company: str(150),
    jobTitle: str(150),
    location: str(120),
    startDate: str(20),
    endDate: str(20),
    current: { type: Boolean, default: false },
    description: { type: [str(600)], default: [] },
  },
  { _id: false },
);

const educationSchema = new Schema(
  {
    institution: str(200),
    degree: str(150),
    field: str(150),
    location: str(120),
    startDate: str(20),
    endDate: str(20),
    grade: str(50),
  },
  { _id: false },
);

const projectSchema = new Schema(
  {
    name: str(150),
    description: { type: [str(600)], default: [] },
    technologies: { type: [str(60)], default: [] },
    url: str(300),
  },
  { _id: false },
);

const certificationSchema = new Schema(
  { name: str(200), issuer: str(150), date: str(20), url: str(300) },
  { _id: false },
);

const additionalSectionSchema = new Schema(
  { title: str(80), items: { type: [str(600)], default: [] } },
  { _id: false },
);

const resumeSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    templateId: { type: String, enum: ['classic', 'modern', 'compact', 'executive', 'minimal', 'bold'], default: 'classic' },
    /** Shrink type/spacing (within readable limits) so the export fits on one page. */
    fitToPage: { type: Boolean, default: false },
    /** PDF-only: contact icons and dragged block offsets (validated by zod; Mixed because ids are map keys). */
    layout: {
      contactIcons: { type: String, enum: ['none', 'inline', 'badges'], default: 'none' },
      offsets: { type: Schema.Types.Mixed, default: () => ({}) },
      sectionOrder: { type: [String], default: [] },
    },
    targetJobTitle: str(150),
    personalInfo: {
      fullName: str(120),
      email: str(254),
      phone: str(40),
      location: str(120),
      linkedin: str(300),
      github: str(300),
      portfolio: str(300),
    },
    summary: str(2000),
    skills: { type: [str(60)], default: [] },
    experience: { type: [experienceSchema], default: [] },
    education: { type: [educationSchema], default: [] },
    projects: { type: [projectSchema], default: [] },
    certifications: { type: [certificationSchema], default: [] },
    additionalSections: { type: [additionalSectionSchema], default: [] },
    source: { type: String, enum: ['manual', 'upload', 'ai'], default: 'manual' },
  },
  { timestamps: true },
);

resumeSchema.index({ userId: 1, updatedAt: -1 });

export type ResumeAttrs = InferSchemaType<typeof resumeSchema>;
export type ResumeDoc = HydratedDocument<ResumeAttrs>;
export const Resume = model('Resume', resumeSchema);
