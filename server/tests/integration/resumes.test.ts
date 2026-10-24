import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Document, Packer, Paragraph } from 'docx';
import mammoth from 'mammoth';
import { connectTestDb, disconnectTestDb, FakeAi, makeApp, registerAgent } from '../helpers.js';
import { SAMPLE_JD, SAMPLE_LINKEDIN_TEXT, SAMPLE_RESUME_TEXT, sampleResume } from '../fixtures.js';
import { Analysis } from '../../src/models/Analysis.js';
import { ClaudeResumeService } from '../../src/services/aiResume.service.js';
import { extractText } from '../../src/services/resumeParser.service.js';

const ai = new FakeAi();
const app = makeApp(ai);
let A: Awaited<ReturnType<typeof registerAgent>>;
let B: Awaited<ReturnType<typeof registerAgent>>;
let resumeId: string;

beforeAll(async () => {
  await connectTestDb('resumes');
  A = await registerAgent(app, 'a@example.com');
  B = await registerAgent(app, 'b@example.com');
});
afterAll(() => disconnectTestDb());

const post = (who: typeof A, url: string) => who.agent.post(url).set('x-csrf-token', who.csrf);
const patch = (who: typeof A, url: string) => who.agent.patch(url).set('x-csrf-token', who.csrf);
const del = (who: typeof A, url: string) => who.agent.delete(url).set('x-csrf-token', who.csrf);

describe('resume CRUD', () => {
  it('validates create input', async () => {
    const res = await post(A, '/api/resumes').send({ title: '' });
    expect(res.status).toBe(400);
    const badEmail = await post(A, '/api/resumes').send({ title: 'x', personalInfo: { email: 'nope' } });
    expect(badEmail.status).toBe(400);
  });

  it('creates and reads a resume', async () => {
    const { ...content } = sampleResume();
    const res = await post(A, '/api/resumes').send({ title: 'Developer resume', ...content });
    expect(res.status).toBe(201);
    resumeId = res.body.data.id;
    const got = await A.agent.get(`/api/resumes/${resumeId}`);
    expect(got.status).toBe(200);
    expect(got.body.data.experience).toHaveLength(2);
    expect(got.body.data.personalInfo.fullName).toBe('Priya Raman');
  });

  it('updates fields and persists them', async () => {
    const res = await patch(A, `/api/resumes/${resumeId}`).send({ title: 'Renamed', personalInfo: { phone: '+91 90000 00000' }, templateId: 'modern' });
    expect(res.status).toBe(200);
    const got = await A.agent.get(`/api/resumes/${resumeId}`);
    expect(got.body.data).toMatchObject({ title: 'Renamed', templateId: 'modern' });
    expect(got.body.data.personalInfo).toMatchObject({ phone: '+91 90000 00000', fullName: 'Priya Raman' });
  });

  it('lists with pagination and an estimated score', async () => {
    const res = await A.agent.get('/api/resumes?page=1&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0]).toMatchObject({ title: 'Renamed' });
    expect(res.body.data.items[0].score).toBeGreaterThan(50);
  });

  it('duplicates a resume', async () => {
    const res = await post(A, `/api/resumes/${resumeId}/duplicate`);
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Renamed (copy)');
    expect(res.body.data.id).not.toBe(resumeId);
  });

  it("prevents user B from reading, modifying or deleting user A's resume", async () => {
    expect((await B.agent.get(`/api/resumes/${resumeId}`)).status).toBe(404);
    expect((await patch(B, `/api/resumes/${resumeId}`).send({ title: 'hacked' })).status).toBe(404);
    expect((await del(B, `/api/resumes/${resumeId}`)).status).toBe(404);
    expect((await post(B, `/api/resumes/${resumeId}/analyze`).send({})).status).toBe(404);
    expect((await B.agent.get(`/api/resumes/${resumeId}/export?format=pdf`)).status).toBe(404);
    expect((await B.agent.get('/api/resumes')).body.data.total).toBe(0);
    expect((await A.agent.get(`/api/resumes/${resumeId}`)).body.data.title).toBe('Renamed');
  });

  it('returns 404 for invalid ids', async () => {
    expect((await A.agent.get('/api/resumes/not-an-id')).status).toBe(404);
  });
});

describe('analysis and job matching', () => {
  let analysisId: string;

  it('runs quality checks and stores the analysis', async () => {
    const res = await post(A, `/api/resumes/${resumeId}/analyze`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.scoreType).toBe('estimated');
    expect(res.body.data.breakdown.length).toBe(6);
    analysisId = res.body.data.analysisId;
  });

  it('job-matches against a pasted description', async () => {
    const res = await post(A, `/api/resumes/${resumeId}/job-match`).send({ jobDescription: SAMPLE_JD });
    expect(res.status).toBe(200);
    expect(res.body.data.matchedSkills).toContain('React');
    expect(res.body.data.missingSkills).toContain('GraphQL');
    const short = await post(A, `/api/resumes/${resumeId}/job-match`).send({ jobDescription: 'too short' });
    expect(short.status).toBe(400);
  });

  it('lets only the owner read a saved analysis', async () => {
    expect((await A.agent.get(`/api/analyses/${analysisId}`)).status).toBe(200);
    expect((await B.agent.get(`/api/analyses/${analysisId}`)).status).toBe(404);
  });

  it('keeps only the newest 20 reports per resume so the database does not fill up', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await post(A, `/api/resumes/${resumeId}/job-match`).send({ jobDescription: `${SAMPLE_JD}\nRun ${i}` });
      expect(res.status).toBe(200);
      ids.push(res.body.data.analysisId);
    }
    expect(await Analysis.countDocuments({ resumeId })).toBe(20);
    const kept = (await A.agent.get(`/api/resumes/${resumeId}/analyses`)).body.data.items.map((a: { _id: string }) => a._id);
    expect(kept).toEqual(ids.slice(-20).reverse());
    expect((await A.agent.get(`/api/analyses/${ids[0]}`)).status).toBe(404);
  });
});

