import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  TabStopType,
  TextRun,
} from 'docx';
import type { ResumeContent } from '../types/resume.js';
import { formatDateRange, formatResumeDate } from '../utils/dates.js';
import { woffToSfnt } from '../utils/woff.js';

/*
 * Resume export (PDF + DOCX).
 *
 * ATS rules every template keeps: one column of real, selectable text in reading order; standard section
 * headings; embedded standard-encoded fonts; no tables, text boxes, images or icons; no letter-spacing
 * (tracked text extracts as "E X P E R I E N C E"); links written out as text. Templates change only
 * typography, colour and spacing. Decorative shapes (rules, bars, a header band) are vector graphics
 * that parsers ignore.
 */

export const SECTION_TITLES = {
  summary: 'Professional Summary',
  skills: 'Skills',
  experience: 'Work Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
} as const;

export const TEMPLATE_IDS = ['classic', 'modern', 'compact', 'executive', 'minimal', 'bold'] as const;
export type Template = (typeof TEMPLATE_IDS)[number];

// ---------- Fonts (SIL Open Font License, bundled via @fontsource) ----------

type FontFamily = 'inter' | 'lato' | 'serif';
type Weight = 'regular' | 'medium' | 'semibold' | 'bold' | 'italic';

const require = createRequire(import.meta.url);
const FONT_FILES: Record<FontFamily, Record<Weight, [pkg: string, file: string]>> = {
  inter: {
    regular: ['@fontsource/inter', 'inter-latin-400-normal.woff'],
    medium: ['@fontsource/inter', 'inter-latin-500-normal.woff'],
    semibold: ['@fontsource/inter', 'inter-latin-600-normal.woff'],
    bold: ['@fontsource/inter', 'inter-latin-700-normal.woff'],
    italic: ['@fontsource/inter', 'inter-latin-400-italic.woff'],
  },
  lato: {
    regular: ['@fontsource/lato', 'lato-latin-400-normal.woff'],
    medium: ['@fontsource/lato', 'lato-latin-400-normal.woff'],
    semibold: ['@fontsource/lato', 'lato-latin-700-normal.woff'],
    bold: ['@fontsource/lato', 'lato-latin-900-normal.woff'],
    italic: ['@fontsource/lato', 'lato-latin-400-italic.woff'],
  },
  serif: {
    regular: ['@fontsource/source-serif-4', 'source-serif-4-latin-400-normal.woff'],
    medium: ['@fontsource/source-serif-4', 'source-serif-4-latin-500-normal.woff'],
    semibold: ['@fontsource/source-serif-4', 'source-serif-4-latin-600-normal.woff'],
    bold: ['@fontsource/source-serif-4', 'source-serif-4-latin-700-normal.woff'],
    italic: ['@fontsource/source-serif-4', 'source-serif-4-latin-400-italic.woff'],
  },
};
const FALLBACK: Record<Weight, string> = { regular: 'Helvetica', medium: 'Helvetica', semibold: 'Helvetica-Bold', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' };
// pdfkit accepts an already-parsed fontkit font. Parsing once and sharing it across documents makes
// each render ~10x cheaper than registering the file per document (fit-to-page renders many times).
const fontkit = require('fontkit') as { create: (buf: Buffer) => unknown };
const fontCache = new Map<string, unknown>();

function fontObject(family: FontFamily, weight: Weight): unknown {
  const key = `${family}:${weight}`;
  if (!fontCache.has(key)) {
    try {
      const [pkg, file] = FONT_FILES[family][weight];
      const woff = fs.readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'files', file));
      fontCache.set(key, fontkit.create(woffToSfnt(woff)));
    } catch {
      fontCache.set(key, null); // falls back to a built-in PDF font
    }
  }
  return fontCache.get(key);
}

// ---------- Templates ----------

interface TemplateStyle {
  font: FontFamily;
  docxFont: string;
  accent: string; // hex without '#'
  ink: string;
  muted: string;
  hairline: string;
  header: 'center' | 'left' | 'band';
  nameSize: number;
  nameUpper: boolean;
  headlineAccent: boolean;
  contactSize: number;
  headingSize: number;
  headingUpper: boolean;
  headingAccent: boolean;
  /** "rule": full-width hairline, "double", "bar": accent bar left, "short": short accent underline, "none". */
  headingRule: 'rule' | 'double' | 'bar' | 'short' | 'none';
  headingCenter: boolean;
  bodySize: number;
  titleSize: number;
  metaSize: number;
  companyStyle: 'accent' | 'italic' | 'muted';
  bulletAccent: boolean;
  marginX: number;
  marginY: number;
  /** Points of space before a section, before an entry, and after a bullet, at spacing 1. */
  sectionGap: number;
  entryGap: number;
  bulletGap: number;
  lineGap: number;
}

