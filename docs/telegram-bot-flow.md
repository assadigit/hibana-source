# Hibana Telegram Bot — Inline-Keyboard Flow Design

> **Status:** DRAFT — design session (no code). Awaiting review and approval.
> **Author:** Principal Full-Stack Engineer (design session)
> **Scope:** Redesign the `@Hibana_PM_bot` interaction model around **inline
> keyboard buttons** (`callback_data`) as the primary navigation, with priority
> flows Quick Capture (Idea) → To-do board (Sadhana) → Quick Notes (general
> **or** project-connected), bilingual EN/FA (inheriting the web locale), and a
> state model that is **not finite**.
> **Codebase at time of writing:** commit `d46b159` (post security-audit + hardening).
> Bot lives in `src/routes/integrations.ts` (~527 lines); sender in
> `src/services/telegram.ts`; data model in `src/types.ts`; Sadhana board in
> `src/routes/sadhana.ts` + `src/services/sadhana.ts`; i18n in `src/lib/i18n.ts`.

> **Revision notes — owner feedback round 1 (applied to this draft):**
> 1. **Mark-done + Undo** on Sadhana to-do tasks — **approved** (§9).
> 2. **Bot locale = `users.language_pref`** — no `telegram_lang` column, no
>    first-link language picker; the web's language is the single source of
>    truth (§6).
> 3. The **bug / task / plan / hurdle / link** project child-item flow is
>    **dropped**. Project-relevant input is now a **Quick Note with an optional
>    `project_id`** connection (§5). `quick_notes.project_id` already exists
>    (migration `0017`), so this is zero-migration and natively renders on the
>    project page (`projects.ts:164`).
> Round-2 open questions remain in §12.

> **Revision notes — owner feedback round 2 (applied to this draft):**
> - **Q1 (bot-side language changer):** ALLOW — the bot's `/language` command /
>   Settings → 🌐 Language button **updates `users.language_pref`** (single
>   source of truth; the web app's language changes too). Owner confirmed OK
>   with the web locale changing. §6.1, §10.2, §11 Phase 3 updated.
> - **Q2 (connect UX order):** **(i) save-first, connect-after** — the note is
>   saved immediately as a general Quick Note; 🔗 Connect is an optional
>   follow-up tap. §5.3 locked to option (i); option (ii) noted as rejected.
> - **Q3 (home screen):** **(a) drop the 📁 Projects button.** Home = 💡 /
>   [📋 To-do | 📝 Note] / [⚙️ Settings | ❓ Help]. Connect lives inside 📝.
>   §2, §5.5, §5.6, §13 updated.
> - **Q4 (quick-note `done` via bot):** **keep web-only** — the bot does NOT
>   toggle `quick_notes.done`; that stays a web-app action. §11 Phase 3
>   deferred-list updated.
> - Q5–Q7 (smaller): applied per the recommended leans (migrate `/list`, page
>   sizes 8/10, lean Help menu). Owner did not object — flag me to reverse.

---

## 0. Decisions honored (do not re-litigate)

These were locked by the user before this session and are treated as hard
constraints throughout this document:

1. **Inline keyboards are the primary model.** Buttons (`callback_data`) drive
   navigation; slash commands remain as quick power-user entry points.
2. **Priority flows (revised round 1):** A) Quick Capture (Idea) → B) To-do
   board (Sadhana) → C/D) Quick Notes (general **or** project-connected).
   The original "Projects: add child items" flow is **dropped**; project-relevant
   input now flows through a Quick Note with an optional `project_id` (§5).
3. **Bilingual inherits the web locale (round 1).** Bot locale =
   `users.language_pref`. No separate column, no first-link ask. The web's
   language setting is the single source of truth.
4. **State must be "not finite"** — no step cap, no mid-flow expiry, scales to
   any conversation depth.
5. **Add-only (revised round 1).** The bot can create ideas, to-do tasks,
   quick notes (general or project-connected), and list notes. It cannot
   delete, edit, rename, re-status, reorder, or move. For those, it replies
   **"Open in Hibana →"** with a deep link. Exception: mark a to-do task done
   (+ Undo) — **approved round 1** (§9).
6. **Security unchanged.** Secret-token webhook validation (rule 11),
   user-scoped queries (rule 1), `/reset` kept, no destructive actions → no
   delete-confirm flows needed.

---

## 1. What the bot touches (data model reference)

Confirmed from `src/types.ts`, `migrations/0018_sadhana.sql`,
`migrations/0017_quick_notes_project.sql`, `migrations/0038_quick_note_done.sql`,
and the route write-paths in `src/routes/{quicknotes,projects,sadhana}.ts`.

### 1.1 Tables the bot reads

| Table | Why the bot reads it |
|---|---|
| `users` | Resolve the linked chat (`telegram_chat_id`), `telegram_paused`, `language_pref`, `calendar_pref`, `timezone`, `sadhana_quadrant_order`. |
| `projects` | List projects for the Quick Note connect step (§5); resolve `/append` target. |
| `sadhana_tasks` | List / add tasks per quadrant (Flow B); count open deadline tasks for `/status`. |
| `sadhana_quadrant_names` | Read the **user's** quadrant names/subtitles/icon/accent (Flow B must show the user's names, not defaults). |
| `telegram_captures` | Idea-capture store (also the unlinked-chat parking lot). |
| `telegram_note_sessions` | Existing `/list` multi-item collector (2h TTL today — migrate per §7.4). |
| `telegram_links` | One-time link codes (`/start <code>`), 1h TTL, single-use. |

### 1.2 Tables the bot writes (all adds; no edits/deletes)