describe('AI suggestions', () => {
  it('returns suggestions without saving anything', async () => {
    const before = (await A.agent.get(`/api/resumes/${resumeId}`)).body.data.summary;
    const res = await post(A, `/api/resumes/${resumeId}/improve`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.suggestions[0]).toMatchObject({ section: 'summary', suggested: 'A sharper summary.' });
    expect((await A.agent.get(`/api/resumes/${resumeId}`)).body.data.summary).toBe(before);
  });

  it('fails gracefully when AI is unavailable, while deterministic checks still work', async () => {
    const noAi = makeApp(new ClaudeResumeService(undefined, 'claude-opus-5-5'));
    const { agent, csrf } = await registerAgent(noAi, 'noai@example.com');
    const created = await agent.post('/api/resumes').set('x-csrf-token', csrf).send({ title: 'x', ...sampleResume() });
    const improve = await agent.post(`/api/resumes/${created.body.data.id}/improve`).set('x-csrf-token', csrf).send({});
    expect(improve.status).toBe(503);
    expect(improve.body.error.code).toBe('AI_UNAVAILABLE');
    const analyze = await agent.post(`/api/resumes/${created.body.data.id}/analyze`).set('x-csrf-token', csrf).send({});
    expect(analyze.status).toBe(200);
    expect((await agent.get('/api/config')).body.data.aiAvailable).toBe(false);
  });
});

