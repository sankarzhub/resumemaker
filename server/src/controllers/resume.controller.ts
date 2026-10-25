import type { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { Resume } from '../models/Resume.js';
import { Analysis, type AnalysisAttrs } from '../models/Analysis.js';
import { AppError } from '../utils/AppError.js';
import { getUserId } from '../middleware/auth.middleware.js';
import {
  analyzeSchema,
  createResumeSchema,
  exportQuerySchema,
  improveSchema,
  jobDescriptionSchema,
  listQuerySchema,
  previewSchema,
  updateResumeSchema,
} from '../validators/resume.validators.js';
import { serializeResume, toResumeContent } from '../utils/resumeContent.js';
import { checkResumeQuality } from '../services/atsChecker.service.js';
import { matchResumeToJob } from '../services/jobMatcher.service.js';
import { cleanExtractedText, guessDocRole, parseResumeFile, structureResumeText, type DocRole } from '../services/resumeParser.service.js';
import { starterSummary } from '../services/parsing/structure.js';
import { suggestBullets } from '../services/bulletSuggestions.service.js';
import { emptyResumeContent } from '../types/resume.js';
import { mergeResumeDrafts, validateConflicts, type Conflict, type MergeResult } from '../services/resumeMerge.service.js';
import { resolveSuggestions, sanitizeAiResume, type AiService, type SourceDocument } from '../services/aiResume.service.js';
import { exportFilename, renderResumeDocx, renderResumePdf, renderResumePdfDetailed } from '../services/export.service.js';
import type { ResumeContent } from '../types/resume.js';

async function findOwnedResume(req: Request) {
  const id = String(req.params.id);
  if (!isValidObjectId(id)) throw AppError.notFound('Resume not found.');
  // Filtering by owner returns 404 (not 403) so other users' resume IDs are not revealed.
  const resume = await Resume.findOne({ _id: id, userId: getUserId(req) });
  if (!resume) throw AppError.notFound('Resume not found.');
  return resume;
}

const MAX_SOURCE_CHARS = 60_000;

const importOptionsSchema = z.object({
  jobDescription: z.string().trim().max(20000).optional(),
  useAi: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

const importTextSchema = importOptionsSchema.extend({
  text: z.string().trim().min(80, 'Paste at least a few lines about your background (80+ characters).').max(MAX_SOURCE_CHARS),
});

const rolesSchema = z
  .string()
  .optional()
  .transform((s, ctx) => {
    if (!s) return [];
    try {
      return z.array(z.enum(['resume', 'linkedin', 'other', 'auto'])).max(4).parse(JSON.parse(s));
    } catch {
      ctx.addIssue({ code: 'custom', message: 'roles must be a JSON array of "resume" | "linkedin" | "other" | "auto"' });
      return z.NEVER;
    }
  });

interface ParsedDoc {
  name: string;
  role: DocRole;
  fileKind?: string;
  rawText: string;
  content: ResumeContent;
  warnings: string[];
  notes: string[];
  detectedSections: string[];
  /** No text layer: only the AI (reading the attachment) can use it. */
  scanned?: boolean;
  attachment?: SourceDocument['attachment'];
}

// Original files are sent to the AI so it can read layouts, tables and scans itself. Keep requests bounded.
const MAX_ATTACH_BYTES = 4.5 * 1024 * 1024;

// Reports kept per resume: the history shows this many, and older ones (each can hold a 20 KB job
// description) would only fill the database.
const ANALYSES_KEPT = 20;

async function saveAnalysis(attrs: Pick<AnalysisAttrs, 'userId' | 'resumeId'> & Record<string, unknown>) {
  const analysis = await Analysis.create(attrs);
  const stale = await Analysis.find({ resumeId: attrs.resumeId, userId: attrs.userId })
    .sort({ createdAt: -1, _id: -1 })
    .skip(ANALYSES_KEPT)
    .select('_id');
  if (stale.length) await Analysis.deleteMany({ _id: { $in: stale.map((d) => d._id) } });
  return analysis;
}

const ROLE_LABEL: Record<DocRole, string> = { resume: 'Resume', linkedin: 'LinkedIn', other: 'Document' };

export function createResumeController(ai: AiService) {
  /**
   * Shared by file upload and pasted text: a rule-based draft (merged across documents) first,
   * then an optional AI-built draft. Disagreements between documents come back as conflicts the user must resolve.
   */
  async function buildDraft(docs: ParsedDoc[], opts: z.infer<typeof importOptionsSchema>, extraWarnings: string[] = []) {
    const labelled = docs.map((d) => ({ ...d, name: `${d.name} (${ROLE_LABEL[d.role]})` }));
    const readable = labelled.filter((d) => !d.scanned);
    const merge: MergeResult =
      readable.length > 1
        ? mergeResumeDrafts(readable.map((d) => ({ name: d.name, role: d.role, content: d.content })))
        : { content: readable[0]?.content ?? emptyResumeContent(), conflicts: [], notes: [] };

    let draft = merge.content;
    let conflicts: Conflict[] = merge.conflicts;
    const aiInfo: { requested: boolean; used: boolean; changes: string[]; missingInfo: string[]; error?: string } = {
      requested: opts.useAi,
      used: false,
      changes: [],
      missingInfo: [],
    };
    if (opts.useAi) {
      if (!ai.available) {
        aiInfo.error = 'AI is not configured on this server, so a rule-based draft was created instead.';
      } else {
        try {
          const perDoc = Math.floor(MAX_SOURCE_CHARS / labelled.length);
          const result = await ai.buildResume({
            documents: labelled.map((d) => ({ name: d.name, role: d.role, text: d.rawText.slice(0, perDoc), attachment: d.attachment })),
            jobDescription: opts.jobDescription,
          });
          draft = sanitizeAiResume(result.resume);
          conflicts = validateConflicts(draft, result.conflicts);
          aiInfo.used = true;
          aiInfo.changes = result.changes;
          aiInfo.missingInfo = result.missingInfo;
        } catch (err) {
          aiInfo.error = err instanceof AppError ? `${err.message} A rule-based draft was created instead.` : 'AI processing failed, so a rule-based draft was created instead.';
        }
      }
    }
    if (!aiInfo.used && readable.length === 0) {
      throw new AppError(422, 'NO_TEXT', 'None of the documents had readable text, and the AI could not read them. Upload a text-based PDF or DOCX.');
    }
    const notes = [...new Set(readable.flatMap((d) => d.notes))];
    if (!aiInfo.used) {
      for (const d of labelled.filter((x) => x.scanned)) extraWarnings.push(`${d.name} has no selectable text (a scan or photo), so it could not be read without AI.`);
      if (!draft.summary.trim()) {
        const summary = starterSummary(draft);
        if (summary) {
          draft = { ...draft, summary };
          notes.push('Your documents had no summary, so we wrote a starter summary using only your details. Personalise it before saving.');
        }
      }
    }
    const warnings = [...extraWarnings, ...readable.flatMap((d) => (labelled.length > 1 ? d.warnings.map((w) => `${d.name}: ${w}`) : d.warnings))];
    return {
      notes: aiInfo.used ? [] : notes,
      bulletSuggestions: suggestBullets(draft, readable.map((d) => d.rawText)),
      draft,
      heuristicDraft: merge.content,
      rawText: labelled.length > 1 ? labelled.map((d) => `===== ${d.name} =====\n${d.rawText}`).join('\n\n') : labelled[0].rawText,
      warnings,
      detectedSections: [...new Set(labelled.flatMap((d) => d.detectedSections))],
      sources: labelled.map((d) => ({ name: d.name, role: d.role, fileKind: d.fileKind, detectedSections: d.detectedSections, chars: d.rawText.length })),
      conflicts,
      mergeNotes: aiInfo.used ? [] : merge.notes,
      ai: aiInfo,
      quality: checkResumeQuality(draft),
      jobMatch: opts.jobDescription && opts.jobDescription.length >= 30 ? matchResumeToJob(draft, opts.jobDescription) : null,
    };
  }

  return {
    async list(req: Request, res: Response) {
      const { page, limit } = listQuerySchema.parse(req.query);
      const userId = getUserId(req);
      const [items, total] = await Promise.all([
        Resume.find({ userId }).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit),
        Resume.countDocuments({ userId }),
      ]);
      res.json({
        success: true,
        data: {
          items: items.map((r) => {
            const c = toResumeContent(r);
            return {
              id: r.id,
              title: r.title,
              templateId: r.templateId,
              targetJobTitle: c.targetJobTitle,
              fullName: c.personalInfo.fullName,
              source: r.source,
              score: checkResumeQuality(c).score,
              updatedAt: r.updatedAt,
              createdAt: r.createdAt,
            };
          }),
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },

    async create(req: Request, res: Response) {
      const body = createResumeSchema.parse(req.body);
      const resume = await Resume.create({ ...body, userId: getUserId(req) });
      res.status(201).json({ success: true, data: serializeResume(resume) });
    },

    async get(req: Request, res: Response) {
      const resume = await findOwnedResume(req);
      res.json({ success: true, data: serializeResume(resume) });
    },

    async update(req: Request, res: Response) {
      const body = updateResumeSchema.parse(req.body);
      const resume = await findOwnedResume(req);
      const { personalInfo, ...rest } = body;
      resume.set(rest);
      if (personalInfo) {
        for (const [k, v] of Object.entries(personalInfo)) if (v !== undefined) resume.set(`personalInfo.${k}`, v);
      }
      await resume.save();
      res.json({ success: true, data: serializeResume(resume) });
    },

    async duplicate(req: Request, res: Response) {
      const original = await findOwnedResume(req);
      const content = toResumeContent(original);
      const copy = await Resume.create({
        ...content,
        title: `${original.title} (copy)`.slice(0, 120),
        source: original.source,
        userId: getUserId(req),
      });
      res.status(201).json({ success: true, data: serializeResume(copy) });
    },

    /** Deleting a resume also deletes its analyses. Uploaded files are never stored. */
    async remove(req: Request, res: Response) {
      const resume = await findOwnedResume(req);
      await Analysis.deleteMany({ resumeId: resume._id, userId: resume.userId });
      await resume.deleteOne();
      res.json({ success: true, data: null });
    },

    async upload(req: Request, res: Response) {
      const opts = importOptionsSchema.parse(req.body ?? {});
      const roles = rolesSchema.parse(req.body?.roles);
      const files = req.files as Express.Multer.File[];
      const docs: ParsedDoc[] = [];
      const skipped: string[] = [];
      let firstError: unknown;
      const aiWillRun = opts.useAi && ai.available;
      for (const [i, file] of files.entries()) {
        try {
          const parsed = await parseResumeFile(file.buffer, file.originalname, { allowScanned: aiWillRun });
          const requested = roles[i];
          const role: DocRole = requested && requested !== 'auto' ? requested : parsed.role;
          const attachment =
            aiWillRun && parsed.mediaType && file.buffer.length <= MAX_ATTACH_BYTES ? { mediaType: parsed.mediaType, base64: file.buffer.toString('base64') } : undefined;
          docs.push({
            name: file.originalname,
            role,
            fileKind: parsed.fileKind,
            rawText: parsed.rawText,
            content: parsed.content,
            warnings: parsed.warnings,
            notes: parsed.notes,
            detectedSections: parsed.detectedSections,
            scanned: parsed.scanned,
            attachment,
          });
        } catch (err) {
          firstError ??= err;
          skipped.push(`Skipped "${file.originalname}": ${err instanceof AppError ? err.message : 'it could not be read.'}`);
        }
      }
      // One unreadable file should not block the others; fail only if nothing could be read.
      if (docs.length === 0) throw firstError;
      // With no explicit resume, the first readable document is treated as the primary one.
      if (!docs.some((d) => d.role === 'resume') && docs.length > 1 && docs[0].role !== 'linkedin') docs[0].role = 'resume';
      const result = await buildDraft(docs, opts, skipped);
      res.json({ success: true, data: { ...result, fileName: docs.map((d) => d.name).join(', '), fileKind: docs[0].fileKind } });
    },

    async importText(req: Request, res: Response) {
      const { text, ...opts } = importTextSchema.parse(req.body);
      const clean = cleanExtractedText(text);
      const s = structureResumeText(clean);
      const result = await buildDraft([{ name: 'Pasted text', role: guessDocRole(text, ''), rawText: clean, ...s }], opts);
      res.json({ success: true, data: result });
    },

    async analyze(req: Request, res: Response) {
      const { jobDescription } = analyzeSchema.parse(req.body ?? {});
      const resume = await findOwnedResume(req);
      const content = toResumeContent(resume);
      const report = checkResumeQuality(content);
      const match = jobDescription && jobDescription.length >= 30 ? matchResumeToJob(content, jobDescription) : null;
      const analysis = await saveAnalysis({
        userId: resume.userId,
        resumeId: resume._id,
        kind: 'quality',
        jobDescription,
        score: report.score,
        breakdown: report.breakdown,
        matchedSkills: match?.matchedSkills ?? [],
        relatedSkills: match?.relatedSkills ?? [],
        missingSkills: match?.missingSkills ?? [],
        warnings: report.warnings,
        suggestions: [...report.suggestions, ...(match?.suggestions ?? [])],
        details: match ? { jobMatch: match } : undefined,
      });
      res.json({ success: true, data: { analysisId: analysis.id, ...report, jobMatch: match } });
    },

    async jobMatch(req: Request, res: Response) {
      const { jobDescription } = jobDescriptionSchema.parse(req.body);
      const resume = await findOwnedResume(req);
      const report = matchResumeToJob(toResumeContent(resume), jobDescription);
      const analysis = await saveAnalysis({
        userId: resume.userId,
        resumeId: resume._id,
        kind: 'job-match',
        jobDescription,
        score: report.score,
        breakdown: report.breakdown,
        matchedSkills: report.matchedSkills,
        relatedSkills: report.relatedSkills,
        missingSkills: report.missingSkills,
        suggestions: report.suggestions,
        details: { skills: report.skills, titleMatch: report.titleMatch },
      });
      res.json({ success: true, data: { analysisId: analysis.id, ...report } });
    },

    /** AI suggestions are returned for review only; nothing is saved until the client PATCHes accepted changes. */
    async improve(req: Request, res: Response) {
      const { jobDescription } = improveSchema.parse(req.body ?? {});
      const resume = await findOwnedResume(req);
      const content = toResumeContent(resume);
      const raw = await ai.suggestImprovements({ resume: content, jobDescription });
      res.json({ success: true, data: { suggestions: resolveSuggestions(content, raw) } });
    },

    async listAnalyses(req: Request, res: Response) {
      const resume = await findOwnedResume(req);
      const items = await Analysis.find({ resumeId: resume._id, userId: resume.userId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(ANALYSES_KEPT)
        .select('kind score createdAt matchedSkills missingSkills');
      res.json({ success: true, data: { items } });
    },

    /** Exact PDF for the live preview of unsaved content, with page count, fit scale and movable block boxes. */
    async preview(req: Request, res: Response) {
      const body = previewSchema.parse(req.body ?? {});
      const content = { ...emptyResumeContent(), ...body, personalInfo: { ...emptyResumeContent().personalInfo, ...body.personalInfo } } as ResumeContent;
      const out = await renderResumePdfDetailed(content, body.templateId, { fitToPage: body.fitToPage });
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        data: {
          pdf: out.buffer.toString('base64'),
          pages: out.pages,
          scale: Number(out.scale.toFixed(2)),
          spacing: Number(out.spacing.toFixed(2)),
          fitted: out.fitted,
          boxes: out.boxes,
        },
      });
    },

    async export(req: Request, res: Response) {
      const { format } = exportQuerySchema.parse(req.query);
      const resume = await findOwnedResume(req);
      const content = toResumeContent(resume);
      let buf: Buffer;
      if (format === 'pdf') {
        buf = await renderResumePdf(content, content.templateId, { fitToPage: content.fitToPage });
      } else {
        // DOCX can't be measured server-side; reuse the scale the PDF needed so both stay in step.
        const fit = content.fitToPage ? await renderResumePdfDetailed(content, content.templateId, { fitToPage: true }) : { scale: 1, spacing: 1 };
        buf = await renderResumeDocx(content, content.templateId, { scale: fit.scale, spacing: fit.spacing });
      }
      const filename = exportFilename(content, format);
      res.setHeader(
        'Content-Type',
        format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(buf);
    },
  };
}
