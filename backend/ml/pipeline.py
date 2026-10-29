"""The training pipeline behind /pipeline/*: Extract -> Load -> Train -> Test, always incremental.

  Extract  ask USDA (core.usda_api.fetch_window, needs MARS_API_KEY) only for [newest stored week - 6 days, today].
           Re-requesting the newest stored week picks up corrections USDA published since.
  Load     upsert into usda_prices on the natural key (store.upsert_prices): new weeks are inserted, re-published
           rows overwrite the stored copy, nothing is ever deleted, and re-running the same window is a no-op.
  Train    every tracked vegetable's weekly series from ALL stored weeks (the two-year seed plus every delta since).
  Test     rolling-origin backtests with the newest TEST_WEEKS held out (ml.backtest), one training_runs row per
           (commodity, model), champion = lowest hold-out MASE.

No key, or no new weeks, records the ingest run as 'skipped' with the reason, and Train/Test still runs on what is
stored. One refresh runs at a time across every server process (store.exclusive -> a Postgres advisory lock).
Progress lives in this process's memory (the status page polls it); the durable record is the ingest_runs row.
"""

import os
import threading
import traceback
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Dict, List, Optional

import requests

from core import usda_api
from ml import service
from ml.backtest import champion, evaluate
from ml.config import SERIES_REGION
from ml.models.gbm import LightGBMGlobal
from ml.series import build_panel, tracked_commodities
from store import get_store

LOCK_NAME = "smartstock:refresh"
STEPS = ("extract", "load", "train", "test", "done")


