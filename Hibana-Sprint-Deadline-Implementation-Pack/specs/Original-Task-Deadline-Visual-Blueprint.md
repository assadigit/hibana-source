# Hibana — Task Deadline System
## Visual Reference & UI Design Blueprint

**Project:** Hibana Kanban  
**Feature:** Optional Task Deadlines + Visual Deadline Progress  
**Platforms:** Web App + Windows Desktop App  
**Design deliverable:** High-fidelity desktop UI reference screenshot  
**Language of reference:** English  
**Primary goal:** Introduce deadline awareness into existing Kanban task cards and the Add/Edit Task modal without disrupting Hibana's existing visual identity.

---

# PART 1 — PRODUCT CONTEXT

## 1. What is Hibana?

Hibana is a personal project and idea management application. Its philosophy is:

**"A safe for my ideas."**

Its two fundamental responsibilities are:

1. Never lose an idea.
2. Never lose your place.

Hibana is designed for managing personal projects, ideas, tasks, and ongoing work.

The application supports:
- English and Persian.
- LTR and RTL interfaces.
- Gregorian and Jalali calendars.
- Kanban-based project and task management.
- Web and desktop applications.

The application already has an established visual identity and working interface. The new feature must feel like a natural extension of the existing product.

## 2. Technical background

There are two implementations:

### Web application
- Static HTML.
- htmx.
- Alpine.js.
- Fabric.js (whiteboard functionality only).
- Vanilla JavaScript.
- Hono + TypeScript backend.
- Cloudflare Workers + D1 SQLite or Node.js 24+ + SQLite.

### Windows desktop application
- Go.
- Wails v2.
- WebView2.
- modernc.org/sqlite.
- The desktop port has its own Kanban interface.

### Important calendar requirement

Hibana already has calendar-related backend functionality for Jalali and Gregorian dates.

**Do not invent a new calendar implementation.**

The design must demonstrate compatibility with both calendars. The eventual implementation must reuse the existing date-conversion, formatting, and calendar infrastructure.

The calendar selection is a presentation and input concern. The underlying deadline must remain consistent regardless of which calendar the user chooses to view it in.

The visual design should be suitable for both desktop and web implementations.

---

# PART 2 — EXISTING UI DESIGN LANGUAGE

## 3. Reference screenshot

Use the attached original Hibana Kanban screenshot as the primary design reference.

The original screenshot has a desktop viewport of approximately 1584 × 889 pixels.

Preserve its overall appearance and composition.

### General appearance

- Light theme.
- White/off-white background.
- Minimal, modern productivity application.
- Thin, subtle borders.
- Rounded task cards and buttons.
- Soft, pastel-colored Kanban columns.
- Restrained typography.
- Compact, information-dense layout.
- Minimal shadows.
- No excessive gradients.
- No glassmorphism.
- No unnecessary decoration.

The interface should feel practical, calm, mature, and professional.

It should not look like a generic project-management SaaS template.

## 4. Existing Kanban layout

The board currently contains five columns:

| Column | Existing visual identity |
|---|---|
| New Ideas | Soft blue |
| Problems | Soft coral/pink |
| Plans | Soft orange |
| In Progress | Soft golden yellow |
| Implemented | Soft green |

Preserve these column identities.

Each column has:
- A colored header.
- Column title.
- Task count.
- Column management buttons.
- A vertically stacked task list.
- An Add Task button.

The board also includes:

**Top navigation:**
- Workspace/project selector.
- Sprints.
- Labels.
- Sync.
- Refresh.
- Theme settings.
- General settings.
- Sign out.

**Board toolbar:**
- Task search.
- Priority filters: Urgent, High, Medium, Low.

Keep this existing structure.

## 5. Existing task card anatomy

The existing cards have a recognizable structure:

1. Priority-colored horizontal ribbon at the top.
2. Task title.
3. Optional task description or preview.
4. Existing creation/update timestamp.
5. Existing small action/status icons.

The priority ribbon is important to the current design.

**Do not replace the priority ribbon with the new deadline indicator.**

Deadline urgency and task priority are two different concepts.

For example:
- A low-priority task can have an urgent deadline.
- A high-priority task can have a deadline several weeks away.

The interface must communicate these two concepts independently.

---

# PART 3 — NEW FEATURE SPECIFICATION

## 6. Optional task deadlines

Every task should be able to have an optional due date.

A task without a deadline must remain completely valid.

There must be no automatic deadline assignment.

