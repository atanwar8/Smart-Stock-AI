# ADR-001: Ship the dashboard and API as one container on Render

## Status
Superseded by [ADR-007](ADR-007-vercel-and-supabase.md) on 2026-10-30 (the app moved to Vercel + Supabase)

## Date
2026-10-27

## Context
SmartStock has a Next.js dashboard and a FastAPI backend. The backend:

- keeps inventory, alert settings and trained models in memory,
- trains ten LightGBM models from a 5 MB CSV at startup,
- runs a Selenium + Chrome scraper that writes new rows back to that CSV.

The goal was a cloud deploy that works with one click, with nothing running on a laptop.

## Decision
Build one Docker image: a Node stage exports the dashboard as static files, and the Python stage serves them from FastAPI at `/` next to the API under `/api`. Deploy that image on Render from `render.yaml`, auto-deploying `main` only after GitHub CI passes.

## Alternatives Considered

### Vercel (Python functions or the container runtime)
- Pros: fast global CDN for the dashboard, preview URL per change.
- Cons: instances scale to zero after 5 idle minutes in production (30 seconds on previews), so in-memory inventory and trained models reset often; the filesystem the scraper writes to is not persistent; preview URLs sit behind Vercel login by default.
- Rejected for now: the app's state model fits a long-lived process better. A test deploy on Vercel's container runtime did work.

### Separate frontend and backend services
- Pros: frontend on a CDN, independent scaling.
- Cons: two deploys to keep in sync, CORS, and a hardcoded API URL in the build.
- Rejected: one origin removes CORS and keeps the UI and API versions in lockstep.

## Consequences
- One URL, one deploy, no CORS. The UI calls relative `/api/...` paths; `npm run dev` proxies them to `localhost:8000`.
- State is still in memory: restarts and redeploys reset inventory, and the models retrain in the background at startup.
- Render's free plan sleeps after 15 idle minutes and takes about a minute to wake; the dashboard shows "Waking up" meanwhile.
- The image includes Chromium (~490 MB total). Scraping needs more RAM than the free plan's 512 MB.
- Moving state to a database (for example Render Postgres) is the next step if the app needs to keep data across restarts.
