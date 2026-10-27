# ADR-004: Refresh USDA data every time the server starts

## Status
Accepted

## Date
2026-10-27

## Context
Data refresh (ADR-003) appends new USDA weeks to `Example_Train.csv` on the server's disk. On Render that disk is temporary: every redeploy, crash or wake from the free plan's 15-minute sleep starts a fresh container that only has the CSV from the repo (ending Jul 25, 2025). The first real refresh added 16,535 rows through Oct 23, 2026; the next restart would have discarded them.

## Decision
When `MARS_API_KEY` is set (and `REFRESH_ON_STARTUP` isn't `0`), the server pulls every week published since the bundled CSV as a background task at startup, then trains all models on the result. It holds the same lock as the Data refresh button, and `/health` reports `data_refresh_running` so the dashboard can show it. Without a key, startup trains on the bundled data as before.

## Alternatives Considered

### Weekly GitHub Action that commits the updated CSV
- Pros: data is permanent and versioned; restarts start from current data with no USDA calls.
- Cons: bot commits to the repo every week; the key lives in GitHub secrets as well as Render.
- Not chosen by the project owner for now; still the better long-term option if restarts become frequent.

### Render persistent disk
- Rejected: requires a paid instance.

## Consequences
- Every start makes roughly 30 requests to USDA (about a minute) and the gap grows each week until the repo's CSV is updated.
- For that first minute, charts show data up to the bundled CSV, then forecasts use the fresh weeks.
- If USDA is down at startup, the server still starts and trains on the bundled data; the error is in the logs and Data refresh can be retried.
