#!/usr/bin/env python3
"""
SmartStock AI - Core Forecasting Module
Extracted from Streamlit app for API backend
"""

import itertools
import os
import time
import warnings
from datetime import datetime, timedelta
from typing import Dict, Optional

import numpy as np
import pandas as pd
import requests

from core import open_meteo
from core.forecaster_utils import LIGHTGBM_AVAILABLE, TTLCache

WEATHER_CACHE_SECONDS = 30 * 60  # one Open-Meteo fetch per ZIP per half hour
# When Open-Meteo can't answer, keep the sample weather a few minutes instead of retrying (and waiting on
# its timeout) on every request
WEATHER_RETRY_SECONDS = 5 * 60

# Suppress warnings
warnings.filterwarnings('ignore')

print("✅ LightGBM loaded successfully" if LIGHTGBM_AVAILABLE else "⚠️ LightGBM not available (needs OpenMP); using a random forest")

# scikit-learn is the fallback model and provides the metrics
try:
    import sklearn  # noqa: F401
    SKLEARN_AVAILABLE = True
except ImportError as e:
    SKLEARN_AVAILABLE = False
    print(f"❌ Scikit-learn not available: {e}")

# Unique across every forecaster in the process, so two instances can never share a data version
_data_generations = itertools.count(1)


