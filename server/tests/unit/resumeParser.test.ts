import { describe, expect, it } from 'vitest';
import { Document, Packer, Paragraph } from 'docx';
import { detectFileKind, parseResumeFile, structureResumeText } from '../../src/services/resumeParser.service.js';
import { renderResumePdf } from '../../src/services/export.service.js';
import { AppError } from '../../src/utils/AppError.js';
import { emptyResumeContent } from '../../src/types/resume.js';
import { SAMPLE_RESUME_TEXT, sampleResume } from '../fixtures.js';

describe('structureResumeText', () => {
  const { content, detectedSections } = structureResumeText(SAMPLE_RESUME_TEXT);

  it('detects standard sections', () => {
    expect(detectedSections).toEqual(expect.arrayContaining(['summary', 'skills', 'experience', 'projects', 'education', 'certifications']));
  });

  it('extracts contact details', () => {
    expect(content.personalInfo.fullName).toBe('Priya Raman');
    expect(content.personalInfo.email).toBe('priya.raman@example.com');
    expect(content.personalInfo.phone).toContain('98765');
    expect(content.personalInfo.linkedin).toContain('linkedin.com/in/priya-raman-demo');
    expect(content.personalInfo.github).toContain('github.com/priya-demo');
    expect(content.personalInfo.location).toBe('Chennai, India');
    expect(content.targetJobTitle).toBe('Full Stack Developer');
  });

  it('extracts skills with canonical names and no duplicates', () => {
    expect(content.skills).toEqual(expect.arrayContaining(['JavaScript', 'TypeScript', 'React', 'Node.js', 'MongoDB', 'Docker']));
    expect(new Set(content.skills.map((s) => s.toLowerCase())).size).toBe(content.skills.length);
  });

  it('separates experience entries with titles, companies, dates and bullets', () => {
    expect(content.experience).toHaveLength(2);
    const [first, second] = content.experience;
    expect(first).toMatchObject({ jobTitle: 'Software Engineer', company: 'Acme Fintech Pvt Ltd', startDate: 'Jun 2022', current: true });
    expect(first.description).toHaveLength(3);
    expect(second).toMatchObject({ jobTitle: 'Junior Developer', company: 'Bright Apps', startDate: 'Jan 2021', endDate: 'May 2022' });
  });

  it('parses education and projects', () => {
    expect(content.education[0]).toMatchObject({ degree: 'B.E.', field: 'Computer Science', institution: 'Anna University', startDate: '2016', endDate: '2020' });
    expect(content.education[0].grade).toContain('8.4');
    expect(content.projects[0].name).toBe('Resume Analyzer');
    expect(content.projects[0].technologies).toEqual(expect.arrayContaining(['React', 'Node.js', 'MongoDB']));
  });

  it('splits "Title | Company" even when a location line follows', () => {
    const r = structureResumeText('EXPERIENCE\nData Analyst | Demo Retail\nPune, India\nJan 2022 - Dec 2023\n- Analyzed sales data for 40 stores');
    expect(r.content.experience[0]).toMatchObject({ jobTitle: 'Data Analyst', company: 'Demo Retail', location: 'Pune, India', startDate: 'Jan 2022' });
  });

  it('warns when no headings are present', () => {
    const r = structureResumeText('John Demo\njohn@example.com\nI have worked on many things over many years in different places doing various tasks.');
    expect(r.warnings.join(' ')).toMatch(/No standard section headings/);
  });
});

describe('file handling', () => {
  it('rejects files whose content does not match the extension', () => {
    expect(() => detectFileKind(Buffer.from('%PDF-1.7 ...'), 'resume.docx')).toThrow(AppError);
    expect(() => detectFileKind(Buffer.from('MZ\x90\x00 binary'), 'resume.pdf')).toThrow(/not a supported document/);
    expect(() => detectFileKind(Buffer.from([0x41, 0x00, 0x42]), 'notes.txt')).toThrow(/binary/);
  });

  it('parses a DOCX file', async () => {
    const doc = new Document({ sections: [{ children: SAMPLE_RESUME_TEXT.split('\n').map((l) => new Paragraph(l)) }] });
    const buf = await Packer.toBuffer(doc);
    const result = await parseResumeFile(buf, 'resume.docx');
    expect(result.fileKind).toBe('docx');
    expect(result.content.personalInfo.email).toBe('priya.raman@example.com');
    expect(result.content.experience.length).toBe(2);
  });

  it('round-trips our own exported PDF: the export is machine-readable', async () => {
    const pdf = await renderResumePdf(sampleResume(), 'classic');
    const result = await parseResumeFile(pdf, 'export.pdf');
    expect(result.fileKind).toBe('pdf');
    expect(result.detectedSections).toEqual(expect.arrayContaining(['summary', 'skills', 'experience', 'education']));
    expect(result.content.personalInfo.email).toBe('priya.raman@example.com');
    expect(result.content.experience.length).toBe(2);
    expect(result.content.skills).toEqual(expect.arrayContaining(['React', 'Node.js']));
  });

  it('rejects a corrupted PDF safely', async () => {
    await expect(parseResumeFile(Buffer.from('%PDF-1.4 garbage garbage'), 'bad.pdf')).rejects.toBeInstanceOf(AppError);
  });

  it('explains when a PDF has no extractable text (scanned)', async () => {
    // A PDF whose only text is a two-word name stands in for an image-only scan.
    const r = { ...emptyResumeContent(), personalInfo: { ...emptyResumeContent().personalInfo, fullName: 'Scan' } };
    const blank = await renderResumePdf(r, 'classic');
    await expect(parseResumeFile(blank, 'scan.pdf')).rejects.toMatchObject({ code: 'NO_TEXT' });
  });
});
