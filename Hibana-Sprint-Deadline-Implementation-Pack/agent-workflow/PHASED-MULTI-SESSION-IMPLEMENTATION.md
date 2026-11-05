# Hibana Sprint, Deadline & Dependency — Multi-Session Delivery Plan

## 1. Delivery objective

Implement the feature described in `../specs/Hibana-Sprint-and-Deadline-System-Spec.md` in both:

1. Hibana Web/source.
2. Hibana Windows Desktop.

The implementation must behave as one product: same sprint model, lifecycle, deadline precedence, deadline extensions, dependency rules, project scoping, archive semantics, and user-visible language across both applications.

This is a feature implementation, not a redesign or broad repository cleanup.

## 2. Repository discovery is mandatory

A known web/source repository reference from project context is:

- `https://github.com/assadigit/hibana-source`

Verify the actual configured remote before using it. Do not assume this is the currently mounted repository or that its default branch is unchanged.

The Windows Desktop repository URL is not included in this package. Discover it from the current workspace, existing Git remotes, linked project documentation, submodules, build scripts, or user-provided environment. Do not guess a repository URL or push to a similarly named project. If the exact desktop repo cannot be identified or accessed, report the blocker and continue only the work that is safe in the accessible repository; do not claim desktop implementation is complete.

For each repository, record:

- Exact remote URL and default branch.
- Current branch and clean/dirty status.
- Existing branch/PR/merge convention.
- CI checks and deployment workflow.
- Relevant backend, frontend, storage, sync, migration, localization, and test entry points.

## 3. Multi-session operating protocol

Work in prioritized, bounded sessions. Each session should complete one coherent phase or clearly document why it cannot.

### Mandatory at the beginning of every session

1. Read the complete consolidated spec and visual guide.
2. Read the current implementation status and the previous session handoff.
3. Inspect `git status`, current branch, remotes, and recent commits in every affected repository.
4. Verify whether earlier sessions or another agent have changes in progress.
5. Reconcile actual code with the phase checklist; do not blindly repeat prior work.
6. Protect unrelated/uncommitted changes. Never overwrite or discard them.

### Mandatory at the end of every session

Update the following files inside this pack's `agent-workflow/` folder:

- `IMPLEMENTATION-STATUS.md` — completed phases, pending work, repo/branch/commit/PR/deploy state, tests, risks, and known assumptions.
- `NEXT-SESSION-PROMPT.md` — a complete ready-to-run prompt for the next prioritized phase, carrying forward all relevant context.

The next prompt must tell the next session exactly what to inspect, implement, test, commit, push, and verify. Do not make the user reconstruct context from chat history.

Also provide a concise end-of-session report with:

- What changed in Web/source.
- What changed in Desktop.
- Tests/builds run and results.
- Commit SHAs and push/PR/merge state for each repo.
- Deployment state, URL/environment, health check, and deployed SHA if applicable.
- Remaining blockers and any assumptions used.
- The next session's objective and the location of `NEXT-SESSION-PROMPT.md`.

Do not say deployment, push, merge, or tests succeeded unless the relevant tool/command/workflow confirmed it.

## 4. Autonomy, Git, CI, merge, and deployment rules

The user authorizes an autonomous implementation workflow that should commit, push, merge, and deploy consistently when the existing repository process permits it. Apply these safeguards:

### Single integration owner

- Use one coordinating agent/session as the only writer, Git integrator, merger, and deployer across both repositories.
- Subagents may perform read-only audits or isolated implementation tasks, but must not independently push, merge, migrate production data, or deploy.
- Never have two sessions/agents mutate the same branch or deploy the same environment concurrently.
- Serialize writes and release operations across Web/source and Desktop. Coordinate shared API/schema changes before merging either side.

### Branching and commits

- Follow each repository's existing branch, commit-message, formatting, and PR conventions.
- Prefer a focused feature branch unless the repository's established workflow explicitly uses direct pushes.
- Commit coherent phase-sized changes with descriptive messages.
- Push after local tests pass and the diff is reviewed.
- Merge automatically only when the repository permits it and all required checks/reviews are satisfied.
- If branch protection requires a human review, do not bypass it. Leave a ready PR and report the exact required action.
- Never force-push, rewrite shared history, bypass branch protections, or delete branches with uncertain ownership.
- Never include credentials, tokens, `.env` files, signing material, or private local config in commits.

### Deployments

- Inspect and reuse the existing documented deployment pipeline. Do not invent a deployment command or environment.
- Do not deploy an incomplete feature to production merely because a session ended. Use preview/staging deployments during development when already supported.
- Production deployment should happen after the cross-platform integration and regression phase passes, unless the repository's existing CI/CD automatically deploys each qualifying merge. If auto-deploy is configured, verify the deployment and health check after each qualifying merge.
- Use additive/backward-compatible migrations and the project's established migration workflow. Never drop or rewrite user data to make the new feature fit.
- If a production migration is destructive, irreversible, lacks a backup/recovery path, or would invalidate old clients, stop before executing it and report the blocker. Do not interpret general deploy authorization as permission to destroy data.
- Verify the deployed revision/SHA and basic application health after deployment. If verification fails, follow the documented rollback procedure; do not improvise a destructive rollback.

