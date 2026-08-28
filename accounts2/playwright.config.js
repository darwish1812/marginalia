// @ts-check
/* One browser, run from the repo root against a build made at run time from index.html.
 * No fixtures, no page objects, no helpers beyond the one that answers the first-run
 * question — the app is a single file and the tests should be readable by whoever has to
 * change it, which is the same argument the app itself makes about having no build step. */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8123',
    trace: 'on-first-retry',
    /* the deck speaks; a test machine has no voice and should not wait for one */
    permissions: []
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tests/local-build.mjs && node tests/serve.mjs',
    url: 'http://127.0.0.1:8123/index.local.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60000
  }
});
