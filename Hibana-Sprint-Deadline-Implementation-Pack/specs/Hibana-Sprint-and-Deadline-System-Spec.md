# Hibana — Sprint, Deadline & Task Dependency System

**Document type:** Product and implementation specification  
**Status:** Consolidated specification based on user decisions  
**Date:** 5 November 2026  
**Platforms:** Hibana Web + Windows Desktop  
**Primary surfaces:** Kanban board, Add/Edit Task modal, existing Sprints page

---

## 1. Purpose

Extend Hibana's existing Kanban functionality with three related but independent capabilities:

1. **Sprints:** reusable, project-specific groups of tasks with a lifecycle, optional description, optional due date, and emoji identity.
2. **Deadlines:** optional task-level deadlines, optional sprint-level deadlines, inherited task deadlines, visual time progress, urgency states, and controlled extensions.
3. **Task dependencies:** explicit relationships that communicate which tasks must be completed before other tasks can proceed.

This is a feature addition, not a redesign of Hibana. Preserve the established Kanban layout, task-card geometry, priority ribbon, colors, modal structure, and existing workflows.

## 2. Non-negotiable product principles

Keep these concepts independent throughout the data model, UI, and behavior:

| Concept | Meaning |
|---|---|
| **Task priority** | How important the task is. |
| **Sprint membership** | Which group of work the task belongs to. |
| **Deadline urgency** | How soon the task must be finished. |
| **Task dependency** | Whether another task must be completed first. |

A task may be Low priority but urgently due. A task may belong to the Security sprint but have no personal deadline. A task may be blocked by another task while retaining its existing priority and Kanban status.

**Do not merge these concepts.** In particular, do not replace or rewrite the existing priority ribbon with sprint names, dependency status, or deadline urgency.

---

## 3. Preserve Hibana's existing UI

Use the user-provided current Kanban screenshot and current Edit Task modal screenshot as the primary visual references.

### 3.1 Kanban board

Preserve:

- The existing five columns: **New Ideas, Problems, Plans, In Progress, Implemented**.
- Their existing pastel identities and header treatments.
- The current workspace/project selector and top navigation.
- The existing Sprints, Labels, Sync, Refresh, Theme, Settings, and Sign out controls.
- Search and the existing Urgent, High, Medium, and Low filters.
- Existing column controls and Add Task buttons.
- Existing task-card geometry, typography, spacing, priority ribbon, timestamps, and action icons.

### 3.2 Task cards

The existing priority ribbon remains at the top of each card and keeps its current meaning and appearance.

When applicable, add compact metadata without making cards excessively tall:

1. Existing priority ribbon.
2. Existing task title and description/preview.
3. Sprint identity: a small sprint icon or the sprint's emoji, followed by its name.
4. Deadline information row, only when an effective deadline exists.
5. Thin deadline progress bar, only when an active deadline exists.
6. Existing creation/update timestamp and existing actions.
7. A separate compact dependency indicator only when a task is blocked or blocks other tasks.

The deadline row and bar must appear **below the description and above the existing timestamp**. Do not put the deadline bar above the title or replace the priority ribbon.

Tasks without a sprint, deadline, or dependency keep their current appearance apart from any necessary spacing-neutral adjustments.

### 3.3 Add/Edit Task modal

Use the existing modal as the base; do not invent a new form design. Preserve the current controls and visual language, including the title editor/formatting tools where currently present, Status (where present), Priority, Category, Sprint, Tags, Upload File, and the existing footer.

Integrate new controls in the existing form rather than redesigning it:

- Sprint selection remains a normal task field.
- Dependencies are optional and collapsed by default.
- The task-level deadline section is optional and **OFF by default**.
- Place the deadline section between Tags and Upload File, consistent with the agreed design.
- Add mode must retain its normal Add Task action. Edit mode must retain its existing Delete, Synced, Cancel, and Save actions as applicable. Do not show an Edit-only Delete control in Add mode.

### 3.4 Visual tone