describe('upload and import', () => {
  async function docxBuffer() {
    const doc = new Document({ sections: [{ children: SAMPLE_RESUME_TEXT.split('\n').map((l) => new Paragraph(l)) }] });
    return Packer.toBuffer(doc);
  }

  it('parses a DOCX into a reviewable draft without saving it', async () => {
    const before = (await A.agent.get('/api/resumes')).body.data.total;
    const res = await post(A, '/api/resumes/upload').attach('file', await docxBuffer(), 'resume.docx');
    expect(res.status).toBe(200);
    expect(res.body.data.draft.personalInfo.email).toBe('priya.raman@example.com');
    expect(res.body.data.ai.used).toBe(false);
    expect(res.body.data.quality.score).toBeGreaterThan(0);
    expect((await A.agent.get('/api/resumes')).body.data.total).toBe(before);
  });

  it('builds an AI draft when requested and strips non-ATS characters', async () => {
    ai.mode = 'ok';
    const res = await post(A, '/api/resumes/upload')
      .field('useAi', 'true')
      .field('jobDescription', SAMPLE_JD)
      .attach('file', await docxBuffer(), 'resume.docx');
    expect(res.status).toBe(200);
    expect(res.body.data.ai).toMatchObject({ requested: true, used: true });
    expect(res.body.data.draft.skills).toContain('Kubernetes');
    expect(res.body.data.draft.skills.join(' ')).not.toMatch(/🚀/);
    expect(res.body.data.jobMatch.score).toBeGreaterThan(0);
    expect(ai.lastBuildInput!.documents[0].text).toContain('Acme Fintech');
    expect(ai.lastBuildInput!.jobDescription).toContain('GraphQL');
  });

  it('merges a resume and a LinkedIn PDF export into one draft and flags conflicts', async () => {
    const before = (await A.agent.get('/api/resumes')).body.data.total;
    const res = await post(A, '/api/resumes/upload')
      .attach('files', Buffer.from(SAMPLE_LINKEDIN_TEXT), 'Profile.txt')
      .attach('files', await docxBuffer(), 'resume.docx');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.sources.map((s: { role: string }) => s.role)).toEqual(['linkedin', 'resume']);
    expect(d.draft.experience.map((e: { company: string }) => e.company)).toEqual(['Acme Fintech Pvt Ltd', 'Bright Apps', 'Demo Labs']);
    expect(d.draft.skills).toEqual(expect.arrayContaining(['GraphQL', 'Redis']));
    expect(d.conflicts).toHaveLength(1);
    expect(d.conflicts[0]).toMatchObject({ path: 'experience[1].startDate', selected: 'Jan 2021' });
    expect(d.mergeNotes.join(' ')).toMatch(/Demo Labs/);
    expect(d.rawText).toContain('===== Profile.txt (LinkedIn) =====');
    expect((await A.agent.get('/api/resumes')).body.data.total).toBe(before);
  });

  it('respects explicit roles and sends every labelled document to the AI', async () => {
    ai.mode = 'ok';
    const res = await post(A, '/api/resumes/upload')
      .field('useAi', 'true')
      .field('roles', JSON.stringify(['resume', 'other']))
      .attach('files', await docxBuffer(), 'cv.docx')
      .attach('files', Buffer.from(SAMPLE_LINKEDIN_TEXT), 'notes.txt');
    expect(res.status).toBe(200);
    expect(ai.lastBuildInput!.documents.map((d) => [d.name, d.role])).toEqual([
      ['cv.docx (Resume)', 'resume'],
      ['notes.txt (Document)', 'other'],
    ]);
    // Hallucinated conflict path from the AI is dropped; the valid one is kept.
    expect(res.body.data.conflicts.map((c: { path: string }) => c.path)).toEqual(['experience[1].startDate']);
  });

  it('skips an unreadable file but still builds from the others', async () => {
    const res = await post(A, '/api/resumes/upload')
      .attach('files', await docxBuffer(), 'resume.docx')
      .attach('files', Buffer.from('%PDF-1.4 broken'), 'scan.pdf');
    expect(res.status).toBe(200);
    expect(res.body.data.warnings[0]).toMatch(/Skipped "scan\.pdf"/);
    expect(res.body.data.sources).toHaveLength(1);
  });

  it('explains images and old .doc files instead of failing silently', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const img = await post(A, '/api/resumes/upload').attach('files', png, 'photo.png');
    expect(img.status).toBe(422);
    expect(img.body.error.message).toMatch(/image.*AI option/i);
    const doc = await post(A, '/api/resumes/upload').attach('files', Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]), 'old.doc');
    expect(doc.status).toBe(400);
    expect(doc.body.error.code).toBe('OLD_WORD_FORMAT');
  });

  it('lets the AI read a scan or photo when AI is on', async () => {
    ai.mode = 'ok';
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const res = await post(A, '/api/resumes/upload').field('useAi', 'true').attach('files', png, 'photo.png');
    expect(res.status).toBe(200);
    expect(res.body.data.ai.used).toBe(true);
    expect(ai.lastBuildInput!.documents[0].attachment).toMatchObject({ mediaType: 'image/png' });
  });

  it('rejects more than 4 files and invalid roles', async () => {
    let req = post(A, '/api/resumes/upload');
    for (let i = 0; i < 5; i++) req = req.attach('files', Buffer.from(SAMPLE_RESUME_TEXT), `r${i}.txt`);
    expect((await req).status).toBe(400);
    const badRoles = await post(A, '/api/resumes/upload').field('roles', '["boss"]').attach('files', Buffer.from(SAMPLE_RESUME_TEXT), 'r.txt');
    expect(badRoles.status).toBe(400);
  });

  it('falls back to the rule-based draft when AI fails', async () => {
    ai.mode = 'fail';
    const res = await post(A, '/api/resumes/upload').field('useAi', 'true').attach('file', await docxBuffer(), 'resume.docx');
    ai.mode = 'ok';
    expect(res.status).toBe(200);
    expect(res.body.data.ai.used).toBe(false);
    expect(res.body.data.ai.error).toMatch(/rule-based draft/);
    expect(res.body.data.draft.experience.length).toBe(2);
  });

  it('imports pasted text', async () => {
    const res = await post(A, '/api/resumes/import-text').send({ text: SAMPLE_RESUME_TEXT });
    expect(res.status).toBe(200);
    expect(res.body.data.draft.personalInfo.fullName).toBe('Priya Raman');
  });

  it('rejects unsupported, spoofed, missing and oversized files', async () => {
    const exe = await post(A, '/api/resumes/upload').attach('file', Buffer.from('MZ fake'), 'virus.exe');
    expect(exe.status).toBe(400);
    expect(exe.body.error.code).toBe('UNSUPPORTED_FILE');
    const spoofed = await post(A, '/api/resumes/upload').attach('file', Buffer.from('just text pretending'), 'resume.pdf');
    expect(spoofed.status).toBe(400);
    expect((await post(A, '/api/resumes/upload')).status).toBe(400);
    const big = await post(A, '/api/resumes/upload').attach('file', Buffer.alloc(6 * 1024 * 1024, 0x41), 'big.txt');
    expect(big.status).toBe(413);
  });
});

