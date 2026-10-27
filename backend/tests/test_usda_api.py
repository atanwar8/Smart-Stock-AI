"""USDA MyMarketNews API client: request shape, field mapping, paging and appending to the training CSV."""

from datetime import date
from urllib.parse import unquote

import pandas as pd
import pytest

from core import usda_api


def detail_row(commodity="Tomatoes", end="10/23/2026", region="Midwest", price=1.99, **extra):
    """A row shaped like report 3324 "Report Details" (field names as USDA returns them)."""
    row = {
        "report_begin_date": "10/17/2026", "report_end_date": end, "published_date": "10/23/2026 13:21:02",
        "community": "Vegetables", "commodity": commodity, "variety": "N/A", "region": region, "size": "per lb",
        "organic": "No", "environment": "N/A", "store_count": 120, "wtd_avg_price": price,
        "prior_WK_store_count": 98, "prior_WK_wtd_avg_price": 2.09, "prior_YR_store_count": None, "prior_YR_wtd_avg_price": None,
        "slug_id": 3324, "final_ind": "Final",
    }
    row.update(extra)
    return row


class FakeResponse:
    def __init__(self, rows):
        self.rows = rows

    def raise_for_status(self):
        pass

    def json(self):
        return {"reportSection": "Report Details", "stats": {}, "results": self.rows}


def test_rows_map_to_the_training_csv_columns():
    frame = usda_api.to_frame([detail_row()])

    assert list(frame.columns) == usda_api.COLUMNS
    row = frame.iloc[0]
    assert row["report_date"] == "10/23/2026"  # the Friday the report week ends, like the existing data
    assert row["class"] == "Vegetables" and row["unit"] == "per lb"
    assert row["current_wtd_avg_price"] == 1.99 and row["current_ad_count"] == 120
    assert row["priorwk_wtd_avg_price"] == 2.09


def test_request_uses_basic_auth_and_keeps_commas_inside_commodity_names():
    calls = []

    def fake_get(url, auth, timeout):
        calls.append((url, auth))
        return FakeResponse([detail_row("Onions, Green")])

    usda_api.fetch_commodity("KEY", "Onions, Green", date(2026, 10, 1), date(2026, 10, 27), get=fake_get)

    url, auth = calls[0]
    assert auth == ("KEY", "")
    assert "/reports/3324/Report%20Details?q=" in url
    query = url.split("?q=", 1)[1]
    assert "Onions%2C%20Green" in query                # the comma is part of the name, not a list separator
    assert unquote(query) == "commodity=Onions, Green;report_begin_date=10/01/2026:10/27/2026"


def test_a_full_page_is_split_into_smaller_date_ranges():
    ranges = []

    def fake_get(url, auth, timeout):
        dates = unquote(url).split("report_begin_date=")[1]
        ranges.append(dates)
        return FakeResponse([detail_row()] * (usda_api.PAGE_SIZE if len(ranges) == 1 else 3))

    rows = usda_api.fetch_commodity("KEY", "Tomatoes", date(2026, 1, 1), date(2026, 6, 30), get=fake_get)

    assert len(ranges) == 3  # the first answer was a full page, so it was retried as two halves
    assert len(rows) == 6


def test_refresh_without_a_key_says_what_to_set(tmp_path, monkeypatch):
    monkeypatch.delenv("MARS_API_KEY", raising=False)
    with pytest.raises(usda_api.MissingApiKey):
        usda_api.refresh_training_data(tmp_path / "train.csv", ["Tomatoes"])


def test_refresh_appends_only_new_weeks_and_keeps_the_fresh_copy(tmp_path):
    train = tmp_path / "train.csv"
    old = usda_api.to_frame([detail_row(end="10/16/2026", price=1.50)])
    old.to_csv(train, index=False)

    def fake_get(url, auth, timeout):
        # USDA re-sends last week (corrected price) plus one new week
        return FakeResponse([detail_row(end="10/16/2026", price=1.55), detail_row(end="10/23/2026", price=1.99)])

    result = usda_api.refresh_training_data(train, ["Tomatoes"], api_key="KEY", today=date(2026, 10, 27), get=fake_get)

    saved = pd.read_csv(train)
    assert result["rows_added"] == 1
    assert result["latest"] == "2026-10-23"
    assert sorted(saved["current_wtd_avg_price"]) == [1.55, 1.99]  # the corrected price replaced the stored one


def test_commodities_with_no_rows_are_reported(tmp_path):
    train = tmp_path / "train.csv"
    usda_api.to_frame([detail_row(end="10/16/2026")]).to_csv(train, index=False)

    def fake_get(url, auth, timeout):
        return FakeResponse([detail_row(end="10/23/2026")] if "Tomatoes" in url else [])

    result = usda_api.refresh_training_data(train, ["Tomatoes", "Lettuce"], api_key="KEY", today=date(2026, 10, 27), get=fake_get)

    assert result["empty_commodities"] == ["Lettuce"]