Users can create tasks without setting a deadline, and the existing task card appearance should remain unchanged for those tasks.

When a task has a deadline, the card should display:

1. A distinctive calendar-clock icon.
2. The due date.
3. Remaining-time information when useful.
4. A horizontal deadline progress indicator.

## 7. Date selection

The Add/Edit Task modal must contain a new section:

**Due date (optional)**

The section should communicate that a deadline is optional.

The date selection experience should provide two methods:

### A. Quick deadline presets

Display six compact preset buttons:

| Preset | Deadline behavior |
|---|---|
| Today | Today at 23:59 local time |
| In 24 hours | Exactly 24 hours from the current moment |
| In 48 hours | Exactly 48 hours from the current moment |
| In 72 hours | Exactly 72 hours from the current moment |
| This week | End of the current calendar week |
| This month | End of the current calendar month |

Important:

- Today must mean the current calendar day, ending at 23:59.
- The 24/48/72-hour presets are rolling time-based deadlines, not calendar-day approximations.
- This week and This month use calendar boundaries.
- Do not introduce holiday calendars.
- Do not introduce workday calculations.
- Do not skip weekends.
- Do not introduce business-day logic.

For the week boundary, reuse Hibana's existing calendar/locale convention if one exists. Do not invent a separate working-week system.

### B. Custom date selection

Users must be able to select an arbitrary future date using a calendar picker.

The date picker must visibly support:

- Gregorian calendar.
- Jalali calendar.

Include a clear segmented selector:

`Gregorian | Jalali`

The displayed date must follow the currently selected calendar.

For a visual example, the following dates represent the same day:

- Gregorian: 21 November 2026.
- Jalali: 30 Aban 1405.

Do not display two conflicting deadlines. They are two representations of the same underlying date.

## 8. Optional exact time

Time must be optional.

The default behavior should be date-only.

Include a discreet control:

`Add time (optional)`

When enabled, show an hour/minute selector.

When no time is specified, the deadline is the end of the selected calendar day:

**23:59 local time.**

For example:

- November 21 → November 21, 23:59.
- Today → Today, 23:59.
- November 21 at 14:30 → November 21, 14:30.

The interface must clearly communicate that the hour is optional and that users can set a deadline using only a date.

---

# PART 4 — TASK CARD DEADLINE DESIGN

## 9. New task card layout

The new deadline information must be positioned:

**Below the task description and above the creation/update timestamp.**

This placement is mandatory.

The card structure becomes:

1. Existing priority ribbon.
2. Task title.
3. Task description.
4. NEW: Deadline information row.
5. NEW: Deadline progress bar.
6. Existing creation/update timestamp.

The deadline row and progress bar should appear only when a deadline exists.

Do not introduce unnecessary empty space on cards without deadlines.

## 10. Deadline information row

Use a distinctive calendar-clock icon.

Example:

`[Calendar-clock icon] Due Nov 21 · 16 days left`

The information must remain compact.

The user should be able to understand the deadline without opening the card.

Use readable date labels rather than long technical timestamps.

Potential examples:

- Due Nov 21 · 16 days left
- Due tomorrow
- Due today
- Due Nov 7 · 2 days left
- Overdue by 1 day

The exact wording can be optimized visually.

## 11. Deadline progress bar

The progress bar is one of the most important elements of the new feature.

It must be horizontal, thin, and integrated into the task card.

### Required behavior

**Filling bar:**

The bar starts relatively empty when the deadline is first set.

As time passes and the deadline approaches, the bar fills from left to right.

When the deadline arrives, it reaches its maximum fill.

When overdue, the interface must clearly communicate the overdue condition.

### Important distinction

This is a deadline-time indicator, NOT a task completion indicator.

It communicates how much of the available time has elapsed.

Do not use completion percentages or language that suggests work completion.

### Visual urgency states

Use three distinct visual states.

**State 1 — Comfortable**

A task with a deadline relatively far away.

- Restrained green or sage accent.
- Low fill percentage.
- Calm visual appearance.
- No alarming badge.

Example:
`Due Nov 21 · 16 days left`

**State 2 — Approaching**

A task whose deadline is getting closer.

- Amber/orange accent.
- Moderate fill percentage.
- Clear remaining-time information.

Example:
`Due Nov 7 · 2 days left`

**State 3 — Urgent / Overdue**

A deadline that is imminent or has passed.

- Red accent.
- Almost-full bar for an imminent deadline.
- Clear overdue text when the deadline has passed.

Example:
`Due today`

Or:

