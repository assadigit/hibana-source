# Hibana — Sprint, Deadline & Dependency Visual Reference Guide

**Purpose:** A precise UI brief for implementing the feature across Hibana Web and Hibana Windows Desktop.

**Important:** The reference set contains two genuine screenshots of the current application and several AI-generated exploratory mockups. The genuine screenshots are authoritative for the existing product. Generated mockups are illustrative only: do not copy their inaccurate text, altered layouts, wrong field labels, or occasional invented controls.

## 1. Visual source-of-truth order

Use this order whenever references appear to disagree:

1. `visual-references/original-ui/01-Actual-Hibana-Kanban-Board.png` — authoritative existing Kanban layout, column geometry, toolbar, colors, card proportions, and current control style.
2. `visual-references/original-ui/02-Actual-Hibana-Edit-Task-Modal.png` — authoritative existing Edit Task modal anatomy and control styling.
3. `specs/Hibana-Sprint-and-Deadline-System-Spec.md` — authoritative new feature behavior and product decisions.
4. `specs/Original-Task-Deadline-Visual-Blueprint.md` — original deadline visual brief; use it where it remains consistent with the consolidated spec.
5. Generated exploratory mockups in `visual-references/generated-explorations/` — inspiration for new controls and information placement, never a replacement for the actual app screenshots.

Do not redesign Hibana to resemble the generated images. The task is to extend the real existing interface.

## 2. Existing Hibana interface to preserve

### 2.1 Main Kanban board

The current board screenshot is a Windows desktop window around 1584 × 889 px. It contains:

- A narrow native window title bar.
- A top app navigation row with the `SportSignal` project selector on the left and Sprints, Labels, Sync, Refresh, theme, settings, and sign-out controls on the right.
- A second toolbar with task search and Urgent, High, Medium, and Low priority filters.
- Five existing columns: New Ideas (blue), Problems (coral/pink), Plans (orange), In Progress (yellow), and Implemented (green).
- Existing column controls, task counts, compact task cards, priority ribbons, timestamps, cloud/sync indicators, and Add task controls.
- An empty-state treatment in Implemented when there are no completed tasks.

Keep the five columns and their identities. Do not add a Sprint column, a deadline column, a separate permanent sidebar, or a full-page analytics dashboard.

### 2.2 Existing Edit Task modal

Use the supplied actual Edit Task modal as the base. It is a large centered white dialog over a dimmed board. Existing anatomy includes:

- `Edit task` heading, expand/full-screen control, and close button.
- Rich-text formatting toolbar.
- Title editor.
- Status chips: New Ideas, Problems, Plans, In Progress, Implemented.
- Priority chips: Low, Medium, High, Urgent.
- Category and Sprint selectors side by side.
- Tags input.
- Upload File control.
- Footer with Delete, Synced state, Cancel, and Save.

Preserve existing Add/Edit differences. Add Task must not accidentally show Edit-only Delete or Sync controls unless the repository already intentionally does so. Preserve the existing editor behavior and current field semantics.

## 3. Global new UI rules

- Keep the light theme, restrained typography, thin borders, subtle rounded corners, pastel column headers, minimal shadows, and teal/green primary action.
- Existing priority ribbon stays at the top of the card and retains its current meaning. Never replace it with sprint identity, dependency state, or deadline urgency.
- Sprint membership, task priority, deadline urgency, and dependencies must remain separate concepts.
- Additional metadata must be compact and must not make every task card much taller.
- Hide optional configuration behind toggles or collapsed sections by default.
- Do not put deadline controls on the main board as a separate dashboard or large widget.
- Use exact, readable English UI strings in the reference designs. The implementation must be localization-ready for Persian RTL.
- Use the project's existing icon library and component patterns. Emoji is only the optional user-selected sprint symbol; a neutral sprint icon is the fallback.

---

# 4. Page and interaction briefs

The following briefs cover every important screen/state that was not generated as a dedicated, readable image. Treat them as implementation-ready visual instructions.

## Screen A — Main Kanban board with sprint/deadline/dependency states

**Status:** A generated overview collage exists, but there is no sufficiently clean standalone full-screen board reference. Use the actual board screenshot as the foundation.

### Layout

- Preserve the complete existing top navigation and toolbar.
- Add a compact Sprint filter to the existing toolbar; do not create a new toolbar row unless the actual responsive width requires wrapping.
- Initial Sprint filter value: `All tasks`.
- Dropdown values: `All tasks`, each assignable/visible project sprint with emoji/icon and name, and `No sprint`.
- Existing search and priority filters must continue to work together with the Sprint filter.
- Keep the five existing columns, their order, colors, headers, and controls.

