#!/usr/bin/env python3
"""
SmartStock AI - Forecaster Utilities
Additional methods for the forecaster class
"""

import copy
import os
import threading
import time
from collections import OrderedDict
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, Hashable, List

import numpy as np
import pandas as pd
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

# LightGBM needs OpenMP (libgomp in Docker, `brew install libomp` on macOS); without it we use a random forest
try:
    import lightgbm as lgb
    LIGHTGBM_AVAILABLE = True
except Exception:
    LIGHTGBM_AVAILABLE = False
    lgb = None


LAGS = (1, 2, 3, 4, 8, 13, 52)  # in weeks; USDA retail reports are weekly
WEEK = pd.Timedelta(days=7)
BAND_Z = 1.28  # ~80% band around the forecast

# Derived data only changes when the training frame or a model changes; the TTL is a safety net on top of that
CACHE_TTL_SECONDS = float(os.getenv('CACHE_TTL_SECONDS', 15 * 60))


class TTLCache:
    """Small thread-safe memo for derived data (weekly series, forecasts, chart payloads).

    Every entry belongs to one data version: asking with a different version empties the cache, so a USDA refresh
    or a reload of the training frame can never serve numbers computed from the old data. Entries also expire after
    `ttl` seconds, and the least recently used are dropped beyond `maxsize`.
    """

    def __init__(self, ttl: float = CACHE_TTL_SECONDS, maxsize: int = 512, clock: Callable[[], float] = time.monotonic):
        self.ttl, self.maxsize, self._clock = ttl, maxsize, clock
        self._lock = threading.Lock()
        self._entries: "OrderedDict[Hashable, tuple]" = OrderedDict()  # key -> (stored_at, value)
        self._version: Hashable = None
        self.hits = self.misses = 0

    def get_or_set(self, version: Hashable, key: Hashable, compute: Callable[[], Any]) -> Any:
        with self._lock:
            if version != self._version:
                self._entries.clear()
                self._version = version
            entry = self._entries.get(key)
            if entry is not None and self._clock() - entry[0] < self.ttl:
                self._entries.move_to_end(key)
                self.hits += 1
                return entry[1]
            self.misses += 1
        # Computed outside the lock so one slow forecast doesn't hold up requests for other items
        value = compute()
        with self._lock:
            if version == self._version:  # the data may have been replaced while we computed
                self._entries[key] = (self._clock(), value)
                self._entries.move_to_end(key)
                while len(self._entries) > self.maxsize:
                    self._entries.popitem(last=False)
        return value

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        return len(self._entries)


def cached(forecaster, key: Hashable, compute: Callable[[], Any]) -> Any:
    """Memoize `compute` for the forecaster's current data version (plain call for objects without a cache)."""
    cache = getattr(forecaster, 'cache', None)
    if cache is None:
        return compute()
    return cache.get_or_set(getattr(forecaster, 'data_version', None), key, compute)


def model_token(model_info: Dict) -> tuple:
    """Identifies one trained model, so a retrain invalidates forecasts made by the previous one."""
    return (model_info.get('type'), model_info.get('trained_at'), id(model_info.get('model')))


def weekly_prices(train_data: pd.DataFrame, commodity: str) -> pd.Series:
    """One average price per weekly report, in the commodity's most common unit.

    The USDA export repeats each week once per region, variety and package size
    (e.g. tomatoes per lb and per pint), so raw rows are not a time series.
    """
    rows = train_data[train_data['commodity'] == commodity]
    if 'unit' in rows.columns and rows['unit'].notna().any():
        rows = rows[rows['unit'] == rows['unit'].mode().iloc[0]]
    series = rows.groupby(pd.to_datetime(rows['report_date']))['current_wtd_avg_price'].mean()
    return series.dropna().sort_index().rename('price')


def weekly_series(forecaster, commodity: str) -> pd.Series:
    """weekly_prices for the forecaster's current data, built once per data version.

    Returns a copy, so callers can't change the cached series by accident.
    """
    return cached(forecaster, ('weekly', commodity), lambda: weekly_prices(forecaster.train_data, commodity)).copy()


