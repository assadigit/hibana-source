import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { STATUS_LABEL } from '../lib/html'

// AP-56 (Phase 3): the status taxonomy drifted on the client — 5 EN fallback labels
// still carried the pre-0060 wording ('Queued' / 'Awaiting Development') behind i18n
// keys that translate to the canonical 'Up Next' / 'On Hold', and resume.js drew a
// different glyph for `operational` than the server's rocket. These source-contract
// pins keep the client fallbacks in lockstep with src/lib/html.ts STATUS_LABEL and
// the rocket path (the i18n key masks the fallback after load, so only the source
// contract can see the drift).

const read = (p: string): string => readFileSync(p, 'utf8')

describe('AP-56: client status fallbacks match the server taxonomy', () => {
  it('nav.js RAIL_STAGE_GROUPS labels match STATUS_LABEL', () => {
    const src = read('public/js/nav.js')
    for (const key of ['planning', 'queued', 'developing', 'awaiting_dev', 'operational'] as const) {
      const m = src.match(new RegExp(`key: '${key}', i18n: '[^']+', label: '([^']+)'`))
      expect(m, `nav.js entry for ${key}`).toBeTruthy()
      expect(m![1]).toBe(STATUS_LABEL[key])
    }
  })

  it('command-palette.js STATUS_LABELS fallbacks match STATUS_LABEL', () => {
    const src = read('public/js/command-palette.js')
    for (const key of ['spark', 'planning', 'queued', 'developing', 'awaiting_dev', 'operational'] as const) {
      const m = src.match(new RegExp(`${key}: \\['cmdk[^']+', '([^']+)'\\]`))
      expect(m, `command-palette.js entry for ${key}`).toBeTruthy()
      expect(m![1]).toBe(STATUS_LABEL[key])
    }
  })

  it('board-page.js status switch fallbacks match STATUS_LABEL', () => {
    const src = read('public/js/board-page.js')
    for (const key of ['spark', 'planning', 'queued', 'developing', 'awaiting_dev', 'operational'] as const) {
      const m = src.match(new RegExp(`${key}: \\['cmdk[^']+', '([^']+)'\\]`))
      expect(m, `board-page.js entry for ${key}`).toBeTruthy()
      expect(m![1]).toBe(STATUS_LABEL[key])
    }
  })

  it("resume.js operational glyph is the server's rocket path", () => {
    const resume = read('public/js/resume.js')
    const html = read('src/lib/html.ts')
    // The canonical rocket's first path d (html.ts case 'rocket'):
    const rocket = html.match(/case 'rocket': return '<path d="([^"]+)"/)
    expect(rocket, "html.ts rocket path").toBeTruthy()
    const opEntry = resume.match(/operational: '(<path[^>]+>)/)
    expect(opEntry, 'resume.js operational entry').toBeTruthy()
    expect(opEntry![1]).toContain(rocket![1])
  })
})
