"""Forecast Studio answers (/forecast/*): model catalog, leaderboard, sample previews, apply, active forecasts.

Where every number comes from:
  * prices      - the training store (store.get_store()), one region (ml.config.SERIES_REGION), as weekly series
  * backtest    - ml.backtest.evaluate(): rolling-origin forecasts on the stored weeks, hold-out = newest TEST_WEEKS
  * intervals   - the model's own deciles (TimesFM) or split-conformal widths from the same backtest
  * forecast    - the model refit on every stored week in the chosen history window, TIMES the pace scenario

Caching: everything expensive is a pure function of (data version, commodity, model, history window), so it is
memoized under that key and dropped when the data version changes (a refresh, a new training batch). Moving the
horizon, confidence or pace sliders only re-slices and re-scales a cached 26-week path, which is instant. The
pipeline's stored training runs already hold the backtest and calibration for the full window, so the default
preview of a model the pipeline has scored only needs one final fit.
"""

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from ml import intervals
from ml.backtest import ModelEval, evaluate
from ml.config import DEFAULT_CONFIDENCE, MAX_HORIZON, SERIES_REGION, TEST_WEEKS
from ml.models import MODELS, ORDER, Ensemble, create
from ml.models.gbm import LightGBMGlobal
from ml.models.timesfm_model import TimesFM
from ml.series import WeeklySeries, _key, build_panel, truncate_panel
from store import Conflict, NotFound, get_store  # noqa: F401  (re-exported for the router)

DEFAULT_MODEL = "ensemble"
# Models the studio offers. "naive" stays a backtest baseline only (it is the MASE denominator's idea already).
STUDIO_MODELS = [m for m in ORDER if m != "naive"]
LIVE_MODELS = ["naive", "seasonal_naive", "ets", "theta", "lightgbm", "ensemble"]


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


def _gbm(years_key) -> LightGBMGlobal:
    """One LightGBM per (data version, history window): its boosters are global (every vegetable), so sharing the
    instance lets every commodity reuse the same fits instead of refitting the whole panel per request."""
    return _memo.get(_version(), ("gbm", years_key), LightGBMGlobal)


# ---------------------------------------------------------------------------------------------- models


def model_status(model_id: str) -> Tuple[str, Optional[str]]:
    """(mode, reason): 'live' runs here, 'stored' comes from the latest offline run, 'unavailable' says why."""
    if model_id != "timesfm":
        return "live", None
    live, reason = TimesFM.live_status()
    if live:
        return "live", None
    if _stored_timesfm_runs():
        return "stored", None
    return "unavailable", (reason or "TimesFM is not available.") + (
        " No offline TimesFM run is stored either (run `python -m scripts.offline_timesfm` on a machine with ~2 GB RAM).")


def _stored_timesfm_runs() -> Dict[str, Dict]:
    """{commodity: newest offline TimesFM training run} (cached per data version)."""
    def load():
        latest = get_store().latest_training_runs()
        return {c: per_model["timesfm"] for c, per_model in latest.items()
                if "timesfm" in per_model and (per_model["timesfm"].get("params") or {}).get("source") == "offline"}
    return _memo.get(_version(), ("timesfm-stored",), load)


def catalog() -> Dict:
    models = []
    for model_id in STUDIO_MODELS:
        cls = MODELS[model_id]
        mode, reason = model_status(model_id)
        models.append({"id": cls.id, "name": cls.name, "family": cls.family, "available": mode != "unavailable",
                       "mode": mode, "reason": reason, "speed": cls.speed, "blurb": cls.blurb})
    return {"default": DEFAULT_MODEL, "models": models}


def _require_model(model_id: str) -> str:
    if model_id not in STUDIO_MODELS:
        raise StudioError(422, f"Unknown model {model_id!r}. Choose one of: {', '.join(STUDIO_MODELS)}.")
    mode, reason = model_status(model_id)
    if mode == "unavailable":
        raise StudioError(409, reason or f"{model_id} is unavailable on this server.")
    return mode