| Table | What the bot adds |
|---|---|
| `telegram_captures` + `projects` (status `spark`) | A new Idea (Flow A). Same write path as today's `captureIdea()`. |
| `quick_notes` (kind `note`, optional `project_id`) | A Quick Note — **general** (`project_id = NULL`) or **project-connected** (`project_id = <pid>`). Flow C/D. `project_id` already exists (migration `0017`); the project page already shows these (`projects.ts:164`). Zero-migration. |
| `quick_notes` (kind `list`) | A list note (`/list` flow). Same as today. |
| `sadhana_tasks` (quadrant, title, defaults) | A new to-do task in a quadrant (Flow B add). |
| `sadhana_tasks` (`done = 1`, `recur_last`) | Mark a to-do task done (Flow B; + Undo). Approved round 1 (§9). |

> **Dropped (round 1):** the bot no longer writes `hurdles`, `links`, `tasks`,
> `dev_tasks`, or `backlog_docs`. Those project child-item flows are gone;
> project-relevant input is a project-connected Quick Note instead.

### 1.3 Proposed new table

**`telegram_bot_sessions`** — the "not finite" state backbone (see §7). One
row per linked user. JSON state, no TTL that can expire mid-flow.

### 1.4 No new column (round 1)

**No `telegram_lang` column.** The bot uses `users.language_pref` directly
(owner decision round 1 — §6.1). The earlier draft's proposed
`migrations/0041_telegram_lang.sql` is **withdrawn**.

### 1.5 Existing bot surface (unchanged behavior, reused)

- `/start <code>` linking, `/start`+`/help` greeting, `/status`, `/pause`,
  `/resume`, `/reset`, free-text capture for unlinked chats — all kept as-is.
- `sendTelegramMessage(token, chatId, text, parseMode)` in
  `src/services/telegram.ts` is the **only** outbound sender today. Two new
  thin helpers are proposed for Phase 1 (see §11): `answerCallbackQuery` and
  `editMessageText` (or `sendMessage` with `reply_markup`).

---

## 2. Home screen — inline keyboard layout

The home screen is what the user sees after `/start` (linked) or when they
tap any **🏠 Home** / **↩️** button. It surfaces the priority flows — Idea,
To-do, Note — plus Settings + Help. A **📁 Projects** button is **optional
and pending owner pick** (§12 Q3); the layouts below show the recommended
simplified home **without** it (the project-connect step lives inside 📝 Note).

### 2.1 Design principles

- **Thumb-friendly:** 1–2 buttons per row. The #1 action (Idea) is a
  full-width hero button at the top — easiest tap, biggest target.
- **Icons + short labels** (FA renders LTR inside Telegram keyboards — icons
  anchor meaning, text stays short). No position-dependent semantics.
- **Always-present escape:** every subscreen ends with a **🏠 Home** (or
  contextual **↩️ Back**). The user is never trapped.
- **callback_data budget:** every op-code below is ≤ 64 bytes (see §8).

### 2.2 EN variant (recommended)

```
Hibana — what's next?

[ 💡  New Idea ]            ← full-width hero (callback: "idea")

[ 📋 To-do ]  [ 📝 Note ]    ← priorities B + C/D

[ ⚙️ Settings ]  [ ❓ Help ]  ← settings + help
```

