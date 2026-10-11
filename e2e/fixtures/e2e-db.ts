// The ONE shared path contract (S202 — the banked S200 sweep): the specs' direct-DB
// seeds and shots writes must target the SAME paths the Playwright webServer boots
// with. Reads E2E_DB / E2E_SHOTS so LOCAL PARALLEL SHARDS (E2E_PORT + E2E_DB +
// E2E_SHOTS per shard invocation) can diverge from the defaults — CI's shards are
// separate runners and keep the defaults. playwright.config.ts reads the same env
// vars for the webServer; this module is the specs' half of the contract.
// (Before S202, 86 spec files hardcoded '/tmp/hibana-e2e.db' — local parallel
// shards seeded a DB the server never read.)
export const E2E_PORT = process.env.E2E_PORT ?? '3017'
// The T6 origin gate 403s cross-origin POSTs — specs that send an explicit Origin
// (the server-side-caller carve-out) must send THEIR runner's origin, not a hardcoded
// port (the S202 lesson: the s199 reset spec hardcoded 3017 and every non-default-port
// run — local parallel shards — got 403 {forbidden} before any route ran).
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`
export const E2E_DB = process.env.E2E_DB ?? '/tmp/hibana-e2e.db'
export const E2E_SHOTS = process.env.E2E_SHOTS ?? '/tmp/hibana-e2e-shots'
