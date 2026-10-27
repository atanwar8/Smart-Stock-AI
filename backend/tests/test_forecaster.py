"""Forecast agent: weekly series, no look-ahead features, forecasts that follow recent prices."""

import numpy as np
import pandas as pd

from core import forecaster_utils as fu
from core.forecaster import XGBoostLightGBMForecaster


def usda_rows(prices, commodity="Tomatoes", other_unit=True):
    """Mimic the USDA export: several rows per weekly report (regions, package sizes)."""
    rows = []
    for date, price in zip(pd.date_range("2015-01-02", periods=len(prices), freq="7D"), prices):
        for region in ("National", "Midwest"):
            rows.append({"report_date": date, "commodity": commodity, "unit": "per lb", "region": region, "current_wtd_avg_price": price})
        if other_unit:
            rows.append({"report_date": date, "commodity": commodity, "unit": "1 pint package", "region": "National", "current_wtd_avg_price": price * 5})
    return pd.DataFrame(rows)


def trained_forecaster(prices):
    forecaster = XGBoostLightGBMForecaster()
    forecaster.train_data = usda_rows(prices, other_unit=False)
    result = fu.train_model(forecaster, "Tomatoes")
    assert result["success"], result
    return forecaster, result


def test_weekly_prices_has_one_point_per_week_in_one_unit():
    series = fu.weekly_prices(usda_rows([1.0, 2.0, 3.0]), "Tomatoes")
    assert list(series.round(2)) == [1.0, 2.0, 3.0]
    assert series.index.is_unique


def test_features_never_see_the_price_they_predict():
    series = pd.Series(np.linspace(1, 2, 80), index=pd.date_range("2020-01-03", periods=80, freq="7D"))
    changed = series.copy()
    changed.iloc[-1] = 999.0
    pd.testing.assert_series_equal(fu.build_features(series).iloc[-1], fu.build_features(changed).iloc[-1])


def test_accuracy_is_not_inflated_on_unpredictable_prices():
    # Pure noise has nothing to learn; the old look-ahead features scored R² ≈ 0.95 here
    prices = 2 + np.random.default_rng(0).normal(0, 0.3, 300)
    _, result = trained_forecaster(prices)
    assert result["performance"]["r2"] < 0.3


def test_forecast_continues_from_the_latest_price():
    # A steady climb: only recent prices reveal the current level (calendar features can't)
    prices = np.linspace(1, 4, 300) + np.random.default_rng(1).normal(0, 0.05, 300)
    forecaster, _ = trained_forecaster(prices)

    out = fu.predict_with_model(forecaster, "Tomatoes", 14, None)

    assert len(out["predictions"]) == len(out["dates"]) == 14
    assert abs(out["predictions"][0] - prices[-1]) < 0.1 * prices[-1]
    assert len(set(np.round(out["predictions"], 4))) > 1
    assert all(lo <= p <= hi for lo, p, hi in zip(out["confidence_lower"], out["predictions"], out["confidence_upper"]))
