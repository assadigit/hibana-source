import { describe, it, expect } from 'vitest'
import { BACKUP_CRON, BACKUP_CRONS, classifyTick, normalizeCron } from '../lib/cron'

// v0.3.2: scheduled ticks are classified by the trigger that FIRED (controller.cron),
// not by the wall clock at invocation time. CF fires scheduled events with jitter — the
// live 2026-09-07 15:31:18 UTC ping (a */30 event landing at :31, misread by the old
// `minute % 30 !== 0` rule as a backup tick) proved the clock can lie: it ran a second
// backup and reset the healthchecks.io watchdog with a non-backup ping, which could mask
// a genuinely dead cron.

const backup = (at: string) => ({ cron: BACKUP_CRON, scheduledTime: Date.parse(at) })
const halfHourly = (at: string) => ({ cron: '*/30 * * * *', scheduledTime: Date.parse(at) })

describe('scheduled-tick classification — trigger-based, jitter-proof (v0.3.2)', () => {
  it('the backup trigger is a backup tick; only the 03:xx one is the daily slot', () => {
    expect(classifyTick(backup('2026-09-07T03:17:00Z'))).toEqual({ backupTick: true, dailyTick: true })
    expect(classifyTick(backup('2026-09-07T15:17:00Z'))).toEqual({ backupTick: true, dailyTick: false })
    expect(classifyTick(backup('2026-09-07T21:17:00Z'))).toEqual({ backupTick: true, dailyTick: false })
  })

  it('S59: the staggered prod trigger (:23) is a backup tick too — and its 03:23 slot is the daily one', () => {
    // The dev/prod same-second backup race fix: prod moved to 23 3,9,15,21. Old deploys
    // keep firing 17 3,9,15,21 — BOTH must classify as backup ticks, else a prod backup
    // would silently stop (and the watchdog would catch it only 12h later).
    const prodTick = (at: string) => ({ cron: '23 3,9,15,21 * * *', scheduledTime: Date.parse(at) })
    expect(classifyTick(prodTick('2026-09-16T03:23:00Z'))).toEqual({ backupTick: true, dailyTick: true })
    expect(classifyTick(prodTick('2026-09-16T09:23:00Z'))).toEqual({ backupTick: true, dailyTick: false })
    expect(classifyTick(prodTick('2026-09-16T21:23:00Z'))).toEqual({ backupTick: true, dailyTick: false })
    expect(BACKUP_CRONS.has('23 3,9,15,21 * * *')).toBe(true)
    expect(BACKUP_CRONS.has('17 3,9,15,21 * * *')).toBe(true)
  })

  it('a lookalike minute that is NOT a configured backup trigger never backs up', () => {
    // :23 with a different hour set, or any other minute — classified by the exact
    // expression, not by "minute is 17 or 23".
    expect(classifyTick({ cron: '23 4,10,16,22 * * *', scheduledTime: Date.parse('2026-09-16T04:23:00Z') }).backupTick).toBe(false)
    expect(classifyTick({ cron: '47 3,9,15,21 * * *', scheduledTime: Date.parse('2026-09-16T03:47:00Z') }).backupTick).toBe(false)
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
