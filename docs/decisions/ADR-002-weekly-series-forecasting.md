# ADR-002: Forecast from one weekly price series per commodity, with past-only features

## Status
Accepted (supersedes the original row-level model)

## Date
2026-10-27

## Context
The USDA retail export has one row per week × region × variety × package size. Tomatoes, for example, average about 7 rows per weekly report, in units from "per lb" to "1 pint package".

The original model treated those rows as a time series and built features that included the price being predicted:

- `price_change_1d = pct_change(1)` and the rolling means include the current row's price, so `price = lag_1 × (1 + change_1d)` reconstructs the target. That produced a reported ~95% R².
- "Lag 1" was often another region on the same date, not last week.
- At prediction time each future day was a single row, so every lag and rolling feature became 0. Forecasts were flat or far from the latest price (Lettuce $3.49 → $0.94).

## Decision
- Build one series per commodity: the mean price per weekly report, in that commodity's most common unit (`weekly_prices`).
- Features use only earlier weeks: lags of 1–4, 8, 13 and 52 weeks, 4- and 13-week rolling mean and spread, 4-week change, and week-of-year (`build_features`).
- The model predicts next week's log change. Forecasts are made week by week, feeding each prediction back in, then interpolated to daily values.
- Measure accuracy with time-series cross-validation on price levels, next to a naive "same as last week" baseline. The dashboard shows typical error ($) and the percentage improvement over that baseline instead of R².

## Alternatives Considered

### Keep row-level data and fix only the leaky features
- Rejected: the rows still mix regions and package sizes, so "last week's price" isn't well defined.

### Report R² as "accuracy"
- Rejected: weekly retail prices are mostly noise around a level, so honest R² is near or below zero even for a model that beats the naive guess. It reads as "0% accurate" and hides the useful comparison.

## Consequences
- Accuracy numbers are lower and honest. On the bundled data the model's typical error is lower than the naive guess for most vegetables, by single- to low-double-digit percentages.
- Prices are quoted per commodity unit (`/commodities` returns `units`); the UI shows "/lb", "each", "/bunch" and so on.
- Regression tests in `backend/tests/test_forecaster.py` lock in the no-look-ahead rule and that forecasts start from the latest price.
- Weather is no longer a model feature: it was the same value on every historical row, so it carried no signal. It still drives the plain-language weather impact note.
