# Hibana Kanban Polish & Go Desktop Readiness
## Agent Instruction Specification

**Repository:** `https://github.com/assadigit/hibana-source`  
**Existing product/domain:** Hibana — `hibana.ir`  
**Desired Kanban entry point:** `https://projects.hibana.ir/kanban`  
**Primary goal:** Make Hibana's project Kanban experience the fastest, clearest, most convenient part of the web app, while accurately documenting everything needed to build a future Go-based Windows desktop companion that works with the same Hibana cloud data.

---

## 1. Product context and intent

Hibana currently combines several kinds of task-management functionality, including to-do lists, calendars, notes, and project management. In day-to-day use, the owner spends approximately 90% of their time working with project Kanban boards. The wider feature set can distract from this main workflow, and using the app inside a browser tab is less convenient than a focused desktop experience.

The agreed strategy is:

1. **First:** polish, streamline, and optimize the existing web-based project/Kanban experience.
2. **At the same time:** accurately audit and document its complete functionality, options, behavior, data, and backend contracts.
3. **Later:** use this audited specification as the foundation for a Go-based Windows desktop alternative. The future desktop app must share the same Hibana account and cloud project data, using Hibana's existing Cloudflare Workers/D1 infrastructure where the audit confirms that architecture.

This task is **not** permission to start building the Go desktop app now. Prepare the web experience and create a reliable, evidence-based porting blueprint first.

## 2. Non-negotiable working rules

1. **Inspect before changing.** Read the repository, current router, frontend entry points, project/board components, state management, APIs, authentication, data models, database migrations, Cloudflare configuration, deployment scripts, tests, and existing documentation before choosing an implementation.
2. **Use repository evidence.** Do not guess how projects, tasks, permissions, authentication, or Cloudflare deployment work. In documentation, reference concrete source paths, symbols, API routes, schemas, migrations, or tests wherever possible. Mark anything unverified as unknown instead of presenting it as fact.
3. **Preserve Hibana.** Do not break or silently redesign the existing app's to-do, calendar, notes, authentication, account, or other unrelated areas. This scope is the project/Kanban experience and the minimum shared infrastructure genuinely required for it.
4. **Reuse existing systems.** Prefer existing project models, APIs, components, authentication, Cloudflare Workers, and D1 schema if they meet requirements. Do not create parallel project storage, duplicate accounts, or a new backend merely for the new route.
5. **Protect in-flight work.** Inspect the current Git branch, working tree, recent commits, and deployment state. Multiple agents may be working in parallel. Do not overwrite, revert, stage, commit, push, or deploy another agent's unrelated changes. Never force-push. Keep changes scoped and review the diff before committing.
6. **No fake completion.** Do not claim a subdomain, DNS record, custom domain, certificate, Worker route, build, test, or deployment is live unless it was actually verified. If credentials or access are unavailable, complete all safe repository work and document the exact remaining manual action.
7. **Avoid speculative refactoring.** Make the smallest coherent changes that deliver the requested experience. Do not introduce new frameworks or large dependencies without demonstrated need.
8. **Deliver working changes and documentation.** Do not stop after producing recommendations. Implement the safe, in-scope improvements, test them, and write the requested audit/porting documents.

## 3. Workstream A — Dedicated project Kanban entry point

### 3.1 Desired URL and routing

Create and verify this canonical entry point:

`https://projects.hibana.ir/kanban`

Interpret this correctly as the hostname `projects.hibana.ir` and the path `/kanban`. It is not a hostname containing `/kanban`.

The URL must open the project Kanban experience directly, not the general Hibana dashboard or a marketing/landing page. It must work on a fresh visit, after refresh, and when opened as a bookmarked URL.

Before implementing, determine how Hibana is currently hosted (for example, Cloudflare Pages, Workers, or another existing setup), how routes are handled, and how the primary domain is configured. Choose the routing and deployment approach compatible with that architecture. Avoid setting up a separate unrelated frontend deployment unless the repository/deployment design requires it.

### 3.2 Project selection and top navigation

Add a clear, compact top-level project navigation/menu on the Kanban experience so a user can quickly switch between projects and their respective boards.

Requirements:

