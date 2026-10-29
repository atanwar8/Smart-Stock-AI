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
   origin only (expanding window) and forecasts 8 weeks ahead (`MAX_HORIZON`, the studio's limit). Tests check that no forecast can see a later week
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

**Why these.** Two years of weekly prices is ~100 points per vegetable: too little for per-item deep learning, but
enough for exponential smoothing (ETS, Theta), and enough for a tree model when the vegetables are pooled
(the M5 competition's lesson).
The two naive rules are there so every claim of skill has an honest reference.

**Ranges.** Every model uses split-conformal intervals (`ml/intervals.py`):
the 80% range at horizon h is the forecast × exp(±q), where q is the 80th percentile of that model's past absolute
log errors at the same h. In logs, the range scales with the price.

**Trained in the backend.** The pipeline does all fitting and testing (at startup when no current results exist, and
after every refresh): about 25 CPU-seconds for 11 vegetables × 6 models, roughly 3 minutes on Render's 0.15 CPU.
It stores each model's scores, calibration and 8-week forecast. The studio only reads them, so a sample costs
milliseconds; there is no per-click training and no history-window option (models always use every stored week).

**Pace slider.** A what-if, not a model: the path and its range drift linearly to (1 + pace/100) × by the last week.

## Measured results (pipeline run of 29 Oct 2026, 8-week horizon; data 2023-07-28 to 2025-07-25)

Hold-out = each vegetable's newest 8 weeks. Lower MASE is better; skill is against "same week last year".

| Model | Mean MASE | Median MASE | Mean MAPE | Mean skill | Mean 80% coverage | Vegetables won |
| --- | --- | --- | --- | --- | --- | --- |
| LightGBM | **1.242** | 1.207 | **17.6%** | **+4.4%** | 0.68 | 1 |
| Naive (last week) | 1.251 | 1.074 | 18.0% | −2.9% | 0.82 | 5 |
| Ensemble | 1.295 | 1.234 | 18.1% | +0.5% | 0.67 | 0 |
| Theta | 1.358 | 1.290 | 18.8% | −6.6% | 0.65 | 0 |
| ETS | 1.405 | 1.319 | 19.4% | −9.5% | 0.61 | 3 |
| Seasonal naive | 1.409 | 1.078 | 20.9% | 0 | 0.69 | 2 |

| Vegetable | Ensemble | LightGBM | ETS | Theta | Seasonal naive | Naive | Champion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Asparagus | 1.234 | 1.334 | 1.785 | 1.788 | **0.885** | 1.797 | seasonal naive |
| Broccoli | 1.036 | **0.855** | 1.144 | 1.126 | 0.915 | 1.109 | LightGBM |
| Cabbage | 1.220 | 1.222 | **1.212** | 1.289 | 2.297 | 1.762 | ETS |
| Carrots | 1.398 | 0.973 | 1.693 | 1.471 | 1.337 | **0.548** | naive |
| Cauliflower | 1.288 | 1.274 | 1.324 | 1.307 | **0.795** | 1.707 | seasonal naive |
| Cucumbers | 2.251 | 2.266 | 2.247 | 2.249 | 2.553 | **2.222** | naive |
| Lettuce | 1.268 | 1.207 | 1.319 | 1.290 | 1.276 | **1.074** | naive |
| Onions (Green) | 0.871 | 0.876 | 0.884 | 0.852 | 0.892 | **0.779** | naive |
| Peppers (Bell Type) | 0.884 | 0.936 | **0.853** | 0.891 | 1.078 | 0.871 | ETS |
| Sweet Potatoes | 2.099 | 2.010 | 2.309 | 1.984 | 2.488 | **0.908** | naive |
| Tomatoes | 0.696 | 0.712 | **0.688** | 0.688 | 0.988 | 0.983 | ETS |

### What the numbers say

- **Weekly retail prices are close to a random walk.** Every model's mean MASE is above 1, and "same as last week"
  wins 5 of 11 vegetables. Promotions move a price 20–30% for a single week and then reverse; no model here sees
  promotions coming.
- **LightGBM is the best single model on average**, slightly ahead of naive on mean MASE and MAPE, and the only model
  with clearly positive average skill. (Training it on 1–8 weeks ahead instead of 1–26 made it slightly more accurate.) Pooling all vegetables is what makes it competitive.
- **The 8-week hold-out is small** (about 36 scored forecasts per vegetable), so one vegetable's ranking can flip with
  a few more weeks of data. Read the per-vegetable champions as indicative.
- **Ranges are too narrow on recent weeks**: 61–69% of real prices fell inside the "80%" ranges (naive: 82%). The most
  recent weeks were more volatile than the calibration period. Treat the range as a lower bound on uncertainty.

### Recommendation

- For ordering, use the vegetable's **champion** from the leaderboard (the studio shows it), and prefer
  **LightGBM** when no model clearly leads. The studio's default is the ensemble (SPEC §5); switching the default to the
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
| Known weaknesses | Promotions are unforecastable spikes; intervals under-cover recent weeks; short history |
| Refresh | `POST /pipeline/refresh` appends new USDA weeks and rescores every model |
