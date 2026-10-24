import { describe, expect, it } from 'vitest';
import { ClaudeResumeService, resolveSuggestions, sanitizeAiResume } from '../../src/services/aiResume.service.js';
import { sampleResume } from '../fixtures.js';

describe('AI service helpers', () => {
  it('is unavailable without an API key and fails with a clear error', async () => {
    const svc = new ClaudeResumeService(undefined, 'claude-opus-5-5');
    expect(svc.available).toBe(false);
    await expect(svc.buildResume({ documents: [{ name: 'a.pdf', role: 'resume', text: 'x' }] })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', statusCode: 503 });
  });

  it('sends original PDFs and images to the model with labelled extracted text', async () => {
    let captured: { messages: Array<{ content: Array<Record<string, unknown>> }>; output_config: { effort: string } } | undefined;
    const r = sampleResume();
    const reply = { resume: { ...r, targetJobTitle: '', additionalSections: [] }, changes: [], missingInfo: [], conflicts: [] };
    const stub = {
      beta: {
        messages: {
          stream: (params: typeof captured) => {
            captured = params;
            return { finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }] }) };
          },
        },
      },
    } as unknown as ConstructorParameters<typeof ClaudeResumeService>[2];
    const svc = new ClaudeResumeService(undefined, 'claude-opus-5-5', stub);
    const out = await svc.buildResume({
      documents: [
        { name: 'cv.pdf (Resume)', role: 'resume', text: 'jumbled text', attachment: { mediaType: 'application/pdf', base64: 'JVBERi0=' } },
        { name: 'scan.png (Document)', role: 'other', text: '', attachment: { mediaType: 'image/png', base64: 'iVBORw0=' } },
        { name: 'notes.docx (Document)', role: 'other', text: 'Plain DOCX text' },
      ],
    });
    expect(out.resume.personalInfo.fullName).toBe('Priya Raman');
    const blocks = captured!.messages[0].content;
    expect(blocks.filter((b) => b.type === 'document')).toHaveLength(1);
    expect(blocks.filter((b) => b.type === 'image')).toHaveLength(1);
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    expect(text).toContain('<source_document name="cv.pdf (Resume)" type="resume">');
    expect(text).toContain('(no text layer)');
    expect(text).toContain('Plain DOCX text');
  });

  it('keeps only suggestions whose original text matches the resume', () => {
    const r = sampleResume();
    const out = resolveSuggestions(r, [
      { section: 'experience', entryIndex: 0, bulletIndex: 1, original: r.experience[0].description[1], suggested: 'Cut API latency 40% with Redis caching and indexes', reason: 'Tighter' },
      { section: 'experience', entryIndex: 0, bulletIndex: 1, original: 'Something the model made up', suggested: 'x', reason: 'r' },
      { section: 'experience', entryIndex: 9, bulletIndex: 0, original: 'out of range', suggested: 'x', reason: 'r' },
      { section: 'summary', entryIndex: -1, bulletIndex: -1, original: r.summary, suggested: r.summary, reason: 'no-op' },
      { section: 'skills', entryIndex: -1, bulletIndex: -1, original: '', suggested: 'Redis', reason: 'Used in experience' },
      { section: 'skills', entryIndex: -1, bulletIndex: -1, original: '', suggested: 'react', reason: 'already listed' },
    ]);
    expect(out.map((s) => s.suggested)).toEqual(['Cut API latency 40% with Redis caching and indexes', 'Redis']);
    expect(new Set(out.map((s) => s.id)).size).toBe(out.length);
  });

  it('sanitises AI output: strips emojis and placeholders, dedupes skills', () => {
    const r = sampleResume();
    const clean = sanitizeAiResume({
      ...r,
      targetJobTitle: 'N/A',
      skills: ['React', 'react', ' Node.js ', '🚀 Docker'],
      experience: [{ ...r.experience[0], current: true, endDate: 'Present' }],
    });
    expect(clean.targetJobTitle).toBe('');
    expect(clean.skills).toEqual(['React', 'Node.js', 'Docker']);
    expect(clean.experience[0].endDate).toBe('');
  });
});
