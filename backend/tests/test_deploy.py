"""The Vercel deployment (vercel.json, api/) stays in step with the backend it serves."""

import json
import re
from pathlib import Path

from fastapi.routing import APIRoute

import main

ROOT = Path(__file__).resolve().parents[2]


def pins(path: Path) -> dict:
    found = {}
    for line in path.read_text().splitlines():
        match = re.match(r"^([A-Za-z0-9_.\-\[\]]+)==(\S+)", line.strip())
        if match:
            found[match.group(1).lower()] = match.group(2)
    return found


def test_vercel_installs_the_backends_versions():
    backend, vercel = pins(ROOT / "backend" / "requirements.txt"), pins(ROOT / "api" / "requirements.txt")
    backend.pop("uvicorn")  # Vercel serves the ASGI app itself
    assert {name: vercel.get(name) for name in backend} == backend


def test_vercel_routes_the_api_and_the_weekly_refresh_to_the_function():
    config = json.loads((ROOT / "vercel.json").read_text())
    assert (ROOT / "api" / "index.py").exists() and "api/index.py" in config["functions"]
    assert config["functions"]["api/index.py"]["maxDuration"] >= 120  # a full refresh takes about 70 s
    assert {"source": "/api/(.*)", "destination": "/api/index"} in config["rewrites"]
    paths = {route.path for route in main.app.routes if isinstance(route, APIRoute)}
    for cron in config["crons"]:
        assert cron["path"].startswith("/api/") and cron["path"][len("/api"):] in paths


def test_the_function_bundle_keeps_the_data_it_reads():
    excluded = json.loads((ROOT / "vercel.json").read_text())["functions"]["api/index.py"]["excludeFiles"]
    for needed in ("usda_commodity.csv", "ingredient_storage_data.csv", "Example_Train.csv"):
        assert (ROOT / needed).exists() and needed not in excluded
    assert len(excluded) <= 256  # Vercel rejects a longer excludeFiles pattern
