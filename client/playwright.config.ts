import { defineConfig, devices } from '@playwright/test'

// E2E runs its own API (port 5050) against a throwaway database and its own Vite server (port 5174),
// so it never touches your dev data. AI is disabled so results are deterministic.
const API_PORT = 5050
const WEB_PORT = 5174

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'chromium', testIgnore: /mobile\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // iPhone-sized viewport and touch, rendered with Chromium.
    { name: 'mobile', testMatch: /mobile\.spec/, use: { ...devices['iPhone 12'], browserName: 'chromium' } },
  ],
  webServer: [
    {
      command: 'npx tsx src/server.ts',
      cwd: '../server',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        NODE_ENV: 'test',
        CLIENT_URL: `http://localhost:${WEB_PORT}`,
        MONGODB_URI: 'mongodb://127.0.0.1:27017/resumecraft_e2e',
        JWT_SECRET: 'e2e-secret-that-is-long-enough-for-signing-tokens',
        ANTHROPIC_API_KEY: '',
      },
    },
    {
      command: 'npx vite',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_PORT: String(WEB_PORT), API_PROXY_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
})
