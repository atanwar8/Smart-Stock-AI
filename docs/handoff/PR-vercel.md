## Deploy on Vercel and read stored forecasts everywhere

### Why
Render's free plan sleeps and takes about a minute to wake. And the Overview, Smart ordering and Alerts trained
their own model per vegetable on first use, from the bundled CSV, which ends in July 2025.

### What changes
- **Vercel** (`vercel.json`, `api/`): the static dashboard from the CDN, and the FastAPI app as one Python 3.12
  function in `pdx1` (next to Supabase us-west-2). A weekly cron (`/api/pipeline/cron`, Saturdays 15:00 UTC,
  guarded by `CRON_SECRET`) runs Extract -> Load -> Train -> Test inside its request (~70 s; limit 300 s).
  `render.yaml` removed; ADR-007 supersedes ADR-001.
- **Serverless-safe backend** (`VERCEL=1`): nothing trains at startup or in background threads. The app
  initializes on its first request if startup events are skipped. Data refresh runs inside its request, and other
  instances see the run's `ingest_runs` row.
- **Train once, read everywhere**: the dashboard's history is the training store's rows for the pipeline's region.
  Every daily forecast adopts the pipeline's stored champion, or the forecast applied in the Forecast Studio. One
  query reads every vegetable's runs.
- **Fixes**: the old path averaged every USDA region together after the API refresh (tomatoes $2.24/lb instead of
  the Midwest's $1.65). Apply prediction promised "ordering now plans with …" but ordering ignored it.
- Pins for Python 3.12 wheels: numpy 1.26.4, pandas 2.2.3, scikit-learn 1.5.2.

### Measured (cold start, store refreshed to Oct 2026)
| Call | Before | After |
| --- | --- | --- |
| First answer after start | — | 1.7 s |
| `/inventory/list` | 920 ms | 3 ms |
| `/forecast/leaderboard` | 24 s | 2 ms |
| 7-day forecast, each further vegetable | ~1 s | 2–5 ms |

### Checks
- 88 backend tests pass on Python 3.9, and on Python 3.12 with the versions Vercel installs (incl. SciPy 1.17).
- New tests: `test_serverless.py` (adoption, applied forecast, cron secret, in-request refresh, cross-instance
  status), `test_deploy.py` (Vercel pins and config).
- Clicked through locally in Vercel mode: Overview, Studio sample -> Apply, no console errors.

### Before merging
- Vercel → smartstock-ai → Settings → Environment Variables (Production + Preview): `SUPABASE_DB_URL` (session
  pooler), `MARS_API_KEY`, `CRON_SECRET`.
- Connect the GitHub repo to the Vercel project (Settings → Git) so `main` deploys production.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
