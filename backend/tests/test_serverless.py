"""Train once, read everywhere: the dashboard reads the pipeline's stored forecasts, and the refresh works on Vercel."""

import os

os.environ["PRETRAIN_MODELS"] = "0"
os.environ["REFRESH_ON_STARTUP"] = "0"

from datetime import datetime, timedelta, timezone

import pytest
import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy import update

import main
from ml import pipeline, service
from ml.backtest import STORE_VERSION
from routers import forecast as forecast_router
from store import open_store, set_store
from store.schema import ingest_runs
from store.seed import seed_if_empty

STORED_PRICE = 9.0  # far from any real tomato price, so a forecast that used it can only come from the stored run


def stored_run(series, model, champion=False, mae=0.2, price=STORED_PRICE):
    last = series.dates[-1].date().isoformat()
    return {"commodity": series.commodity, "unit": series.unit, "model": model, "train_start": series.dates[0].date().isoformat(),
            "train_end": last, "test_start": last, "test_end": last, "n_train": len(series), "n_test": 8,
            "metrics": {"mae": mae, "rmse": mae * 1.2, "mase": 0.9, "coverage": 0.8, "skill": 0.1},
            "params": {"version": STORE_VERSION, "future": [price] * 8}, "is_champion": champion}


@pytest.fixture(scope="module")
def store(tmp_path_factory):
    store = open_store(sqlite_path=tmp_path_factory.mktemp("serverless") / "store.db")
    seed_if_empty(store)
    set_store(store)
    service._memo.clear()
    tomatoes = service.panel()["Tomatoes"]
    store.write_training_runs([stored_run(tomatoes, "ets", champion=True), stored_run(tomatoes, "naive", mae=0.25)])
    service._memo.clear()
    yield store
    set_store(None)
    service._memo.clear()


def test_dashboard_forecasts_read_the_stored_champion_instead_of_training(store):
    with TestClient(main.app) as client:
        body = client.get("/api/7-day-prediction", params={"commodity": "Tomatoes"}).json()
        model = main.forecaster.models["Tomatoes"]
        assert model["type"] == "Pipeline forecast" and model["model_id"] == "ets"
        # Day 7 is the first stored week; the days before it are interpolated from the latest real price
        assert body["predictions"][-1]["price"] == pytest.approx(STORED_PRICE)
        # The history the dashboard charts is the store's (seeded two years), not the bundled 2010+ CSV
        assert client.get("/api/health").json()["training_rows"] == store.price_count()
        # Skill is measured against the stored naive model's hold-out error
        details = client.get("/api/dashboard/kpi").json()["forecast_accuracy"]["accuracy_details"]["Tomatoes"]
        assert details["skill_pct"] == pytest.approx((1 - 0.2 / 0.25) * 100)


def test_commodities_without_a_stored_run_still_train(store):
    with TestClient(main.app) as client:
        client.get("/api/7-day-prediction", params={"commodity": "Lettuce"})
        assert main.forecaster.models["Lettuce"]["type"] != "Pipeline forecast"


def test_refresh_runs_inside_the_request_on_serverless(store, monkeypatch):
    monkeypatch.setattr(forecast_router, "SERVERLESS", True)
    monkeypatch.setattr(pipeline, "run_now", lambda: {"state": "succeeded", "job_id": "j"})
    monkeypatch.setattr(pipeline, "start", lambda: pytest.fail("no background thread on serverless"))
    with TestClient(main.app) as client:
        response = client.post("/api/pipeline/refresh")
        assert response.status_code == 200 and response.json()["state"] == "succeeded"


def test_status_shows_a_refresh_running_in_another_instance_until_it_is_stale(store):
    run_id = store.start_ingest_run("usda:api")
    try:
        assert pipeline.status()["state"] == "running"
        # A row left 'running' by an instance Vercel stopped at its time limit no longer counts
        with store.engine.begin() as conn:
            conn.execute(update(ingest_runs).where(ingest_runs.c.id == run_id)
                         .values(started_at=datetime.now(timezone.utc) - timedelta(hours=2)))
        assert pipeline.status()["state"] != "running"
    finally:
        store.finish_ingest_run(run_id, "failed", error="test")


def test_an_applied_studio_forecast_drives_ordering_and_the_overview(store):
    # "Apply prediction" promises that ordering plans with it: the applied model (theta, not the champion ets)
    # and the chef's pace (+10%) carry into the dashboard's daily forecast
    tomatoes = service.panel()["Tomatoes"]
    store.write_training_runs([stored_run(tomatoes, "theta", mae=0.3, price=7.0)])
    service._memo.clear()
    next_week = (tomatoes.dates[-1] + pd.Timedelta(days=7)).date().isoformat()
    preview_id = store.insert_forecast({
        "commodity": "Tomatoes", "unit": tomatoes.unit, "model": "theta", "horizon_weeks": 1, "confidence": 0.8,
        "history_years": None, "pace_pct": 10, "points": [{"date": next_week, "yhat": 7.7, "lo": 7.0, "hi": 8.4}],
        "metrics": {}, "summary": "test"})
    store.apply_forecast(preview_id)
    with TestClient(main.app) as client:
        body = client.get("/api/7-day-prediction", params={"commodity": "Tomatoes"}).json()
        model = main.forecaster.models["Tomatoes"]
        assert model["applied"] and model["model_id"] == "theta"
        assert body["predictions"][-1]["price"] == pytest.approx(7.7)
        # Beyond the applied week, the theta path continues at the same pace
        assert model["weekly_path"][1:] == pytest.approx([7.7] * 7)
