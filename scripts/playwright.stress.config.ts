import { defineConfig, devices } from '@playwright/test';

/**
 */
export default defineConfig({
  testDir: './',
  testMatch: ['stress-test*.ts', 'latency-test*.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 1900000, // 31+ minutes

  use: {
    headless: false, // Headed by default for visual monitoring
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
