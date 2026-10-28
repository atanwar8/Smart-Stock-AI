"""Weather: when OpenWeather refuses a request, say why instead of silently showing sample data."""

from core import forecaster as forecaster_module
from core.forecaster import XGBoostLightGBMForecaster


class Rejected:
    status_code = 401
    text = '{"cod":401, "message": "Invalid API key. Please see https://openweathermap.org/faq#error401 for more info."}'


def test_openweather_rejection_is_logged_once_and_falls_back(monkeypatch, capsys):
    monkeypatch.setattr(forecaster_module.requests, "get", lambda *args, **kwargs: Rejected())
    forecaster = XGBoostLightGBMForecaster(weather_api_key="new-key-not-active-yet")
    capsys.readouterr()

    first = forecaster.get_weather_data("CA", "90210", 7)
    forecaster.get_weather_data("CA", "10001", 7)
    logged = capsys.readouterr().out

    assert first["city"].startswith("City-")  # sample weather
    assert logged.count("OpenWeather returned 401") == 1
    assert "Invalid API key" in logged
    assert "new-key-not-active-yet" not in logged
