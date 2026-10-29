import os

# Tests never touch the live Supabase store or USDA, even when backend/.env has real values:
# main.py calls load_dotenv(), which keeps a variable that is already set, so blank them first.
os.environ["SUPABASE_DB_URL"] = ""
os.environ["MARS_API_KEY"] = ""

import pytest
import requests


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """Tests never call Open-Meteo or USDA for real; tests that need responses pass recorded ones."""
    def refuse(*args, **kwargs):
        raise requests.ConnectionError("network is disabled in tests")
    monkeypatch.setattr(requests, "get", refuse)
