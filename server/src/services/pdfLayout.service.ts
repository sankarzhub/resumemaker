import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { DocLine } from './parsing/docLines.js';

/*
 * Layout-aware PDF reading.
 *
 * We rebuild lines from text item positions (keeping font size and bold), then:
 * - split a row into separate "cells" when there is a wide horizontal gap (dates or locations sitting
 *   in their own column next to a title), and
 * - detect true two-column pages (a sidebar with its own section headings) and read each column top to
 *   bottom instead of row by row, which would otherwise interleave "SKILLS" with "EXPERIENCE".
 */

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
  bold: boolean;
}

interface Row {
  y: number;
  x: number;
  line: DocLine;
}

export interface PdfLayout {
  lines: DocLine[];
  pageCount: number;
  columnPages: number;
}

const require = createRequire(import.meta.url);
const STANDARD_FONTS = pathToFileURL(path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep).href;
const BOLD_FONT = /bold|black|heavy|semibold|demi/i;

function rowsOf(items: Item[], page: number): Row[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: Item[][] = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g[0].y - it.y) <= Math.max(2, Math.min(g[0].size, it.size) * 0.45)) g.push(it);
    else groups.push([it]);
  }
  const rows: Row[] = [];
  for (const g of groups) {
    g.sort((a, b) => a.x - b.x);
    // Split into cells at wide gaps.
    let cell: Item[] = [];
    const flush = () => {
      if (!cell.length) return;
      let text = '';
      let end = -Infinity;
      for (const it of cell) {
        const gap = it.x - end;
        const space = text && gap > it.size * 0.12 && !text.endsWith(' ') && !it.str.startsWith(' ');
        text += space ? ` ${it.str}` : it.str;
        end = it.x + it.w;
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (text) {
        const chars = cell.reduce((a, i) => a + i.str.trim().length, 0);
        const boldChars = cell.reduce((a, i) => a + (i.bold ? i.str.trim().length : 0), 0);
        const size = cell.reduce((a, i) => a + i.size * i.str.trim().length, 0) / Math.max(1, chars);
        rows.push({ y: cell[0].y, x: cell[0].x, line: { text, size, bold: boldChars >= chars * 0.8, page } });
      }
      cell = [];
    };
    let end = -Infinity;
    for (const it of g) {
      if (cell.length && it.x - end > Math.max(28, it.size * 3)) flush();
      cell.push(it);
      end = Math.max(end, it.x + it.w);
    }
    flush();
  }
  return rows;
}

/** Widest x-band (in the middle 60% of the page) that almost no text crosses, with real text on both sides. */
function findGutter(items: Array<{ x: number; w: number }>, pageWidth: number): number | null {
  const bins = new Array<number>(Math.ceil(pageWidth) + 2).fill(0);
  const narrow = items.filter((i) => i.w < pageWidth * 0.55);
  for (const it of narrow) {
    for (let x = Math.max(0, Math.floor(it.x)); x <= Math.min(bins.length - 1, Math.ceil(it.x + it.w)); x++) bins[x]++;
  }
  const tolerance = Math.max(1, Math.round(narrow.length * 0.02));
  const lo = Math.floor(pageWidth * 0.2);
  const hi = Math.ceil(pageWidth * 0.8);
  let best: { start: number; end: number } | null = null;
  let runStart = -1;
  for (let x = lo; x <= hi + 1; x++) {
    const free = x <= hi && bins[x] <= tolerance;
    if (free && runStart < 0) runStart = x;
    if (!free && runStart >= 0) {
      if (!best || x - runStart > best.end - best.start) best = { start: runStart, end: x };
      runStart = -1;
    }
  }
  if (!best || best.end - best.start < 10) return null;
  const mid = (best.start + best.end) / 2;
  const left = items.filter((i) => i.x + i.w <= mid).length;
  const right = items.filter((i) => i.x >= mid).length;
  if (left < items.length * 0.12 || right < items.length * 0.12) return null;
  return mid;
}

export async function extractPdfLayout(buf: Buffer, isHeading: (line: DocLine) => boolean): Promise<PdfLayout> {
  const doc = await getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: STANDARD_FONTS,
    verbosity: 0,
  }).promise;
  try {
    const lines: DocLine[] = [];
    let columnPages = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const width = page.getViewport({ scale: 1 }).width;
      // Loading the operator list resolves font objects, which carry the real font name (e.g. "Arial-BoldMT").
      await page.getOperatorList();
      const content = await page.getTextContent();
      const fontBold = new Map<string, boolean>();
      const items: Item[] = [];
      for (const raw of content.items) {
        if (!('str' in raw) || !raw.str.trim()) continue;
        if (!fontBold.has(raw.fontName)) {
          let bold = false;
          try {
            const font = page.commonObjs.get(raw.fontName) as { name?: string; bold?: boolean } | undefined;
            bold = Boolean(font?.bold) || BOLD_FONT.test(font?.name ?? '');
          } catch {
            bold = false;
          }
          fontBold.set(raw.fontName, bold);
        }
        items.push({
          str: raw.str,
          x: raw.transform[4],
          y: raw.transform[5],
          w: raw.width,
          size: Math.hypot(raw.transform[2], raw.transform[3]) || 10,
          bold: fontBold.get(raw.fontName)!,
        });
      }
      page.cleanup();

      const gutter = findGutter(items, width);
      if (gutter !== null) {
        const crossing = rowsOf(items.filter((i) => i.x < gutter && i.x + i.w > gutter), p);
        const left = rowsOf(items.filter((i) => i.x + i.w <= gutter), p);
        const right = rowsOf(items.filter((i) => i.x >= gutter), p);
        if (left.some((r) => isHeading(r.line)) && right.some((r) => isHeading(r.line))) {
          columnPages++;
          // Lines spanning both columns (name, contact bar) above the columns come first.
          const top = Math.max(left[0]?.y ?? -Infinity, right[0]?.y ?? -Infinity);
          const above = crossing.filter((r) => r.y >= top - 1);
          const below = crossing.filter((r) => r.y < top - 1);
          lines.push(...[...above, ...left, ...right, ...below].map((r) => r.line));
          continue;
        }
      }
      // Single column: keep reading order (top to bottom, cells left to right).
      lines.push(...rowsOf(items, p).map((r) => r.line));
    }
    return { lines, pageCount: doc.numPages, columnPages };
  } finally {
    await doc.destroy();
  }
}
