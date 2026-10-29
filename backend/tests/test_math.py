"""The forecasting math the leaderboard and every page rely on: series construction, champion choice, metrics."""

import numpy as np
import pandas as pd
import pytest

from core import forecaster_utils
from ml import intervals, metrics
from ml.backtest import ModelEval, champion
from ml.series import weekly_series

FRIDAYS = pd.date_range("2024-01-05", periods=40, freq="7D")


def rows(prices, organic=None, drop=()):
    """One conventional row per Friday (and optional organic rows), with some weeks not reported."""
    out = [{"report_date": d, "commodity": "Tomatoes", "unit": "per lb", "organic": "No", "price": p}
           for i, (d, p) in enumerate(zip(FRIDAYS, prices)) if i not in drop]
    for i, p in (organic or {}).items():
        out.append({"report_date": FRIDAYS[i], "commodity": "Tomatoes", "unit": "per lb", "organic": "Yes", "price": p})
    return pd.DataFrame(out)


def test_a_missing_week_repeats_the_last_price_and_never_looks_ahead():
    prices = np.linspace(1.0, 4.9, 40)
    series = weekly_series(rows(prices, drop={10}), "Tomatoes")
    # Week 10 was not reported: it carries week 9's price, not a value interpolated towards week 11
    assert series.y.iloc[10] == pytest.approx(prices[9])
    assert not series.observed[10] and series.observed[9] and series.observed[11]


def test_organic_rows_never_move_the_weekly_price():
    prices = np.full(40, 2.0)
    with_organic = weekly_series(rows(prices, organic={5: 6.0, 6: 6.0}), "Tomatoes")
    # USDA reported organic tomatoes in weeks 5-6 only; the conventional series must stay flat at $2.00
    assert np.allclose(with_organic.y.to_numpy(), 2.0)


def test_the_dashboard_reads_the_same_conventional_series_as_the_pipeline():
    frame = rows(np.full(40, 2.0), organic={5: 6.0}).rename(columns={"price": "current_wtd_avg_price"})
    legacy = forecaster_utils.weekly_prices(frame, "Tomatoes")
    assert np.allclose(legacy.to_numpy(), 2.0)


def evaluation(model, val_mase, test_mase):
    ev = ModelEval(model=model, commodity="Tomatoes", unit="per lb", plan=None, dates=FRIDAYS, points=np.zeros((1, 1)))
    ev.val_mase, ev.metrics = val_mase, {"mase": test_mase, "mae": test_mase}
    return ev


def test_the_champion_is_chosen_on_validation_weeks_not_on_the_hold_out():
    # theta looks best on the 8 hold-out weeks, but ets was better on the ~40 validation weeks before them:
    # picking on the hold-out would report a score biased by the choice itself
    evals = {"ets": evaluation("ets", val_mase=0.80, test_mase=0.95),
             "theta": evaluation("theta", val_mase=0.90, test_mase=0.70)}
    assert champion(evals) == "ets"


def test_mase_uses_the_in_sample_naive_error_and_skips_gap_weeks():
    train = np.array([1.0, 1.2, 1.1, 5.0, 1.3])
    observed = np.array([True, True, True, False, True])
    # Pairs touching the unreported week 3 are skipped: |1.2-1.0|, |1.1-1.2| -> mean 0.15
    assert metrics.mase_scale(train, observed) == pytest.approx(0.15)
    assert metrics.mase([1.0, 2.0], [1.15, 1.85], 0.15) == pytest.approx(1.0)
    assert metrics.skill(0.1, 0.2) == pytest.approx(0.5)


def test_conformal_width_is_the_finite_sample_quantile():
    errors = [np.arange(1, 20) / 100.0]          # 19 absolute log errors: 0.01 .. 0.19
    table = intervals.conformal_table(errors, horizon=1)
    level = list(intervals.LEVELS).index(0.8)
    # ceil((19 + 1) * 0.8) = 16th smallest error
    assert table[level, 0] == pytest.approx(0.16)
    assert intervals.conformal_level(0.16, table[:, 0]) == pytest.approx(0.8)


def test_pace_drifts_linearly_to_the_chosen_percentage():
    assert intervals.scenario(np.array([2.0, 2.0, 2.0, 2.0]), 20).tolist() == pytest.approx([2.1, 2.2, 2.3, 2.4])
