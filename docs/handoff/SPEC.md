# SmartStock AI — Redesign + Forecast Studio + Supabase pipeline (shared spec)

Branch: `feat/forecast-studio-redesign` (cut from `main` at 559570a on 2026-10-28).
This file is the contract between the four parallel workstreams. If you are an agent picking this up later,
read §0, then your workstream's section, then `docs/handoff/<workstream>.md` for what is already done.

Repo root (has spaces, always quote it):
`/Users/aryantanwar/Library/Application Support/Claude/scratch-workspaces/19d8e006-de9c-4bf5-bc08-1efcb8ac3a6e/baeef527-227f-4cd0-98e2-c0940e49206f/scratch-2026-10-27-02f09c/Smart-Stock-AI`

## 0. Rules for every workstream

1. **Stay in your files** (§1). Four agents edit this tree at once with no worktrees. Never rewrite, format or
   "tidy" a file you don't own. If you need a change in someone else's file, write it in your handoff note
   under "Requests for other workstreams" and work around it.
2. **No git commits, no pushes, no branch switches.** The coordinator commits at the end.
3. **Keep a running handoff note** at `docs/handoff/<workstream>.md` (frontend-shell, frontend-studio,
   backend-perf, ml-pipeline). Update it after each milestone, not only at the end: Done / In progress /
   Not started (with the exact plan you would follow) / Requests for other workstreams / How to verify.
   If you run out of budget, that note is how the next agent finishes your work.
4. Match the existing code style: short plain-English comments that say *why*, no emoji in new code.
5. Never print, log or commit secrets. Read them from env vars only.
6. Verification commands:
   - Backend: `cd backend && .venv/bin/python -m pytest -q` (Python 3.9 venv; do not delete or recreate `backend/.venv`)
   - Frontend: `cd smartstock-nextjs && npx tsc --noEmit && npm run lint && npm run build`
   - Don't start long-running dev servers on ports 3000/8000 (the coordinator uses them). Use 3100+/8100+ if you must.

## 1. File ownership

| Workstream | Owns (may create/edit) | Must not touch |
| --- | --- | --- |
| **frontend-shell** | everything under `smartstock-nextjs/` **except** the studio files; `smartstock-nextjs/package.json` + lockfile | `src/components/studio/**`, `src/components/PredictionsTab.tsx`, `src/lib/studio.ts` |
| **frontend-studio** | `smartstock-nextjs/src/components/studio/**`, `src/components/PredictionsTab.tsx`, `src/lib/studio.ts` | everything else in `smartstock-nextjs/` (read-only: `globals.css`, `ui.tsx`, `produce/ProduceIcon.tsx`, `lib/api.ts`, `contexts/*`) |
| **backend-perf** | `backend/main.py`, `backend/core/forecaster.py`, `backend/core/forecaster_utils.py`, `backend/core/open_meteo.py`, `backend/tests/test_api.py`, `backend/tests/test_forecaster.py`, `backend/tests/test_weather.py`, new `backend/tests/test_perf.py`, `Dockerfile`, `render.yaml`, `start.sh`, `docker-compose.yml`, `.github/**` | `backend/routers/**`, `backend/ml/**`, `backend/store/**`, `supabase/**` |
| **ml-pipeline** | `backend/routers/**`, `backend/ml/**`, `backend/store/**`, `backend/scripts/**`, `backend/core/usda_api.py`, `backend/tests/test_usda_api.py`, new `backend/tests/test_ml_*.py` / `test_store*.py` / `test_pipeline*.py`, `supabase/**`, `docs/ml/**`, new ADRs `docs/decisions/ADR-006+`, `backend/.env.template`, `backend/requirements*.txt` | `backend/main.py` (except: none — the router is already included), `backend/core/forecaster*.py` |
| coordinator | `README.md`, `docs/handoff/SPEC.md`, `docs/handoff/HANDOFF.md`, final integration | — |

`backend/requirements.txt`: ml-pipeline owns it. backend-perf may add or remove single lines with a targeted
edit (never rewrite the file) and must note it in its handoff.

