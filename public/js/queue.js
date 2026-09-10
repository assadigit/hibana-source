// Shared offline queue (spec §3.4 + Q5-A): Canvas + Spark quick-add only.
// Writes land in IndexedDB first (works with zero connectivity), then flush on reconnect,
// plus a periodic retry. The badge keeps you honest: "N unsynced changes" while non-empty.
//
// Items are stored with an explicit `id` keyPath so flush can delete exactly the rows it
// successfully pushed — using autoIncrement here silently broke deletion (the key is not
// part of the value), which left items queued and caused duplicate-upsert 500s.

window.hibanaQueue = (() => {
  const DB = 'hibana-queue'
  const STORE = 'pending'
  const VERSION = 2
  let db = null
  let flushing = false
  const listeners = new Set()

  // Save-status states (canvas/notebook bottom-left badge):
  //   'idle'   → “N unsynced changes” while the queue holds items, hidden when empty
  //   'saving' → spinner + “Saving…” for the whole flush request
  //   'saved'  → static “Saved” until the confirm hint times out
  //   'auth'   → “Sign in to sync” — 401/403 kept the items; the next good flush clears it
  let state = 'idle'
  let savedTimer = null
  const SAVED_HINT_MS = 2200

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION)
      req.onupgradeneeded = (ev) => {
        const d = ev.target.result
        // Fresh-start: drop any legacy (autoIncrement) store and use the id keyPath.
        if (d.objectStoreNames.contains(STORE)) d.deleteObjectStore(STORE)
        d.createObjectStore(STORE, { keyPath: 'id' })
      }
      req.onsuccess = () => { db = req.result; resolve(db) }
      req.onerror = () => reject(req.error)
    })
  }

  async function withStore(mode, fn) {
    if (!db) await open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const store = tx.objectStore(STORE)
      const out = fn(store)
      tx.oncomplete = () => resolve(out?.result)
      tx.onerror = () => reject(tx.error)
    })
  }

  function paintBadge(n) {
    const badge = document.querySelector('[data-syncbadge]')
    if (!badge) return
    if (state === 'saving') {
      badge.innerHTML = '<span class="sync-spin" aria-hidden="true"></span>' + (window.hibanaI18n?.t('queue.saving') || 'Saving…')
      badge.hidden = false
      return
    }
    if (state === 'saved') {
      badge.textContent = window.hibanaI18n?.t('queue.saved') || 'Saved'
      badge.hidden = false
      return
    }
    if (state === 'auth') {
      badge.textContent = window.hibanaI18n?.t('queue.auth') || 'Sign in to sync'
      badge.hidden = false
      return
    }
    badge.textContent = `${n} ${window.hibanaI18n?.t('queue.unsynced') || 'unsynced changes'}`
    badge.hidden = n === 0
  }

  function emit() {
    count().then((n) => {
      paintBadge(n)
      for (const l of listeners) l(n)
    })
  }

  async function count() {
    return withStore('readonly', (s) => s.count())
  }

  async function enqueue(item) {
    // A new edit invalidates any lingering “Saved” confirmation.
    state = 'idle'
    clearTimeout(savedTimer)
    const row = { id: crypto.randomUUID(), ...item }
    mirror.set(row.id, row) // synchronous mirror for the pagehide beacon
    await withStore('readwrite', (s) => s.add(row))
    emit()
    scheduleFlush()
  }

  async function pendingItems() {
    return withStore('readonly', (s) => s.getAll())
  }

  async function remove(ids) {
    if (!ids || ids.length === 0) return
    for (const k of ids) mirror.delete(k)
    await withStore('readwrite', (s) => {
      for (const k of ids) s.delete(k)
    })
    emit()
  }

  async function flush() {
    // An in-flight flush must be waited out, not abandoned: entries enqueued mid-flush would
    // otherwise sit behind a `return false` and depend on the debounce timer alone.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
    while (flushing) await new Promise((r) => setTimeout(r, 150))
    flushing = true
    try {
      const items = (await pendingItems()) ?? []
      if (items.length === 0) return true
      state = 'saving' // stays up for the whole request(s) below
      paintBadge(items.length)
      // 401/403 (expired session / CSRF rejection) must NEVER drop queued work — the
      // queue's whole promise is “never lose an idea”. Keep every item, park the badge in
      // the 'auth' state, and stop this flush cycle; the periodic retry (or the next login)
      // picks the items back up and a 200 returns the badge to normal. Only genuinely
      // invalid payloads (400/404/409/422) are dropped; other 4xx (429, …) keep the
      // existing retry-later behavior.
      const authBlocked = (res) => res.status === 401 || res.status === 403
      const invalidInput = (res) => [400, 404, 409, 422].includes(res.status)
      // Server errors (500) used to retry forever — a corrupt FTS5 index caused 1836
      // failed syncs that left "45 unsynced" stuck for days. Now: a 500 increments the
      // item's retry count; after MAX_RETRIES the item is dropped (with a console warning)
      // so the badge clears + the user isn't stuck. The data stays in the user's
      // IndexedDB backup until then (sendBeacon still fires on pagehide).
      const MAX_RETRIES = 5
      const canvasBatch = items.filter((i) => i.kind === 'canvas')
      if (canvasBatch.length > 0) {
        const res = await fetch('/api/canvas/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ elements: canvasBatch.map((i) => i.data) }),
        })
        if (res.ok) await remove(canvasBatch.map((i) => i.id))
        else if (authBlocked(res)) { state = 'auth'; emit(); return false }
        else if (invalidInput(res)) await remove(canvasBatch.map((i) => i.id)) // permanently invalid — stop retrying
        else if (res.status >= 500) {
          // Server error — bump retry counts, drop items that exceeded MAX_RETRIES
          const drop = canvasBatch.filter((i) => (i.retries = (i.retries || 0) + 1) >= MAX_RETRIES)
          if (drop.length > 0) {
            console.warn('[queue] dropping', drop.length, 'canvas items after', MAX_RETRIES, 'failed syncs (server error)')
            await remove(drop.map((i) => i.id))
            // Re-queue the survivors with their updated retry count
            const survivors = canvasBatch.filter((i) => !drop.includes(i))
            for (const s of survivors) {
              await withStore('readwrite', (store) => store.put(s))
            }
          }
          state = 'idle'; emit(); return false
        }
        else { state = 'idle'; emit(); return false } // rate-limited / other — retry later
      }
      const projectCreates = items.filter((i) => i.kind === 'project')
      for (const item of projectCreates) {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.data),
        })
        if (res.ok) await remove([item.id])
        else if (authBlocked(res)) { state = 'auth'; emit(); return false } // keep the idea — re-auth and retry
        else if (invalidInput(res)) await remove([item.id]) // permanently invalid — stop retrying
        else if (res.status >= 500) {
          if ((item.retries = (item.retries || 0) + 1) >= MAX_RETRIES) {
            console.warn('[queue] dropping project', item.id, 'after', MAX_RETRIES, 'failed syncs')
            await remove([item.id])
          }
          state = 'idle'; emit(); return false
        }
        else { state = 'idle'; emit(); return false } // rate-limited / server error — retry later
      }
      const left = await pendingItems()
      if (left.length === 0) {
        // Server confirmed — static confirmation, then the badge goes quiet.
        state = 'saved'
        paintBadge(0)
        clearTimeout(savedTimer)
        savedTimer = setTimeout(() => {
          state = 'idle'
          emit()
        }, SAVED_HINT_MS)
      }
      return left.length === 0
    } catch (err) {
      console.warn('queue flush failed (will retry):', err)
      state = 'idle'
      emit()
      return false
    } finally {
      flushing = false
    }
  }

  let timer = null
  // Synchronous mirror of the pending queue (id → item). IndexedDB reads are async and
  // DO NOT reliably complete during pagehide — the beacon below reads this instead.
  const mirror = new Map()
  function scheduleFlush() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 1500) // debounce rapid edits into one flush
  }

  if (typeof window !== 'undefined' && 'indexedDB' in window) {
    open().catch(() => {})
    window.addEventListener('online', () => scheduleFlush())
    setInterval(scheduleFlush, 15000) // periodic retry while offline
    document.addEventListener('DOMContentLoaded', emit)

    // Phase 6 (2026-09-09, item 1 — "notebook said Saved but the content vanished"):
    // leaving the page while a flush was mid-debounce aborted the POST and the queued
    // items sat in IndexedDB until some later page's 15s retry — and if that page had
    // no queue (or the tab closed) the work never landed. sendBeacon delivers the
    // pending canvas batch DURING unload (fire-and-forget, cookies included), reading
    // the synchronous mirror (an IDB read would race the teardown). The items STAY
    // queued: the sync endpoint is idempotent LWW, so the next regular flush
    // re-sending them is a harmless no-op (same updated_at → skipped).
    // ORDERING (the first version of this missed it): boards register a PRE-BEACON
    // hook (window.hibanaQueuePreBeacon) that commits any live text edits SYNCHRONOUSLY
    // (their enqueue mirrors synchronously) — the beacon listener must run it FIRST,
    // because whiteboard.js loads AFTER queue.js and would otherwise enqueue only
    // after the beacon already read an empty mirror.
    window.addEventListener('pagehide', () => {
      try {
        if (typeof window.hibanaQueuePreBeacon === 'function') window.hibanaQueuePreBeacon()
      } catch { /* a consumer error must not block the beacon */ }
      try {
        if (typeof navigator.sendBeacon !== 'function' || mirror.size === 0) return
        const canvasBatch = [...mirror.values()].filter((i) => i.kind === 'canvas')
        if (canvasBatch.length === 0) return
        const blob = new Blob([JSON.stringify({ elements: canvasBatch.map((i) => i.data) })], { type: 'application/json' })
        navigator.sendBeacon('/api/canvas/sync', blob)
      } catch { /* best effort — the queue itself survives in IndexedDB */ }
    })
  }

  return { enqueue, flush, count, get pendingCount() { return count() }, onCount: (fn) => listeners.add(fn),
    // Clear all stuck items (user-facing "clear queue" for when items are stuck due to
    // server errors that won't resolve). Drops everything from IndexedDB + the mirror.
    clearAll: async function() {
      const ids = [...mirror.keys()]
      mirror.clear()
      await withStore('readwrite', (s) => s.clear())
      state = 'idle'
      emit()
      return ids.length
    } }
})()