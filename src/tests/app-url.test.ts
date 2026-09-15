import { describe, it, expect } from 'vitest'
import { appUrlOf } from '../lib/app-url'

// S49-b6: the deep-link origin for no-request contexts (cron emails, Telegram reminder
// pushes, the ICS feed) resolves from cfg.appUrl / env APP_URL. This pins the DEFAULT —
// the pre-S49-b6 prod domain — because every email/ICS expectation elsewhere in the
// suite depends on it staying byte-identical until the owner sets APP_URL.
describe('appUrlOf (canonical origin for no-request deep links)', () => {
  it('defaults to the prod domain when appUrl is unset', () => {
    expect(appUrlOf({})).toBe('https://hibana.ir')
    expect(appUrlOf({ appUrl: undefined })).toBe('https://hibana.ir')
  })

  it('returns the configured origin verbatim (no trailing-slash munging)', () => {
    expect(appUrlOf({ appUrl: 'https://newdomain.example' })).toBe('https://newdomain.example')
    expect(appUrlOf({ appUrl: 'http://localhost:3000' })).toBe('http://localhost:3000')
  })

  it('normalizes a sloppy override (missing scheme, trailing slash, whitespace)', () => {
    expect(appUrlOf({ appUrl: 'newdomain.example' })).toBe('https://newdomain.example')
    expect(appUrlOf({ appUrl: '  https://newdomain.example/  ' })).toBe('https://newdomain.example')
    expect(appUrlOf({ appUrl: 'https://newdomain.example///' })).toBe('https://newdomain.example')
  })
})
