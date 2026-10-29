#!/usr/bin/env bash
# Run SmartStock AI locally with one command.
#
#   ./start.sh         dev mode: dashboard on http://localhost:3000 (hot reload), API on :8000
#   ./start.sh prod    one server like the cloud deploy: everything on http://localhost:8000
#
# First run installs Python and Node dependencies; later runs start straight away.
set -euo pipefail
cd "$(dirname "$0")"

mode="${1:-dev}"

if ! command -v python3 >/dev/null || ! command -v npm >/dev/null; then
  echo "SmartStock AI needs python3 (3.9+) and Node.js (npm). Or run: docker compose up --build" >&2
  exit 1
fi

if [ ! -x backend/.venv/bin/uvicorn ]; then
  echo "→ Installing Python packages into backend/.venv"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install --quiet --upgrade pip
  backend/.venv/bin/pip install --quiet -r backend/requirements.txt
fi

if [ ! -d smartstock-nextjs/node_modules ]; then
  echo "→ Installing dashboard packages"
  (cd smartstock-nextjs && npm ci --no-audit --no-fund)
fi

if [ "$mode" = "prod" ]; then
  echo "→ Building the dashboard"
  (cd smartstock-nextjs && npm run build)
  echo "→ SmartStock AI on http://localhost:8000"
  # WEB_CONCURRENCY > 1 runs several worker processes; inventory and alerts are per-process memory, so keep 1 for now
  cd backend && exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers "${WEB_CONCURRENCY:-1}"
fi

# Dev: run both servers, stop both on Ctrl+C
trap 'kill 0' EXIT INT TERM
(cd backend && .venv/bin/uvicorn main:app --port 8000 --reload) &
(cd smartstock-nextjs && npm run dev) &
echo "→ Dashboard on http://localhost:3000 · API docs on http://localhost:8000/docs"
wait
