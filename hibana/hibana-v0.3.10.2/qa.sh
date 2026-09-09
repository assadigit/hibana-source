#!/usr/bin/env bash
# QA runner: starts Hibana server, logs in, walks pages, captures snapshots + screenshots.
# Usage: ./qa.sh [screenshot-dir]   (default /tmp/qa)
# All within one process tree so the server lives for the duration of this call.
set -uo pipefail
HIB=/home/z/my-project/hibana/hibana-v0.3.10.2
OUT="${1:-/tmp/qa}"
mkdir -p "$OUT"

# --- start server ---
pkill -f "src/server.ts" 2>/dev/null; sleep 1
cd "$HIB"
export PORT=3000 NODE_ENV=development DB_PATH="$HIB/data/hibana.db"
export GITHUB_OWNER=assadigit GITHUB_REPO=hibana-safe OWNER_EMAIL=aliassadi@live.com
export CAPTCHA_SECRET_KEY=local-dev-captcha-secret OPEN_REGISTRATION=true MIRROR_ORIGIN=
node --import tsx src/server.ts > "$OUT/server.log" 2>&1 &
SRV=$!
# wait for health
for i in $(seq 1 30); do
  curl -sf -o /dev/null http://localhost:3000/api/health && break
  sleep 0.5
done
echo "[$(date +%H:%M:%S)] server up (pid $SRV)"

export AGENT_BROWSER_SESSION="hibana-qa"
agent-browser close --all >/dev/null 2>&1 || true

# console error collector via eval on each page
collect_errors() {
  local page="$1"
  agent-browser eval --stdin <<'JS' 2>/dev/null | head -c 2000
(JSON.stringify(window.__hibanaErrors || []))
JS
}

# --- login ---
agent-browser open http://localhost:3000/login.html >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser snapshot -i > "$OUT/01-login-snap.txt" 2>&1
agent-browser screenshot "$OUT/01-login.png" >/dev/null 2>&1
# fill login form using find by label/name
agent-browser find placeholder "Email or username" fill "ali@hibana.local" >/dev/null 2>&1 || \
  agent-browser find label "Email" fill "ali@hibana.local" >/dev/null 2>&1 || \
  agent-browser fill "input[name=login]" "ali@hibana.local" >/dev/null 2>&1
agent-browser find placeholder "Password" fill "hibana123" >/dev/null 2>&1 || \
  agent-browser fill "input[name=password]" "hibana123" >/dev/null 2>&1
agent-browser click "button[type=submit]" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 1
URL=$(agent-browser get url 2>/dev/null)
echo "[$(date +%H:%M:%S)] after login -> $URL"

# --- walk authenticated pages ---
PAGES=(dashboard projects board sprint calendar sparks sadhana notifications reports settings admin clients archive whiteboard canvas)
i=2
for p in "${PAGES[@]}"; do
  agent-browser open "http://localhost:3000/${p}.html" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  sleep 0.6
  ERRS=$(collect_errors "$p")
  printf '%s\n--- %s errors: %s' "$(agent-browser get title 2>/dev/null)" "$p" "${ERRS:0:300}" >> "$OUT/_titles.txt"
  agent-browser snapshot -i > "$OUT/$(printf '%02d' $i)-${p}-snap.txt" 2>&1
  agent-browser screenshot "$OUT/$(printf '%02d' $i)-${p}.png" >/dev/null 2>&1
  agent-browser screenshot --full "$OUT/$(printf '%02d' $i)-${p}-full.png" >/dev/null 2>&1
  i=$((i+1))
done

# --- public pages (logout first) ---
agent-browser open http://localhost:3000/api/auth/logout >/dev/null 2>&1
sleep 0.5
for p in login signup reset confirm; do
  agent-browser open "http://localhost:3000/${p}.html" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  sleep 0.4
  agent-browser snapshot -i > "$OUT/pub-${p}-snap.txt" 2>&1
  agent-browser screenshot "$OUT/pub-${p}.png" >/dev/null 2>&1
done

agent-browser close --all >/dev/null 2>&1 || true
kill $SRV 2>/dev/null
echo "[$(date +%H:%M:%S)] QA done — output in $OUT"
echo "=== server.log tail ===" ; tail -20 "$OUT/server.log"