def build_features(series: pd.Series) -> pd.DataFrame:
    """Features for each week's price built only from earlier weeks, so nothing leaks from the target."""
    past = series.shift(1)
    features = pd.DataFrame(index=series.index)
    for lag in LAGS:
        features[f'lag_{lag}'] = series.shift(lag)
    for window in (4, 13):
        features[f'mean_{window}'] = past.rolling(window).mean()
        features[f'std_{window}'] = past.rolling(window).std()
    features['change_4'] = past / series.shift(5) - 1
    week = series.index.isocalendar().week.to_numpy(dtype=float)
    features['week_sin'] = np.sin(2 * np.pi * week / 52)
    features['week_cos'] = np.cos(2 * np.pi * week / 52)
    return features


def _new_model(model_type: str):
    if model_type == 'LightGBM' and LIGHTGBM_AVAILABLE:
        return lgb.LGBMRegressor(n_estimators=100, learning_rate=0.1, max_depth=6, random_state=42, verbose=-1)
    from sklearn.ensemble import RandomForestRegressor
    return RandomForestRegressor(n_estimators=100, max_depth=6, random_state=42)


def train_model(forecaster, commodity: str, weather_data: Dict = None) -> Dict:
    """Train a model that predicts next week's price change from past weeks.

    Accuracy is measured with time-series cross-validation on price levels, next to a
    naive "same as last week" baseline so the score can be judged honestly.
    """
    if forecaster.train_data is None:
        raise ValueError("Training data not loaded")

    series = weekly_series(forecaster, commodity)
    features = build_features(series)
    data = features.assign(price=series).dropna()
    if len(data) < 60 or forecaster.model_type == 'Simple':
        return train_simple_model(forecaster, commodity, series, weather_data)

    try:
        X = data[features.columns]
        y = np.log(data['price'] / data['lag_1'])  # next-week log change
        maes, rmses, r2s, naive_maes, residuals = [], [], [], [], []
        for train_idx, val_idx in TimeSeriesSplit(n_splits=3).split(X):
            model = _new_model(forecaster.model_type)
            model.fit(X.iloc[train_idx], y.iloc[train_idx])
            change = model.predict(X.iloc[val_idx])
            actual = data['price'].iloc[val_idx].to_numpy()
            last_week = data['lag_1'].iloc[val_idx].to_numpy()
            predicted = last_week * np.exp(change)
            maes.append(mean_absolute_error(actual, predicted))
            rmses.append(np.sqrt(mean_squared_error(actual, predicted)))
            r2s.append(r2_score(actual, predicted))
            naive_maes.append(mean_absolute_error(actual, last_week))
            residuals.extend(y.iloc[val_idx].to_numpy() - change)

        final_model = _new_model(forecaster.model_type)
        final_model.fit(X, y)

        performance = {
            'mae': float(np.mean(maes)),
            'rmse': float(np.mean(rmses)),
            'r2': float(np.mean(r2s)),
            'naive_mae': float(np.mean(naive_maes)),
        }
        forecaster.feature_names[commodity] = list(X.columns)
        forecaster.models[commodity] = {
            'model': final_model,
            'type': forecaster.model_type,
            'performance': performance,
            'weekly_change_std': float(np.std(residuals)),
            'trained_at': datetime.now()
        }
        forecaster.model_performance[commodity] = performance

        print(f"✅ {commodity} model trained - R²: {performance['r2']:.3f}, MAE: ${performance['mae']:.3f} (naive ${performance['naive_mae']:.3f})")
        return {
            'success': True,
            'model_type': forecaster.model_type,
            'performance': performance,
            'feature_count': len(X.columns)
        }

    except Exception as e:
        print(f"❌ Error training {commodity} model: {e}")
        return train_simple_model(forecaster, commodity, series, weather_data)


