# ADR-007: Host on Vercel, train in a scheduled request, read stored forecasts everywhere

## Status
Accepted (supersedes [ADR-001](ADR-001-single-container-on-render.md))

## Date
2026-10-30

## Context
On Render's free plan the single container slept after 15 idle minutes and took about a minute to wake, so the
first visit after a quiet spell showed a "waking up" screen. The user asked to move to Vercel, where static files
come from a CDN and Python runs as functions that start in seconds.

Two things in the backend did not fit functions: work at startup (seeding, scoring the models, pulling USDA into the
CSV, pretraining a LightGBM model per vegetable) and background threads (the refresh). A function instance is
frozen as soon as it answers, and a new one can start for any request. The Overview, Smart ordering and Alerts
also trained their own model per vegetable on first use, from the bundled CSV, which on a cold instance cost about
a second per vegetable and quoted older prices than the Forecast Studio (the CSV ends in July 2025).

## Decision
- **Vercel** project `smartstock-ai`: the static export from the CDN, the FastAPI app as one Python 3.12 function
  (`api/index.py`, region `pdx1` next to Supabase us-west-2), `/api/(.*)` rewritten to it (`vercel.json`).
- **Nothing heavy at startup on Vercel** (`VERCEL=1`): no pretraining, no CSV refresh, no store preparation. If the
  runtime skips ASGI startup events, the app initializes on its first request.
- **The refresh runs inside a request, and only on demand**: `POST /pipeline/refresh` (the Data refresh button) runs
  Extract -> Load -> Train -> Test synchronously; there is no schedule (the user's decision, 30 Oct 2026: data is
  pulled only when someone clicks Data refresh, from the newest stored week to today); about 70 s measured, the function may run 300 s. Status pages on other instances see the run's
  `ingest_runs` row as "running" (rows older than 15 minutes are treated as abandoned).
- **Train once, read everywhere**: the dashboard's price history is the training store's rows for the pipeline's
  region, and every daily forecast adopts the pipeline's stored champion path (lowest hold-out MASE) when it was
  scored on the same weeks and ends on the same price. Only a vegetable without such a run is trained on demand.

## Consequences
- No sleep screen; the first API call after a quiet spell costs a few seconds (Python imports and one read of the
  price history), every later one milliseconds.
- One forecast per vegetable across Overview, Smart ordering, Alerts and the studio; no web request fits a model.
- Inventory and alert settings still live in process memory, so on Vercel they are per instance and reset on a cold
  start. Persisting them in Supabase is the follow-up.
- Training on Vercel uses whatever LightGBM can load there; without OpenMP the LightGBM model falls back to
  scikit-learn (the leaderboard shows the scores either way).
- `render.yaml` was removed. The Dockerfile stays for running the whole app locally like production.
