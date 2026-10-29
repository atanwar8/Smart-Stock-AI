"""Model registry and backtests: every model forecasts, and no backtest forecast can see a week after its origin."""

import numpy as np
import pandas as pd
import pytest

from ml import intervals
from ml.backtest import evaluate, make_plan
from ml.models import create
from ml.models.gbm import LightGBMGlobal
from ml.series import WeeklySeries

WEEKS = 110


def synthetic(name, seed, level=2.0):
    rng = np.random.default_rng(seed)
    t = np.arange(WEEKS)
    values = level * np.exp(0.15 * np.sin(2 * np.pi * t / 52) + 0.002 * t + rng.normal(0, 0.05, WEEKS))
    index = pd.date_range("2023-07-28", periods=WEEKS, freq="7D")
    return WeeklySeries(name, "per lb", pd.Series(values, index=index), np.ones(WEEKS, bool))


@pytest.fixture(scope="module")
def panel():
    return {name: synthetic(name, i, 1.5 + i) for i, name in enumerate(["Tomatoes", "Lettuce", "Carrots"])}


@pytest.mark.parametrize("model_id", ["naive", "seasonal_naive", "ets", "theta", "lightgbm"])
def test_every_model_forecasts_positive_prices(model_id, panel):
    series = panel["Tomatoes"]
    frame = create(model_id).fit(series.y, panel, "Tomatoes").predict(26)
    assert len(frame) == 26 and (frame["yhat"] > 0).all()
    assert frame.index[0] == series.dates[-1] + pd.Timedelta(days=7)


def perturbed_after(panel, cut):
    """The same panel with every week after `cut` replaced by nonsense."""
    out = {}
    for name, series in panel.items():
        y = series.y.copy()
        y.iloc[cut + 1:] = y.iloc[cut + 1:] * 5 + 10
        out[name] = WeeklySeries(name, series.unit, y, series.observed)
    return out


@pytest.mark.parametrize("model_id", ["ets", "theta", "lightgbm"])
def test_backtest_forecasts_never_see_the_future(model_id, panel):
    origin = 80
    clean, dirty = panel, perturbed_after(panel, origin)
    a, _ = create(model_id).forecast_origins(clean["Tomatoes"].y, [origin], 8, clean, "Tomatoes")
    b, _ = create(model_id).forecast_origins(dirty["Tomatoes"].y, [origin], 8, dirty, "Tomatoes")
    np.testing.assert_allclose(a, b, rtol=1e-9)


def test_shared_lightgbm_matches_a_fresh_one(panel):
    """The studio shares one LightGBM across commodities; its cached boosters must give the same answer."""
    shared = LightGBMGlobal()
    shared.forecast_origins(panel["Lettuce"].y, [70, 80], 8, panel, "Lettuce")
    a, _ = shared.forecast_origins(panel["Tomatoes"].y, [80], 8, panel, "Tomatoes")
    b, _ = LightGBMGlobal().forecast_origins(panel["Tomatoes"].y, [80], 8, panel, "Tomatoes")
    np.testing.assert_allclose(a, b, rtol=1e-9)


def test_hold_out_is_the_newest_weeks_and_ensemble_weights_come_from_before_it(panel):
    series = panel["Tomatoes"]
    plan = make_plan(len(series))
    assert plan.train_end == WEEKS - 1 - 8
    evals = evaluate(series, ["seasonal_naive", "ets", "ensemble"], panel=panel)
    assert evals["seasonal_naive"].metrics["skill"] == pytest.approx(0.0)
    ens = evals["ensemble"]
    assert abs(sum(ens.weights.values()) - 1) < 1e-3 and len(ens.weights) <= 3
    assert ens.test_start == series.dates[plan.train_end + 1].date().isoformat()
    assert len(ens.backtest) == 8


def test_conformal_bands_widen_with_confidence_and_horizon():
    errors = [list(np.abs(np.random.default_rng(h).normal(0, 0.05 * (1 + h / 10), 40))) for h in range(26)]
    table = intervals.conformal_table(errors, 26)
    w80, w95 = intervals.half_width(table, 0.8, 26), intervals.half_width(table, 0.95, 26)
    assert (w95 >= w80).all()
    assert (np.diff(w80) >= 0).all()


def test_pace_scenario_ramps_linearly_to_the_last_week():
    path = intervals.scenario(np.full(4, 2.0), 20)
    np.testing.assert_allclose(path, [2.1, 2.2, 2.3, 2.4])
