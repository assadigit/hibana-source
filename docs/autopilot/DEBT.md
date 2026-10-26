# Hibana Autopilot — DEBT (shortcuts, workarounds, deferred items)

> Each item: what it is, why it was deferred, its impact, and the removal path.
> Only conscious, explained items live here (PLAYBOOK §2, WF-5). Out-of-phase findings go here, not into the current diff.

| Item | Reason deferred | Impact | Removal path |
|------|-----------------|--------|--------------|
| kv/r2/github REST fetches without timeouts (AP-17) | Resend was the playbook-mandated fix; the storage chain moves payload sizes from 5KB screenshots to multi-MB backup zips, so a blanket timeout risks breaking large transfers | A stalled storage connection hangs the request/cron riding it (rare; TCP keepalives usually reap first) | Per-call AbortSignal budgets sized to the payload class (shots 30s, backups 120s); add with a load test on a large backup |
| Telegram NULL-user capture rows never purged (AP-16) | Hygiene, not security (rows are unassignable without the single-use link code; Telegram caps message size) | Unbounded junk-row growth from strangers texting the bot | A `DELETE FROM telegram_captures WHERE user_id IS NULL AND created_at < now-30d` in the existing daily cron sweep (additive migration-free) |
| CSP remains unsafe-inline/unsafe-eval (AP-18) | The no-build frontend requires inline scripts + Alpine expression evaluation; a nonce/hash policy must rework 27 wired pages + 812 refs — a project, not a hardening tweak | CSP is not an XSS backstop; the escape discipline + escape-lint gate (213 sinks, PASS) is the barrier | Nonce-based CSP with a build step that hashes/rewrites inline blocks; revisit after the Phase 3 modularization |
| node:sqlite concurrent-transaction 500s (AP-15) | Out of Phase 1 scope (a runtime robustness bug, not a security hole); the fix touches the shared adapter used by every test | Concurrent writes on the Node self-host path can 500 (D1 unaffected) | Serialize transactions per connection (an async mutex around BEGIN…COMMIT) or open a connection per transaction; Phase 2 bug-hunt round owns it |
