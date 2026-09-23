import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.e2e.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [['list'], ['json', { outputFile: 'docs/evidence/playwright-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4197',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  webServer: {
    command: 'node --import tsx tests/e2e/server.ts',
    url: 'http://127.0.0.1:4197/health/live',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
