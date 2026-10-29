# Forecast Studio model guide

What each model in Forecast Studio is, how it is scored, how it did on SmartStock's data, and what to pick.
Code: `backend/ml/` (models, backtest, intervals), `backend/ml/service.py` (studio answers), `backend/ml/pipeline.py` (refresh).

## The data the models see

- **Source:** USDA MyMarketNews National Retail Report, Specialty Crops (report 3324), stored in the training
  store (`usda_prices`: Supabase Postgres in production, SQLite locally). The store started from the last two years
  of the bundled export (2023-07-28 to 2025-07-25, 6,783 rows), and every refresh appends the weeks published since.
- **Series:** one weekly price per vegetable, from the Midwest region, in that vegetable's most common unit (per lb,
  each, per bunch), averaging the varieties and pack sizes reported that week (`ml/series.py`). Missing weeks are
  interpolated so the models get a regular grid, but they are never scored.
- **Vegetables:** the 11 tracked ones in `usda_commodity.csv` (Asparagus, Broccoli, Cabbage, Carrots, Cauliflower,
  Cucumbers, Lettuce, Onions (Green), Peppers (Bell Type), Sweet Potatoes, Tomatoes).

## How every model is scored (`ml/backtest.py`)

Rolling-origin evaluation, the standard for time series:

1. **Hold-out:** the newest 8 weeks (`TEST_WEEKS`). Nothing about them is used to fit, tune, weight or calibrate.
2. **Origins:** at every week from the first one with a year of history, the model is refit on the weeks up to that
   origin only (expanding window) and forecasts 26 weeks ahead. Tests check that no forecast can see a later week
   (`tests/test_ml_models.py`).
3. **Metrics** on the hold-out forecasts (h ≤ 8):
   - **MAE**: average miss in dollars per unit.
   - **MAPE**: the same as a percentage of the price.
   - **MASE**: MAE ÷ the in-sample MAE of "same as last week". Below 1 beats the naive rule's training-period error.
   - **Skill**: 1 − MAE_model / MAE_seasonal-naive on the same weeks. Positive means better than "same week last year".
   - **Coverage**: the share of real prices inside the stated range (80% by default).
4. **Champion:** the lowest hold-out MASE for that vegetable.

## The models

| Id | Model | Idea in one line | Math (x = log price) |
| --- | --- | --- | --- |
| `naive` | Same as last week | The bar every model has to clear (scored, not offered in the studio) | x̂(T+h) = x(T) |
| `seasonal_naive` | Same week last year | The skill-score baseline | x̂(T+h) = x(T+h−52k) |
| `ets` | Damped-trend exponential smoothing, ETS(A,Ad,N) | Smooths promo noise; any trend fades instead of running away | level and trend updated by α, β; x̂(T+h) = ℓ(T) + (φ+…+φʰ)·b(T) |
| `theta` | Theta method (M3 winner) | Smoothed level plus half the long-run drift | x̂(T+h) = SES(T) + ½·b₀·(h − 1 + 1/α − (1−α)ᵀ/α) |
| `lightgbm` | Global, direct gradient-boosted trees | One model learns from all 11 vegetables at once; the horizon is a feature, so errors don't compound | target z = x(t+h) − mean(x(t−3..t)); features: lags, rolling means, volatility, momentum, week-of-year, last year's level, commodity, h; L1 loss |
| `ensemble` | Inverse-MASE weighted blend | Averages the three best candidates on pre-hold-out weeks | ŷ = Σ wᵢ·ŷᵢ, wᵢ ∝ 1/MASEᵢ (validation weeks only) |
| `timesfm` | Google TimesFM 2.5 (200M) | Foundation model pre-trained on ~100B time points, forecasts zero-shot with its own quantiles | decoder-only transformer over 32-point patches, quantile head q10–q90 |

