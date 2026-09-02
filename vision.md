# Vision — In Ali's Own Words

*This document is Ali's reasoning, in his own logic, gathered from the full planning conversation that produced `pm-app-spec.md`. Where the spec says what to build, this says why — paraphrased from what he actually said, not invented. If a technical decision in the spec ever seems arbitrary, the reasoning behind it is probably here.*

---

## Who this is for

Ali is a mid-level UI/UX designer and self-described "vibe coder" — he builds real software (WordPress/WooCommerce plugins, Python tools, web apps) entirely by directing AI coding agents, without reading or patching the code himself. He runs Sedanama, an e-commerce business selling customized star map wall art, as a solo operator. He works long, self-directed hours — by his own account, 12 to 16 hours a day — juggling several projects at once, driven more by what currently has his attention than by a schedule.

## Why this exists

He tried Obsidian and Notion first. Neither worked. In his words, Obsidian felt "more catered toward a digital notebook, rather than a project manager" — it could hold notes, but it couldn't tell him where a project actually stood. Before that, his real system was a physical whiteboard: short keywords or phrases jotted down whenever an idea hit, with the rest left in his head. That whiteboard is the thing this whole app is ultimately replacing.

He was explicit that he didn't want to adapt an existing tool to fit his workflow — he wanted something built around how he actually works, which is why this started as a two-hour interview instead of a feature list.

## How he actually works

Ideas hit at random moments — in the shower, mid-project, before sleep. He rarely writes anything detailed in the moment; a keyword or short phrase is enough, because the rest stays in his head until later. He doesn't plan his days rigidly; he described himself as going "with the flow," reactive to whatever lands on him, but persistent once he's committed to something. He stops working on a project for one of three reasons, in his words: it "matures enough to set aside for a while," a higher-priority project needs his attention, or "life matters and situations" intervene.

His actual process for turning an idea into real work: he has the idea, talks it through with an AI to form a plan (the same kind of conversation that produced this spec), turns that into an action plan, hands the action plan to agentic coders, iterates through questions and answers, and only then does the project really start.

He was clear that promoting an idea into an active project is a conscious decision tied to his needs and lifestyle — never automatic.

## The two jobs

Early in the conversation he named his two actual goals directly: managing his ideas so he always knows their latest state and where they're left off, and never losing an idea or letting it "take dust in a random Obsidian folder, or on a piece of paper on my desk which might get lost anyway." He called the app, unprompted, "a SAFE for my ideas." That phrase is why the data model treats hard deletion as something that's only ever allowed before real work has gone into an idea — once a project matters enough to build, it can be archived but never destroyed.

## What "mature" means to him

He doesn't expect to ever reach a polished, finished "product." A project is mature enough to set aside once it "satisfies my urgent and immediate needs" — the rest, in his words, is "luxury." This is also how he defined the difference between his Building and Working statuses: Building means he's actively developing it right now; Working means the MVP or system is ready and functions as-is, whether or not it's ever polished further.

## Personal work vs. client work — two different worlds

He was firm that these needed to be kept apart, calling them "two different worlds." His personal, self-directed projects are deliberately free-flowing — no deadlines, because there's no third party waiting on him. Client work is the opposite: real deadlines, real task-time relationships, and — something he added partway through, going beyond what was originally scoped — real billing and milestone-payment tracking, because he wants to know when a client has paid the first part of a contract, not just whether the project is "done."

## Why there are no reminders

He rejected reminders repeatedly and had to clarify what he actually meant: not an absence of information, but an absence of nagging. He does not want the app telling him "your project is overdue, work on it." His real pattern — described in his own words — is picking an idea, working it hard for hours at a stretch until it reaches a stage that satisfies him, setting it aside, and coming back to refine it weeks or months later on his own initiative. The app's job is to be there when he comes back, not to pull him back before he's ready.

## The Canvas — why it exists

Partway through finalizing the spec, after several rounds that had each been called "final," he introduced the single biggest addition to the whole project: a full boundless digital blackboard, described as a replacement for "paper on my desk" — somewhere to write or draw anywhere, with sticky notes, that autosaves in real time. He wanted it to keep working even if he lost connectivity mid-thought, catching up and saving as soon as the connection returned. This wasn't a late add-on so much as the clearest, most direct expression of his core goal — never lose an idea — once he'd had enough of the conversation to articulate what "safe" actually looked like in practice.

## What he explicitly doesn't want

- Rigid task management or forced daily planning — he's not that kind of worker, by his own description.
- Anything that assumes he'll read through changelogs himself — he uploads them for his coding agents' benefit, not his own; he said directly he doesn't have time to read them.
- A generic PM tool experience — the entire premise of building this instead of using something off-the-shelf was that existing tools didn't fit how he thinks.
- Friction on ideas specifically. Rich detail is fine, even expected, once something is being actively built — but capturing a raw idea has to stay as fast as a note on a whiteboard.

## How the plan evolved — a short honest log

The spec went through several real course-corrections during planning, each one because something concrete surfaced rather than as a stylistic change:

- The original storage plan (Cloudflare R2) was dropped when he pointed out it requires a credit card even on its free tier — something he didn't have and wasn't willing to work around by adding one.
- The follow-up fix (storing files directly in the database) turned out to have its own real limit — a 2MB cap per row — that would have silently broken larger screenshot uploads. The final design moved file storage to a private GitHub repository instead.
- The Canvas was added after multiple rounds had already been called final, because it was a more complete answer to "never lose an idea" than anything discussed before it.
- A full review pass found that the plan's own multi-user promise ("separate private vaults") hadn't actually been wired into the data model — every table needed a `user_id` and didn't have one. Fixed before any code was written, specifically because it's the kind of gap that's cheap to fix on paper and expensive to fix after real data exists.

None of these were failures of the plan — they're the reason it went through this many rounds before being called ready to build.
