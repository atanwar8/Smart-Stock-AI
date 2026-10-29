# backend-perf handoff

Status: **done** (2026-10-28; tests confirmed 2026-10-29: 75 pass, including test_perf.py). Owner files: `backend/main.py`, `backend/core/forecaster*.py`, `backend/core/open_meteo.py`,
`backend/tests/test_{api,forecaster,weather,perf}.py`, `Dockerfile`, `render.yaml`, `start.sh`, `docker-compose.yml`, `.github/**`.

## Done
- Baseline measured (`backend/var/perf_probe.py`, scratch, gitignored; untouched code snapshot in `backend/var/before_snapshot/`).
- Server-side caching: `TTLCache` + `cached()` in `core/forecaster_utils.py`; forecaster has `data_version`
  (`<generation>:<rows>:<latest report>`, bumped whenever `train_data` is assigned) and `latest_report`.
  Memoized: weekly series, forecasts (keyed by commodity, horizon, model token), `/commodities`, `/seasonal-patterns`.
- N+1: inventory list + alerts reuse the forecast memo; no per-item weather lookup; one grouped pass for `/commodities` units.
- HTTP: `HttpCacheHeaders` (ETag/304, Cache-Control policy), `GZipMiddleware(minimum_size=1000, compresslevel=6)`,
  `CachedStaticFiles` (immutable `/_next/static/*`, revalidating HTML).
- Pagination: `limit`/`offset` + `total` on `/alerts/recent` and `/inventory/list`.
- CPU-bound endpoints are now `def` (thread pool) so `/health` stays responsive while a model trains.
- xgboost/joblib code paths removed from `core/`.

- `backend/tests/test_perf.py`, deploy files (`WEB_CONCURRENCY`), requirements line edits.
- 2026-10-29: `tests/conftest.py` also isolates the SQLite store and disables startup seeding/training in tests.
