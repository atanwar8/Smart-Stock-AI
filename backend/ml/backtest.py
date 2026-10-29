"""Rolling-origin evaluation: every number on the leaderboard comes from here.

For one commodity's weekly series y_0..y_{n-1}:
  * test window   = the newest TEST_WEEKS weeks, (train_end, n-1]. Never used to fit, tune, weight or calibrate.
  * origins       = every week from the first one with a year of history up to n-2. At each origin o a model is
                    refit on y_0..y_o only and forecasts MAX_HORIZON weeks ahead (expanding window).
  * validation    = forecasts from origins < train_end whose targets are <= train_end (h <= TEST_WEEKS):
                    used to pick and weight ensemble members.
  * calibration   = the same pre-test forecasts at every step h: their |log errors| set the conformal widths
                    used on the hold-out (so hold-out coverage is honest).
  * test metrics  = forecasts from origins train_end .. n-2 for targets inside the test window (h <= 8):
                    MAE, RMSE, MAPE, sMAPE, MASE, interval coverage, skill vs seasonal naive.
  * backtest path = the single 8-week forecast made at train_end (what the chart shows).
Interpolated (missing) weeks are never scored and never used as targets.
"""

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

import numpy as np
import pandas as pd

from ml import intervals, metrics
from ml.config import MAX_HORIZON, MIN_CONTEXT, SEASON, TEST_WEEKS
from ml.models import ENSEMBLE_CANDIDATES, create, ensemble_weights
from ml.series import WeeklySeries

MAX_ORIGINS = 78   # bound the cost as the store grows: the newest 1.5 years of origins are plenty


@dataclass
class Plan:
    n: int
    test_weeks: int
    horizon: int
    train_end: int                 # index of the last training week
    origins: np.ndarray            # every backtest origin (validation/calibration + test)
    min_context: int

    @property
    def test_origins(self) -> np.ndarray:
        return self.origins[self.origins >= self.train_end]


def make_plan(n: int, test_weeks: int = TEST_WEEKS, horizon: int = MAX_HORIZON) -> Plan:
    train_end = n - 1 - test_weeks
    if train_end < 20:
        raise ValueError(f"Need at least {test_weeks + 21} weeks of history to backtest, have {n}.")
    # A year of context when there is room for ~20 validation origins, less with short histories
    min_context = MIN_CONTEXT if train_end + 1 - MIN_CONTEXT >= 20 else max(13, train_end + 1 - 20)
    first = max(min_context - 1, train_end - MAX_ORIGINS)
    origins = np.arange(first, n - 1)
    return Plan(n=n, test_weeks=test_weeks, horizon=horizon, train_end=train_end, origins=origins,
                min_context=min_context)


def seasonal_naive_points(values: np.ndarray, origins: np.ndarray, horizon: int) -> np.ndarray:
    """The seasonal-naive forecast every origin would have made (same rule as models.SeasonalNaive)."""
    steps = np.arange(1, horizon + 1)
    out = np.empty((len(origins), horizon))
    for row, origin in enumerate(origins):
        if origin + 1 < SEASON:
            out[row] = values[origin]
        else:
            out[row] = values[origin + steps - SEASON * np.ceil(steps / SEASON).astype(int)]
    return out


@dataclass
class ModelEval:
    model: str
    commodity: str
    unit: str
    plan: Plan
    dates: pd.DatetimeIndex
    points: np.ndarray                         # (n_origins, horizon)
    metrics: Dict = field(default_factory=dict)
    val_mase: float = float("nan")
    calib_test: Optional[np.ndarray] = None    # conformal table from pre-test errors
    calib_full: Optional[np.ndarray] = None    # conformal table from every out-of-sample error (for the future)
    test_levels: List[float] = field(default_factory=list)
    backtest: List[Dict] = field(default_factory=list)
    weights: Optional[Dict[str, float]] = None
    n_train: int = 0
    n_test: int = 0

    @property
    def train_start(self) -> str:
        return self.dates[0].date().isoformat()

    @property
    def train_end(self) -> str:
        return self.dates[self.plan.train_end].date().isoformat()

    @property
    def test_start(self) -> str:
        return self.dates[self.plan.train_end + 1].date().isoformat()

    @property
    def test_end(self) -> str:
        return self.dates[-1].date().isoformat()

    def training_run(self, source: str = "pipeline", history_years=None, extra: Optional[Dict] = None) -> Dict:
        """The training_runs row for this (commodity, model)."""
        params = {
            "version": 1, "source": source, "history_years": history_years, "test_weeks": self.plan.test_weeks,
            "horizon": self.plan.horizon, "min_context": self.plan.min_context, "n_origins": int(len(self.plan.origins)),
            "backtest": self.backtest, "test_levels": [round(v, 4) for v in self.test_levels],
            "calib_levels": [float(v) for v in intervals.LEVELS],
        }
        if self.calib_test is not None:
            params["calib_test"] = np.round(self.calib_test, 5).tolist()
            params["calib_full"] = np.round(self.calib_full, 5).tolist()
        if self.weights:
            params["weights"] = self.weights
        params.update(extra or {})
        return {"commodity": self.commodity, "unit": self.unit, "model": self.model,
                "train_start": self.train_start, "train_end": self.train_end, "test_start": self.test_start,
                "test_end": self.test_end, "n_train": self.n_train, "n_test": self.n_test,
                "metrics": {**self.metrics, "val_mase": self.val_mase}, "params": params}


