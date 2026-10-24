import { PDFParse } from 'pdf-parse';
import { AppError } from '../utils/AppError.js';
import type { ResumeContent } from '../types/resume.js';
import { extractPdfLayout } from './pdfLayout.service.js';
import { docxLines } from './parsing/docxLines.js';
import { linesFromText, linesToText, type DocLine } from './parsing/docLines.js';
import { detectHeading } from './parsing/sections.js';
import { structureLines } from './parsing/structure.js';

export type FileKind = 'pdf' | 'docx' | 'txt' | 'image';
export type DocRole = 'resume' | 'linkedin' | 'other';
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ParseResult {
  content: ResumeContent;
  rawText: string;
  warnings: string[];
  notes: string[];
  detectedSections: string[];
  fileKind: FileKind;
  role: DocRole;
  /** No usable text layer (scanned PDF or photo). Only an AI with vision can read it. */
  scanned: boolean;
  mediaType?: 'application/pdf' | ImageMediaType;
}

const MIN_TEXT_CHARS = 80;

/** LinkedIn "Save to PDF" exports: profile URL + "Top Skills" sidebar or "Page N of M" footers. */
export function guessDocRole(text: string, filename: string): DocRole {
  const linkedinUrl = /linkedin\.com\/in\//i.test(text);
  const linkedinShape = /^\s*(Top Skills|Page \d+ of \d+)\s*$/im.test(text);
  if ((linkedinUrl && linkedinShape) || /linkedin/i.test(filename)) return 'linkedin';
  return 'resume';
}

/** Identify the file by its bytes, not just its name or the client-sent MIME type. */
export function detectFileKind(buf: Buffer, filename: string): { kind: FileKind; mediaType?: ParseResult['mediaType'] } {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const mismatch = () => new AppError(400, 'FILE_MISMATCH', `"${filename}": the file content does not match its extension.`);
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    if (ext !== 'pdf') throw mismatch();
    return { kind: 'pdf', mediaType: 'application/pdf' };
  }
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    if (ext !== 'docx') throw mismatch();
    return { kind: 'docx' };
  }
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    throw new AppError(400, 'OLD_WORD_FORMAT', `"${filename}" is an old Word (.doc) file. Open it in Word or Google Docs and save it as .docx or PDF, then upload again.`);
  }
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') {
    if (ext !== 'png') throw mismatch();
    return { kind: 'image', mediaType: 'image/png' };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    if (ext !== 'jpg' && ext !== 'jpeg') throw mismatch();
    return { kind: 'image', mediaType: 'image/jpeg' };
  }
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    if (ext !== 'webp') throw mismatch();
    return { kind: 'image', mediaType: 'image/webp' };
  }
  if (ext === 'txt' || ext === 'md') {
    // Reject binary data masquerading as text.
    if (buf.subarray(0, 4096).includes(0) && !isUtf16(buf)) throw new AppError(400, 'INVALID_FILE', `"${filename}" appears to contain binary data, not text.`);
    return { kind: 'txt' };
  }
  throw new AppError(400, 'INVALID_FILE', `"${filename}" is not a supported document. Upload a PDF, DOCX, TXT or an image (PNG/JPG).`);
}

function isUtf16(buf: Buffer) {
  return (buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff);
}

function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  return buf.toString('utf8').replace(/^﻿/, '');
}

const isHeadingLine = (l: DocLine) => detectHeading(l, {}) !== null;

