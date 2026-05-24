import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? 'html' : 'list',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command:
      'node ./dist/cli.js build --pages docs --out-dir _site && node --experimental-strip-types --no-warnings tests/e2e/static-server.ts',
    cwd: '../..',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
