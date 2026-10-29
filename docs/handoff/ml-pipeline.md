# ml-pipeline handoff (in progress)

## Contract deviations
None so far.

## Done
- Store (`backend/store/`): SQLAlchemy Core tables mirroring the migration, Postgres (psycopg 3, pooled) or SQLite
  `backend/var/smartstock.db`; upsert on natural key (counts inserted vs changed), seed-on-empty (`seed:csv`).
- Deps pinned in `backend/requirements.txt` and installed into `backend/.venv`: SQLAlchemy 2.0.36,
  psycopg[binary] 3.2.13, statsmodels 0.14.4 (numpy/pandas untouched).
- `backend/.venv-ml` (Python 3.12): timesfm 3.0.2 (ships `TimesFM_2p5_200M_torch`), torch, lightgbm, sklearn.
  TimesFM 2.5 loads and forecasts on this Mac.
- Models (`backend/ml/models`): naive, seasonal_naive, ets, theta, lightgbm (global direct), timesfm, ensemble.
  Rolling-origin backtest engine (`backend/ml/backtest.py`) with conformal intervals (`ml/intervals.py`).

## In progress
- ml/service.py (preview/leaderboard caches), ml/pipeline.py, routers/forecast.py, scripts, tests, docs.

## Notes
- LightGBM's macOS wheel needs Homebrew libomp, which this Mac lacks. The model falls back to sklearn
  HistGradientBoosting automatically; set
  `DYLD_FALLBACK_LIBRARY_PATH=backend/.venv/lib/python3.9/site-packages/sklearn/.dylibs` (or `brew install libomp`)
  to use real LightGBM locally. Docker/Linux is unaffected.
