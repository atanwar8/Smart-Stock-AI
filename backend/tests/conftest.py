import os
import tempfile

# Tests never touch the live Supabase store or USDA, even when backend/.env has real values:
# main.py calls load_dotenv(), which keeps a variable that is already set, so blank them first.
os.environ["SUPABASE_DB_URL"] = ""
os.environ["MARS_API_KEY"] = ""
# ...and never the developer's local store either (backend/var/smartstock.db): every run gets a throwaway file
os.environ["SMARTSTOCK_DB_PATH"] = os.path.join(tempfile.mkdtemp(prefix="smartstock-test-"), "store.db")
# The app's startup seeds and trains the store in a background thread; tests drive the store explicitly
os.environ["PIPELINE_ON_STARTUP"] = "0"
os.environ["ENABLE_TIMESFM"] = "0"

import pytest
import requests


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """Tests never call Open-Meteo or USDA for real; tests that need responses pass recorded ones."""
    def refuse(*args, **kwargs):
        raise requests.ConnectionError("network is disabled in tests")
    monkeypatch.setattr(requests, "get", refuse)
