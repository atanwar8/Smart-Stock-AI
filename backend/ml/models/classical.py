"""Baselines and classical statistical models (fit per commodity, in log price)."""

import warnings
from typing import Dict, Optional

import numpy as np

from ml.config import SEASON
from ml.models.base import Forecaster


class Naive(Forecaster):
    """y_{T+h} = y_T: "same as last week"."""
    id, name, family, speed = "naive", "Naive (last week)", "Baseline", "fast"
    blurb = "Repeats the latest weekly price. The bar every model has to clear."

    def _fit(self, values, panel):
        self.last = values[-1]

    def _predict(self, h):
        return np.full(h, self.last)


class SeasonalNaive(Forecaster):
    """y_{T+h} = y_{T+h-52k}: the same week last year. Falls back to naive with under a year of history."""
    id, name, family, speed = "seasonal_naive", "Seasonal naive", "Baseline", "fast"
    blurb = "Uses the price from the same week last year. The skill score baseline."

    def _fit(self, values, panel):
        self.values = values

    def _predict(self, h):
        n = len(self.values)
        if n < SEASON:
            return np.full(h, self.values[-1])
        steps = np.arange(1, h + 1)
        idx = n - 1 + steps - SEASON * np.ceil(steps / SEASON).astype(int)
        return self.values[idx]


class DampedETS(Forecaster):
    """Holt's linear trend with a damped trend, on log price (ETS(A,Ad,N)).

    level_t = a*x_t + (1-a)(level_{t-1} + phi*b_{t-1});  b_t = beta*(level_t - level_{t-1}) + (1-beta)*phi*b_{t-1}
    forecast_{T+h} = level_T + (phi + phi^2 + ... + phi^h) * b_T,  x = log price; parameters by max likelihood.
    """
    id, name, family, speed = "ets", "ETS (damped trend)", "Exponential smoothing", "fast"
    blurb = "Smooths out weekly promo noise and lets any trend fade instead of running away."

    def _fit(self, values, panel):
        from statsmodels.tsa.holtwinters import ExponentialSmoothing
        logs = np.log(values)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            try:
                self.result = ExponentialSmoothing(logs, trend="add", damped_trend=True,
                                                   initialization_method="estimated").fit(optimized=True)
            except Exception:
                self.result = None
        self.fallback = logs[-4:].mean()

    def _predict(self, h):
        if self.result is None:
            return np.exp(np.full(h, self.fallback))
        path = np.asarray(self.result.forecast(h), float)
        if not np.all(np.isfinite(path)):
            path = np.full(h, self.fallback)
        return np.exp(path)


class Theta(Forecaster):
    """Theta method (Assimakopoulos & Nikolopoulos 2000; Hyndman & Billah 2003): SES plus half the OLS drift.

    forecast_{T+h} = SES_T + (b0 / 2) * (h - 1 + 1/alpha - (1-alpha)^T / alpha), on log price, b0 = slope of a
    straight line fitted to the history. Not deseasonalized: two yearly cycles are too few to estimate 52
    seasonal indices without overfitting.
    """
    id, name, family, speed = "theta", "Theta", "Exponential smoothing", "fast"
    blurb = "Winner of the M3 competition: a smoothed level plus half the long-run drift."

    def _fit(self, values, panel):
        from statsmodels.tsa.forecasting.theta import ThetaModel
        logs = np.log(values)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            try:
                self.result = ThetaModel(logs, deseasonalize=False).fit()
            except Exception:
                self.result = None
        self.fallback = logs[-4:].mean()

    def _predict(self, h):
        if self.result is None:
            return np.exp(np.full(h, self.fallback))
        path = np.asarray(self.result.forecast(h, theta=2), float)
        if not np.all(np.isfinite(path)):
            path = np.full(h, self.fallback)
        return np.exp(path)