`Overdue by 1 day`

Do not rely on color alone. Text and the icon must communicate the state as well.

### Visual integration

The bar should:
- Be approximately 4–6 pixels high.
- Have rounded ends.
- Fit the inner width of the task card.
- Have a subtle neutral background track.
- Avoid heavy borders.
- Avoid shadows.
- Not compete with the task title or priority ribbon.

Keep it compact enough that cards do not become unnecessarily tall.

The urgency colors must be separate from the existing priority colors.

Do not make every approaching deadline bright orange or every deadline bright red.

Use restrained color transitions consistent with Hibana's visual language.

---

# PART 5 — MODAL DESIGN

## 12. Add/Edit Task modal

The visual reference must show the Add Task modal OPEN.

This is necessary because the new deadline input experience is an important part of the feature.

Use the existing Hibana modal style as the reference.

The modal should look like it belongs to the current application.

Suggested modal structure:

### Existing fields

Preserve the existing task fields:

- Task title.
- Description.
- Priority.
- Labels.

Do not unnecessarily redesign these fields.

### New section: Due date (optional)

This section should be visually distinct but not excessively emphasized.

Suggested layout:

**Header:**

`Due date (optional)`

Small calendar-clock icon.

Optional state indicator.

**Calendar selector:**

`Gregorian | Jalali`

**Custom date field:**

Example:

`21 November 2026`

Calendar icon at the right or left depending on interface direction.

**Quick presets:**

Display six small chips, ideally in a compact grid or wrapping row:

`Today` `24 hours` `48 hours` `72 hours` `This week` `This month`

**Optional time:**

A small toggle or checkbox:

`Add time (optional)`

When disabled, no time selector needs to be visible.

When enabled, show a compact time selector.

**Helper text:**

`Without a specified time, the deadline is 23:59 on the selected day.`

This is useful but should not dominate the design.

### Modal footer

Preserve conventional actions:

- Cancel.
- Add task.

The primary action should use Hibana's existing teal/greenish accent treatment.

The modal should not feel like a completely new application module.

## 13. Suggested modal dimensions

For a desktop screenshot around 1584 × 889:

- Approximate width: 540–620 pixels.
- Centered vertically and horizontally.
- Comfortable inner padding.
- Consistent field spacing.
- Enough height for the deadline controls without unnecessary scrolling.

The modal should be large enough to show the complete deadline experience clearly.

Do not compress the controls into tiny unreadable elements.

The background Kanban board should remain recognizable behind it.

Use a subtle dimmed overlay.

---

# PART 6 — COMPOSITION OF THE VISUAL REFERENCE

## 14. What the final reference screenshot must show

Produce ONE complete high-fidelity desktop application screenshot.

It must simultaneously demonstrate:

**A. The existing Hibana application**

- Five original Kanban columns.
- Original column colors.
- Existing top toolbar.
- Search and priority filters.
- Existing card style.

**B. Different deadline states**

Include several task cards across the columns showing different deadline conditions:

| Card | Deadline presentation |
|---|---|
| Task A | Comfortable — muted green, low fill |
| Task B | Approaching — amber, moderate fill |
| Task C | Urgent — red, almost-full bar |
| Task D | Overdue — red state and overdue text |
| Task E | No deadline — existing card appearance, no deadline UI |

Make sure that there are both tasks with deadlines and tasks without deadlines.

This is important because deadlines are optional.

**C. Open Add Task modal**

The modal should demonstrate:

- Due date (optional).
- Gregorian/Jalali selector.
- Custom date field.
- Quick deadline presets.
- Optional time selector.
- Helper text explaining the 23:59 default.
- Cancel and Add task actions.

The modal is the main focal point of the image.

The task cards around it should still be visible enough to communicate how the feature works after a task is created.

## 15. Visual hierarchy

Recommended hierarchy:

1. Open Add Task modal.
2. Deadline controls inside the modal.
3. Deadline indicators on visible task cards.
4. Existing Kanban board.

Do not make the deadline progress bars larger or more prominent than the task titles.

The feature should feel native to Hibana rather than like an advertisement for a new capability.

---

# PART 7 — RESPONSIVE AND MULTILINGUAL CONSIDERATIONS

## 16. Web and desktop consistency

The same concept must work in:

- Hibana Windows desktop.
- Hibana web application.

Do not introduce desktop-only interactions into the design.

The reference screenshot can use a desktop layout, but the controls should be practical for ordinary browser use too.

## 17. RTL and Persian support

