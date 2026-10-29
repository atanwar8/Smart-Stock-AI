# Handoff — redesign + Forecast Studio + Supabase pipeline

Status: **in progress** (last updated by the coordinator, 2026-10-28). Branch `feat/forecast-studio-redesign`, nothing committed yet.
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
   (TimesFM included). Several selectable models (TimesFM, LightGBM, others) after a deep analysis; README explains it.
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

## Coordinator checklist (remaining)
- [ ] Collect the four agents' reports; resolve "Requests for other workstreams" in their notes.
- [ ] Integration: `cd backend && .venv/bin/python -m pytest -q`; `cd smartstock-nextjs && npx tsc --noEmit && npm run lint && npm run build`.
- [ ] Run locally (`./start.sh`), click through every section in the browser at desktop + 375px, test preview → apply.
- [ ] Lighthouse audit (chrome-devtools MCP `lighthouse_audit`) on the production build (`./start.sh prod`), record scores.
- [ ] Rewrite `README.md`: what it is, the prediction model section (link `docs/ml/MODEL_GUIDE.md`), pipeline diagram,
      Supabase setup, configuration table (new env vars), perf checklist outcome, run/test/deploy.
- [x] Seed Supabase once `SUPABASE_DB_URL` exists; verify row counts with the Supabase MCP; run `get_advisors`.
- [ ] Mark this file "complete" or list what is left.
