#!/usr/bin/env python3
"""S30 batch 4: detail-helpers — the computed bar carries a per-tier tooltip."""

p = 'src/routes/projects/detail-helpers.ts'
src = open(p).read()

old = """        <span class="row">${progressBar(pct).replace('<span ', '<span data-pd-bar ')} <b data-pd-pct-sr class="sr-only">${dig(pct)}%</b></span>"""
new = """        <span class="row">${progressBar(pct).replace('<span ', `<span data-pd-bar title="${tierTitle}" `)} <b data-pd-pct-sr class="sr-only">${dig(pct)}%</b></span>"""
assert old in src, 'bar markup'
src = src.replace(old, new)

# compute tierTitle right before the header markup — after dig() is defined; anchor on the board preview comment
anchor = """  // S30 (user request 2026-09-12): the interactive progress box (slider + milestone"""
assert anchor in src
tier_block = """  // S30 batch 4 (user request: "hover the project header strip → '3 urgent · 2 high ·
  // 5 medium'"): the bar's tooltip breaks the task pool down by priority tier. The
  // client repaints it live (pdTaskTruth in project-page.js) as tasks move.
  const tierCounts: Record<string, number> = {}
  for (const t of d.devTasks) tierCounts[t.priority || 'medium'] = (tierCounts[t.priority || 'medium'] ?? 0) + 1
  const tierTitle = ['urgent', 'high', 'medium', 'low']
    .filter((p) => tierCounts[p])
    .map((p) => `${dig(tierCounts[p])} ${prioLabel(p)}`)
    .join(' · ')

"""
src = src.replace(anchor, tier_block + anchor, 1)
open(p, 'w').write(src)
print('bar tooltip added')
