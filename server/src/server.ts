import { env, isProduction } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { createApp } from './app.js';
import { ClaudeResumeService } from './services/aiResume.service.js';

async function main() {
  await connectDatabase(env.MONGODB_URI);

  const ai = new ClaudeResumeService(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
  console.log(ai.available ? `AI enabled (${env.ANTHROPIC_MODEL})` : 'AI disabled: ANTHROPIC_API_KEY is not set');

  const app = createApp({
    clientUrl: env.CLIENT_URL,
    jwtSecret: env.JWT_SECRET,
    secureCookies: isProduction,
    rateLimits: env.NODE_ENV !== 'test',
    ai,
  });
  const server = app.listen(env.PORT, () => {
    console.log(`ResumeCraft API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
