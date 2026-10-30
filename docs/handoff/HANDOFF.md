# Handoff — redesign + Forecast Studio + Supabase pipeline

Status: **done and live** (30 Oct 2026). `feat/vercel-read-only-forecasts` merged into `main` (c555365); Vercel deploys `main` to production at https://smartstock-ai-pied.vercel.app (Git-connected; branches get previews). Render is shut down. Inventory and alert settings now persist in Supabase (`inventory_items`, `app_settings`). CI is green.
Earlier status line, kept for history: **feature-complete on the branch, not merged** (updated 2026-10-29 by the cloud session that resumed this work). Branch `feat/forecast-studio-redesign` on GitHub. The desktop session's uncommitted work was pushed by the user as commit 7738b9e; everything after it is in the commits that follow.
The contract for all work is [`SPEC.md`](SPEC.md). Each workstream keeps its own running note next to this file:
[`frontend-shell.md`](frontend-shell.md), [`frontend-studio.md`](frontend-studio.md), [`backend-perf.md`](backend-perf.md), [`ml-pipeline.md`](ml-pipeline.md).
If you are the next agent: read SPEC.md, then those four notes, then finish the checklist below in order.

## What the user asked for
1. **Frontend:** a very Apple-like, unique, personal redesign (references: Pelago demo, Caudal Sankey, Atisbo anomaly alert,
   Vencimientos calendar, Presagio cone-of-uncertainty with a pace slider). Produce shown as small animated **symbols**, not names.
2. **Backend performance checklist** from two screenshots (caching, load balancer, DB index, compression, skeletons, N+1, debounce,
   code splitting, CDN, pagination, Lighthouse, minify, lazy loading, defer scripts, unused deps, connection pooling).
3. **Supabase training pipeline:** 2 years of USDA data stored in Supabase as the base training set; each refresh extracts only
   the new weeks since the newest stored report, appends them (never deleting), retrains on the expanding window, and tests
   (TimesFM was planned, then removed by the user on 2026-10-29). Several selectable models after a deep analysis; README explains it.
4. **Forecast Studio UI:** model picker, sliders (horizon, confidence, history, pace), rotating "predicting" animation,
   a **sample prediction** that the user can **Apply** (Wispr Flow-style suggestion).

## Done by the coordinator
- Found the project (this folder; GitHub `atanwar8/Smart-Stock-AI`). Created branch `feat/forecast-studio-redesign`.
- Supabase project **Smart-Stock-AI** (`vzxwqcxckafumughmgpc`, us-west-2, URL `https://vzxwqcxckafumughmgpc.supabase.co`):
  applied `supabase/migrations/20261028000000_training_store.sql` (tables `ingest_runs`, `usda_prices`, `training_runs`,
  `forecasts`; indexes; RLS on with no policies). Tables are **empty**.
- Scaffolding: `backend/routers/forecast.py` stub included from `backend/main.py`; `ProduceIcon` stub with the final
  contract; redesign tokens added to `globals.css`; `.gitignore` ignores `backend/var/` and `backend/.venv-ml/`.
- Launched 4 parallel agents (frontend-shell, frontend-studio, backend-perf, ml-pipeline) with briefs equal to SPEC.md.

## Supabase state (verified 2026-10-28)
- `backend/.env` (git-ignored) holds the user's `SUPABASE_DB_URL` (Session pooler, `aws-1-us-west-2.pooler.supabase.com:5432`)
  and `MARS_API_KEY`. Never print them. `backend/tests/conftest.py` blanks both before `main.py`'s `load_dotenv()` so
  tests always run on a temp SQLite store.
- Seeded with `store.seed.seed_if_empty(open_store())`: ingest run **2** (`seed:csv`, succeeded), **6,783** rows,
  **104** weeks, **41** commodities, 2023-07-28 → 2025-07-25. (Run id 1 was a deleted placeholder.)
- Advisors: RLS-on/no-policy ×4 (intended: backend connects as owner), unused indexes ×3 (fresh tables), and a WARN that
  Supabase's own `public.rls_auto_enable()` SECURITY DEFINER function is executable by `anon`/`authenticated` — left for
  the user to decide (suggested fix: `revoke execute on function public.rls_auto_enable() from anon, authenticated;`).