- Light theme, white/off-white surfaces, subtle borders, rounded controls, and restrained shadows.
- Preserve the app's existing teal/green primary action treatment.
- Avoid large gradients, glassmorphism, oversized cards, unnecessary charts, and decorative dashboard elements.
- Ensure all new controls are practical in both web and Windows desktop layouts.

---

# PART I — SPRINT SYSTEM

## 4. Sprint scope and identity

### 4.1 Scope

Sprints belong to an individual Kanban project/board. Each project has its own sprint collection. Sprints must not be shared across unrelated projects in the workspace.

### 4.2 Sprint fields

| Field | Requirement |
|---|---|
| Name | Required. |
| Emoji | Optional; chosen through a native emoji picker. |
| Description | Optional; its input is hidden behind an OFF-by-default toggle. |
| Due date | Optional; its controls are hidden behind an OFF-by-default toggle. |
| Status | Required lifecycle state. |
| Tasks | One-to-many association: a sprint can contain many tasks. |

If no emoji is selected, display Hibana's default sprint icon.

Display the emoji/default icon beside the sprint name in:

- The Sprint dropdown in Add/Edit Task.
- Sprint lists and the Sprints page.
- Sprint overview and task lists.
- Task cards.

### 4.3 Duplicate names

Sprint names must be unique within the same Kanban project, using case-insensitive comparison. For example, `Security`, `security`, and `SECURITY` are duplicates.

Names may be reused in different Kanban projects because sprint scope is project-specific.

Show a clear validation message when a duplicate name is entered. Do not silently rename the sprint.

## 5. Sprint lifecycle

The agreed lifecycle has four states:

| Status | Meaning |
|---|---|
| **Planned** | Created but not activated. |
| **Active** | The currently running sprint. |
| **Paused** | Temporarily stopped and eligible to resume. |
| **Completed** | Finished and retained in sprint history. |

### 5.1 Only one active sprint

A Kanban project can have **at most one Active sprint** at any time. Do not permit concurrent active sprints in the UI or data layer.

Planned and Paused sprints may coexist. Tasks that are not assigned to any sprint remain valid and visible; they may still require urgent attention.

### 5.2 Starting or resuming a sprint

Provide a clear **Start** or **Resume** action for a Planned or Paused sprint.

If another sprint is already Active, do not silently replace it. Show a confirmation modal that asks what to do with the current Active sprint:

- **Finish current sprint:** complete the current sprint using the Finish Sprint rules, then activate the selected sprint.
- **Pause current sprint:** set the current sprint to Paused, then activate the selected sprint.
- **Cancel:** make no changes.

The transition must be atomic from the user's perspective: the project must never end up with two Active sprints.

### 5.3 Finishing a sprint

Provide a clear **Finish** button and a confirmation modal. The confirmation should explain the effect and show how many tasks currently sit in Implemented and will be archived.

When a sprint is finished:

1. Change the sprint status to Completed.
2. Automatically archive **only tasks currently in the Implemented Kanban column**.
3. Keep those archived tasks associated with the completed sprint so they remain accessible through sprint history.
4. Leave all unfinished tasks in their current Kanban columns and retain their sprint associations.
5. Do not delete tasks.
6. Do not automatically move unfinished tasks to another sprint or Kanban column.
7. Do not rewrite their existing task priority.

The automatic archiving rule applies only at the moment the sprint is finished. It must not archive tasks in New Ideas, Problems, Plans, or In Progress.

Reuse Hibana's existing archive behavior and storage model if present. Do not create a parallel archive system.

### 5.4 Completed sprints

- Completed sprints remain accessible in history.
- Their tasks remain associated and viewable.
- Completed sprints cannot be deleted.
- Completed sprint deadlines are historical, not active countdowns.
- A completed sprint is not available for assigning new tasks.

### 5.5 Paused sprints

Paused is a distinct state, not an alias for Planned. Pausing does not remove task associations or change task Kanban statuses. A paused sprint can be resumed, subject to the one-active-sprint rule.

The sprint's due date and inherited deadlines remain defined while paused. Pausing alone does not delete or reset deadline information.

## 6. Deleting a sprint

Completed sprints cannot be deleted.