- Show the current project clearly and make switching projects straightforward.
- Provide quick access to the Kanban board for each project the current user is authorized to access.
- Use existing project names, membership/ownership rules, and data; do not duplicate them in a local hard-coded menu.
- Handle a large project list sensibly (for example, searchable selection or another pattern appropriate to existing UI conventions).
- Preserve selected-project navigation across refresh and browser back/forward. Use stable project identifiers in a route or query parameter if appropriate to the existing router, while keeping `/kanban` as a working entry point.
- Define and implement a sensible default for `/kanban` when no project is explicitly selected. Prefer the existing product convention (such as last-used or most recently used accessible project). If no accessible project exists, show a helpful empty state and the existing affordance for creating or joining one, where supported.
- Respect authentication, access control, project permissions, and any current workspace rules. Never expose project names or data to unauthorized users.
- Avoid a full-page reload when switching projects unless the existing architecture requires it. Show a clear transition/loading state if loading is not immediate.
- Keep the menu keyboard-accessible and responsive. Ensure the selected state and focus state are visible.

Do not introduce a new workspace/team model. The existing Hibana experience is primarily used for personal projects; retain existing capabilities only where the current data model already supports them.

### 3.3 Direct navigation and compatibility

- Preserve existing URLs and navigation behavior used elsewhere in Hibana.
- If an equivalent project Kanban route already exists, reuse or redirect from it safely rather than creating two conflicting implementations.
- Ensure unknown project IDs, deleted projects, expired sessions, and unauthorized project access are handled predictably without leaking information.
- Check SPA fallback/routing behavior so deep links such as `/kanban/...` survive direct navigation and reloads.
- If custom-domain/DNS changes are required, document and perform them only through the existing, authorized deployment workflow. Verify TLS/HTTPS, host routing, login flow, and direct URL access before declaring success.
- Do not expose secrets, API tokens, or credentials in source files, build output, logs, screenshots, or documentation.

## 4. Workstream B — Polish the Kanban experience

The Kanban board is the primary daily-work surface. Prioritize clarity, speed, predictability, and low friction over decorative redesign.

### 4.1 Design principles

- Preserve Hibana's recognizable visual identity, but refine layout and hierarchy for a focused project-management workspace.
- Reduce distractions from unrelated app areas within the Kanban flow without removing or breaking those areas elsewhere in Hibana.
- Make project name, board context, columns, task cards, and primary actions easy to scan.
- Reuse existing design tokens, components, icons, and interaction conventions where sensible.
- Do not add ornamental animations, heavy visual effects, oversized headers, unnecessary panels, or redundant controls.
- Support the languages and directionality already supported by Hibana. Verify both RTL and LTR behavior where applicable, including menu alignment, icons, board scrolling, popovers, and keyboard navigation.
- Keep the board usable at common desktop sizes and on smaller screens. Do not break tablet/mobile access merely because desktop is the primary target.

### 4.2 Audit and improve existing interactions

Inspect the current implementation and preserve expected features, including any that are present in the repository:

- Creating, editing, opening, moving, and deleting tasks/cards.
- Creating, renaming, reordering, editing, archiving, or deleting columns/statuses, if supported.
- Drag-and-drop behavior for cards and columns, including clear drop targets and correct persisted ordering.
- Task details, descriptions, priorities, labels/tags, due dates, subtasks/checklists, dependencies, recurring rules, custom fields, and other supported task properties.
- Comments, activity/history, attachments, and related task metadata, where implemented.
- Search, filtering, sorting, grouping, saved views, and board-specific options, where implemented.
- Project settings, membership/permissions, templates, and other project-level options, where implemented.
- Empty states, loading states, validation, network errors, permission errors, and recovery behavior.

This list is an audit checklist, **not** a mandate to invent missing features. Confirm each item against actual code and product behavior. Do not quietly drop an existing project-related feature just because it is hard to extract.

Look for concrete friction: excessive clicks, redundant navigation, confusing labels, card density, slow board switching, lost state, disruptive refreshes, poor drag-and-drop feedback, inaccessible controls, and inconsistent RTL/LTR behavior. Improve verified problems without changing business semantics unexpectedly.

### 4.3 Data integrity and UX correctness

- Save changes reliably and make save/sync states understandable where relevant.
- Prevent double submissions and duplicate tasks from repeated clicks or retries.
- Preserve board ordering and task relationships across refreshes.
- Ensure optimistic UI updates roll back or recover correctly when a request fails.
- Confirm that moving a card to another column updates the actual underlying status/order correctly.
- Avoid losing unsaved user input when a dialog closes, the route changes, or a request fails.
- Ensure destructive actions have appropriate confirmation/undo behavior consistent with the current app.

## 5. Workstream C — Performance audit and optimization

Measure and inspect before optimizing. Do not claim that Rust, Go, or a refactor makes the current web app faster without measured evidence.

Investigate at minimum:

