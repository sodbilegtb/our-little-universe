import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const E2E_ADMIN_PASSWORD = 'e2e-host-password';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'mock', fullyParallel: true, use: { baseURL: 'http://localhost:4173' } },
    { name: 'local-api', fullyParallel: false, use: { baseURL: 'http://localhost:4174' } },
  ],
  webServer: [
    {
      command: 'npx vite --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run start -w @olu/api',
      cwd: '../..',
      url: 'http://localhost:8788/v1/health',
      env: { PORT: '8788', ADMIN_PASSWORD: E2E_ADMIN_PASSWORD, MEMORY_FILE: 'none', LOG_LEVEL: 'warn' },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npx vite --port 4174 --strictPort',
      url: 'http://localhost:4174',
      env: { VITE_API_MODE: 'http', VITE_API_BASE_URL: 'http://localhost:8788' },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
