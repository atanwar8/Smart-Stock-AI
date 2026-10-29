"""Forecast Studio answers (/forecast/*): model catalog, leaderboard, sample previews, apply, active forecasts.

Where every number comes from:
  * prices      - the training store (store.get_store()), one region (ml.config.SERIES_REGION), as weekly series
  * backtest    - ml.backtest.evaluate(): rolling-origin forecasts on the stored weeks, hold-out = newest TEST_WEEKS
  * intervals   - split-conformal widths from the same backtest
  * forecast    - the model fit on every stored week, TIMES the pace scenario

Trained in the backend, read at click time: the pipeline (ml.pipeline.train_and_test, at startup and after every
refresh) backtests every model on all stored weeks AND stores each model's 8-week forecast path in its training
run. A preview only reads that run and rescales the stored path for the chosen horizon, confidence and pace, so
no model is fit or tested while the chef waits. Only when no stored run matches the data (tests, or training
switched off) does the service fit on demand; while the pipeline is training it answers 503 instead, rather
than competing with the training for the server's CPU.
"""

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from ml import intervals
from ml.backtest import STORE_VERSION, ModelEval, evaluate
from ml.config import DEFAULT_CONFIDENCE, MAX_HORIZON, SERIES_REGION, TEST_WEEKS
from ml.models import MODELS, ORDER, Ensemble, create
from ml.models.base import future_index
from ml.models.gbm import LightGBMGlobal
from ml.series import WeeklySeries, _key, build_panel
from store import Conflict, NotFound, get_store  # noqa: F401  (re-exported for the router)

DEFAULT_MODEL = "ensemble"
# Models the studio offers. "naive" stays a backtest baseline only (it is the MASE denominator's idea already).
STUDIO_MODELS = [m for m in ORDER if m != "naive"]
LIVE_MODELS = ["naive", "seasonal_naive", "ets", "theta", "lightgbm", "ensemble"]
# Set by ml.pipeline while it trains; previews then wait for its results instead of training a second copy
TRAINING = threading.Event()
TRAINING_MESSAGE = ("The models are being trained on the newest data. Samples will be ready in a few minutes "
                    "(Data refresh shows the progress).")


