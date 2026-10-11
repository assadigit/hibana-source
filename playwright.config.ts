// playwright.config.ts — E2E + screenshot-diff + a11y harness for Hibana.
// Starts the local Node server (npm run start:node) before tests, closes after.
// Run: npx playwright test
// CI: wired into .github/workflows/ci.yml as a 2-shard matrix (S200/PERF-1).
//
// S200 (PERF-1): E2E_PORT / E2E_DB / E2E_SHOTS parametrize the WEB SERVER so
// CI's matrix shards and local runs can diverge from the defaults. S202's
// 86-spec DB-constant sweep (e2e/fixtures/e2e-db.ts reads the same env) made
// LOCAL PARALLEL shards real: two runners with distinct E2E_PORT/E2E_DB/
// E2E_SHOTS each boot their own server + DB (S202's release run: 3017/3018,
// FULL 417 as two parallel shards).

import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3017) // avoid clashing with the dev server on 3000
const DB_PATH = process.env.E2E_DB ?? '/tmp/hibana-e2e.db'
const SHOTS_DIR = process.env.E2E_SHOTS ?? '/tmp/hibana-e2e-shots'

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
    command: `DB_PATH=${DB_PATH} PORT=${PORT} NODE_ENV=development RATE_LIMIT_DISABLE=1 OPEN_REGISTRATION=true GITHUB_OWNER=x GITHUB_REPO=y GITHUB_TOKEN=x OWNER_EMAIL=test@test.local TELEGRAM_BOT_TOKEN=x TELEGRAM_SECRET=x node --import tsx src/server.ts`,
    port: PORT,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
    env: {
      // Fresh DB for each run — migrations auto-run on boot.
      DB_PATH,
      // S199 (HLTH-18): the signup page's captcha round-trip needs the secret —
      // without it /api/auth/captcha 503s and the signup form can never be pinned.
      CAPTCHA_SECRET_KEY: 'test-secret',
      // S61: the disk shot store — the whole upload pipeline (put → serve → delete)
      // works locally now; the dummy GITHUB_TOKEN=x above used to 500 every upload.
      HIBANA_SHOTS_DIR: SHOTS_DIR,
    },
  },
})
