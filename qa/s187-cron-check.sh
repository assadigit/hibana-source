#!/bin/sh
# S187 cron-chain proof: after the 03:17 (dev) + 03:23 (prod) UTC backup ticks,
# read the "Hibana" watchdog's STATE — with the re-armed GITHUB_TOKEN both ticks
# must have pinged SUCCESS (the check flips up; last_ping lands at a tick time).
# (The v1 ping-LIST endpoint rejects this key class — the v3 checks list carries
# status + last_ping, which is the same proof.)
RK=$(grep -E '^HEALTHCHECKS_READ_KEY=' /home/z/hibana/.secrets.env | cut -d= -f2-)
curl -s -H "X-Api-Key: $RK" "https://healthchecks.io/api/v3/checks/" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for c in d.get('checks', []):
    if c.get('name') != 'Hibana':
        continue
    status, last = c.get('status'), c.get('last_ping')
    print('Hibana watchdog:', status, '| last ping:', last)
    if status == 'up' and last and last >= '2026-10-03T03:1':
        print('VERDICT: BACKUP CHAIN RESTORED — the tick(s) ran SUCCESS with the fresh token')
    elif status == 'down':
        print('VERDICT: STILL DOWN — run: wrangler tail (both workers) around the next tick; check the GITHUB_TOKEN secret + the hibana-safe repo\\'s branch')
    else:
        print('VERDICT: check is', status, 'with last ping', last, '— compare against the tick schedule (03:17 dev / 03:23 prod UTC)')
"
