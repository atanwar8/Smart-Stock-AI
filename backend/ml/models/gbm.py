"""LightGBM: one global, direct multi-horizon model across every tracked vegetable.

Why global: one commodity has ~100 weekly points, far too few for a tree ensemble. Pooling 11 commodities
(cross-learning, the lesson of the M5 competition) gives ~20k (origin, horizon) training rows.
Why direct: the horizon h is a feature and the target is the h-step-ahead value itself, so errors don't
compound the way recursive one-step forecasts do.

Target (log price relative to the recent level, so commodities with different price levels share trees):
    z = log y_{t+h} - m4_t,   m4_t = mean(log y_{t-3..t})
Features use weeks <= t only: recent lags and rolling means relative to m4_t, 13-week volatility, 4-week
momentum, the target week's week-of-year (Fourier pair), last year's level around the target week and last
year's change from the origin week to the target week, the commodity (categorical) and h.
Loss: L1 (absolute error), the same loss the leaderboard scores (MAE / MASE), robust to promo spikes.
Forecast: y_hat_{t+h} = exp(m4_t + f(x)).
"""

import os
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from ml.config import MAX_HORIZON
from ml.models.base import Forecaster, future_index

REFIT_EVERY = 4          # backtests refit the global model every 4 weeks (each fit only sees data <= its date)
MIN_ORIGIN = 8           # earliest origin row (needs a 4-week level and a few lags)
FEATURES = ["last", "lag1", "lag2", "lag4", "lag8", "lag13", "lag26", "m13", "m26", "vol13", "mom4",
            "h", "woy_sin", "woy_cos", "ly", "ly_change", "code"]
PARAMS = dict(objective="l1", n_estimators=300, learning_rate=0.03, num_leaves=15, min_child_samples=30,
              subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, random_state=42,
              deterministic=True, force_row_wise=True, verbose=-1)
_ENGINE = None


def engine() -> str:
    """'lightgbm', or 'sklearn-hgb' when LightGBM's native library can't load.

    macOS wheels of LightGBM link against Homebrew's libomp; without it (`brew install libomp`, or
    DYLD_FALLBACK_LIBRARY_PATH pointing at a bundled libomp) the import fails. scikit-learn's
    HistGradientBoostingRegressor is the same algorithm (histogram GBDT, leaf-wise, L1 loss) and ships its
    own libomp, so it stands in. Linux/Docker always gets real LightGBM.
    """
    global _ENGINE
    if _ENGINE is None:
        try:
            import lightgbm  # noqa: F401
            _ENGINE = "lightgbm"
        except Exception:
            _ENGINE = "sklearn-hgb"
    return _ENGINE


def _new_regressor():
    if engine() == "lightgbm":
        import lightgbm as lgb
        return lgb.LGBMRegressor(n_jobs=min(4, os.cpu_count() or 1), **PARAMS)
    from sklearn.ensemble import HistGradientBoostingRegressor
    return HistGradientBoostingRegressor(loss="absolute_error", max_iter=PARAMS["n_estimators"],
                                         learning_rate=PARAMS["learning_rate"], max_leaf_nodes=PARAMS["num_leaves"],
                                         min_samples_leaf=PARAMS["min_child_samples"], l2_regularization=1.0,
                                         categorical_features=[FEATURES.index("code")], random_state=42)


def _origin_frame(values: np.ndarray) -> pd.DataFrame:
    """Per-origin features (row t uses weeks <= t only)."""
    s = pd.Series(np.log(values))
    m4 = s.rolling(4).mean()
    frame = pd.DataFrame({
        "m4": m4,
        "last": s - m4,
        "lag1": s.shift(1) - m4, "lag2": s.shift(2) - m4, "lag4": s.shift(4) - m4, "lag8": s.shift(8) - m4,
        "lag13": s.shift(13) - m4, "lag26": s.shift(26) - m4,
        "m13": s.rolling(13).mean() - m4, "m26": s.rolling(26, min_periods=20).mean() - m4,
        "vol13": s.diff().rolling(13, min_periods=8).std(),
        "mom4": m4 - m4.shift(4),
        # mean of weeks k-1..k+1: used at k = t+h-52 (needs weeks <= t+h-51 <= t for h <= 51)
        "ly3": s.rolling(3, center=True).mean(),
    })
    return frame


def _design(values: np.ndarray, dates: pd.DatetimeIndex, code: int, horizons: range, origins: np.ndarray,
            observed: Optional[np.ndarray] = None, with_target: bool = True) -> pd.DataFrame:
    base = _origin_frame(values)
    n = len(values)
    logs = np.log(values)
    blocks = []
    for h in horizons:
        t = origins
        j = t + h
        if with_target:
            keep = j <= n - 1
            if observed is not None:
                keep &= observed[np.minimum(j, n - 1)]
            t, j = t[keep], j[keep]
        if len(t) == 0:
            continue
        rows = base.iloc[t][["m4", "last", "lag1", "lag2", "lag4", "lag8", "lag13", "lag26", "m13", "m26", "vol13", "mom4"]].copy()
        ly_idx = j - 52
        ly_now = np.where(t - 52 >= 1, base["ly3"].to_numpy()[np.clip(t - 52, 0, n - 1)], np.nan)
        ly_target = np.where(ly_idx >= 1, base["ly3"].to_numpy()[np.clip(ly_idx, 0, n - 1)], np.nan)
        rows["ly"] = ly_target - rows["m4"].to_numpy()
        rows["ly_change"] = ly_target - ly_now
        target_dates = dates[t] + pd.to_timedelta(7 * h, unit="D")
        week = target_dates.isocalendar().week.to_numpy(dtype=float)
        rows["woy_sin"], rows["woy_cos"] = np.sin(2 * np.pi * week / 52.18), np.cos(2 * np.pi * week / 52.18)
        rows["h"] = float(h)
        rows["code"] = code
        if with_target:
            rows["target"] = logs[j] - rows["m4"].to_numpy()
        blocks.append(rows)
    if not blocks:
        return pd.DataFrame(columns=FEATURES + ["m4", "target"])
    return pd.concat(blocks, ignore_index=True)