const BASE: TemplateStyle = {
  font: 'lato',
  docxFont: 'Calibri',
  accent: '1F2937',
  ink: '111827',
  muted: '4B5563',
  hairline: '9CA3AF',
  header: 'center',
  nameSize: 24,
  nameUpper: false,
  headlineAccent: false,
  contactSize: 9.5,
  headingSize: 11,
  headingUpper: true,
  headingAccent: false,
  headingRule: 'rule',
  headingCenter: false,
  bodySize: 10,
  titleSize: 10.8,
  metaSize: 9.5,
  companyStyle: 'italic',
  bulletAccent: false,
  marginX: 50,
  marginY: 42,
  sectionGap: 14,
  entryGap: 8,
  bulletGap: 2.2,
  lineGap: 1.6,
};

export const TEMPLATES: Record<Template, TemplateStyle> = {
  classic: BASE,
  modern: {
    ...BASE,
    font: 'inter',
    accent: '1D4ED8',
    header: 'left',
    nameSize: 25,
    headlineAccent: true,
    headingAccent: true,
    headingRule: 'rule',
    hairline: 'BFDBFE',
    bodySize: 9.3,
    titleSize: 10.2,
    metaSize: 8.9,
    companyStyle: 'accent',
    bulletAccent: true,
  },
  compact: {
    ...BASE,
    font: 'inter',
    accent: '0F172A',
    header: 'left',
    nameSize: 19,
    contactSize: 8.6,
    headingSize: 9.8,
    bodySize: 8.9,
    titleSize: 9.6,
    metaSize: 8.6,
    companyStyle: 'muted',
    marginX: 38,
    marginY: 32,
    sectionGap: 10,
    entryGap: 5,
    bulletGap: 1.2,
    lineGap: 1,
  },
  executive: {
    ...BASE,
    font: 'serif',
    docxFont: 'Cambria',
    accent: '7F1D1D',
    nameSize: 22,
    nameUpper: true,
    headingSize: 10.8,
    headingCenter: true,
    headingRule: 'double',
    hairline: '7F1D1D',
    bodySize: 9.9,
    titleSize: 10.6,
    metaSize: 9.4,
  },
  minimal: {
    ...BASE,
    font: 'inter',
    accent: '374151',
    header: 'left',
    nameSize: 26,
    headingSize: 9.5,
    headingRule: 'none',
    muted: '6B7280',
    bodySize: 9.3,
    titleSize: 10.2,
    metaSize: 8.9,
    companyStyle: 'muted',
    sectionGap: 18,
  },
  bold: {
    ...BASE,
    font: 'inter',
    accent: '0F766E',
    header: 'band',
    nameSize: 25,
    headingAccent: true,
    headingRule: 'bar',
    bodySize: 9.3,
    titleSize: 10.2,
    metaSize: 8.9,
    companyStyle: 'accent',
    bulletAccent: true,
  },
};

/** Labels for the template picker. */
export const TEMPLATE_INFO: Record<Template, { label: string; description: string }> = {
  classic: { label: 'Classic', description: 'Lato, centered header, hairline rules. Safe for any role.' },
  modern: { label: 'Modern', description: 'Inter with blue accents, left-aligned. Clean and contemporary.' },
  compact: { label: 'Compact', description: 'Tighter type and spacing. Fits more on one page.' },
  executive: { label: 'Executive', description: 'Source Serif, centered headings, deep red accents. Formal.' },
  minimal: { label: 'Minimal', description: 'Generous white space, quiet headings, no rules.' },
  bold: { label: 'Bold', description: 'Teal header band and heading bars. Stands out, still ATS-safe.' },
};

// ---------- Shared helpers ----------

