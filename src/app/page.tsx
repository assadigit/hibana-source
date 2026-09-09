import {
  ArrowUpRight,
  BadgeCheck,
  Calendar,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  Flame,
  GitBranch,
  Info,
  Layers,
  ScrollText,
  Server,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

type Stat = {
  label: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
};

const STATS: Stat[] = [
  { label: "268/268", sub: "tests passing", icon: TestTube2 },
  { label: "Green", sub: "typecheck", icon: BadgeCheck },
  { label: "Schema 46", sub: "migrations", icon: Database },
  { label: "SW v277", sub: "service worker", icon: GitBranch },
];

type Shot = {
  src: string;
  title: string;
  desc: string;
  tag: string;
};

const SHOTS: Shot[] = [
  {
    src: "/hibana-shots/dashboard.png",
    title: "Dashboard (clean)",
    desc: "Onboarding tour backdrop darkened so the dashboard isn't visible behind coachmarks; layout audit clean.",
    tag: "Tour · Layout",
  },
  {
    src: "/hibana-shots/archive.png",
    title: "Archive empty state",
    desc: 'Was the generic "Capture your first idea" CTA — wrong for an archive. Now context-aware: "Nothing archived yet → Go to projects".',
    tag: "i18n · Routes",
  },
  {
    src: "/hibana-shots/clients.png",
    title: "Clients empty state",
    desc: "Was text-only. Now an illustrated state with clipboard icon + CTA; event-delegated so the htmx-injected button works.",
    tag: "UX · htmx",
  },
  {
    src: "/hibana-shots/sadhana.png",
    title: "Sadhana empties",
    desc: "Was a faint dot. Now a bulb icon + 'No tasks yet' + a hint, at readable contrast.",
    tag: "Contrast · A11y",
  },
  {
    src: "/hibana-shots/admin.png",
    title: "Admin KPIs",
    desc: "'Last backup' showed a bare dash when never backed up — now shows 'Never' (FA: هرگز).",
    tag: "i18n · Admin",
  },
  {
    src: "/hibana-shots/calendar.png",
    title: "Calendar legend",
    desc: "Mixed LTR/RTL 'Holiday / تعطیلی' label fixed to a clean locale string.",
    tag: "i18n · BiDi",
  },
  {
    src: "/hibana-shots/reports.png",
    title: "Reports chart",
    desc: "Activity bar-chart labels no longer overlap/clip — horizontally scrollable with min-width columns.",
    tag: "Charts · CSS",
  },
];

const UNDER_THE_HOOD: { title: string; desc: string }[] = [
  {
    title: "GitHub deleteFile no longer silently fails on logo replace/remove",
    desc: "Auto SHA lookup when not provided (404 → no-op). Prevents orphaned files in the backup repo.",
  },
  {
    title: "Cache-bust unified across all 22 pages",
    desc: "app.css 215/234 → 235 (fixed a stale-cache inconsistency from session 18); i18n.js 45 → 46; admin.js 2 → 3.",
  },
  {
    title: "All 47 migrations apply cleanly on the Node self-host path",
    desc: "268/268 vitest cases pass (35 files). No schema change this session — per Ali's approval rule.",
  },
];

function SectionHeading({
  eyebrow,
  title,
  description,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-hibana/30 bg-hibana/10 text-hibana">
          <Icon className="size-5" />
        </span>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-hibana">
            {eyebrow}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h2>
        </div>
      </div>
      {description ? (
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

export default function Page() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* ───────────────────────── Header ───────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/65">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-9 items-center justify-center rounded-xl bg-hibana text-hibana-foreground shadow-sm ring-1 ring-hibana/30"
            >
              <Flame className="size-5" />
            </span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold tracking-tight text-foreground">
                Hibana
              </span>
              <Badge
                variant="secondary"
                className="border-hibana/30 bg-hibana/10 text-hibana"
              >
                Session 19 — v0.3.10.2
              </Badge>
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                dev
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://hibana.ir"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent sm:inline-flex"
            >
              hibana.ir
              <ArrowUpRight className="size-3.5" />
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-12">
        {/* ───────────────────────── Hero / summary ───────────────────────── */}
        <section className="mb-12 sm:mb-16">
          <p className="mb-3 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-hibana">
            <Sparkles className="size-3.5" />
            A safe for your ideas.
          </p>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl">
            Hibana — Session 19 Status
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            This is an in-development build of Hibana, a personal project &amp; idea
            manager. The live app runs on{" "}
            <span className="font-medium text-foreground">
              Cloudflare Workers + Hono + D1
            </span>{" "}
            and is mirrored locally on the Node self-host path for QA. This page
            summarises what shipped this session, with screenshots of the real UI.
          </p>

          <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {STATS.map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.label}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-hibana/10 text-hibana">
                    <Icon className="size-4.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {s.label}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{s.sub}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <Separator className="mb-12 bg-border sm:mb-16" />

        {/* ───────────────────────── What shipped ───────────────────────── */}
        <section className="mb-12 sm:mb-16">
          <SectionHeading
            eyebrow="Shipped"
            title="What shipped this session"
            description="Seven fixes + polish items verified by VLM re-audit. Click any card to open the full screenshot in a new tab."
            icon={Wrench}
          />

          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SHOTS.map((shot) => (
              <Card
                key={shot.src}
                className="group overflow-hidden p-0 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                <a
                  href={shot.src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-full flex-col"
                  aria-label={`Open ${shot.title} screenshot in a new tab`}
                >
                  <div className="relative overflow-hidden rounded-t-xl border-b border-border bg-muted">
                    <img
                      src={shot.src}
                      alt={`Screenshot: ${shot.title}`}
                      loading="lazy"
                      className="h-[260px] w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02] sm:h-[280px]"
                    />
                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/85 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-foreground shadow-sm backdrop-blur">
                      <ExternalLink className="size-3" />
                      open
                    </span>
                    <span className="absolute left-2 top-2 inline-flex items-center rounded-full bg-hibana/90 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-hibana-foreground shadow-sm">
                      {shot.tag}
                    </span>
                  </div>
                  <CardHeader className="gap-1.5 px-5 pt-5">
                    <CardTitle className="text-base font-semibold text-foreground">
                      {shot.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-5">
                    <CardDescription className="text-sm leading-relaxed text-muted-foreground">
                      {shot.desc}
                    </CardDescription>
                  </CardContent>
                </a>
              </Card>
            ))}
          </div>
        </section>

        {/* ───────────────────────── Under the hood ───────────────────────── */}
        <section className="mb-12 sm:mb-16">
          <SectionHeading
            eyebrow="Behind the scenes"
            title="Also fixed under the hood"
            description="Load-bearing plumbing that isn't visible in a screenshot but keeps the build honest."
            icon={ShieldCheck}
          />

          <ul className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-1">
            {UNDER_THE_HOOD.map((item, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 sm:p-5"
              >
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-hibana" />
                <div>
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {item.desc}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* ───────────────────────── How to see it live ───────────────────────── */}
        <section className="mb-4">
          <SectionHeading
            eyebrow="Live QA"
            title="How to see it live"
            icon={Server}
          />

          <Card className="mt-8 border-dashed bg-hibana-soft text-hibana-soft-foreground">
            <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-hibana/15 text-hibana">
                <Info className="size-5" />
              </span>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-hibana-soft-foreground">
                  Local server is on demand; deployed app lives at hibana.ir
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  The live Hibana app (Hono on Cloudflare Workers) is served locally
                  on{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                    localhost:3000
                  </code>{" "}
                  only during active QA windows. This sandbox reaps detached
                  background processes between Bash commands, so the server can't
                  stay up persistently. A recurring{" "}
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    <Clock className="size-3.5" /> QA + dev
                  </span>{" "}
                  job runs every{" "}
                  <span className="font-medium text-foreground">15 minutes</span>,
                  starting the server, running snapshots &amp; visual audits, then
                  stopping it within a single Bash call.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  The deployed app lives at{" "}
                  <a
                    href="https://hibana.ir"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-hibana underline-offset-4 hover:underline"
                  >
                    hibana.ir
                    <ArrowUpRight className="size-3.5" />
                  </a>
                  . Deploys are out of scope for this session without explicit
                  go-ahead.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge
                    variant="outline"
                    className="border-hibana/30 text-hibana-soft-foreground"
                  >
                    <Layers className="size-3" />
                    Node self-host path
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-hibana/30 text-hibana-soft-foreground"
                  >
                    <ScrollText className="size-3" />
                    47 migrations applied
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-hibana/30 text-hibana-soft-foreground"
                  >
                    <Calendar className="size-3" />
                    EN / FA · Jalali + Gregorian
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      {/* ───────────────────────── Footer (sticky bottom) ───────────────────────── */}
      <footer className="mt-auto border-t border-border bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 sm:px-6">
          <p className="text-sm text-foreground">
            <span className="font-semibold">Hibana</span>{" "}
            <span className="text-muted-foreground">·</span> Session 19 worklog in{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              /home/z/my-project/worklog.md
            </code>{" "}
            <span className="text-muted-foreground">·</span> EN/FA{" "}
            <span className="text-muted-foreground">·</span> Jalali + Gregorian
          </p>
          <p className="text-xs text-muted-foreground">
            Built with Hono on Cloudflare Workers + D1.
          </p>
        </div>
      </footer>
    </div>
  );
}