def forecast_matrix(model_id: str, series: WeeklySeries, plan: Plan, panel: Optional[Dict] = None,
                    model=None):
    model = model or create(model_id)
    return model.forecast_origins(series.y, list(plan.origins), plan.horizon, panel, series.commodity)


def score(model_id: str, series: WeeklySeries, plan: Plan, points: np.ndarray,
          weights: Optional[Dict] = None) -> ModelEval:
    y, observed = series.y.to_numpy(float), series.observed
    n, horizon, train_end = plan.n, plan.horizon, plan.train_end
    snaive = seasonal_naive_points(y, plan.origins, horizon)
    scale = metrics.mase_scale(y[:train_end + 1], observed[:train_end + 1])
    points = np.maximum(points, 1e-6)

    cal_errors, full_errors = [[] for _ in range(horizon)], [[] for _ in range(horizon)]
    val_actual, val_pred = [], []
    test = {"actual": [], "pred": [], "snaive": [], "levels": [], "pos": []}
    for row, origin in enumerate(plan.origins):
        for h in range(1, horizon + 1):
            target = origin + h
            if target > n - 1 or not observed[target]:
                continue
            err = abs(np.log(y[target]) - np.log(points[row, h - 1]))
            full_errors[h - 1].append(err)
            if target <= train_end:
                cal_errors[h - 1].append(err)
                if h <= plan.test_weeks:
                    val_actual.append(y[target])
                    val_pred.append(points[row, h - 1])
            elif origin >= train_end and h <= plan.test_weeks:
                test["actual"].append(y[target])
                test["pred"].append(points[row, h - 1])
                test["snaive"].append(snaive[row, h - 1])
                test["pos"].append((row, h))

    ev = ModelEval(model=model_id, commodity=series.commodity, unit=series.unit, plan=plan, dates=series.dates,
                   points=points, weights=weights)
    ev.calib_test = intervals.conformal_table(cal_errors, horizon)
    ev.calib_full = intervals.conformal_table(full_errors, horizon)
    for (row, h), actual, pred in zip(test["pos"], test["actual"], test["pred"]):
        ev.test_levels.append(intervals.conformal_level(abs(np.log(actual) - np.log(pred)), ev.calib_test[:, h - 1]))

    ev.val_mase = metrics.mase(val_actual, val_pred, scale) if val_actual else float("nan")
    if test["actual"]:
        ev.metrics = metrics.summarize(test["actual"], test["pred"], scale, baseline=test["snaive"], levels=ev.test_levels)
    ev.n_train = int(observed[:train_end + 1].sum())
    ev.n_test = int(observed[train_end + 1:].sum())

    # The chart's backtest: the single forecast made at train_end for the 8 held-out weeks
    row = int(np.where(plan.origins == train_end)[0][0])
    for h in range(1, plan.test_weeks + 1):
        target = train_end + h
        point = {"date": series.dates[target].date().isoformat(),
                 "actual": round(float(y[target]), 4) if observed[target] else None,
                 "predicted": round(float(points[row, h - 1]), 4), "h": h}
        ev.backtest.append(point)
    return ev


def evaluate(series: WeeklySeries, model_ids: List[str], panel: Optional[Dict] = None,
             test_weeks: int = TEST_WEEKS, horizon: int = MAX_HORIZON, models: Optional[Dict] = None,
             progress: Optional[Callable[[str], None]] = None) -> Dict[str, ModelEval]:
    """Backtest the requested models on one commodity. 'ensemble' pulls in its candidate members."""
    plan = make_plan(len(series), test_weeks, horizon)
    models = models or {}
    wanted = list(model_ids)
    needed = list(dict.fromkeys(wanted + (list(ENSEMBLE_CANDIDATES) if "ensemble" in wanted else [])))
    results: Dict[str, ModelEval] = {}
    for model_id in needed:
        if model_id == "ensemble":
            continue
        if progress:
            progress(model_id)
        points, _ = forecast_matrix(model_id, series, plan, panel, models.get(model_id))
        results[model_id] = score(model_id, series, plan, points)
    if "ensemble" in wanted:
        weights = ensemble_weights({m: results[m].val_mase for m in ENSEMBLE_CANDIDATES if m in results})
        points = sum(w * results[m].points for m, w in weights.items()) / sum(weights.values())
        results["ensemble"] = score("ensemble", series, plan, points, weights=weights)
    return {m: results[m] for m in wanted if m in results}


def champion(evals: Dict[str, ModelEval]) -> Optional[str]:
    """Lowest hold-out MASE (ties: lower MAE)."""
    scored = [(e.metrics.get("mase"), e.metrics.get("mae"), m) for m, e in evals.items()
              if e.metrics and np.isfinite(e.metrics.get("mase", np.nan))]
    return min(scored)[2] if scored else None