function displayUrl(url: string) {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

function hrefFor(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function contactItems(r: ResumeContent): Array<{ text: string; href?: string }> {
  const p = r.personalInfo;
  const items: Array<{ text: string; href?: string }> = [];
  if (p.location) items.push({ text: p.location });
  if (p.phone) items.push({ text: p.phone });
  if (p.email) items.push({ text: p.email, href: `mailto:${p.email}` });
  for (const url of [p.linkedin, p.github, p.portfolio]) if (url) items.push({ text: displayUrl(url), href: hrefFor(url) });
  return items;
}

function educationTitle(e: ResumeContent['education'][number]) {
  return [e.degree, e.field].filter(Boolean).join(' in ') || e.institution;
}

function nonEmpty(r: ResumeContent) {
  return {
    experience: r.experience.filter((e) => e.jobTitle || e.company || e.description.some(Boolean)),
    projects: r.projects.filter((p) => p.name || p.description.some(Boolean)),
    education: r.education.filter((e) => e.institution || e.degree),
    certifications: r.certifications.filter((c) => c.name),
    skills: r.skills.map((s) => s.trim()).filter(Boolean),
    additional: (r.additionalSections ?? [])
      .map((s) => ({ title: s.title.trim(), items: s.items.map((i) => i.trim()).filter(Boolean) }))
      .filter((s) => s.title && s.items.length),
  };
}

// The bundled fonts (and the PDF fallbacks) cover Latin text. Map common characters outside that set.
function pdfSafe(s: string) {
  return s
    .replace(/₹/g, 'INR ')
    .replace(/[‐-‒−]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—‘’“”•…€·]/g, '');
}

/** Every item is a few words: "English", "Photography", "Chess". */
const shortItems = (items: string[]) => items.length > 1 && items.every((i) => i.length <= 30 && i.split(/\s+/).length <= 4);

/** Keep short facts like "2020 – 2024" or "CGPA: 8.84" on one line when text wraps. */
const nb = (s: string) => s.replace(/ /g, ' ');

// ---------- PDF ----------

export interface PdfRender {
  buffer: Buffer;
  pages: number;
  /** Type scale used (1 = the template's normal size). */
  scale: number;
  /** Spacing scale used (1 = the template's normal spacing). */
  spacing: number;
  /** True when fit-to-one-page was requested and the result is one page. */
  fitted: boolean;
}

/**
 * Smallest body size when fitting, per typeface: Inter's tall x-height reads like ~8.7pt Lato at 8.1pt.
 */
const MIN_BODY_PT: Record<FontFamily, number> = { inter: 8.1, lato: 8.5, serif: 8.6 };
/** Below this, sections and entries start to run together; we'd rather report "doesn't fit". */
const MIN_SPACING = 0.4;

// Recent results, so toggling templates/fit on the same content is instant.
const renderCache = new Map<string, PdfRender>();
const CACHE_SIZE = 40;

interface Layout {
  pages: number;
  /** Space left on the last page, in points. */
  free: number;
  doc: PDFKit.PDFDocument;
}

/**
 * Lays out the resume at a type scale (f) and spacing scale (s). Returns the document unfinished so
 * measuring passes can skip serialisation; call `finish` to get the bytes.
 */
export function layoutPdf(r: ResumeContent, template: Template, f: number, s: number): Layout {
  const st = TEMPLATES[template] ?? TEMPLATES.classic;
  const k = (n: number) => n * f;
  const sp = (n: number) => n * s;
  const marginX = Math.max(36, st.marginX * (0.72 + 0.28 * s));
  const marginY = Math.max(24, st.marginY * (0.55 + 0.45 * s));
  const band = st.header === 'band';
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: marginY, bottom: marginY, left: marginX, right: marginX },
    // pdfkit crashes on undefined info values, so only set Author when there is a name.
    info: { Title: `${r.personalInfo.fullName || 'Resume'} - Resume`, ...(r.personalInfo.fullName ? { Author: r.personalInfo.fullName } : {}) },
    bufferPages: true,
    autoFirstPage: true,
  });

  const F: Record<Weight, string> = { regular: '', medium: '', semibold: '', bold: '', italic: '' };
  for (const w of Object.keys(F) as Weight[]) {
    const font = fontObject(st.font, w);
    if (font) {
      // pdfkit's typings only list file/buffer sources, but it accepts a parsed fontkit font.
      doc.registerFont(`${st.font}-${w}`, font as unknown as Buffer);
      F[w] = `${st.font}-${w}`;
    } else F[w] = FALLBACK[w];
  }

  const accent = `#${st.accent}`;
  const ink = `#${st.ink}`;
  const muted = `#${st.muted}`;
  const hairline = `#${st.hairline}`;
  const width = doc.page.width - marginX * 2;
  const left = marginX;
  const right = left + width;
  const t = pdfSafe;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensureSpace = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  /** One line: text on the left (may wrap), short text right-aligned on the first line. */
  const splitRow = (leftText: string, leftFont: string, leftSize: number, leftColor: string, rightText: string, rightFont: string, rightSize: number, rightColor: string) => {
    const y = doc.y;
    doc.font(rightFont).fontSize(rightSize);
    const rw = rightText ? doc.widthOfString(t(rightText)) : 0;
    const lw = rightText ? width - rw - 14 : width;
    doc.font(leftFont).fontSize(leftSize).fillColor(leftColor).text(t(leftText), left, y, { width: lw, lineGap: k(0.4) });
    const after = doc.y;
    if (rightText) {
      // Align the right text's baseline with the left text's first line.
      const dy = (leftSize - rightSize) * 0.8;
      doc.font(rightFont).fontSize(rightSize).fillColor(rightColor).text(t(rightText), right - rw, y + dy, { width: rw + 1, lineBreak: false });
    }
    doc.x = left;
    doc.y = Math.max(after, y + doc.currentLineHeight(true));
  };

  const heading = (title: string) => {
    ensureSpace(k(st.headingSize) * 3 + sp(st.sectionGap));
    doc.y += sp(st.sectionGap);
    const label = st.headingUpper ? title.toUpperCase() : title;
    const color = st.headingAccent ? accent : ink;
    const top = doc.y;
    const indent = st.headingRule === 'bar' ? 9 : 0;
    doc.font(F.bold).fontSize(k(st.headingSize)).fillColor(color);
    doc.text(t(label), left + indent, top, { width: width - indent, align: st.headingCenter ? 'center' : 'left' });
    const textBottom = doc.y;
    if (st.headingRule === 'bar') doc.rect(left, top + 1, 3.5, textBottom - top - 2.5).fill(accent);
    let y = textBottom + 1.5;
    if (st.headingRule === 'rule') {
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.6).strokeColor(st.headingAccent ? accent : hairline).stroke();
    } else if (st.headingRule === 'double') {
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor(hairline).stroke();
      y += 2;
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.35).strokeColor(hairline).stroke();
    } else if (st.headingRule === 'short') {
      doc.moveTo(left, y).lineTo(left + 28, y).lineWidth(1.6).strokeColor(accent).stroke();
    }
    doc.x = left;
    doc.y = y + Math.max(3.5, sp(5.5));
    doc.fillColor(ink);
  };

  const bullet = (text: string) => {
    doc.font(F.regular).fontSize(k(st.bodySize));
    ensureSpace(doc.currentLineHeight(true) + 2);
    const y = doc.y;
    doc.fillColor(st.bulletAccent ? accent : ink).text('•', left + 2, y, { width: 10, lineBreak: false });
    doc.fillColor(ink).text(t(text), left + 13, y, { width: width - 13, lineGap: sp(st.lineGap) });
    doc.x = left;
    doc.y += sp(st.bulletGap);
  };

  const paragraph = (text: string) => {
    doc.font(F.regular).fontSize(k(st.bodySize)).fillColor(ink).text(t(text), left, doc.y, { width, lineGap: sp(st.lineGap) + 0.4 });
  };

  const companyFont = st.companyStyle === 'italic' ? F.italic : F.medium;
  const companyColor = st.companyStyle === 'accent' ? accent : st.companyStyle === 'muted' ? muted : ink;

  /** Title + dates on line 1, organisation + location (or detail) on line 2. */
  const entry = (title: string, dates: string, org: string, orgRight: string, firstBodyLine = true) => {
    ensureSpace(k(st.titleSize) * 2.6 + (firstBodyLine ? k(st.bodySize) * 1.4 : 0) + sp(st.entryGap));
    doc.y += sp(st.entryGap);
    splitRow(title, F.semibold, k(st.titleSize), ink, nb(dates), F.regular, k(st.metaSize), muted);
    if (org || orgRight) {
      doc.y += 0.5;
      splitRow(org, companyFont, k(st.metaSize + 0.3), companyColor, orgRight, F.regular, k(st.metaSize), muted);
    }
    doc.y += sp(2.5);
  };

  // ---- Header
  const p = r.personalInfo;
  const name = t(p.fullName || 'Your Name');
  const align = st.header === 'center' ? 'center' : 'left';
  const contacts = contactItems(r);
  const sep = '   •   ';
  const pad = band ? 16 : 0;
  const drawHeader = (dry: boolean) => {
    const nameColor = band ? '#FFFFFF' : st.header === 'left' && st.headlineAccent ? accent : ink;
    const subColor = band ? '#E6FFFA' : st.headlineAccent ? accent : muted;
    const contactColor = band ? '#F0FDFA' : muted;
    const startY = doc.y;
    doc.font(F.bold).fontSize(k(st.nameSize)).fillColor(nameColor);
    if (!dry) doc.text(st.nameUpper ? name.toUpperCase() : name, left + pad, doc.y, { width: width - pad * 2, align });
    else doc.y += doc.heightOfString(name, { width: width - pad * 2 });
    if (r.targetJobTitle) {
      doc.font(F.medium).fontSize(k(st.nameSize * 0.48)).fillColor(subColor);
      if (!dry) doc.text(t(r.targetJobTitle), left + pad, doc.y + 1, { width: width - pad * 2, align });
      else doc.y += doc.heightOfString(t(r.targetJobTitle)) + 1;
    }
    if (contacts.length) {
      doc.y += sp(5);
      doc.font(F.regular).fontSize(k(st.contactSize)).fillColor(contactColor);
      // Measure and place each item ourselves (pdfkit's `continued` + center overlaps), with links.
      const sepW = doc.widthOfString(sep);
      const avail = width - pad * 2;
      const rows: Array<typeof contacts> = [[]];
      let rowW = 0;
      for (const c of contacts) {
        const w = doc.widthOfString(t(c.text));
        const row = rows[rows.length - 1];
        if (row.length && rowW + sepW + w > avail) {
          rows.push([c]);
          rowW = w;
        } else {
          rowW += (row.length ? sepW : 0) + w;
          row.push(c);
        }
      }
      for (const row of rows) {
        const total = row.reduce((a, c, i) => a + doc.widthOfString(t(c.text)) + (i ? sepW : 0), 0);
        let x = align === 'center' ? left + (width - total) / 2 : left + pad;
        const y = doc.y;
        if (!dry) {
          row.forEach((c, i) => {
            if (i) {
              doc.text(sep, x, y, { lineBreak: false });
              x += sepW;
            }
            const label = t(c.text);
            const w = doc.widthOfString(label);
            doc.text(label, x, y, { lineBreak: false });
            if (c.href) doc.link(x, y, w, doc.currentLineHeight(), c.href);
            x += w;
          });
        }
        doc.y = y + doc.currentLineHeight(true);
      }
    }
    return doc.y - startY;
  };

  if (band) {
    // Measure, paint the band edge to edge, then draw the text on top.
    const top = doc.y;
    const h = drawHeader(true);
    doc.rect(0, 0, doc.page.width, top + h + pad + 4).fill(accent);
    doc.y = top + pad / 2;
    drawHeader(false);
    doc.y = top + h + pad + 4;
  } else {
    drawHeader(false);
    if (st.header === 'center' && st.headingRule !== 'none') {
      doc.y += sp(6);
    }
  }
  doc.x = left;
  doc.fillColor(ink);

  // ---- Body
  const ne = nonEmpty(r);
  if (r.summary.trim()) {
    heading(SECTION_TITLES.summary);
    paragraph(r.summary.trim());
  }
  if (ne.skills.length) {
    heading(SECTION_TITLES.skills);
    paragraph(ne.skills.join('  •  '));
  }
  if (ne.experience.length) {
    heading(SECTION_TITLES.experience);
    for (const e of ne.experience) {
      const dates = formatDateRange(e.startDate, e.endDate, e.current);
      if (!e.description.some(Boolean) && e.jobTitle && e.company) {
        // No bullets: one row ("Title · Company … dates") instead of two half-empty lines.
        doc.y += sp(st.entryGap);
        ensureSpace(k(st.titleSize) * 1.6);
        splitRow(`${e.jobTitle} · ${e.company}${e.location ? `, ${e.location}` : ''}`, F.semibold, k(st.titleSize), ink, nb(dates), F.regular, k(st.metaSize), muted);
        doc.y += sp(2.5);
        continue;
      }
      entry(e.jobTitle || e.company, dates, e.jobTitle ? e.company : '', e.location, e.description.some(Boolean));
      e.description.filter(Boolean).forEach(bullet);
    }
  }
  if (ne.projects.length) {
    heading(SECTION_TITLES.projects);
    for (const pr of ne.projects) {
      const tech = pr.technologies.join(' · ');
      doc.font(F.regular).fontSize(k(st.metaSize));
      // Short tech lists sit on the title row (saves a line); long ones, or projects with a link, get their own line.
      const inlineTech = !pr.url && tech && doc.widthOfString(tech) < width * 0.45;
      entry(pr.name, inlineTech ? tech : pr.url ? displayUrl(pr.url) : '', inlineTech ? '' : tech, '', pr.description.some(Boolean));
      pr.description.filter(Boolean).forEach(bullet);
    }
  }
  if (ne.education.length) {
    heading(SECTION_TITLES.education);
    for (const e of ne.education) {
      const org = [e.degree || e.field ? e.institution : '', e.location].filter(Boolean).join(', ');
      entry(educationTitle(e), formatDateRange(e.startDate, e.endDate, false), org, nb(e.grade), false);
    }
  }
  if (ne.certifications.length) {
    heading(SECTION_TITLES.certifications);
    for (const c of ne.certifications) {
      bullet([c.name, [c.issuer, formatResumeDate(c.date)].filter(Boolean).join(', ')].filter(Boolean).join(' — ') + (c.url ? ` (${displayUrl(c.url)})` : ''));
    }
  }
  for (const sct of ne.additional) {
    heading(sct.title);
    // Lists of short items (languages, interests) read better inline than as a column of bullets.
    if (shortItems(sct.items)) paragraph(sct.items.join('  •  '));
    else sct.items.forEach(bullet);
  }

  const range = doc.bufferedPageRange();
  return { pages: range.count, free: Math.max(0, bottom() - doc.y), doc };
}

