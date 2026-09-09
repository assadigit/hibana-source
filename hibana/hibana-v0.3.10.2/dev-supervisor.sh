#!/usr/bin/env bash
# Dev supervisor: restarts the Hibana Node server if it crashes.
# Detached via setsid; logs to /home/z/my-project/dev.log.
cd /home/z/my-project/hibana/hibana-v0.3.10.2
export PORT=3000
export NODE_ENV=development
export DB_PATH=/home/z/my-project/hibana/hibana-v0.3.10.2/data/hibana.db
export GITHUB_OWNER=assadigit
export GITHUB_REPO=hibana-safe
export OWNER_EMAIL=aliassadi@live.com
export CAPTCHA_SECRET_KEY=local-dev-captcha-secret
export OPEN_REGISTRATION=true
export MIRROR_ORIGIN=

while true; do
  echo "[supervisor] starting Hibana Node server @ $(date -u +%FT%TZ)"
  node --import tsx src/server.ts
  code=$?
  echo "[supervisor] server exited code=$code @ $(date -u +%FT%TZ) — restarting in 2s"
  sleep 2
done
