# Hibana — New Session Prompt (Brainstorming + UI/UX + Performance)

## Copy this prompt to start the new session:

---

I'm working on **Hibana (hibana.ir)** — my personal project/idea manager (EN/FA bilingual, RTL/LTR, Jalali + Gregorian calendars). The audit execution is complete (Phases 0-5, 39 findings shipped) + 5 post-audit hotfixes. Current version: **v0.1.6** (live on prod).

**This session has two tracks — run them in parallel:**

### Track 1 — Feature gap analysis (brainstorm + ideate)

Audit Hibana against conventional project-management / product-management / task-management / life-management tools (Notion, Linear, Todoist, TickTick, Things, Obsidian, Trello, Asana, ClickUp, Routine, AmpleNote, etc.). For each category, identify:

1. **What Hibana already has** (verified in the deployed v0.1.6 tree at `/home/z/my-project/hibana-work`)
2. **What's missing** — the gaps a user would feel
3. **What Hibana has that's BETTER** than the convention (don't copy blindly — Hibana is a solo-owner app, not an enterprise tool)

Categories to audit:
- **Project management**: stages/kanban, milestones, Gantt/timeline, dependencies, templates
- **Task management**: recurring tasks, subtasks, priorities, time tracking, reminders, natural-language input
- **Note-taking / knowledge management**: backlinks, daily notes, templates, search depth, tags hierarchy
- **Life management**: calendar integration, habits, goals OKRs, journaling, mood/energy tracking
- **Idea management**: capture speed, idea → project promotion flow, idea maturity scoring
- **Canvas/visual**: whiteboard depth, mind maps, flowcharts
- **Integrations**: Telegram bot (exists), calendar sync, email-in, web clipper
- **Mobile/PWA**: offline, installability, push notifications
- **Admin/analytics**: feature-usage analytics (audit noted this is missing), time tracking reports

Deliverable: a **gap matrix** — for each category, what exists / what's missing / priority (high/med/low) / effort (S/M/L) / whether it serves Hibana's two jobs (never lose an idea · never lose your place). Don't implement yet — just the analysis + a phased recommendation.

### Track 2 — UI/UX + performance refinement (continue iterating)

The user will give live feedback as you probe the site. Known areas to refine (from this session's feedback):
- **Project signals** (bugs/ideas/backlog/hurdles chips) — placement + sizing may need tweaks
- **Quick notes widget** — density + hierarchy
- **Dashboard** — section order, project-card density, stage-box layout
- **Dark mode** — the palette was lifted to #1E1A15; may want further adjustment
- **Performance** — Phase 5 caps are in place (dashboard 8/box, notebook LIMIT 100); watch for slow loads

**Working tree**: `/home/z/my-project/hibana-work` (typecheck 0 errors, 191/191 tests green).
**Credentials**: `/home/z/.hibana-secrets.env` (chmod 600) — GitHub + Cloudflare + Telegram tokens.
**Release scripts**: `/home/z/hibana-release.sh` (phase releases) + `/home/z/hibana-hotfix-push.sh` (per-fix pushes).
**Deploy**: dev first (`npm run deploy`), probe `hibana.aliassadi.workers.dev`, then prod (`npm run deploy:prod`), probe `hibana.ir`.
**Cache discipline**: bump `?v=` on every referencing HTML page + the SW cache name + SHELL when CSS/JS changes. Current versions: app.css v192, app.js v159, i18n.js v27, whiteboard.js v8, SW hibana-v213.
**GitHub source repo**: `assadigit/hibana-source` (tags v0.1.1–v0.1.6). Backups repo: `assadigit/hibana-safe`.
**Zips**: `/home/z/my-project/Download Backups/Hibana-Alpha-V*.zip` (6 zips, v0.1.1–v0.1.6).

**Read first**: `/home/z/my-project/worklog.md` (this session's full log) → `CLAUDE.md` (rules) → `RECOVERED.md` (deviations) → `CHANGELOG.md` (the full history).

**Security**: rotate the GitHub + Cloudflare + Telegram tokens after this session (they were pasted in chat).

---