class XGBoostLightGBMForecaster:
    """Forecasting system using LightGBM (random forest fallback) with weather integration.

    The name is historical: XGBoost was dropped as an unused dependency.
    """

    def __init__(self, model_type: str = 'auto'):
        self.models = {}
        self.feature_names = {}
        self.model_performance = {}
        self.cache = TTLCache()  # weekly series, forecasts and chart payloads for the current data version
        self._data_version = 'empty'
        self.latest_report: Optional[pd.Timestamp] = None
        self.train_data = None
        self.viable_commodities = []
        self.commodity_mapping = {}
        self.weather_cache = {}  # ZIP -> (fetched_at, 16-day Open-Meteo weather)
        self._fallback_weather = {}  # (ZIP, state) -> (made_at, sample weather) while Open-Meteo is unreachable
        self._weather_errors_logged = set()  # (ZIP, error) pairs already reported

        # LightGBM when it loads, otherwise scikit-learn's random forest
        if model_type in ('auto', 'LightGBM') and LIGHTGBM_AVAILABLE:
            self.model_type = 'LightGBM'
        elif SKLEARN_AVAILABLE:
            self.model_type = 'RandomForest'
        else:
            self.model_type = 'Simple'

        print(f"🤖 Forecaster initialized with {self.model_type} model")

    @property
    def train_data(self) -> Optional[pd.DataFrame]:
        return self._train_data

    @train_data.setter
    def train_data(self, frame: Optional[pd.DataFrame]) -> None:
        """Replacing the training frame (load, USDA refresh, tests) starts a new data version, which empties every cache."""
        self._train_data = frame
        latest = None
        if frame is not None and 'report_date' in frame.columns and len(frame):
            try:
                latest = pd.to_datetime(frame['report_date']).max()
            except (ValueError, TypeError):
                latest = None
        self.latest_report = latest
        rows = 0 if frame is None else len(frame)
        latest_s = latest.date().isoformat() if latest is not None and not pd.isna(latest) else '-'
        self._data_version = f"{next(_data_generations)}:{rows}:{latest_s}"

    @property
    def data_version(self) -> str:
        """Changes whenever the training frame is replaced: '<generation>:<rows>:<latest report date>'."""
        return self._data_version

    def invalidate_caches(self) -> None:
        """For code that edits train_data in place: start a new data version so nothing stale is served."""
        self.train_data = self._train_data
    
    def load_commodity_mapping(self):
        """Load commodity mapping from usda_commodity.csv file"""
        try:
            # Try to load from the CSV file
            csv_path = os.path.join(os.path.dirname(__file__), '../../usda_commodity.csv')
            if os.path.exists(csv_path):
                commodity_df = pd.read_csv(csv_path)
                
                # Create mapping from USDA names to display names
                self.commodity_mapping = dict(zip(
                    commodity_df['usda_commodity'].str.strip(), 
                    commodity_df['app_name'].str.strip()
                ))
                
                print(f"✅ Loaded {len(self.commodity_mapping)} commodities from usda_commodity.csv")
                
            else:
                print("⚠️ usda_commodity.csv not found, using fallback mapping")
                self._load_fallback_mapping()
                
        except Exception as e:
            print(f"⚠️ Error loading commodity mapping: {e}")
            self._load_fallback_mapping()
    
    def _load_fallback_mapping(self):
        """Fallback commodity mapping if CSV file is not available"""
        # Only include commodities that actually exist in the training data
        self.commodity_mapping = {
            'Asparagus': 'Asparagus',
            'Broccoli': 'Broccoli', 
            'Cabbage': 'Cabbage',
            'Carrots': 'Carrots',
            'Cauliflower': 'Cauliflower',
            'Cucumbers': 'Cucumbers',
            'Lettuce': 'Lettuce',
            'Onions, Green': 'Green Onions',
            'Peppers, Bell Type': 'Bell Peppers', 
            'Sweet Potatoes': 'Sweet Potatoes',
            'Tomatoes': 'Tomatoes'
        }
    
    def load_training_data(self, train_path: str):
        """Load training data from the bundled USDA export (used when the training store has no rows)"""
        try:
            frame = pd.read_csv(train_path)
        except Exception as e:
            print(f"❌ Error loading data: {e}")
            return False
        return self.load_training_frame(frame)

    def load_training_frame(self, frame: pd.DataFrame):
        """Use these USDA rows (CSV columns) as the price history, e.g. the training store's rows"""
        try:
            frame = frame.copy()
            frame['report_date'] = pd.to_datetime(frame['report_date'])
            self.train_data = frame  # assigned once, fully parsed, so the new data version sees the final frame
            # Models fitted (or adopted) on the previous history would forecast from stale prices
            self.models.clear()
            self.model_performance.clear()

            # Get commodities that have sufficient data
            commodity_counts = self.train_data['commodity'].value_counts()
            commodities_with_data = commodity_counts[commodity_counts >= 50].index.tolist()
            
            # Filter to only include commodities that are in our mapping
            # This ensures we only expose commodities that are in usda_commodity.csv
            self.viable_commodities = [
                commodity for commodity in commodities_with_data 
                if commodity in self.commodity_mapping
            ]
            
            print(f"✅ Loaded training data: {len(self.train_data)} records")
            print(f"📊 Commodities with sufficient data: {len(commodities_with_data)}")
            print(f"🎯 Viable commodities (in mapping): {len(self.viable_commodities)}")
            print(f"📋 Viable commodities: {self.viable_commodities}")
            
            return True
            
        except Exception as e:
            print(f"❌ Error loading data: {e}")
            return False
    
    def get_weather_data(self, state: str, zip_code: str, days: int = 30) -> Dict:
        """Weather for a US ZIP from Open-Meteo (no key needed); sample data only if it can't be fetched"""
        cached = self.weather_cache.get(zip_code)
        if cached and time.time() - cached[0] < WEATHER_CACHE_SECONDS:
            weather = cached[1]
        else:
            fallback = self._fallback_weather.get((zip_code, state))
            if fallback and time.time() - fallback[0] < WEATHER_RETRY_SECONDS and len(fallback[1]['forecast']) >= days:
                # Same sample weather for a few minutes: steady numbers on screen, no repeated Open-Meteo timeouts
                return {**fallback[1], 'forecast': fallback[1]['forecast'][:days]}
            try:
                weather = open_meteo.fetch_weather(zip_code)
            except (requests.RequestException, open_meteo.PlaceNotFound, KeyError, ValueError) as e:
                if (zip_code, str(e)) not in self._weather_errors_logged:
                    self._weather_errors_logged.add((zip_code, str(e)))
                    print(f"⚠️ Live weather unavailable for ZIP {zip_code}: {e}. Using sample weather.")
                sample = self._generate_synthetic_weather(state, zip_code, max(days, open_meteo.MAX_FORECAST_DAYS))
                self._fallback_weather[(zip_code, state)] = (time.time(), sample)
                return {**sample, 'forecast': sample['forecast'][:days]}
            self.weather_cache[zip_code] = (time.time(), weather)

        # One 16-day fetch serves every length: trim shorter requests, extend longer ones by trend
        if days <= len(weather['forecast']):
            return {**weather, 'forecast': weather['forecast'][:days]}
        return self._extend_weather_forecast({**weather, 'forecast': list(weather['forecast'])}, days)
    
    def _generate_synthetic_weather(self, state: str, zip_code: str, days: int) -> Dict:
        """Generate realistic synthetic weather data"""
        # State-based temperature ranges
        state_temps = {
            'CA': (65, 75), 'FL': (75, 85), 'TX': (70, 80), 'NY': (55, 70),
            'IL': (50, 70), 'PA': (55, 70), 'OH': (55, 70), 'GA': (65, 80),
            'NC': (60, 75), 'MI': (50, 65), 'NJ': (55, 70), 'VA': (60, 75),
            'WA': (55, 65), 'AZ': (75, 90), 'MA': (50, 65), 'TN': (60, 75)
        }
        
        temp_range = state_temps.get(state.upper(), (60, 75))
        base_temp = np.random.uniform(temp_range[0], temp_range[1])
        
        # Generate weather data
        dates = [datetime.now() + timedelta(days=i) for i in range(days)]
        temps = []
        humidity = []
        conditions = []
        
        for i, date in enumerate(dates):
            # Seasonal adjustment
            day_of_year = date.timetuple().tm_yday
            seasonal_factor = np.sin(2 * np.pi * day_of_year / 365) * 10
            
            # Daily temperature variation
            daily_temp = base_temp + seasonal_factor + np.random.normal(0, 5)
            temps.append(max(20, min(100, daily_temp)))
            
            # Humidity
            daily_humidity = 80 - (daily_temp - 60) * 0.5 + np.random.normal(0, 10)
            humidity.append(max(20, min(95, daily_humidity)))
            
            # Weather conditions
            if np.random.random() < 0.7:
                conditions.append('Clear')
            elif np.random.random() < 0.5:
                conditions.append('Partly Cloudy')
            else:
                conditions.append('Cloudy')
        
        return {
            'city': f'City-{zip_code}',
            'state': state,
            'zip_code': zip_code,
            'current_temp': temps[0],
            'current_humidity': humidity[0],
            'current_condition': conditions[0],
            'forecast': [
                {
                    'date': date.strftime('%Y-%m-%d'),
                    'temp_high': temp + np.random.uniform(0, 5),
                    'temp_low': temp - np.random.uniform(5, 10),
                    'humidity': hum,
                    'condition': cond
                }
                for date, temp, hum, cond in zip(dates, temps, humidity, conditions)
            ]
        }
    
    def _extend_weather_forecast(self, weather_info: Dict, target_days: int) -> Dict:
        """Extend weather forecast using trend analysis"""
        current_forecast = weather_info['forecast']
        
        if len(current_forecast) >= target_days:
            return weather_info
        
        # Calculate trends from existing data
        temps = [day['temp_high'] for day in current_forecast]
        humidity_vals = [day['humidity'] for day in current_forecast]
        
        # Simple linear trend
        temp_trend = (temps[-1] - temps[0]) / len(temps) if len(temps) > 1 else 0
        humidity_trend = (humidity_vals[-1] - humidity_vals[0]) / len(humidity_vals) if len(humidity_vals) > 1 else 0
        
        # Extend forecast
        last_date = datetime.strptime(current_forecast[-1]['date'], '%Y-%m-%d')
        
        for i in range(len(current_forecast), target_days):
            next_date = last_date + timedelta(days=i - len(current_forecast) + 1)
            
            # Project temperature with trend and randomness
            projected_temp = temps[-1] + temp_trend * (i - len(current_forecast) + 1) + np.random.normal(0, 3)
            projected_humidity = humidity_vals[-1] + humidity_trend * (i - len(current_forecast) + 1) + np.random.normal(0, 5)
            
            # Ensure reasonable bounds
            projected_temp = max(20, min(100, projected_temp))
            projected_humidity = max(20, min(95, projected_humidity))
            
            current_forecast.append({
                'date': next_date.strftime('%Y-%m-%d'),
                'temp_high': projected_temp,
                'temp_low': projected_temp - np.random.uniform(5, 10),
                'humidity': projected_humidity,
                'condition': np.random.choice(['Clear', 'Partly Cloudy', 'Cloudy'])
            })
        
        weather_info['forecast'] = current_forecast
        return weather_info
    