`backend/main.py` already contains (coordinator-added, keep it):
```python
from routers.forecast import router as forecast_router
app.include_router(forecast_router)
```
All `/forecast/*` and `/pipeline/*` routes live in `backend/routers/forecast.py`. The existing
`StripApiPrefix` middleware makes every route answer at `/x` and `/api/x`; the UI always calls `/api/x`.

## 2. Product + design brief (frontend-shell leads, frontend-studio follows)

The user wants: "very, very Apple-like", "super niche, super lovely, super cool", **unique and personalized**
(today's dashboard "looks like a copy of a dashboard that already exists"). References the user attached:

- **Pelago** (https://demo.codeandchill.store/pelago/#/overview): warm off-white canvas, slim floating icon
  rail, greeting headline + one narrative sentence with bolded facts, one rich dark-green hero card with a
  bar texture, a radial "today by the hour" dial, small round icon buttons, pill segmented controls.
- **Caudal**: dark navy card, luminous Sankey bands, mono uppercase micro-labels, big stat pair in the header.
- **Atisbo**: light card, serif headline, an anomaly *explained in a sentence* ("1.7x more than usual"),
  expected band shaded around the real line, actions "Silence 24h" / "Not relevant", keyboard hints (J/K).
- **Vencimientos**: month calendar with soft tinted *icon bubbles* on the days things happen, weekly load bars,
  Monthly/Annual toggle, a running total with a "Ahorras" savings chip and Undo.
- **Presagio**: forecast with a **cone of uncertainty** (dashed projection + shaded range), a **pace slider**
  under the chart (−40%…+60%), a "Meta a salvo" status pill, big serif number answer ("day 24"), mono labels.

Direction for SmartStock ("a chef's market almanac"):
- Light, airy, Apple-grade polish: porcelain canvas, white cards with hairlines and very soft shadows,
  24px continuous-feel radii, generous whitespace, SF system font for UI, a **serif display face** for big
  numbers and headlines (e.g. Instrument Serif via `next/font/google`), a **mono** face for micro-labels and
  numerics (e.g. Geist Mono / JetBrains Mono). Exactly **one dark "night market" card** per page at most.
- **Produce is shown as symbols, not names** (§4). Names live in tooltips/aria-labels and small captions only
  where a symbol alone would be ambiguous.
- Motion: spring easing (`--ease-spring`), 180–420ms, staggered card entrance, number tickers, symbol idle
  animations. Everything respects `prefers-reduced-motion`.
- Charts are **hand-made SVG** (no Plotly): sparklines, area line, cone of uncertainty, bars, radial dial.
  Plotly (~3.5 MB) must be removed from the bundle (perf checklist: unused dependencies, code splitting).
- Personal touches: greeting by time of day ("Good evening, Chef" — name editable later), one narrative
  sentence that summarizes the kitchen, keyboard shortcuts (1–5 switch sections, J/K move between produce).

## 3. Design tokens (Tailwind v4 `@theme` in `src/app/globals.css`)

Names are a contract; values may be tuned by frontend-shell. Already present and must keep their names:
`canvas, surface, surface-2, well, line, line-2, ink, muted, faint, good, bad, warn, info` (colors),
`--radius-card, --radius-tile, --shadow-card, --shadow-pop, --ease-out-soft`.
Added for the redesign (use these in new code):

| Token | Utility examples | Meaning |
| --- | --- | --- |
| `--color-accent` / `--color-accent-ink` | `bg-accent text-accent-ink` | basil green: actual prices, primary buttons |
| `--color-forecast` / `--color-forecast-soft` | `text-forecast bg-forecast-soft` | iris: anything predicted (lines, cones, chips) |
| `--color-night` / `--color-night-2` / `--color-night-ink` | `bg-night text-night-ink` | the dark hero card |
| `--font-display` | `font-display` | serif display numbers + headlines |
| `--font-mono` | `font-mono` | micro-labels (uppercase, tracking), small numerics |
| `--ease-spring` | `ease-spring` | default motion curve |

Old tokens `primary, brass, side, harvest` may be removed by frontend-shell once nothing uses them.

## 4. Produce symbols (contract)

`smartstock-nextjs/src/components/produce/ProduceIcon.tsx` (frontend-shell owns; a stub exists now):

```ts
export type ProduceKey = 'tomato'|'lettuce'|'carrot'|'broccoli'|'cucumber'|'cauliflower'|'cabbage'|'asparagus'|'sweet-potato'|'green-onion'|'bell-pepper'|'unknown';
export const PRODUCE: Record<ProduceKey, { key: ProduceKey; label: string; tint: string }>;
export function produceKey(commodity: string): ProduceKey;      // maps "Onions, Green", "Onions (Green)", "Peppers (Bell Type)", ...
export const produceMeta: (commodity: string) => ProduceMeta;
export function ProduceIcon(props: { commodity: string; size?: number; animated?: boolean; bubble?: boolean; className?: string; title?: string }): JSX.Element;
export default ProduceIcon;
```

Each symbol is a tiny, simple, hand-drawn **inline SVG** (no emoji, no raster), 24×24 viewBox, 2–4 flat
shapes with one highlight, each with its own idle micro-animation (tomato wobble, green-onion stalks sway,
carrot bob, broccoli florets breathe, pepper tilt, sweet potato roll, lettuce leaf flutter, ...). A hover
"pop" (scale 1.08 with spring). `role="img"` + `aria-label`.

## 5. API contract — Forecast Studio + pipeline (ml-pipeline implements, frontend-studio + frontend-shell consume)

All JSON. Dates are ISO `YYYY-MM-DD` (report week dates). Prices are dollars in the commodity's unit.
Commodity names are the ones `/commodities` returns today (e.g. `Tomatoes`, `Onions, Green`, `Peppers (Bell Type)` / whatever the store holds — keep them consistent with `/commodities`).

### `GET /forecast/models`
```json
{ "default": "ensemble",
  "models": [
    { "id": "ensemble", "name": "Ensemble", "family": "Inverse-MASE weighted combination",
      "available": true, "mode": "live", "reason": null, "speed": "fast",
      "blurb": "Blends the three best models on past weeks, weighted by how accurate each one was." },
    { "id": "lightgbm", "name": "LightGBM", "family": "Gradient-boosted trees", "available": true, "mode": "live", "reason": null, "speed": "fast", "blurb": "..." }
  ] }
```
`mode`: `"live"` (runs in this server) or `"unavailable"` (then `available:false` and `reason` explains).
Every model runs live today; the field stays so a future model can be listed as unavailable.
Model ids: `ensemble`, `lightgbm`, `ets`, `theta`, `seasonal_naive` (more allowed). The UI shows `default` as the
hero card. TimesFM was removed on 2026-10-29 (needs ~1 GB RAM; never scored on this data): `model: "timesfm"` is a 422.

### `GET /forecast/leaderboard?commodity=Tomatoes`
```json
{ "commodity": "Tomatoes", "unit": "per lb",
  "train_start": "2023-07-28", "train_end": "2025-05-30", "test_start": "2025-06-06", "test_end": "2025-07-25",
  "test_weeks": 8, "champion": "ensemble", "updated_at": "2026-10-28T21:04:00Z",
  "rows": [ { "model": "lightgbm", "name": "LightGBM (global)", "mae": 0.12, "rmse": 0.15, "mape": 5.1, "smape": 5.0,
              "mase": 0.82, "coverage": 0.79, "skill": 0.18, "rank": 1 } ] }
```
`skill` = 1 − MAE_model / MAE_seasonal-naive on the same hold-out (positive = better than the baseline).
`coverage` = share of hold-out actuals inside the model's interval at the stated confidence (default 0.8).

### `POST /forecast/preview`
Request:
```json
{ "commodity": "Tomatoes", "model": "lightgbm", "horizon_weeks": 8, "confidence": 0.8,
  "history_years": 2, "pace_pct": 0 }
```
Bounds (since 2026-10-29): `horizon_weeks` 1–8 (default 1), `confidence` 0.5–0.95; `history_years` is no longer
accepted (ignored if sent): models always learn from every stored week and are trained ahead of time by the pipeline,
so a preview only reads stored results (503 with a "being trained" detail while the pipeline is training).
`pace_pct` −40…+60 (scenario: forecast drifts linearly to `(1+pace_pct/100)×` by the last week).
Response (also persisted as a `forecasts` row with `status='preview'`):
```json
{ "preview_id": "uuid", "commodity": "Tomatoes", "unit": "per lb", "model": "lightgbm", "model_name": "LightGBM (global)",
  "mode": "live",
  "params": { "horizon_weeks": 8, "confidence": 0.8, "history_years": 2, "pace_pct": 0 },
  "history":  [ { "date": "2025-01-03", "price": 2.10 } ],
  "backtest": [ { "date": "2025-06-06", "actual": 2.31, "predicted": 2.25, "lo": 2.0, "hi": 2.5 } ],
  "forecast": [ { "date": "2025-08-01", "yhat": 2.20, "lo": 1.90, "hi": 2.50 } ],
  "metrics":  { "mae": 0.12, "mape": 5.1, "mase": 0.82, "coverage": 0.79, "skill": 0.18 },
  "summary": "Tomatoes likely ease about 4% over the next 8 weeks; 80% range $1.90–$2.50 per lb.",
  "train_window": { "start": "2023-07-28", "end": "2025-07-25", "weeks": 104 },
  "elapsed_ms": 1840, "generated_at": "2026-10-28T21:05:00Z" }
```
`history` = the last `max(26, 2×horizon)` real weeks. `backtest` = the hold-out window the metrics come from.

### `POST /forecast/apply` → `{ "preview_id": "uuid" }`
```json
{ "applied": true, "forecast_id": "uuid", "commodity": "Tomatoes", "applied_at": "2026-10-28T21:06:00Z", "superseded": "uuid|null" }
```
404 if the preview is unknown, 409 if it was already superseded.

### `GET /forecast/active` (optional `?commodity=`)
```json
{ "items": [ { "forecast_id": "uuid", "commodity": "Tomatoes", "unit": "per lb", "model": "lightgbm", "model_name": "LightGBM (global)",
               "applied_at": "...", "params": { ... }, "forecast": [ { "date": "...", "yhat": 0, "lo": 0, "hi": 0 } ], "summary": "..." } ] }
```

### `POST /pipeline/refresh` → `202 { "job_id": "uuid", "state": "running" }` (409 if one is running)
### `GET /pipeline/status`
```json
{ "state": "idle|running|succeeded|failed",
  "step": "extract|load|train|test|done", "progress": 0.0, "message": "Fitting LightGBM (global) on Tomatoes (3/11)",
  "store": { "backend": "supabase|local", "rows": 6783, "first_date": "2023-07-28", "last_date": "2025-07-25", "commodities": 11 },
  "last_run": { "id": 3, "started_at": "...", "finished_at": "...", "window_start": "2025-07-25", "window_end": "2026-10-28",
                "rows_fetched": 0, "rows_inserted": 0, "rows_updated": 0, "status": "succeeded", "error": null },
  "usda_api_configured": true }
```
### `GET /pipeline/runs?limit=20&offset=0` → `{ "items": [ingest_run...], "total": 12, "limit": 20, "offset": 0 }`

## 6. Training pipeline semantics (ml-pipeline)

Supabase project **Smart-Stock-AI** (`vzxwqcxckafumughmgpc`, us-west-2). Schema already applied:
`supabase/migrations/20261028000000_training_store.sql` (tables `ingest_runs`, `usda_prices`,
`training_runs`, `forecasts`; RLS on, no policies; backend connects as owner through the pooler).

1. **Seed (once):** the store starts with the **last 2 years** of `Example_Train.csv` (all commodities,
   2023-07-26 → 2025-07-25, ~6.8k rows) as one `ingest_runs` row with `source='seed:csv'`. The coordinator
   seeds the live Supabase project; the code must also seed an **empty** store automatically (local SQLite
   or Supabase) so a fresh environment works.
2. **Refresh = Extract → Load → Train → Test**, always incremental:
   - *Extract:* `last = max(report_date)` in the store. Ask USDA MyMarketNews (`core/usda_api.py`, needs
     `MARS_API_KEY`) only for `[last, today]` (re-request `last` itself so USDA corrections replace rows).
   - *Load:* upsert into `usda_prices` on the natural key; never delete. Record counts on the `ingest_runs` row.
   - *Train:* each tracked commodity's weekly series from **all stored weeks** (expanding window: the 2-year
     seed plus every delta since), so old data never vanishes.
   - *Test:* hold out the newest `TEST_WEEKS` (default 8) and run rolling-origin backtests; write one
     `training_runs` row per (commodity, model) with metrics; mark the champion.
   - No key or no new weeks → the run is recorded as `skipped` with the reason, and training/testing still
     runs on what is stored.
3. **Store abstraction** (`backend/store/`): Postgres when `SUPABASE_DB_URL` is set (SQLAlchemy Core +
   psycopg 3, pooled: `pool_size≈5, max_overflow≈5, pool_pre_ping=True`; if the URL points at Supavisor's
   transaction pooler (port 6543) disable prepared statements). Render has no IPv6, so docs must tell the
   user to use the **pooler** connection string, not `db.<ref>.supabase.co`. Otherwise a local SQLite file
   (`backend/var/smartstock.db`, gitignored) with the same tables. Tests use SQLite in a temp dir.
4. **Models** (`backend/ml/`): a small registry with one interface (`fit(series) -> self`,
   `predict(h, quantiles) -> frame`), at minimum seasonal-naive, ETS (damped), Theta, LightGBM (log-price,
   lag + calendar features, direct or recursive) and an ensemble. Intervals: split-conformal residual
   quantiles from the backtest, per horizon step. Metrics: MAE, RMSE, MAPE, sMAPE, MASE, coverage,
   skill vs seasonal-naive.
5. *(Removed 2026-10-29: TimesFM in production. It needed ~1 GB RAM against Render's 512 MB.)*
6. Deliver `docs/ml/MODEL_GUIDE.md`: the deep model analysis the user asked for (what each model is, the
   math in plain notation, why it suits weekly retail produce prices, measured results table from the real
   backtest on this data, recommendation), plus a model card. The coordinator links it from the README.

## 7. Performance checklist (from the user's screenshots) → owner

| Item | Owner | Expected change |
| --- | --- | --- |
| Cache API responses | backend-perf | `Cache-Control` + `ETag`/304 on read-only GETs; `no-store` on mutations |
| Server-side caching / cache expensive queries | backend-perf (+ml in its router) | TTL caches keyed by data version for weekly series, seasonality, volatility, KPI, predictions; invalidated on refresh |
| Load balancer | backend-perf | `WEB_CONCURRENCY` workers in Docker/Render, stateless-ready notes (state moved to Supabase), documented |
| Index the database | ml-pipeline | done in the migration; verify with `EXPLAIN` notes in docs |
| Database connection pooling | ml-pipeline | SQLAlchemy pool (§6.3) |
| ❌ N+1 database queries | ml-pipeline + backend-perf | one query per page of data; KPI/inventory endpoints don't loop per commodity doing repeated work |
| Paginate large lists | both | `limit/offset` on runs, alerts, history endpoints |
| Compress API payloads | backend-perf | `GZipMiddleware(minimum_size=1000)`; lean JSON |
| add CDN | backend-perf | `Cache-Control: public, max-age=31536000, immutable` for `/_next/static/*`; doc for putting Cloudflare/Vercel in front |
| Compress images | frontend-shell | remove unused `public/*.svg`, inline SVG symbols, no rasters |
| Loading skeletons 💀 | frontend-shell + studio | shimmer skeletons shaped like the real cards |
| Debounce input handlers | frontend-shell + studio | ZIP input, sliders, search |
| Split code into chunks / lazy loading | frontend-shell | `next/dynamic` per section; charts load when visible |
| Minify JS and CSS | frontend-shell | verify production build output (Next does it) |
| Defer non-critical scripts | frontend-shell | fonts `display: swap`, nothing blocking, no 3rd-party scripts |
| ❌ Unnecessary re-renders | frontend-shell + studio | split context, `useMemo`/`useCallback`/`memo`, stable props |
| ❌ Unused dependencies | frontend-shell (npm), backend-perf (pip) | drop Plotly + react-plotly; drop unused Python deps (e.g. xgboost if unused) |
| Lighthouse audit | coordinator | run at the end, record scores in the README |