class LightGBMGlobal(Forecaster):
    id, name, family, speed = "lightgbm", "LightGBM (global)", "Gradient-boosted trees", "fast"
    blurb = "Learns from all vegetables at once: recent levels, momentum, season and last year's pattern."
    uses_panel = True

    def __init__(self, horizon: int = MAX_HORIZON):
        super().__init__()
        self.horizon = horizon
        self._boosters: Dict = {}
        self._panel_ref = None

    # A fitted booster is a pure function of (panel, cutoff date): cache it for the session
    def _booster_for(self, source, panel: Dict, cutoff: pd.Timestamp):
        """source is the caller's panel object: same object (and cutoff) -> same booster."""
        if source is None or source is not self._panel_ref:
            self._boosters, self._panel_ref = {}, source
        if cutoff not in self._boosters:
            self._boosters[cutoff] = self._train(panel, cutoff)
        return self._boosters[cutoff]

    def _codes(self, panel: Dict) -> Dict[str, int]:
        return {name: i for i, name in enumerate(sorted(panel))}

    def _train(self, panel: Dict, cutoff: pd.Timestamp):
        codes = self._codes(panel)
        frames = []
        for name, series in panel.items():
            keep = series.y.index <= cutoff                      # nothing after the cutoff, ever
            values, observed = series.y.to_numpy()[keep], series.observed[keep]
            if len(values) < MIN_ORIGIN + 2:
                continue
            origins = np.arange(MIN_ORIGIN, len(values) - 1)
            frames.append(_design(values, series.y.index[keep], codes[name], range(1, self.horizon + 1),
                                  origins, observed, with_target=True))
        data = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        if len(data) < 200:
            return None
        model = _new_regressor()
        X, target = data[FEATURES].to_numpy(float), data["target"].to_numpy(float)
        if engine() == "lightgbm":
            model.fit(X, target, categorical_feature=[FEATURES.index("code")])
        else:
            X[:, FEATURES.index("code")] = np.maximum(X[:, FEATURES.index("code")], 0)
            model.fit(X, target)
        return model

    def _forecast_from(self, booster, values: np.ndarray, dates: pd.DatetimeIndex, code: int, h: int) -> np.ndarray:
        rows = _design(values, dates, code, range(1, h + 1), np.array([len(values) - 1]), with_target=False)
        m4 = rows["m4"].to_numpy(float)
        if booster is None or not np.all(np.isfinite(m4)):
            level = np.log(values[-4:]).mean()
            return np.exp(np.full(h, level))
        X = rows[FEATURES].to_numpy(float)
        if engine() != "lightgbm":
            X[:, FEATURES.index("code")] = np.maximum(X[:, FEATURES.index("code")], 0)
        return np.exp(m4 + booster.predict(X))

    def _with_self(self, panel: Optional[Dict], y: pd.Series, commodity: Optional[str]):
        """Make sure the series being forecast is part of the training panel (as given, already truncated)."""
        from ml.series import WeeklySeries
        name = commodity or "__self__"
        if panel and name in panel:
            return panel, name
        panel = dict(panel or {})
        panel[name] = WeeklySeries(name, "", y, np.ones(len(y), bool))
        return panel, name

    def fit(self, y: pd.Series, panel: Optional[Dict] = None, commodity: Optional[str] = None) -> "LightGBMGlobal":
        self.y, self.commodity = y.astype(float), commodity
        full, name = self._with_self(panel, self.y, commodity)
        self._panel_used = full
        self._booster = self._booster_for(panel if full is panel else None, full, self.y.index[-1])
        self._code = self._codes(full).get(name, -1)
        return self

    def predict(self, h: int, quantiles=()) -> pd.DataFrame:
        values = self._forecast_from(self._booster, self.y.to_numpy(float), self.y.index, self._code, h)
        return pd.DataFrame({"yhat": values}, index=future_index(self.y.index[-1], h))

    def forecast_origins(self, y: pd.Series, origins: List[int], h: int, panel: Optional[Dict] = None,
                         commodity: Optional[str] = None):
        full, name = self._with_self(panel, y, commodity)
        code = self._codes(full).get(name, -1)
        anchor = max(series.y.index[-1] for series in full.values())
        points = np.full((len(origins), h), np.nan)
        for row, origin in enumerate(origins):
            origin_date = y.index[origin]
            # Latest refit date on the schedule that is not after this origin
            weeks_back = int(np.ceil(((anchor - origin_date).days / 7) / REFIT_EVERY)) * REFIT_EVERY
            refit = anchor - pd.Timedelta(days=7 * weeks_back)
            booster = self._booster_for(panel if full is panel else full, full, refit)
            points[row] = self._forecast_from(booster, y.to_numpy(float)[:origin + 1], y.index[:origin + 1], code, h)
        return points, None