- Still to do: the first incremental refresh (2025-07-25 → today) through `/pipeline/refresh` once the ML router is done;
  add `SUPABASE_DB_URL` + `MARS_API_KEY` to the Render service's environment for the live deploy.
- Commit / push / PR: only when the user says so.

## Resumed 2026-10-29 (cloud session)
What the four agents left unfinished, and what was done about it:
- **ml-pipeline**: `ml/service.py`, `ml/pipeline.py`, `routers/forecast.py` (was an 8-line stub), `core/usda_api.fetch_window`,
  tests (`test_store`, `test_pipeline`, `test_forecast_api`, `test_ml_models`) and
  `docs/ml/MODEL_GUIDE.md` written. ADR-006 records the store decision.
- **frontend-shell**: Alerts and Data refresh pages finished, Plotly removed, lint warning fixed (see frontend-shell.md).
- **frontend-studio**: verified against the real backend (Sample prediction -> Apply in a browser). The answer headline now
  measures change from the 4-week average, matching the backend summary; model cards no longer overflow at 375 px.
- **backend-perf**: `tests/conftest.py` now also points tests at a temp SQLite file (they were defaulting to
  `backend/var/smartstock.db`) and turns off startup seeding/training.
- Overview: the summary sentence reserves its height (Lighthouse CLS 0.24 -> 0.002); low-contrast dock and Market
  pulse labels raised to pass WCAG AA.

Verified in the cloud: 75 backend tests pass on Python 3.11; tsc, lint, build and npm audit clean; every section at
1440 and 375 px with no console errors and no horizontal scroll; Lighthouse desktop 100/100/100/100, mobile 88/100/100/100.
TimesFM removed on 2026-10-29 at the user's request (too big for Render's free plan, never scored): model, offline
script, decile intervals and the studio's TimesFM card are gone; the Ensemble now has the hero card.
Not verified in the cloud: a real USDA refresh (no
`MARS_API_KEY` there), the live Supabase store from the app (no `SUPABASE_DB_URL` there), the Docker image build.

## Coordinator checklist (remaining)
- [x] Collect the four agents' reports; resolve "Requests for other workstreams" in their notes.
- [x] Integration: `cd backend && .venv/bin/python -m pytest -q`; `cd smartstock-nextjs && npx tsc --noEmit && npm run lint && npm run build`.
- [x] Run locally (`./start.sh`), click through every section in the browser at desktop + 375px, test preview → apply.
- [x] Lighthouse audit on the production build, scores recorded in the README.
- [x] Rewrite `README.md`: what it is, the prediction model section (link `docs/ml/MODEL_GUIDE.md`), pipeline diagram,
      Supabase setup, configuration table (new env vars), perf checklist outcome, run/test/deploy.
- [x] Seed Supabase once `SUPABASE_DB_URL` exists; verify row counts with the Supabase MCP; run `get_advisors`.
- [ ] First real refresh into Supabase (2025-07-25 -> today) with `MARS_API_KEY` + `SUPABASE_DB_URL` set: `POST /api/pipeline/refresh`.
- [ ] Add `SUPABASE_DB_URL` (session pooler) to the Render service before merging to `main` (merging deploys).
- [ ] Decide on the Supabase advisor WARN about `public.rls_auto_enable()` (see above).
- [ ] Open the pull request to `main` when the user asks.

## Move to Vercel + train once, read everywhere (2026-10-30, desktop session)
The user asked to leave Render (slow wake-ups) for Vercel and to make predictions faster. Done on branch
`feat/vercel-read-only-forecasts` (uncommitted when this was written):
- **Vercel**: `vercel.json` (static export from the CDN, `api/index.py` Python 3.12 function in `pdx1`, `/api/(.*)`
  rewrite, weekly cron `/api/pipeline/cron` Saturdays 15:00 UTC, immutable `_next/static`), `api/requirements.txt`
  (backend pins minus uvicorn, plus scipy 1.17.1; `tests/test_deploy.py` keeps them equal), `.python-version` 3.12,
  `.vercelignore`. `render.yaml` removed; ADR-007 supersedes ADR-001. Pins bumped for 3.12 wheels: numpy 1.26.4,
  pandas 2.2.3, scikit-learn 1.5.2. All tests pass on 3.9 (local venv) and on 3.12 with Vercel's resolved versions.