### Task card examples that should be visible across the board

Use varied examples to demonstrate the full system without turning every card into a feature demo:

1. **Ordinary task:** no sprint, no deadline, no dependency. It should look almost exactly like a current Hibana card.
2. **Sprint task with inherited deadline:** show the sprint emoji/icon and sprint name, then a compact deadline row such as `Sprint deadline · 7 days left`, followed by the thin progress bar.
3. **Sprint task with personal override:** show the sprint label and its own deadline row, e.g. `Due in 1 day`. The personal task date takes precedence over the sprint date.
4. **Blocked task:** show a small neutral/amber `Blocked` indicator and concise blocker reference in details; do not make it look like a task priority ribbon.
5. **Blocking task:** show a small `Blocks 2 tasks` indicator.
6. **Completed task:** when visible in Implemented, retain sprint/deadline history in neutral gray with a clear Done indication; do not show a live alarming overdue state.

### Card information order

1. Existing priority ribbon.
2. Existing title.
3. Existing description/preview.
4. Sprint identity (only when assigned): small selected emoji or default sprint icon + sprint name.
5. Deadline row (only when an effective deadline exists).
6. Deadline progress bar (only for an active deadline; no percent label).
7. Compact dependency indicator (only if blocked or blocking).
8. Existing timestamp and existing actions.

Keep the deadline row/bar below the description and above the existing timestamp. Keep dependency metadata compact; detailed names belong in task details.

### Acceptance checks

- All five existing columns remain visible at the desktop reference size.
- No deadline UI appears for an ordinary task.
- Priority ribbon is unchanged.
- Sprint and deadline labels do not collide or wrap into multiple noisy lines at ordinary card widths.
- The filter works with search and priority filters.

## Screen B — Add Task modal, default compact state

**Status:** A useful generated compact-form reference exists. Use it only as inspiration; preserve the actual Hibana form.

### Layout

Use the current Add Task modal and existing field order. Include the normal title/description, priority, category, sprint, tags, file upload, and Add Task action.

- Sprint selector is visible and optional.
- `No sprint` is a valid selection.
- Existing sprints appear with their emoji/default icon and name.
- A `+ Create new sprint…` or `Manage sprints` action is available from the selector.
- `Due date (optional)` appears as a compact toggle row, OFF by default.
- With the toggle OFF, show no date input, calendar system selector, presets, time field, or helper text.
- `Dependencies (optional)` appears as a separate collapsed section, not an always-open list.
- Keep spacing comparable to the current modal. No extra empty blank panel should remain when optional sections are collapsed.

### Add-mode footer

Use the existing Add Task primary action. Do not show Delete. Retain existing buttons and interactions.

### Acceptance checks

- Opening Add Task presents a compact form with due date OFF.
- No deadline is assigned automatically.
- A task can be saved without a sprint, deadline, or dependency.

## Screen C — Add/Edit Task modal, expanded personal deadline

**Status:** The expanded date controls appear in some exploratory mockups, but no image is a fully authoritative standalone reference.

### Trigger

Show this state only when the user turns on the task-level `Due date (optional)` toggle, or when editing a task that already has a personal deadline.

### Expanded controls

- Explicit `Gregorian | Jalali` segmented selector.
- One editable date field reflecting only the selected calendar.
- Six compact presets: `Today`, `24 hours`, `48 hours`, `72 hours`, `This week`, `This month`.
- `Add time (optional)` toggle, OFF by default.
- When time is OFF, helper text: `Without a specified time, the deadline is 23:59 on the selected day.`
- When time is ON, reveal hour/minute controls.
- Date-only deadlines resolve to 23:59 local time.
- Keep all controls within the existing modal width; use a compact grid or wrapping chips, never oversized tiles.

### Inherited deadline state in Edit Task

When the task has no personal deadline but inherits a sprint deadline:

- Personal `Due date` toggle remains OFF.
- Show a subtle read-only line: `Using Security sprint deadline · Nov 12` (substitute current sprint and formatted date).
- Show a nearby `Extend` action.
- Do not display the full date picker unless the user enables a personal override.
- Enabling the task due-date toggle creates a personal deadline override.
- Turning it off removes the override and returns to the inherited sprint deadline.

### Personal override state

If a task already has a personal deadline, show its date controls ON and saved values. Make clear that this date overrides the sprint deadline, without adding a large warning panel.

