// Transactional email (spec §8) via Resend — code verification, password reset,
// client-work reminders. Resend's free tier needs no card. The sender uses Ali's
// VERIFIED domain (hibana.ir, verified 2026-08-24) — the shared onboarding@resend.dev
// sender only permits the account owner as recipient (403 for anyone else, which
// broke the signup confirmation codes).

import type { Db } from '../db/types'

/** Structural subset of Config the mail paths touch — keeps this module app-agnostic. */
interface MailConfig {
  db: Db
  emailKey?: string
  assets?: (url: URL, req?: Request) => Promise<Response>
}

/** One send request: `to`/`kind`/`subject`/`title`/`bodyHtml` + the origin the deep links and logo derive from. */
interface SendAndLogOptions {
  to: string
  kind: string
  subject: string
  title: string
  bodyHtml: string
  origin: string
}

/** Resend attachment (logo cid path) — `content` is base64 (see toB64). */
interface EmailAttachment {
  filename: string
  content: string
  content_type?: string
  content_id?: string
}

interface EmailService {
  send(to: string, subject: string, html: string, attachments?: EmailAttachment[]): Promise<void>
}

/** Resend uses a `from` of `Name <email>`; the domain must be verified (Resend → Domains). */
function resendEmail(apiKey: string | undefined, from = 'Hibana <noreply@hibana.ir>'): EmailService {
  return {
    async send(to, subject, html, attachments) {
      if (!apiKey) throw new Error('Resend API key not configured')
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ from, to: [to], subject, html, ...(attachments?.length ? { attachments } : {}) }),
      })
      if (!res.ok) throw new Error(`Resend send failed (${res.status}): ${await res.text()}`)
    },
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** Plain text → HTML body for admin custom/broadcast mail (escapes, then line breaks). */
export function textToEmailHtml(text: string): string {
  return escapeHtml(text.trim()).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')
}

/** The branded wrapper: RTL-aware (any Arabic-script char flips it), inline-styled table
 * layout, logo header + tagline footer — every send goes through it (batch e). */
function brandedEmailHtml(title: string, bodyHtml: string, logoSrc: string): string {
  const rtl = /[\u0600-\u06FF]/.test(`${title}${bodyHtml}`)
  const dir = rtl ? 'rtl' : 'ltr'
  const align = rtl ? 'right' : 'left'
  const tagline = rtl ? 'ایده‌هایت همیشه سالم.' : 'your ideas, always safe.'
  return `<!doctype html><html dir="${dir}"><body style="margin:0;padding:0;background:#F3EBDA;font-family:'Segoe UI',Tahoma,Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EBDA;padding:24px 12px"><tr><td align="center"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:14px;border:1px solid #E7DBC2;border-collapse:separate"><tr><td align="center" style="padding:24px 28px 8px;background:#FBF4E4"><img src="${escapeHtml(logoSrc)}" alt="Hibana" width="132" style="height:auto;display:inline-block;border:0"></td></tr><tr><td dir="${dir}" align="${align}" style="padding:20px 28px 6px;font-size:18px;font-weight:700;color:#3A3226">${escapeHtml(title)}</td></tr><tr><td dir="${dir}" align="${align}" style="padding:0 28px 24px;font-size:14px;line-height:2;color:#4A4238">${bodyHtml}</td></tr><tr><td dir="${dir}" align="center" style="padding:14px 28px;background:#FBF4E4;font-size:11px;color:#8A8278">هیبانا · Hibana — ${tagline}</td></tr></table></td></tr></table></body></html>`
}

export function resetEmailHtml(link: string): string {
  return `<h2 style="margin:0 0 10px;color:#3A3226">بازنشانی گذرواژه — Password reset</h2><p>برای تعیین گذرواژهٔ جدید (تا ۱ ساعت اعتبار دارد) این پیوند را باز کنید:</p><p><a href="${escapeHtml(link)}" style="color:#3D8D91">${escapeHtml(link)}</a></p><p style="font-size:12px;color:#8A8278">If you didn't request this, you can safely ignore this email.</p>`
}

export function verifyEmailHtml(code: string): string {
  return `<h2 style="margin:0 0 10px;color:#3A3226">تأیید ایمیل — Confirm your email</h2><p>کد تأیید شما / your confirmation code:</p><p style="font-size:26px;letter-spacing:8px;font-weight:bold;color:#3A3226">${escapeHtml(code)}</p><p style="font-size:12px;color:#8A8278">تا ۱۵ دقیقه اعتبار دارد — it expires in 15 minutes. If you didn't sign up for Hibana, you can ignore this email.</p>`
}