- Time to first useful Kanban render and time to a fully interactive board.
- Project/board switch latency.
- Card drag-and-drop responsiveness and persistence latency.
- Task create/edit latency.
- Unnecessary full-page navigation or data refetches.
- Excessive component re-renders, expensive derived calculations, oversized bundles, duplicated requests, N+1 API/database access patterns, and loading of unrelated features.
- Inefficient queries or missing pagination/limits where applicable.
- Large boards and projects with many cards.
- Offline/network failure behavior and recovery.

Requirements:

1. Record a baseline using a repeatable method before substantive optimization where feasible.
2. Fix demonstrated bottlenecks, not theoretical ones.
3. Avoid breaking current semantics or adding complicated caching without invalidation rules.
4. Include an after-change comparison for the same available checks. If production-like data or measurement access is unavailable, state the limitation and provide reproducible local measurements instead.
5. Establish measurable acceptance targets based on the observed baseline and realistic test hardware; do not invent impressive-looking numbers.
6. Keep future desktop needs in mind: prefer explicit, stable domain operations and separable business rules over UI-only behavior that cannot be reused or reproduced in a Go desktop client.

## 6. Workstream D — Exhaustive project-feature discovery for the future Go desktop app

This workstream is as important as the UI work. Build a source-backed inventory of the complete project-management/Kanban feature set and all user-visible options so the future desktop app can reproduce the behavior reliably.

### 6.1 Inventory what exists

Inspect implementation, UI, API, schema, migrations, validation, authorization, and tests. Document every project-related user capability and option found, including but not limited to:

- Project creation, selection, naming, descriptions, settings, lifecycle, archive/delete/restore behavior.
- Board types/views and project-to-board relationships.
- Columns/statuses, their names, order, configuration, and lifecycle.
- Cards/tasks, fields, defaults, allowed values, validation, and relationships.
- All task actions and context menus.
- Task details, comments, history/activity, attachments, checklists/subtasks, links, and supported metadata.
- Labels, priorities, due dates, dates, custom fields, dependencies, recurring behavior, and any other implemented capabilities.
- Filtering, sorting, searching, grouping, pagination, ordering, and saved preferences/views.
- Bulk actions, shortcuts, keyboard support, drag-and-drop rules, and confirmations.
- Empty/loading/error states, retries, undo/restore flows, and edge cases.
- Access control, user identity, project ownership/membership, and any workspace behavior actually present.
- API calls, Worker routes, request/response formats, data validation, rate limits, authorization checks, and database effects.
- File/attachment storage, upload/download flows, and URL/signature expiration where applicable.
- Feature flags, environment configuration, defaults, and migration requirements.

Do not document only visible buttons. Trace each significant behavior to its implementation and backend effects. Where the feature is implemented only partially or the user-facing UI differs from backend behavior, record that distinction.

### 6.2 Required documentation deliverables

Use an existing documentation structure if there is an appropriate established location. Otherwise create a clearly named folder such as `docs/project-kanban/`. Avoid cluttering the repository root, and do not duplicate existing specs unnecessarily. Update existing docs when that is the better option.

Create or update these deliverables:

#### A. `FEATURE-INVENTORY.md`

An exhaustive feature and option matrix. For each feature, record:

- User-facing name and purpose.
- Where it appears in the UI.
- Availability and prerequisites.
- Default values, choices, validation, and constraints.
- User actions and resulting behavior.
- Relevant frontend source paths/components/functions.
- Relevant API/Worker endpoints and backend behavior.
- Data entities, fields, relationships, and permissions involved.
- Known edge cases, current defects, and missing tests.
- Desktop parity classification: required, optional, not applicable, or undecided, with rationale.

#### B. `USER-FLOWS.md`

Describe key workflows step by step, including project selection, board opening/switching, creating/editing/moving cards, column management, filtering/search, task details, comments/attachments, permissions, failures, and destructive actions. Include relevant UI states and error/recovery paths. Add diagrams only where they materially clarify the flow.

#### C. `DATA-MODEL.md`

Document the actual project/board/task domain model and related entities. Include verified schema/table names, key fields, identifiers, relationships, enums/statuses, defaults, constraints, deletion/archival semantics, timestamps/revisions, and migration references. Distinguish frontend models from authoritative persisted schemas. Do not invent fields.

#### D. `API-AND-SYNC-CONTRACT.md`

Document the current, verified connection between the web client, Cloudflare Workers, D1, and any related storage/authentication systems. Include:

- Relevant endpoints/Worker handlers and methods.
- Authentication and authorization requirements.
- Request and response shapes, with source references.
- Pagination, ordering, filtering, rate limits, and error formats where known.
- How project/task changes are persisted and read by clients.
- Comment/activity and attachment behavior, where applicable.
- Current limitations that would block a second client.
- The proposed compatibility contract for a future Go desktop client.
- Which Worker/API changes, if any, would be required and how existing web clients remain compatible.