For a deletable sprint, deletion must never cascade-delete its tasks. Before deletion, show a confirmation modal with the number of associated tasks and explain exactly what will happen.

Recommended deletion behavior, matching the user's requested history semantics:

- Non-archived tasks remain in the Kanban and become unassigned (`No sprint`). Their priority, status, own deadline, dependencies, and other fields remain unchanged.
- Archived tasks remain archived. Preserve a historical sprint label/snapshot such as `Sprint: Security (deleted)` so the archive shows that the sprint existed and was deleted, rather than making it look like a completed/archived sprint.
- No task is deleted as a side effect.
- The confirmation should distinguish tasks that will become unassigned from archived tasks that will retain a historical deleted-sprint label.

Do not allow an Active sprint to be deleted directly. The user must first Pause or Finish it. Planned and Paused sprints may be deleted, subject to confirmation.

Example confirmation copy:

> Delete sprint “Security”? 12 tasks are associated with this sprint. 10 non-archived tasks will become unassigned. 2 archived tasks will remain in the archive with the label “Sprint: Security (deleted)”. No tasks will be deleted.

## 7. Sprint creation and management surfaces

### 7.1 Create sprint from a task modal

The Sprint dropdown in Add/Edit Task must provide:

- `No sprint`.
- Existing assignable sprints for the current project, with emoji/icon and name.
- `+ Create new sprint…`.

Selecting Create new sprint opens a small creation dialog. It must allow the user to enter the required name, optionally select an emoji, and optionally enable description and due date. After successful creation, make the new sprint available in the dropdown and select it for the current task (recommended default).

Validate duplicate names case-insensitively within the current project.

### 7.2 Sprint controls on Kanban

Most day-to-day sprint controls should remain in the Kanban experience:

- Start/Resume and Finish actions with clear labels.
- Sprint selection in Add/Edit Task.
- Quick sprint creation.
- Sprint filter.
- Sprint overview.
- Sprint task counts and distribution.

Avoid moving every sprint operation to a separate page.

### 7.3 Existing Sprints page

Build on Hibana's existing Sprints page; do not create an unrelated second sprint dashboard.

The page should primarily provide:

- An overview/list of all sprints belonging to the selected project.
- Sprint name and emoji/default icon.
- Lifecycle status.
- Task counts.
- Access to each sprint's settings and associated tasks.
- Completed sprint history, including archived tasks.

Keep most operational controls in the Kanban. The Sprints page is primarily for sprint **settings and tasks**, not a replacement for the board.

### 7.4 Sprint overview on Kanban

Provide a compact overview for the selected sprint with task counts across the existing Kanban columns. Example:

| Kanban status | Count |
|---|---:|
| New Ideas | 2 |
| Problems | 1 |
| Plans | 3 |
| In Progress | 4 |
| Implemented | 5 |
| **Total** | **15** |

This distribution is sufficient for the first implementation. Do not add an overall completion percentage or elaborate sprint analytics unless separately requested.

### 7.5 Sprint filtering

Add a Sprint filter to the Kanban toolbar.

- Initial default: **All tasks**, preserving today's board behavior.
- Include individual sprints as filter options.
- Include **No sprint** to show unassigned tasks.
- Filtering must not change task assignments or sprint states.
- Keep the existing task search and priority filters working together with the Sprint filter.

## 8. Sprint assignment rules

- A task can belong to zero or one sprint at a time.
- Multiple tasks can belong to the same sprint.
- `No sprint` is a valid and normal state, not an error.
- Existing tasks remain valid when no sprint exists.
- A task can be reassigned to another eligible sprint through Edit Task.
- Changing a task's sprint must not modify its task priority or personal deadline.
- If the task has no personal deadline, its effective inherited deadline is recalculated from the newly assigned sprint.
- Existing tasks assigned to a Paused or Completed sprint retain that association unless the user changes it; Completed sprint associations are historical.

**Implementation default where the user has not specified assignment policy:** do not allow new assignments to Completed sprints. Keep existing Completed-sprint associations intact. New assignment to Paused sprints should follow the existing Sprints page's current policy if one exists; otherwise default to allowing reassignment only to Planned or Active sprints and document that rule in the UI.