### Shared workspace safety

- Check for concurrent agents, uncommitted changes, pending deployments, and lock/coordination files before every write/release.
- If another agent is actively changing the target repository or environment, do not race it. Coordinate or wait for a clean handoff within the current session; never silently overwrite its work.
- Preserve unrelated application features and existing UI.

## 5. Phases and priorities

Phases are ordered by dependencies. Do not begin wide UI work before the data/domain contract is understood.

### Phase 0 — Repository audit and implementation map

**Priority:** P0 — required first.

Tasks:

- Identify the exact Web/source and Desktop repositories and their remotes.
- Inspect current Kanban board, task cards, Add/Edit Task modal, Sprints page, task model, existing sprint structures, archive behavior, sync/persistence, APIs, date/calendar infrastructure, RTL, and tests.
- Map where shared feature rules belong in each application.
- Find existing calendar and Jalali conversion utilities; no new calendar system.
- Determine whether existing sprint, dependency, deadline, or archive code already exists.
- Record any discrepancies between the specification and existing behavior.
- Build a cross-platform data contract and migration plan.
- Establish baseline test/build results before changes.

Deliverables:

- Repository and architecture audit.
- File/component map for both apps.
- Phase-by-phase technical plan.
- Migration, sync, compatibility, and deployment plan.
- Updated `IMPLEMENTATION-STATUS.md` and next prompt for Phase 1.

No unrelated refactor. Do not assume table/model names.

### Phase 1 — Domain model, persistence, migrations, and invariants

**Priority:** P0.

Implement the smallest compatible data/domain changes in both persistence layers as applicable:

- Project-scoped sprints.
- Required name and case-insensitive uniqueness within a project.
- Optional emoji, description, and sprint due date.
- Lifecycle: Planned, Active, Paused, Completed.
- At most one Active sprint per project, enforced at the authoritative persistence/service layer, not only in UI.
- Zero-or-one task-to-sprint association.
- Optional personal task deadline and effective deadline precedence.
- Dependency relationships within one project, multiple blockers, cycle prevention.
- Deadline assignment/progress origin metadata and extension history if supported by the chosen model.
- Historical sprint snapshot/label for archived tasks when a deletable sprint is deleted.
- Sprint completion archiving only tasks in Implemented, preserving sprint associations.

Requirements:

- Inspect current schema before selecting implementation.
- Migrations must be safe, additive where possible, reversible where the existing project supports it, and compatible with existing task records.
- Do not duplicate existing concepts or build a second archive/calendar/sync system.
- Write domain and migration tests for constraints, uniqueness, concurrent activation, deletion semantics, completion archiving, inherited deadline calculation, and dependency cycles.

Deliverable: validated domain contract and persistence in both platforms, or an explicit compatibility plan if one platform must consume the other's API.

### Phase 2 — Backend/API, synchronization, and cross-platform contract

**Priority:** P0.

Implement/extend APIs and sync paths so Web and Desktop use identical meanings for:

- Sprint CRUD and lifecycle transitions.
- Sprint task assignment and project scoping.
- Sprint filter/query and task counts.
- Personal/inherited/effective deadline resolution.
- Sprint-wide and task-only extension operations.
- Dependency create/remove/list and reverse relationship counts.
- Archive and historical deleted-sprint metadata.

Important:

- Keep the one-active-sprint invariant atomic under concurrent requests/sync.
- Prevent cross-project dependencies and assignments.
- Preserve personal task overrides when sprint due dates change.
- Make sync conflict handling explicit; do not allow last-write-wins to create two Active sprints.
- Keep old clients/tasks functional during rollout.

Deliverable: tested cross-platform contract and API/sync compatibility.

### Phase 3 — Core Kanban and task-form UI (sprint integration)

**Priority:** P1.

Implement:

- Compact Sprint filter defaulting to All tasks, including No sprint.
- Sprint selector in Add/Edit Task.
- Sprint name + emoji/default icon in options.
- Quick `Create new sprint…` modal.
- Optional emoji picker.
- Description and due-date toggles OFF by default in sprint creation/settings.
- Compact sprint identity on task cards.
- No changes to the existing priority ribbon.

Deliverable: usable sprint assignment flow in both Web and Desktop, with RTL and responsive checks.

### Phase 4 — Sprint management, overview, and lifecycle

**Priority:** P1.

Extend the existing Sprints page and Kanban controls:

- Sprint list grouped by Planned, Active, Paused, and Completed history.
- Task counts and access to settings/tasks.
- Settings and task list/detail view.
- Sprint emoji display.
- Compact Kanban sprint overview with counts by the five existing statuses and total count only.
- Start/Resume, Pause, Finish controls.
- Active-sprint conflict modal asking to Finish or Pause the current sprint before starting another.
- Finish confirmation with exact archive/uncompleted counts; archive only Implemented tasks.
- Deletion confirmation for Planned/Paused sprints; never delete tasks; preserve archived task snapshot label.
- Completed sprints remain historical and cannot be deleted.

