import { defineConfig } from 'vitest/config'

// Tests run locally against better-sqlite3 — no Cloudflare account or network needed.
// This is intentional: the whole suite must run anywhere the code runs (portability).
export default defineConfig({
  test: {
    include: ['src/tests/**/*.test.ts'],
    environment: 'node',
    // node:sqlite is newer than this Vite's builtin-modules list — externalize it explicitly
    // so the test runner uses Node's real module instead of trying to resolve it as a file.
    server: {
      deps: {
        external: ['node:sqlite'],
      },
    },
  },
})
