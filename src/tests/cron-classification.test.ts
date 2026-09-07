import { describe, it, expect } from 'vitest'
import { BACKUP_CRON, classifyTick, normalizeCron } from '../lib/cron'

// v0.3.2: scheduled ticks are classified by the trigger that FIRED (controller.cron),
// not by the wall clock at invocation time. CF fires scheduled events with jitter — the
// live 2026-09-07 15:31:18 UTC ping (a */30 event landing at :31, misread by the old
// `minute % 30 !== 0` rule as a backup tick) proved the clock can lie: it ran a second
// backup and reset the healthchecks.io watchdog with a non-backup ping, which could mask
// a genuinely dead cron.

const backup = (at: string) => ({ cron: BACKUP_CRON, scheduledTime: Date.parse(at) })
const halfHourly = (at: string) => ({ cron: '*/30 * * * *', scheduledTime: Date.parse(at) })

describe('scheduled-tick classification — trigger-based, jitter-proof (v0.3.2)', () => {
  it('the backup trigger is a backup tick; only the 03:17 one is the daily slot', () => {
    expect(classifyTick(backup('2026-09-07T03:17:00Z'))).toEqual({ backupTick: true, dailyTick: true })
    expect(classifyTick(backup('2026-09-07T15:17:00Z'))).toEqual({ backupTick: true, dailyTick: false })
    expect(classifyTick(backup('2026-09-07T21:17:00Z'))).toEqual({ backupTick: true, dailyTick: false })
  })

  it('a half-hourly trigger NEVER backs up — including the observed late fire at :31', () => {
    // The live incident: the 15:30 */30 event ran with the wall clock at 15:31:08.
    expect(classifyTick(halfHourly('2026-09-07T15:30:00Z'), new Date('2026-09-07T15:31:08Z'))).toEqual({
      backupTick: false,
      dailyTick: false,
    })
    expect(classifyTick(halfHourly('2026-09-07T15:00:00Z'), new Date('2026-09-07T15:00:30Z'))).toEqual({
      backupTick: false,
      dailyTick: false,
    })
  })

  it('a late-firing backup trigger still runs the daily jobs (03:17 firing at 03:44)', () => {
    expect(classifyTick(backup('2026-09-07T03:17:00Z'), new Date('2026-09-07T03:44:10Z'))).toEqual({
      backupTick: true,
      dailyTick: true, // keyed on scheduledTime, not the fire-time clock
    })
  })

  it('cron expressions are whitespace-normalized before matching', () => {
    expect(normalizeCron('  17   3,9,15,21  *  *  * ')).toBe(BACKUP_CRON)
    expect(normalizeCron(undefined)).toBe('')
    expect(
      classifyTick({ cron: '17  3,9,15,21 * * *', scheduledTime: Date.parse('2026-09-07T15:17:00Z') }).backupTick,
    ).toBe(true)
  })

  it('harnesses without a cron string fall back to the legacy wall-clock rule', () => {
    expect(classifyTick({ scheduledTime: 0 }, new Date('2026-09-07T15:17:00Z'))).toEqual({ backupTick: true, dailyTick: false })
    expect(classifyTick({ scheduledTime: 0 }, new Date('2026-09-07T15:30:00Z'))).toEqual({ backupTick: false, dailyTick: false })
    expect(classifyTick({ scheduledTime: 0 }, new Date('2026-09-07T03:17:00Z'))).toEqual({ backupTick: true, dailyTick: true })
  })
})
