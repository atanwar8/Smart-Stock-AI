# ADR-006: A Supabase training store behind Forecast Studio

Date: 2026-10-29 · Status: accepted

## Context

Prices pulled from USDA lived only on the server's temporary disk (ADR-004), so every restart re-downloaded them, and
nothing about a forecast survived a redeploy. The redesign adds Forecast Studio, where a chef compares models,
generates a sample prediction and **applies** it. An applied forecast, and the scores it was chosen on, have to persist.

## Decision

- A **training store** with four tables (`supabase/migrations/20261028000000_training_store.sql`): `usda_prices`
  (every USDA row, unique on the natural key), `ingest_runs` (one row per seed or refresh), `training_runs` (one row
  per vegetable × model per scoring batch, with metrics and calibration), `forecasts` (previews, the one applied
  forecast per vegetable, superseded ones). RLS is on with no policies; only the backend connects, as the owner.
- **Supabase Postgres** (project "Smart-Stock-AI") when `SUPABASE_DB_URL` is set, through the **session pooler**
  (Render has no IPv6, so `db.<ref>.supabase.co` doesn't work from it). Otherwise a local SQLite file with the same
  tables (`backend/var/smartstock.db`). One SQLAlchemy Core code path serves both.
- **Refresh is incremental and append-only**: request only from the newest stored week (minus 6 days, to pick up
  corrections) to today, upsert on the natural key, never delete. Re-running the same window is a no-op.
- **Models are rescored after every refresh** on all stored weeks (expanding window), with the newest 8 weeks held out.
- The existing dashboard pages keep their CSV-based daily forecaster (`core/forecaster*.py`) for now.

## Consequences

- Restarts no longer lose USDA data or applied forecasts; the seed runs only when the store is empty.
- A fresh environment works without Supabase (SQLite seed + startup scoring in about a minute, in the background).
- Two forecasting stacks exist side by side until the overview and ordering pages move to the store's series.
- Tests always use a temporary SQLite file (`backend/tests/conftest.py`), never Supabase or the local store.
