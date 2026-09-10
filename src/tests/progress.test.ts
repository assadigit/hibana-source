import { describe, it, expect } from 'vitest'
import { personalProgress, clientProgress, isBehindPace, elapsedFraction } from '../services/progress'

// Spec §11: progress formulas return the right percentage against known inputs.
describe('progress formulas (spec §6.1)', () => {
  it('personal: hurdles-based', () => {
    expect(personalProgress({ total: 4, done: 1 })).toBe(25)
    expect(personalProgress({ total: 4, done: 2 })).toBe(50)
    expect(personalProgress({ total: 3, done: 1 })).toBe(33) // rounds
    expect(personalProgress({ total: 0, done: 0 })).toBe(0) // no hurdles yet
  })

  it('client: task-time-based (the spec example: 10 tasks, 5 done = 50%)', () => {
    expect(clientProgress({ total: 10, done: 5 })).toBe(50)
    expect(clientProgress({ total: 10, done: 0 })).toBe(0)
    expect(clientProgress({ total: 10, done: 10 })).toBe(100)
    expect(clientProgress({ total: 0, done: 0 })).toBe(0)
  })

  it('reminder trigger: only fires when actually behind pace (spec §6.3)', () => {
    // 30% done with a 50% elapsed window — behind → trigger
    expect(isBehindPace(30, 0.5)).toBe(true)
    // 70% done with 50% elapsed — ahead → no nagging
    expect(isBehindPace(70, 0.5)).toBe(false)
    // 40% done with 40% elapsed — on pace → no nagging (the point of the feature)
    expect(isBehindPace(40, 0.4)).toBe(false)
    // barely behind: within the 10-point tolerance → no trigger
    expect(isBehindPace(45, 0.5)).toBe(false)
    // nothing elapsed yet → never trigger on day one
    expect(isBehindPace(0, 0)).toBe(false)
  })

  it('elapsed fraction saturates at 0 and 1', () => {
    const due = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString()
    const now = new Date(due)
    now.setDate(now.getDate() + 5) // 5 days past due
    expect(elapsedFraction(due, now)).toBe(1)
    const early = new Date(due)
    early.setDate(early.getDate() - 30) // 30 days before due (past the 21-day window)
    expect(elapsedFraction(due, early)).toBe(0)
  })
})