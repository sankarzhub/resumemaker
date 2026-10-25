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
import { emptyLayout, type ResumeContent } from '../types/resume.js';
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

const SECTION_TITLES = {
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

const TEMPLATES: Record<Template, TemplateStyle> = {
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

// ---------- Shared helpers ----------

function displayUrl(url: string) {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

function hrefFor(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

type ContactKind = 'location' | 'phone' | 'email' | 'linkedin' | 'github' | 'portfolio';
interface ContactItem {
  kind: ContactKind;
  text: string;
  href?: string;
}

function contactItems(r: ResumeContent): ContactItem[] {
  const p = r.personalInfo;
  const items: ContactItem[] = [];
  if (p.location) items.push({ kind: 'location', text: p.location });
  if (p.phone) {
    const digits = p.phone.replace(/[^\d+]/g, '');
    items.push({ kind: 'phone', text: p.phone, href: digits.length >= 6 ? `tel:${digits}` : undefined });
  }
  if (p.email) items.push({ kind: 'email', text: p.email, href: `mailto:${p.email}` });
  for (const kind of ['linkedin', 'github', 'portfolio'] as const) {
    const url = p[kind];
    if (url) items.push({ kind, text: displayUrl(url), href: hrefFor(url) });
  }
  return items;
}

// ---------- Contact icons (vector paths, so they add no text for ATS parsers to trip on) ----------

// 24x24 artwork. Stroked outlines follow Lucide (ISC); the LinkedIn and GitHub marks are Simple Icons (CC0).
const ICONS: Record<ContactKind, { fill: boolean; paths: string[] }> = {
  location: { fill: false, paths: ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z', 'M15 10a3 3 0 1 1-6 0 3 3 0 1 1 6 0Z'] },
  phone: {
    fill: false,
    paths: [
      'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z',
    ],
  },
  email: { fill: false, paths: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'm22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7'] },
  portfolio: { fill: false, paths: ['M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0Z', 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'] },
  linkedin: {
    fill: true,
    paths: [
      'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
    ],
  },
  github: {
    fill: true,
    paths: [
      'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
    ],
  },
};

const BRAND: Partial<Record<ContactKind, string>> = { linkedin: '#0A66C2', github: '#181717' };
const BADGE_LABEL: Record<ContactKind, string> = { location: 'Location', phone: 'Phone', email: 'Email', linkedin: 'LinkedIn', github: 'GitHub', portfolio: 'Website' };

function drawGlyph(doc: PDFKit.PDFDocument, kind: ContactKind, x: number, y: number, size: number, color: string) {
  const icon = ICONS[kind];
  doc.save();
  doc.translate(x, y).scale(size / 24);
  for (const d of icon.paths) {
    if (icon.fill) doc.path(d).fill(color);
    else doc.path(d).lineWidth(2.1).lineCap('round').lineJoin('round').stroke(color);
  }
  doc.restore();
}

/** A square, clickable badge: brand marks in their colours, the rest as a white glyph on an accent tile. */
function drawBadge(doc: PDFKit.PDFDocument, kind: ContactKind, x: number, y: number, size: number, accent: string, onBand: boolean) {
  const brand = BRAND[kind];
  if (brand) {
    // White behind the mark so its cut-outs stay white on a coloured header band.
    if (onBand) {
      if (kind === 'github') doc.circle(x + size / 2, y + size / 2, size * 0.47).fill('#FFFFFF');
      else doc.roundedRect(x + size * 0.04, y + size * 0.04, size * 0.92, size * 0.92, size * 0.08).fill('#FFFFFF');
    }
    drawGlyph(doc, kind, x, y, size, brand);
  } else {
    doc.roundedRect(x, y, size, size, size * 0.12).fill(onBand ? '#FFFFFF' : accent);
    drawGlyph(doc, kind, x + size * 0.2, y + size * 0.2, size * 0.6, onBand ? accent : '#FFFFFF');
  }
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
  };
}

/** Section keys in print order: the saved order first, then any others in the default order. */
export function sectionOrder(r: ResumeContent): string[] {
  const all = ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', ...(r.additionalSections ?? []).map((_, i) => `extra-${i}`)];
  const saved = (r.layout?.sectionOrder ?? []).filter((k, i, list) => all.includes(k) && list.indexOf(k) === i);
  return [...saved, ...all.filter((k) => !saved.includes(k))];
}

function certificationLine(c: ResumeContent['certifications'][number]) {
  return [c.name, [c.issuer, formatResumeDate(c.date)].filter(Boolean).join(', ')].filter(Boolean).join(' — ') + (c.url ? ` (${displayUrl(c.url)})` : '');
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
  /** Where each movable block sits, for the drag-to-position editor. */
  boxes: LayoutBox[];
}

/**
 * One movable block on one page (a block that crosses a page break has a box per page). Points, top-left
 * origin. x/y is where the block sits without its own offset but including the offset of any block that
 * contains it (a section contains its entries, an entry its bullets); ox/oy is its own saved offset.
 */
export interface LayoutBox {
  id: string;
  label: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  /** The block this one sits in (it moves along with it). */
  parent?: string;
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
  boxes: LayoutBox[];
}

interface Frame {
  id: string;
  parent?: string;
  label: string;
  dx: number;
  dy: number;
  /** Sum of the offsets of the blocks containing this one. */
  px: number;
  py: number;
  x: number;
  w: number;
  page: number;
  top: number;
}

const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Lays out the resume at a type scale (f) and spacing scale (s). Returns the document unfinished so
 * measuring passes can skip serialisation; call `finish` to get the bytes.
 */
function layoutPdf(r: ResumeContent, template: Template, f: number, s: number): Layout {
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

  // ---- Movable blocks. A block is drawn inside a translation by its saved offset, so moving one never
  // reflows the rest of the page, and the text keeps its reading order for ATS parsers.
  const lay = r.layout ?? emptyLayout();
  const frames: Frame[] = [];
  const boxes: LayoutBox[] = [];
  const pageNo = () => doc.bufferedPageRange().count - 1;
  const moved = (fr: Frame) => fr.dx !== 0 || fr.dy !== 0;
  const closeSegment = (fr: Frame, end: number) => {
    if (end - fr.top > 0.5) boxes.push({ id: fr.id, label: fr.label, page: fr.page, x: fr.x + fr.px, y: fr.top + fr.py, w: fr.w, h: end - fr.top, ox: fr.dx, oy: fr.dy, ...(fr.parent ? { parent: fr.parent } : {}) });
  };
  // A page break inside moved blocks (ours, or pdfkit's own inside long text): close their translations on
  // the old page and reopen them on the new one, so each page's content stream stays balanced.
  const rawAddPage = doc.addPage.bind(doc);
  doc.addPage = ((options?: PDFKit.PDFDocumentOptions) => {
    for (let i = frames.length - 1; i >= 0; i--) {
      closeSegment(frames[i], Math.min(doc.y, bottom()));
      if (moved(frames[i])) doc.restore();
    }
    rawAddPage(options);
    for (const fr of frames) {
      fr.page = pageNo();
      fr.top = doc.y;
      if (moved(fr)) doc.save().translate(fr.dx, fr.dy);
    }
    return doc;
  }) as typeof doc.addPage;
  /** Draw one movable block. `draw` may narrow fr.x/fr.w to the ink it actually uses. */
  const block = (id: string, label: string, draw: (fr: Frame) => void) => {
    const off = lay.offsets[id];
    const parent = frames[frames.length - 1];
    const fr: Frame = {
      id,
      parent: parent?.id,
      label,
      dx: off?.x ?? 0,
      dy: off?.y ?? 0,
      px: parent ? parent.px + parent.dx : 0,
      py: parent ? parent.py + parent.dy : 0,
      x: left,
      w: width,
      page: pageNo(),
      top: doc.y,
    };
    if (moved(fr)) doc.save().translate(fr.dx, fr.dy);
    frames.push(fr);
    draw(fr);
    frames.pop();
    closeSegment(fr, doc.y);
    if (moved(fr)) doc.restore();
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

  const headingDraw = (title: string) => {
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

  /** A heading and everything under it. Dragging the heading moves the whole section. */
  const section = (key: string, title: string, body: () => void) => {
    ensureSpace(k(st.headingSize) * 3 + sp(st.sectionGap));
    doc.y += sp(st.sectionGap);
    block(`sec-${key}`, `${title} section`, () => {
      headingDraw(title);
      body();
    });
  };

  const bullet = (text: string, id: string) => {
    doc.font(F.regular).fontSize(k(st.bodySize));
    ensureSpace(doc.currentLineHeight(true) + 2);
    block(id, `Bullet: ${short(text)}`, () => {
      const y = doc.y;
      doc.fillColor(st.bulletAccent ? accent : ink).text('•', left + 2, y, { width: 10, lineBreak: false });
      doc.fillColor(ink).text(t(text), left + 13, y, { width: width - 13, lineGap: sp(st.lineGap) });
      doc.x = left;
    });
    doc.y += sp(st.bulletGap);
  };

  const paragraph = (text: string, id: string, label: string) =>
    block(id, label, () => {
      doc.font(F.regular).fontSize(k(st.bodySize)).fillColor(ink).text(t(text), left, doc.y, { width, lineGap: sp(st.lineGap) + 0.4 });
    });

  const companyFont = st.companyStyle === 'italic' ? F.italic : F.medium;
  const companyColor = st.companyStyle === 'accent' ? accent : st.companyStyle === 'muted' ? muted : ink;

  /** Room and spacing before an entry, outside its block so the block starts at its first line. */
  const entrySpace = (firstBodyLine: boolean) => {
    ensureSpace(k(st.titleSize) * 2.6 + (firstBodyLine ? k(st.bodySize) * 1.4 : 0) + sp(st.entryGap));
    doc.y += sp(st.entryGap);
  };

  /** Title + dates on line 1, organisation + location (or detail) on line 2. */
  const entryRows = (title: string, dates: string, org: string, orgRight: string) => {
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
  const allContacts = contactItems(r);
  // Badges stand in for the written-out profile links. Email and phone stay as text too, so ATS parsers
  // (which ignore icons and link targets) still find them.
  const badges = lay.contactIcons === 'badges' ? allContacts.filter((c) => c.href) : [];
  const contacts = lay.contactIcons === 'badges' ? allContacts.filter((c) => c.kind !== 'linkedin' && c.kind !== 'github' && c.kind !== 'portfolio') : allContacts;
  const inlineIcons = lay.contactIcons === 'inline';
  const sep = '   •   ';
  const pad = band ? 16 : 0;
  const badgeSize = k(st.nameSize) * 0.86;
  const badgeGap = badgeSize * 0.32;
  const badgesW = badges.length ? badges.length * badgeSize + (badges.length - 1) * badgeGap : 0;
  const areaW = width - pad * 2;
  // Keep the name clear of the badges in the top-right corner (on both sides when it is centred).
  const nameW = badgesW ? Math.max(areaW * 0.4, areaW - (badgesW + 12) * (align === 'center' ? 2 : 1)) : areaW;
  /** Narrow a header block's box to its text, honouring the alignment. */
  const fitBox = (fr: Frame, textW: number, area: number) => {
    fr.w = Math.min(area, textW) + 2;
    fr.x = align === 'center' ? left + (width - fr.w) / 2 : left + pad;
  };
  let nameTop = doc.y;
  const drawHeader = (dry: boolean) => {
    const nameColor = band ? '#FFFFFF' : st.header === 'left' && st.headlineAccent ? accent : ink;
    const subColor = band ? '#E6FFFA' : st.headlineAccent ? accent : muted;
    const contactColor = band ? '#F0FDFA' : muted;
    const startY = doc.y;
    nameTop = startY;
    const nameText = st.nameUpper ? name.toUpperCase() : name;
    doc.font(F.bold).fontSize(k(st.nameSize)).fillColor(nameColor);
    if (dry) doc.y += doc.heightOfString(nameText, { width: nameW });
    else
      block('name', 'Name', (fr) => {
        fitBox(fr, doc.widthOfString(nameText), nameW);
        doc.text(nameText, align === 'center' ? left + (width - nameW) / 2 : left + pad, doc.y, { width: nameW, align });
      });
    if (r.targetJobTitle) {
      const headline = t(r.targetJobTitle);
      doc.font(F.medium).fontSize(k(st.nameSize * 0.48)).fillColor(subColor);
      if (dry) doc.y += doc.heightOfString(headline) + 1;
      else {
        doc.y += 1;
        block('headline', 'Headline', (fr) => {
          fitBox(fr, doc.widthOfString(headline), areaW);
          doc.text(headline, left + pad, doc.y, { width: areaW, align });
        });
      }
    }
    if (contacts.length) {
      doc.y += sp(5);
      doc.font(F.regular).fontSize(k(st.contactSize)).fillColor(contactColor);
      // Measure and place each item ourselves (pdfkit's `continued` + center overlaps), with links.
      const iconSize = k(st.contactSize) * 1.15;
      const iconW = inlineIcons ? iconSize + 3 : 0;
      const sepW = inlineIcons ? k(st.contactSize) * 1.6 : doc.widthOfString(sep);
      const itemW = (c: ContactItem) => iconW + doc.widthOfString(t(c.text));
      const rows: Array<typeof contacts> = [[]];
      let rowW = 0;
      for (const c of contacts) {
        const w = itemW(c);
        const row = rows[rows.length - 1];
        if (row.length && rowW + sepW + w > areaW) {
          rows.push([c]);
          rowW = w;
        } else {
          rowW += (row.length ? sepW : 0) + w;
          row.push(c);
        }
      }
      const drawRows = () => {
        for (const row of rows) {
          const total = row.reduce((a, c, i) => a + itemW(c) + (i ? sepW : 0), 0);
          let x = align === 'center' ? left + (width - total) / 2 : left + pad;
          const y = doc.y;
          const lh = doc.currentLineHeight();
          if (!dry) {
            row.forEach((c, i) => {
              if (i) {
                if (!inlineIcons) doc.fillColor(contactColor).text(sep, x, y, { lineBreak: false });
                x += sepW;
              }
              const label = t(c.text);
              const w = itemW(c);
              if (inlineIcons) drawGlyph(doc, c.kind, x, y + (lh - iconSize) / 2 - 0.4, iconSize, contactColor);
              doc.fillColor(contactColor).text(label, x + iconW, y, { lineBreak: false });
              if (c.href) doc.link(x, y, w, lh, c.href);
              x += w;
            });
          }
          doc.y = y + doc.currentLineHeight(true);
        }
      };
      if (dry) drawRows();
      else
        block('contacts', 'Contact details', (fr) => {
          fitBox(fr, Math.max(...rows.map((row) => row.reduce((a, c, i) => a + itemW(c) + (i ? sepW : 0), 0))), areaW);
          drawRows();
        });
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
  if (badges.length) {
    // Top-right, centred on the name's first line. Each badge is its own movable block.
    const after = doc.y;
    const y = nameTop + (k(st.nameSize) * 1.2 - badgeSize) / 2;
    let x = right - pad - badgesW;
    for (const c of badges) {
      doc.y = y;
      const bx = x;
      block(`badge-${c.kind}`, `${BADGE_LABEL[c.kind]} icon`, (fr) => {
        fr.x = bx;
        fr.w = badgeSize;
        drawBadge(doc, c.kind, bx, y, badgeSize, accent, band);
        if (c.href) doc.link(bx, y, badgeSize, badgeSize, c.href);
        doc.y = y + badgeSize;
      });
      x += badgeSize + badgeGap;
    }
    doc.y = after;
  }
  doc.x = left;
  doc.fillColor(ink);

  // ---- Body. Block ids use each entry's index in the resume so a saved position follows its entry.
  const ne = nonEmpty(r);
  const summary = r.summary.trim();
  const exp = r.experience.map((e, i) => ({ e, i })).filter(({ e }) => e.jobTitle || e.company || e.description.some(Boolean));
  const projects = r.projects.map((pr, i) => ({ pr, i })).filter(({ pr }) => pr.name || pr.description.some(Boolean));
  const edu = r.education.map((e, i) => ({ e, i })).filter(({ e }) => e.institution || e.degree);
  const certs = r.certifications.map((c, i) => ({ c, i })).filter(({ c }) => c.name);
  const sections: Record<string, () => void> = {
    summary: () => summary && section('summary', SECTION_TITLES.summary, () => paragraph(summary, 'summary', 'Summary')),
    skills: () => ne.skills.length && section('skills', SECTION_TITLES.skills, () => paragraph(ne.skills.join('  •  '), 'skills', 'Skills list')),
    experience: () =>
      exp.length &&
      section('experience', SECTION_TITLES.experience, () => {
        for (const { e, i } of exp) {
          const dates = formatDateRange(e.startDate, e.endDate, e.current);
          const label = `Experience: ${short([e.jobTitle, e.company].filter(Boolean).join(', '))}`;
          if (!e.description.some(Boolean) && e.jobTitle && e.company) {
            // No bullets: one row ("Title · Company … dates") instead of two half-empty lines.
            doc.y += sp(st.entryGap);
            ensureSpace(k(st.titleSize) * 1.6);
            block(`exp-${i}`, label, () => {
              splitRow(`${e.jobTitle} · ${e.company}${e.location ? `, ${e.location}` : ''}`, F.semibold, k(st.titleSize), ink, nb(dates), F.regular, k(st.metaSize), muted);
              doc.y += sp(2.5);
            });
            continue;
          }
          entrySpace(e.description.some(Boolean));
          block(`exp-${i}`, label, () => {
            entryRows(e.jobTitle || e.company, dates, e.jobTitle ? e.company : '', e.location);
            e.description.forEach((b, j) => b && bullet(b, `exp-${i}-b${j}`));
          });
        }
      }),
    projects: () =>
      projects.length &&
      section('projects', SECTION_TITLES.projects, () => {
        for (const { pr, i } of projects) {
          const tech = pr.technologies.join(' · ');
          doc.font(F.regular).fontSize(k(st.metaSize));
          // Short tech lists sit on the title row (saves a line); long ones, or projects with a link, get their own line.
          const inlineTech = !pr.url && tech && doc.widthOfString(tech) < width * 0.45;
          entrySpace(pr.description.some(Boolean));
          block(`proj-${i}`, `Project: ${short(pr.name)}`, () => {
            entryRows(pr.name, inlineTech ? tech : pr.url ? displayUrl(pr.url) : '', inlineTech ? '' : tech, '');
            pr.description.forEach((b, j) => b && bullet(b, `proj-${i}-b${j}`));
          });
        }
      }),
    education: () =>
      edu.length &&
      section('education', SECTION_TITLES.education, () => {
        for (const { e, i } of edu) {
          const org = [e.degree || e.field ? e.institution : '', e.location].filter(Boolean).join(', ');
          entrySpace(false);
          block(`edu-${i}`, `Education: ${short(educationTitle(e))}`, () => entryRows(educationTitle(e), formatDateRange(e.startDate, e.endDate, false), org, nb(e.grade)));
        }
      }),
    certifications: () =>
      certs.length &&
      section('certifications', SECTION_TITLES.certifications, () => {
        for (const { c, i } of certs) bullet(certificationLine(c), `cert-${i}`);
      }),
  };
  (r.additionalSections ?? []).forEach((sct, i) => {
    sections[`extra-${i}`] = () => {
      const title = sct.title.trim();
      const items = sct.items.map((text, j) => ({ text: text.trim(), j })).filter((x) => x.text);
      if (!title || !items.length) return;
      section(`extra-${i}`, title, () => {
        // Lists of short items (languages, interests) read better inline than as a column of bullets.
        if (shortItems(items.map((x) => x.text))) paragraph(items.map((x) => x.text).join('  •  '), `extra-${i}`, short(title));
        else items.forEach((x) => bullet(x.text, `extra-${i}-b${x.j}`));
      });
    };
  });
  for (const key of sectionOrder(r)) sections[key]?.();

  const range = doc.bufferedPageRange();
  return { pages: range.count, free: Math.max(0, bottom() - doc.y), doc, boxes };
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
    return { buffer: await finish(l.doc), pages: l.pages, scale: f, spacing: s, fitted, boxes: l.boxes };
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

  const sections: Record<string, () => void> = {
    summary: () => {
      if (!r.summary.trim()) return;
      heading(SECTION_TITLES.summary);
      body(r.summary.trim());
    },
    skills: () => {
      if (!ne.skills.length) return;
      heading(SECTION_TITLES.skills);
      body(ne.skills.join('  •  '));
    },
    experience: () => {
      if (!ne.experience.length) return;
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
    },
    projects: () => {
      if (!ne.projects.length) return;
      heading(SECTION_TITLES.projects);
      for (const pr of ne.projects) {
        entry(pr.name, pr.url ? displayUrl(pr.url) : '', pr.technologies.join(' · '), '');
        pr.description.filter(Boolean).forEach(bullet);
      }
    },
    education: () => {
      if (!ne.education.length) return;
      heading(SECTION_TITLES.education);
      for (const e of ne.education) {
        entry(educationTitle(e), formatDateRange(e.startDate, e.endDate, false), [e.degree || e.field ? e.institution : '', e.location].filter(Boolean).join(', '), e.grade);
      }
    },
    certifications: () => {
      if (!ne.certifications.length) return;
      heading(SECTION_TITLES.certifications);
      for (const c of ne.certifications) bullet(certificationLine(c));
    },
  };
  (r.additionalSections ?? []).forEach((sct, i) => {
    sections[`extra-${i}`] = () => {
      const title = sct.title.trim();
      const items = sct.items.map((x) => x.trim()).filter(Boolean);
      if (!title || !items.length) return;
      heading(title);
      if (shortItems(items)) body(items.join('  •  '));
      else items.forEach(bullet);
    };
  });
  for (const key of sectionOrder(r)) sections[key]?.();

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