The desktop app must ultimately use the same Hibana accounts and cloud project data, not a separate silo. Do not design a new synchronization architecture from assumptions: first document what's real, then clearly separate recommendations from existing behavior.

For the future desktop design, evaluate and document appropriate handling for local SQLite persistence, offline changes, retry queues, idempotent operations, stable IDs, optimistic concurrency/conflict detection, deletion tombstones or equivalent deletion propagation, attachment transfer, authentication/token refresh, and multiple desktop installations. These are planning requirements for the future desktop phase, not permission to implement a desktop app now.

#### E. `GO-DESKTOP-PORT-PLAN.md`

A concrete, repository-specific porting blueprint covering:

- Which UI/components can be reused if using Go with Wails versus what must be rebuilt or adapted.
- How to separate domain behavior from browser-only routing/state.
- Recommended Go application structure, local persistence, configuration, logging, and error handling.
- Cloud API/authentication compatibility and offline-first synchronization design.
- Windows installer and portable executable considerations.
- Incremental milestones, dependencies, risks, and acceptance criteria.
- Features that must be preserved exactly versus safe desktop-specific improvements.
- Decisions that require the owner's input versus decisions the agent can make from source evidence.

Treat Go + Wails as the leading candidate because it can reuse a web frontend, but verify the current frontend and deployment before making a final recommendation. Do not assume Wails is mandatory if the source architecture suggests a better fit. Do not start implementing the Go app in this task.

#### F. `TEST-MATRIX.md`

Map core project/board features and important edge cases to manual or automated tests. Include route entry/direct refresh, project switching, permissions, task CRUD, drag-and-drop/order persistence, RTL/LTR where supported, network failures, authentication expiration, and regressions in unrelated Hibana areas. Identify gaps honestly.

All documents should be accurate, cross-linked, consistent, and usable by a future coding agent without requiring it to repeat the entire initial investigation.

## 7. Future desktop compatibility requirements (plan now, do not build yet)

The future Go-based Windows app is intended to be a focused desktop alternative for project/Kanban work. Its cloud data must remain the same as the existing Hibana web app.

While polishing the web version:

- Prefer clearly defined project/task operations and stable data contracts.
- Avoid making critical business rules exist only inside a visual component when they should be shared or represented in the API.
- Preserve existing API compatibility unless a necessary, backward-compatible change is justified and tested.
- Identify browser-only dependencies that will need an alternative in a desktop shell.
- Record which frontend code could be reused by Wails and which code depends too heavily on the current web app shell.
- Document authentication, local data caching, synchronization, conflict/deletion handling, and attachment flows before the desktop implementation starts.
- Do not add desktop-only abstractions to every component prematurely; only improve separation where it reduces real duplication or makes behavior more testable.
- Never put Cloudflare admin/API credentials or other privileged secrets in a desktop executable. The future app must call authenticated application endpoints, not privileged management APIs.

## 8. Scope boundaries

### In scope

- A reliable `projects.hibana.ir/kanban` entry point.
- A quick project/board switcher in the Kanban experience.
- Focused Kanban UX and usability refinements.
- Evidence-based performance improvements.
- Corrections to project-related bugs discovered during implementation, provided their scope and effects are understood.
- Thorough project feature/data/API/sync documentation for the later Go desktop app.
- Appropriate tests and deployment verification.

### Out of scope for this task

- Building the Go desktop app itself.
- Replacing Hibana's backend or changing frameworks without a compelling, verified reason.
- Rebuilding unrelated calendar, notes, or personal to-do experiences.
- Adding speculative new project-management features not present in the existing product.
- Replacing authentication, creating a second account system, or creating separate project storage.
- Breaking API compatibility with the existing Hibana web client.
- Broad redesign of the entire Hibana website.
- Unverified production infrastructure changes or untested deployments.

## 9. Required workflow

### Phase 1 — Reconnaissance and baseline

1. Check the current Git branch, dirty working tree, recent changes, repository conventions, and active/in-progress work.
2. Map the app architecture, routing, project/Kanban components, shared state, API, Worker, D1, authentication, domain/deployment configuration, tests, and documentation.
3. Run the existing relevant build, lint, type-check, and test commands. Record pre-existing failures separately from failures introduced by your work.
4. Capture a baseline for key Kanban interactions and performance where practical.
5. Identify unknowns and dependencies; verify them from code/configuration or mark them unresolved.