def train_simple_model(forecaster, commodity: str, series: pd.Series, weather_data: Dict) -> Dict:
    """Fallback when there's too little history: forecast last week's price, scored as such."""
    if len(series) < 2:
        return {'success': False, 'error': 'Insufficient data'}

    actual, last_week = series.iloc[1:].to_numpy(), series.iloc[:-1].to_numpy()
    performance = {
        'mae': float(mean_absolute_error(actual, last_week)),
        'rmse': float(np.sqrt(mean_squared_error(actual, last_week))),
        'r2': float(r2_score(actual, last_week)) if len(actual) > 1 else 0.0,
    }
    performance['naive_mae'] = performance['mae']
    forecaster.models[commodity] = {
        'model': 'simple',
        'type': 'Simple Model',
        'performance': performance,
        'weekly_change_std': float(np.std(np.diff(np.log(series.to_numpy())))),
        'trained_at': datetime.now()
    }
    forecaster.model_performance[commodity] = performance
    return {'success': True, 'model_type': 'Simple Model', 'performance': performance}


def _forecast_weeks(model, series: pd.Series, weeks: int) -> List[float]:
    """Predict week by week, feeding each prediction back in as history."""
    history = series.copy()
    prices = []
    for _ in range(weeks):
        next_week = history.index[-1] + WEEK
        extended = pd.concat([history, pd.Series([np.nan], index=[next_week])])
        change = model.predict(build_features(extended).iloc[[-1]])[0]
        price = float(history.iloc[-1] * np.exp(change))
        history = pd.concat([history, pd.Series([price], index=[next_week])])
        prices.append(price)
    return prices


def predict_with_model(forecaster, commodity: str, days_ahead: int, weather_data: Dict) -> Dict:
    """Daily price forecast for the next `days_ahead` days after the latest USDA report.

    The forecast is memoized per commodity, horizon, model and data version, so the dashboard, inventory and
    alerts share one computation; only the weather note, which depends on the caller's ZIP, is made per call.
    """
    if commodity not in forecaster.models:
        return {'error': f'No model trained for {commodity}'}
    if forecaster.train_data is None:
        return {'error': 'Training data not available'}

    model_info = forecaster.models[commodity]
    days_ahead = int(days_ahead)
    result = cached(forecaster, ('forecast', commodity, days_ahead, model_token(model_info)),
                    lambda: _daily_forecast(forecaster, commodity, days_ahead, model_info))
    result = copy.deepcopy(result)  # callers may edit their copy; the cached one stays intact
    if 'error' not in result:
        result['weather_impact'] = calculate_weather_impact(commodity, weather_data)
    return result


def _daily_forecast(forecaster, commodity: str, days_ahead: int, model_info: Dict) -> Dict:
    series = weekly_series(forecaster, commodity)
    if series.empty:
        return {'error': f'No data available for {commodity}'}

    weeks = int(np.ceil(days_ahead / 7))
    last_price = float(series.iloc[-1])
    if model_info['type'] == 'Simple Model':
        weekly = [last_price] * weeks
    else:
        weekly = _forecast_weeks(model_info['model'], series, weeks)

    # Weekly forecasts → one price per day, interpolated from the latest report
    days = np.arange(1, days_ahead + 1)
    predictions = np.interp(days, np.arange(0, 7 * weeks + 1, 7), [last_price] + weekly)
    spread = BAND_Z * model_info['weekly_change_std'] * np.sqrt(days / 7)
    last_date = series.index[-1]

    return {
        'commodity': commodity,
        'model_type': model_info['type'],
        'predictions': [float(p) for p in predictions],
        'confidence_upper': [float(p * np.exp(s)) for p, s in zip(predictions, spread)],
        'confidence_lower': [float(p * np.exp(-s)) for p, s in zip(predictions, spread)],
        'dates': [(last_date + timedelta(days=int(d))).strftime('%Y-%m-%d') for d in days],
        'volatility': float(np.std(predictions) / np.mean(predictions)),
        'average_price': float(np.mean(predictions)),
        'weather_impact': None,  # filled in per call by predict_with_model
        'performance': model_info['performance'],
        'feature_importance': get_feature_importance(forecaster, commodity)
    }


