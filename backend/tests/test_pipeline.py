"""The incremental refresh: only new weeks are requested, rows are appended (never replaced wholesale), re-runs add
nothing, missing keys and USDA errors are recorded instead of crashing, and training covers every stored week."""

import time
from datetime import date, timedelta

import pandas as pd
import pytest
import requests

from core import usda_api
from ml import pipeline, service
from store import open_store, set_store
from store.seed import seed_if_empty

FAST_MODELS = ["naive", "seasonal_naive", "ets"]


@pytest.fixture
def store(tmp_path, monkeypatch):
    s = open_store(sqlite_path=tmp_path / "store.db")
    seed_if_empty(s)
    set_store(s)
    service._memo.clear()
    # Backtesting every model on every vegetable takes ~1 min; the fast ones exercise the same code path
    monkeypatch.setattr(pipeline, "live_models", lambda: list(FAST_MODELS))
    yield s
    set_store(None)
    service._memo.clear()


def usda_frame(weeks, start=date(2025, 8, 1), price=2.0):
    rows = [{"report_end_date": (start + timedelta(weeks=i)).strftime("%m/%d/%Y"), "region": "Midwest",
             "community": "Vegetables", "commodity": "Tomatoes", "variety": "N/A", "organic": "No", "size": "per lb",
             "environment": "N/A", "wtd_avg_price": price + 0.01 * i, "store_count": 100} for i in range(weeks)]
    return usda_api.to_frame(rows)


def run_refresh():
    pipeline.start()
    pipeline.wait(300)
    return pipeline.status()


def test_without_a_key_the_run_is_skipped_and_models_still_train(store, monkeypatch):
    monkeypatch.delenv("MARS_API_KEY", raising=False)
    status = run_refresh()
    assert status["state"] == "succeeded"
    assert status["last_run"]["status"] == "skipped"
    assert "MARS_API_KEY" in status["last_run"]["error"]
    assert store.has_training_runs()
    assert status["store"]["rows"] == 6783  # nothing touched


def test_refresh_asks_only_for_weeks_after_the_newest_stored_one_and_appends(store, monkeypatch):
    monkeypatch.setenv("MARS_API_KEY", "test-key")
    asked = {}

    def fake_fetch(commodities, start, end, hints=None, progress=None, **_):
        asked.update(commodities=list(commodities), start=start, end=end, hints=hints)
        return {"frame": usda_frame(10), "empty_commodities": []}

    monkeypatch.setattr(usda_api, "fetch_window", fake_fetch)
    before = store.price_count()
    status = run_refresh()

    assert status["state"] == "succeeded", status["message"]
    # Window starts one report week before the newest stored week (2025-07-25), so corrections are picked up
    assert asked["start"] == date(2025, 7, 19) and asked["end"] == date.today()
    assert "Tomatoes" in asked["commodities"] and "Onions, Green" in asked["commodities"]
    assert asked["hints"]["Onions, Green"]["unit"]   # comma names need their unit for the USDA lookup
    run = status["last_run"]
    assert run["status"] == "succeeded" and run["rows_inserted"] == 10 and run["rows_updated"] == 0
    assert store.price_count() == before + 10
    assert status["store"]["last_date"] == (date(2025, 8, 1) + timedelta(weeks=9)).isoformat()
    assert status["store"]["first_date"] == "2023-07-28"   # the seed is never dropped

    # Same extract again: no duplicates, recorded as skipped
    status = run_refresh()
    assert status["last_run"]["status"] == "skipped"
    assert store.price_count() == before + 10

    # Training used the expanding window: the newest training run ends at the newest stored Tomatoes week
    latest = store.latest_training_runs("Tomatoes")["Tomatoes"]
    assert latest["ets"]["test_end"] == status["store"]["last_date"]
    assert latest["ets"]["train_start"] <= "2023-08-04"


def test_training_stores_forecasts_so_previews_never_fit_a_model(store, monkeypatch):
    monkeypatch.delenv("MARS_API_KEY", raising=False)
    assert pipeline.needs_training(store)
    run_refresh()
    assert not pipeline.needs_training(store)
    run = store.latest_training_runs("Tomatoes")["Tomatoes"]["ets"]
    assert run["params"]["version"] == 2 and len(run["params"]["future"]) == 8

    # With stored runs, a preview reads them: fitting or backtesting now would be a bug
    def refuse(*args, **kwargs):
        raise AssertionError("a preview fitted or tested a model")
    monkeypatch.setattr(service, "forecast_path", refuse)
    monkeypatch.setattr(service, "evaluate", refuse)
    body = service.preview("Tomatoes", "ets", horizon_weeks=8)
    assert [p["yhat"] for p in body["forecast"]] == pytest.approx(run["params"]["future"], rel=1e-6)


def test_startup_waits_for_a_busy_training_lock_instead_of_skipping(store, monkeypatch):
    """On a deploy the old instance holds the lock until it is stopped; the new one must train after that."""
    import threading
    monkeypatch.setattr(pipeline, "LOCK_RETRY_SECONDS", 0.05)
    assert store._local_lock.acquire(blocking=False)   # "another process" is training
    result = {}
    worker = threading.Thread(target=lambda: result.update(pipeline.prepare_store()))
    worker.start()
    try:
        time.sleep(0.3)
        assert worker.is_alive() and service.TRAINING.is_set()   # waiting, and previews say "being trained"
    finally:
        store._local_lock.release()                     # the old instance stops
    worker.join(300)
    assert "trained" in result and not pipeline.needs_training(store)
    assert not service.TRAINING.is_set()


def test_usda_rejecting_the_key_fails_the_run_without_touching_data(store, monkeypatch):
    monkeypatch.setenv("MARS_API_KEY", "bad-key")

    def rejected(*args, **kwargs):
        response = requests.Response()
        response.status_code = 401
        raise requests.HTTPError("401 Unauthorized", response=response)

    monkeypatch.setattr(usda_api, "fetch_window", rejected)
    status = run_refresh()
    assert status["state"] == "failed"
    assert "rejected the API key" in status["message"]
    assert status["last_run"]["status"] == "failed"
    assert store.price_count() == 6783


def test_only_one_refresh_at_a_time(store, monkeypatch):
    monkeypatch.delenv("MARS_API_KEY", raising=False)
    pipeline.start()
    try:
        with pytest.raises(pipeline.Busy):
            pipeline.start()
    finally:
        pipeline.wait(300)


def test_fetch_window_requests_each_commodity_over_the_window():
    calls = []

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"results": []}

    def fake_get(url, auth, timeout):
        calls.append(url)
        return Response()

    result = usda_api.fetch_window(["Tomatoes", "Onions, Green"], date(2025, 7, 19), date(2025, 8, 1),
                                   hints={"Onions, Green": {"unit": "per bunch", "community": "Vegetables"}},
                                   api_key="KEY", get=fake_get)
    assert len(calls) == 2
    assert result["empty_commodities"] == ["Tomatoes", "Onions, Green"]
    assert isinstance(result["frame"], pd.DataFrame) and result["frame"].empty
    with pytest.raises(usda_api.MissingApiKey):
        usda_api.fetch_window(["Tomatoes"], date(2025, 7, 19), date(2025, 8, 1), api_key="")
