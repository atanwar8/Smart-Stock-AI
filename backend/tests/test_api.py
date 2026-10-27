"""API smoke tests against the real training data (models train on demand, no background pretraining)."""

import os

os.environ["PRETRAIN_MODELS"] = "0"
os.environ["SEED_DEMO_INVENTORY"] = "1"
os.environ["REFRESH_ON_STARTUP"] = "0"

import time
from datetime import date

import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def test_health_answers_with_and_without_api_prefix(client):
    for path in ("/health", "/api/health"):
        body = client.get(path).json()
        assert body["forecaster_ready"] is True
        assert body["training_rows"] > 0


def test_commodities_lists_the_trained_vegetables(client):
    assert "Tomatoes" in client.get("/api/commodities").json()["viable_commodities"]


def test_seven_day_prediction_returns_a_price_per_day(client):
    body = client.get("/api/7-day-prediction", params={"commodity": "Tomatoes"}).json()
    prices = [p["price"] for p in body["predictions"]]
    assert len(prices) == 7
    assert all(p > 0 for p in prices)


def test_trend_chart_shows_one_actual_price_per_week(client):
    body = client.get("/api/30-day-trends", params={"commodity": "Tomatoes"}).json()
    actual = next(t for t in body["data"] if t["name"] == "Actual Price")
    assert actual["x"] == sorted(set(actual["x"]))


def test_logged_stock_shows_up_in_the_inventory(client):
    client.post("/api/inventory/update", json={"ingredient": "Cabbage", "current_stock": 50, "daily_usage": 5, "max_capacity": 100})
    names = [row["ingredient"] for row in client.get("/api/inventory/list").json()["inventory"]]
    assert "Cabbage" in names


def test_unknown_commodity_is_an_error_not_a_crash(client):
    assert client.get("/api/7-day-prediction", params={"commodity": "Dragonfruit"}).status_code >= 400


def test_alerts_flag_running_out_and_spoilage_but_not_healthy_stock(client):
    client.post("/api/inventory/update", json={"ingredient": "Tomatoes", "current_stock": 4, "daily_usage": 8, "max_capacity": 100})
    client.post("/api/inventory/update", json={"ingredient": "Lettuce", "current_stock": 90, "daily_usage": 6, "max_capacity": 120})
    client.post("/api/inventory/update", json={"ingredient": "Carrots", "current_stock": 50, "daily_usage": 10, "max_capacity": 200})

    alerts = client.get("/api/alerts/recent").json()["alerts"]
    kinds = {(a["commodity"], a["title"]) for a in alerts}

    assert ("Tomatoes", "Critical Stock Alert") in kinds       # half a day of cover
    assert ("Lettuce", "Spoilage Warning") in kinds            # 15 days of stock, keeps about a week
    assert not any(c == "Carrots" and t in ("Critical Stock Alert", "Spoilage Warning") for c, t in kinds)


def test_commodities_report_the_unit_prices_are_quoted_in(client):
    units = client.get("/api/commodities").json()["units"]
    assert units["Tomatoes"] == "per lb"
    assert units["Lettuce"] == "each"


def test_refresh_without_an_api_key_explains_how_to_get_one(client, monkeypatch):
    monkeypatch.delenv("MARS_API_KEY", raising=False)
    body = client.post("/api/scrape-and-train").json()
    assert body["success"] is False
    assert "MARS_API_KEY" in body["error"]


def test_refresh_that_adds_no_rows_is_reported_honestly(client, monkeypatch):
    monkeypatch.setattr(main.usda_api, "refresh_training_data",
                        lambda *a, **k: {"rows_added": 0, "latest": "2025-07-25", "empty_commodities": ["Lettuce"]})
    body = client.post("/api/scrape-and-train").json()
    assert body["success"] is False
    assert "no new rows" in body["error"] and "Lettuce" in body["error"]


def test_refresh_that_adds_rows_retrains_the_models(client, monkeypatch):
    monkeypatch.setattr(main.usda_api, "refresh_training_data",
                        lambda *a, **k: {"rows_added": 42, "latest": "2026-10-23", "empty_commodities": []})
    body = client.post("/api/scrape-and-train").json()
    assert body["success"] is True
    assert "Added 42 new rows through 2026-10-23" in body["message"]
    assert client.get("/api/health").json()["models_trained"] == 10


def test_server_pulls_usda_data_when_it_starts(monkeypatch):
    # Render's disk resets on every restart, so a server with a key fetches new weeks at boot
    calls = []
    monkeypatch.setenv("MARS_API_KEY", "test-key")
    monkeypatch.setenv("REFRESH_ON_STARTUP", "1")
    monkeypatch.setattr(main.usda_api, "refresh_training_data",
                        lambda *a, **k: calls.append(a) or {"rows_added": 0, "latest": date.today().isoformat(), "empty_commodities": []})

    with TestClient(main.app) as c:
        for _ in range(100):
            if calls and not c.get("/api/health").json()["data_refresh_running"]:
                break
            time.sleep(0.05)

    assert len(calls) == 1
