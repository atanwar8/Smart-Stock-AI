import pytest
import requests


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """Tests never call Open-Meteo or USDA for real; tests that need responses pass recorded ones."""
    def refuse(*args, **kwargs):
        raise requests.ConnectionError("network is disabled in tests")
    monkeypatch.setattr(requests, "get", refuse)