## Screen D — Sprint dropdown and quick creation

**Status:** Generated dropdown explorations exist; they are not exact implementation references.

### Dropdown content

- `No sprint` at the top.
- Eligible sprints for the current Kanban project, each with emoji/default icon, name, and optionally a subtle status label.
- A divider.
- `+ Create new sprint…` action.
- Optionally a `Manage sprints…` navigation action if this matches existing app patterns.

Do not list completed sprints as new assignment options. Retain existing associations to completed sprints for history.

### Quick create modal

Small dialog, not a full-page form:

- Required Sprint name field.
- Optional emoji picker; use existing/native picker behavior where available. If no emoji is selected, use the default sprint icon.
- `Add description` toggle OFF by default; reveal description textarea only when enabled.
- `Set due date` toggle OFF by default; reveal shared Gregorian/Jalali deadline controls only when enabled.
- Cancel and Create Sprint actions.
- Validate case-insensitive uniqueness within the current Kanban project and show an inline error without silently renaming.
- On success, close the dialog, refresh the dropdown, and select the newly created sprint for the current task (this is the recommended flow).

## Screen E — Existing Sprints page: list and overview

**Status:** No dedicated visual was generated. Implement this as an extension of the existing Sprints page, after inspecting it in the repository.

### Purpose

The page primarily exposes sprint settings and associated tasks. Most day-to-day start/finish/assignment controls remain available in Kanban.

### Layout

- Reuse the app's existing page header/navigation and project context.
- Title: `Sprints` or the existing localized equivalent.
- Primary action: `New Sprint`.
- Group or filter sprints by lifecycle state: Active, Planned, Paused, Completed history.
- Each sprint row/card shows: emoji/default icon, sprint name, lifecycle status, task count, and due date when present.
- Completed sprints appear in a history section and remain accessible.
- Do not turn this into a chart-heavy analytics dashboard.

### Sprint list row/card

Left: emoji/default icon + sprint name. Below: optional short description or due date. Right: lifecycle badge + task count + an action to open settings/tasks. Keep controls restrained.

### Acceptance checks

- Sprints are scoped to the currently selected Kanban project.
- Counts agree with actual task associations, including archived tasks where the relevant view says so.
- Completed history is accessible and not deletable.

## Screen F — Sprint details: Settings and Tasks

**Status:** No dedicated visual was generated. This is a required detailed state of the existing Sprints page.

### Structure

A sprint detail view or panel with the sprint icon/emoji and name at the top. Provide two clear sections or tabs:

1. **Settings** — name, optional emoji, optional description, optional due date, lifecycle state, and permitted actions.
2. **Tasks** — tasks associated with the sprint, grouped by their existing Kanban status or shown with a status label.

Avoid making a new analytics dashboard. The task overview may include the agreed count distribution across New Ideas, Problems, Plans, In Progress, and Implemented, with a total count only. Do not add completion percentage or complex charts.

Completed sprint task history must include tasks archived when Finish Sprint was confirmed. Unfinished tasks remain associated with the completed sprint in their existing board status.

## Screen G — Compact Sprint overview on Kanban

**Status:** Only exploratory collage references exist.

When a particular sprint is selected or opened from the Kanban Sprint control, show a compact overview/panel containing:

- Sprint emoji + name + lifecycle state.
- Optional sprint due date and remaining time if the sprint is not Completed.
- Task counts by existing Kanban status.
- Total task count.
- Relevant Start/Resume, Pause, Finish, or Settings action according to lifecycle state.

Use a simple count distribution/table or restrained horizontal count visualization. Do not add an overall completion percentage, burndown chart, workload graph, or unrelated analytics.

## Screen H — Sprint lifecycle confirmation modals

**Status:** No dedicated standalone visual was generated. These interaction states must be designed deliberately.

### H1. Activate another sprint while one is Active

Example: `Security` is Active and user starts `Performance`.

Modal title: `Another sprint is active`.

Explain that only one sprint can be Active in this Kanban project. Show the currently Active sprint and the sprint the user is trying to start.

Offer three explicit actions:

- `Pause Security & Start Performance`.
- `Finish Security & Start Performance`.
- `Cancel`.

For the finish option, explain that only tasks in Implemented will be archived, and show the count before the user confirms. Avoid silent lifecycle transitions. Ensure the transition cannot result in two Active sprints, including under sync/concurrent requests.

### H2. Finish Sprint confirmation

Modal title: `Finish sprint?`.

