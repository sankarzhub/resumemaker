import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import type { AiService, AiBuildResult, AiSuggestion, SourceDocument } from '../src/services/aiResume.service.js';
import { AppError } from '../src/utils/AppError.js';
import { sampleResume } from './fixtures.js';

// Never point tests at a real database: each test file gets its own throwaway local DB.
export async function connectTestDb(name: string) {
  await mongoose.connect(`mongodb://127.0.0.1:27017/resumecraft_test_${name}`, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
}

export async function disconnectTestDb() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

export class FakeAi implements AiService {
  available = true;
  mode: 'ok' | 'fail' = 'ok';
  lastBuildInput: { documents: SourceDocument[]; jobDescription?: string } | null = null;

  async buildResume(input: { documents: SourceDocument[]; jobDescription?: string }): Promise<AiBuildResult> {
    this.lastBuildInput = input;
    if (this.mode === 'fail') throw new AppError(504, 'AI_TIMEOUT', 'The AI service took too long to respond.');
    const r = sampleResume();
    return {
      resume: { ...r, targetJobTitle: r.targetJobTitle ?? '', skills: [...r.skills, '🚀 Kubernetes'] },
      changes: ['Rewrote bullets with action verbs'],
      missingInfo: ['Add a metric to the mentoring bullet'],
      conflicts:
        input.documents.length > 1
          ? [
              { path: 'experience[1].startDate', label: 'Bright Apps start', options: [{ source: input.documents[0].name, value: 'Jan 2021' }, { source: input.documents[1].name, value: 'Feb 2021' }], selected: 'Jan 2021' },
              { path: 'experience[42].startDate', label: 'hallucinated', options: [{ source: 'x', value: '1' }, { source: 'y', value: '2' }], selected: '1' },
            ]
          : [],
    };
  }

  async suggestImprovements({ resume }: { resume: { summary: string } }): Promise<AiSuggestion[]> {
    if (this.mode === 'fail') throw new AppError(503, 'AI_UNAVAILABLE', 'AI is down.');
    return [{ section: 'summary', entryIndex: -1, bulletIndex: -1, original: resume.summary, suggested: 'A sharper summary.', reason: 'Clearer' }];
  }
}

export function makeApp(ai: AiService = new FakeAi()): Express {
  return createApp({
    clientUrl: 'http://localhost:5173',
    jwtSecret: 'test-secret-that-is-long-enough-for-hs256-signing',
    secureCookies: false,
    rateLimits: false,
    ai,
  });
}

/** A logged-in supertest agent that also sends the CSRF header. */
export async function registerAgent(app: Express, email: string, password = 'Passw0rd!') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ name: 'Test User', email, password });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const csrf = cookies.find((c) => c.startsWith('rc_csrf='))!.split(';')[0].split('=')[1];
  return { agent, csrf, user: res.body.data.user as { id: string } };
}
