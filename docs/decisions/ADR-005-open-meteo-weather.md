# ADR-005: Get weather from Open-Meteo instead of OpenWeather

## Status
Accepted

## Date
2026-10-28

## Context
Weather showed sample data for most of the project's life. OpenWeather needs a personal API key; the original key was committed to the public repo and had to be deleted, and a newly created one was rejected with 401 "Invalid API key" while it activated. Every failure fell back to sample weather, so the dashboard rarely showed real conditions.

The project already uses Open-Meteo elsewhere. Its documentation states:

- no API key for non-commercial use (under 10,000 calls a day, 5,000 an hour, 600 a minute);
- a geocoding API that accepts a "location name or postal code" and returns coordinates, place name and state;
- daily forecasts "up to 16 days" (OpenWeather's free tier gives 5);
- data licensed CC BY 4.0.

## Decision
`backend/core/open_meteo.py` looks up the ZIP (US only), fetches current conditions plus a 16-day daily forecast in °F, and maps WMO weather codes to plain names. The forecaster caches one fetch per ZIP for 30 minutes and serves every requested length from it, trimming shorter requests and extending longer ones by trend as before. If Open-Meteo can't answer (unknown ZIP, network error), the app shows sample weather and logs the reason once per ZIP. Both weather cards credit "Weather data by Open-Meteo.com".

## Alternatives Considered

### Keep OpenWeather
- Rejected: needs a secret per environment, has a shorter free forecast, and the key problems above.

### Self-host Open-Meteo (the GitHub project)
- Rejected: it means downloading and serving weather-model data; the hosted API covers this app's needs.

## Consequences
- No weather key to configure, leak or rotate; `OPENWEATHER_API_KEY` is no longer read.
- Real forecasts cover 16 days instead of 5.
- The free tier is for non-commercial use. If SmartStock became a paid product it would need an Open-Meteo plan (they offer an `apikey` parameter for customers).
- Open-Meteo also keeps historical forecasts, which could later make weather a real model feature (it isn't one today, see ADR-002).
