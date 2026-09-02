Personal Project & Idea Manager — Agent Instructions

What this is: a personal project/idea tracker for Ali (solo UI/UX designer, runs an e-commerce business, works long self-directed hours across several projects at once, doesn't read or patch code himself). It replaces his whiteboard, Obsidian, and Notion. Two jobs only: never lose an idea, never lose track of where a project stands. If you're about to build something that doesn't serve one of those two, check it's actually asked for before proceeding.

Three docs, three purposes: this file is what you (a coding agent) must never violate, even in a session that hasn't read anything else. pm-app-spec.md is the full spec — features, data model, screens, phased build order. vision.md is Ali's own reasoning in his own words — read it to understand why a decision was made if the spec's what isn't enough context.

Full spec: pm-app-spec.md in the repo root. Read it for feature detail. This file is the compact, load-bearing subset — rules that must never be violated even in a session that hasn't read the full spec.

Stack
Frontend: static HTML on Cloudflare Pages, htmx (AJAX/refresh-less) + Alpine.js (small interactivity) + Fabric.js (Canvas only). No build step, no React, no heavy framework.
Backend: Cloudflare Workers, routed with Hono.
DB: Cloudflare D1 (SQLite), two databases — pm-app-dev and pm-app-prod as named Wrangler environments. Never run untested migrations against prod.
File storage: private GitHub repo (screenshots, changelogs) via the GitHub Contents API. D1 stores only the path.
Email: Brevo (password reset, client reminders).
Non-negotiable rules (violating these means expensive rework later)
Every user-owned table has a user_id column, and every query filters on it. Applies to projects, tags, canvas_elements, telegram_captures. Never write a query against these tables without a user_id filter — this is what keeps per-user data private.
IDs are UUIDs. Client-generated for anything that can be created offline (Canvas elements, Spark quick-add) — generate the UUID before the network call, send it to the server, server accepts it as canonical. Server-generated UUIDs for everything else (e.g. Telegram-sourced captures).
All timestamps stored in UTC. Convert to the user's calendar (Gregorian/Shamsi, via jalaali-js) and timezone only when rendering — never in storage or in a query filter.
Schema changes go through wrangler d1 migrations — numbered SQL files, applied identically to dev and prod. No manual ALTER TABLE.
Every credential is a Workers secret (wrangler secret put) — GitHub token, Brevo key, Telegram bot token, session-signing key. Never hardcoded, never committed.
Password hashing: PBKDF2 via the Web Crypto API (crypto.subtle, 100,000+ iterations, SHA-256). Do not use bcrypt or argon2 npm packages — they need native bindings Workers doesn't provide and will fail silently or not install.
Retrieving a file from the GitHub assets repo over 1MB requires the application/vnd.github.v3.raw Accept header — omit it and larger screenshots come back empty, not with an error.
The backup export excludes users.password_hash and the entire sessions table. Credentials never get committed into git history, even hashed, even in a private repo.
Index user_id, status, and project_id on every table that has them, from the first migration.
Validate all API input with a schema (Zod recommended) at the Hono route level, consistently across every endpoint.
Telegram webhook validates Telegram's secret-token header. Unauthenticated webhook calls must not be able to create data.
Data model quick reference

projects (user_id, type: personal|client, status: spark|pending|building|working|archived, sort_order) · hurdles (per-project checklist, sort_order) · tags+project_tags (freeform, user_id-scoped) · links · screenshots/changelogs (github_path) · tasks (client-only) · payments (client-only) · telegram_captures · canvas_elements (client-generated id) · users · sessions · invites.

Full column lists: pm-app-spec.md §4.

Testing (§11 of the spec) — required before any phase is marked done
User isolation: user A's queries can never return user B's rows.
Offline sync: a queued offline change lands correctly once reconnected, no duplication or loss.
Progress formulas: hurdles-based (personal) and task-time-based (client) both return correct percentages against known inputs.
Auth: password hash/verify round-trip, session expiry.
Build order

Phase 0 (walking skeleton) → Phase 1 (personal core) → Phase 2 (Canvas) → Phase 3 (polish + locale) → Phase 4 (client module) → Phase 5 (integrations/mobile). Details and "done when" criteria: pm-app-spec.md §12.

UI conventions

One toast/banner component for all errors and confirmations. Destructive actions (hard delete) use an undo-toast, not a blocking confirm dialog. Every list/board screen needs a defined empty state and loading state.