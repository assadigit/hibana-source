#!/usr/bin/env bash
# Focused re-QA after fix batch 1: archive, dashboard (tour dismissed), reports, sadhana, sparks, clients.
set -uo pipefail
HIB=/home/z/my-project/hibana/hibana-v0.3.10.2
OUT="${1:-/tmp/qa2}"
mkdir -p "$OUT"
pkill -f "src/server.ts" 2>/dev/null; sleep 1
cd "$HIB"
export PORT=3000 NODE_ENV=development DB_PATH="$HIB/data/hibana.db"
export GITHUB_OWNER=assadigit GITHUB_REPO=hibana-safe OWNER_EMAIL=aliassadi@live.com
export CAPTCHA_SECRET_KEY=local-dev-captcha-secret OPEN_REGISTRATION=true MIRROR_ORIGIN=
node --import tsx src/server.ts > "$OUT/server.log" 2>&1 &
SRV=$!
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3000/api/health && break; sleep 0.5; done
echo "[$(date +%H:%M:%S)] server up (pid $SRV)"
export AGENT_BROWSER_SESSION="hibana-qa2"
agent-browser close --all >/dev/null 2>&1 || true
# login
agent-browser open http://localhost:3000/login.html >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser fill "input[name=login]" "ali@hibana.local" >/dev/null 2>&1
agent-browser fill "input[name=password]" "hibana123" >/dev/null 2>&1
agent-browser click "button[type=submit]" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1; sleep 1
# dismiss the tour so we see the real dashboard
agent-browser eval --stdin <<'JS' >/dev/null 2>&1
try { localStorage.setItem('hibana-tour-done','1'); } catch(e){}
'ok'
JS
echo "[$(date +%H:%M:%S)] logged in, tour dismissed"
# visit target pages
declare -A PAGES=( [archive]=archive.html [dashboard]=/app [reports]=reports.html [sadhana]=sadhana.html [sparks]=sparks.html [clients]=clients.html [projects]=projects.html )
for name in archive dashboard reports sadhana sparks clients projects; do
  url="${PAGES[$name]}"
  agent-browser open "http://localhost:3000/${url}" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1; sleep 0.8
  # for projects, force the halted filter to see the archive empty state via the projects endpoint too
  if [ "$name" = "projects" ]; then
    agent-browser open "http://localhost:3000/projects.html?status=halted" >/dev/null 2>&1
    agent-browser wait --load networkidle >/dev/null 2>&1; sleep 0.6
  fi
  agent-browser screenshot --full "$OUT/${name}.png" >/dev/null 2>&1
  agent-browser snapshot -i > "$OUT/${name}-snap.txt" 2>&1
  echo "  $name -> $(agent-browser get title 2>/dev/null | head -c 60)"
done
agent-browser close --all >/dev/null 2>&1 || true
kill $SRV 2>/dev/null
echo "[$(date +%H:%M:%S)] re-QA done — output in $OUT"