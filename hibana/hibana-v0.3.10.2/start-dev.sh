#!/usr/bin/env bash
# Start Hibana on the Node self-host path (port 3000) for local QA.
# AI binding is Workers-only -> magic button returns 503 locally (expected).
set -e
cd /home/z/my-project/hibana/hibana-v0.3.10.2
export PORT=3000
export NODE_ENV=development
export DB_PATH=/home/z/my-project/hibana/hibana-v0.3.10.2/data/hibana.db
export GITHUB_OWNER=assadigit
export GITHUB_REPO=hibana-safe
export GITHUB_TOKEN=  # not needed for local UI QA
export OWNER_EMAIL=aliassadi@live.com
export CAPTCHA_SECRET_KEY=local-dev-captcha-secret
export OPEN_REGISTRATION=true
export MIRROR_ORIGIN=
# Optional services left unset (telegram/resend/backup key) -> degrade gracefully.
exec node --import tsx src/server.ts
