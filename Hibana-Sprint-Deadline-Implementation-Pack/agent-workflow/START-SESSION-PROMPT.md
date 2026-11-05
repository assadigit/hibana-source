# Start Prompt — Hibana Sprint, Deadline & Dependency Implementation

You are the lead autonomous product engineer and integration owner for Hibana. Implement the feature in **both Hibana Web/source and Hibana Windows Desktop** using this package as the product/visual source of truth.

## First: locate and safely extract the package

The user may upload `Hibana-Sprint-Deadline-Implementation-Pack.zip` into the Web/source repository root. If the extracted folder is absent but the ZIP exists, inspect its contents and safely extract it into `Hibana-Sprint-Deadline-Implementation-Pack/`. Do not overwrite an existing extracted folder or any user changes; compare versions and reconcile first. Verify that the archive contains this prompt, the consolidated spec, the visual guide, the original screenshots, and the generated images.

## Read the project package completely

Before editing code, read:

1. `README.md`
2. `specs/Hibana-Sprint-and-Deadline-System-Spec.md`
3. `VISUAL-REFERENCE-GUIDE.md`
4. `specs/Original-Task-Deadline-Visual-Blueprint.md`
5. `agent-workflow/PHASED-MULTI-SESSION-IMPLEMENTATION.md`

Inspect the two actual screenshots under `visual-references/original-ui/`. They define the current Hibana UI. Generated images are exploratory only and must never override the actual screenshots or written requirements.

## Mission

Deliver the sprint, deadline, and task-dependency system exactly as specified, in both Web/source and Windows Desktop. Preserve existing application identity, architecture, and unrelated functionality. This is a feature addition, not a redesign or broad refactor.

A known Web/source repository reference is `https://github.com/assadigit/hibana-source`; verify the exact active remote before use. The Windows Desktop repository URL is not stated in this package: discover it from the current workspace, configured Git remotes, submodules, project documentation, or environment. Do not guess a remote. If it cannot be found/accessed, report that specific blocker and do not claim Desktop work is complete.

## Work autonomously across multiple sessions

Follow `agent-workflow/PHASED-MULTI-SESSION-IMPLEMENTATION.md` exactly.

- Begin with Phase 0 repository/architecture audit. Do not begin broad feature coding before understanding both repositories, current sprint/archive behavior, sync, calendars, and deployment workflows.
- Continue through phases in the stated priority order. Complete a coherent phase per session; do not stop after merely proposing a plan if the environment and repository are accessible and the work is safe to proceed.
- Do not ask the user questions that the package or repository can answer. Make only the documented implementation defaults where the spec explicitly leaves a choice open, and record them.
- If a genuinely blocking ambiguity or missing repository/permission prevents safe progress, explain the exact blocker and continue independent work that does not depend on it.
- At the end of EVERY session, update `agent-workflow/IMPLEMENTATION-STATUS.md` and write a complete next-phase prompt to `agent-workflow/NEXT-SESSION-PROMPT.md`. The next session must be able to continue using those files without reconstructing chat history.
- Finish each session with a concise report: code changes by repo, tests/builds, commit SHAs, push/PR/merge/deploy status, blockers, and the next session's prompt location.

## Autonomous Git / commit / push / merge / deploy authorization

The user explicitly requests consistent automatic commits, pushes, merges, and deployments as the work progresses. Execute these automatically when allowed by each repository's existing policies and the safeguards below.

1. Use one coordinating integration owner for all writes, Git operations, merges, and deployments across both repos. Subagents may audit/read or work in isolated branches, but never independently push, merge, or deploy.
2. Serialize changes and releases. Never let two agents/sessions mutate the same branch or deploy the same environment concurrently. Check for active agents and uncommitted work before writing.
3. Follow each repository's established branch, PR, commit, CI, deployment, and packaging conventions. Do not invent deployment commands.
4. Run the relevant tests/build/lint/type checks before committing and pushing. Review the final diff for unrelated changes and secrets.
5. Commit coherent phase-sized work with clear messages. Push the feature branch after checks pass.
6. Merge automatically only when all required checks/reviews are satisfied and repository rules permit it. Never bypass branch protection, required human approval, or required status checks. If a human review is required, leave a ready PR and identify the exact required approval.
7. Never force-push, rewrite shared history, delete uncertain branches, discard uncommitted changes, or overwrite other agents' work.
8. Deploy using the existing documented pipeline. Use preview/staging during development when supported. Production deploy should occur after cross-platform QA unless the repo's established CI/CD automatically deploys qualifying merges; in that case verify each deployment.
9. Do not run destructive/irreversible production migrations or drop user data. Use safe, additive, backward-compatible migrations and the existing backup/recovery procedures. Stop before any destructive operation that lacks a verified recovery path.
10. After deployment, verify the exact deployed commit/SHA, environment URL, basic health/smoke checks, and migration state. Use the documented rollback path if a release is unhealthy; do not improvise a destructive rollback.

