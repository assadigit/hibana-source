// Progress formulas — spec §6.1 and §12's required tests.
// Personal: solved hurdles / total hurdles. Client: done tasks / total tasks.
// Manual override (projects.progress_percent) wins when set; null = computed.

interface Count { total: number; done: number }

export function personalProgress(hurdles: Count): number {
  if (hurdles.total <= 0) return 0
  return Math.round((hurdles.done / hurdles.total) * 100)
}

export function clientProgress(tasks: Count): number {
  if (tasks.total <= 0) return 0
  return Math.round((tasks.done / tasks.total) * 100)
}

// Reminder trigger (spec §6.3, Phase 4): fires only when actual progress is BEHIND the
// expected pace for the time elapsed — being on pace never nags, regardless of due date.
// expected = elapsedFraction * 100; actual < expected - tolerance(10 pts) → behind.
export function isBehindPace(actualPercent: number, elapsedFraction: number, tolerancePoints = 10): boolean {
  if (elapsedFraction <= 0) return false
  const expected = Math.min(100, Math.max(0, elapsedFraction * 100))
  return actualPercent < expected - tolerancePoints
}

export function elapsedFraction(dueDateIso: string, now = new Date()): number {
  const due = new Date(dueDateIso).getTime()
  const start = due - 21 * 24 * 3600 * 1000 // assume a 3-week working window per contract
  const total = due - start
  if (total <= 0) return 1
  const elapsed = now.getTime() - start
  return Math.max(0, Math.min(1, elapsed / total))
}