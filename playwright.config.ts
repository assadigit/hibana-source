// playwright.config.ts — E2E + screenshot-diff + a11y harness for Hibana.
// Starts the local Node server (npm run start:node) before tests, closes after.
// Run: npx playwright test
// CI: wired into .github/workflows/ci.yml

import { defineConfig, devices } from '@playwright/test'

const PORT = 3017 // avoid clashing with the dev server on 3000

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // single-threaded — the Node server is a single instance
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Start the Node server before tests, stop after.
  webServer: {
    // RATE_LIMIT_DISABLE=1 (S105): the suite's ~180 logins from 127.0.0.1 burst past
    // the 30/60s auth limiter on fast runners → random waitForURL('**/app') timeouts
    // ("1 failed" walking between tests). Test-only flag; deploys never set it.
    command: `DB_PATH=/tmp/hibana-e2e.db PORT=${PORT} NODE_ENV=development RATE_LIMIT_DISABLE=1 OPEN_REGISTRATION=true GITHUB_OWNER=x GITHUB_REPO=y GITHUB_TOKEN=x OWNER_EMAIL=test@test.local TELEGRAM_BOT_TOKEN=x TELEGRAM_SECRET=x node --import tsx src/server.ts`,
    port: PORT,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
    env: {
      // Fresh DB for each CI run — migrations auto-run on boot.
      DB_PATH: '/tmp/hibana-e2e.db',
      // S61: the disk shot store — the whole upload pipeline (put → serve → delete)
      // works locally now; the dummy GITHUB_TOKEN=x above used to 500 every upload.
      HIBANA_SHOTS_DIR: '/tmp/hibana-e2e-shots',
    },
  },
})