### Phase 2 — Feature audit and implementation plan

1. Begin the feature and API/data inventory while implementing the route/UX work; do not postpone all documentation until the end.
2. Define the narrowest safe plan for the dedicated entry point and quick-switch menu.
3. Identify high-value, evidence-supported UX/performance issues.
4. Do not block safe progress over minor unknowns. Use repository evidence and sensible defaults, but document meaningful uncertainty.

### Phase 3 — Implement and validate the web experience

1. Implement the route, project navigation, and required host/deployment configuration through the existing architecture.
2. Polish the Kanban board based on observed issues and the principles above.
3. Add or update tests for routing, switching, permissions, core board behavior, and regressions.
4. Compare available performance measures with the baseline.
5. Test direct navigation, page refresh, back/forward, signed-in/out states, accessible/unauthorized/deleted projects, no-project state, failure recovery, and RTL/LTR when supported.

### Phase 4 — Complete the desktop-readiness documentation

1. Finish the feature, user-flow, data-model, API/sync, porting, and test documents.
2. Verify their source references against the current tree and actual schema/endpoint implementation.
3. Mark recommendations, assumptions, gaps, and unresolved questions explicitly.
4. Make the desktop plan implementation-ready without starting the desktop codebase.

### Phase 5 — Final verification and delivery

1. Run relevant automated checks and manually verify the critical flows where access allows.
2. Review the entire diff for unrelated changes, secrets, accidental generated files, regressions, and broken links.
3. Confirm route/domain/deployment status with verifiable evidence. If not fully deployed, clearly separate repository completion from outstanding DNS/Cloudflare/platform actions.
4. Commit and push only the intended changes if authorized and safe. Before committing, make sure no other agent's work is included. Deploy only after checks pass, and follow the existing production release process.
5. Report exact files changed, tests run and results, performance findings, live deployment verification, known gaps, and any required manual action.

## 10. Acceptance criteria

The task is complete only when the following criteria are either verified or explicitly identified as blocked by inaccessible credentials/infrastructure:

### Web experience

- [ ] `https://projects.hibana.ir/kanban` resolves to the actual project Kanban experience.
- [ ] Direct opening, refresh, and supported deep links work correctly.
- [ ] The user can quickly switch among projects they are allowed to access.
- [ ] The selected project is maintained predictably during navigation and refresh.
- [ ] Empty, loading, error, expired-session, and unauthorized-project states are handled safely.
- [ ] The Kanban flow is visibly clearer and has measurable or documented usability/performance improvements.
- [ ] Core existing project features continue to work; unrelated Hibana functions have not regressed.
- [ ] Responsive layout, keyboard accessibility, and current RTL/LTR support are preserved.

### Engineering quality

- [ ] Existing checks pass, or pre-existing failures and new failures are clearly differentiated.
- [ ] Relevant tests cover the new route and project switching, with core Kanban regression coverage.
- [ ] No duplicate project data model or parallel authentication system was introduced.
- [ ] No secret was added to frontend or desktop-bound code.
- [ ] Deployment and DNS/TLS status is verified rather than assumed.

### Documentation and Go-port readiness

- [ ] The feature inventory covers actual project-related features and options, with source references.
- [ ] Key user flows include failure, permission, and recovery behavior.
- [ ] Project/task data models and relationships are grounded in source/schema evidence.
- [ ] Existing Worker/D1/auth/data contracts are documented accurately.
- [ ] Future Go desktop sync requirements and unresolved compatibility issues are identified.
- [ ] The Go desktop port plan includes a staged implementation path and measurable acceptance criteria.
- [ ] The test matrix maps important behavior to validation steps.
- [ ] The Go desktop app itself has not been prematurely implemented.

## 11. Final report format

At completion, provide a concise but evidence-rich report with these headings:

1. **What changed** — UI/UX, route, project navigation, performance work.
2. **Deployment status** — exact host/path checked, HTTPS/TLS status, tests used, and anything blocked.
3. **Performance results** — baseline versus after measurements, method and caveats.
4. **Documentation created/updated** — file paths and the important discoveries.
5. **Feature parity and gaps** — fully documented areas, uncertain behavior, missing tests, and desktop blockers.
6. **Validation** — commands/tests run and their results.
7. **Remaining actions** — only real, specific blockers or owner decisions.
8. **Git status** — branch, commit(s), push/deployment status; explicitly note if no commit or production deploy was performed.

Do not mark work complete merely because the code compiles. The goal is a better, verified Kanban web experience and a trustworthy blueprint for a future Go desktop app that shares Hibana's cloud data.
