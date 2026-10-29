# frontend-shell handoff

Owner: frontend-shell agent. Scope: everything in `smartstock-nextjs/` except the studio files
(`src/components/studio/**`, `src/components/PredictionsTab.tsx`, `src/lib/studio.ts`).

## Done
- Design system: `src/app/globals.css` (tokens per SPEC §3, porcelain canvas, basil accent, iris forecast,
  navy night card, shimmer skeletons, stagger entrance, produce idle animations, reduced-motion guard).
  Legacy `primary`/`brass` kept as aliases of accent/forecast; `side`/`harvest` removed.
- Fonts: `src/app/layout.tsx` loads Inter (fallback UI), Instrument Serif (`--font-display`), Geist Mono
  (`--font-mono`), all `display: swap`; UI uses the Apple system stack first. Theme color `#f2f3ef`.
- `src/components/ui.tsx` rebuilt; every old export kept (PageHeader, Card, CardHeader, Segmented, Button,
  Select, Field, Switch, Pill, Delta, Meter, ProduceTile, Skeleton, Empty, WeatherCredit, ErrorNote, money,
  cx, statusTone, statusLabel, Tone). New: NightCard, `Card tone="night"`, Micro, IconButton, Kbd, Stat,
  Ticker, SkeletonCard, Button variants `night`/`forecast` + `size="sm"`, Tone `forecast`.
- Produce symbols: `src/components/produce/ProduceIcon.tsx` — 11 hand-drawn 24x24 SVGs + unknown, each
  with its own idle animation (`animated`), hover pop, `bubble`, optional `decorative`. Contract unchanged;
  extra export `tintAlpha(hex, a)`.
- Chart kit (no Plotly): `src/components/charts/` — AreaLine/Cone (`TimeChart.tsx`: line or luminous bars,
  forecast cone, expected band, hover + arrow-key tooltip), Bars, Sparkline, Dial, LazyMount, useWidth/useInView.
- Shell: `SmartStockDashboard.tsx` (hash routing, `next/dynamic` per section with `ssr:false`, keys 1-5 and
  J/K), `shell/Rail.tsx` (floating icon rail + phone dock, badges), `shell/TopBar.tsx` (date pill, status),
  `shell/ProduceSwitcher.tsx` (symbol bubbles), `shell/PageSkeleton.tsx`. Old Header/Sidebar deleted.
- Context: `CommodityContext` split into state/actions contexts (`useCommodityState`, `useCommodityActions`);
  `useCommodity()` still returns everything. ZIP persisted in localStorage.
- Overview (`DashboardTab.tsx` + `overview/*`): greeting with editable chef name, narrative, 7d/4w period
  pills, night Market pulse, cone card (uses `/forecast/active` when it returns an item), anomaly card,
  days-of-cover dial, what-to-order list, weather, forecast skill strip.
- Smart ordering (`OrderingTab.tsx`, `ordering/OrderCalendar.tsx`, `lib/orderPlan.ts`): month calendar with
  produce bubbles, weekly spend bars, Monthly/Annual, running total, savings chip, skip + Undo; night
  recommendation card; stock form; best-day bars; walk-in list.

- Alerts (`AlertsTab.tsx`): server-paged `/alerts/recent?limit&offset` ("Show N more of total" grows the
  page), each alert as one sentence measured against the chef's rule ("rise 6.2% next week, 3.1x your 2% rule",
  "1.7x more lettuce on hand than will stay fresh"); price alerts show the usual band shaded around the real
  line plus "That's 2.6x more than usual" vs the typical weekly move (`lib/usual.ts`, shared with AnomalyCard);
  Silence 24h / Not relevant / Undo (`lib/alertPrefs.ts`, per device); J/K to move, Enter opens. The rail badge
  asks for `limit=100` so it counts every urgent alert.
- Data refresh (`ScrapeTab.tsx` + `lib/pipeline.ts`): night-card stepper Extract -> Load -> Train -> Test on
  `/pipeline/status` (polled every 1.5 s while running, 30 s otherwise, paused in hidden tabs), progress bar,
  POST `/pipeline/refresh` (409 = follow the running job), store card (rows, first/newest week, coverage bar,
  Supabase/Local pill; falls back to `/health` figures), paginated `/pipeline/runs` history. States: loading
  skeletons, network error with retry, 404 "Pipeline not available on this server", no USDA key (button
  disabled + MARS_API_KEY how-to), skipped run, failed run with its error. `lib/api.ts` now throws `ApiError`
  (same message text as before, plus `.status`).
- Plotly removed: `Chart.tsx` deleted (nothing imported it), `plotly.js-dist-min`, `react-plotly.js`,
  `@types/react-plotly.js` uninstalled (lockfile updated); unused `public/*.svg` deleted (folder removed).
- Lint: unused `urgencyTone` removed from `OrderingTab.tsx`.

## In progress
- (none)

## Not verified
- The pipeline page was checked against mocked responses shaped exactly like SPEC section 5 (no backend was
  running on :8000). Re-check against the real `/pipeline/*` once it is up (`progress` as 0..1 or 0..100 are
  both handled; `ingest_runs.source` / `message` are optional).

## Requests for other workstreams
- (none)

## How to verify
`cd smartstock-nextjs && npx tsc --noEmit && npm run lint && npm run build && npm audit --audit-level=high`
Visual: serve `out/` on port 3100+ and open `#/alerts` and `#/refresh` at 1440 and 375 px.
