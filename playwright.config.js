import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.js',
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  reporter: 'list',
  outputDir: 'artifacts/browser-results',
  use: {
    browserName: 'chromium',
    channel: process.env.BROWSER_CHANNEL || 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1050 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