Show:

- Sprint name and optional emoji.
- Count of tasks currently in Implemented that will be archived.
- Count of unfinished tasks that will remain in their existing Kanban columns and remain associated with the completed sprint.
- Clear statement that no tasks will be deleted.

Actions: `Cancel` and a clearly labeled `Finish Sprint` confirmation button.

### H3. Pause confirmation

Keep the Pause action explicit. A lightweight confirmation is appropriate if the existing app's destructive/action conventions use one. Explain that tasks remain where they are and stay associated with the sprint.

## Screen I — Sprint deletion confirmation

**Status:** No dedicated visual was generated.

Completed sprints cannot be deleted. Active sprints must first be paused or finished. Only Planned and Paused sprints may be deleted.

Modal must show exact impact counts:

- Total associated tasks.
- Non-archived tasks that will become `No sprint`.
- Archived tasks that will remain archived with a historical label such as `Sprint: Security (deleted)`.
- Explicit statement: `No tasks will be deleted.`

Actions: Cancel and Delete Sprint. Use a restrained danger treatment only for the final destructive action. No cascade delete.

## Screen J — Deadline extension flows

**Status:** Only one exploratory extension-panel concept appears in the generated collage. Build the following states precisely.

### J1. Sprint deadline extension

Show sprint name/emoji, current deadline, current remaining-time label, and extension choices:

- `+24 hours`
- `+48 hours`
- `+72 hours`
- `Custom date`

Preset choices add to the existing deadline, not the current moment. Custom date uses the existing Gregorian/Jalali infrastructure.

Before applying, show counts for tasks that inherit the sprint deadline and tasks protected by personal deadline overrides. Confirm the impact. Do not reset the original sprint deadline progress start timestamp.

### J2. Personal task deadline extension

Show task title, current personal deadline, and the same four extension options. Explain that only this task changes. Presets add to the existing deadline. Preserve the original progress origin.

### J3. Extending an inherited task deadline

When the task currently inherits a sprint deadline, offer two clearly distinct paths:

1. `Extend sprint deadline` — show all inheriting tasks affected and personal overrides unaffected.
2. `Extend this task only` — create a personal override for this task, based on the current inherited deadline plus the selected extension.

Do not silently change the sprint deadline when the user intends a task-only change. Make the scope visible before confirmation.

## Screen K — Dependencies section in Add/Edit Task

**Status:** No dedicated visual was generated.

### Default state

Show a compact collapsed row: `Dependencies (optional)` with a small disclosure chevron. Keep it collapsed by default so common task creation remains clean.

### Expanded state

- Primary field label: `Blocked by`.
- Searchable multi-select of tasks in the same Kanban project only.
- Each result shows task title and, when useful, its sprint icon/name and current Kanban status.
- Support multiple blockers.
- Explain briefly that reverse `Blocks` relationships are calculated automatically.
- Prevent selecting the current task itself.
- Prevent any selection that would introduce a dependency cycle; show a clear inline explanation.
- Do not show a second editable `Blocks` field.

After saving Task B as blocked by Task A, Task A automatically shows `Blocks 1 task` (or the correct count).

## Screen L — Task dependency card states

**Status:** Only small illustrative dependency panels appear in the collage.

Use compact states:

- Blocking task: small badge `Blocks 2 tasks`.
- Blocked task: small badge `Blocked` plus a concise blocker title only when space allows.
- Multiple blockers: `Blocked · 2 tasks` rather than listing long titles on the card.
- Ready/resolved task: remove active Blocked badge once every blocker is completed; retain relationship detail in task details/history.

Do not change the priority ribbon or deadline color to represent dependency state. Dependencies are informational/soft constraints: they do not block Kanban movement and do not change task priority/status automatically.

## Screen M — Sprint/task card metadata variants

**Status:** Some variants are visible in generated collages; use this brief as the final reference.

Ensure the design visibly distinguishes:

1. No sprint / no deadline: no new metadata.
2. Sprint with no due date: emoji/icon + sprint name only.
3. Sprint-inherited deadline: sprint identity plus `Sprint deadline · X days left` and an active progress bar.
4. Personal override: sprint identity plus personal due date and progress; task deadline wins.
5. No sprint / personal deadline: personal due date and progress only.
6. Blocked: compact dependency badge independent of priority/deadline.
7. Blocks other tasks: compact Blocks count.
8. Completed task: neutral/gray deadline display with Done indication.
9. Completed sprint inherited date: historical neutral display only; no active countdown or urgent bar.

