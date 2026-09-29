// eslint.config.mjs — ESLint flat config for Hibana.
// Focuses on catching real bugs (unused vars, no-undef, prefer-const) without being
// overly opinionated about style. TypeScript-aware via @typescript-eslint.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow the default export pattern (Cloudflare Workers entry)
      'import/no-anonymous-default-export': 'off',
      // TypeScript handles this better than ESLint
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Allow the ternary-as-statement pattern (used in dashboard.ts for signal aggregation)
      '@typescript-eslint/no-unused-expressions': 'off',
      // Don't require explicit return types (inference is fine)
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow Function type in tests (stub helpers)
      '@typescript-eslint/no-unsafe-function-type': 'off',
      // Allow empty catch blocks (common pattern — error is intentionally swallowed)
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Allow useless assignment (sometimes intentional for side effects)
      'no-useless-assignment': 'off',
      // Allow escape characters in regex (used in markdown parsing)
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
      // Allow prefer-const warnings (not errors)
      'prefer-const': 'warn',
    },
  },
  {
    // Tests can be more relaxed
    files: ['src/tests/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // S171 (ignore alignment): CI lints `npx eslint src/` — but a bare `eslint .`
    // dragged in 4.4k phantom errors from surfaces that have their OWN gates
    // (public/js → node --check + the browser e2e suite; e2e/ + qa/ → Playwright's
    // own compiler; scripts/*.mjs + rotate-*.mjs + make-zip.mjs → executed on every
    // build/release, failures self-evident). Aligning the ignores with the real
    // linted surface (src/) keeps the local command as honest as CI's.
    ignores: [
      'node_modules/',
      'public/dist/',
      'public/vendor/',
      'public/js/',
      'public/sw.js', // service-worker context (self/caches/fetch globals) — Playwright + the live deploy are its gate
      'e2e/',
      'qa/',
      'scripts/',
      'make-zip.mjs',
      'rotate-*.mjs',
      '.wrangler/',
      '.build-backup/',
    ],
  },
)
