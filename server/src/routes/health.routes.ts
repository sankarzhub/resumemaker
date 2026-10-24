import { Router } from 'express';
import { isDatabaseReady } from '../config/database.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const dbReady = isDatabaseReady();
  res.status(dbReady ? 200 : 503).json({
    success: dbReady,
    data: {
      status: dbReady ? 'ok' : 'degraded',
      database: dbReady ? 'connected' : 'disconnected',
      uptimeSeconds: Math.round(process.uptime()),
    },
  });
});
