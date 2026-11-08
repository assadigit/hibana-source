# Hibana — Ideas Section Redesign: Build Spec

**Audience:** the coding agent implementing this. This document is self-contained — you don't need prior chat context to act on it.

---

## ⚠️ Read this first — reuse, don't rebuild

Most of what's described below already exists elsewhere in Hibana's codebase in a working form. This pass is about **extending and re-wiring existing components**, not building new subsystems. Before writing new code for any item below, check whether one of these already does the job:

| Need | Already implemented as | Reuse instruction |
|---|---|---|
| Folder banner image upload | Project logo upload (file-picker, no drag-drop) | Reuse the same component/endpoint; add a crop step (see #1) |
| Idea picture upload | Project/idea screenshot upload mechanism | Reuse directly; only needs minor tweaks (see #6, #7) |
| Idea links | Project template's Links field (multiple, named) | Reuse directly, unchanged |
| Pastel color swatches | Category color system (already curated, ~16 pastel colors) | Reuse the same palette for Folder placeholder backgrounds (see #3) |
| Drag-reorder | Already used for Projects and Hurdles checklists | Explicitly **not** used for the idea list — see #14, this is a deliberate exception |
| "N unsynced changes" pattern | Already specified for Canvas offline queue | Not reused here, just noted as an existing UI pattern if similar feedback is ever needed |

If you find another existing mechanism that overlaps with an item below and it isn't listed here, prefer extending it over writing a parallel implementation.

---

## Context: what's being fixed

The Ideas section currently reuses the full Project template for every idea — meaning a brand-new, empty idea opens into a 5-column Kanban board, 6 tabs, and empty state after empty state. ~95% of ideas are casual, one-line-and-done captures (podcast concepts, content sparks, one-off notes) that will never need a Kanban board. This spec makes the Ideas section its own lean surface, reusing existing components rather than the heavy Project template.

**Data model note (unchanged, for context):** Ideas and Projects remain the same underlying record — an idea's status can still move it into full Project territory later. This spec only changes what renders and what fields are exposed at the Idea/Spark stage; it does not change the schema's status taxonomy.

---

## 1. Folder banner upload

- **Context:** Folder (Category) page header — banner image upload.
- **Technical instruction:** Reuse the existing project-logo upload component for the Folder banner: file-picker only, no drag-and-drop dropzone, no preset gallery. After the user selects an image, open a crop tool with a fixed wide aspect ratio (~2.5:1) that lets the user reposition and resize the crop box before saving.
- **Why:** Reuses an already-built, familiar upload interaction (Jakob's Law) instead of introducing a second pattern; the fixed-ratio crop keeps every Folder banner visually consistent.

## 2. Empty banner placeholder

- **Context:** Folder page — before any banner has been uploaded.
- **Technical instruction:** Show the category's existing pastel accent color (the same swatch already used for its tag/category color) as a solid placeholder background. Overlay a small, centered text prompt inviting the user to upload a banner.
- **Why:** Reuses the pastel palette already in the app instead of introducing a new color system; the prompt turns an empty state into a discoverable action.
- **Note:** Check the prompt text's contrast against the pastel background for WCAG AA — it sits on a colored surface, not a neutral one.

## 3. Folder header metrics

- **Context:** Folder page header, near/under the banner.
- **Technical instruction:** Display two stats inline: total idea count in the Folder, and a "last updated" relative timestamp. Bump "last updated" on any field edit to any idea in the Folder — title, description, tags, links, or image.
- **Why:** Matches how "Updated" already behaves elsewhere in the app (existing List view's "Xd ago" column) rather than introducing a narrower definition just for Folders.

## 4. Idea card thumbnail

- **Context:** Idea card, in Cards/Sticky/List views.
- **Technical instruction:** If the user has manually marked one uploaded image as the cover, always use it as the card thumbnail. If no cover is manually set, default to the most recently uploaded image, updating automatically as new images are added.
- **Why:** Gives control when the user cares (manual cover) while staying zero-friction the rest of the time.

## 5. Pinning

- **Context:** Idea card, list row, and detail page.
- **Technical instruction:** Add a pin icon to all three surfaces. Tapping/clicking toggles pinned state instantly, no confirmation dialog. Pinned ideas float to the top of their Folder's list. Allow unlimited pins per Folder; once more than 5 are pinned, reduce the pinned items' card/row height to conserve space rather than capping the count.
- **Why:** A single-tap toggle matches the low-friction philosophy already set for capture; removing a hard cap avoids blocking the user's own prioritization.

## 6. Idea detail page (lean template)

- **Context:** Idea detail page — replacing the current full Project template for Sparks.
- **Technical instruction:** For the idea detail page, show only: title, description, tags (existing freeform tags field, optional), a single-select Folder/Category (unchanged field), the existing Links component (reused from Projects, supports multiple named links), and an image upload area. Do **not** render the Kanban board, Sprints, Categories tab, or the Notes/Problems/Plans/Links/Uploaded Files/Latest Activity tab bar on this page — those stay exclusive to Projects.
- **Why:** This is the core fix — removing the heavy Project scaffolding (empty Kanban, empty tabs) that currently makes every new idea look unfinished and discouraging.

## 7. Idea image upload

- **Context:** Idea detail page — image upload area.
- **Technical instruction:** Reuse the existing screenshot/picture-upload mechanism from Projects (drag-and-drop/paste + file picker) with no changes to the upload flow itself. Allow unlimited images per idea, displayed as a small gallery/grid on the idea's detail page.
- **Why:** No new upload code needed — this mechanism already supports early-stage ideas per its original spec.

## 8. Idea save behavior

- **Context:** Idea detail page.
- **Technical instruction:** Keep an explicit Save button, matching the current Project template. Additionally, show a brief "Saved" confirmation (inline label or toast) immediately after a successful save.
- **Why:** Explicit save stays consistent with the rest of the app; the confirmation closes the feedback loop (visibility of system status).

## 9. List view cleanup

- **Context:** Ideas section — List view columns.
- **Technical instruction:** Remove the current "Signals" column (currently always shows a dash — dead/unused) and the "Tags" column (currently always empty in practice). Add a new compact icon column in their place showing, per row: a filled pin icon if pinned, a small link icon if the idea has at least one link, a small image icon if it has at least one uploaded image. Leave the slot blank if none apply.
- **Why:** Nielsen's minimalist-design heuristic — removes columns carrying no information, and gives the freed space real signal value instead.

## 10. Default Ideas view

- **Context:** Ideas section — view selector (Sticky Notes / Cards / List / Folders).
- **Technical instruction:** Persist the user's last-selected view for the Ideas section and reopen it by default on next visit, instead of always defaulting to Sticky Notes.
- **Why:** Recognition over recall — avoids repeated reselecting of an already-settled preference.

## 11. Uncategorized ("No folder") ideas

- **Context:** Ideas sidebar/filter chips.
- **Technical instruction:** No change — keep "No folder" as a permanent virtual Folder that automatically collects any idea with no Folder/Category set.
- **Why:** Already matches current, confirmed-correct behavior.

## 12. Search

- **Context:** Ideas section — search bar.
- **Technical instruction:** Expand search matching to cover: title, description, links, tags, and Folder name — all in a single query.
- **Why:** Reduces failed searches when the user only remembers a fragment (a tag, a Folder name, part of a link) rather than the exact title.

## 13. Sort order within a Folder

- **Context:** Folder page — idea list ordering, below any pinned items.
- **Technical instruction:** Sort unpinned ideas by most-recently-updated first. Do **not** enable manual drag-reordering for this list (this is a deliberate exception to the drag-reorder pattern used elsewhere in the app for Projects and Hurdles).
- **Why:** Keeps ordering automatic and meaningful, consistent with the Dashboard's existing recent-activity logic.

## 14. Mobile idea cards

- **Context:** Ideas section — mobile layout.
- **Technical instruction:** On mobile, show each idea as a condensed card with only title and thumbnail image. Tapping the card expands it to reveal full description, links, and other detail-page content.
- **Why:** Matches Hibana's stated mobile use case — fast capture and glancing, not full editing.

## 15. RTL support

- **Context:** Ideas section, and by extension the wider Hibana app — layout direction.
- **Technical instruction:** Implement full RTL layout support across the Ideas section — mirror navigation, banners, metrics, and card layout using logical CSS properties (`padding-inline-start/end`, `margin-inline-start/end`, `text-align: start/end`) rather than physical left/right properties.
- **Why:** Physical left/right properties silently break once layout mirrors for Farsi content; logical properties are the only way this survives a direction flip correctly.
- **Note:** This is broader than just the Folder banner/header — apply logical properties throughout the section now to avoid a larger retrofit later.

## 16. Empty Folder copy

- **Context:** Folder page with zero ideas.
- **Technical instruction:** Show the neutral line: "No ideas yet in this folder."
- **Why:** A plain, low-key line fits an internal personal tool better than promotional copy, and keeps focus on the capture button rather than the message.

## 17. Explicitly deferred (do not build this pass)

- **"Promote to Project" action** and any category-carryover-on-promotion logic — out of scope for now. Leave the existing status field/behavior as-is.

---

*End of spec.*