## Screen N — RTL/Persian and responsive states

**Status:** No Persian screenshot was generated because the generated images are English-only design references.

### RTL behavior

- Mirror field alignment and layout using the app's existing direction-aware conventions.
- Right-align Persian labels, inputs, helper text, and dropdown content where appropriate.
- Put icons at the logical leading/trailing edge based on direction.
- Preserve the semantic time progression of the deadline bar: fill still represents elapsed time toward deadline and must not reverse merely because the layout is RTL.
- Keep date values internally consistent. Gregorian/Jalali are two displays/inputs for the same underlying date, not two separate deadlines.
- Ensure sprint name, emoji, Latin task names, and date strings remain legible when mixed with Persian text.

### Responsive behavior

- Preserve the current desktop composition first.
- On narrow widths, reuse the existing Kanban's responsive behavior (such as horizontal board scrolling) rather than inventing a new navigation architecture.
- Modals may become wider relative to the viewport and scroll internally when needed; never clip primary actions.
- Optional deadline and dependency sections remain collapsed by default at every width.
- Keep Sprint filter discoverable without hiding search or priority filters.

---

# 5. Generated visual files: what each one is useful for

All generated images are exploratory. Some show earlier iterations where the deadline section is always expanded, some use invented sample values, and some are composite boards. Do not treat incidental content such as dates, priority selections, card names, column counts, or exact spacing as product requirements.

| File | Useful visual idea | Caution |
|---|---|---|
| `01-Generated-Design-Overview-Collage.png` | Broad visual inventory of board, task form, sprint settings, dependencies, overview | Composite is too dense to implement literally. |
| `02-Generated-Feature-Reference-Collage.png` | Many feature states in one place: sprint list, deadline extensions, dependencies, lifecycle | Use the written briefs for exact behavior and layout. |
| `03-Generated-Add-Task-Sprint-Dropdown.png` | Sprint selector and quick-create affordance | Dropdown labels/layout are exploratory. |
| `04-Generated-Compact-Add-Task-Modal.png` | Compact Add Task state with deadline toggle OFF | Preserve the real Add/Edit differences. |
| `05-Generated-Deadline-Modal-Early-Concept.png` | Early expanded task deadline controls | Shows an earlier visual direction, not the final form. |
| `06-Generated-Edit-Task-Deadline-Expanded.png` | Deadline controls integrated into an existing Edit Task form | Use actual screenshot for modal anatomy. |
| `07-Generated-Edit-Task-Jalali-Gregorian-Controls.png` | Calendar selector, presets, optional time treatment | Text and layout are exploratory. |
| `08-Generated-Edit-Task-Modal-Deadline.png` | Another expanded deadline modal arrangement | Not a precise copy target. |
| `09-Generated-Compact-Task-Modal.png` | Compact task form and collapsed deadline control | Sample values and wording may be imperfect. |
| `10-Generated-Sprint-Menu-Exploration.png` | Sprint dropdown with existing sprint options and management entry | Use actual project scope/status rules from the spec. |

## 6. Visual implementation review checklist

Before approving the UI, verify:

- [ ] The actual original screenshots, not generic SaaS templates, guided the implementation.
- [ ] Five original Kanban columns, their identities, toolbar, and current card design remain intact.
- [ ] Existing priority ribbon remains unchanged.
- [ ] Sprint filter defaults to All tasks and includes No sprint.
- [ ] Sprint identity uses emoji or default sprint icon, followed by the sprint name.
- [ ] Add Task deadline toggle is OFF by default; its controls are truly hidden while OFF.
- [ ] Dependencies section is collapsed by default.
- [ ] Inherited deadline is clearly identified as a sprint deadline.
- [ ] Personal deadline override is distinguishable from inherited sprint deadline in the modal.
- [ ] Deadline row and bar are below description and above timestamp.
- [ ] Completed sprint deadline is historical/neutral, not actively urgent.
- [ ] Create Sprint supports required name, optional emoji, optional description toggle, and optional due-date toggle.
- [ ] Lifecycle controls and all destructive/major transitions have clear confirmation UI.
- [ ] Sprint deletion preview distinguishes unassigned active tasks from archived tasks with deleted-sprint history.
- [ ] Deadline extension UI clearly communicates task-only versus sprint-wide impact.
- [ ] Dependency indicators do not replace task priority or deadline urgency.
- [ ] English LTR and Persian RTL states are checked.
- [ ] No optional section leaves a large empty area when collapsed.