# ---------------------------------------------------------------------------------------------- evaluations


@dataclass
class Evaluation:
    """What the studio needs from one backtest, whether computed now or read back from a stored training run."""
    model: str
    commodity: str
    unit: str
    metrics: Dict
    backtest: List[Dict]                       # the 8-week path forecast at train_end (with deciles for TimesFM)
    test_levels: List[float]
    calib_test: Optional[np.ndarray] = None    # conformal widths from pre-test errors (backtest bands)
    calib_full: Optional[np.ndarray] = None    # conformal widths from every out-of-sample error (future bands)
    weights: Optional[Dict[str, float]] = None
    window: Dict = field(default_factory=dict)  # train/test dates
    training_run_id: Optional[int] = None
    created_at: Optional[str] = None

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
                   training_run_id=run.get("id"), created_at=run.get("created_at"))


def _window(series: WeeklySeries, history_years: Optional[float]) -> Tuple[WeeklySeries, Optional[float]]:
    """The series cut to the history window, and the cache key for it (None when the window is everything stored)."""
    cut = series.last_years(history_years)
    return cut, (None if len(cut) == len(series) else float(history_years))


def _current_runs(commodity: str, last_date: str) -> Dict[str, Dict]:
    """The commodity's newest pipeline training runs, if they were scored on the data stored now."""
    def load():
        runs = get_store().latest_training_runs(commodity)
        return {model: run for model, run in runs.get(commodity, {}).items()
                if run.get("test_end") == last_date and (run.get("params") or {}).get("history_years") is None}
    return _memo.get(_version(), ("runs", commodity), load)


def evaluation(commodity: str, model_id: str, history_years: Optional[float] = None) -> Evaluation:
    series = panel()[commodity]
    if model_id == "timesfm" and model_status("timesfm")[0] == "stored":
        run = _stored_timesfm_runs().get(commodity)
        if run is None:
            raise StudioError(409, f"The stored TimesFM run has no forecast for {commodity}.")
        return Evaluation.from_run(run)
    cut, years_key = _window(series, history_years)

    def compute():
        if years_key is None:
            run = _current_runs(commodity, series.dates[-1].date().isoformat()).get(model_id)
            if run is not None and run.get("metrics"):
                return Evaluation.from_run(run)
        sub_panel = panel() if years_key is None else truncate_panel(panel(), cut.dates[-1], years_key)
        try:
            evals = evaluate(cut, [model_id], panel=sub_panel, models={"lightgbm": _gbm(years_key)})
        except ValueError as exc:   # too few weeks for a hold-out
            raise StudioError(422, f"{commodity}: {exc} Try a longer history window.")
        return Evaluation.from_eval(evals[model_id])

    return _memo.get(_version(), ("eval", commodity, model_id, years_key), compute)


def future_path(commodity: str, model_id: str, history_years: Optional[float] = None) -> Tuple[pd.DatetimeIndex, np.ndarray, Optional[np.ndarray]]:
    """(dates, yhat, deciles or None) for MAX_HORIZON weeks after the last stored week, from a fit on the window."""
    series = panel()[commodity]
    if model_id == "timesfm" and model_status("timesfm")[0] == "stored":
        ev = evaluation(commodity, model_id)
        stored = get_store().offline_forecast(ev.training_run_id) if ev.training_run_id else None
        points = (stored or {}).get("points") or []
        if not points:
            raise StudioError(409, f"The stored TimesFM run has no forecast path for {commodity}.")
        dates = pd.to_datetime([p["date"] for p in points])
        deciles = np.asarray([p["deciles"] for p in points], float) if all("deciles" in p for p in points) else None
        return dates, np.asarray([p["yhat"] for p in points], float), deciles
    cut, years_key = _window(series, history_years)

    def compute():
        sub_panel = panel() if years_key is None else truncate_panel(panel(), cut.dates[-1], years_key)
        if model_id == "ensemble":
            weights = evaluation(commodity, "ensemble", history_years).weights or {"ets": 0.5, "theta": 0.5}
            members = {"lightgbm": _gbm(years_key)} if "lightgbm" in weights else {}
            model = Ensemble(weights=weights, members=members)
        elif model_id == "lightgbm":
            model = _gbm(years_key)
        else:
            model = create(model_id)
        frame = model.fit(cut.y, sub_panel, commodity).predict(MAX_HORIZON)
        deciles = None
        quantile_columns = [c for c in frame.columns if c.startswith("q")]
        if quantile_columns:
            deciles = frame[sorted(quantile_columns)].to_numpy(float)
        return frame.index, np.maximum(frame["yhat"].to_numpy(float), 1e-6), deciles

    return _memo.get(_version(), ("path", commodity, model_id, years_key), compute)


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
            mode, _ = model_status(model_id)
            if mode == "unavailable":
                continue
            try:
                evals[model_id] = evaluation(commodity, model_id)
            except StudioError:
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