**Why these.** Two years of weekly prices is ~100 points per vegetable: too little for per-item deep learning, but
enough for exponential smoothing (ETS, Theta), and enough for a tree model when the vegetables are pooled
(the M5 competition's lesson). TimesFM brings prior knowledge from other series, which is what short histories need.
The two naive rules are there so every claim of skill has an honest reference.

**Ranges.** TimesFM uses its own deciles. Every other model uses split-conformal intervals (`ml/intervals.py`):
the 80% range at horizon h is the forecast × exp(±q), where q is the 80th percentile of that model's past absolute
log errors at the same h. In logs, the range scales with the price.

**Pace slider.** A what-if, not a model: the path and its range drift linearly to (1 + pace/100) × by the last week.

## Measured results (stored pipeline run, 28 Oct 2026 data: 2023-07-28 to 2025-07-25)

Hold-out = each vegetable's newest 8 weeks. Lower MASE is better; skill is against "same week last year".

| Model | Mean MASE | Median MASE | Mean MAPE | Mean skill | Mean 80% coverage | Vegetables won |
| --- | --- | --- | --- | --- | --- | --- |
| LightGBM | **1.248** | 1.197 | **17.6%** | **+4.0%** | 0.72 | 3 |
| Naive (last week) | 1.251 | 1.074 | 18.0% | −2.9% | 0.82 | 4 |
| Ensemble | 1.303 | 1.240 | 18.2% | +0.3% | 0.67 | 1 |
| Theta | 1.358 | 1.290 | 18.8% | −6.6% | 0.65 | 0 |
| ETS | 1.405 | 1.319 | 19.4% | −9.5% | 0.61 | 1 |
| Seasonal naive | 1.409 | 1.078 | 20.9% | 0 | 0.69 | 2 |

| Vegetable | Ensemble | LightGBM | ETS | Theta | Seasonal naive | Naive | Champion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Asparagus | 1.246 | 1.368 | 1.785 | 1.788 | **0.885** | 1.797 | seasonal naive |
| Broccoli | 1.048 | **0.892** | 1.144 | 1.126 | 0.915 | 1.109 | LightGBM |
| Cabbage | 1.212 | **1.203** | 1.212 | 1.289 | 2.297 | 1.762 | LightGBM |
| Carrots | 1.353 | 0.866 | 1.693 | 1.471 | 1.337 | **0.548** | naive |
| Cauliflower | 1.294 | 1.287 | 1.324 | 1.307 | **0.795** | 1.707 | seasonal naive |
| Cucumbers | 2.339 | **2.217** | 2.247 | 2.249 | 2.553 | 2.222 | LightGBM |
| Lettuce | 1.240 | 1.197 | 1.319 | 1.290 | 1.276 | **1.074** | naive |
| Onions (Green) | 0.868 | 0.868 | 0.884 | 0.852 | 0.892 | **0.779** | naive |
| Peppers (Bell Type) | 0.896 | 0.972 | **0.853** | 0.891 | 1.078 | 0.871 | ETS |
| Sweet Potatoes | 2.149 | 2.162 | 2.309 | 1.984 | 2.488 | **0.908** | naive |
| Tomatoes | **0.686** | 0.692 | 0.688 | 0.688 | 0.988 | 0.983 | ensemble |

TimesFM is not in these tables: it was not scored in the environment that produced them (see "TimesFM" below).

### What the numbers say

- **Weekly retail prices are close to a random walk.** Every model's mean MASE is above 1, and "same as last week"
  wins 4 of 11 vegetables. Promotions move a price 20–30% for a single week and then reverse; no model here sees
  promotions coming.
- **LightGBM is the best single model on average**, slightly ahead of naive on mean MASE and MAPE, and the only model
  with positive average skill. Pooling all vegetables is what makes it competitive.
- **The 8-week hold-out is small** (about 36 scored forecasts per vegetable), so one vegetable's ranking can flip with
  a few more weeks of data. Read the per-vegetable champions as indicative.
- **Ranges are too narrow on recent weeks**: 61–72% of real prices fell inside the "80%" ranges (naive: 82%). The most
  recent weeks were more volatile than the calibration period. Treat the range as a lower bound on uncertainty.

### Recommendation

- For ordering, use the vegetable's **champion** from the leaderboard (the studio shows it), and prefer
  **LightGBM** when no model clearly leads. The studio's default is the ensemble (SPEC §5); switching the default to the
  per-vegetable champion is a one-line change in `ml/service.py` (`DEFAULT_MODEL`) once the team agrees.
- Re-run the pipeline after each USDA refresh: the expanding window and the moving hold-out make the scores more
  reliable as weeks accumulate.
- Worth trying next: promotion features (USDA's ad counts are already stored: `current_ad_count`), a wider conformal
  window that weights recent errors more, and TimesFM once it can be scored on this data.

## TimesFM

`ml/models/timesfm_model.py` wraps `timesfm.TimesFM_2p5_200M_torch` (weights `google/timesfm-2.5-200m-pytorch`).
It needs Python ≥ 3.10, torch and ~1 GB of RAM, more than Render's free 512 MB instance, so the server offers it in
one of three modes (`GET /forecast/models`):

- **live**: `ENABLE_TIMESFM=1` and the packages import (a larger instance);
- **stored**: someone ran `python -m scripts.offline_timesfm` against the same store, and the server serves those
  backtests and 26-week forecasts;
- **unavailable**: with the reason shown on its card.

Status as of this guide: the previous session reported TimesFM 2.5 loading and forecasting on the developer's Mac
(`backend/.venv-ml`). It has **not** been scored on this data yet: the cloud environment that produced the tables above
cannot reach Hugging Face or the PyTorch package index. To score it, run on a machine that can:

```bash
cd backend
python3.12 -m venv .venv-ml && .venv-ml/bin/pip install -r requirements.txt "timesfm[torch]>=2.0"
SUPABASE_DB_URL=... .venv-ml/bin/python -m scripts.offline_timesfm
```

## Model card

| | |
| --- | --- |
| Intended use | Weekly retail price outlook (1–26 weeks) for menu costing and order timing in a restaurant kitchen |
| Not for | Wholesale or futures pricing, regions other than the modelled one, single-day decisions |
| Training data | USDA report 3324, Midwest, 11 vegetables, weekly; expanding window from 2023-07-28 |
| Evaluation | Rolling origin, newest 8 weeks held out, MASE/MAE/MAPE/skill/coverage (above) |
| Known weaknesses | Promotions are unforecastable spikes; intervals under-cover recent weeks; short history |
| Refresh | `POST /pipeline/refresh` appends new USDA weeks and rescores every model |