---

# PART II — DEADLINE SYSTEM

## 9. Optional deadlines

Deadlines are optional at both levels:

- A task may have its own personal deadline.
- A sprint may have a sprint-level deadline.
- A task may have neither.

Never assign a deadline automatically to a task or sprint.

### 9.1 Task deadline toggle

In Add Task, show a compact **Due date (optional)** toggle, OFF by default.

When OFF:

- Hide the calendar picker, calendar selector, presets, time controls, and helper text.
- Do not add a deadline.
- Keep the form compact.

When ON:

- Expand the complete task deadline controls.
- Allow the user to choose the calendar, date, preset, and optional exact time.

In Edit Task:

- If the task has a personal deadline, the toggle is ON and its saved settings are shown.
- If the task has no personal deadline, the toggle is OFF.
- If the task inherits a sprint deadline, keep the personal deadline toggle OFF and show a subtle read-only message, for example: `Using Security sprint deadline · Nov 12`.
- Turning the task deadline toggle ON creates a personal deadline override.
- Turning it OFF removes the personal override and returns the task to its sprint-inherited deadline, if one exists.

### 9.2 Sprint deadline toggle

Sprint creation/settings must show a compact **Sprint due date (optional)** toggle, OFF by default.

When OFF, hide date controls. When ON, show the same shared date-selection behavior used by task deadlines. This avoids duplicating calendar logic and ensures consistent Gregorian/Jalali behavior.

## 10. Deadline inheritance and precedence

A task's effective deadline follows this strict precedence:

1. **Personal task deadline**, if set.
2. Otherwise, **assigned sprint deadline**, if the task belongs to a sprint that has a due date and the sprint is not Completed.
3. Otherwise, **no active deadline**.

This yields the four agreed scenarios:

| Scenario | Display behavior |
|---|---|
| No sprint + no personal deadline | No deadline row or progress bar. |
| Personal deadline + no sprint | Show the personal task deadline and its progress. |
| Sprint deadline + no personal deadline | Inherit and show the sprint deadline. |
| Sprint deadline + personal deadline | Personal deadline overrides the sprint deadline for this task only. |

### 10.1 Inherited deadline UI

When a task has no personal deadline but inherits the sprint deadline:

- Keep the personal task deadline toggle OFF.
- Show a read-only explanation in the task modal, e.g. `Using Security sprint deadline · Nov 12`.
- On the task card, explicitly identify the source, e.g. `Sprint deadline · 7 days left`.
- Show the task's inherited deadline progress bar using the sprint's deadline timeline.

### 10.2 Personal overrides

Turning ON the task deadline toggle while a sprint deadline exists creates a personal override. The personal deadline becomes the effective deadline for that task; all other sprint tasks continue to inherit the sprint deadline.

Turning the personal deadline toggle OFF removes the override. The task returns to the sprint deadline if it has one.

Changing a task's sprint does not silently overwrite an existing personal deadline. If the task has no personal deadline, its inherited deadline follows the newly assigned sprint.

### 10.3 Completed sprint deadlines

Completed sprint deadlines remain historical. They must not continue to display a live countdown or active urgency bar for tasks that rely only on the completed sprint's deadline.

- Preserve the historical sprint due date and association.
- Use neutral/gray styling and historical wording where the date is shown.
- A personal task deadline remains independent of the completed sprint deadline.
- A completed task's deadline display also becomes neutral/gray and includes a clear Done/completed indication.

## 11. Calendar, time, and presets

Reuse Hibana's existing Gregorian/Jalali conversion, formatting, date picker, and locale infrastructure. Do not build a new calendar system.

The selected calendar changes presentation/input only. The underlying deadline instant/date must remain consistent.

### 11.1 Calendar selector

Provide an explicit segmented selector:

`Gregorian | Jalali`

Only the selected calendar representation is displayed as the editable date. Do not show two conflicting dates for the same deadline.

The design must support Persian RTL, right-aligned labels and fields, appropriate icon placement, and correct logical ordering.

### 11.2 Date-only default