The image-generation reference should be in English because the purpose is to communicate visual design and avoid incorrectly generated Persian text.

However, the underlying design must be RTL-ready.

Account for:

- Persian text direction.
- Jalali date formatting.
- Right-aligned labels and fields in RTL.
- Correct placement of calendar icons.
- Appropriate horizontal alignment of quick preset buttons.
- Consistent progress bar behavior.
- Logical positioning of optional time controls.

Do not create a layout that only works in English LTR.

Mirroring the layout must not reverse the semantic direction of time progression.

---

# PART 8 — DESIGN CONSTRAINTS

## 18. Things that must NOT change

Do not redesign Hibana.

Do not:
- Change the Kanban column structure.
- Change the column identities or their pastel colors.
- Replace the priority ribbon.
- Change the overall application layout.
- Introduce a large calendar dashboard.
- Add a sidebar that doesn't exist in the reference.
- Turn the app into a generic project-management SaaS.
- Add unnecessary charts or graphs.
- Make the cards excessively large.
- Add excessive gradients or shadows.
- Introduce a full-page deadline dashboard.
- Turn deadlines into task completion percentages.

The purpose is to add one new feature, not redesign the product.

## 19. Important design principles

The result must be:

- Native to Hibana.
- Minimal.
- Practical.
- Immediately understandable.
- Visually balanced.
- Compact.
- Consistent with the existing task cards.
- Suitable for both Jalali and Gregorian calendar input.
- Suitable for both desktop and web.

---

# PART 9 — READY-TO-USE IMAGE GENERATION PROMPT

Use the following prompt in the other image-generation account.

**Attach the original Hibana Kanban screenshot as the visual reference.**

---

## IMAGE GENERATION PROMPT

You are a senior SaaS product designer and expert UI/UX visual designer.

I am developing a new feature for an existing application called Hibana Kanban.

I have attached a screenshot of the actual existing application.

Your task is to create ONE highly realistic, polished, high-fidelity desktop UI screenshot showing how the application would look after introducing a new feature called:

**Optional Task Deadlines with Visual Deadline Progress.**

### 1. Follow the reference image

Use the attached screenshot as the primary visual reference.

Do not invent a new design system.

Preserve the original:
- Application layout.
- Five Kanban columns.
- Column colors.
- Navigation.
- Buttons.
- Search field.
- Priority filters.
- Card geometry.
- Priority ribbons.
- Typography style.
- General spacing.
- Light theme.

The generated interface must look like the actual Hibana application after a careful feature addition.

It should not look like an unrelated SaaS template.

### 2. Existing application structure

The board has five columns:

- New Ideas — soft blue.
- Problems — soft coral.
- Plans — soft orange.
- In Progress — soft yellow.
- Implemented — soft green.

The top navigation includes:

- Workspace selector: SportSignal.
- Sprints.
- Labels.
- Sync.
- Refresh.
- Theme.
- Settings.
- Sign out.

Below that is the search and priority-filter area.

Keep these elements recognizable and consistent with the screenshot.

### 3. New task deadline feature

Tasks can optionally have deadlines.

Tasks without deadlines must retain their existing appearance.

Tasks with deadlines should show a compact deadline indicator.

Each deadline-enabled card should contain:

- A small calendar-clock icon.
- A short due-date label.
- Remaining-time information when useful.
- A thin horizontal filling progress bar.

**Critical positioning requirement:**

The deadline information and progress bar must be positioned immediately below the description and above the existing creation/update timestamp.

Do not put the deadline bar at the top of the card.

Do not replace the priority ribbon.

### 4. Show multiple deadline states

Show several different task cards throughout the visible Kanban board.

Include:

**Comfortable:**
- Muted sage/green accent.
- Short, low-fill progress bar.
- Text: "Due Nov 21 · 16 days left".

**Approaching:**
- Restrained amber accent.
- Medium-fill progress bar.
- Text: "Due Nov 7 · 2 days left".

**Urgent:**
- Restrained red accent.
- Almost-full progress bar.
- Text: "Due today".

**Overdue:**
- Red indicator.
- Clear text: "Overdue by 1 day".

**No deadline:**
- At least one ordinary card with no calendar icon or deadline progress bar.

The progress bar fills from left to right as the deadline approaches.

It represents elapsed time toward a deadline, not task completion.

Use representative visual fill lengths. Do not add percentage labels.

Keep the urgency styling independent of the existing task priority ribbons.

### 5. Open Add Task modal

This is the most important part of the composition.

