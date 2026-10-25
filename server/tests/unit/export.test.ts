import { describe, expect, it } from 'vitest';
import mammoth from 'mammoth';
import { exportFilename, renderResumeDocx, renderResumePdf, renderResumePdfDetailed, TEMPLATE_IDS } from '../../src/services/export.service.js';
import { extractText } from '../../src/services/resumeParser.service.js';
import { sampleResume } from '../fixtures.js';

describe('export service', () => {
  it('produces a PDF with selectable text for every approved section', async () => {
    const pdf = await renderResumePdf(sampleResume(), 'modern');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = await extractText(pdf, 'pdf');
    for (const s of ['Priya Raman', 'Professional Summary', 'Skills', 'Work Experience', 'Projects', 'Education', 'Certifications', 'Jun 2022 - Present', 'Acme Fintech Pvt Ltd', 'linkedin.com/in/priya-raman-demo']) {
      expect(text.toLowerCase()).toContain(s.toLowerCase());
    }
  });

  it('supports multi-page resumes without dropping content', async () => {
    const r = sampleResume();
    r.experience = Array.from({ length: 14 }, (_, i) => ({ ...r.experience[0], company: `Company ${i + 1}`, description: [...r.experience[0].description, ...r.experience[0].description] }));
    const pdf = await renderResumePdf(r, 'classic');
    const text = await extractText(pdf, 'pdf');
    expect(text).toContain('Company 1');
    expect(text).toContain('Company 14');
    expect(text).toContain('Certifications'.toUpperCase());
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });

  it('produces a DOCX containing all sections and links', async () => {
    const buf = await renderResumeDocx(sampleResume(), 'classic');
    expect(buf[0]).toBe(0x50);
    const { value } = await mammoth.extractRawText({ buffer: buf });
    for (const s of ['Priya Raman', 'PROFESSIONAL SUMMARY', 'WORK EXPERIENCE', 'Reduced API response time by 40%', 'Anna University', 'AWS Certified Cloud Practitioner']) {
      expect(value).toContain(s);
    }
  });

  it('handles characters outside the standard PDF font', async () => {
    const r = sampleResume();
    r.experience[0].description[0] = 'Saved ₹2 lakh per month in cloud costs';
    const text = await extractText(await renderResumePdf(r), 'pdf');
    expect(text).toContain('Saved INR 2 lakh');
  });

  it('never overlaps text on a line, in any template (centered contact bar regression)', async () => {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    for (const template of TEMPLATE_IDS) {
      const pdf = await renderResumePdf(sampleResume(), template);
      const doc = await getDocument({ data: new Uint8Array(pdf), verbosity: 0 }).promise;
      const items = (await (await doc.getPage(1)).getTextContent()).items.flatMap((i) => ('str' in i && i.str.trim() ? [{ x: i.transform[4], y: Math.round(i.transform[5]), w: i.width }] : []));
      const rows = new Map<number, typeof items>();
      for (const it of items) rows.set(it.y, [...(rows.get(it.y) ?? []), it]);
      for (const row of rows.values()) {
        row.sort((a, b) => a.x - b.x);
        for (let i = 1; i < row.length; i++) expect(row[i].x).toBeGreaterThanOrEqual(row[i - 1].x + row[i - 1].w - 0.5);
      }
      await doc.destroy();
    }
  });

  it('renders every template as single-column ATS text with all sections, in PDF and DOCX', async () => {
    for (const template of TEMPLATE_IDS) {
      const text = await extractText(await renderResumePdf(sampleResume(), template), 'pdf');
      for (const s of ['Work Experience', 'Education', 'Skills', 'Acme Fintech Pvt Ltd', 'Jun 2022 - Present', 'priya.raman@example.com']) {
        expect(text.toLowerCase()).toContain(s.toLowerCase());
      }
      const { value } = await mammoth.extractRawText({ buffer: await renderResumeDocx(sampleResume(), template) });
      expect(value).toContain('Acme Fintech Pvt Ltd');
    }
  });

  it('fits a long resume onto one page when asked, without going below readable sizes', async () => {
    const r = sampleResume();
    r.experience = [...r.experience, ...r.experience.map((e) => ({ ...e, company: `${e.company} II` }))];
    r.certifications = Array.from({ length: 9 }, (_, i) => ({ name: `Certificate number ${i + 1}`, issuer: 'Demo Academy', date: '2023', url: '' }));
    r.additionalSections = [{ title: 'Activities', items: ['Organised a coding club for 60 students', 'Volunteered at a local NGO teaching basic computing'] }];
    const normal = await renderResumePdfDetailed(r, 'classic');
    expect(normal.pages).toBe(2);
    const fit = await renderResumePdfDetailed(r, 'classic', { fitToPage: true });
    expect(fit).toMatchObject({ pages: 1, fitted: true });
    expect(fit.scale).toBeGreaterThanOrEqual(0.85);
    const text = await extractText(fit.buffer, 'pdf');
    expect(text).toContain('Certificate number 9');
  });

  it('reports honestly when even the smallest readable size needs two pages', async () => {
    const r = sampleResume();
    r.experience = Array.from({ length: 12 }, (_, i) => ({ ...r.experience[0], company: `Company ${i}` }));
    const fit = await renderResumePdfDetailed(r, 'classic', { fitToPage: true });
    expect(fit.fitted).toBe(false);
    expect(fit.pages).toBeGreaterThan(1);
    expect(fit.scale * 10).toBeGreaterThanOrEqual(8.5);
  });

  it('every template (normal and fit-to-page) reads back correctly through a parser, like an ATS would', async () => {
    const { parseResumeFile } = await import('../../src/services/resumeParser.service.js');
    for (const template of TEMPLATE_IDS) {
      for (const fitToPage of [false, true]) {
        const r = await parseResumeFile(await renderResumePdf(sampleResume(), template, { fitToPage }), 'export.pdf');
        const c = r.content;
        expect(c.personalInfo, `${template} fit=${fitToPage}`).toMatchObject({ fullName: 'Priya Raman', email: 'priya.raman@example.com' });
        expect(c.experience.map((e) => [e.jobTitle, e.company, e.startDate]), `${template} fit=${fitToPage}`).toEqual([
          ['Software Engineer', 'Acme Fintech Pvt Ltd', 'Jun 2022'],
          ['Junior Developer', 'Bright Apps', 'Jan 2021'],
        ]);
        expect(c.experience[0].description, template).toHaveLength(3);
        expect(c.skills, template).toEqual(expect.arrayContaining(['React', 'Node.js', 'MongoDB']));
        expect(c.education[0], template).toMatchObject({ institution: 'Anna University', endDate: '2020' });
        expect(r.detectedSections, template).toEqual(expect.arrayContaining(['summary', 'skills', 'experience', 'projects', 'education', 'certifications']));
      }
    }
  });

  it('renders additional sections', async () => {
    const text = await extractText(await renderResumePdf(sampleResume()), 'pdf');
    expect(text).toContain('ACHIEVEMENTS');
    expect(text).toContain('Won first place at a state-level hackathon');
  });

  it('renders a resume with no name without crashing', async () => {
    const r = sampleResume();
    r.personalInfo.fullName = '';
    expect((await renderResumePdf(r)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('builds a safe filename', () => {
    expect(exportFilename(sampleResume(), 'pdf')).toBe('Priya_Raman_Resume.pdf');
  });

  it('prints sections in the saved order, in both PDF and DOCX', async () => {
    const r = { ...sampleResume(), layout: { contactIcons: 'none' as const, offsets: {}, sectionOrder: ['education', 'projects'] } };
    const text = await extractText(await renderResumePdf(r, 'classic'), 'pdf');
    const at = (s: string) => text.toUpperCase().indexOf(s);
    expect(at('EDUCATION')).toBeLessThan(at('PROJECTS'));
    expect(at('PROJECTS')).toBeLessThan(at('PROFESSIONAL SUMMARY'));
    const docx = (await mammoth.extractRawText({ buffer: await renderResumeDocx(r, 'classic') })).value.toUpperCase();
    expect(docx.indexOf('EDUCATION')).toBeLessThan(docx.indexOf('PROFESSIONAL SUMMARY'));
  });

  it('reports movable blocks and keeps text readable when moved blocks cross a page break', async () => {
    const r = sampleResume();
    r.experience = Array.from({ length: 12 }, (_, i) => ({ ...r.experience[0], company: `Company ${i + 1}`, description: [...r.experience[0].description, ...r.experience[0].description] }));
    const moved = { ...r, layout: { contactIcons: 'badges' as const, offsets: { 'sec-experience': { x: 4, y: 6 }, 'exp-0': { x: 10, y: 0 } }, sectionOrder: [] } };
    const out = await renderResumePdfDetailed(moved, 'classic');
    expect(out.pages).toBeGreaterThan(1);
    const sec = out.boxes.filter((b) => b.id === 'sec-experience');
    expect(sec.length).toBeGreaterThan(1); // one box per page it spans
    expect(out.boxes.find((b) => b.id === 'exp-0')).toMatchObject({ parent: 'sec-experience', ox: 10, oy: 0 });
    const text = await extractText(out.buffer, 'pdf');
    expect(text).toContain('Company 12');
    expect(text).toContain('Company 1');
  });

});