Exact time is optional. If the user selects a date without a time, the deadline is **23:59 in the user's local timezone on that selected calendar day**.

Provide a discreet `Add time (optional)` control. When enabled, expose an hour/minute selector.

### 11.3 Quick presets

Provide six compact presets:

| Preset | Behavior |
|---|---|
| Today | Today at 23:59 local time. |
| 24 hours | Exactly 24 hours from the current moment. |
| 48 hours | Exactly 48 hours from the current moment. |
| 72 hours | Exactly 72 hours from the current moment. |
| This week | End of the current calendar week, using Hibana's existing locale/calendar convention. |
| This month | End of the current calendar month. |

Do not introduce workday calculations, holiday calendars, or weekend skipping.

### 11.4 Timezone

Use the user's local timezone and Hibana's existing date/time infrastructure. Do not invent a separate timezone or date-conversion implementation.

## 12. Deadline progress indicator

The progress bar measures **elapsed time toward a deadline**, not task completion.

### 12.1 Placement and appearance

- Place the deadline information row below task description and above the existing creation/update timestamp.
- Place the progress bar immediately below the deadline row and above the timestamp.
- Use a thin horizontal bar approximately 4–6 px high.
- Use rounded ends, a subtle neutral track, no heavy border, and no shadow.
- Keep the bar within the inner width of the card.
- Do not display a percentage.
- Fill chronologically from left to right, including in RTL layouts; mirroring the form layout must not reverse the semantic direction of time progression.

### 12.2 Progress calculation

Use the original deadline assignment timestamp as the progress start point. Calculate elapsed time between that start and the current effective deadline, then clamp the rendered fill between 0% and 100%.

- For a personal task deadline, the start point is when that deadline was first assigned.
- For an inherited sprint deadline, use the sprint deadline's original assignment timestamp as the shared start point for tasks inheriting it. **This is the recommended default from the clarification discussion and should be treated as an implementation assumption unless the user later changes it.**
- Extending or editing the deadline must not reset the original progress start point.
- Removing a deadline and later assigning a completely new deadline starts a new progress timeline.
- If the deadline has passed, the bar is full and the text communicates overdue status.

### 12.3 Urgency thresholds

Use the following agreed thresholds:

| Remaining time | State | Visual treatment |
|---|---|---|
| More than 7 days | Comfortable | Restrained sage/green. |
| More than 48 hours and up to 7 days | Approaching | Restrained amber/orange. |
| 48 hours or less, but not overdue | Urgent | Restrained red. |
| Deadline has passed | Overdue | Red, with explicit overdue wording. |

Do not rely on color alone. Use a calendar-clock icon and readable wording.

Examples:

- `Due Nov 21 · 16 days left`
- `Due tomorrow`
- `Due today`
- `Due Nov 7 · 2 days left`
- `Overdue by 1 day`
- `Sprint deadline · 7 days left`

### 12.4 Completed tasks

A task in Implemented or otherwise marked completed must retain its deadline information where appropriate, but use neutral/gray styling and a clear Done indication. Do not make a completed task look urgent or overdue in the active-work sense.

---

## 13. Deadline extensions

Provide an explicit **Extend** action for both sprint deadlines and personal task deadlines.

### 13.1 Extension choices

Offer compact choices:

- `+24 hours`
- `+48 hours`
- `+72 hours`
- `Custom date`

For preset extensions, add the selected duration to the **existing deadline**, not to the current moment.

For Custom date, allow the user to choose the new deadline using the existing Gregorian/Jalali date controls.

### 13.2 Extending a sprint deadline

When the sprint deadline is extended:

- Update the sprint deadline.
- All tasks inheriting that sprint deadline automatically reflect the new effective deadline.
- Tasks with personal deadline overrides remain unchanged.
- Before confirmation, show how many tasks inherit the deadline and will be affected, and how many are protected by personal overrides.
- Do not reset the original sprint deadline progress start point.

### 13.3 Extending a personal task deadline

When a task has a personal deadline, its Extend action changes only that task's personal deadline. Other tasks in its sprint are unaffected.

Do not reset the original personal deadline progress start point.

