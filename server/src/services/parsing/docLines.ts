/** One visual line of a document, with whatever style hints the format gives us. */
export interface DocLine {
  text: string;
  /** Font size in points (PDF only). */
  size?: number;
  /** Whole line is bold (PDF font name, DOCX <strong>). */
  bold?: boolean;
  /** Explicit heading from the document structure (DOCX Heading 1-6). */
  heading?: boolean;
  /** 1-based page number (PDF only). */
  page?: number;
}

export function linesFromText(text: string): DocLine[] {
  return text.split('\n').map((t) => ({ text: t }));
}

export function linesToText(lines: DocLine[]): string {
  return lines.map((l) => l.text).join('\n');
}

/** Font size used by most characters: the document's body size. */
export function bodyFontSize(lines: DocLine[]): number | undefined {
  const weights = new Map<number, number>();
  for (const l of lines) {
    if (!l.size) continue;
    const s = Math.round(l.size * 2) / 2;
    weights.set(s, (weights.get(s) ?? 0) + l.text.length);
  }
  let best: number | undefined;
  let max = 0;
  for (const [s, w] of weights) if (w > max) [best, max] = [s, w];
  return best;
}
