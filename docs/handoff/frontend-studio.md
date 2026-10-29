# frontend-studio handoff

Owner files: `smartstock-nextjs/src/components/studio/**`, `src/components/PredictionsTab.tsx`, `src/lib/studio.ts`.
No imports from `ui.tsx` or `Chart.tsx`; only SPEC §3 token utilities, `ProduceIcon`, `lib/api`, `CommodityContext`, `lucide-react`.

## Done
- `src/lib/studio.ts`: typed client for SPEC §5 (`fetchModels`, `fetchLeaderboard`, `fetchActive`, `previewForecast`,
  `applyForecast`), knob bounds/defaults, `errorStatus()` (parses getJSON's "404: detail"), and `LatestOnly`
  (aborts the in-flight preview when a new one starts and drops superseded results, so no out-of-order samples).
  With `NEXT_PUBLIC_STUDIO_MOCK=1` every call is answered by `studio/mock.ts` via a single inlined dynamic import
  (dropped from production builds).
- `studio/mock.ts`: deterministic synthetic store (105 weekly report dates 2023-07-28 → 2025-07-25), 6 live models +
  1 unavailable (Prophet) to show the disabled state, realistic latencies, abort-aware, apply with
  404/409 semantics, Tomatoes has a seeded "applied yesterday" forecast.
- Components in `studio/`: `useStudio` (all state; 350 ms debounce; compare lines; apply flow; toast), `Slider`
  (custom role=slider: arrows, PageUp/Down, Home/End, pointer drag, ticks, center "as forecast" mark),
  `ProduceSwitcher` (radiogroup of ProduceIcon bubbles, roving tabindex), `ModelPicker` (hero card = the server's default model, the
  page's one night card; skill + rank from leaderboard; Live / Stored · computed offline / Unavailable + reason),
  `Knobs` (horizon 1–26 w/ 4/8/13/26 ticks, confidence 50–95, history 1/2/3/5/All snaps, pace −40…+60), `ChartCard`
  + lazily loaded `ForecastChart` (hand-made SVG, monotone curves, hold-out dots vs predicted ticks, cone, today
  divider, applied reference line, compare lines, hover + arrow-key tooltip, sample → applied animation),
  `PredictingLoader` (timer dial + orbiting produce + cycling captions + elapsed; reduced motion = pulse),
  `AnswerPanel` (serif % answer with ticker, summary, plain-language metrics, train window), `SuggestionBar`
  (sticky Apply/Discard with Enter/Esc), `Leaderboard` (MAE bars, skill, coverage, champion, click to select),
  `Toast` (portal). Shortcuts in `PredictionsTab`: Enter apply, Esc discard, G generate.
- `npx tsc --noEmit` clean for studio files; `eslint` clean on studio files.

## Verified 2026-10-29 against the real backend
- Sample prediction -> Apply in Chromium (Playwright): the applied forecast is returned by `/forecast/active`.
- Fixed: answer headline uses the 4-week average (matches the backend summary); model cards fit at 375 px.

## Re-run the real-backend check
- Previously planned steps:
  `cd backend && SUPABASE_DB_URL= MARS_API_KEY= REFRESH_ON_STARTUP=0 .venv/bin/uvicorn main:app --port 8100`, then
  `BACKEND_URL=http://localhost:8100 npx next dev -p 3200` (no mock flag) and open `/#/predictions`.

## Requests for other workstreams
- none yet

## How to verify
- `cd smartstock-nextjs && npx tsc --noEmit && npx eslint src/components/studio src/components/PredictionsTab.tsx src/lib/studio.ts`
- `NEXT_PUBLIC_STUDIO_MOCK=1 npx next dev -p 3200` then open `http://localhost:3200/#/predictions`
