import mammoth from 'mammoth';
import type { DocLine } from './docLines.js';

/*
 * DOCX → lines using mammoth's HTML (not raw text) so we keep structure:
 * Word headings, bold paragraphs, list items (as "• " bullets, including nested lists) and tables.
 * Table cells are emitted cell by cell, row by row, which reads two-column table templates one column
 * at a time.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const BLOCK = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'tr', 'table', 'ul', 'ol', 'div', 'blockquote']);

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, n: string) => ENTITIES[n] ?? m);
}

export function htmlToLines(html: string): DocLine[] {
  const lines: DocLine[] = [];
  const stack: string[] = [];
  let text = '';
  let boldChars = 0;
  let boldDepth = 0;
  let pendingBullet = false;

  const flush = () => {
    const t = decode(text).replace(/\s+/g, ' ').trim();
    if (t) {
      const letters = t.replace(/\s/g, '').length;
      lines.push({
        text: (pendingBullet ? '• ' : '') + t,
        bold: boldChars >= letters * 0.8,
        heading: stack.some((s) => /^h[1-6]$/.test(s)),
      });
      pendingBullet = false;
    }
    text = '';
    boldChars = 0;
  };

  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)[^>]*?(\/?)>|([^<]+)/gi)) {
    if (m[4] !== undefined) {
      text += m[4];
      if (boldDepth > 0) boldChars += decode(m[4]).replace(/\s/g, '').length;
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'br') {
      flush();
      continue;
    }
    if (tag === 'strong' || tag === 'b') {
      boldDepth += closing ? -1 : 1;
      boldDepth = Math.max(0, boldDepth);
      continue;
    }
    if (!BLOCK.has(tag)) continue;
    flush();
    if (closing) {
      const idx = stack.lastIndexOf(tag);
      if (idx >= 0) stack.splice(idx);
    } else {
      stack.push(tag);
      if (tag === 'li') pendingBullet = true;
    }
  }
  flush();
  return lines;
}

export async function docxLines(buf: Buffer): Promise<DocLine[]> {
  const { value } = await mammoth.convertToHtml({ buffer: buf });
  const lines = htmlToLines(value);
  if (lines.length) return lines;
  // Some generators produce text mammoth only exposes via raw extraction.
  const raw = await mammoth.extractRawText({ buffer: buf });
  return raw.value.split('\n').map((t) => ({ text: t }));
}