### 13.4 Extending an inherited task deadline

When a task inherits a sprint deadline, its Extend action must offer both choices:

1. **Extend sprint deadline** — change the sprint deadline and therefore affect all tasks inheriting it.
2. **Extend this task only** — create a personal task deadline override for this task, based on the current inherited deadline plus the selected extension. Other sprint tasks remain unchanged.

Show a clear impact preview before applying the sprint-wide choice. The task-only choice must not silently change the sprint deadline.

If the task-only extension creates an override, preserve the inherited deadline's original progress origin rather than making the bar look newly assigned.

---

# PART III — TASK DEPENDENCIES

## 14. Purpose and relationship model

Task dependencies communicate execution order: one task may need to be completed before another can proceed.

Example:

- Task A: Fix authentication architecture.
- Task B: Implement session security — blocked by Task A.
- Task C: Add security audit logging — blocked by Task A.
- Task D: Update security documentation — independent and ready.

Task A blocks B and C. Task B and C do not need manually duplicated `Blocks` entries; Hibana derives those relationships from the `Blocked by` links.

### 14.1 Scope

Dependencies are project-wide within a single Kanban project. They may connect tasks in different sprints or tasks with no sprint. Do not allow a dependency to cross unrelated Kanban projects.

### 14.2 Many-to-many relationships

- A task may be blocked by multiple tasks.
- A task may block multiple tasks.
- A task may have no dependencies.
- A task may not depend on itself.
- Prevent circular dependency chains.

## 15. Dependency controls

Add an optional **Dependencies** section to Add/Edit Task. Keep it compact and collapsed by default so ordinary task creation remains uncluttered.

The primary user input should be **Blocked by** with a searchable multi-select of eligible tasks in the same Kanban project. The UI should identify each task clearly by title and, where useful, its sprint.

Derive the reverse relationship automatically:

- If Task B is blocked by Task A, Task A displays that it blocks one task.
- Do not ask users to define the same relationship from both sides.

Do not change the task's priority, sprint, deadline, or Kanban status when a dependency is added.

## 16. Dependency indicators

Keep dependency status separate from the priority ribbon and deadline urgency.

Examples:

- On a blocking task: `Blocks 2 tasks`.
- On a dependent task: `Blocked` or `Blocked by: Fix authentication architecture`.
- When all blockers are complete: show a ready/resolved state, such as `Ready` or remove the active Blocked badge while retaining the relationship in task details/history.

Keep card indicators compact. Detailed blocker names belong in task details or the Edit Task modal, not in long card text.

When a blocker task is completed/Implemented, automatically resolve its blocking effect. If a task has multiple blockers, it remains Blocked until all required blockers are complete.

Retain dependency relationships as historical information; resolving a dependency must not erase the fact that the relationship existed.

### 16.1 Workflow enforcement

The user approved dependency relationships and visual indicators but did not explicitly decide whether they should hard-block Kanban movement. **Implementation default:** treat dependencies as informative/soft constraints. Clearly show Blocked status, but do not prevent users from moving or editing a task solely because it has unresolved blockers. Do not automatically change its Kanban status.

---

# PART IV — RTL, RESPONSIVE, DATA, AND IMPLEMENTATION

## 17. RTL and multilingual requirements

Hibana supports English LTR and Persian RTL, with Gregorian and Jalali calendars.

- All new fields, labels, helper text, badges, and modals must work in both directions.
- Use the existing translation/localization approach; do not hardcode new UI strings in one language.
- Right-align appropriate Persian labels and inputs.
- Place icons according to logical direction while preserving their meaning.
- Keep date/time values readable and consistent with the selected calendar.
- The deadline progress bar's time progression remains left-to-right even when the surrounding layout is RTL.
- Do not display conflicting Gregorian and Jalali deadlines simultaneously.

## 18. Web and Windows desktop consistency

The same product rules and data must work across the Hibana web app and Windows desktop implementation.

- Reuse existing APIs, persistence, sync, calendar infrastructure, task models, and archive behavior where available.
- Ensure sprint state, task assignment, dependencies, deadlines, and extensions synchronize consistently.
- Avoid desktop-only interactions that cannot be reproduced in the web app.
- Do not fork calendar or deadline logic independently between platforms.

