"""Training store: seeding, idempotent upserts that never delete, and the preview -> apply rules (SQLite)."""

import pandas as pd
import pytest

from store import Conflict, NotFound, open_store
from store.seed import seed_if_empty


@pytest.fixture
def store(tmp_path):
    s = open_store(sqlite_path=tmp_path / "store.db")
    yield s
    s.engine.dispose()


def row(date="10/23/2026", commodity="Tomatoes", price=1.99, region="Midwest", unit="per lb", variety="N/A"):
    return {"report_date": date, "region": region, "class": "Vegetables", "commodity": commodity, "variety": variety,
            "organic": "No", "unit": unit, "environment": "N/A", "current_wtd_avg_price": price}


def test_seed_loads_the_last_two_years_once(store):
    first = seed_if_empty(store)
    assert first["seeded"] is True
    summary = store.summary()
    assert summary["rows"] == first["rows"] > 6000
    assert summary["first_date"] == "2023-07-28" and summary["last_date"] == "2025-07-25"
    # A second start must not reload or duplicate anything
    again = seed_if_empty(store)
    assert again["seeded"] is False
    assert store.price_count() == first["rows"]
    runs, total = store.list_ingest_runs()
    assert total == 1 and runs[0]["source"] == "seed:csv" and runs[0]["status"] == "succeeded"


def test_upsert_inserts_new_weeks_updates_corrections_and_is_idempotent(store):
    assert store.upsert_prices(pd.DataFrame([row(), row("10/30/2026")]), None) == (2, 0)
    # Same rows again: nothing changes
    assert store.upsert_prices(pd.DataFrame([row(), row("10/30/2026")]), None) == (0, 0)
    # USDA re-publishes a week with a corrected price: one update, no new row
    assert store.upsert_prices(pd.DataFrame([row(price=2.09)]), None) == (0, 1)
    assert store.price_count() == 2
    prices = store.read_prices()
    assert sorted(prices["price"].round(2)) == [1.99, 2.09]


def test_upsert_never_deletes_rows_missing_from_a_later_extract(store):
    store.upsert_prices(pd.DataFrame([row(), row(commodity="Lettuce", unit="each")]), None)
    store.upsert_prices(pd.DataFrame([row("10/30/2026")]), None)
    assert store.price_count() == 3


def preview(store, commodity="Tomatoes"):
    return store.insert_forecast({"commodity": commodity, "unit": "per lb", "model": "ets", "horizon_weeks": 4,
                                  "confidence": 0.8, "points": [{"date": "2026-11-06", "yhat": 2.0, "lo": 1.8, "hi": 2.2}]})


def test_apply_supersedes_the_previous_applied_forecast(store):
    first, second = preview(store), preview(store)
    assert store.apply_forecast(first)["superseded"] is None
    assert store.apply_forecast(second)["superseded"] == first
    active = store.active_forecasts("Tomatoes")
    assert [f["id"] for f in active] == [second]
    with pytest.raises(Conflict):
        store.apply_forecast(first)
    # Applying the active one again is a harmless no-op
    assert store.apply_forecast(second)["forecast_id"] == second


def test_apply_unknown_preview_is_not_found(store):
    with pytest.raises(NotFound):
        store.apply_forecast("00000000-0000-0000-0000-000000000000")
    with pytest.raises(NotFound):
        store.apply_forecast("not-a-uuid")


def test_one_applied_forecast_per_commodity(store):
    tomatoes, lettuce = preview(store), preview(store, "Lettuce")
    store.apply_forecast(tomatoes)
    store.apply_forecast(lettuce)
    assert {f["commodity"] for f in store.active_forecasts()} == {"Tomatoes", "Lettuce"}
