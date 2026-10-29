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

## In progress
- Alerts page (Atisbo list), Data refresh page (pipeline stepper + runs), Plotly removal, perf checks.

## Not started
- See "In progress".

## Requests for other workstreams
- (none yet)

## How to verify
`cd smartstock-nextjs && npx tsc --noEmit && npm run lint && npm run build`