## 19. Data integrity and compatibility

Before changing the data model, inspect the repository and existing implementations. Do not assume table names, model names, sync behavior, or migration conventions.

The implementation must support, at minimum, the following relationships and invariants:

- Sprints are scoped to one Kanban project/board.
- Sprint name uniqueness is case-insensitive within a project.
- At most one sprint per project is Active.
- Tasks have zero or one sprint association.
- Tasks may have a personal deadline override.
- Sprints may have an optional due date.
- Effective task deadline follows personal-over-inherited precedence.
- Dependencies connect tasks only within the same project and cannot form cycles.
- Deleting a sprint never cascades to task deletion.
- Completed sprints cannot be deleted.
- Completing a sprint archives only tasks in Implemented and preserves their sprint association.
- Sprint extension updates inherited deadlines but not personal overrides.

Use safe migrations and preserve existing task data. Existing tasks with no sprint and no deadline must continue to work exactly as before.

## 20. Repository-first implementation requirements

The coding agent must inspect the repository before making technical assumptions or modifying code.

At minimum, audit:

1. The current Kanban board and task-card rendering.
2. Current Add Task and Edit Task modal implementations and their differences.
3. The existing Sprints page and any sprint/task data model already present.
4. Existing archive behavior and how archived tasks retain metadata.
5. Existing calendar, Gregorian/Jalali conversion, date formatting, and timezone handling.
6. Existing sync/persistence behavior across web and desktop.
7. Existing task priority, Kanban status, and task filtering behavior.
8. Existing localization and RTL support.

Then produce a short implementation plan based on the actual repository. Reuse established patterns and components. Do not conduct unrelated refactors, reorganize unrelated folders, replace frameworks, or change unrelated functionality.

If a feature described here already exists partially, extend it instead of creating a duplicate implementation.

---

# PART V — ACCEPTANCE CRITERIA

## 21. Sprint acceptance checklist

- [ ] Each Kanban project has its own sprint collection.
- [ ] Sprint name is required and unique case-insensitively within that project.
- [ ] Emoji is optional, selectable through a native picker, and has a default icon fallback.
- [ ] Emoji/icon appears in dropdowns, sprint views, and task cards.
- [ ] Description and sprint due date are optional and hidden behind OFF-by-default toggles.
- [ ] Lifecycle supports Planned, Active, Paused, and Completed.
- [ ] No project can have two Active sprints.
- [ ] Starting another sprint while one is Active asks whether to Finish or Pause the current sprint.
- [ ] Finish has an explicit confirmation modal and archives only tasks in Implemented.
- [ ] Unfinished tasks keep their Kanban statuses and sprint associations when a sprint finishes.
- [ ] Completed sprint tasks remain accessible through sprint history.
- [ ] Completed sprints cannot be deleted.
- [ ] Sprint deletion never deletes tasks and clearly previews affected task counts.
- [ ] Archived tasks retain a historical `Sprint: [name] (deleted)` label when their sprint is deleted.
- [ ] Sprint dropdown supports No sprint, existing sprints, and quick creation.
- [ ] Sprint filter works with search and priority filters; default is All tasks.
- [ ] No sprint is a valid state for urgent/unassigned work.
- [ ] Sprint overview shows task distribution across the existing Kanban columns.
- [ ] Existing Sprints page is extended for sprint settings, tasks, counts, and history.

## 22. Deadline acceptance checklist