## Required feature behavior — do not reinterpret

- Sprints are project/board-specific; required name; case-insensitive unique per project; optional emoji with default icon fallback; optional description and due date hidden behind OFF toggles.
- Lifecycle: Planned, Active, Paused, Completed. At most one Active sprint per project.
- Starting another sprint while one is Active requires asking whether to Finish or Pause the existing sprint. Never allow concurrent active sprints.
- Finish changes sprint to Completed and archives only tasks in Implemented. Other tasks keep their Kanban status and sprint link. Completed sprint cannot be deleted.
- Deleting a Planned/Paused sprint never deletes tasks: active tasks become unassigned; archived tasks retain a historical `Sprint: [name] (deleted)` label/snapshot. Show impact counts before deletion.
- A task belongs to zero or one sprint. `No sprint` remains a normal valid state.
- Sprint dropdown supports existing sprints and quick create. Kanban Sprint filter defaults to All tasks and has No sprint.
- Sprint overview shows counts per existing Kanban status and total count only; no unrequested analytics.
- Task deadline OFF by default in Add Task; all date controls stay hidden while OFF. Edit inherited deadline displays a read-only `Using [Sprint] sprint deadline · [date]` line while personal deadline remains OFF.
- Personal task deadline overrides sprint due date. If no personal deadline exists, task inherits an eligible sprint deadline. Completed sprint deadlines remain historical, without active countdown.
- Date-only deadline = 23:59 local time. Reuse existing Gregorian/Jalali/date/timezone infrastructure. Presets retain their exact specified semantics.
- Deadline bar is time elapsed toward deadline, not task completion; position below description and above timestamp. Use >7d sage, >48h to 7d amber, <=48h red, overdue red with text. Completed tasks display neutral gray + Done.
- Extend exists for sprint and task deadlines. +24/+48/+72 add to the existing deadline; Custom date uses existing calendar system. Extending an inherited task offers sprint-wide OR task-only override with impact preview. Preserve original progress origin.
- Dependencies are optional/collapsed by default, project-wide (including across sprints), never cross-project, support multiple blockers, and prevent self/circular links. User sets Blocked by; reverse Blocks is derived. Dependency badges remain separate from priority/deadline. Dependencies are soft constraints; do not automatically change priority/status or prevent Kanban movement.
- Keep existing task priority ribbon and current card/modal design. Reuse existing app patterns and APIs/storage/archive/sync where possible. No unrelated cleanup.

## Session 1 required work

1. Verify the extracted package path and all files are present.
2. Inspect workspace directories and all Git remotes; identify Web/source and Desktop repos with evidence.
3. Audit current Kanban, task editor, Sprints page, data models, APIs, archive, sync, date/calendar/Jalali, RTL, tests, CI, deployment and packaging workflows in both repos.
4. Run baseline tests/builds without changing unrelated files.
5. Create/update `agent-workflow/IMPLEMENTATION-STATUS.md` with repository map, baseline results, findings, risks, and a phased technical plan.
6. Do not implement feature code in this first audit session unless the audit is complete, the architecture is clear, and a small foundational change is low risk; prioritize delivering a trustworthy map and the next prompt.
7. Write `agent-workflow/NEXT-SESSION-PROMPT.md` for Phase 1 with exact files/subsystems to inspect/modify, test commands, dependencies, and expected commit boundary.

## Stop/report conditions

Stop only for a real blocker: missing Desktop repository identity/access; missing required credentials; production deploy permission/policy not available; an unsafe destructive migration; an unresolved conflict with existing product behavior that cannot be safely reconciled; or repository policy requiring human approval. Do not stop simply because the project is large. Report exactly what is blocked and complete safe independent work.

Start with Phase 0 now.