class StudioError(Exception):
    """A request the studio can't answer; carries the HTTP status for the router."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


# ---------------------------------------------------------------------------------------------- memo


class _Memo:
    """Version-keyed memo with one lock per key, so two requests for the same slow fit wait for one result."""

    def __init__(self):
        self._values: Dict[Tuple, object] = {}
        self._locks: Dict[Tuple, threading.Lock] = {}
        self._guard = threading.Lock()
        self._version: Optional[str] = None

    def get(self, version: str, key: Tuple, compute: Callable[[], object]):
        with self._guard:
            if version != self._version:      # new data: every cached answer is stale
                self._values, self._locks, self._version = {}, {}, version
            if key in self._values:
                return self._values[key]
            lock = self._locks.setdefault(key, threading.Lock())
        with lock:
            with self._guard:
                if version == self._version and key in self._values:
                    return self._values[key]
            value = compute()
            with self._guard:
                if version == self._version:
                    self._values[key] = value
            return value

    def clear(self) -> None:
        with self._guard:
            self._values, self._locks, self._version = {}, {}, None


_memo = _Memo()


def invalidate() -> None:
    """Called by the pipeline after it writes prices or training runs."""
    get_store().bump_version()
    _memo.clear()


def _version() -> str:
    return get_store().data_version()


def panel() -> Dict[str, WeeklySeries]:
    """{commodity: weekly series} for every tracked vegetable in the store (one query, cached per data version)."""
    store = get_store()
    return _memo.get(_version(), ("panel",), lambda: build_panel(store.read_prices(region=SERIES_REGION)))


def commodity_names() -> List[str]:
    return sorted(panel())


def resolve_commodity(name: str) -> str:
    """The stored spelling for a commodity name, ignoring punctuation ("Peppers, Bell Type" = "Peppers (Bell Type)")."""
    names = panel()
    if name in names:
        return name
    wanted = _key(name)
    for stored in names:
        if _key(stored) == wanted:
            return stored
    raise StudioError(404, f"No forecastable price history for {name!r}. Known: {', '.join(sorted(names)) or 'none'}.")


def _gbm() -> LightGBMGlobal:
    """One LightGBM per data version: its boosters are global (every vegetable), so sharing the instance lets every
    commodity reuse the same fits instead of refitting the whole panel per request."""
    return _memo.get(_version(), ("gbm",), LightGBMGlobal)


def forecast_path(model_id: str, series: WeeklySeries, panel_: Dict, weights: Optional[Dict] = None,
                  gbm: Optional[LightGBMGlobal] = None) -> np.ndarray:
    """MAX_HORIZON weekly prices after the series' last week, from the model fit on every stored week.

    The pipeline calls this once per (vegetable, model) and stores the result; the service only falls back to it.
    The ensemble uses the member weights its backtest chose; LightGBM reuses the shared booster.
    """
    gbm = gbm or LightGBMGlobal()
    if model_id == "ensemble":
        weights = weights or {"ets": 0.5, "theta": 0.5}
        model = Ensemble(weights=weights, members={"lightgbm": gbm} if "lightgbm" in weights else {})
    elif model_id == "lightgbm":
        model = gbm
    else:
        model = create(model_id)
    frame = model.fit(series.y, panel_, series.commodity).predict(MAX_HORIZON)
    return np.maximum(frame["yhat"].to_numpy(float), 1e-6)


# ---------------------------------------------------------------------------------------------- models


def catalog() -> Dict:
    models = []
    for model_id in STUDIO_MODELS:
        cls = MODELS[model_id]
        # Every studio model runs in this process; "mode"/"reason" stay in the response for the SPEC §5 contract
        models.append({"id": cls.id, "name": cls.name, "family": cls.family, "available": True,
                       "mode": "live", "reason": None, "speed": cls.speed, "blurb": cls.blurb})
    return {"default": DEFAULT_MODEL, "models": models}


def _require_model(model_id: str) -> None:
    if model_id not in STUDIO_MODELS:
        raise StudioError(422, f"Unknown model {model_id!r}. Choose one of: {', '.join(STUDIO_MODELS)}.")


# ---------------------------------------------------------------------------------------------- evaluations


@dataclass
class Evaluation:
    """What the studio needs from one backtest, whether computed now or read back from a stored training run."""
    model: str
    commodity: str
    unit: str
    metrics: Dict
    backtest: List[Dict]                       # the 8-week path forecast at train_end
    test_levels: List[float]
    calib_test: Optional[np.ndarray] = None    # conformal widths from pre-test errors (backtest bands)
    calib_full: Optional[np.ndarray] = None    # conformal widths from every out-of-sample error (future bands)
    weights: Optional[Dict[str, float]] = None
    window: Dict = field(default_factory=dict)  # train/test dates
    training_run_id: Optional[int] = None
    created_at: Optional[str] = None
    future: Optional[List[float]] = None       # the stored MAX_HORIZON-week forecast path (pipeline runs only)

    @classmethod
    def from_eval(cls, ev: ModelEval) -> "Evaluation":
        return cls(model=ev.model, commodity=ev.commodity, unit=ev.unit, metrics=dict(ev.metrics),
                   backtest=list(ev.backtest), test_levels=list(ev.test_levels), calib_test=ev.calib_test,
                   calib_full=ev.calib_full, weights=ev.weights,
                   window={"train_start": ev.train_start, "train_end": ev.train_end,
                           "test_start": ev.test_start, "test_end": ev.test_end})

    @classmethod
    def from_run(cls, run: Dict) -> "Evaluation":
        params = run.get("params") or {}
        table = lambda name: np.asarray(params[name], float) if params.get(name) is not None else None  # noqa: E731
        return cls(model=run["model"], commodity=run["commodity"], unit=run["unit"], metrics=dict(run.get("metrics") or {}),
                   backtest=list(params.get("backtest") or []), test_levels=list(params.get("test_levels") or []),
                   calib_test=table("calib_test"), calib_full=table("calib_full"), weights=params.get("weights"),
                   window={k: run.get(k) for k in ("train_start", "train_end", "test_start", "test_end")},
                   training_run_id=run.get("id"), created_at=run.get("created_at"), future=params.get("future"))


def _current_runs(commodity: str, last_date: str) -> Dict[str, Dict]:
    """The commodity's newest pipeline training runs, if they were scored on the data stored now (and written by a
    pipeline that stores forecast paths: older runs are ignored and retrained, see backtest.STORE_VERSION)."""
    def load():
        runs = get_store().latest_training_runs(commodity)
        return {model: run for model, run in runs.get(commodity, {}).items()
                if run.get("test_end") == last_date and (run.get("params") or {}).get("version", 1) >= STORE_VERSION}
    return _memo.get(_version(), ("runs", commodity), load)


def evaluation(commodity: str, model_id: str) -> Evaluation:
    series = panel()[commodity]

    def compute():
        run = _current_runs(commodity, series.dates[-1].date().isoformat()).get(model_id)
        if run is not None and run.get("metrics"):
            return Evaluation.from_run(run)
        if TRAINING.is_set():
            raise StudioError(503, TRAINING_MESSAGE)
        try:
            evals = evaluate(series, [model_id], panel=panel(), models={"lightgbm": _gbm()})
        except ValueError as exc:   # too few weeks for a hold-out
            raise StudioError(422, f"{commodity}: {exc}")
        return Evaluation.from_eval(evals[model_id])

    return _memo.get(_version(), ("eval", commodity, model_id), compute)


def future_path(commodity: str, model_id: str) -> Tuple[pd.DatetimeIndex, np.ndarray]:
    """(dates, yhat) for MAX_HORIZON weeks after the last stored week: the stored path when the pipeline wrote one."""
    series = panel()[commodity]
    dates = future_index(series.dates[-1], MAX_HORIZON)

    def compute():
        ev = evaluation(commodity, model_id)
        if ev.future and len(ev.future) >= MAX_HORIZON:
            return dates, np.asarray(ev.future[:MAX_HORIZON], float)
        if TRAINING.is_set():
            raise StudioError(503, TRAINING_MESSAGE)
        return dates, forecast_path(model_id, series, panel(), ev.weights, _gbm())

    return _memo.get(_version(), ("path", commodity, model_id), compute)


# ---------------------------------------------------------------------------------------------- leaderboard


def _row(model_id: str, metrics: Dict) -> Dict:
    clean = lambda v: None if v is None or not np.isfinite(v) else round(float(v), 4)  # noqa: E731
    return {"model": model_id, "name": MODELS[model_id].name, "mae": clean(metrics.get("mae")),
            "rmse": clean(metrics.get("rmse")), "mape": clean(metrics.get("mape")), "smape": clean(metrics.get("smape")),
            "mase": clean(metrics.get("mase")), "coverage": clean(metrics.get("coverage")),
            "skill": clean(metrics.get("skill"))}


def leaderboard(commodity: str) -> Dict:
    commodity = resolve_commodity(commodity)

    def compute():
        evals: Dict[str, Evaluation] = {}
        for model_id in STUDIO_MODELS:
            try:
                evals[model_id] = evaluation(commodity, model_id)
            except StudioError as exc:
                if exc.status == 503:   # training in the backend: say so, rather than cache an empty board
                    raise
                continue
        rows = [_row(m, e.metrics) for m, e in evals.items() if e.metrics]
        ranked = sorted(rows, key=lambda r: (r["mase"] is None, r["mase"] or 0, r["mae"] or 0))
        for rank, row in enumerate(ranked, 1):
            row["rank"] = rank
        reference = next((e for e in evals.values() if e.window.get("train_start")), None)
        stamps = [e.created_at for e in evals.values() if e.created_at]
        return {"commodity": commodity, "unit": panel()[commodity].unit,
                **({k: reference.window[k] for k in ("train_start", "train_end", "test_start", "test_end")} if reference else
                   {"train_start": None, "train_end": None, "test_start": None, "test_end": None}),
                "test_weeks": TEST_WEEKS, "champion": ranked[0]["model"] if ranked else None,
                "updated_at": max(stamps) if stamps else _now(), "rows": ranked}

    return _memo.get(_version(), ("leaderboard", commodity), compute)


# ---------------------------------------------------------------------------------------------- preview / apply


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _money(value: float) -> str:
    return f"${value:,.2f}"


def _summary(commodity: str, unit: str, recent: float, yhat: np.ndarray, lo: np.ndarray, hi: np.ndarray,
             confidence: float, pace_pct: float) -> str:
    """One plain sentence. The change is measured against the last 4 weeks' average, not the newest week alone:
    retail prices spike for a single promo week, and "falls 21%" from a spike reads as a crash that isn't one."""
    change = 100 * (yhat[-1] / recent - 1)
    weeks = len(yhat)
    span = f"the next {weeks} weeks" if weeks > 1 else "next week"
    if abs(change) < 1.5:
        move = f"likely hold near the last month's average over {span}"
    else:
        verb = ("rise" if change > 0 else "ease") if abs(change) < 8 else ("climb" if change > 0 else "fall")
        move = f"likely {verb} about {abs(change):.0f}% from the last month's average over {span}"
    scenario = f" (with a {pace_pct:+.0f}% pace scenario)" if pace_pct else ""
    return (f"{commodity} {move}{scenario}; {round(confidence * 100):.0f}% range "
            f"{_money(lo[-1])}–{_money(hi[-1])} {unit}.")