- [ ] Add Task deadline toggle is OFF by default.
- [ ] Calendar, presets, and time controls remain hidden until enabled.
- [ ] Edit Task shows the saved personal deadline when one exists.
- [ ] Inherited sprint deadline is shown read-only while the personal deadline toggle remains OFF.
- [ ] Turning ON creates a personal override; turning OFF removes it and returns to inheritance.
- [ ] Personal deadline takes precedence over sprint deadline.
- [ ] Tasks without an effective deadline show no deadline row or bar.
- [ ] Sprint and task deadline presets use the exact agreed behaviors.
- [ ] Date-only deadline defaults to 23:59 local time.
- [ ] Gregorian/Jalali selector reuses Hibana's existing calendar infrastructure.
- [ ] Deadline row appears below description and above the existing timestamp.
- [ ] Progress bar appears below the deadline row and represents elapsed time, not completion.
- [ ] Comfortable, Approaching, Urgent, and Overdue thresholds and styling are correct.
- [ ] Completed tasks show neutral/gray deadline treatment and a Done indication.
- [ ] Completed sprint inherited deadlines are historical and do not show active countdowns.
- [ ] Sprint extension affects inherited tasks but not personal overrides.
- [ ] Task extension affects only that task.
- [ ] Inherited task extension offers both sprint-wide and task-only choices.
- [ ] Extension presets add time to the existing deadline.
- [ ] Extensions preserve the original progress start point.

## 23. Dependency acceptance checklist

- [ ] Dependency controls are optional and collapsed by default.
- [ ] Dependencies can connect tasks across different sprints in the same project.
- [ ] Dependencies cannot cross projects.
- [ ] A task can have multiple blockers and can block multiple tasks.
- [ ] The user enters `Blocked by`; reverse `Blocks` information is derived automatically.
- [ ] Self-dependencies and circular dependencies are prevented.
- [ ] Cards show compact Blocked/Blocks indicators only when relevant.
- [ ] Completing a blocker resolves its blocking effect.
- [ ] A task with multiple blockers remains blocked until all blockers are complete.
- [ ] Dependencies do not alter task priority, sprint membership, deadline, or Kanban status.
- [ ] Existing priority ribbon remains unchanged.

## 24. Regression and quality checks

- [ ] Existing tasks with no sprint, deadline, or dependencies behave exactly as before.
- [ ] Existing search and priority filters continue to work.
- [ ] Existing task editing, rich-text behavior, labels/tags, file upload, sync, and archive behavior are preserved.
- [ ] Web and Windows desktop agree on sprint and deadline data.
- [ ] Persian RTL and English LTR layouts are checked.
- [ ] Gregorian and Jalali input/display are checked against the same underlying date.
- [ ] Deadline transitions are tested at threshold boundaries, including exactly 7 days and exactly 48 hours.
- [ ] Sprint activation, pause, resume, finish, and deletion flows are tested, including simultaneous requests or sync conflicts where relevant.
- [ ] Dependency cycle prevention and multi-blocker resolution are tested.
- [ ] Data migrations preserve pre-existing tasks.

---

# PART VI — EXPLICIT IMPLEMENTATION ASSUMPTIONS / ITEMS NOT FULLY SETTLED

The following defaults were recommended during clarification but were not separately confirmed by the user. Keep them visible during implementation rather than silently treating them as original requirements.

1. **Inherited progress origin:** use the time when the sprint deadline was first assigned as the progress start point for all tasks inheriting that deadline. Extending or editing the due date preserves this origin; removing and re-adding the deadline starts a new timeline.
2. **Dependency enforcement:** dependencies are soft/informational constraints. Show Blocked and Blocks indicators, but do not prevent Kanban movement or automatically change task status.
3. **New assignment to Paused sprints:** proposed default is to allow new assignments only to Planned or Active sprints. Existing assignments to Paused sprints remain. Follow an existing repository rule if one is already present; otherwise surface this behavior clearly.
4. **Task assignment to Completed sprints:** disallow new assignments, while preserving existing associations for history.
5. **Active sprint deletion:** require the user to Pause or Finish the sprint first. Planned and Paused sprints can be deleted after confirmation.

If repository behavior conflicts with one of these defaults, report the conflict before implementing a destructive or data-shaping change.

---

## Final product objective

Hibana should make it easy to understand **what matters, what belongs together, what must happen first, and how much time remains**—without turning its calm, compact Kanban interface into a noisy project-management dashboard.

The existing task priority remains the measure of importance. Sprint membership provides work context. Dependencies communicate execution order. Deadlines communicate time pressure. Each must remain understandable on its own and work together without replacing the others.