Show an open Add Task modal in the center of the screen.

The existing Kanban board should remain visible behind it.

The modal should look native to Hibana.

Keep the usual fields:

- Task title.
- Description.
- Priority.
- Labels.

Introduce a new section:

**Due date (optional)**

This section should be expanded and populated in the example so that the new feature is clearly demonstrated.

Include:

**Calendar system selector:**

A compact segmented control:

`Gregorian | Jalali`

Gregorian is selected.

**Custom date field:**

`21 November 2026`

Show a subtle calendar icon.

**Quick deadline presets:**

Display six compact selectable chips:

`Today` `24 hours` `48 hours` `72 hours` `This week` `This month`

They should feel like native form controls, not large decorative buttons.

**Optional time setting:**

A toggle or checkbox:

`Add time (optional)`

The toggle is OFF in the example.

The default behavior is date-only.

Include subtle helper text:

"Without a specified time, the deadline is 23:59 on the selected day."

**Modal footer:**

- Cancel.
- Add task.

The Add task button should use the existing Hibana teal accent.

### 6. Visual design and dimensions

Use a desktop screenshot approximately 1584 × 889 pixels, with a 16:9 composition.

The visual style should be:

- Clean.
- Minimal.
- Modern.
- Calm.
- Professional.
- Light theme.
- White or near-white background.
- Thin gray borders.
- Soft rounded corners.
- Subtle shadows only where necessary.
- Clear typography.
- Moderate information density.

Use restrained pastel colors for the Kanban columns.

Use green, amber, and red only for deadline urgency.

The modal should be approximately 540–620 pixels wide and comfortably spaced.

It should be prominent without completely hiding the board.

### 7. Product authenticity

This is an existing application, not a conceptual redesign.

Preserve as much of the original interface as possible.

The new feature must look as though it was designed by the original Hibana product designer.

Do not over-design it.

Do not enlarge all task cards unnecessarily.

Do not overcrowd the deadline controls.

The result must look implementable in a real application using ordinary HTML, CSS, and JavaScript components.

### 8. Multilingual readiness

Render all visible text in English.

However, respect the fact that the actual application supports Persian RTL and both Jalali and Gregorian calendars.

The calendar selector must be visually explicit.

The date selection design must not depend on English-only layout assumptions.

### 9. Image quality

Produce one coherent application screenshot.

Not a collection of mockups.

Not a mood board.

Not an infographic.

Not a presentation slide.

Not a wireframe.

Not a conceptual illustration.

Generate a realistic, production-quality interface screenshot with crisp, correctly spelled UI text.

Avoid garbled text, malformed icons, overlapping controls, distorted alignment, unreadable typography, and arbitrary decorative elements.

**Final objective:** Anyone looking at this screenshot should immediately understand how Hibana's optional deadlines work, how users assign them, and how deadline urgency is communicated directly on Kanban task cards.

---

# PART 10 — FINAL DESIGN REVIEW CHECKLIST

Before accepting the generated visual reference, evaluate it against this checklist:

### Existing Hibana identity
- [ ] Original five Kanban columns are preserved.
- [ ] Original column colors are retained.
- [ ] Existing header and toolbar are recognizable.
- [ ] Existing priority ribbons remain intact.
- [ ] Task cards still look like Hibana cards.

### Task deadline indicators
- [ ] Deadline icon is visible.
- [ ] Date and remaining time are readable.
- [ ] Progress bar is below the description.
- [ ] Progress bar is above the creation timestamp.
- [ ] Bar fills as the deadline approaches.
- [ ] Comfortable, approaching, urgent, and overdue states are distinguishable.
- [ ] Tasks without deadlines remain unchanged.
- [ ] Deadline urgency is not confused with task priority.

### Add/Edit modal
- [ ] Due date is explicitly optional.
- [ ] Gregorian/Jalali selector is visible.
- [ ] Custom date field is visible.
- [ ] All six quick presets are present.
- [ ] Optional time control is present.
- [ ] The 23:59 default is explained.
- [ ] Existing task fields are preserved.
- [ ] Modal spacing is comfortable.

### Product compatibility
- [ ] The design is suitable for web and desktop.
- [ ] Jalali and Gregorian input are both accounted for.
- [ ] RTL compatibility is considered.
- [ ] No holiday or working-day logic has been introduced.

**Acceptance criterion:** The new feature should feel like it has always belonged to Hibana. It should improve deadline awareness without making the Kanban board visually noisy or changing the product's fundamental identity.
