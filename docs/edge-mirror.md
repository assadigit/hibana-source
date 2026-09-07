# Edge Mirror — the Iran fast path (ArvanCloud in front of Cloudflare)

## Why this exists

- Hibana is served by a Cloudflare Worker on the custom domain `hibana.ir`. Cloudflare
  has no Iranian POPs; Iranian consumer ISPs shape/throttle the Iran↔Cloudflare transit
  aggressively. Direct access from inside Iran is painfully slow; a VPN "fixes" it only
  by laundering the route through clean transit. The app itself is healthy — verified
  2026-09-07 from a clean route: 200 OK, ~109 ms TTFB, all headers correct.
- The **first attempt (Aug 31) was structurally wrong**: the apex NS themselves were
  delegated to ArvanCloud. That only changes *who answers DNS queries* — the bytes still
  went browser → CF edge over the same throttled consumer pipe (Arvan's zone merely held
  A-records pointing at `188.114.99.0`). It also moved the CF zone (`ns_delegated_from_
  provider`) and dropped every non-apex record (DKIM!) — the 2026-09-07 incident,
  runbook §5. **DNS delegation cannot fix a transit problem.**
- The supported pattern: an ArvanCloud CDN zone **proxies** the traffic, with the origin =
  the Cloudflare Worker. Browser → Arvan POP is domestic and fast; Arvan → CF origin
  pulls ride commercial transit instead of a shaped consumer line; cacheable content is
  served outright from Iranian POPs.
- **Why a dedicated main domain (v0.3.3):** ArvanCloud charges for CDN **subdomain**
  entries (Growth+ plans), while **main** domains are unlimited on the free Basic plan
  (free SSL, 50 GB traffic + 1 M requests/month — an order of magnitude above this app's
  traffic). The v0.3.2 plan of `fast.hibana.ir` hit exactly that paywall. So the mirror
  lives on its own main domain — `sadhana.ir`, delegated to ArvanCloud *in full* and
  served at its **apex**. The old subdomain hostname stays in `MIRROR_ORIGIN` as an inert
  future option.

## Architecture

```
browser ──domestic, fast──▶ ArvanCloud POP (sadhana.ir, Arvan-issued cert)
                             │  static (css/js/vendor/fonts, /dist immutable-hashed):
                             │    served from the POP cache — domestic
                             │  HTML (no-store) + /api/*: origin-pull
                             └───commercial transit──▶ CF edge (hibana.ir → Worker)
```

Invariants (do not break these):

1. **`hibana.ir` apex NS stay on Cloudflare** (`isabel`/`patryk.ns.cloudflare.com`) — the
   zone must stay active for the Worker custom domain and for ALL DNS records (Resend
   DKIM, etc.). Never delegate the apex again.
2. **`sadhana.ir` is a separate, dedicated main domain** delegated to ArvanCloud in full
   (NS set at IRNIC) — that is the free tier. Serve at the **apex**
   (`https://sadhana.ir/`) ONLY: every subdomain entry under it (`www.`, `fast.`, …) is
   the paid feature — do not create any.
3. `MIRROR_ORIGIN = "https://sadhana.ir https://fast.hibana.ir"` (wrangler
   `[env.prod.vars]`, v0.3.3): the CSRF origin gate trusts exactly these origins in
   addition to the request's own origin. The proxy rewrites the Host to the origin at
   pull time, so the browser's Origin (`https://sadhana.ir`) can never equal the
   request's own origin — without the allow-list every state-changing request would 403.
   Both entries are inert while their hostnames do not resolve (nothing can legitimately
   originate from an NXDOMAIN hostname).

## One-time setup (~15 min: IRNIC panel + Arvan panel)

0. **IRNIC — make the domain active first.** As of 2026-09-07 `sadhana.ir` is NXDOMAIN
   at the .ir registry itself (`a.nic.ir` answers NXDOMAIN): check it in your nic.ir
   account — renew/reactivate it if it lapsed (or register it, ~60k toman/yr). A held or
   deleted domain resolves nothing until fixed, and Arvan cannot validate the zone.
