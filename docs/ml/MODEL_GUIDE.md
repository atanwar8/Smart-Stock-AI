# Forecast Studio model guide

What each model in Forecast Studio is, how it is scored, how it did on SmartStock's data, and what to pick.
Code: `backend/ml/` (models, backtest, intervals), `backend/ml/service.py` (studio answers), `backend/ml/pipeline.py` (refresh).

## The data the models see

- **Source:** USDA MyMarketNews National Retail Report, Specialty Crops (report 3324), stored in the training
  store (`usda_prices`: Supabase Postgres in production, SQLite locally). The store started from the last two years
  of the bundled export (2023-07-28 to 2025-07-25, 6,783 rows), and every refresh appends the weeks published since.
- **Series:** one weekly price per vegetable, from the Midwest region, **conventional rows only**, in that vegetable's
  most common unit (per lb, each, per bunch), averaging the varieties and pack sizes reported that week
  (`ml/series.py`). Organic rows are left out because USDA reports them only some weeks (3–28% of weeks): mixing
  them in moved the weekly price by 1–11% on average and up to +137% in one week, so models were partly learning
  whether organic rows happened to be reported. Missing weeks repeat the last reported price, so a forecast started
  on a gap week never sees a later week (linear interpolation would leak the next price into it). Gap weeks are
  never scored. The dashboard's daily charts read the same series (`core/forecaster_utils.weekly_prices`).
- **Vegetables:** the 11 tracked ones in `usda_commodity.csv` (Asparagus, Broccoli, Cabbage, Carrots, Cauliflower,
  Cucumbers, Lettuce, Onions (Green), Peppers (Bell Type), Sweet Potatoes, Tomatoes).

## How every model is scored (`ml/backtest.py`)

Rolling-origin evaluation, the standard for time series:

