"""Weather from Open-Meteo: ZIP lookup, forecast mapping, caching, and an honest fallback."""

import requests

from core import open_meteo
from core.forecaster import XGBoostLightGBMForecaster

# Trimmed from real Open-Meteo responses for ZIP 90210 (2026-10-28)
GEOCODE_90210 = {"results": [{"name": "Beverly Hills", "latitude": 34.07362, "longitude": -118.40036,
                              "country_code": "US", "admin1": "California", "postcodes": ["90210"]}]}
FORECAST = {
    "current": {"time": "2026-10-28T15:15", "temperature_2m": 73.0, "relative_humidity_2m": 59, "weather_code": 0},
    "daily": {
        "time": ["2026-10-28", "2026-10-29", "2026-10-30"],
        "weather_code": [3, 61, 95],
        "temperature_2m_max": [75.6, 67.1, 70.2],
        "temperature_2m_min": [58.6, 60.0, 57.4],
        "relative_humidity_2m_mean": [72, 79, None],
    },
}


class Reply:
    def __init__(self, body, status=200):
        self.body, self.status_code = body, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} error")

    def json(self):
        return self.body


def fake_open_meteo(calls, geocode=GEOCODE_90210):
    def get(url, params, timeout):
        calls.append((url, params))
        return Reply(geocode if "geocoding" in url else FORECAST)
    return get


def test_zip_is_looked_up_in_the_us_and_forecast_requested_in_fahrenheit():
    calls = []
    open_meteo.fetch_weather("90210", 16, get=fake_open_meteo(calls))

    (geo_url, geo), (fc_url, fc) = calls
    assert geo_url == open_meteo.GEOCODING_URL and geo["name"] == "90210" and geo["countryCode"] == "US"
    assert fc_url == open_meteo.FORECAST_URL
    assert (fc["latitude"], fc["longitude"]) == (34.07362, -118.40036)
    assert fc["temperature_unit"] == "fahrenheit" and fc["forecast_days"] == 16


def test_forecast_maps_to_the_weather_shape_the_app_uses():
    weather = open_meteo.fetch_weather("90210", 16, get=fake_open_meteo([]))

    assert (weather["city"], weather["state"], weather["zip_code"]) == ("Beverly Hills", "California", "90210")
    assert (weather["current_temp"], weather["current_humidity"], weather["current_condition"]) == (73.0, 59, "Clear")
    assert [d["condition"] for d in weather["forecast"]] == ["Cloudy", "Rain", "Thunderstorm"]
    assert weather["forecast"][0] == {"date": "2026-10-28", "temp_high": 75.6, "temp_low": 58.6, "humidity": 72, "condition": "Cloudy"}
    assert weather["forecast"][2]["humidity"] == 59  # missing daily humidity falls back to the current reading


def test_one_fetch_per_zip_serves_every_forecast_length(monkeypatch):
    calls = []
    monkeypatch.setattr(open_meteo.requests, "get", fake_open_meteo(calls))
    forecaster = XGBoostLightGBMForecaster()

    seven = forecaster.get_weather_data("CA", "90210", 2)
    thirty = forecaster.get_weather_data("CA", "90210", 30)

    assert len(calls) == 2  # one geocode + one forecast, then cached
    assert len(seven["forecast"]) == 2 and len(thirty["forecast"]) == 30
    assert seven["city"] == "Beverly Hills"


def test_unknown_zip_falls_back_to_sample_weather_and_says_why(monkeypatch, capsys):
    monkeypatch.setattr(open_meteo.requests, "get", fake_open_meteo([], geocode={"generationtime_ms": 0.2}))
    forecaster = XGBoostLightGBMForecaster()
    capsys.readouterr()

    first = forecaster.get_weather_data("CA", "00000", 7)
    forecaster.get_weather_data("CA", "00000", 7)
    logged = capsys.readouterr().out

    assert first["city"].startswith("City-")  # sample weather
    assert logged.count("No US place found for ZIP 00000") == 1


def test_while_open_meteo_is_down_sample_weather_is_reused_instead_of_retrying(monkeypatch):
    calls = []

    def down(url, params, timeout):
        calls.append(url)
        raise requests.ConnectionError("Open-Meteo is down")

    monkeypatch.setattr(open_meteo.requests, "get", down)
    forecaster = XGBoostLightGBMForecaster()

    week = forecaster.get_weather_data("CA", "90210", 7)
    three_days = forecaster.get_weather_data("CA", "90210", 3)

    assert len(calls) == 1  # no second wait on a timeout within the retry window
    assert three_days["forecast"] == week["forecast"][:3]  # steady numbers, so the response's ETag holds
    assert three_days["current_temp"] == week["current_temp"]