Deliverable: complete sprint lifecycle and history across both apps.

### Phase 5 — Deadline engine and UI

**Priority:** P1.

Implement:

- Personal task deadline OFF by default in Add Task.
- Sprint due date OFF by default in sprint create/settings.
- Inherited sprint deadline when task has no personal override and sprint is not Completed.
- Personal deadline precedence over sprint deadline.
- Inherited read-only line in Edit Task.
- Gregorian/Jalali selector using existing calendar infrastructure.
- Optional hour/minute control; date-only = 23:59 local time.
- Six presets with exact semantics.
- Card deadline row/bar placement and urgency thresholds.
- Neutral Done state for completed tasks.
- Completed sprint due date as historical, not active countdown.
- Deadline assignment origin and extension behavior.

Deliverable: parity in deadline calculation and UI across Web/Desktop, with timezone, Jalali/Gregorian, threshold, and override tests.

### Phase 6 — Deadline extension flows

**Priority:** P1.

Implement:

- Sprint deadline Extend action.
- Personal task deadline Extend action.
- Inherited-task Extend action offering sprint-wide and task-only choices.
- +24h, +48h, +72h, Custom date options.
- Presets add to the existing deadline.
- Impact previews for sprint-wide extension.
- Task-only choice creates personal override based on inherited deadline plus selected extension.
- Preserve original progress origin when extending.

Deliverable: tested extension flows and correct impact/sync behavior.

### Phase 7 — Task dependencies

**Priority:** P1/P2 after core sprint/deadline foundations.

Implement:

- Dependencies section collapsed by default in Add/Edit Task.
- Searchable multi-select `Blocked by`.
- Project-wide links, including cross-sprint links; no cross-project links.
- Multiple blockers and multiple blocked tasks.
- Reverse Blocks indicators derived automatically.
- Self-link and cycle prevention.
- Compact Blocked / Blocks N tasks card indicators.
- Completing all blockers resolves active blocked state.
- Informational/soft constraints: do not prevent Kanban movement or automatically alter priority/status.

Deliverable: tested dependency relationships, cycle checks, and Web/Desktop UI parity.

### Phase 8 — Cross-platform QA, regression, localization, accessibility

**Priority:** P0 release gate.

Run and fix:

- Existing project tests and builds in both repositories.
- Migration and old-data regression tests.
- Sprint lifecycle, deletion, and archive tests.
- Concurrent active-sprint tests.
- Deadline precedence, progress, 48h/7d thresholds, extension, timezone, and preset boundary tests.
- Dependency cycle, cross-project, multi-blocker, and resolution tests.
- Sync/offline/conflict tests using the repository's supported infrastructure.
- English LTR and Persian RTL.
- Gregorian/Jalali same-instant/date behavior.
- Responsive layouts and modal scrolling/focus behavior.
- Accessibility labels and color-independent status communication.
- Verify all existing features named in the specification continue working.

Deliverable: release checklist with reproducible test results and any remaining limitations.

### Phase 9 — Integration, merge, deployment, and handoff

**Priority:** P0 release gate.

- Coordinate compatible commits across Web/source and Desktop.
- Run final tests on the exact merge candidates.
- Push and merge using each repo's policy when required checks are green.
- Follow existing deployment/packaging workflows.
- Deploy Web using its existing pipeline and build/package Desktop using its existing process.
- Verify deployed Web revision and health; verify Desktop build/installer/package and smoke test.
- Ensure migrations have run safely and existing users' data remains intact.
- Update relevant in-repo documentation only where needed; avoid unrelated cleanup.
- Produce final user-facing implementation report and mark every acceptance item as Done, Not Done, or Blocked.

Do not claim cross-platform completion if either repository remains unimplemented or unverified.

## 6. Cross-platform sequencing

- Domain rules and data contract must be agreed before separate UI implementations diverge.
- If Web is the authoritative sync/API service, Desktop must consume the same contract and still maintain correct offline/local behavior where existing architecture requires it.
- If both apps persist locally, keep migrations and invariants semantically identical even if storage implementation differs.
- Merge backend/schema compatibility before shipping a client that depends on new fields.
- Preserve backward compatibility during rollout. Add new fields and APIs before requiring all clients to understand them.
- Keep Web and Desktop phases in the same session when a shared contract is changing; do not leave one client using incompatible semantics.

## 7. Definition of done

The feature is complete only when:

- All acceptance criteria in the consolidated spec pass.
- Both Web/source and Windows Desktop implement the same behavior.
- All migrations preserve existing data.
- Tests pass in both repos.
- UI matches the actual Hibana screenshots and this visual guide.
- The existing priority ribbon and unrelated features are preserved.
- Required PR/merge/deploy steps are complete or explicitly blocked by a human-only repository rule.
- `IMPLEMENTATION-STATUS.md` is final and `NEXT-SESSION-PROMPT.md` says no further implementation session is required (or describes remaining external-only tasks).