function finish(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * Render a PDF. With `fitToPage`, spacing is reduced first (binary search, so the page ends up full
 * rather than half empty), and only then the type, never below 8.6pt body text. If even that doesn't
 * fit, the smallest readable version is returned with `fitted: false`.
 */
export async function renderResumePdfDetailed(r: ResumeContent, template: Template = 'classic', opts: { fitToPage?: boolean } = {}): Promise<PdfRender> {
  const key = createHash('sha1').update(JSON.stringify([r, template, Boolean(opts.fitToPage)])).digest('hex');
  const hit = renderCache.get(key);
  if (hit) return hit;
  const result = await computePdf(r, template, Boolean(opts.fitToPage));
  renderCache.set(key, result);
  if (renderCache.size > CACHE_SIZE) renderCache.delete(renderCache.keys().next().value!);
  return result;
}

async function computePdf(r: ResumeContent, template: Template, fitToPage: boolean): Promise<PdfRender> {
  const st = TEMPLATES[template] ?? TEMPLATES.classic;
  const out = async (f: number, s: number, fitted: boolean): Promise<PdfRender> => {
    const l = layoutPdf(r, template, f, s);
    return { buffer: await finish(l.doc), pages: l.pages, scale: f, spacing: s, fitted };
  };
  const fits = (f: number, s: number) => layoutPdf(r, template, f, s).pages <= 1;

  if (!fitToPage || fits(1, 1)) return out(1, 1, fitToPage);

  // 1) Spacing only, at full type size.
  if (fits(1, MIN_SPACING)) {
    let lo = MIN_SPACING;
    let hi = 1;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      if (fits(1, mid)) lo = mid;
      else hi = mid;
    }
    return out(1, lo, true);
  }

  // 2) Both. Cramped spacing looks worse than slightly smaller type, so for several spacing levels find
  //    the largest type that fits, and keep the most readable balance. Then give any leftover space back
  //    to spacing so the page ends full rather than with an empty strip.
  const minF = Math.min(1, MIN_BODY_PT[st.font] / st.bodySize);
  if (!fits(minF, MIN_SPACING)) return out(minF, MIN_SPACING, false);
  const maxTypeAt = (s: number): number | null => {
    if (!fits(minF, s)) return null;
    let lo = minF;
    let hi = 1;
    for (let i = 0; i < 4; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid, s)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  // Breathing room is weighted heavily: a cramped page looks worse than slightly smaller type.
  const SPACING_WEIGHT = 0.6;
  let best = { f: minF, s: MIN_SPACING, score: -1 };
  for (const s of [0.75, 0.55, MIN_SPACING]) {
    if (best.score >= 1 + SPACING_WEIGHT * s) break; // no lower spacing level can beat what we have
    const f = maxTypeAt(s);
    if (f === null) continue;
    const score = f + SPACING_WEIGHT * s;
    if (score > best.score) best = { f, s, score };
  }
  let sLo = best.s;
  let sHi = 1;
  for (let i = 0; i < 4; i++) {
    const mid = (sLo + sHi) / 2;
    if (fits(best.f, mid)) sLo = mid;
    else sHi = mid;
  }
  return out(best.f, sLo, true);
}

export async function renderResumePdf(r: ResumeContent, template: Template = 'classic', opts: { fitToPage?: boolean } = {}): Promise<Buffer> {
  return (await renderResumePdfDetailed(r, template, opts)).buffer;
}

// ---------- DOCX ----------

export async function renderResumeDocx(r: ResumeContent, template: Template = 'classic', opts: { scale?: number; spacing?: number } = {}): Promise<Buffer> {
  const st = TEMPLATES[template] ?? TEMPLATES.classic;
  const f = opts.scale ?? 1;
  const s = opts.spacing ?? 1;
  const hp = (pt: number) => Math.round(pt * f * 2); // half-points
  const tw = (pt: number) => Math.round(pt * s * 20); // twips
  const font = st.docxFont;
  const band = st.header === 'band';
  const align = st.header === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT;
  const children: Paragraph[] = [];
  const ne = nonEmpty(r);
  const p = r.personalInfo;
  const marginX = Math.max(36, st.marginX * (0.72 + 0.28 * s));
  const textWidthTw = Math.round((595.28 - marginX * 2) * 20);
  const rightTab = [{ type: TabStopType.RIGHT, position: textWidthTw }];
  const companyColor = st.companyStyle === 'accent' ? st.accent : st.companyStyle === 'muted' ? st.muted : st.ink;

  const heading = (title: string) =>
    children.push(
      new Paragraph({
        alignment: st.headingCenter ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { before: tw(st.sectionGap), after: tw(5) },
        keepNext: true,
        border:
          st.headingRule === 'rule'
            ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: st.headingAccent ? st.accent : st.hairline, space: 2 } }
            : st.headingRule === 'double'
              ? { bottom: { style: BorderStyle.DOUBLE, size: 4, color: st.hairline, space: 2 } }
              : st.headingRule === 'bar'
                ? { left: { style: BorderStyle.SINGLE, size: 24, color: st.accent, space: 6 } }
                : undefined,
        children: [new TextRun({ text: st.headingUpper ? title.toUpperCase() : title, bold: true, size: hp(st.headingSize), color: st.headingAccent ? st.accent : st.ink, font })],
      }),
    );
  const body = (text: string) => children.push(new Paragraph({ spacing: { after: tw(3) }, children: [new TextRun({ text, size: hp(st.bodySize), font, color: st.ink })] }));
  const bullet = (text: string) =>
    children.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: tw(st.bulletGap) }, children: [new TextRun({ text, size: hp(st.bodySize), font, color: st.ink })] }));
  const entry = (title: string, dates: string, org: string, orgRight: string) => {
    children.push(
      new Paragraph({
        tabStops: rightTab,
        spacing: { before: tw(st.entryGap) },
        keepNext: true,
        children: [
          new TextRun({ text: title, bold: true, size: hp(st.titleSize), font, color: st.ink }),
          ...(dates ? [new TextRun({ text: `\t${dates}`, size: hp(st.metaSize), font, color: st.muted })] : []),
        ],
      }),
    );
    if (org || orgRight) {
      children.push(
        new Paragraph({
          tabStops: rightTab,
          spacing: { after: tw(2.5) },
          keepNext: true,
          children: [
            new TextRun({ text: org, italics: st.companyStyle === 'italic', size: hp(st.metaSize + 0.3), font, color: companyColor }),
            ...(orgRight ? [new TextRun({ text: `\t${orgRight}`, size: hp(st.metaSize), font, color: st.muted })] : []),
          ],
        }),
      );
    }
  };

  const shading = band ? { type: ShadingType.CLEAR, fill: st.accent, color: 'auto' } : undefined;
  const name = p.fullName || 'Your Name';
  children.push(
    new Paragraph({
      alignment: align,
      shading,
      children: [new TextRun({ text: st.nameUpper ? name.toUpperCase() : name, bold: true, size: hp(st.nameSize), font, color: band ? 'FFFFFF' : st.headlineAccent ? st.accent : st.ink })],
    }),
  );
  if (r.targetJobTitle) {
    children.push(
      new Paragraph({ alignment: align, shading, children: [new TextRun({ text: r.targetJobTitle, size: hp(st.nameSize * 0.48), font, color: band ? 'E6FFFA' : st.headlineAccent ? st.accent : st.muted })] }),
    );
  }
  const contacts = contactItems(r);
  if (contacts.length) {
    const color = band ? 'F0FDFA' : st.muted;
    const runs: Array<TextRun | ExternalHyperlink> = [];
    contacts.forEach((c, i) => {
      if (i > 0) runs.push(new TextRun({ text: '   •   ', size: hp(st.contactSize), color, font }));
      const run = new TextRun({ text: c.text, size: hp(st.contactSize), color, font });
      runs.push(c.href ? new ExternalHyperlink({ link: c.href, children: [run] }) : run);
    });
    children.push(new Paragraph({ alignment: align, shading, spacing: { before: tw(4), after: tw(6) }, children: runs }));
  }

  if (r.summary.trim()) {
    heading(SECTION_TITLES.summary);
    body(r.summary.trim());
  }
  if (ne.skills.length) {
    heading(SECTION_TITLES.skills);
    body(ne.skills.join('  •  '));
  }
  if (ne.experience.length) {
    heading(SECTION_TITLES.experience);
    for (const e of ne.experience) {
      const dates = formatDateRange(e.startDate, e.endDate, e.current);
      if (!e.description.some(Boolean) && e.jobTitle && e.company) {
        entry(`${e.jobTitle} · ${e.company}${e.location ? `, ${e.location}` : ''}`, dates, '', '');
        continue;
      }
      entry(e.jobTitle || e.company, dates, e.jobTitle ? e.company : '', e.location);
      e.description.filter(Boolean).forEach(bullet);
    }
  }
  if (ne.projects.length) {
    heading(SECTION_TITLES.projects);
    for (const pr of ne.projects) {
      entry(pr.name, pr.url ? displayUrl(pr.url) : '', pr.technologies.join(' · '), '');
      pr.description.filter(Boolean).forEach(bullet);
    }
  }
  if (ne.education.length) {
    heading(SECTION_TITLES.education);
    for (const e of ne.education) {
      entry(educationTitle(e), formatDateRange(e.startDate, e.endDate, false), [e.degree || e.field ? e.institution : '', e.location].filter(Boolean).join(', '), e.grade);
    }
  }
  if (ne.certifications.length) {
    heading(SECTION_TITLES.certifications);
    for (const c of ne.certifications) {
      bullet([c.name, [c.issuer, formatResumeDate(c.date)].filter(Boolean).join(', ')].filter(Boolean).join(' — ') + (c.url ? ` (${displayUrl(c.url)})` : ''));
    }
  }
  for (const sct of ne.additional) {
    heading(sct.title);
    if (shortItems(sct.items)) body(sct.items.join('  •  '));
    else sct.items.forEach(bullet);
  }

  const mx = Math.round(marginX * 20);
  const my = Math.round(Math.max(24, st.marginY * (0.55 + 0.45 * s)) * 20);
  const doc = new Document({
    creator: 'ResumeCraft',
    title: `${p.fullName || 'Resume'} - Resume`,
    styles: { default: { document: { run: { font, size: hp(st.bodySize) } } } },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 300, hanging: 220 } } } }],
        },
      ],
    },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: my, bottom: my, left: mx, right: mx } } }, children }],
  });
  return Packer.toBuffer(doc);
}

export function exportFilename(r: ResumeContent, ext: 'pdf' | 'docx') {
  const base = (r.personalInfo.fullName || r.title || 'Resume').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || 'Resume';
  return `${base}_Resume.${ext}`;
}
