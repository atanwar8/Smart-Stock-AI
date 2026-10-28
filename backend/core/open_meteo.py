"""Open-Meteo weather client: US ZIP -> place (geocoding API) -> daily forecast (forecast API).

Free for non-commercial use with no API key (under 10,000 calls a day); the data is CC BY 4.0 and the
dashboard credits it. Docs: https://open-meteo.com/en/docs, https://open-meteo.com/en/docs/geocoding-api
"""

from typing import Callable, Dict

import requests

GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
MAX_FORECAST_DAYS = 16

# WMO weather interpretation codes (Open-Meteo docs) -> the condition names the app shows
CONDITIONS = {
    0: 'Clear', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog',
    **dict.fromkeys((51, 53, 55, 56, 57), 'Drizzle'),
    **dict.fromkeys((61, 63, 65, 66, 67), 'Rain'),
    **dict.fromkeys((71, 73, 75, 77), 'Snow'),
    **dict.fromkeys((80, 81, 82), 'Rain Showers'),
    85: 'Snow Showers', 86: 'Snow Showers',
    **dict.fromkeys((95, 96, 97, 99), 'Thunderstorm'),
}

Getter = Callable[..., requests.Response]


class PlaceNotFound(LookupError):
    """Open-Meteo has no US place for this ZIP code."""


def geocode_zip(zip_code: str, get: Getter = None) -> Dict:
    """Name, state and coordinates for a US ZIP code."""
    response = (get or requests.get)(GEOCODING_URL, params={'name': zip_code, 'count': 1, 'countryCode': 'US', 'language': 'en', 'format': 'json'},
                   timeout=10)
    response.raise_for_status()
    results = response.json().get('results') or []
    if not results:
        raise PlaceNotFound(f"No US place found for ZIP {zip_code}")
    place = results[0]
    return {'name': place['name'], 'state': place.get('admin1', ''), 'latitude': place['latitude'], 'longitude': place['longitude']}


def fetch_weather(zip_code: str, days: int = MAX_FORECAST_DAYS, get: Getter = None) -> Dict:
    """Current conditions and up to 16 daily forecasts for a US ZIP, in the app's weather shape (°F, % humidity)."""
    get = get or requests.get  # looked up per call so tests can swap it
    place = geocode_zip(zip_code, get)
    response = get(FORECAST_URL, params={
        'latitude': place['latitude'],
        'longitude': place['longitude'],
        'current': 'temperature_2m,relative_humidity_2m,weather_code',
        'daily': 'weather_code,temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean',
        'temperature_unit': 'fahrenheit',
        'timezone': 'auto',
        'forecast_days': max(1, min(days, MAX_FORECAST_DAYS)),
    }, timeout=10)
    response.raise_for_status()
    data = response.json()
    current, daily = data['current'], data['daily']

    def condition(code):
        return CONDITIONS.get(code, 'Cloudy')

    return {
        'city': place['name'],
        'state': place['state'],
        'zip_code': zip_code,
        'current_temp': current['temperature_2m'],
        'current_humidity': current['relative_humidity_2m'],
        'current_condition': condition(current['weather_code']),
        'forecast': [
            {'date': day, 'temp_high': high, 'temp_low': low,
             'humidity': humidity if humidity is not None else current['relative_humidity_2m'],
             'condition': condition(code)}
            for day, code, high, low, humidity in zip(daily['time'], daily['weather_code'], daily['temperature_2m_max'],
                                                      daily['temperature_2m_min'], daily['relative_humidity_2m_mean'])
        ],
        'source': 'Open-Meteo',
    }