1. **ArvanCloud** → CDN → Add domain → `sadhana.ir` (a MAIN domain → the free Basic
   plan) → note the assigned NS pair. (If the dead `hibana.ir` zone from Aug 31 still
   sits in the account, delete it — unused since the NS restore, it only causes
   confusion.)
2. **IRNIC panel** → domain `sadhana.ir` → Nameservers → replace the current NS with the
   Arvan pair. The same panel operation as the 2026-09-07 `hibana.ir` restore, in the
   other direction. Delegation at IRNIC flips fast (minutes on 1.1.1.1/Google DoH).
3. **Arvan zone settings**:
   - Origin: `hibana.ir`, HTTPS, port 443; the Host header sent to origin must be
     `hibana.ir` (Arvan's "دامنه اصلی" field = the origin host). The browser's Origin
     stays `https://sadhana.ir` — `MIRROR_ORIGIN` compensates at the CSRF gate.
   - SSL: issue the free certificate for `sadhana.ir` (automatic once the zone is
     delegated to them).
   - Caching: enable **"respect origin headers"**, and add a cache rule **BYPASS for
     path `/api/*`** if rule creation is exposed on the Basic plan. Static extensions
     cache normally — `/dist/*` is content-hashed and served with `Cache-Control:
     immutable` (1 year), so it is perfectly cacheable. If custom rules are NOT
     available on Basic, respect-origin-headers alone is sufficient (the app already
     sends no-store on HTML and API responses) — then run the security verification
     below with extra care.
   - Confirm responses carrying `Set-Cookie` are never cached (see verification).
4. Wait for the zone to go active: `dig NS sadhana.ir` shows the Arvan pair.

## Verification (run from Iran, WITHOUT a VPN — that is the point)

```bash
# 1) End-to-end speed: DNS, TCP and TLS should now all be domestic-fast
curl -so /dev/null -w 'dns=%{time_namelookup} connect=%{time_connect} \
tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' \
https://sadhana.ir/

# 2) Static caching works: second call must be a cache HIT (look for the cache-status
#    header Arvan returns; also compare the timing drop)
curl -sI https://sadhana.ir/vendor/htmx.min.js
curl -sI https://sadhana.ir/vendor/htmx.min.js

# 3) SECURITY — the API must NEVER be cached. Run twice; expect 401 both times,
#    no cache-HIT marker, no Set-Cookie on the error response:
curl -si -X POST https://sadhana.ir/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"a@b.c","password":"x"}'
```

If a cached login/API response ever appears (identical body on the second call, cache
HIT marker), **disable the mirror immediately** and re-check the Arvan cache rules.

## Known limits (accepted)

- Email and Telegram deep links still point at `https://hibana.ir` (the canonical host,
  hardcoded in `reminders.ts` / `sadhana.ts` / `email.ts`) — landing from a notification
  is the slow path; swap the hostname in the URL manually when needed.
- The session cookie is per-hostname: log in once on `sadhana.ir` (30-day rolling
  session, identical semantics to the canonical host).
- Rate limiting keys on `CF-Connecting-IP`, which behind the mirror is an **Arvan POP
  IP** — all mirror users share a few buckets. Fine at current scale; raise the limits
  if 429s ever appear.
- The service worker (v228 manifest-driven precache) and browser caching behave
  identically on the mirror host — `connect-src 'self'` CSP holds because the frontend
  uses relative paths.
- The dead-man's switch, D1 backups, healthchecks.io pings, email and Telegram alerts
  are **untouched by all of this**: they execute inside Cloudflare and never traverse
  the Iranian transit. Slow browsing can never cause a false alert.
- No subdomains under `sadhana.ir` (`www.` / `fast.` / …): each would be a paid Arvan
  CDN entry — the apex IS the mirror.

## Rollback

Remove the NS at IRNIC (or delete the zone in the Arvan panel) — `sadhana.ir` stops
resolving within the record TTL. Optionally unset `MIRROR_ORIGIN` (both entries are
inert whenever their hostnames do not resolve). `hibana.ir` itself is never affected by
any step here.
