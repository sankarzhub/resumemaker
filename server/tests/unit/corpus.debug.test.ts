import { it } from 'vitest';
import fs from 'node:fs';
import { extractLines, parseResumeFile, structureResumeText } from '../../src/services/resumeParser.service.js';
import { dateGutterPdf, ICONS_TXT, INDIAN_FRESHER_TXT, linkedinLikePdf, rightAlignedDatesPdf, SPACED_HEADINGS_TXT, tableTwoColumnDocx, US_STYLE_TXT } from '../corpus.js';
import { rightSidebarResumePdf, twoColumnResumePdf } from '../pdfFixtures.js';

// Writes parsed output for each corpus document when CORPUS_DEBUG_DIR is set. Not an assertion test.
const dir = process.env.CORPUS_DEBUG_DIR;

it.runIf(Boolean(dir))('dump corpus parse results', async () => {
  const files: Array<[string, Buffer, string]> = [
    ['twocol', await twoColumnResumePdf(), 'a.pdf'],
    ['right', await rightSidebarResumePdf(), 'a.pdf'],
    ['gutter', await dateGutterPdf(), 'a.pdf'],
    ['linkedin', await linkedinLikePdf(), 'Profile.pdf'],
    ['rightdates', await rightAlignedDatesPdf(), 'a.pdf'],
    ['tabledocx', await tableTwoColumnDocx(), 'a.docx'],
  ];
  for (const [name, buf, fn] of files) {
    const kind = fn.endsWith('.docx') ? 'docx' : 'pdf';
    const { lines } = await extractLines(buf, kind);
    const r = await parseResumeFile(buf, fn);
    fs.writeFileSync(`${dir}/${name}.txt`, lines.map((l) => `${l.bold ? 'B' : ' '}${l.heading ? 'H' : ' '} ${(l.size ?? 0).toFixed(1)} ${l.text}`).join('\n') + '\n\n' + JSON.stringify(r.content, null, 1));
  }
  for (const [name, text] of [['fresher', INDIAN_FRESHER_TXT], ['us', US_STYLE_TXT], ['icons', ICONS_TXT], ['spaced', SPACED_HEADINGS_TXT]] as const) {
    const r = structureResumeText(text);
    fs.writeFileSync(`${dir}/${name}.txt`, JSON.stringify({ notes: r.notes, warnings: r.warnings, content: r.content }, null, 1));
  }
});
