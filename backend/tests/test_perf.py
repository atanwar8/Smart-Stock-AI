"""Performance plumbing: gzip, ETag/304, Cache-Control, CDN headers for the static export, server-side caches
that follow the data version, no N+1 forecast work, and paging."""

import os

os.environ["PRETRAIN_MODELS"] = "0"
os.environ["SEED_DEMO_INVENTORY"] = "1"
os.environ["REFRESH_ON_STARTUP"] = "0"

import threading
import time

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import main
from core import forecaster_utils as fu
from core.forecaster import XGBoostLightGBMForecaster


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def flat_prices(price, weeks=120, commodity="Tomatoes"):
    """USDA-shaped rows: two regions per weekly report, all in one unit."""
    dates = pd.date_range("2020-01-03", periods=weeks, freq="7D")
    noise = np.random.default_rng(0).normal(0, 0.01, weeks)
    return pd.DataFrame([{"report_date": d, "commodity": commodity, "unit": "per lb", "region": r,
                          "current_wtd_avg_price": price + n} for d, n in zip(dates, noise) for r in ("National", "West")])


# ---------- compression ----------

def test_large_json_is_gzipped_and_small_json_is_not(client):
    big = client.get("/api/weather", params={"state": "CA", "zip_code": "90210", "days": 16}, headers={"Accept-Encoding": "gzip"})
    assert big.headers["content-encoding"] == "gzip"
    assert int(big.headers["content-length"]) < len(big.content)  # header is the compressed size on the wire
    assert len(big.json()["forecast"]) == 16

    small = client.get("/api/alerts/settings", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in small.headers


def test_trend_chart_sends_only_what_the_ui_reads(client):
    body = client.get("/api/30-day-trends", params={"commodity": "Tomatoes"}).json()
    assert set(body) == {"data"}
    assert all(set(series) == {"x", "y", "name"} for series in body["data"])


# ---------- HTTP caching ----------

def test_unchanged_data_revalidates_with_a_bodiless_304(client):
    params = {"commodity": "Tomatoes"}
    first = client.get("/api/market-volatility", params=params)
    etag = first.headers["etag"]
    assert etag.startswith('W/"')
    assert first.headers["cache-control"] == f"private, max-age={main.API_MAX_AGE}"

    again = client.get("/api/market-volatility", params=params, headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""
    assert again.headers["etag"] == etag
    assert again.headers["cache-control"] == first.headers["cache-control"]

    assert client.get("/api/market-volatility", params=params, headers={"If-None-Match": 'W/"old"'}).status_code == 200


def test_mutations_errors_and_health_are_never_stored(client):
    post = client.post("/api/inventory/update", json={"ingredient": "Cabbage", "current_stock": 50, "daily_usage": 5, "max_capacity": 100})
    assert post.headers["cache-control"] == "no-store"
    assert "etag" not in post.headers

    health = client.get("/api/health")
    assert health.headers["cache-control"] == "no-store"
    assert "etag" not in health.headers

    missing = client.get("/api/market-volatility", params={"commodity": "Dragonfruit"})
    assert missing.status_code == 404
    assert missing.headers["cache-control"] == "no-store"


def test_editing_stock_changes_the_inventory_etag(client):
    before = client.get("/api/inventory/list")
    assert before.headers["cache-control"] == "private, no-cache"  # always revalidated, never served stale

    client.post("/api/inventory/update", json={"ingredient": "Cucumbers", "current_stock": 33, "daily_usage": 3, "max_capacity": 90})
    after = client.get("/api/inventory/list", headers={"If-None-Match": before.headers["etag"]})

    assert after.status_code == 200
    assert "Cucumbers" in [row["ingredient"] for row in after.json()["inventory"]]


def test_health_is_cheap_for_the_load_balancer(client, monkeypatch):
    def no_pandas(*args, **kwargs):
        raise AssertionError("/health must not parse the training frame")
    monkeypatch.setattr(main.pd, "to_datetime", no_pandas)

    body = client.get("/api/health").json()
    assert body["latest_data_date"] == main.forecaster.latest_report.date().isoformat()
    assert client.head("/health").status_code == 200  # uptime monitors often use HEAD


# ---------- CDN headers for the static export ----------

def test_static_export_is_cdn_cacheable(tmp_path):
    (tmp_path / "_next" / "static" / "chunks").mkdir(parents=True)
    (tmp_path / "_next" / "static" / "chunks" / "app-3f2a1b.js").write_text("console.log('hello');\n" * 200)
    (tmp_path / "index.html").write_text("<html><body>" + "<p>SmartStock</p>" * 200 + "</body></html>")
    (tmp_path / "favicon.ico").write_bytes(b"\0" * 64)

    site = FastAPI()
    main.add_performance_middleware(site)
    site.mount("/", main.CachedStaticFiles(directory=tmp_path, html=True), name="frontend")

    with TestClient(site) as c:
        asset = c.get("/_next/static/chunks/app-3f2a1b.js", headers={"Accept-Encoding": "gzip"})
        assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
        assert asset.headers["content-encoding"] == "gzip"

        page = c.get("/")
        assert page.headers["cache-control"] == "public, max-age=0, must-revalidate"
        revalidated = c.get("/", headers={"If-None-Match": page.headers["etag"]})
        assert revalidated.status_code == 304
        assert revalidated.headers["cache-control"] == "public, max-age=0, must-revalidate"

        assert c.get("/favicon.ico").headers["cache-control"] == main.STATIC_OTHER
        missing = c.get("/_next/static/chunks/gone.js")
        assert missing.status_code == 404
        assert missing.headers["cache-control"] == "no-store"


# ---------- server-side caching ----------

def test_cache_empties_when_the_data_version_changes():
    cache, calls = fu.TTLCache(ttl=60), []

    def compute():
        calls.append(1)
        return len(calls)

    assert cache.get_or_set("v1", "tomatoes", compute) == 1
    assert cache.get_or_set("v1", "tomatoes", compute) == 1  # served from the cache
    assert cache.get_or_set("v2", "tomatoes", compute) == 2  # a refresh means recompute
    assert len(cache) == 1


def test_cache_entries_expire_and_the_oldest_are_dropped():
    now = [1000.0]
    cache = fu.TTLCache(ttl=10, maxsize=2, clock=lambda: now[0])
    cache.get_or_set("v", "a", lambda: "a1")
    now[0] += 11
    assert cache.get_or_set("v", "a", lambda: "a2") == "a2"  # expired

    cache.get_or_set("v", "b", lambda: "b")
    cache.get_or_set("v", "c", lambda: "c")
    assert len(cache) == 2
    assert cache.get_or_set("v", "a", lambda: "a3") == "a3"  # "a" was the least recently used


def test_cache_is_safe_under_concurrent_requests():
    cache, results = fu.TTLCache(ttl=60), []

    def slow():
        time.sleep(0.01)
        return {"price": 2.0}

    threads = [threading.Thread(target=lambda: results.append(cache.get_or_set("v", "k", slow))) for _ in range(16)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(results) == 16 and all(r == {"price": 2.0} for r in results)
    assert len(cache) == 1


def test_replacing_the_training_frame_serves_fresh_forecasts():
    forecaster = XGBoostLightGBMForecaster()
    forecaster.train_data = flat_prices(2.0)
    assert fu.train_model(forecaster, "Tomatoes")["success"]
    old_version = forecaster.data_version
    assert fu.predict_with_model(forecaster, "Tomatoes", 7, None)["predictions"][0] == pytest.approx(2.0, abs=0.1)

    forecaster.train_data = flat_prices(3.0)  # what a USDA refresh does

    assert forecaster.data_version != old_version
    assert fu.weekly_series(forecaster, "Tomatoes").iloc[-1] == pytest.approx(3.0, abs=0.05)
    assert fu.predict_with_model(forecaster, "Tomatoes", 7, None)["predictions"][0] == pytest.approx(3.0, abs=0.15)


def test_cached_forecasts_cannot_be_changed_by_callers():
    forecaster = XGBoostLightGBMForecaster()
    forecaster.train_data = flat_prices(2.0)
    fu.train_model(forecaster, "Tomatoes")
    first = fu.predict_with_model(forecaster, "Tomatoes", 7, None)
    first["predictions"][0] = 999.0
    assert fu.predict_with_model(forecaster, "Tomatoes", 7, None)["predictions"][0] != 999.0


def test_a_data_refresh_changes_what_the_api_returns(client):
    original = main.forecaster.train_data
    try:
        before = client.get("/api/seasonal-patterns", params={"commodity": "Tomatoes"})
        doubled = original.copy()
        doubled["current_wtd_avg_price"] = doubled["current_wtd_avg_price"] * 2
        main.forecaster.train_data = doubled

        after = client.get("/api/seasonal-patterns", params={"commodity": "Tomatoes"}, headers={"If-None-Match": before.headers["etag"]})
        assert after.status_code == 200
        assert after.json()["price_matrix"][0][0] == pytest.approx(2 * before.json()["price_matrix"][0][0])
    finally:
        main.forecaster.train_data = original


# ---------- no N+1 ----------

def test_inventory_and_alerts_share_one_forecast_per_item(client, monkeypatch):
    weather_calls, forecast_runs = [], []
    real_forecast_weeks = fu._forecast_weeks
    monkeypatch.setattr(main.forecaster, "get_weather_data", lambda *a, **k: weather_calls.append(a) or {})
    monkeypatch.setattr(fu, "_forecast_weeks", lambda *a, **k: forecast_runs.append(1) or real_forecast_weeks(*a, **k))
    main.forecaster.cache.clear()

    client.get("/api/inventory/list")
    first_page = len(forecast_runs)
    client.get("/api/inventory/list")
    client.get("/api/alerts/recent")

    assert first_page >= 1
    assert len(forecast_runs) == first_page  # the second list and the alerts reuse the memo
    assert weather_calls == []  # price trends don't need weather


# ---------- pagination ----------

def test_alerts_and_inventory_page_with_limit_and_offset(client):
    everything = client.get("/api/alerts/recent", params={"limit": 100}).json()
    total = everything["total"]
    assert total == len(everything["alerts"]) >= 1  # at least the "Price Data" system alert

    first = client.get("/api/alerts/recent", params={"limit": 1}).json()
    assert (len(first["alerts"]), first["total"], first["total_count"]) == (1, total, 1)
    assert first["alerts"][0] == everything["alerts"][0]
    assert client.get("/api/alerts/recent", params={"offset": total}).json()["alerts"] == []

    default = client.get("/api/alerts/recent").json()
    assert default["limit"] == 8 and len(default["alerts"]) == min(8, total)

    rows = client.get("/api/inventory/list").json()
    assert rows["total"] == len(rows["inventory"])  # no limit means everything, as before
    window = client.get("/api/inventory/list", params={"limit": 2, "offset": 1}).json()
    assert [r["id"] for r in window["inventory"]] == [r["id"] for r in rows["inventory"]][1:3]

    assert client.get("/api/alerts/recent", params={"limit": 0}).status_code == 422