/** Item 6 (user request 2026-09-09): invite-by-email. The owner enters an email; Hibana
 *  generates an invite code + emails it to that address via Resend. The recipient uses
 *  the code at signup (OPEN_REGISTRATION off) or as a courtesy (OPEN_REGISTRATION on).
 *  The email is bilingual, branded, and carries the code prominently. */
export function inviteEmailHtml(code: string, inviterName?: string): string {
  const from = inviterName ? `${escapeHtml(inviterName)} ` : ''
  return `<h2 style="margin:0 0 10px;color:#3A3226">دعوت به Hibana — You're invited to Hibana</h2>
<p>${from}شما را به Hibana دعوت کرده است. ${from}has invited you to Hibana — a personal project &amp; idea manager.</p>
<p>برای ثبت‌نام، از این کد دعوت استفاده کنید:</p>
<p style="font-size:24px;letter-spacing:6px;font-weight:bold;color:#3A3226;background:#F4F0E8;padding:12px 20px;border-radius:8px;display:inline-block">${escapeHtml(code)}</p>
<p>Use this invite code when you sign up at:</p>
<p><a href="https://hibana.ir/signup" style="color:#3D8D91;font-weight:bold">hibana.ir/signup</a></p>
<p style="font-size:12px;color:#8A8278">اگر این دعوت را انتظار نداشتید، می‌توانید این ایمیل را نادیده بگیرید. — If you weren't expecting this invitation, you can safely ignore this email.</p>`
}

/** Free-tier daily cap — the admin console refuses custom/broadcast mail past this (429). */
export const RESEND_DAILY_LIMIT = 100

interface EmailLogEntry {
  to: string
  kind: string
  subject?: string
  status: string
  error?: string
}

/** Best-effort email_log insert — a logging failure must never break the send path. */
async function logEmail(db: Db, e: EmailLogEntry): Promise<void> {
  try {
    await db.execute(
      'INSERT INTO email_log (id, to_email, kind, subject, status, error, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), e.to, e.kind, e.subject ?? null, e.status, e.error ?? null, new Date().toISOString()],
    )
  } catch {}
}

/** Sent-count since UTC midnight — the quota numerator for the admin console. */
export async function emailsSentToday(db: Db): Promise<number> {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const rows = await db.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM email_log WHERE status = ? AND sent_at >= ?',
    ['sent', start.toISOString()],
  )
  return rows[0]?.n ?? 0
}

/** ArrayBuffer → base64 in 8192-byte chunks — String.fromCharCode + btoa without blowing
 * the call stack, and byte-safe for binary payloads (btoa alone chokes on non-Latin-1). */
async function toB64(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(bin)
}

/** Cached base64 of /logo-light.png (the asset is immutable, so this is computed once). */
let logoB64Cache: string | null | undefined

async function logoB64(cfg: MailConfig, origin: string): Promise<string | null> {
  if (logoB64Cache !== undefined) return logoB64Cache
  try {
    const res = await cfg.assets!(new URL('/logo-light.png', origin)) // only reached when cfg.assets exists (sendAndLog guards it)
    if (!res.ok) throw new Error(`logo fetch ${res.status}`)
    logoB64Cache = await toB64(await res.arrayBuffer())
  } catch {
    logoB64Cache = null
  }
  return logoB64Cache
}

/** The one send path every mail goes through (batch e): "Hibana —" subject prefix,
 * branded wrapper, cid-attached logo (falling back to the origin URL logo), and an
 * email_log row per outcome — failures log then rethrow. */
export async function sendAndLog(cfg: MailConfig, opts: SendAndLogOptions): Promise<void> {
  const subject = opts.subject.startsWith('Hibana') ? opts.subject : `Hibana — ${opts.subject}`
  const sent = () => logEmail(cfg.db, { to: opts.to, kind: opts.kind, subject, status: 'sent' })
  let logo: string | null = null
  if (cfg.assets) logo = await logoB64(cfg, opts.origin)
  if (logo) {
    try {
      await resendEmail(cfg.emailKey).send(
        opts.to,
        subject,
        brandedEmailHtml(opts.title, opts.bodyHtml, 'cid:hibana-logo'),
        [{ filename: 'hibana-logo.png', content: logo, content_type: 'image/png', content_id: 'hibana-logo' }],
      )
      await sent()
      return
    } catch {
      // fall through to the origin-URL logo path
    }
  }
  try {
    await resendEmail(cfg.emailKey).send(
      opts.to,
      subject,
      brandedEmailHtml(opts.title, opts.bodyHtml, `${opts.origin}/logo-light.png`),
    )
    await sent()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await logEmail(cfg.db, { to: opts.to, kind: opts.kind, subject, status: 'failed', error: msg })
    throw err
  }
}