1. **Hold-out:** the newest 8 weeks (`TEST_WEEKS`). Nothing about them is used to fit, tune, weight or calibrate.
2. **Origins:** at each of the newest 52 weeks before the hold-out ends (needing a year of history before the first),
   the model is refit on the weeks up to that origin only (expanding window; the global LightGBM is refit every 8
   weeks, each fit seeing only weeks on or before its date) and forecasts 8 weeks ahead (`MAX_HORIZON`, the studio's limit). Tests check that no forecast can see a later week
   (`tests/test_ml_models.py`).
3. **Metrics** on the hold-out forecasts (h ≤ 8):
   - **MAE**: average miss in dollars per unit.
   - **MAPE**: the same as a percentage of the price.
   - **MASE**: MAE ÷ the in-sample MAE of "same as last week". Below 1 beats the naive rule's training-period error.
   - **Skill**: 1 − MAE_model / MAE_seasonal-naive on the same weeks. Positive means better than "same week last year".
   - **Coverage**: the share of real prices inside the stated range (80% by default).
4. **Champion:** the lowest **validation** MASE for that vegetable (forecasts on the weeks before the hold-out).
   Choosing the best of six on the hold-out itself would make the champion's reported hold-out score look better
   than it is; choosing on validation keeps the hold-out an honest estimate. The dashboard's daily forecasts use the
   champion, or the forecast applied in the studio.

## The models

| Id | Model | Idea in one line | Math (x = log price) |
| --- | --- | --- | --- |
| `naive` | Same as last week | The bar every model has to clear (scored, not offered in the studio) | x̂(T+h) = x(T) |
| `seasonal_naive` | Same week last year | The skill-score baseline | x̂(T+h) = x(T+h−52k) |
| `ets` | Damped-trend exponential smoothing, ETS(A,Ad,N) | Smooths promo noise; any trend fades instead of running away | level and trend updated by α, β; x̂(T+h) = ℓ(T) + (φ+…+φʰ)·b(T) |
| `theta` | Theta method (M3 winner) | Smoothed level plus half the long-run drift | x̂(T+h) = SES(T) + ½·b₀·(h − 1 + 1/α − (1−α)ᵀ/α) |
| `lightgbm` | Global, direct gradient-boosted trees | One model learns from all 11 vegetables at once; the horizon is a feature, so errors don't compound | target z = x(t+h) − mean(x(t−3..t)); features: lags, rolling means, volatility, momentum, week-of-year, last year's level, commodity, h; L1 loss |
| `ensemble` | Inverse-MASE weighted blend | Averages the three best candidates on pre-hold-out weeks | ŷ = Σ wᵢ·ŷᵢ, wᵢ ∝ 1/MASEᵢ (validation weeks only) |

**Why these.** Two years of weekly prices is ~100 points per vegetable: too little for per-item deep learning, but
enough for exponential smoothing (ETS, Theta), and enough for a tree model when the vegetables are pooled
(the M5 competition's lesson).
The two naive rules are there so every claim of skill has an honest reference.

**Ranges.** Every model uses split-conformal intervals (`ml/intervals.py`):
the 80% range at horizon h is the forecast × exp(±q), where q is the 80th percentile of that model's past absolute
log errors at the same h. In logs, the range scales with the price.

**Trained in the backend.** The pipeline does all fitting and testing (after every refresh: the Data refresh button
only when someone clicks it; locally also at startup when no current results exist): about 70 s for a refresh that
fetched 15 months of USDA weeks and scored 11 vegetables × 6 models on a laptop, well inside Vercel's 300 s limit.
It stores each model's scores, calibration and 8-week forecast. The studio only reads them, so a sample costs
milliseconds; there is no per-click training and no history-window option (models always use every stored week).

**Pace slider.** A what-if, not a model: the path and its range drift linearly to (1 + pace/100) × by the last week.

## Measured results (pipeline run of 30 Oct 2026, 8-week horizon; data 2023-07-28 to 2026-10-23)

Hold-out = each vegetable's newest 8 weeks (2026-09-04 to 2026-10-23); trained on 2023-07-28 to 2026-08-28.
Lower MASE is better; skill is against "same week last year"; bold = lowest hold-out MASE for that vegetable.
A full train-and-test of 6 models on 11 vegetables takes about 15 s on a laptop (it was 47 s before the
backtest window and LightGBM refit schedule were tightened, see "How every model is scored").

| Model | Mean MASE | Median MASE | Mean MAPE | Mean skill | Mean 80% coverage | Champion for |
| --- | --- | --- | --- | --- | --- | --- |
| ETS | 0.770 | 0.703 | 13.9% | +25.4% | 0.87 | 0 |
| Theta | 0.771 | 0.691 | 14.0% | +26.0% | 0.87 | 3 |
| LightGBM | 0.780 | 0.689 | 13.7% | +26.3% | 0.89 | 1 |
| Ensemble | 0.821 | 0.783 | 14.6% | +23.2% | 0.86 | 7 |
| Naive (last week) | 1.031 | 0.964 | 18.3% | -2.5% | 0.89 | 0 |
| Seasonal naive | 1.060 | 0.932 | 18.5% | +0.0% | 0.84 | 0 |

| Vegetable | Ensemble | LightGBM | ETS | Theta | Seasonal naive | Naive (last week) | Champion (validation) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Asparagus | 0.977 | 1.055 | **0.657** | 0.664 | 1.301 | 1.092 | Ensemble |
| Broccoli | 0.694 | **0.689** | 0.703 | 0.691 | 0.782 | 0.912 | Theta |
| Cabbage | 1.153 | **0.973** | 1.015 | 1.021 | 1.618 | 1.225 | Ensemble |
| Carrots | 0.688 | 0.673 | **0.593** | 0.630 | 0.932 | 0.964 | Ensemble |
| Cauliflower | 0.370 | 0.386 | 0.445 | **0.359** | 0.395 | 0.772 | Theta |
| Cucumbers | 0.790 | **0.698** | 0.848 | 0.861 | 1.099 | 1.208 | Ensemble |
| Lettuce | 1.241 | 1.184 | 1.073 | **1.064** | 1.450 | 1.287 | Ensemble |
| Onions, Green | 1.565 | 1.556 | 1.450 | **1.443** | 1.722 | 2.048 | LightGBM |
| Peppers (Bell Type) | 0.317 | 0.396 | **0.264** | 0.326 | 0.610 | 0.498 | Theta |
| Sweet Potatoes | **0.452** | 0.452 | 0.561 | 0.565 | 0.898 | 0.667 | Ensemble |
| Tomatoes | 0.783 | **0.519** | 0.855 | 0.857 | 0.853 | 0.668 | Ensemble |

### What the numbers say

- **Every real model beats both baselines on clean prices**: mean MASE 0.77–0.82 against 1.03 for "same as last
  week", and about +25% skill over "same week last year". Before organic rows were taken out, naive won 5 of 11
  vegetables: much of the apparent randomness was the organic mix, not the market.
- **ETS, Theta and LightGBM are within 1% of each other on average**; which one wins depends on the vegetable.
  The ensemble is chosen most often on validation because it is the most stable, and costs about 0.05 MASE on the
  hold-out against the best single model.
- **The 8-week hold-out is small** (about 36 scored forecasts per vegetable), so one vegetable's ranking can flip with
  a few more weeks of data. Read the per-vegetable champions as indicative.
- **Ranges are honest overall**: 84–89% of real prices fell inside the "80%" ranges (mean 0.87, slightly cautious).
  Green onions and cabbage were under-covered in these 8 weeks, which were more volatile than their past.

### Recommendation

- For ordering, use the vegetable's **champion** from the leaderboard (the studio shows it, and the dashboard
  already uses it unless a forecast was applied in the studio). The studio's default is the ensemble (SPEC §5); switching the default to the
  per-vegetable champion is a one-line change in `ml/service.py` (`DEFAULT_MODEL`) once the team agrees.
- Re-run the pipeline after each USDA refresh: the expanding window and the moving hold-out make the scores more
  reliable as weeks accumulate.
- Worth trying next: promotion features (USDA's ad counts are already stored: `current_ad_count`), a wider conformal
  window that weights recent errors more.

## Why there is no foundation model

Google's TimesFM 2.5 was planned as a seventh model. It was removed on 29 Oct 2026: it needs about 1 GB of RAM and
PyTorch, more than the free Render instance (512 MB) can hold, so it could only ever have run offline on another
machine, and it was never scored on this data. Adding a foundation model later means a new class in `ml/models/`
registered in `ml/models/__init__.py`; the backtest, leaderboard and studio pick it up from the registry.

## Model card

| | |
| --- | --- |
| Intended use | Weekly retail price outlook (next week by default, up to 8 weeks) for menu costing and order timing in a restaurant kitchen |
| Not for | Wholesale or futures pricing, regions other than the modelled one, single-day decisions |
| Training data | USDA report 3324, Midwest, 11 vegetables, weekly; expanding window from 2023-07-28 |
| Evaluation | Rolling origin, newest 8 weeks held out, MASE/MAE/MAPE/skill/coverage (above) |
| Known weaknesses | Promotions are unforecastable spikes; short history; organic prices are not modelled |
| Refresh | Only when someone clicks Data refresh: `POST /pipeline/refresh` appends the USDA weeks since the newest stored one and retrains and rescores every model (about 15 s of training) |