def _bounds(yhat: np.ndarray, table: Optional[np.ndarray], confidence: float):
    """Conformal band around a path: yhat * exp(+-q) with q the stored half-width per step (wide prior if none)."""
    widths = intervals.half_width(table, confidence, len(yhat)) if table is not None else np.full(len(yhat), 0.15)
    return yhat * np.exp(-widths), yhat * np.exp(widths)


def _r(value) -> Optional[float]:
    return None if value is None or not np.isfinite(value) else round(float(value), 4)


def preview(commodity: str, model_id: str, horizon_weeks: int = 1, confidence: float = DEFAULT_CONFIDENCE,
            pace_pct: float = 0.0) -> Dict:
    """One sample forecast, stored as a 'preview' row so it can be applied later."""
    started = time.perf_counter()
    commodity = resolve_commodity(commodity)
    _require_model(model_id)
    series = panel()[commodity]
    cut = series   # models always learn from every stored week
    ev = evaluation(commodity, model_id)
    dates, path = future_path(commodity, model_id)
    horizon_weeks = int(min(max(horizon_weeks, 1), MAX_HORIZON))

    yhat = path[:horizon_weeks]
    lo, hi = _bounds(yhat, ev.calib_full, confidence)
    # Pace scenario: the whole band drifts with the path, so the range stays proportional
    yhat, lo, hi = (intervals.scenario(v, pace_pct) for v in (yhat, lo, hi))
    forecast = [{"date": d.date().isoformat(), "yhat": round(float(y), 4), "lo": round(float(a), 4), "hi": round(float(b), 4)}
                for d, y, a, b in zip(dates[:horizon_weeks], yhat, lo, hi)]

    backtest = []
    for point in ev.backtest:
        h = int(point.get("h") or len(backtest) + 1)
        b_lo, b_hi = _bounds(np.asarray([point["predicted"]], float),
                             None if ev.calib_test is None else ev.calib_test[:, h - 1:h], confidence)
        backtest.append({"date": point["date"], "actual": point.get("actual"), "predicted": point["predicted"],
                         "lo": round(float(b_lo[0]), 4), "hi": round(float(b_hi[0]), 4)})

    keep = max(26, 2 * horizon_weeks)
    observed = cut.y[cut.observed]
    history = [{"date": d.date().isoformat(), "price": round(float(p), 4)} for d, p in observed.iloc[-keep:].items()]

    coverage = intervals.pick(ev.test_levels, confidence)
    metrics = {"mae": _r(ev.metrics.get("mae")), "mape": _r(ev.metrics.get("mape")), "mase": _r(ev.metrics.get("mase")),
               "coverage": _r(coverage if coverage is not None else ev.metrics.get("coverage")),
               "skill": _r(ev.metrics.get("skill"))}
    summary = _summary(commodity, series.unit, float(observed.iloc[-4:].mean()), yhat, lo, hi, confidence, pace_pct)
    # history_years stays in the response (always null = every stored week) for clients built on SPEC §5
    params = {"horizon_weeks": horizon_weeks, "confidence": confidence, "history_years": None, "pace_pct": pace_pct}

    preview_id = get_store().insert_forecast({
        "commodity": commodity, "unit": series.unit, "model": model_id, "horizon_weeks": horizon_weeks,
        "confidence": confidence, "history_years": None, "pace_pct": pace_pct, "status": "preview",
        "training_run_id": None, "points": forecast, "metrics": metrics, "summary": summary})
    return {"preview_id": preview_id, "commodity": commodity, "unit": series.unit, "model": model_id,
            "model_name": MODELS[model_id].name, "mode": "live", "params": params, "history": history,
            "backtest": backtest, "forecast": forecast, "metrics": metrics, "summary": summary,
            "train_window": {"start": cut.dates[0].date().isoformat(), "end": cut.dates[-1].date().isoformat(),
                             "weeks": int(cut.observed.sum())},
            "elapsed_ms": int((time.perf_counter() - started) * 1000), "generated_at": _now()}


def apply(preview_id: str) -> Dict:
    try:
        result = get_store().apply_forecast(preview_id)
    except NotFound:
        raise StudioError(404, "That sample forecast doesn't exist (it may have expired). Generate a new one.")
    except Conflict as exc:
        raise StudioError(409, str(exc))
    return {"applied": True, **result}


def _active_item(row: Dict) -> Dict:
    model_id = row["model"]
    return {"forecast_id": row["id"], "commodity": row["commodity"], "unit": row["unit"], "model": model_id,
            "model_name": MODELS[model_id].name if model_id in MODELS else model_id, "applied_at": row["applied_at"],
            "params": {"horizon_weeks": row["horizon_weeks"], "confidence": row["confidence"],
                       "history_years": row["history_years"], "pace_pct": row["pace_pct"]},
            "forecast": row["points"] or [], "summary": row["summary"]}


def active(commodity: Optional[str] = None) -> Dict:
    if commodity:
        try:
            commodity = resolve_commodity(commodity)
        except StudioError:
            return {"items": []}
    return {"items": [_active_item(r) for r in get_store().active_forecasts(commodity)]}
