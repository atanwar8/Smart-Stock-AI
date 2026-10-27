"""API smoke tests against the real training data (models train on demand, no background pretraining)."""

import os

os.environ["PRETRAIN_MODELS"] = "0"
os.environ["SEED_DEMO_INVENTORY"] = "1"

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


def test_refresh_that_adds_no_rows_is_reported_honestly(client, monkeypatch):
    # The scraper "succeeds" (exit 0) without writing anything, as it did against today's USDA site
    finished = type("Finished", (), {"returncode": 0, "stdout": "no reports found", "stderr": ""})()
    monkeypatch.setattr(main.subprocess, "run", lambda *args, **kwargs: finished)

    body = client.post("/api/scrape-and-train").json()

    assert body["success"] is False
    assert "no new rows" in body["error"]
