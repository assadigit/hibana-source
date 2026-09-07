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
- The supported pattern: ArvanCloud CDN **proxies** the traffic on a delegated
  SUBDOMAIN, with the origin = the Cloudflare Worker. Browser → Arvan POP is domestic
  and fast; Arvan → CF origin pulls ride commercial transit instead of a shaped consumer
  line; cacheable content is served outright from Iranian POPs.

## Architecture

```
browser ──domestic, fast──▶ ArvanCloud POP (fast.hibana.ir, Arvan-issued cert)
                             │  static (css/js/vendor/fonts, /dist immutable-hashed):
                             │    served from the POP cache — domestic
                             │  HTML (no-store) + /api/*: origin-pull
                             └───commercial transit──▶ CF edge (hibana.ir → Worker)
```

Invariants (do not break these):

1. **`hibana.ir` apex NS stay on Cloudflare** (`isabel`/`patryk.ns.cloudflare.com`) — the
   zone must stay active for the Worker custom domain and for ALL DNS records (Resend
   DKIM, etc.). Never delegate the apex again.
2. Only the **subdomain** `fast.hibana.ir` is delegated to Arvan, via NS records created
   *inside the CF zone*. Cloudflare fully supports subdomain NS delegation; the rest of
   the zone is untouched.
3. `MIRROR_ORIGIN = "https://fast.hibana.ir"` (wrangler `[env.prod.vars]`, v0.3.2): the
   CSRF origin gate trusts exactly this origin in addition to the request's own origin.
   The proxy rewrites the Host to the origin at pull time, so the browser's Origin
   (`https://fast.hibana.ir`) can never equal the request's own origin — without the
   allow-list every state-changing request would 403. Inert while the hostname is
   NXDOMAIN (nothing can legitimately originate there yet).

## One-time setup (~15 min: Arvan panel + CF dashboard)

1. **ArvanCloud** → CDN → Add domain → `fast.hibana.ir` → note the assigned NS pair.
   (If Arvan rejects the subdomain because the stale `hibana.ir` zone still exists in
   the account, delete that dead zone first — it has been unused since the NS restore.)
2. **Cloudflare dashboard** → `hibana.ir` zone → DNS → Records → add two **NS** records:
   name `fast`, content = each Arvan NS hostname (DNS-only — NS records are never
   proxied). The API token in `.secrets.env` has no `dns_records:edit` scope, hence the
   dashboard step.
3. **Arvan zone settings**:
   - Origin: `hibana.ir`, HTTPS, port 443. (The proxy rewrites the Host header to the
     origin — that is expected; `MIRROR_ORIGIN` compensates at the CSRF gate.)
   - SSL: issue the free certificate for `fast.hibana.ir` (automatic once the zone is
     delegated to them).
   - Caching: enable **"respect origin headers"**, and add a cache rule **BYPASS for
     path `/api/*`**. Static extensions cache normally — `/dist/*` is content-hashed
     and served with `Cache-Control: immutable` (1 year), so it is perfectly cacheable.
   - Confirm responses carrying `Set-Cookie` are never cached (see verification).
4. Wait for the zone to go active: `dig NS fast.hibana.ir` shows the Arvan pair.

## Verification (run from Iran, WITHOUT a VPN — that is the point)

```bash
# 1) End-to-end speed: DNS, TCP and TLS should now all be domestic-fast
curl -so /dev/null -w 'dns=%{time_namelookup} connect=%{time_connect} \
tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' \
https://fast.hibana.ir/

# 2) Static caching works: second call must be a cache HIT (look for the cache-status
#    header Arvan returns; also compare the timing drop)
curl -sI https://fast.hibana.ir/vendor/htmx.min.js
curl -sI https://fast.hibana.ir/vendor/htmx.min.js

# 3) SECURITY — the API must NEVER be cached. Run twice; expect 401 both times,
#    no cache-HIT marker, no Set-Cookie on the error response:
curl -si -X POST https://fast.hibana.ir/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"a@b.c","password":"x"}'
```

If a cached login/API response ever appears (identical body on the second call, cache
HIT marker), **disable the mirror immediately** and re-check the Arvan cache rules.

## Known limits (accepted)

- Email and Telegram deep links still point at `https://hibana.ir` (the canonical host,
  hardcoded in `reminders.ts` / `sadhana.ts` / `email.ts`) — landing from a notification
  is the slow path; swap the hostname in the URL manually when needed.
- The session cookie is per-hostname: log in once on `fast.hibana.ir` (30-day rolling
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

## Rollback

Remove the two `fast` NS records from the CF zone — the Arvan zone orphans and stops
answering within the record TTL. Optionally unset `MIRROR_ORIGIN` (it is inert while
the hostname does not resolve). `hibana.ir` itself is never affected by any step here.