describe('export', () => {
  it('exports a PDF with selectable text', async () => {
    const res = await A.agent.get(`/api/resumes/${resumeId}/export?format=pdf`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('Priya_Raman_Resume.pdf');
    const text = await extractText(res.body as Buffer, 'pdf');
    expect(text.toLowerCase()).toContain('work experience');
    expect(text).toContain('Acme Fintech Pvt Ltd');
  });

  it('exports a DOCX', async () => {
    const res = await A.agent.get(`/api/resumes/${resumeId}/export?format=docx`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    const { value } = await mammoth.extractRawText({ buffer: res.body as Buffer });
    expect(value).toContain('Priya Raman');
  });

  it('previews unsaved content as the exact export PDF with page count', async () => {
    const res = await post(A, '/api/resumes/preview')
      .send({ ...sampleResume(), templateId: 'executive', fitToPage: false })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-page-count']).toBe('1');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await post(A, '/api/resumes/preview').send({ templateId: 'fancy' })).status).toBe(400);
  });

  it('saves template and fit-to-page choices', async () => {
    const res = await patch(A, `/api/resumes/${resumeId}`).send({ templateId: 'bold', fitToPage: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ templateId: 'bold', fitToPage: true });
  });

  it('rejects unknown formats', async () => {
    expect((await A.agent.get(`/api/resumes/${resumeId}/export?format=exe`)).status).toBe(400);
  });
});

describe('deletion', () => {
  it('deletes a resume and its analyses', async () => {
    expect(await Analysis.countDocuments({ resumeId })).toBeGreaterThan(0);
    expect((await del(A, `/api/resumes/${resumeId}`)).status).toBe(200);
    expect((await A.agent.get(`/api/resumes/${resumeId}`)).status).toBe(404);
    expect(await Analysis.countDocuments({ resumeId })).toBe(0);
  });
});
