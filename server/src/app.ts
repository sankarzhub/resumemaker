import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health.routes.js';
import { createApiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import type { AiService } from './services/aiResume.service.js';

export interface AppOptions {
  clientUrl: string;
  jwtSecret: string;
  secureCookies: boolean;
  rateLimits: boolean;
  ai: AiService;
}

export function createApp({ clientUrl, jwtSecret, secureCookies, rateLimits, ai }: AppOptions) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: [clientUrl], credentials: true, exposedHeaders: ['X-Page-Count', 'X-Fit-Scale', 'X-Fit-Spacing', 'X-Fitted', 'Content-Disposition'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api/health', healthRouter);
  app.use('/api', createApiRouter({ auth: { jwtSecret, secureCookies }, ai, rateLimits }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
