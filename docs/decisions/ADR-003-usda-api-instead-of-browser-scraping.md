# ADR-003: Pull USDA prices from the MyMarketNews API instead of browser automation

## Status
Accepted (supersedes the Chromium consequence in ADR-001)

## Date
2026-10-27

## Context
Data refresh ran `automated_scraper.py`: Selenium drove headless Chrome through the "Public Data" form on mymarketnews.ams.usda.gov, then `data_processor.py` cleaned the downloaded table.

On the first cloud run it exited successfully but added no rows, while USDA had published about 65 newer weekly reports (through 2026-10-17). Two causes:

- The form changed. The scraper waits for an element with id `market`, which is now `markets-search`; every later step depends on similar ids and fixed `sleep()` calls.
- The script never exited non-zero, so failures looked like success.

The same report is available from USDA's documented MyMarketNews (MARS) API as report 3324, "Report Details". Its fields map one-to-one onto the training CSV. The API needs a free personal key (HTTP Basic username, empty password).

## Decision
Replace the scraper and its table cleaner with `backend/core/usda_api.py`, called in-process by `POST /scrape-and-train`:

- one request per vegetable per ~26 weeks, splitting any range that returns a full 1,500-row page;
- `report_date` is the report's end date (the Friday), matching the existing data;
- the newest stored week is requested again and re-published rows replace stored ones;
- outcomes are explicit: missing or rejected key, USDA unreachable, already up to date, or rows added (naming any vegetable with no rows).

The key is read from `MARS_API_KEY`. Without it the Data refresh button is disabled and explains how to get one.

## Alternatives Considered

### Patch the Selenium flow
- Pros: no signup.
- Cons: breaks whenever USDA changes the page; needs Chromium in the image and more memory than Render's free plan.
- Rejected by the project owner in favour of the documented API.

### Call the Public Data page's internal endpoints
- Pros: no key.
- Cons: undocumented and blocked for non-browser clients; not an interface USDA offers for programmatic use.
- Rejected.

## Consequences
- The image no longer installs Chromium or Selenium, so it's smaller and refreshes fit the free plan.
- Someone must create a MyMarketNews account once and set `MARS_API_KEY` on the server.
- Field names were taken from the report as USDA serves it today; tests pin the mapping so a future rename fails loudly in CI rather than silently adding nothing.
