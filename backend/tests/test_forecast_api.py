"""Forecast Studio API (SPEC §5): catalog, leaderboard, the sample prediction -> Apply flow, and its error codes."""

import os

os.environ["PRETRAIN_MODELS"] = "0"
os.environ["REFRESH_ON_STARTUP"] = "0"

import pytest
from fastapi.testclient import TestClient

import main
from ml import service
from store import open_store, set_store
from store.seed import seed_if_empty


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    store = open_store(sqlite_path=tmp_path_factory.mktemp("studio") / "store.db")
    seed_if_empty(store)
    set_store(store)
    service._memo.clear()
    with TestClient(main.app) as c:
        yield c
    set_store(None)
    service._memo.clear()


def preview(client, **overrides):
    body = {"commodity": "Tomatoes", "model": "ets", "horizon_weeks": 8, "confidence": 0.8, "history_years": 2,
            "pace_pct": 0, **overrides}
    return client.post("/api/forecast/preview", json=body)


def test_models_lists_every_studio_model_and_all_run_live(client):
    body = client.get("/api/forecast/models").json()
    ids = [m["id"] for m in body["models"]]
    assert body["default"] == "ensemble" and ids[0] == "ensemble"
    assert ids == ["ensemble", "lightgbm", "ets", "theta", "seasonal_naive"]
    assert all(m["available"] and m["mode"] == "live" and m["reason"] is None for m in body["models"])


def test_preview_returns_history_backtest_forecast_and_metrics(client):
    response = preview(client)
    assert response.status_code == 200
    body = response.json()
    assert body["unit"] == "per lb" and body["model_name"] == "ETS (damped trend)" and body["mode"] == "live"
    assert len(body["forecast"]) == 8 and len(body["backtest"]) == 8 and len(body["history"]) >= 26
    for point in body["forecast"]:
        assert 0 < point["lo"] <= point["yhat"] <= point["hi"]
    # The forecast starts the week after the last stored week, and history ends at that week
    assert body["forecast"][0]["date"] > body["history"][-1]["date"]
    assert set(body["metrics"]) == {"mae", "mape", "mase", "coverage", "skill"}
    assert body["preview_id"] and "Tomatoes" in body["summary"] and "80% range" in body["summary"]


def test_wider_confidence_widens_the_band_and_pace_moves_the_path(client):
    narrow = preview(client, confidence=0.5).json()["forecast"][-1]
    wide = preview(client, confidence=0.95).json()["forecast"][-1]
    assert wide["hi"] - wide["lo"] > narrow["hi"] - narrow["lo"]
    assert wide["yhat"] == pytest.approx(narrow["yhat"])
    up = preview(client, pace_pct=20).json()["forecast"][-1]
    assert up["yhat"] == pytest.approx(narrow["yhat"] * 1.2, rel=1e-3)


def test_sample_prediction_then_apply_then_supersede(client):
    first = preview(client).json()["preview_id"]
    applied = client.post("/api/forecast/apply", json={"preview_id": first})
    assert applied.status_code == 200
    assert applied.json()["applied"] is True and applied.json()["superseded"] is None

    active = client.get("/api/forecast/active", params={"commodity": "Tomatoes"}).json()["items"]
    assert [a["forecast_id"] for a in active] == [first]
    assert active[0]["params"]["horizon_weeks"] == 8 and len(active[0]["forecast"]) == 8

    second = preview(client, model="theta").json()["preview_id"]
    assert client.post("/api/forecast/apply", json={"preview_id": second}).json()["superseded"] == first
    assert client.post("/api/forecast/apply", json={"preview_id": first}).status_code == 409
    active = client.get("/api/forecast/active").json()["items"]
    assert [a["model"] for a in active if a["commodity"] == "Tomatoes"] == ["theta"]


def test_errors_use_the_contract_status_codes(client):
    assert client.post("/api/forecast/apply", json={"preview_id": "00000000-0000-0000-0000-000000000000"}).status_code == 404
    assert preview(client, commodity="Dragonfruit").status_code == 404
    assert preview(client, model="prophet").status_code == 422
    assert preview(client, model="timesfm").status_code == 422   # removed model: unknown like any other
    assert preview(client, horizon_weeks=27).status_code == 422
    assert preview(client, confidence=0.99).status_code == 422
    assert preview(client, pace_pct=-50).status_code == 422


def test_comma_and_parenthesis_spellings_are_the_same_vegetable(client):
    body = preview(client, commodity="Peppers, Bell Type", horizon_weeks=4).json()
    assert body["commodity"] == "Peppers (Bell Type)"


def test_leaderboard_ranks_models_against_the_seasonal_naive_baseline(client):
    body = client.get("/api/forecast/leaderboard", params={"commodity": "Tomatoes"}).json()
    assert body["test_weeks"] == 8 and body["train_end"] < body["test_start"] <= body["test_end"]
    models = {r["model"]: r for r in body["rows"]}
    assert {"seasonal_naive", "ets", "theta", "lightgbm", "ensemble"} <= set(models)
    assert models["seasonal_naive"]["skill"] == pytest.approx(0.0)
    assert [r["rank"] for r in body["rows"]] == list(range(1, len(body["rows"]) + 1))
    assert body["champion"] == body["rows"][0]["model"]


def test_pipeline_endpoints_answer(client):
    status = client.get("/api/pipeline/status")
    assert status.status_code == 200 and status.headers["cache-control"] == "no-store"
    body = status.json()
    assert body["store"]["rows"] == 6783 and body["usda_api_configured"] is False
    runs = client.get("/api/pipeline/runs", params={"limit": 5}).json()
    assert runs["total"] >= 1 and runs["items"][0]["source"] == "seed:csv"
