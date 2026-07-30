import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
    // Give tests enough headroom for the mocked concierge response
    actionTimeout: 15_000,
    navigationTimeout: 15_000,
  },

  // Reuse the already-running dev server; start it automatically if not up
  webServer: {
    command: 'npm run dev:website',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
