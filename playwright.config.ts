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
    command: `DB_PATH=/tmp/hibana-e2e.db PORT=${PORT} NODE_ENV=development OPEN_REGISTRATION=true GITHUB_OWNER=x GITHUB_REPO=y GITHUB_TOKEN=x OWNER_EMAIL=test@test.local TELEGRAM_BOT_TOKEN=x TELEGRAM_SECRET=x node --import tsx src/server.ts`,
    port: PORT,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
    env: {
      // Fresh DB for each CI run — migrations auto-run on boot.
      DB_PATH: '/tmp/hibana-e2e.db',
    },
  },
})