- `idea` → Flow A
- `todo` → Flow B (quadrant grid)
- `note` → Flow C/D (quick note, with optional 🔗 project connect)
- `set` → Settings screen
- `help` → Help screen (inline version of today's `/help`)

### 2.3 FA variant

Inline keyboards render **LTR** in Telegram even for FA users, so we rely on
emoji + short FA labels (not layout order) to convey meaning.

```
هیبانا — بعدی چی؟

[ 💡 ایده ]                 ← full-width hero

[ 📋 کارها ]  [ 📝 یادداشت ]

[ ⚙️ تنظیمات ]  [ ❓ راهنما ]
```

Same `callback_data` op-codes as EN (the data layer is locale-independent;
only the visible label changes).

### 2.4 Label glossary (bilingual, kept short)

| Key | EN label | FA label | callback |
|---|---|---|---|
| New Idea | 💡 New Idea | 💡 ایده | `idea` |
| To-do | 📋 To-do | 📋 کارها | `todo` |
| Projects (optional) | 📁 Projects | 📁 پروژه‌ها | `projs` |
| Note | 📝 Note | 📝 یادداشت | `note` |
| Settings | ⚙️ Settings | ⚙️ تنظیمات | `set` |
| Help | ❓ Help | ❓ راهنما | `help` |
| Home | 🏠 Home | 🏠 خانه | `home` |
| Cancel | ↩️ Cancel | ↩️ لغو | `home` |
| Back | ↩️ Back | ↩️ بازگشت | (contextual) |
| Done (to-do) | ✅ | ✅ | `d:<taskId>` |
| Undo | ↩️ Undo | ↩️ برگردان | `u:<taskId>` |
| Add | ➕ Add | ➕ افزودن | (contextual) |
| Connect to project | 🔗 Connect | 🔗 اتصال | (contextual) |
| Skip (keep general) | ↩️ Skip | ↩️ رد شدن | (contextual) |
| Save | ✅ Save | ✅ ذخیره | (contextual) |
| Next page | Next › | بعدی › | (contextual) |
| Prev page | ‹ Prev | ‹ قبلی | (contextual) |

---

## 3. Flow A — Quick Capture (Idea)

This is the #1 use case and **stays frictionless**. Two entry paths, same
outcome:

- **Button:** tap **💡 New Idea** on the home screen.
- **Direct text:** type any plain text (with no active await intent) → captured
  as an idea. This preserves today's default free-text behavior so power users
  who just type are not forced to tap first.

### 3.1 Step-by-step (button path)

1. User taps **💡 New Idea** → callback `idea`.
2. Bot sets session state:
   `{ kind: 'await_text', intent: 'idea', prompt_id: 'idea_prompt' }`.
3. Bot replies (new message or `editMessageText` on the home message):
   > Send me your idea — one message. I'll capture it as a Spark.
   > [ ↩️ Cancel ]
4. User types the idea text (one message; multi-line OK, capped at the same
   `raw.slice(0,120)` title + full `raw` description as today).
5. Bot runs the **existing** `captureIdea(raw)` path: inserts
   `telegram_captures` + a `projects` row (status `spark`), replies:
   > 📎 Captured:
   > **<escaped raw>**
   > [Open it in Hibana →](<origin>/project.html?id=<id>)
   > [ 💡 Another ]  [ 🏠 Home ]
6. Session state cleared (back to no-await).

### 3.2 Button layout (awaiting idea text)

```
Send me your idea — one message. I'll capture it as a Spark.

[ ↩️ Cancel ]
```

`Cancel` → `home` (clears await, returns home).

### 3.3 Edge cases

- User sends `/help` while awaiting → **command wins**, await is cleared, help
  shown (see §8).
- User taps **🏠 Home** while awaiting → await cleared, home shown. No
  "are you sure" — the typed idea was never received.
- Empty message while awaiting → re-prompt ("Send the idea text, or tap
  Cancel.").
- User never types, just abandons → session stays `await_text:idea`
  indefinitely; the next plain text (days later) becomes the idea. This is
  intentional and matches "not finite" — we never say "your session expired."

---

## 4. Flow B — To-do board (Sadhana)

The to-do board is the Sadhana quadrant board. **Crucially, the bot reads the
user's customized quadrant names** from `sadhana_quadrant_names` and the
user's quadrant order from `users.sadhana_quadrant_order` (default
`[1,3,2,4]`). The four quadrant **ids** (1/2/3/4) are the stable data keys;
their visible names are user-owned.

Default quadrants (from `src/services/sadhana.ts`):

| id | default name (EN / FA) | icon | subtitle |
|---|---|---|---|
| 1 | Today / امروز | ⚙️ | Must-do daily necessities |
| 3 | Urgent & High Value / فوری و باارزش | 🚨 | Strategic with tight deadlines |
| 2 | Strategic / استراتژیک | 🏔️ | High value, open horizon |
| 4 | Personal & Sentimental / شخصی و احساسی | 🍃 | Personal, heart matters |

### 4.1 Step 1 — quadrant grid (tap To-do)

1. User taps **📋 To-do** → callback `todo`.
2. Bot loads `sadhana_quadrant_names` for the user (names/subtitles/icon) and
   `users.sadhana_quadrant_order`, then renders 4 quadrant buttons using the
   user's names (truncated to ~18 chars with `…` if longer), in the user's
   order, 2 per row, each prefixed with the quadrant's effective emoji.

```
<user greeting> — pick a quadrant

[ ⚙️ Today ]   [ 🚨 Urgent… ]     ← Q1, Q3  (top row per default order)
[ 🏔️ Strat… ]  [ 🍃 Personal ]     ← Q2, Q4

[ ➕ Quick add… ]   [ 🏠 Home ]
```

- `q1` / `q2` / `q3` / `q4` → open that quadrant (Step 2).
- `qadd` → a quick "which quadrant?" sub-picker (Step 3 alt) for users who
  want to add without browsing.
- `home` → back to home.

> **Note on order:** the grid uses the user's `sadhana_quadrant_order` exactly
> as the web board does — if the user reorders quadrants on the web, the bot
> reflects it on next render. No separate bot-side ordering.

### 4.2 Step 2 — a quadrant's task list

1. User taps a quadrant (e.g. **⚙️ Today**, callback `q1`).
2. Bot queries open tasks:
   ```sql
   SELECT id, title, emoji, pinned, position, created_at, due_date
     FROM sadhana_tasks
    WHERE user_id = ? AND quadrant = 1
      AND done = 0 AND deleted_at IS NULL AND cleared_at IS NULL
    ORDER BY pinned DESC, position ASC, created_at ASC
    LIMIT 8 OFFSET ?
   ```
   (8 per page — thumb-friendly; matches the prompt's "paginated" ask.)
3. Bot renders the tasks as **numbered text** (handles long titles cleanly —
   they're not crammed into button labels) and a compact button grid to act on
   each by index, plus pagination and add.

```
⚙️ Today — 8 open (page 1/2)

1. 📌 Call the accountant
2. ⭐ Draft Q4 OKRs
3. 🔥 Fix login Safari bug
4. 📌 Renew domain (due Fri)
… (page 1 of 2)

[ ✅ 1 ] [ ✅ 2 ] [ ✅ 3 ] [ ✅ 4 ]
[ ✅ 5 ] [ ✅ 6 ] [ ✅ 7 ] [ ✅ 8 ]
[ ‹ Prev ]      [ Next › ]
[ ➕ Add task ]  [ ↩️ Back ]  [ 🏠 Home ]
```

- `d:<taskId>` (✅ n) → mark that task done (Step 4). **4 buttons/row max.**
- `q1p2` → page 2 of quadrant 1 (`OFFSET 8`).
- `q1p1` → back to page 1.
- `q1add` → add a task to quadrant 1 (Step 3).
- `back` → quadrant grid; `home` → home.

> **Why numbered buttons + text list, not one button per task?** Task titles
> can be up to 255 chars; inline-button labels truncate badly and the keyboard
> becomes unreadable. A numbered text list + compact `✅ n` buttons keeps long
> titles visible and the keyboard small. Each `✅ n` button carries the full
> task UUID in `d:<uuid>` (38 bytes — fits the 64-byte budget), so no session
> lookup is needed to mark done (robust against list changes between renders).

### 4.3 Step 3 — add a task to a quadrant

1. User taps **➕ Add task** in a quadrant view → callback `q1add`.
2. Bot sets session:
   `{ kind: 'await_text', intent: 'sadhana_task', quadrant: 1 }`.
3. Bot replies:
   > New task for **<Q1 user-name>** — send the title:
   > [ ↩️ Cancel ]
4. User types the title → bot inserts a `sadhana_tasks` row
   (`quadrant=1`, `title=<text>`, `emoji='📌'`, `done=0`, `position=0`,
   defaults for the rest), then **re-renders the quadrant view** with the new
   task at the top of page 1.
5. Session state cleared.

Optional follow-up (Phase 2 polish): after adding, the bot offers
`[ ⏰ Add deadline ]` and `[ 🔁 Make recurring ]` buttons that walk the user
through fuzzy/exact deadline + recurrence. **Deferred to Phase 2** — the MVP
adds a plain task; deadlines/recurrence stay on the web app for v1.

### 4.4 Step 4 — mark done (+ undo) — APPROVED round 1

1. User taps **✅ 3** → callback `d:<taskId>`.
2. Bot sets `done = 1`, `updated_at = now`; if `recurring = 1`, also sets
   `recur_last = todayIn(user.timezone)` (mirrors `resetDueRecurring`'s
   bookkeeping so recurring tasks auto-reset on the next cycle, exactly as
   the web app does).
3. Bot replies (edits the quadrant message):
   > ✅ Done: **<emoji> <title>**
   > [ ↩️ Undo ]   [ 🏠 Home ]
4. `Undo` → callback `u:<taskId>` → sets `done = 0`, restores the task to the
   open list, replies "↩️ Reopened: <title>".
5. Re-renders the quadrant view (task moves off the open list / back on undo).

### 4.5 Step 5 — task detail (optional, Phase 2)

A `ℹ️` button per task → shows note, tags, deadline, recurrence, recent
`updates` (journal). **Deferred** — MVP shows title + done only; detail is a
web-app deep link (`Open in Hibana →`).

---

## 5. Flow C/D — Quick Notes (general + project-connected)

> **Owner pivot (round 1):** the original "add structured child items to a
> project" flow (bug / task / plan / hurdle / link) is **dropped**. The bot
> no longer creates `dev_tasks`, `backlog_docs`, `hurdles`, `links`, or
> `tasks`. Anything project-relevant now flows through a **Quick Note with an
> optional project connection** — the same Quick Note function the dashboard
> notebook already uses, plus a `project_id` link.

### 5.1 Why this is zero-migration

`quick_notes.project_id` **already exists** (migration
`0017_quick_notes_project.sql`), alongside `done` (0038), `color`, `note_date`,
`sticky`. The web app's `src/routes/quicknotes.ts` already creates notes with a
`project_id`, and `src/routes/projects.ts:164` already loads
`quick_notes WHERE project_id = ?` onto the project page. So a quick note with
a `project_id` is a first-class "note attached to this project" — it appears
**both** on the dashboard notebook **and** in the project's notes section. The
bot just sets `project_id` on the `quick_notes` row; no schema change, no new
table.

### 5.2 Two modes

1. **General Quick Note** — a dashboard notebook note, no project. Exactly
   today's `/note` behavior (`quick_notes` row, `project_id = NULL`).
2. **Project-connected Quick Note** — same `quick_notes` row, but with
   `project_id = <chosen project>`. Shows on the dashboard **and** the
   project's notes tab.

### 5.3 The connect UX (owner-confirmed, round 2)

The owner described this order: *user writes a quick note → bot asks
"connect to any project?" → user picks from their project list → note is
saved connected.* Confirmed in round 2: **option (i) — save-first,
connect-after.**

1. User taps **📝 Note** → callback `note` → session
   `{ kind: 'await_text', intent: 'note' }`.
2. Bot: "Send me the note — I'll add it to your dashboard." + `[ ↩️ Cancel ]`.
3. User types the note → bot **saves it immediately as a general Quick Note**
   (`quick_notes`, `project_id = NULL`, same path as today's `createQuickNote`),
   and replies:
   > ✅ Note added to your dashboard:
   > <preview>
   > [ 🔗 Connect to a project ]   [ 🏠 Home ]
4. If the user taps **🔗 Connect to a project** → bot lists the user's
   projects (10/page + search, same list as §5.4) → user taps one → bot runs
   `UPDATE quick_notes SET project_id = ? WHERE id = ? AND user_id = ?` and
   replies:
   > 🔗 Connected to **<project title>**.
   > [Open in Hibana →](<origin>/project.html?id=<pid>)
   > [ 🏠 Home ]
   If the user does nothing / taps **🏠 Home** → the note stays general. Done.

**Why (i) was chosen:** the note is never lost, even if the user abandons
after typing. Connecting is a pure enhancement, never a gate. Matches
Hibana's "never lose an idea" philosophy.

> **Rejected alternative (ii) — deliberate save-or-connect:** hold the note
> in session, show `[ ✅ Save ] [ 🔗 Connect to project ] [ ↩️ Cancel ]`, write
> only on a tap. Explicit mode, but one extra tap per note and a small loss
> risk if the user abandons between typing and tapping Save. Not adopted.
>
> **Unlink:** once connected, a note's `project_id` can be cleared only on
> the web app (the bot is add-only — §0.5). If a user connects to the wrong
> project, the fix is "Open in Hibana →" and detach there, or connect to the
> correct project (the bot's connect UPDATE overwrites `project_id`).

### 5.4 Project list (used by the connect step)

Same list component, user-scoped, 10/page, prefix-search:

```sql
SELECT id, title FROM projects
 WHERE user_id = ? AND deleted_at IS NULL
 ORDER BY updated_at DESC LIMIT 10 OFFSET ?
```

```
Connect to a project (page 1)

[ 📁 My SaaS app ]
[ 📁 Star Map redesign ]
[ 📁 Q4 marketing site ]
…
[ 🔍 Search ]   [ ↩️ Skip (keep general) ]
[ ‹ Prev ]       [ Next › ]
[ 🏠 Home ]
```

- `cp:<projectId>` → connect the pending note to this project. The pending
  `noteId` is held in the session row (set when the connect list opens), so
  the callback carries only the 41-byte project id — well under 64.
- `psearch` → search mode (await text, prefix match).
- `skip` → leave the note general (no `project_id`), return home.
- Pagination + home as usual.

### 5.5 Home screen (locked, round 2)

With the child-item flow gone, the home screen's **📁 Projects** button has
no destination. Per owner decision round 2 (option **(a)**), the **📁
Projects button is dropped**. Home = 💡 hero / [📋 To-do | 📝 Note] /
[⚙️ Settings | ❓ Help] (shown in §2). The project-connect step lives
**inside** the 📝 Note flow (§5.3).

### 5.6 Concrete tap counts

**General note:** tap 📝 → type note → (saved; tap 🏠 or ignore) =
**1 tap + 1 message**.

**Connected note:** tap 📝 → type note → tap 🔗 Connect → tap project =
**3 taps + 1 message**.

---

## 6. Bilingual UX (EN / FA)

### 6.1 The rule (owner decision, round 1)

**Bot locale = `users.language_pref`.** The bot uses the same language the
user set on the web. No separate `telegram_lang` column, no first-link
language picker, no re-ask. The web's language setting is the single source
of truth.

- Every linked user already has `language_pref` (`'en'` or `'fa'`,
  non-nullable), so the bot always knows the locale from the first
  `/start <code>`.
- Changing the language on the web (Settings → language) is picked up by
  the bot on the next interaction (the user row is loaded fresh per webhook
  call).
- The bot also offers a `/language` command and a Settings → 🌐 Language
  button. Per owner decision round 2 (§12 Q1), changing language via the bot
  **updates `users.language_pref`** — the single source of truth — which
  **also changes the web app's language**. The owner confirmed this is
  acceptable. The picker:
  ```
  [ 🇬🇧 English ]   [ 🇮🇷 فارسی ]
  ```
  Callbacks `lang:en` / `lang:fa` → `UPDATE users SET language_pref = ? WHERE
  id = ?` → reply "✅ Saved." in the new language → re-render home.
  (Both directions work: web → bot inherits, bot → web inherits. One
  setting, one source of truth.)

### 6.2 No first-interaction ask

The original "ask once on first link" requirement is **superseded** by the
inherit rule. On a successful first `/start <code>`, the bot simply greets
in `language_pref` and renders the home screen. No picker. This removes the
`telegram_lang` migration proposed in the earlier draft.

### 6.3 The bot's translator

Reuse `trL(lang, en, fa, vars?)` from `src/lib/i18n.ts`:

```
botLang(user) = user.language_pref
tBot(user, en, fa, vars?) = trL(user.language_pref, en, fa, vars)
```

Every bot string (messages + button labels) goes through `tBot`. Command
names stay English (per the locked requirement); only responses + labels
translate.

### 6.4 FA/RTL in inline keyboards

Telegram renders inline keyboards LTR even for FA. Mitigations (unchanged):

- **Emoji-anchored labels** — the emoji leads; meaning is icon-based, not
  position-based.
- **Short labels** (≤ ~12 chars) to avoid truncation.
- **No left/right semantic ordering** — pagination uses `‹ Prev` / `Next ›`.
- **Numbered lists** (Flow B) avoid RTL reordering issues entirely.
- Message body text for FA flows with natural RTL; Telegram handles bidi in
  message text fine (only the keyboard is LTR-locked).

### 6.5 Bilingual label examples (button-level)

| Screen | EN | FA |
|---|---|---|
| Home hero | 💡 New Idea | 💡 ایده |
| Home | 📋 To-do | 📋 کارها |
| Home | 📝 Note | 📝 یادداشت |
| Home | ⚙️ Settings | ⚙️ تنظیمات |
| Home | ❓ Help | ❓ راهنما |
| Quadrant default (Q1) | ⚙️ Today | ⚙️ امروز |
| Quadrant default (Q3) | 🚨 Urgent… | 🚨 فوری… |
| Connect action | 🔗 Connect to project | 🔗 اتصال به پروژه |
| Skip (keep general) | ↩️ Skip | ↩️ رد شدن |
| Done (to-do) | ✅ Done | ✅ انجام شد |
| Undo | ↩️ Undo | ↩️ برگردان |
| Cancel | ↩️ Cancel | ↩️ لغو |
| Save | ✅ Save | ✅ ذخیره |
| Prompt (idea) | Send me your idea… | ایده‌ات رو بفرست… |
| Prompt (note) | Send me the note… | یادداشت رو بفرست… |
| Confirm connect | 🔗 Connected to | 🔗 متصل شد به |

---

## 7. State management — the "not finite" solution

### 7.1 The problem, restated

Telegram `callback_data` is **capped at 64 bytes (UTF-8)**. That is finite.
Encoding full conversation state in callbacks (a growing breadcrumb string)
would hit the ceiling in 2–3 steps. We need state that:

- never caps the number of steps,
- never expires mid-flow,
- scales to any conversation depth,
- and never tells a user "your session expired, start over."

### 7.2 The proposed approach: hybrid (callback op-codes + a single D1 session row per user)

**Two state stores, complementary:**

1. **`callback_data` carries short op-codes + IDs** for *shallow, stateless*
   navigation: which quadrant, which page, which project, which task. Every
   callback is self-contained (the bot can act on it with no prior context).
   All op-codes are ≤ ~41 bytes (see §8). This is finite in length but
   infinite in *steps* — each tap is independent and re-entrant.

2. **`telegram_bot_sessions` (D1, one row per linked user) carries the
   "await_text" intent** for *deep, stateful* flows: when the bot has asked
   the user to type free text (idea, note, task title, project search) or to
   connect a note to a project. The row holds:
   ```
   user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
   state        TEXT NOT NULL   -- JSON blob (see shapes below)
   updated_at   TEXT NOT NULL   -- UTC ISO
   ```
   State JSON shapes:
   - `{ kind: 'home' }` (or row absent ≡ home)
   - `{ kind: 'await_text', intent: 'idea' }`
   - `{ kind: 'await_text', intent: 'note' }`
   - `{ kind: 'await_text', intent: 'sadhana_task', quadrant: 1 }`
   - `{ kind: 'await_text', intent: 'proj_search' }`
   - `{ kind: 'await_list_item' }` (the existing `/list` flow; migrated per §7.4)
   - `{ kind: 'connect_list', note_id }` (between "tap 🔗 Connect" and
     "tap a project" — lets `cp:<projectId>` resolve without re-passing the
     note id; the pending note id lives in the session)

### 7.3 Why this is "not finite"

- **No step cap:** every button tap is an independent, re-entrant request. The
  bot reads the op-code (and the session row, if relevant) and acts. There is
  no counter that increments toward a limit.
- **No mid-flow expiry:** the session row has **no TTL**. It persists until
  overwritten by the next transition. A user who starts typing a note, gets
  distracted for a week, and returns will simply resume — the next plain
  text becomes the note. We **never** send "your session expired."
- **Scales to any depth:** the session JSON is tiny and fixed-shape (a single
  intent + a couple of IDs). Depth comes from *navigation history* (each tap
  is fresh), not from a growing in-memory stack.
- **Stale-row hygiene without UX cost:** an optional idle GC (e.g. a weekly
  cron deleting rows whose `updated_at` is older than 30 days) keeps the table
  small, but a cleared row just means the next tap shows the home screen —
  never an error. This is "garbage collection," not "expiry."

### 7.4 Relationship to the existing `telegram_note_sessions` (the `/list` flow)

The existing `/list` flow uses `telegram_note_sessions` with a **2h TTL** and
shows "stale" behavior. Under the new model:

- **Option 1 (recommended): migrate the list flow onto
  `telegram_bot_sessions`** with `kind: 'await_list_item'` and an
  `items: string[]` field, **no TTL**. This unifies state and removes the
  one TTL-based "finite" flow. The collected items persist until `/done` or
  `/cancel` or until another intent overwrites the row.
- **Option 2 (minimal change): leave `/list` on its own table**, keep its 2h
  TTL, and document that `/list` is the one finite flow (power-user only).
  Lower risk but contradicts the "not finite" spirit.

My recommendation: **Option 1** in Phase 1, to honor the "not finite"
requirement uniformly. The migration is a small, additive change.

### 7.5 Concurrency / single-user assumption

One row per user = the bot assumes a single chat per user (which the schema
already enforces: `users.telegram_chat_id` is a single value). Two simultaneous
button taps from the same user are processed sequentially by Telegram's
delivery; the last write wins, exactly like the current `/list` flow. No
extra locking needed.

---

## 8. The "waiting for input" handling strategy

This is the crux of making the button model coexist with free-text capture.

### 8.1 The dispatch rule (single source of truth)

On **every** incoming update, the bot decides what the text means in this
exact order:

1. **If the update is a `callback_query`** (a button tap) → execute the
   callback's op-code. The op-code **always wins** and **replaces** the
   current `await_text` intent (e.g. tapping **🏠 Home** while awaiting an
   idea cancels the idea await). `answerCallbackQuery` acks the tap;
   `editMessageText` or `sendMessage` renders the new screen.

2. **Else if the text starts with `/`** (a slash command) → **always treat as
   a command**, regardless of any active await. This means a user awaiting an
   idea can still type `/help` and get help. The await is cleared (the command
   supersedes it). Rationale: commands are explicit, unambiguous, and the
   user clearly intends the command over the pending prompt.

3. **Else if `telegram_bot_sessions.state.kind === 'await_text'`** → consume
   the text per `state.intent` (idea / note / sadhana_task / proj_search).
   Execute the write, confirm, clear the session row.

4. **Else if `state.kind === 'await_list_item'`** → append the message's
   lines to the list (existing `/list` behavior; one item per line).

5. **Else (no active await, plain text)** → **default capture as an Idea**
   (today's free-text behavior — the #1 use case). This keeps the bot
   frictionless: type anything, get an idea. The home buttons are a *power*
   surface, not a *gate*.

6. **Unlinked chat** → unchanged: commands get link-first instructions; free
   text is parked in `telegram_captures` (user_id NULL) for later assignment
   (today's behavior).

### 8.2 Why this order?

- **Buttons > commands > await > default idea.** Each tier is more explicit
  than the one below. Explicit always wins over implicit.
- Plain text is **never lost**: it either fulfills the active await or
  becomes an idea. The user never sends text and gets nothing.
- Commands never get swallowed by an await (no "I typed /help but it became
  my idea title" footgun).

### 8.3 Cancel / escape hatches

- Every `await_text` screen shows a **↩️ Cancel** button → callback `home`
  → clears the await, returns home.
- A **🏠 Home** button appears on every subscreen → same effect from
  anywhere.
- **No confirmation dialog** on cancel (the typed text was never received;
  there's nothing to lose). Matches Hibana's "no blocking confirm" convention.

### 8.4 Timeout / abandonment

There is **no timeout**. If the user abandons an `await_text` and later sends
unrelated text, that text fulfills the await (becomes the idea/note/etc.).
This is intentional and is the cost of "not finite." Mitigation: the bot
shows the active intent in the prompt message, and **every screen offers
Cancel**. If the user is unsure what the bot is waiting for, tapping
**🏠 Home** resets cleanly.

---

## 9. Mark-done + Undo (approved round 1)

> **Owner decision (round 1): YES — allow marking a Sadhana to-do task as
> done, with an inline ↩️ Undo button.** The recommendation below is now
> locked; kept for the reasoning record.

### Reasoning (why this was the right call)

1. **It's the #1 to-do action.** The whole point of a to-do companion is to
   check things off. A to-do bot that can add but never complete is half a
   to-do bot. Users will open the web app just to tick a box — friction that
   defeats the bot.
2. **It's fully reversible — not destructive.** `sadhana_tasks.done` is a
   0/1 toggle; marking done sets `done=1` (and `recur_last` for recurring
   tasks). No row is deleted; no data is lost. The web app's archive is a
   *view* of done tasks (`cleared_at` sweep), not a deletion.
3. **The undo is right there.** Immediately after marking done, the bot
   shows `[ ↩️ Undo ]` (`u:<taskId>`) which toggles `done=0` again. This
   matches Hibana's own UI convention (CLAUDE.md: "Destructive actions use an
   undo-toast, not a blocking confirm dialog").
4. **Recurring tasks auto-reset anyway.** Per `resetDueRecurring`, a done
   recurring task flips back to open on its next cycle — so "done" is
   inherently temporary for recurring tasks. The bot setting `recur_last`
   correctly keeps this machinery working.
5. **It does not violate the "add-only" posture in spirit.** The locked rule
   (#5) is about *destructive* modifications — delete, edit, rename,
   re-status-the-project, reorder, move. Toggling a task's completion flag
   is the to-do equivalent of an undo-toast action: reversible, non-losing,
   and the canonical daily interaction.

### What stays web-only

Edit/rename a task, delete a task, reorder, move between quadrants, set
deadline/recurrence, manage tags — all reply **"Open in Hibana →"** with a
deep link to `/sadhana.html`. The bot adds and completes; the web app
manages.

---

## 10. Command reference

### 10.1 Existing commands (kept, behavior mostly unchanged)

| Command | Status | Notes under the new model |
|---|---|---|
| `/start <code>` | Kept | On successful first link, greets in `language_pref` and renders home (no language picker — §6.1 round 1). |
| `/start` | Kept | Renders home (inline keyboard) instead of plain-text help. |
| `/help` | Kept | Renders the Help **screen** (inline keyboard) in addition to text. |
| `/idea <text>` | Kept | Same as tapping 💡 then typing — but skips the await (captures immediately). Power-user shortcut. |
| `/note <text>` | Kept | Same — captures a quick note immediately (general; use the button flow to connect to a project). |
| `/list` `/done` `/cancel` | Kept | Migrated onto `telegram_bot_sessions` (§7.4 Option 1) — no TTL. |
| `/append <project> <text>` | Kept | Power-user append shortcut (unchanged). |
| `/status` | Kept | Renders as a small inline card + a `[📋 To-do]` button jump. |
| `/pause` `/resume` | Kept | Also surface as Settings-screen toggles. |
| `/reset` | Kept | Security unchanged (§0.6). |

### 10.2 New commands proposed

| Command | Purpose |
|---|---|
| `/menu` | Render the home inline keyboard from anywhere (same as tapping 🏠 Home). |
| `/language` | Open the language picker → updates `users.language_pref` (single source of truth — the web app's language changes too; owner-confirmed round 2). |
| `/todo` | Jump straight to the quadrant grid (same as 📋 To-do). |

All new commands are **aliases of buttons** — the button is the primary path;
the command is a speed entry for power users. No command is required to use
any flow.

> **Dropped from the earlier draft:** `/projects` (no child-item flow to jump
> to; the connect step lives inside 📝 Note).

---

## 11. Phased implementation plan

> This is a design session — no code is written. The plan below is for the
> *next* session to execute, in this order. Each phase is independently
> shippable.

### Phase 1 — Backbone + Quick Capture + Quick Note (MVP)

**Build:**
- Migration `0041_telegram_bot_sessions.sql` (add `telegram_bot_sessions`
  table; migrate `/list` onto it — §7.4 Option 1). **No `telegram_lang`
  migration** (§6.1 round 1).
- Extend `src/services/telegram.ts` with `answerCallbackQuery`,
  `editMessageText`, and `sendMessage`-with-`reply_markup` helpers (the
  current sender only does plain `sendMessage`).
- Add a `tBot(user, en, fa, vars)` helper (reuses `src/lib/i18n.ts:trL` with
  `user.language_pref`).
- Refactor `src/routes/integrations.ts` webhook into a small **dispatcher**
  (callback_query vs. message; the §8.1 order) and a per-op-code handler
  table. Keep all existing command behavior behind the dispatcher.
- Home inline keyboard (§2), greeted in `language_pref` on first link (no
  picker).
- Flow A (Idea) via button → `await_text` → existing `captureIdea`.
- Flow C/D (Note) via button → `await_text` → existing `createQuickNote`, +
  the optional 🔗 Connect-to-project follow-up (§5.3).
- `/menu`, `/language` commands.

**"Done when"**: a linked user can tap 💡 or 📝, type text, and see the
capture/note confirm + deep link. A note can be connected to a project via
the 🔗 follow-up. Greets in `language_pref`. All existing slash commands
still work byte-identically.

### Phase 2 — To-do board (Flow B)

**Build:**
- Quadrant grid (reads `sadhana_quadrant_names` + `sadhana_quadrant_order`).
- Per-quadrant task list (8/page, numbered + `✅ n` buttons).
- Add task to a quadrant (`await_text:sadhana_task`).
- **Mark done + Undo** (approved round 1, §9).
- `/todo` command.

**"Done when"**: a user can tap 📋 → see their 4 quadrants (their names) →
tap one → see open tasks → add one → mark one done → undo it.

### Phase 3 — Polish + Settings

**Build:**
- Settings screen (🌐 Language [updates `language_pref` — owner-confirmed
  round 2, web locale changes too], ⏸/▶️ Pause/Resume reminders, 🔗 Link
  status, 🔐 Reset password, ✂️ Unlink, ❓ Help).
- Full bilingual coverage audit of every bot string.
- Idle-session GC cron (30-day `updated_at`, no UX impact — §7.3).
- Help screen as an inline keyboard with one-tap jumps to each flow.
- `/status` restyled as inline card + `[📋 To-do]` jump.

**"Done when"**: Settings is fully navigable; every bot string is bilingual;
the GC cron is in place.

**Deferred (web-app only):** edit, rename, delete, reorder, move quadrant,
change project status, set deadline/recurrence via bot, task detail view,
file/screenshot/changelog upload, payments, and (owner-confirmed round 2)
marking a project-connected quick note done — `quick_notes.done` stays a
web-only action; the bot does not toggle it.

> **Note on phasing:** the original Phase 3 ("Projects + child items") is
> gone — it's folded into Phase 1's Quick Note connect step. The plan is now
> three phases instead of four.

---

## 12. Open questions for the owner (round 2)

**Confirmed in round 1** (locked, no longer open):
- ✅ Mark-done + Undo on Sadhana to-do tasks — allowed (§9).
- ✅ Bot locale = `users.language_pref` — no `telegram_lang` column, no
  first-link ask (§6.1).
- ✅ Project-relevant input = Quick Note with optional `project_id` — the
  bug/task/plan/hurdle/link child-item flows are dropped (§5).

**Confirmed in round 2** (locked, no longer open):
- ✅ **Q1 — Bot-side language changer:** ALLOW. `/language` + Settings → 🌐
  update `users.language_pref` (web locale changes too — owner confirmed OK).
  §6.1, §10.2, §11 Phase 3.
- ✅ **Q2 — Connect UX order:** option **(i) save-first, connect-after.**
  Note saved immediately as general; 🔗 connect is an optional follow-up tap.
  §5.3 locked; (ii) rejected.
- ✅ **Q3 — Home screen:** option **(a) drop the 📁 Projects button.** Home =
  💡 / [📋 To-do | 📝 Note] / [⚙️ Settings | ❓ Help]. §2, §5.5.
- ✅ **Q4 — Quick-note `done` via bot:** keep **web-only.** The bot does not
  toggle `quick_notes.done`. §11 Phase 3 deferred-list.

**Applied per recommended lean (owner did not object — flag me to reverse):**
- ⚙️ **Q5 — `/list` migration:** applied — migrate onto
  `telegram_bot_sessions`, remove the 2h TTL (uniform "not finite"). §7.4,
  §11 Phase 1.
- ⚙️ **Q6 — Page sizes:** applied — 8 tasks/page (Flow B), 10
  projects/page (connect list). §4.2, §5.4.
- ⚙️ **Q7 — Help screen:** applied — lean 4-button jump menu + a
  `[ Full command list ]` expand. §11 Phase 3.

**Obsolete from round 1** (dropped with the child-item flow): bug default
status, plan title/content split, link format — all moot.

> All open questions are now resolved. The design is ready for approval →
> implementation in the next session.

---

## 13. Summary

- **Model:** inline keyboards (callback_data) for navigation; a single D1
  session row per user for the "awaiting text" intent. Hybrid, not finite.
- **Home:** 💡 hero / [📋 To-do | 📝 Note] / [⚙️ Settings | ❓ Help].
  (📁 Projects dropped — round 2 Q3.)
- **Flow A (Idea):** tap 💡 → await text → capture (existing path). Plain
  text with no await also defaults to idea (frictionless, unchanged).
- **Flow B (To-do):** tap 📋 → user's 4 quadrants → tasks (8/page, numbered)
  → add or ✅ done (+ ↩️ Undo). Reads user's custom quadrant names.
  **Mark-done + Undo approved (round 1).**
- **Flow C/D (Quick Notes):** tap 📝 → type note → saved to dashboard; optional
  🔗 Connect to a project (sets `quick_notes.project_id`, shows on the
  project page too). Zero-migration — `project_id` already exists. The
  bug/task/plan/hurdle/link child-item flow is dropped (round 1).
- **Bilingual:** bot locale = `users.language_pref` (round 1). No new column,
  no first-link ask. Reuses `trL` from `src/lib/i18n.ts`. Bot-side
  `/language` + Settings → 🌐 **update `language_pref`** (single source of
  truth; web locale changes too — owner-confirmed round 2).
- **Waiting-for-input:** buttons > commands > active await > default idea.
  Plain text never lost; commands never swallowed; every screen has
  ↩️ Cancel / 🏠 Home.
- **No destructive actions:** edit/delete/rename/reorder/move/​status/deadline
  all reply "Open in Hibana →". (To-do mark-done + Undo is the one reversible
  exception, approved.)

**All open questions resolved (rounds 1 + 2). Ready for approval →
implementation in the next session.**

---

## Appendix — Plan B backup toggle (v0.2.0, migration 0044)

**Shipped 2026-09-11** (design: `docs/perf-and-data-safety.md` §1; runbook: §2b). The bot's
infrastructure now doubles as the second disaster-recovery channel.

### Settings screen (updated)

The ⚙️ Settings keyboard gains one row — **owners only**:

```
⚙️ Settings

Reminders: ✅ on
Backup to this chat (Plan B): ⬜ off      ← new line (owners only)
[🌐 Language]                              [⏸ Pause reminders]
[🗄 Backup to this chat: OFF]              ← new button (owners only)
[🔐 Reset password]
[🏠 Home]
```

- **Tap 🗄** → toggles `users.telegram_backup` (0/1) and re-renders Settings.
- **Owner-scoped by design:** the whole-DB snapshot (every user's rows, encrypted) may
  only be delivered to an owner's chat. Members never see the button; a crafted `bak`
  callback from a member chat is a no-op (re-renders Settings without the row).
- `telegram_paused` does NOT gate the backup channel (pausing reminder noise must never
  silently disable disaster recovery).

### What the channel does (out of the bot's UI)

On the same 4×/day backup tick, the worker sends the encrypted snapshot as a silent
document (`hibana-backup-<UTC>.bin`) to every opted-in owner chat: pinned newest,
caption carries `schema · time · rows · sha256`, retention keeps ~60 per owner.
Restore: runbook §2b (manual = download from the chat + `restore.mjs`; automated =
`npm run drill:planb`).

### New callback op-codes

| `callback_data` | Screen | Who |
|---|---|---|
| `bak` | toggle Plan B opt-in → Settings (updated) | owner (member: no-op) |
