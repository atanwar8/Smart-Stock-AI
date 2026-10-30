"""Smart ordering's stock and the alert settings live in the store, so restarts and other instances keep them."""

import os

os.environ["PRETRAIN_MODELS"] = "0"
os.environ["REFRESH_ON_STARTUP"] = "0"

import pytest
from fastapi.testclient import TestClient

import main
from store import open_store, set_store


@pytest.fixture()
def store(tmp_path):
    store = open_store(sqlite_path=tmp_path / "kitchen.db")
    set_store(store)
    main.inventory_manager.inventory_items = {}
    yield store
    set_store(None)


def stock(client):
    """{vegetable: stock} from the list the dashboard shows ("55.0 lbs" -> 55.0)."""
    rows = client.get("/api/inventory/list").json()["inventory"]
    return {i["ingredient"]: float(i["current_stock"].split()[0]) for i in rows}


def log(client, ingredient, current_stock, daily_usage=5, max_capacity=100):
    response = client.post("/api/inventory/update", json={"ingredient": ingredient, "current_stock": current_stock,
                                                         "daily_usage": daily_usage, "max_capacity": max_capacity})
    assert response.status_code == 200


def test_logged_stock_survives_a_restart_and_is_never_replaced_by_the_demo(store):
    with TestClient(main.app) as client:
        assert set(stock(client)) == {"Tomatoes", "Lettuce", "Carrots", "Broccoli"}   # demo seeded once, empty store
        log(client, "Tomatoes", 55)
    # A new server instance (or a Vercel cold start) has nothing in memory
    main.inventory_manager.inventory_items = {}
    with TestClient(main.app) as client:
        assert stock(client)["Tomatoes"] == 55          # read back from the store, not re-seeded to 22
    assert {r["ingredient"]: r["current_stock"] for r in store.inventory_rows()}["Tomatoes"] == 55


def test_another_instances_change_is_seen_on_the_next_read(store):
    with TestClient(main.app) as client:
        stock(client)
        # Another instance writes straight to the store
        store.save_inventory({"ingredient": "Carrots", "current_stock": 7, "daily_usage": 1, "max_capacity": 200,
                              "unit": "lbs"})
        assert stock(client)["Carrots"] == 7


def test_a_fifth_vegetable_pushes_the_oldest_out_of_the_store_too(store):
    with TestClient(main.app) as client:
        log(client, "Cucumbers", 12)
        names = set(stock(client))
    assert "Cucumbers" in names and len(names) == 4
    assert {r["ingredient"] for r in store.inventory_rows()} == names


def test_confirmed_orders_add_to_the_stored_stock(store):
    with TestClient(main.app) as client:
        before = stock(client)["Lettuce"]
        response = client.post("/api/inventory/confirm-order",
                               json={"ingredient": "Lettuce", "quantity": 10, "price_per_unit": 2.5})
        assert response.status_code == 200
    main.inventory_manager.inventory_items = {}
    with TestClient(main.app) as client:
        assert stock(client)["Lettuce"] == before + 10


def test_alert_settings_survive_a_restart(store):
    with TestClient(main.app) as client:
        settings = client.get("/api/alerts/settings").json()
        settings.update(low_stock_threshold=4, price_change_alert=7.5)
        assert client.post("/api/alerts/settings", json=settings).status_code == 200
    main.alert_manager.settings = main.AlertSettings()          # a fresh instance starts from the defaults
    with TestClient(main.app) as client:
        saved = client.get("/api/alerts/settings").json()
    assert saved["low_stock_threshold"] == 4 and saved["price_change_alert"] == 7.5
