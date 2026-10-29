# ml-pipeline handoff (done 2026-10-29, finished by the cloud session)

## Contract deviations
None so far.

## Done
- Store (`backend/store/`): SQLAlchemy Core tables mirroring the migration, Postgres (psycopg 3, pooled) or SQLite
  `backend/var/smartstock.db`; upsert on natural key (counts inserted vs changed), seed-on-empty (`seed:csv`).
- Deps pinned in `backend/requirements.txt` and installed into `backend/.venv`: SQLAlchemy 2.0.36,
  psycopg[binary] 3.2.13, statsmodels 0.14.4 (numpy/pandas untouched).
- Models (`backend/ml/models`): naive, seasonal_naive, ets, theta, lightgbm (global direct), ensemble.
  (TimesFM and its `.venv-ml` were removed on 2026-10-29.)
  Rolling-origin backtest engine (`backend/ml/backtest.py`) with conformal intervals (`ml/intervals.py`).

- `ml/service.py`: catalog, leaderboard, preview (cached per data version x commodity x model x history window;
  reuses the pipeline's stored backtest/calibration for the full window), apply, active.
- `ml/pipeline.py`: Extract -> Load -> Train -> Test in a background thread, advisory-locked; skipped/failed runs recorded.
- `routers/forecast.py`: every SPEC §5 route; startup seeds an empty store and scores it once (background).
- `core/usda_api.fetch_window`, tests, `docs/ml/MODEL_GUIDE.md`, ADR-006.

## Not verified
- A real USDA refresh into Supabase (needs the keys).

## How to verify
`cd backend && .venv/bin/python -m pytest -q tests/test_store.py tests/test_pipeline.py tests/test_forecast_api.py tests/test_ml_models.py`

## Notes
- LightGBM's macOS wheel needs Homebrew libomp, which this Mac lacks. The model falls back to sklearn
  HistGradientBoosting automatically; set
  `DYLD_FALLBACK_LIBRARY_PATH=backend/.venv/lib/python3.9/site-packages/sklearn/.dylibs` (or `brew install libomp`)
  to use real LightGBM locally. Docker/Linux is unaffected.