class Busy(RuntimeError):
    """A refresh is already running (here or in another server process)."""


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class _State:
    """The live progress the status endpoint reports (one per process)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.data: Dict = {"state": "idle", "step": None, "progress": 0.0, "message": "No refresh has run since the server started.",
                           "job_id": None, "started_at": None, "finished_at": None}

    def update(self, **values) -> None:
        with self.lock:
            self.data.update(values)

    def snapshot(self) -> Dict:
        with self.lock:
            return dict(self.data)


_state = _State()
_thread: Optional[threading.Thread] = None
_start_guard = threading.Lock()


def live_models() -> List[str]:
    """Every model the pipeline scores (the studio's models plus the naive baseline)."""
    return list(service.LIVE_MODELS)


def train_and_test(store=None, ingest_run_id: Optional[int] = None,
                   progress: Optional[Callable[[str, float, str], None]] = None) -> Dict:
    """Backtest every live model on every tracked vegetable and store the scores. Returns a summary.

    progress(step, fraction, message) reports where it is ('train' while fitting, 'test' while scoring/writing).
    """
    store = store or get_store()
    panel = build_panel(store.read_prices(region=SERIES_REGION))
    models = live_models()
    shared = {"lightgbm": LightGBMGlobal()}   # global model: one set of boosters serves every vegetable
    rows, champions = [], {}
    names = sorted(panel)
    for index, name in enumerate(names):
        series = panel[name]

        def tick(model_id, _i=index, _n=name):
            if progress:
                progress("train", (_i + 0.5) / max(len(names), 1),
                         f"Fitting {service.MODELS[model_id].name} on {_n} ({_i + 1}/{len(names)})")

        try:
            evals = evaluate(series, models, panel=panel, models=shared, progress=tick)
        except ValueError as exc:   # too little history for a hold-out: skip this vegetable, keep the rest
            print(f"⚠️ Pipeline: skipping {name}: {exc}")
            continue
        best = champion(evals)
        champions[name] = best
        for model_id, ev in evals.items():
            row = ev.training_run(source="pipeline", history_years=None)
            row.update(ingest_run_id=ingest_run_id, is_champion=(model_id == best))
            rows.append(row)
    if progress:
        progress("test", 0.95, f"Saving {len(rows)} scores for {len(champions)} vegetables")
    store.write_training_runs(rows)
    service.invalidate()
    return {"commodities": len(champions), "models": models, "training_runs": len(rows), "champions": champions}


def _extract_and_load(store, report) -> Dict:
    """Steps 1-2. Returns {"run_id", "status", "message", counts...}; never raises for USDA problems."""
    last = store.latest_report_date()
    today = date.today()
    start = (last - timedelta(days=6)) if last else today - timedelta(days=730)
    commodities = tracked_commodities(store.unit_hints().keys())
    run_id = store.start_ingest_run("usda:api", start, today)
    if not os.getenv("MARS_API_KEY"):
        message = "No MARS_API_KEY on this server, so no new USDA weeks were fetched; retrained on the stored data."
        store.finish_ingest_run(run_id, "skipped", error=message)
        return {"run_id": run_id, "status": "skipped", "message": message, "fetched": 0, "inserted": 0, "updated": 0}

    def on_commodity(name, index, total):
        report("extract", 0.05 + 0.25 * index / max(total, 1), f"Asking USDA for {name} since {start:%b %-d, %Y} ({index + 1}/{total})")

    try:
        fetched = usda_api.fetch_window(commodities, start, today, hints=store.unit_hints(), progress=on_commodity)
    except requests.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else None
        message = ("USDA rejected the API key (check MARS_API_KEY)." if code in (401, 403)
                   else f"USDA's API returned an error: {exc}")
        store.finish_ingest_run(run_id, "failed", error=message[:500])
        return {"run_id": run_id, "status": "failed", "message": message}
    except requests.RequestException as exc:
        message = f"Couldn't reach USDA's API: {exc}"
        store.finish_ingest_run(run_id, "failed", error=message[:500])
        return {"run_id": run_id, "status": "failed", "message": message}

    frame = fetched["frame"]
    report("load", 0.32, f"Saving {len(frame):,} USDA rows (new weeks are added, corrections replace old copies)")
    inserted, updated = store.upsert_prices(frame, run_id)
    newest = store.latest_report_date()
    empty = fetched["empty_commodities"]
    missing = f" No rows came back for {', '.join(empty)}." if empty else ""
    if inserted or updated:
        status = "succeeded"
        message = f"Added {inserted:,} rows and updated {updated:,} through {newest:%b %-d, %Y}.{missing}"
    else:
        status = "skipped"
        message = f"No new USDA weeks: the newest stored report is still {newest:%b %-d, %Y}.{missing}"
    store.finish_ingest_run(run_id, status, rows_fetched=len(frame), rows_inserted=inserted, rows_updated=updated,
                            error=None if status == "succeeded" else message[:500])
    return {"run_id": run_id, "status": status, "message": message, "fetched": len(frame),
            "inserted": inserted, "updated": updated}


def _run(job_id: str) -> None:
    store = get_store()

    def report(step, progress, message):
        _state.update(step=step, progress=round(float(progress), 3), message=message)

    try:
        with store.exclusive(LOCK_NAME) as got:
            if not got:
                _state.update(state="failed", step=None, finished_at=_now(),
                              message="Another server process is already refreshing the data.")
                return
            report("extract", 0.02, "Looking for the newest stored USDA week")
            loaded = _extract_and_load(store, report)
            if loaded["status"] == "failed":
                _state.update(state="failed", step="extract", finished_at=_now(), message=loaded["message"])
                return
            report("train", 0.35, "Training every model on all stored weeks")
            trained = train_and_test(store, loaded["run_id"], progress=lambda s, f, m: report(s, 0.35 + 0.6 * f, m))
            _state.update(state="succeeded", step="done", progress=1.0, finished_at=_now(),
                          message=f"{loaded['message']} Scored {len(trained['models'])} models on "
                                  f"{trained['commodities']} vegetables.")
    except Exception as exc:   # the status page must always end, never spin
        traceback.print_exc()
        _state.update(state="failed", finished_at=_now(), message=f"Refresh failed: {exc}"[:500])


def start() -> Dict:
    """Start a refresh in a background thread. Raises Busy if one is running in this process."""
    global _thread
    with _start_guard:
        if _thread is not None and _thread.is_alive():
            raise Busy("A data refresh is already running. Try again when it finishes.")
        job_id = str(uuid.uuid4())
        _state.update(state="running", step="extract", progress=0.0, message="Starting", job_id=job_id,
                      started_at=_now(), finished_at=None)
        _thread = threading.Thread(target=_run, args=(job_id,), name="pipeline-refresh", daemon=True)
        _thread.start()
    return {"job_id": job_id, "state": "running"}


def wait(timeout: Optional[float] = None) -> None:
    """Block until the current refresh ends (tests and scripts)."""
    if _thread is not None:
        _thread.join(timeout)


def status() -> Dict:
    store = get_store()
    return {**_state.snapshot(), "store": store.summary(), "last_run": store.last_ingest_run(),
            "usda_api_configured": bool(os.getenv("MARS_API_KEY"))}


def runs(limit: int = 20, offset: int = 0) -> Dict:
    items, total = get_store().list_ingest_runs(limit, offset)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


def prepare_store() -> Dict:
    """Startup housekeeping: close runs a crashed process left 'running', seed an empty store, drop stale previews,
    and score the models once if the store has never been trained (so the leaderboard isn't empty)."""
    from store.seed import seed_if_empty
    store = get_store()
    report = {"stale_runs_failed": store.fail_stale_runs(), "seed": seed_if_empty(store),
              "previews_pruned": store.prune_previews()}
    if os.getenv("PIPELINE_TRAIN_ON_STARTUP", "1") == "1" and not store.has_training_runs():
        with store.exclusive(LOCK_NAME) as got:
            if got and not store.has_training_runs():
                report["trained"] = train_and_test(store)
    return report
