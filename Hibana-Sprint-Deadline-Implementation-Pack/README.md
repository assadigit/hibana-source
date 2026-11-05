# Hibana Sprint, Deadline & Dependency Feature Pack

This folder contains the product specification, original deadline blueprint, actual current-app screenshots, all successfully generated exploratory UI images, and a detailed visual brief for screens that were not generated as standalone images.

## Start here

1. Read `specs/Hibana-Sprint-and-Deadline-System-Spec.md` first. It is the consolidated product and implementation specification based on the decisions made in the conversation.
2. Read `VISUAL-REFERENCE-GUIDE.md`. It explains which images are authoritative, maps every generated image, and gives exact visual instructions for missing standalone references.
3. Inspect `visual-references/original-ui/`. These two actual Hibana screenshots are the source of truth for the existing interface.
4. Browse `visual-references/generated-explorations/` for supporting concepts. Generated mockups are illustrative, not exact requirements.
5. Read `agent-workflow/PHASED-MULTI-SESSION-IMPLEMENTATION.md` and use `agent-workflow/START-SESSION-PROMPT.md` to begin implementation.

## Package map

```text
Hibana-Sprint-Deadline-Implementation-Pack/
├── README.md
├── VISUAL-REFERENCE-GUIDE.md
├── specs/
│   ├── Hibana-Sprint-and-Deadline-System-Spec.md
│   └── Original-Task-Deadline-Visual-Blueprint.md
├── visual-references/
│   ├── original-ui/
│   │   ├── 01-Actual-Hibana-Kanban-Board.png
│   │   └── 02-Actual-Hibana-Edit-Task-Modal.png
│   └── generated-explorations/
│       └── 10 generated exploratory PNG images
└── agent-workflow/
    ├── PHASED-MULTI-SESSION-IMPLEMENTATION.md
    └── START-SESSION-PROMPT.md
```

## Important source-of-truth rules

- The actual Hibana screenshots outrank every generated mockup for existing layout and styling.
- The consolidated system spec outranks incidental text/content in generated images.
- Do not reproduce inaccurate generated labels, invented controls, fake dates, or accidental layout changes.
- Screens without a standalone generated image are fully described in `VISUAL-REFERENCE-GUIDE.md`; that document is an implementation brief, not a claim that the missing image exists.
- The feature must work for both Hibana Web/source and Hibana Windows Desktop. Inspect each repository before making technical assumptions.

## Scope control

This is a feature addition, not a general redesign or repository reorganization. Preserve unrelated functionality and existing architecture. Do not move unrelated root files or perform broad cleanup as part of this work.

## Uploading to a repository root

You can place `Hibana-Sprint-Deadline-Implementation-Pack.zip` in the repository root. The kickoff prompt instructs the agent to safely extract it into the matching folder if the folder is not already present. Do not scatter these images or specs across existing folders; keep the package self-contained to avoid unrelated repository reorganization.