- **Serverless behaviour** (`VERCEL=1`): no startup training/seeding/CSV refresh; lazy init if ASGI startup is
  skipped; `POST /pipeline/refresh` and `GET /pipeline/cron` (guarded by `CRON_SECRET`) run the pipeline inside the
  request (`pipeline.run_now`, ~70 s measured for a 15-month extract + 11 vegetables x 6 models); status on other
  instances reads the `ingest_runs` row (rows older than 15 min = abandoned); SQLite fallback path is `/tmp`.
- **Train once, read everywhere**: the dashboard's history is the store's rows for `SERIES_REGION` (fixes averaging
  all USDA regions together after the API refresh), and every daily forecast adopts the pipeline's stored champion,
  or the forecast the chef **applied** in the studio (its points and pace, then its model's path). One query reads
  every vegetable's runs (no N+1). Cold start measured: first answer 1.7 s, walk-in list 920 ms -> 3 ms,
  leaderboard 24 s -> 2 ms; first 7-day call still ~1 s for the Open-Meteo weather fetch (cached 30 min).
- Live Supabase already holds the first real refresh (run 3: 20,493 rows, Jul 2025 -> Oct 23 2026, 132 training runs).
  The password in the desktop's `backend/.env` is stale (it was reset for Render); local runs use a local store.

### Status 2026-10-30
- Committed and pushed `feat/vercel-read-only-forecasts` (ff76216, 97b61a8). PR text: [`PR-vercel.md`](PR-vercel.md);
  open it at https://github.com/atanwar8/Smart-Stock-AI/pull/new/feat/vercel-read-only-forecasts (no `gh` here).
- Preview deployment `dpl_9AcHL6RBv2m1r7K9UxfCgELJm8nL` (https://smartstock-rk5893ump-aryan-tanwar.vercel.app,
  behind Vercel login): READY, Python 3.12 function in pdx1, 340 MB bundle, `/api/health` 200, dashboard served.
  It runs in CSV fallback mode because the project has **no** `SUPABASE_DB_URL` / `MARS_API_KEY` / `CRON_SECRET`
  yet (only `PORT`). The connector reaches the team without `teamId` (passing the team id returns 403).

### Remaining (in order)
1. Done: Vercel team access approved (team `aryan-tanwar`), project `smartstock-ai` (`prj_pvZWmhwX15UAKN6szkeLhQrVvht7`).
2. User adds Vercel env vars (Production + Preview): `SUPABASE_DB_URL` (same value as Render's), `MARS_API_KEY`,
   `CRON_SECRET` (any long random string). Never paste them in chat.
3. Commit this branch, push, open a PR; check the preview deployment (Overview, Studio sample -> Apply, Data
   refresh), then merge to `main` for production. Confirm the project's Git connection and that the build uses
   `vercel.json` (framework none, output `smartstock-nextjs/out`).
4. Update the README's first lines with the production URL; suspend/delete the Render service.
5. Follow-up: persist inventory and alert settings in Supabase (on Vercel they are per instance and reset on a cold
   start). Optional: `backend/.venv-ml` (1.2 GB, old TimesFM env) can be deleted.

## 2026-10-30: refresh on click only, faster and corrected training (session folder ~/Documents/GitHub/Smart-Stock-AI)
- The user's rule: data is pulled **only when someone clicks Data refresh** (newest stored week -> today, added to
  Supabase, then train and test). The weekly Vercel cron and `/pipeline/cron` were removed (`CRON_SECRET` unused).
- Production on Vercel uses Supabase's transaction pooler (6543) automatically: the session pooler's 15-client limit
  was exhausted (EMAXCONNSESSION) by function instances plus Render.
- Math audit (`tests/test_math.py`): weekly series are conventional rows only (organic rows came and went and moved
  the price up to +137% in a week); gap weeks repeat the last price (linear interpolation leaked the next week into
  9.2% of backtest origins); champions are chosen on validation MASE, not on the hold-out; the dashboard's 7-day
  range uses the stored conformal widths. STORE_VERSION 3, so a refresh is needed after deploying.
- Speed: newest 52 backtest origins (was 78) and LightGBM refit every 8 weeks (was 4): train + test 47 s -> 15 s on
  a laptop (Vercel measured 74 s before). Results: ETS/Theta/LightGBM mean MASE ~0.77 vs naive 1.03, coverage 0.87.