def _bounds(yhat: np.ndarray, deciles: Optional[np.ndarray], table: Optional[np.ndarray], confidence: float):
    if deciles is not None:
        return intervals.quantile_bounds(deciles, confidence)
    widths = intervals.half_width(table, confidence, len(yhat)) if table is not None else np.full(len(yhat), 0.15)
    return yhat * np.exp(-widths), yhat * np.exp(widths)


def _r(value) -> Optional[float]:
    return None if value is None or not np.isfinite(value) else round(float(value), 4)


def preview(commodity: str, model_id: str, horizon_weeks: int = 8, confidence: float = DEFAULT_CONFIDENCE,
            history_years: Optional[float] = 2, pace_pct: float = 0.0) -> Dict:
    """One sample forecast, stored as a 'preview' row so it can be applied later."""
    started = time.perf_counter()
    commodity = resolve_commodity(commodity)
    mode = _require_model(model_id)
    series = panel()[commodity]
    cut, _ = _window(series, history_years)
    ev = evaluation(commodity, model_id, history_years)
    dates, path, deciles = future_path(commodity, model_id, history_years)
    if horizon_weeks > len(path):
        raise StudioError(422, f"This model's stored forecast covers {len(path)} weeks; choose a shorter horizon.")

    yhat = path[:horizon_weeks]
    step_deciles = deciles[:horizon_weeks] if deciles is not None else None
    lo, hi = _bounds(yhat, step_deciles, ev.calib_full, confidence)
    # Pace scenario: the whole band drifts with the path, so the range stays proportional
    yhat, lo, hi = (intervals.scenario(v, pace_pct) for v in (yhat, lo, hi))
    forecast = [{"date": d.date().isoformat(), "yhat": round(float(y), 4), "lo": round(float(a), 4), "hi": round(float(b), 4)}
                for d, y, a, b in zip(dates[:horizon_weeks], yhat, lo, hi)]

    backtest = []
    for point in ev.backtest:
        h = int(point.get("h") or len(backtest) + 1)
        if point.get("deciles") is not None:
            b_lo, b_hi = intervals.quantile_bounds(np.asarray([point["deciles"]], float), confidence)
        else:
            b_lo, b_hi = _bounds(np.asarray([point["predicted"]], float), None, None if ev.calib_test is None else ev.calib_test[:, h - 1:h], confidence)
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
    if mode == "stored":
        summary += " From the latest offline TimesFM run (history window fixed by that run)."
    params = {"horizon_weeks": horizon_weeks, "confidence": confidence, "history_years": history_years, "pace_pct": pace_pct}

    preview_id = get_store().insert_forecast({
        "commodity": commodity, "unit": series.unit, "model": model_id, "horizon_weeks": horizon_weeks,
        "confidence": confidence, "history_years": history_years, "pace_pct": pace_pct, "status": "preview",
        "training_run_id": None, "points": forecast, "metrics": {**metrics, "mode": mode}, "summary": summary})
    return {"preview_id": preview_id, "commodity": commodity, "unit": series.unit, "model": model_id,
            "model_name": MODELS[model_id].name, "mode": mode, "params": params, "history": history,
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