/** Extract layout-aware lines. PDFs keep font size/bold and are read column by column when needed. */
export async function extractLines(buf: Buffer, kind: FileKind): Promise<{ lines: DocLine[]; columnPages?: number; pageCount?: number }> {
  try {
    if (kind === 'pdf') {
      try {
        const layout = await extractPdfLayout(buf, isHeadingLine);
        return { lines: cleanLines(layout.lines), columnPages: layout.columnPages, pageCount: layout.pageCount };
      } catch {
        // Fall back to the plain text extractor for PDFs pdf.js layout reading can't handle.
        const parser = new PDFParse({ data: new Uint8Array(buf) });
        try {
          return { lines: cleanLines(linesFromText((await parser.getText()).text)) };
        } finally {
          await parser.destroy();
        }
      }
    }
    if (kind === 'docx') return { lines: cleanLines(await docxLines(buf)) };
    if (kind === 'txt') return { lines: cleanLines(linesFromText(decodeText(buf))) };
    return { lines: [] };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(422, 'PARSE_FAILED', 'We could not read this file. It may be corrupted or password-protected.');
  }
}

export async function extractText(buf: Buffer, kind: FileKind): Promise<string> {
  return linesToText((await extractLines(buf, kind)).lines);
}

export async function parseResumeFile(buf: Buffer, filename: string, opts: { allowScanned?: boolean } = {}): Promise<ParseResult> {
  const { kind, mediaType } = detectFileKind(buf, filename);
  const { lines, columnPages } = await extractLines(buf, kind);
  const text = linesToText(lines);
  const scanned = text.replace(/\s/g, '').length < MIN_TEXT_CHARS;
  if (scanned) {
    if (!opts.allowScanned) {
      throw new AppError(
        422,
        'NO_TEXT',
        kind === 'image'
          ? `"${filename}" is an image. Reading images needs the AI option. Otherwise upload a PDF or DOCX of your resume.`
          : kind === 'pdf'
            ? `"${filename}" has almost no selectable text. It looks like a scanned or image-only PDF, which ATS systems can't read either. Upload a text-based PDF or DOCX, or turn on the AI option to read it.`
            : `"${filename}" contains too little text to build a resume from.`,
      );
    }
    return { content: structureLines([]).content, rawText: text, warnings: [], notes: [], detectedSections: [], fileKind: kind, role: guessDocRole(text, filename), scanned: true, mediaType };
  }
  const role = guessDocRole(text, filename);
  const s = structureLines(lines, { linkedin: role === 'linkedin' });
  if (columnPages) s.notes.unshift('Detected a multi-column layout and read each column separately.');
  return { ...s, rawText: text, fileKind: kind, role, scanned: false, mediaType };
}

/** For pasted text. */
export function structureResumeText(text: string, opts: { linkedin?: boolean } = {}) {
  const clean = cleanExtractedText(text);
  return structureLines(linesFromText(clean), { linkedin: opts.linkedin ?? guessDocRole(text, '') === 'linkedin' });
}

// "-- 1 of 2 --", "Page 1 of 2", "1 / 2". Small numbers only, so dates like "2022/03" survive.
const PAGE_MARKER = /^(?:-- \d{1,3} of \d{1,3} --|page \d{1,3}( of \d{1,3})?|\d{1,2}\s*\/\s*\d{1,2})$/i;
// LinkedIn durations: "(2 years 3 months)" after a date, or a lone "1 year 4 months" line for grouped roles.
const DURATION_SUFFIX = /\s*\((?:less than a year|\d+\s+yrs?|\d+\s+years?|\d+\s+mos?|\d+\s+months?|\s)+\)\s*$/i;
const DURATION_LINE = /^(?:\d+\s+(?:years?|yrs?)\s*)?(?:\d+\s+(?:months?|mos?))?$/i;

function cleanLines(lines: DocLine[]): DocLine[] {
  return lines
    .map((l) => ({
      ...l,
      text: l.text
        .replace(/ /g, ' ')
        .replace(/[​-‍﻿]/g, '')
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(DURATION_SUFFIX, '')
        .replace(/[ \t]+/g, ' ')
        .trim(),
    }))
    .filter((l) => l.text && !PAGE_MARKER.test(l.text) && !DURATION_LINE.test(l.text) && l.text !== '(LinkedIn)');
}

export function cleanExtractedText(text: string): string {
  return cleanLines(linesFromText(text.replace(/\r\n?/g, '\n')))
    .map((l) => l.text)
    .join('\n');
}