def calculate_weather_impact(commodity: str, weather_data: Dict) -> Dict:
    """Calculate detailed weather impact explanation"""
    if not weather_data or 'forecast' not in weather_data:
        return {'impact': 'neutral', 'explanation': 'No weather data available'}
    
    forecast = weather_data['forecast'][:7]  # Look at next 7 days
    
    # Calculate average conditions
    avg_temp = np.mean([day['temp_high'] for day in forecast])
    avg_humidity = np.mean([day['humidity'] for day in forecast])
    
    # Commodity-specific weather sensitivity
    weather_sensitivity = {
        'Tomatoes': {'temp_optimal': (70, 80), 'humidity_optimal': (60, 80)},
        'Lettuce': {'temp_optimal': (60, 70), 'humidity_optimal': (70, 85)},
        'Onions, Green': {'temp_optimal': (65, 75), 'humidity_optimal': (65, 75)},
        'Peppers, Bell Type': {'temp_optimal': (70, 85), 'humidity_optimal': (60, 80)},
        'Carrots': {'temp_optimal': (60, 70), 'humidity_optimal': (65, 80)},
        'Broccoli': {'temp_optimal': (60, 70), 'humidity_optimal': (70, 85)},
        'Cauliflower': {'temp_optimal': (60, 70), 'humidity_optimal': (70, 85)},
        'Cabbage': {'temp_optimal': (60, 70), 'humidity_optimal': (70, 85)},
        'Cucumbers': {'temp_optimal': (70, 80), 'humidity_optimal': (70, 85)},
        'Sweet Potatoes': {'temp_optimal': (75, 85), 'humidity_optimal': (60, 80)},
        'Asparagus': {'temp_optimal': (65, 75), 'humidity_optimal': (70, 85)}
    }
    
    sensitivity = weather_sensitivity.get(commodity, {'temp_optimal': (65, 75), 'humidity_optimal': (65, 80)})
    
    # Calculate impact
    temp_optimal = sensitivity['temp_optimal']
    humidity_optimal = sensitivity['humidity_optimal']
    
    temp_impact = 0
    if avg_temp < temp_optimal[0]:
        temp_impact = -1 * (temp_optimal[0] - avg_temp) / 10
    elif avg_temp > temp_optimal[1]:
        temp_impact = -1 * (avg_temp - temp_optimal[1]) / 10
    
    humidity_impact = 0
    if avg_humidity < humidity_optimal[0]:
        humidity_impact = -1 * (humidity_optimal[0] - avg_humidity) / 20
    elif avg_humidity > humidity_optimal[1]:
        humidity_impact = -1 * (avg_humidity - humidity_optimal[1]) / 20
    
    total_impact = (temp_impact + humidity_impact) / 2
    
    # Determine impact level
    if total_impact > 0.1:
        impact_level = 'positive'
        explanation = f"Favorable weather conditions expected. Temperature averaging {avg_temp:.1f}°F and humidity {avg_humidity:.1f}% are within optimal ranges for {commodity}."
    elif total_impact < -0.1:
        impact_level = 'negative'
        explanation = f"Challenging weather conditions expected. Temperature averaging {avg_temp:.1f}°F and humidity {avg_humidity:.1f}% may stress {commodity} production."
    else:
        impact_level = 'neutral'
        explanation = f"Moderate weather conditions expected. Temperature averaging {avg_temp:.1f}°F and humidity {avg_humidity:.1f}% should have minimal impact on {commodity} prices."
    
    return {
        'impact': impact_level,
        'explanation': explanation,
        'temperature_impact': temp_impact,
        'humidity_impact': humidity_impact,
        'total_impact': total_impact
    }


def get_feature_importance(forecaster, commodity: str) -> Dict:
    """Get feature importance from trained model"""
    if commodity not in forecaster.models:
        return {}
    
    model_info = forecaster.models[commodity]
    
    if model_info['type'] == 'Simple Model':
        return {'trend': 0.6, 'seasonal': 0.4}
    
    try:
        model = model_info['model']
        feature_names = forecaster.feature_names[commodity]
        
        if hasattr(model, 'feature_importances_'):
            importances = model.feature_importances_
            feature_importance = dict(zip(feature_names, importances))
            
            # Sort by importance and return top 10
            sorted_features = sorted(feature_importance.items(), key=lambda x: x[1], reverse=True)
            return dict(sorted_features[:10])
        
        return {}
        
    except Exception as e:
        print(f"Error getting feature importance for {commodity}: {e}")
        return {}
