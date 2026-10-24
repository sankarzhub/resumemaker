import { Router } from 'express';
import { createAuthController } from '../controllers/auth.controller.js';
import { createResumeController } from '../controllers/resume.controller.js';
import { getAnalysis } from '../controllers/analysis.controller.js';
import { requireAuth, requireCsrf, type AuthConfig } from '../middleware/auth.middleware.js';
import { createLimiters } from '../middleware/rateLimit.middleware.js';
import { resumeFiles } from '../middleware/upload.middleware.js';
import type { AiService } from '../services/aiResume.service.js';

export interface RouteDeps {
  auth: AuthConfig;
  ai: AiService;
  rateLimits: boolean;
}

export function createApiRouter({ auth, ai, rateLimits }: RouteDeps) {
  const router = Router();
  const limit = createLimiters(rateLimits);
  const authCtl = createAuthController(auth);
  const resumeCtl = createResumeController(ai);
  const authed = requireAuth(auth);

  router.get('/config', (_req, res) => {
    res.json({ success: true, data: { aiAvailable: ai.available } });
  });

  // Public auth endpoints (no session yet, so no CSRF token to check).
  router.post('/auth/register', limit.auth, authCtl.register);
  router.post('/auth/login', limit.auth, authCtl.login);

  // Everything below requires a session and, for state-changing requests, a CSRF token.
  router.use(authed, requireCsrf);

  router.post('/auth/logout', authCtl.logout);
  router.get('/auth/me', authCtl.me);
  router.delete('/auth/me', authCtl.deleteAccount);

  router.get('/resumes', resumeCtl.list);
  router.post('/resumes', resumeCtl.create);
  router.post('/resumes/upload', limit.upload, resumeFiles, resumeCtl.upload);
  router.post('/resumes/import-text', limit.upload, resumeCtl.importText);
  router.post('/resumes/preview', resumeCtl.preview);
  router.get('/resumes/:id', resumeCtl.get);
  router.patch('/resumes/:id', resumeCtl.update);
  router.delete('/resumes/:id', resumeCtl.remove);
  router.post('/resumes/:id/duplicate', resumeCtl.duplicate);
  router.post('/resumes/:id/analyze', resumeCtl.analyze);
  router.post('/resumes/:id/job-match', resumeCtl.jobMatch);
  router.post('/resumes/:id/improve', limit.ai, resumeCtl.improve);
  router.get('/resumes/:id/analyses', resumeCtl.listAnalyses);
  router.get('/resumes/:id/export', resumeCtl.export);

  router.get('/analyses/:id', getAnalysis);

  return router;
}
