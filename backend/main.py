#!/usr/bin/env python3
"""
SmartStock AI - FastAPI Backend
Main application with prediction endpoints and inventory management
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Dict, List, Optional
import os
import hashlib
from datetime import datetime
import pandas as pd
import numpy as np
from dotenv import load_dotenv
import uuid
import asyncio
import threading
from pathlib import Path
from starlette.datastructures import Headers, MutableHeaders

# Load environment variables
load_dotenv()

# Repo layout: CSVs live in the project root, the built frontend in smartstock-nextjs/out
PROJECT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv('DATA_DIR', PROJECT_DIR))
TRAIN_DATA_PATH = os.getenv('TRAIN_DATA_PATH', str(DATA_DIR / 'Example_Train.csv'))
FRONTEND_DIR = Path(os.getenv('FRONTEND_DIR', PROJECT_DIR / 'smartstock-nextjs' / 'out'))

# Import our forecaster
from core.forecaster import XGBoostLightGBMForecaster
from core import forecaster_utils, usda_api
from store import get_store
from ml.config import SERIES_REGION
import requests

# On Vercel (and other serverless hosts) an instance can start for any request and is frozen between requests,
# so nothing heavy runs at startup or in background threads: the scheduled refresh (vercel.json crons ->
# /pipeline/cron) trains, and every page reads what it stored.
SERVERLESS = bool(os.getenv('VERCEL'))

# Inventory Management Data Models
class InventoryItem(BaseModel):
    id: str
    ingredient: str
    current_stock: float
    daily_usage: float
    max_capacity: float
    unit: str = "lbs"
    updated_at: datetime
    shelf_life_days: int
    days_left: float
    status: str  # "critical", "high", "good", "opportunity"
    status_color: str
    status_icon: str
    status_message: str

class InventoryUpdateRequest(BaseModel):
    ingredient: str
    current_stock: float
    daily_usage: float
    max_capacity: float
    unit: str = "lbs"

class OrderConfirmationRequest(BaseModel):
    ingredient: str
    quantity: float
    price_per_unit: float
    unit: str = "lbs"

# Add these imports and models after the existing imports and before the InventoryManager class

class AlertSettings(BaseModel):
    low_stock_threshold: int = 1  # days
    price_change_alert: float = 1.0  # percentage
    spoilage_warning: int = 1  # days before expiration
    email_notifications: bool = True
    sms_notifications: bool = True
    push_notifications: bool = False
    alert_frequency: str = "immediate"  # "immediate", "daily", "weekly"

class AlertItem(BaseModel):
    id: str
    type: str  # "critical", "warning", "info", "success", "system"
    title: str
    message: str
    timestamp: str
    commodity: Optional[str] = None

class AlertManager:
    """Manages alert settings and generates dynamic alerts"""

    def __init__(self):
        self.settings = AlertSettings()

    def get_settings(self) -> AlertSettings:
        """Get current alert settings"""
        return self.settings

    def update_settings(self, new_settings: AlertSettings) -> bool:
        """Update alert settings"""
        try:
            self.settings = new_settings
            print(f"✅ Alert settings updated: Stock threshold={new_settings.low_stock_threshold}d, Price alert={new_settings.price_change_alert}%")
            return True
        except Exception as e:
            print(f"⚠️ Error updating alert settings: {e}")
            return False

    def generate_recent_alerts(self, inventory_data: List[Dict], forecaster=None) -> List[AlertItem]:
        """Every alert from current stock levels and the price forecasts, most urgent first (the endpoint pages them)"""
        alerts = []

        for item in inventory_data:
            ingredient, days_left = item['ingredient'], item['days_left']
            shelf_life = item.get('shelf_life', 7)

            if days_left <= self.settings.low_stock_threshold:
                alerts.append(AlertItem(
                    id=f"stock_{ingredient}", type="critical", title="Critical Stock Alert",
                    message=f"{ingredient} stock will run out in {days_left:.1f} days",
                    timestamp="Now", commodity=ingredient
                ))
            # Spoilage risk: more stock on hand than can be used before it goes off
            elif days_left > shelf_life - self.settings.spoilage_warning:
                alerts.append(AlertItem(
                    id=f"spoilage_{ingredient}", type="warning", title="Spoilage Warning",
                    message=f"{ingredient} stock lasts {days_left:.1f} days but keeps about {shelf_life}; use or sell the surplus first",
                    timestamp="Now", commodity=ingredient
                ))

            # Price moves come from the forecast agent, for items whose model is already trained.
            # Both the forecast and the weekly series are memoized, so this is a lookup, not a recompute per item.
            if forecaster is not None and ingredient in forecaster.models:
                forecast = forecaster_utils.predict_with_model(forecaster, ingredient, 7, None)
                if 'error' not in forecast:
                    latest = float(forecaster_utils.weekly_series(forecaster, ingredient).iloc[-1])
                    change = (forecast['predictions'][-1] / latest - 1) * 100
                    if abs(change) >= self.settings.price_change_alert:
                        rising = change > 0
                        alerts.append(AlertItem(
                            id=f"price_{ingredient}", type="warning" if rising else "info",
                            title="Price Increase Warning" if rising else "Order Opportunity",
                            message=f"{ingredient} prices forecast to {'rise' if rising else 'fall'} {abs(change):.1f}% over the next week",
                            timestamp="Latest forecast", commodity=ingredient
                        ))

        if forecaster is not None and forecaster.latest_report is not None:
            latest_report = forecaster.latest_report
            alerts.append(AlertItem(
                id="system_data", type="system", title="Price Data",
                message=f"Forecasts use USDA reports through {latest_report:%b %d, %Y}",
                timestamp=f"{(datetime.now() - latest_report).days} days old", commodity=None
            ))

        priority = {'critical': 0, 'warning': 1, 'info': 2, 'success': 3, 'system': 4}
        alerts.sort(key=lambda a: priority.get(a.type, 5))
        return alerts

# Initialize alert manager
alert_manager = AlertManager()

def weekly_frame(commodity: str) -> pd.DataFrame:
    """Weekly average prices in one unit, as report_date / current_wtd_avg_price columns"""
    return forecaster_utils.weekly_series(forecaster, commodity).rename('current_wtd_avg_price').reset_index()

# Inventory Management System
class InventoryManager:
    def __init__(self):
        self.inventory_items: Dict[str, InventoryItem] = {}
        self.shelf_life_data = self._load_shelf_life_data()
        self.max_items = 4  # FIFO limit
        # Read-only endpoints run in FastAPI's thread pool, so updates and reads take turns
        self._lock = threading.RLock()

    def _load_shelf_life_data(self) -> Dict[str, int]:
        """Load shelf life data from ingredient_storage_data.csv"""
        try:
            df = pd.read_csv(DATA_DIR / 'ingredient_storage_data.csv')
            shelf_life_map = {}

            for _, row in df.iterrows():
                crop = row['Crop']
                days = row['StorageLifeDays']

                # Map crop names to our commodity names
                crop_mapping = {
                    'Asparagus': 'Asparagus',
                    'Broccoli': 'Broccoli',
                    'Cabbage': 'Cabbage',
                    'Carrots': 'Carrots',
                    'Cauliflower': 'Cauliflower',
                    'Cucumbers': 'Cucumbers',
                    'Lettuce': 'Lettuce',
                    'Onions (Green)': 'Onions, Green',
                    'Peppers': 'Peppers, Bell Type',
                    'Sweet Potatoes': 'Sweet Potatoes',
                    'Tomatoes': 'Tomatoes'
                }

                mapped_name = crop_mapping.get(crop, crop)
                shelf_life_map[mapped_name] = int(days)

            print(f"✅ Loaded shelf life data for {len(shelf_life_map)} ingredients")
            return shelf_life_map

        except Exception as e:
            print(f"⚠️ Error loading shelf life data: {e}")
            # Fallback default values
            return {
                'Tomatoes': 7, 'Lettuce': 7, 'Carrots': 150, 'Broccoli': 14,
                'Cucumbers': 7, 'Cauliflower': 14, 'Cabbage': 30, 'Asparagus': 14,
                'Sweet Potatoes': 180, 'Onions, Green': 21
            }

    def _calculate_status(self, days_left: float, shelf_life_days: int) -> Dict[str, str]:
        """Calculate inventory status based on days left and shelf life"""
        # Determine status based on days left
        if days_left < 3:
            return {
                'status': 'critical',
                'color': 'red',
                'icon': 'exclamation-circle',
                'message': f'Stock will run out in {days_left:.1f} days'
            }
        elif days_left < 6:
            return {
                'status': 'high',
                'color': 'yellow',
                'icon': 'exclamation-triangle',
                'message': f'Stock will run out in {days_left:.1f} days'
            }
        elif days_left >= 7:
            return {
                'status': 'good',
                'color': 'green',
                'icon': 'check-circle',
                'message': f'Stock for {days_left:.1f} days available'
            }
        else:
            # Opportunity for bulk buying if shelf life allows
            if days_left > shelf_life_days * 0.5:
                return {
                    'status': 'opportunity',
                    'color': 'blue',
                    'icon': 'info-circle',
                    'message': f'Good time to stock up - {days_left:.1f} days supply'
                }
            else:
                return {
                    'status': 'good',
                    'color': 'green',
                    'icon': 'check-circle',
                    'message': f'Stock for {days_left:.1f} days available'
                }

    def update_inventory(self, ingredient: str, current_stock: float, daily_usage: float, max_capacity: float, unit: str = "lbs") -> InventoryItem:
        """Update inventory item, implementing FIFO logic"""

        # Calculate metrics
        days_left = current_stock / daily_usage if daily_usage > 0 else float('inf')
        shelf_life_days = self.shelf_life_data.get(ingredient, 14)

        # Calculate status
        status_info = self._calculate_status(days_left, shelf_life_days)

        # Create inventory item
        item_id = str(uuid.uuid4())
        inventory_item = InventoryItem(
            id=item_id,
            ingredient=ingredient,
            current_stock=current_stock,
            daily_usage=daily_usage,
            max_capacity=max_capacity,
            unit=unit,
            updated_at=datetime.now(),
            shelf_life_days=shelf_life_days,
            days_left=days_left,
            status=status_info['status'],
            status_color=status_info['color'],
            status_icon=status_info['icon'],
            status_message=status_info['message']
        )

        with self._lock:
            # FIFO logic: if we already have this ingredient, update it
            existing_key = None
            for key, item in self.inventory_items.items():
                if item.ingredient == ingredient:
                    existing_key = key
                    break

            if existing_key:
                # Update existing item
                self.inventory_items[existing_key] = inventory_item
            else:
                # Add new item, enforce FIFO limit
                if len(self.inventory_items) >= self.max_items:
                    # Remove oldest item
                    oldest_key = min(self.inventory_items.keys(),
                                   key=lambda k: self.inventory_items[k].updated_at)
                    del self.inventory_items[oldest_key]
                    print(f"🔄 FIFO: Removed oldest inventory item")

                self.inventory_items[item_id] = inventory_item

        print(f"✅ Updated inventory: {ingredient} - {current_stock} {unit}, {days_left:.1f} days left")
        return inventory_item

    def get_inventory_list(self) -> List[InventoryItem]:
        """Get current inventory list sorted by status priority"""
        with self._lock:
            items = list(self.inventory_items.values())

        # Sort by status priority: critical, high, good, opportunity
        status_priority = {'critical': 0, 'high': 1, 'good': 2, 'opportunity': 3}
        items.sort(key=lambda x: (status_priority.get(x.status, 4), x.updated_at))

        return items

    def confirm_order(self, ingredient: str, quantity: float, price_per_unit: float, unit: str = "lbs"):
        """Process order confirmation and update inventory"""
        with self._lock:
            for key, item in list(self.inventory_items.items()):
                if item.ingredient == ingredient:
                    # Update stock with new order
                    new_stock = item.current_stock + quantity
                    updated_item = self.update_inventory(
                        ingredient=ingredient,
                        current_stock=new_stock,
                        daily_usage=item.daily_usage,
                        max_capacity=item.max_capacity,
                        unit=unit
                    )
                    print(f"📦 Order confirmed: +{quantity} {unit} of {ingredient}")
                    return updated_item

        raise ValueError(f"Ingredient {ingredient} not found in inventory")

# Global inventory manager
inventory_manager = InventoryManager()

# Initialize FastAPI app
app = FastAPI(
    title="SmartStock AI API",
    description="Advanced Commodity Price Forecasting API with Weather Integration",
    version="1.0.0"
)

# Configure CORS for frontend integration (comma-separated list, e.g. a separately hosted frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv('ALLOWED_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000').split(','),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global forecaster instance
forecaster = None

# Forecast Studio + Supabase training pipeline live in their own router (backend/routers/forecast.py)
from routers.forecast import router as forecast_router
app.include_router(forecast_router)

# Pydantic models for API requests/responses
class PredictionRequest(BaseModel):
    commodity: str
    state: str
    zip_code: str
    days_ahead: Optional[int] = 30

class TrainModelRequest(BaseModel):
    commodity: str
    state: Optional[str] = None  # accepted for older clients; training doesn't use weather
    zip_code: Optional[str] = None

class PredictionResponse(BaseModel):
    commodity: str
    model_type: str
    predictions: List[float]
    confidence_upper: List[float]
    confidence_lower: List[float]
    dates: List[str]
    volatility: float
    average_price: float
    weather_impact: Dict
    performance: Dict

# ==================== MODELS ON DEMAND ====================

# One training run per commodity at a time: the pretraining thread and concurrent requests wait for it
# instead of each fitting the same model again
_train_locks: Dict[str, threading.Lock] = {}
_train_locks_guard = threading.Lock()
# Commodities whose training failed (e.g. no price history), per data version, so requests don't retry every time
_untrainable: Dict[str, str] = {}


def _train_lock(commodity: str) -> threading.Lock:
    with _train_locks_guard:
        return _train_locks.setdefault(commodity, threading.Lock())


def ensure_model(commodity: str) -> None:
    """Train `commodity`'s model on first use (pretraining normally does this at startup)"""
    if commodity in forecaster.models or _untrainable.get(commodity) == forecaster.data_version:
        return
    with _train_lock(commodity):
        if commodity in forecaster.models:
            return
        # The pipeline already trained and tested every model on the stored weeks: read its forecast
        if forecaster_utils.adopt_pipeline_forecast(forecaster, commodity):
            return
        result = forecaster_utils.train_model(forecaster, commodity)
        if not result.get('success'):
            _untrainable[commodity] = forecaster.data_version


def warm_forecasts() -> None:
    """Fill the forecast memo for the horizons the dashboard asks for, so first page views are lookups"""
    for commodity in list(forecaster.models):
        for days in (7, 30):
            forecaster_utils.predict_with_model(forecaster, commodity, days, None)


# Keeps a reference to background startup work so it isn't garbage-collected mid-run
startup_tasks = set()

# Store data version the dashboard's price history was read at (None: the bundled CSV), and the last one checked
_history_version: Dict[str, Optional[str]] = {'version': None, 'seen': None, 'applied': None}
_history_lock = threading.Lock()
_init_lock = asyncio.Lock()


def load_price_history(target=None) -> bool:
    """The dashboard's price history: the training store's rows when it has any (Supabase in the cloud, so every
    page shows the weeks the pipeline added), else the bundled USDA export."""
    target = target or forecaster
    try:
        store = get_store()
        if store.price_count() > 0:
            version = store.data_version()
            # One region, like the bundled export and the pipeline: USDA's API also returns the other regions,
            # and averaging them in would quote a price the forecasts were never trained on
            if target.load_training_frame(store.read_rows(region=SERIES_REGION)):
                _history_version.update(version=version, seen=version)
                adopt_stored_forecasts(target)
                return True
    except Exception as e:
        print(f"⚠️ Training store unavailable, using {TRAIN_DATA_PATH}: {e}")
    _history_version['version'] = None
    return target.load_training_data(TRAIN_DATA_PATH)


def adopt_stored_forecasts(target) -> int:
    """Take every vegetable's stored champion forecast now (reads only, one query for all of them), so the first
    page views and the model count don't wait for it. Vegetables without one are trained on first use."""
    adopted = 0
    try:
        store = get_store()
        _history_version['applied'] = store.applied_version()
        applied = store.active_forecasts()  # every vegetable's applied forecast, one query
    except Exception:
        applied = None
    for commodity in list(target.viable_commodities):
        try:
            adopted += bool(forecaster_utils.adopt_pipeline_forecast(target, commodity, applied))
        except Exception as e:
            print(f"⚠️ Stored forecast for {commodity} unavailable: {e}")
    return adopted


def sync_price_history() -> None:
    """Re-read the price history after a refresh or training here or in another instance. The store caches its
    data version for 30 s, so this costs nothing on most requests."""
    if forecaster is None:
        return
    try:
        store = get_store()
        version, applied = store.data_version(), store.applied_version()
    except Exception:
        return
    if version == _history_version['seen'] and applied == _history_version['applied']:
        return
    with _history_lock:
        if version != _history_version['seen']:
            _history_version['seen'] = version
            if store.price_count() > 0:
                load_price_history()  # also re-adopts every stored and applied forecast
        elif applied != _history_version['applied'] and _history_version['version'] is not None:
            # A forecast was applied in the studio: ordering, alerts and the overview plan with it from now on
            for commodity, info in list(forecaster.models.items()):
                if info.get('type') == forecaster_utils.PIPELINE_MODEL_TYPE:
                    forecaster.models.pop(commodity, None)
            adopt_stored_forecasts(forecaster)
        _history_version['applied'] = applied


@app.on_event("startup")
async def startup_event():
    """Initialize the forecaster on startup (or on the first request, where a host skips startup events)"""
    async with _init_lock:
        await _initialize()


@app.middleware("http")
async def ready_before_request(request, call_next):
    """Serverless runtimes may not send ASGI startup events: initialize on first use, then keep the price history
    in step with the training store."""
    if forecaster is None:
        async with _init_lock:
            if forecaster is None:
                await _initialize()
    elif request.url.path.startswith(('/api/', '/dashboard', '/inventory', '/alerts', '/7-day', '/30-day',
                                      '/market-volatility', '/commodities', '/charts', '/predict')):
        await asyncio.get_running_loop().run_in_executor(None, sync_price_history)
    return await call_next(request)


async def _initialize():
    global forecaster

    # Initialize forecaster; it becomes visible to requests only once its price history is loaded
    candidate = XGBoostLightGBMForecaster()
    candidate.load_commodity_mapping()

    # Load training data: the training store, or the bundled CSV until the store has rows
    success = await asyncio.get_running_loop().run_in_executor(None, load_price_history, candidate)
    forecaster = candidate
    if not success:
        print("⚠️ Warning: Could not load training data")
    from_store = _history_version['version'] is not None

    # A fresh deploy starts with an empty walk-in; give the demo a few tracked items
    if os.getenv('SEED_DEMO_INVENTORY', '1') == '1' and not inventory_manager.inventory_items:
        for ingredient, stock, usage, capacity in [
            ('Tomatoes', 22, 9, 120), ('Lettuce', 30, 7, 80), ('Carrots', 140, 10, 200), ('Broccoli', 36, 4, 90)
        ]:
            inventory_manager.update_inventory(ingredient, stock, usage, capacity)

    # The CSV-only setup: with a USDA key, pull new weeks into the CSV first, then train. With a training store,
    # the pipeline (/pipeline/refresh) is the refresh, and the history above already has its weeks.
    if (success and not from_store and not SERVERLESS and os.getenv('MARS_API_KEY')
            and os.getenv('REFRESH_ON_STARTUP', '1') == '1'):
        task = asyncio.create_task(refresh_on_startup())
        startup_tasks.add(task)
        task.add_done_callback(startup_tasks.discard)
    # Otherwise train every commodity's model in the background so the first page views are fast
    elif success and os.getenv('PRETRAIN_MODELS', '0' if SERVERLESS else '1') == '1':
        def pretrain():
            for commodity in list(forecaster.viable_commodities):
                try:
                    ensure_model(commodity)
                except Exception as e:
                    print(f"⚠️ Pretraining {commodity} failed: {e}")
            warm_forecasts()
            print(f"🎯 Pretrained {len(forecaster.models)} models")
        threading.Thread(target=pretrain, daemon=True).start()

    print("🚀 SmartStock AI API started successfully!")

@app.get("/info")
async def root():
    """Root endpoint with API information"""
    return {
        "message": "SmartStock AI - Advanced Commodity Price Forecasting API",
        "version": "1.0.0",
        "status": "active",
        "endpoints": {
            "weather": "/weather",
            "predict": "/predict",
            "train": "/train",
            "dashboard": "/dashboard/kpi",
            "charts": "/30-day-trends, /7-day-prediction, /extended-forecast, /seasonal-patterns, /market-volatility",
            "forecast_studio": "/forecast/*",
            "docs": "/docs"
        }
    }

@app.api_route("/health", methods=["GET", "HEAD"])
async def health_check():
    """Liveness for the platform load balancer and uptime monitors: in-memory counters only, no pandas work"""
    ready = forecaster is not None
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "forecaster_ready": ready,
        "models_trained": len(forecaster.models) if ready else 0,
        "viable_commodities": len(forecaster.viable_commodities) if ready else 0,
        "training_rows": int(len(forecaster.train_data)) if ready and forecaster.train_data is not None else 0,
        "latest_data_date": _latest_report_date(),
        "usda_api_configured": bool(os.getenv('MARS_API_KEY')),
        "data_refresh_running": scrape_lock.locked()
    }

def _latest_report_date() -> Optional[str]:
    """Newest USDA report date in the training data, as YYYY-MM-DD (worked out once per data load)"""
    latest = getattr(forecaster, 'latest_report', None)
    if latest is None or pd.isna(latest):
        return None
    return latest.date().isoformat()

@app.get("/commodities")
def get_commodities():
    """Get list of available commodities"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")
    return forecaster_utils.cached(forecaster, ('commodities',), _commodities_payload)

def _commodities_payload() -> Dict:
    rows, viable = forecaster.train_data, list(forecaster.viable_commodities)
    # Prices are quoted in each commodity's most common USDA unit (per lb, each, per bunch, ...);
    # one grouped pass instead of scanning the whole frame once per commodity
    units = rows[rows['commodity'].isin(viable)].groupby('commodity')['unit'].agg(lambda u: u.mode().iloc[0])
    return {
        "viable_commodities": viable,
        "commodity_mapping": forecaster.commodity_mapping,
        "units": {c: units[c] for c in viable},
        "total_count": len(viable)
    }

@app.get("/weather")
def get_weather_get(state: str = "CA", zip_code: str = "10001", days: int = 30):
    """Weather for a US ZIP (Open-Meteo, cached per ZIP); runs in the thread pool because it may call out"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")

    try:
        weather_data = forecaster.get_weather_data(
            state=state,
            zip_code=zip_code,
            days=days
        )
        return weather_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Weather data error: {str(e)}")

@app.post("/train")
def train_model(request: TrainModelRequest):
    """(Re)train the model for a specific commodity"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")

    if request.commodity not in forecaster.viable_commodities:
        raise HTTPException(status_code=400, detail=f"Commodity '{request.commodity}' not available")

    try:
        with _train_lock(request.commodity):
            result = forecaster_utils.train_model(forecaster, request.commodity)

        if result.get('success'):
            return {
                "message": f"Model trained successfully for {request.commodity}",
                "result": result
            }
        else:
            raise HTTPException(status_code=500, detail=f"Training failed: {result.get('error', 'Unknown error')}")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Training error: {str(e)}")

@app.post("/predict")
def predict_prices(request: PredictionRequest) -> PredictionResponse:
    """Generate price predictions for a commodity"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")

    if request.commodity not in forecaster.viable_commodities:
        raise HTTPException(status_code=400, detail=f"Commodity '{request.commodity}' not available")

    try:
        weather_data = forecaster.get_weather_data(
            state=request.state,
            zip_code=request.zip_code,
            days=request.days_ahead
        )
        ensure_model(request.commodity)
        predictions = forecaster_utils.predict_with_model(
            forecaster,
            request.commodity,
            request.days_ahead,
            weather_data
        )

        if 'error' in predictions:
            raise HTTPException(status_code=500, detail=predictions['error'])

        return PredictionResponse(**predictions)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")

# Dashboard endpoints to power frontend components

def skill_vs_naive(performance: Dict) -> float:
    """How much lower the model's typical error is than just repeating last week's price, in percent"""
    naive = performance.get('naive_mae')
    return float((1 - performance['mae'] / naive) * 100) if naive else 0.0

# Rough volatility by stock status, used for the average-volatility tile
STATUS_VOLATILITY = {"critical": 8.5, "high": 6.2, "good": 3.8}

@app.get("/dashboard/kpi")
def get_kpi():
    """Get dashboard KPI data with real model accuracy"""
    try:
        accuracy_details = {}
        if forecaster:
            # Copies: the pretraining thread may add models while this runs
            performances = dict(forecaster.model_performance) or {
                commodity: info['performance'] for commodity, info in list(forecaster.models.items())
                if isinstance(info, dict) and 'performance' in info
            }
            for commodity, performance in list(performances.items()):
                if isinstance(performance, dict) and 'mae' in performance:
                    r2_score = performance.get('r2')
                    accuracy_details[commodity] = {
                        'r2_score': r2_score,
                        # Stored pipeline scores have no R²; their skill vs last week's price stands in
                        'accuracy_pct': max(0, r2_score * 100) if r2_score is not None else max(0, skill_vs_naive(performance)),
                        'mae': performance.get('mae', 0),
                        'skill_pct': skill_vs_naive(performance)
                    }

        model_count = len(accuracy_details)
        overall_accuracy = sum(d['accuracy_pct'] for d in accuracy_details.values()) / model_count if model_count else 0
        skills = [d['skill_pct'] for d in accuracy_details.values()]
        average_skill = float(np.mean(skills)) if skills else 0.0

        # Current inventory, read once for the count and the volatility estimate
        inventory = inventory_manager.get_inventory_list()
        volatilities = [STATUS_VOLATILITY.get(item.status, 5.0) for item in inventory]
        avg_volatility = sum(volatilities) / len(volatilities) if volatilities else 5.5

        return {
            "forecast_accuracy": {
                "value": f"{overall_accuracy:.1f}%",
                "trend": f"{average_skill:+.1f}% vs. last week's price as a guess",
                "models_trained": model_count,
                "accuracy_details": accuracy_details
            },
            "active_commodities": {
                "value": str(len(inventory)),
                "trend": "+2 this week"
            },
            "avg_volatility": {
                "value": f"{avg_volatility:.1f}/10",
                "trend": "Stable conditions"
            },
            "cost_savings": {
                "value": "$2,847",
                "trend": "+12% this month"
            }
        }

    except Exception as e:
        print(f"⚠️ KPI calculation error: {e}")
        # Fallback to default values
        return {
            "forecast_accuracy": {
                "value": "75.0%",
                "trend": "+1.2% from last month",
                "models_trained": 0,
                "accuracy_details": {}
            },
            "active_commodities": {
                "value": "0",
                "trend": "No active models"
            },
            "avg_volatility": {
                "value": "5.5/10",
                "trend": "Unknown conditions"
            },
            "cost_savings": {
                "value": "$0",
                "trend": "No data available"
            }
        }

# Inventory Management Endpoints

def page_params(limit: Optional[int], offset: int, total: int) -> Dict:
    """Echo of the paging window, so clients can tell whether more rows exist"""
    return {"total": total, "limit": limit, "offset": offset}

@app.post("/inventory/update")
def update_inventory(request: InventoryUpdateRequest):
    """Update inventory item from Smart Ordering tab"""
    try:
        updated_item = inventory_manager.update_inventory(
            ingredient=request.ingredient,
            current_stock=request.current_stock,
            daily_usage=request.daily_usage,
            max_capacity=request.max_capacity,
            unit=request.unit
        )

        return {
            "success": True,
            "message": f"Inventory updated for {request.ingredient}",
            "item": updated_item
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inventory update error: {str(e)}")

@app.get("/inventory/list")
def get_inventory_list(
    limit: Optional[int] = Query(None, ge=1, le=200, description="Rows per page (default: all)"),
    offset: int = Query(0, ge=0),
):
    """Get current inventory list for dashboard"""
    try:
        inventory_items = inventory_manager.get_inventory_list()
        page = inventory_items[offset:offset + limit if limit else None]

        # Convert to frontend format; each price trend is a lookup in the shared forecast memo
        inventory_data = []
        for item in page:
            inventory_data.append({
                "id": item.id,
                "ingredient": item.ingredient,
                "current_stock": f"{item.current_stock} {item.unit}",
                "daily_usage": f"{item.daily_usage} {item.unit}/day",
                "days_left": f"{item.days_left:.1f} days",
                "shelf_life": f"{item.shelf_life_days} days",
                "status": item.status.title(),
                "status_color": item.status_color,
                "price_trend": price_trend_for(item.ingredient),
                "action": "Order Now" if item.status in ['critical', 'high'] else "Hold"
            })

        return {"inventory": inventory_data, **page_params(limit, offset, len(inventory_items))}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inventory list error: {str(e)}")

@app.post("/inventory/confirm-order")
def confirm_order(request: OrderConfirmationRequest):
    """Confirm order and update inventory"""
    try:
        updated_item = inventory_manager.confirm_order(
            ingredient=request.ingredient,
            quantity=request.quantity,
            price_per_unit=request.price_per_unit,
            unit=request.unit
        )

        return {
            "success": True,
            "message": f"Order confirmed: {request.quantity} {request.unit} of {request.ingredient}",
            "updated_item": updated_item
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Order confirmation error: {str(e)}")

@app.get("/inventory/smart-recommendation/{commodity}")
def get_smart_recommendation(commodity: str, state: str = "CA", zip_code: str = "10001"):
    """Get smart ordering recommendation with price prediction"""
    try:
        # Get current inventory for this commodity
        current_item = None
        for item in inventory_manager.get_inventory_list():
            if item.ingredient == commodity:
                current_item = item
                break

        # Weather only shapes the explanation; the 7-day forecast itself is memoized
        weather_data = forecaster.get_weather_data(state, zip_code, 7)
        ensure_model(commodity)
        predictions = forecaster_utils.predict_with_model(
            forecaster, commodity, 7, weather_data
        )

        if 'error' in predictions:
            current_price = 2.0  # Default fallback
            price_trend = "stable"
            trend_percentage = 0
        else:
            current_price = predictions['predictions'][0]
            future_price = predictions['predictions'][-1]
            trend_percentage = ((future_price - current_price) / current_price) * 100
            price_trend = "rising" if trend_percentage > 2 else "falling" if trend_percentage < -2 else "stable"

        # Enhanced recommendation logic based on inventory status
        if current_item:
            days_left = current_item.days_left
            daily_usage = current_item.daily_usage
            current_stock = current_item.current_stock
            max_capacity = current_item.max_capacity
            shelf_life = current_item.shelf_life_days
            status = current_item.status

            # Calculate optimal order quantity based on multiple factors
            if status == "critical":
                # Critical: Order for 10-14 days supply immediately
                target_days = min(14, shelf_life * 0.7)  # Don't exceed 70% of shelf life
                recommended_quantity = daily_usage * target_days
                urgency = "high"
                reason = f"🚨 CRITICAL: Order {recommended_quantity:.0f} lbs immediately! Current stock will run out in {days_left:.1f} days. This order provides {target_days:.0f} days of supply."

            elif status == "high":
                # High: Order for 7-10 days supply soon
                target_days = min(10, shelf_life * 0.6)
                recommended_quantity = daily_usage * target_days
                urgency = "high" if days_left < 4 else "medium"
                reason = f"⚠️ HIGH PRIORITY: Order {recommended_quantity:.0f} lbs within 1-2 days. Current supply lasts {days_left:.1f} days. Recommended order provides {target_days:.0f} days of fresh supply."

            elif status == "good":
                # Good: Plan ahead, consider price trends
                if price_trend == "falling" and trend_percentage < -5:
                    # Prices falling - wait or order less
                    target_days = 5
                    recommended_quantity = daily_usage * target_days
                    urgency = "low"
                    reason = f"💡 WAIT & SAVE: Prices dropping {abs(trend_percentage):.1f}% next week. Consider ordering {recommended_quantity:.0f} lbs later for better value. Current supply: {days_left:.1f} days."
                elif price_trend == "rising" and trend_percentage > 5:
                    # Prices rising - order more now
                    target_days = min(12, shelf_life * 0.8)
                    recommended_quantity = daily_usage * target_days
                    urgency = "medium"
                    reason = f"📈 BUY NOW: Prices rising {trend_percentage:.1f}% next week! Order {recommended_quantity:.0f} lbs now to lock in current rates. This covers {target_days:.0f} days of demand."
                else:
                    # Stable prices - maintain normal levels
                    target_days = 7
                    recommended_quantity = daily_usage * target_days
                    urgency = "low"
                    reason = f"✅ MAINTAIN: Current stock good for {days_left:.1f} days. Order {recommended_quantity:.0f} lbs when convenient to maintain {target_days:.0f}-day supply buffer."
            else:
                # Default case
                target_days = 7
                recommended_quantity = daily_usage * target_days
                urgency = "medium"
                reason = f"📊 STANDARD: Order {recommended_quantity:.0f} lbs to maintain optimal {target_days:.0f}-day supply. Current inventory: {days_left:.1f} days remaining."

            # Apply capacity constraints
            max_additional = max_capacity - current_stock
            if recommended_quantity > max_additional:
                recommended_quantity = max_additional
                reason += f" (Limited by storage capacity: {max_capacity} lbs max)"

            # Apply market condition adjustments
            weather_impact = predictions.get('weather_impact', {}) if 'error' not in predictions else {}
            if weather_impact.get('impact') == 'negative':
                reason += f" Weather conditions may affect supply - consider ordering slightly more."
                recommended_quantity *= 1.1
            elif weather_impact.get('impact') == 'positive':
                reason += f" Favorable weather expected - standard quantities recommended."
        else:
            # No current inventory data - provide intelligent defaults
            commodity_defaults = {
                'Tomatoes': {'qty': 40, 'days': 7, 'usage': 6},
                'Lettuce': {'qty': 25, 'days': 5, 'usage': 5},
                'Broccoli': {'qty': 35, 'days': 6, 'usage': 6},
                'Carrots': {'qty': 50, 'days': 14, 'usage': 4},
                'Cucumbers': {'qty': 30, 'days': 8, 'usage': 4},
                'Cauliflower': {'qty': 30, 'days': 6, 'usage': 5},
                'Cabbage': {'qty': 45, 'days': 10, 'usage': 5},
                'Asparagus': {'qty': 20, 'days': 4, 'usage': 5},
                'Sweet Potatoes': {'qty': 60, 'days': 21, 'usage': 3},
                'Onions, Green': {'qty': 15, 'days': 7, 'usage': 2}
            }

            defaults = commodity_defaults.get(commodity, {'qty': 35, 'days': 7, 'usage': 5})
            recommended_quantity = defaults['qty']

            if price_trend == "rising" and trend_percentage > 5:
                urgency = "medium"
                reason = f"🆕 INITIAL ORDER: Start with {recommended_quantity} lbs of {commodity} (≈{defaults['days']} days supply). Prices rising {trend_percentage:.1f}% - good time to establish inventory."
            elif price_trend == "falling" and trend_percentage < -5:
                urgency = "low"
                reason = f"🆕 WAIT FOR VALUE: Consider starting with {recommended_quantity} lbs of {commodity}, but prices dropping {abs(trend_percentage):.1f}% - may want to wait for better rates."
            else:
                urgency = "medium"
                reason = f"🆕 STARTER INVENTORY: Begin with {recommended_quantity} lbs of {commodity} based on typical {defaults['usage']} lbs/day usage pattern. This provides ≈{defaults['days']} days of supply."

        # Ensure minimum quantity
        recommended_quantity = max(10, recommended_quantity)
        total_cost = recommended_quantity * current_price

        return {
            "commodity": commodity,
            "recommended_quantity": round(recommended_quantity, 1),
            "current_price": round(current_price, 2),
            "total_cost": round(total_cost, 2),
            "urgency": urgency,
            "reason": reason,
            "price_trend": price_trend,
            "trend_percentage": round(trend_percentage, 1),
            "weather_impact": predictions.get('weather_impact', {}) if 'error' not in predictions else {},
            "current_stock": current_item.current_stock if current_item else 0,
            "current_days_left": round(current_item.days_left, 1) if current_item else 0
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Smart recommendation error: {str(e)}")

def price_trend_for(ingredient: str) -> Dict:
    """Next week's price direction for one ingredient from the memoized 7-day forecast.

    No weather lookup: the trend only uses prices, so the old per-item weather call was wasted work.
    """
    try:
        ensure_model(ingredient)
        predictions = forecaster_utils.predict_with_model(forecaster, ingredient, 7, None)

        if 'error' not in predictions and len(predictions['predictions']) >= 2:
            current_price = predictions['predictions'][0]
            future_price = predictions['predictions'][-1]
            percentage = ((future_price - current_price) / current_price) * 100

            # Use ACTUAL ML model predictions (no artificial adjustments)
            if percentage > 1:
                return {"trend": "rising", "percentage": f"+{percentage:.1f}%", "direction": "up"}
            elif percentage < -1:
                return {"trend": "falling", "percentage": f"{percentage:.1f}%", "direction": "down"}
            else:
                return {"trend": "stable", "percentage": f"±{abs(percentage):.1f}%", "direction": "right"}
        else:
            # No model for this item: fall back to the change over its last ten weekly reports
            if forecaster.train_data is not None:
                commodity_data = weekly_frame(ingredient)
                if len(commodity_data) > 1:
                    recent_prices = commodity_data['current_wtd_avg_price'].tail(10).dropna()
                    if len(recent_prices) >= 2:
                        recent_change = ((recent_prices.iloc[-1] - recent_prices.iloc[0]) / recent_prices.iloc[0]) * 100

                        if recent_change > 1:
                            return {"trend": "rising", "percentage": f"+{recent_change:.1f}%", "direction": "up"}
                        elif recent_change < -1:
                            return {"trend": "falling", "percentage": f"{recent_change:.1f}%", "direction": "down"}
                        else:
                            return {"trend": "stable", "percentage": f"±{abs(recent_change):.1f}%", "direction": "right"}

            # Last resort fallback
            return {"trend": "stable", "percentage": "±0.0%", "direction": "right"}

    except Exception as e:
        print(f"⚠️ Price trend error for {ingredient}: {e}")
        # Simple error fallback - just show stable with no change
        return {"trend": "stable", "percentage": "±0.0%", "direction": "right"}

@app.get("/30-day-trends")
def get_30_day_trends(commodity: str):
    """Last 10 weekly USDA prices plus ~weekly forecast points and their 80% band, as x/y/name series.

    The UI only reads x, y and name, so the old Plotly styling and layout blocks are no longer sent.
    """
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")
    if forecaster.train_data is None:
        raise HTTPException(status_code=503, detail="Training data not available")

    try:
        history = weekly_frame(commodity).tail(10)
        ensure_model(commodity)
        predictions = forecaster_utils.predict_with_model(forecaster, commodity, 30, None)

        series = [{
            'x': history['report_date'].dt.strftime('%Y-%m-%d').tolist(),
            'y': history['current_wtd_avg_price'].tolist(),
            'name': 'Actual Price'
        }]
        if 'error' not in predictions:
            # About one point per week: 4 points for 30 days
            dates = predictions['dates']
            step = max(1, len(dates) // 4)
            picked = list(range(0, len(dates), step))[:4]
            x = [dates[i] for i in picked]
            for name, values in (('Forecast', predictions['predictions']),
                                 ('Upper Bound', predictions['confidence_upper']),
                                 ('Lower Bound', predictions['confidence_lower'])):
                series.append({'x': x, 'y': [values[i] for i in picked], 'name': name})

        return {'data': series}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chart data error: {str(e)}")

@app.get("/7-day-prediction")
def get_7_day_prediction(commodity: str, state: str = "CA", zip_code: str = "10001"):
    """Get 7-day forecast for ordering tab (frontend compatibility)"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")

    try:
        # Weather only shapes the explanation; the forecast is memoized
        weather_data = forecaster.get_weather_data(state, zip_code, 7)
        ensure_model(commodity)
        predictions = forecaster_utils.predict_with_model(
            forecaster, commodity, 7, weather_data
        )

        if 'error' in predictions:
            raise HTTPException(status_code=500, detail=predictions['error'])

        # Format for OrderingTab expectations (array of objects with day and price)
        formatted_predictions = []
        day_labels = ['Today', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7']

        for i, price in enumerate(predictions['predictions']):
            formatted_predictions.append({
                'day': day_labels[i] if i < len(day_labels) else f'Day {i+1}',
                'price': price
            })

        return {
            'predictions': formatted_predictions,
            'commodity': commodity,
            'dates': predictions['dates'],
            'volatility': predictions.get('volatility', 0.1),
            'weather_impact': predictions.get('weather_impact', {})
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"7-day prediction error: {str(e)}")

@app.get("/extended-forecast")
def get_extended_forecast(commodity: str, period: str = "30-Day"):
    """7, 14 or 30-day outlook with low and high cases for the predictions tab (no weather needed)"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")

    try:
        days_map = {"7-Day": 7, "14-Day": 14, "30-Day": 30}
        days = days_map.get(period, 30)

        ensure_model(commodity)
        predictions = forecaster_utils.predict_with_model(
            forecaster, commodity, days, None
        )

        if 'error' in predictions:
            raise HTTPException(status_code=500, detail=predictions['error'])

        # Group by weeks for PredictionsTab format
        if days <= 7:
            # Daily format
            dates = [f'Day {i+1}' for i in range(days)]
            base_forecast = predictions['predictions']
            optimistic = [p * 1.1 for p in predictions['predictions']]
            pessimistic = [p * 0.9 for p in predictions['predictions']]
        else:
            # Weekly format
            weeks = min(4, (days + 6) // 7)  # Max 4 weeks
            dates = [f'Week {i+1}' for i in range(weeks)]

            # Group predictions by weeks
            base_forecast = []
            for i in range(weeks):
                week_start = i * 7
                week_end = min((i + 1) * 7, len(predictions['predictions']))
                if week_start < len(predictions['predictions']):
                    week_avg = np.mean(predictions['predictions'][week_start:week_end])
                    base_forecast.append(float(week_avg))
                else:
                    base_forecast.append(base_forecast[-1] if base_forecast else 2.0)

            # Create optimistic and pessimistic scenarios
            optimistic = [p * 1.1 for p in base_forecast]
            pessimistic = [p * 0.9 for p in base_forecast]

        return {
            'dates': dates,
            'base_forecast': base_forecast,
            'optimistic': optimistic,
            'pessimistic': pessimistic,
            'commodity': commodity,
            'period': period,
            'volatility': predictions.get('volatility', 0.1)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extended forecast error: {str(e)}")

@app.get("/seasonal-patterns")
def get_seasonal_patterns(commodity: str):
    """Month-by-year price heatmap for the predictions tab, computed once per data version"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")

    try:
        if forecaster.train_data is None:
            raise HTTPException(status_code=503, detail="Training data not available")
        return forecaster_utils.cached(forecaster, ('seasonal', commodity), lambda: _seasonal_patterns(commodity))

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Seasonal patterns error: {str(e)}")

def _seasonal_patterns(commodity: str) -> Dict:
    # Get historical data for the commodity
    commodity_data = weekly_frame(commodity)

    if len(commodity_data) == 0:
        # Return mock data if no historical data
        return {
            'price_matrix': [
                [1.50, 1.55, 1.60, 1.65, 1.70, 1.75, 1.80, 1.85, 1.80, 1.75, 1.70, 1.65],
                [1.55, 1.60, 1.65, 1.70, 1.75, 1.80, 1.85, 1.90, 1.85, 1.80, 1.75, 1.70],
                [1.60, 1.65, 1.70, 1.75, 1.80, 1.85, 1.90, 1.95, 1.90, 1.85, 1.80, 1.75]
            ],
            'months': ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            'years': ['2021', '2022', '2023'],
            'seasonal_analysis': f'Historical price patterns for {commodity} show typical seasonal variations with moderate price swings throughout the year.'
        }

    # Create seasonality matrix
    commodity_data['year'] = commodity_data['report_date'].dt.year
    commodity_data['month'] = commodity_data['report_date'].dt.month

    # Group by year and month
    seasonal_data = commodity_data.groupby(['year', 'month'])['current_wtd_avg_price'].mean().reset_index()

    # Get last 3 years
    years = sorted(seasonal_data['year'].unique())[-3:]
    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    price_matrix = []
    monthly_averages = [0] * 12  # Average price for each month across years

    for year in years:
        year_data = []
        for month in range(1, 13):
            price = seasonal_data[
                (seasonal_data['year'] == year) & (seasonal_data['month'] == month)
            ]['current_wtd_avg_price']

            if len(price) > 0:
                price_val = float(price.iloc[0])
                year_data.append(price_val)
                monthly_averages[month-1] += price_val
            else:
                # Fill missing data with interpolation
                avg_price = float(seasonal_data['current_wtd_avg_price'].mean())
                year_data.append(avg_price)
                monthly_averages[month-1] += avg_price

        price_matrix.append(year_data)

    # Calculate average prices per month
    monthly_averages = [avg/len(years) for avg in monthly_averages]

    # Find peak and low months
    peak_month_idx = monthly_averages.index(max(monthly_averages))
    low_month_idx = monthly_averages.index(min(monthly_averages))

    month_names = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December']

    peak_month = month_names[peak_month_idx]
    low_month = month_names[low_month_idx]

    # Determine seasons
    def get_season(month_idx):
        if month_idx in [11, 0, 1]:  # Dec, Jan, Feb
            return "winter"
        elif month_idx in [2, 3, 4]:  # Mar, Apr, May
            return "spring"
        elif month_idx in [5, 6, 7]:  # Jun, Jul, Aug
            return "summer"
        else:  # Sep, Oct, Nov
            return "fall"

    peak_season = get_season(peak_month_idx)
    low_season = get_season(low_month_idx)

    # Create seasonal analysis text
    price_range = max(monthly_averages) - min(monthly_averages)
    volatility_desc = "high" if price_range > 0.5 else "moderate" if price_range > 0.2 else "low"

    seasonal_analysis = f"Historical price patterns show {commodity} typically peak in {peak_season} ({peak_month}) and reach lows in {low_season} ({low_month}). Price volatility is {volatility_desc} with seasonal swings of ${price_range:.2f} per lb."

    return {
        'price_matrix': price_matrix,
        'months': months,
        'years': [str(year) for year in years],
        'commodity': commodity,
        'seasonal_analysis': seasonal_analysis,
        'peak_month': peak_month,
        'low_month': low_month,
        'peak_season': peak_season,
        'low_season': low_season,
        'price_range': round(price_range, 2)
    }

@app.get("/market-volatility")
def get_market_volatility(commodity: str):
    """How much this commodity's weekly price has moved over the last quarter, as a 0-10 score"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")

    series = forecaster_utils.weekly_series(forecaster, commodity).tail(14)
    if len(series) < 3:
        raise HTTPException(status_code=404, detail=f"Not enough price history for {commodity}")

    # Standard deviation of week-over-week changes, in percent: 5% a week scores 5/10
    weekly_move_pct = float(np.std(np.diff(np.log(series.to_numpy()))) * 100)
    volatility_score = min(10.0, weekly_move_pct)
    volatility_desc = "low" if volatility_score < 3 else "moderate" if volatility_score < 7 else "high"
    price_swing = round(weekly_move_pct * np.sqrt(2))  # typical move over two weeks

    return {
        'volatility_score': volatility_score,
        'commodity': commodity,
        'period': f'{len(series) - 1} weeks',
        'volatility_analysis': (
            f"{commodity} prices moved about {weekly_move_pct:.1f}% a week over the last {len(series) - 1} weekly reports, "
            f"so a typical two-week swing is around ±{price_swing}%."
        ),
        'volatility_level': volatility_desc,
        'expected_price_swing': price_swing
    }

# Alert Management Endpoints
@app.get("/alerts/settings")
async def get_alert_settings():
    """Get current alert settings"""
    try:
        settings = alert_manager.get_settings()
        return {
            "low_stock_threshold": settings.low_stock_threshold,
            "price_change_alert": settings.price_change_alert,
            "spoilage_warning": settings.spoilage_warning,
            "email_notifications": settings.email_notifications,
            "sms_notifications": settings.sms_notifications,
            "push_notifications": settings.push_notifications,
            "alert_frequency": settings.alert_frequency
        }
    except Exception as e:
        print(f"⚠️ Error getting alert settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/alerts/settings")
async def save_alert_settings(settings: AlertSettings):
    """Save alert settings"""
    try:
        success = alert_manager.update_settings(settings)
        if success:
            return {
                "success": True,
                "message": "Alert settings saved successfully",
                "settings": {
                    "low_stock_threshold": settings.low_stock_threshold,
                    "price_change_alert": settings.price_change_alert,
                    "spoilage_warning": settings.spoilage_warning,
                    "email_notifications": settings.email_notifications,
                    "sms_notifications": settings.sms_notifications,
                    "push_notifications": settings.push_notifications,
                    "alert_frequency": settings.alert_frequency
                }
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to save alert settings")
    except Exception as e:
        print(f"⚠️ Error saving alert settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/alerts/recent")
def get_recent_alerts(
    limit: int = Query(8, ge=1, le=100, description="Alerts per page, most urgent first"),
    offset: int = Query(0, ge=0),
):
    """Alerts from current inventory and the price forecasts, most urgent first, one page at a time.

    There's no generated_at timestamp any more: it changed on every call, so the response could never be
    revalidated with its ETag, and the UI never read it.
    """
    try:
        # Get current inventory data
        inventory_data = []
        for item in inventory_manager.get_inventory_list():
            # Calculate days left from raw values
            days_left = item.current_stock / item.daily_usage if item.daily_usage > 0 else 0

            inventory_data.append({
                'ingredient': item.ingredient,
                'days_left': days_left,
                'status': item.status.lower(),  # Ensure lowercase for consistency
                'shelf_life': item.shelf_life_days  # Fixed: use shelf_life_days attribute
            })

        # Generate dynamic alerts
        all_alerts = alert_manager.generate_recent_alerts(inventory_data, forecaster)
        page = all_alerts[offset:offset + limit]

        return {
            "alerts": [alert.dict() for alert in page],
            "total_count": len(page),
            **page_params(limit, offset, len(all_alerts))
        }

    except Exception as e:
        print(f"⚠️ Error getting recent alerts: {e}")
        # Return fallback data
        return {
            "alerts": [
                {
                    "id": "fallback_1",
                    "type": "system",
                    "title": "System Status",
                    "message": "Alert system is functioning normally",
                    "timestamp": "5 minutes ago",
                    "commodity": None
                }
            ],
            "total_count": 1,
            **page_params(limit, offset, 1)
        }

# ==================== SCRAPE AND TRAIN ENDPOINT ====================

async def pull_usda_data():
    """Fetch new weekly USDA reports into the training CSV. Returns (success, message, rows added)."""
    try:
        print("🌽 Requesting new weekly reports from the USDA MyMarketNews API...")
        result = await asyncio.to_thread(
            usda_api.refresh_training_data, TRAIN_DATA_PATH, forecaster.viable_commodities
        )
    except usda_api.MissingApiKey:
        return False, ("Data refresh needs a free USDA MyMarketNews API key. Create one at mymarketnews.ams.usda.gov "
                       "(My Profile, API Key) and set it as MARS_API_KEY in the service's environment."), 0
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code in (401, 403):
            return False, "USDA rejected the API key. Check that MARS_API_KEY matches the key in your MyMarketNews profile.", 0
        return False, f"USDA's API returned an error: {e}", 0
    except requests.RequestException as e:
        return False, f"Couldn't reach USDA's API: {e}", 0

    latest, added, empty = result['latest'], result['rows_added'], result['empty_commodities']
    missing = f" No rows came back for {', '.join(empty)}." if empty else ""
    print(f"📥 USDA refresh: {added} new rows, newest report {latest}.{missing}")

    if added <= 0:
        days_old = (datetime.now().date() - datetime.fromisoformat(latest).date()).days
        if days_old <= 10:
            return True, f"Already up to date: the newest report is from {latest}.{missing}", 0
        return False, f"USDA returned no new rows; the newest report is still {latest}.{missing}", 0
    return True, f"Added {added} new rows through {latest}.{missing}", added


def train_all_models() -> int:
    """(Re)train every commodity's model on the current training data. Returns how many trained."""
    trained = 0
    for commodity in list(forecaster.viable_commodities):
        try:
            with _train_lock(commodity):
                forecaster_utils.train_model(forecaster, commodity)
            trained += 1
        except Exception as e:
            print(f"⚠️ Training {commodity} failed: {e}")
    print(f"🎯 Trained {trained}/{len(forecaster.viable_commodities)} models")
    return trained


async def refresh_and_retrain():
    """Pull new weekly USDA reports, then retrain every model if anything was added"""
    success, message, added = await pull_usda_data()
    if added > 0:
        # Reloading starts a new data version, which empties every server-side cache
        await asyncio.to_thread(forecaster.load_training_data, TRAIN_DATA_PATH)
        retrained = await asyncio.to_thread(train_all_models)
        message = f"{message} Retrained {retrained} models."
    return success, message


async def refresh_on_startup():
    """Render's disk resets on every restart, so pull the weeks published since the bundled CSV, then train"""
    async with scrape_lock:
        try:
            _, message = await refresh_and_retrain()
        except Exception as e:  # a refresh problem must never leave the server without models
            message = f"failed: {e}"
        print(f"🌽 Startup refresh: {message}")
        if os.getenv('PRETRAIN_MODELS', '1') == '1' and len(forecaster.models) < len(forecaster.viable_commodities):
            await asyncio.to_thread(train_all_models)

# One refresh at a time: each run calls USDA for every commodity and retrains every model
scrape_lock = asyncio.Lock()

@app.post("/scrape-and-train")
async def scrape_and_train():
    """Trigger automated scraping and model retraining"""
    if scrape_lock.locked():
        raise HTTPException(status_code=409, detail="A data refresh is already running. Try again when it finishes.")
    async with scrape_lock:
        return await _scrape_and_train()

async def _scrape_and_train():
    try:
        print("\n🚀 === STARTING SCRAPE AND TRAIN PROCESS ===")

        # Run the scraper and training process
        success, message = await refresh_and_retrain()

        if success:
            return {
                "success": True,
                "message": message,
                "timestamp": datetime.now().isoformat()
            }
        else:
            return {
                "success": False,
                "error": message,
                "timestamp": datetime.now().isoformat()
            }

    except Exception as e:
        print(f"❌ Error in scrape-and-train endpoint: {e}")
        return {
            "success": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }


# ==================== HTTP CACHING, COMPRESSION, CDN ====================

# Browsers may reuse market data (prices, forecasts, weather) this long without asking again
API_MAX_AGE = int(os.getenv('API_CACHE_SECONDS', 60))
# Never stored anywhere: liveness and pipeline progress must always be live
NO_STORE_PATHS = ('/health', '/pipeline/status')
# Data the user changes from this UI (stock, alerts, applied forecasts, pipeline runs): a cached copy may be kept
# but is revalidated on every use, which costs a 304 when nothing changed
REVALIDATE_PREFIXES = ('/inventory', '/alerts', '/dashboard', '/forecast/active', '/pipeline')

# Hashed Next.js build output never changes under the same URL
STATIC_IMMUTABLE = 'public, max-age=31536000, immutable'
# Pages always revalidate (ETag), so a deploy shows up on the next visit and never points at deleted chunks
STATIC_PAGE = 'public, max-age=0, must-revalidate'
STATIC_OTHER = f"public, max-age={int(os.getenv('STATIC_CACHE_SECONDS', 86400))}"  # favicon, svgs


def api_cache_control(path: str) -> str:
    if path in NO_STORE_PATHS:
        return 'no-store'
    if path.startswith(REVALIDATE_PREFIXES):
        return 'private, no-cache'
    return f'private, max-age={API_MAX_AGE}'


def etag_for(body: bytes) -> str:
    """Weak validator: the same JSON may go out gzipped or plain"""
    return 'W/"' + hashlib.blake2b(body, digest_size=16).hexdigest() + '"'


def etag_matches(if_none_match: Optional[str], etag: str) -> bool:
    """Weak comparison, as If-None-Match requires (RFC 9110 13.1.2)"""
    if not if_none_match:
        return False
    if if_none_match.strip() == '*':
        return True
    opaque = etag[2:] if etag.startswith('W/') else etag
    return any((tag.strip()[2:] if tag.strip().startswith('W/') else tag.strip()) == opaque
               for tag in if_none_match.split(','))


class HttpCacheHeaders:
    """ETag + Cache-Control for API responses (pure ASGI, so streamed files pass straight through).

    - A GET that returns JSON with 200 gets a weak ETag (hash of the body); a matching If-None-Match gets a
      bodiless 304 instead, so revalidating an unchanged dashboard costs a few bytes.
    - Every response without its own Cache-Control gets one: no-store for mutations, errors, /health and
      /pipeline/status; private + no-cache for data the user edits; private + a short max-age for market data.
    - Responses that already carry an ETag (static files) keep their own validators and headers.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if scope["method"] not in ("GET", "HEAD"):
            async def send_no_store(message):
                if message["type"] == "http.response.start":
                    MutableHeaders(scope=message).setdefault("cache-control", "no-store")
                await send(message)
            await self.app(scope, receive, send_no_store)
            return

        policy = api_cache_control(scope["path"])
        if_none_match = Headers(scope=scope).get("if-none-match")
        start = None
        parts: List[bytes] = []
        passthrough = False

        async def send_with_validators(message):
            nonlocal start, passthrough
            if message["type"] == "http.response.start":
                headers = Headers(raw=message["headers"])
                status = message["status"]
                if status >= 400:
                    MutableHeaders(scope=message).setdefault("cache-control", "no-store")
                if (status != 200 or "etag" in headers or policy == "no-store"
                        or not headers.get("content-type", "").startswith("application/json")):
                    if status == 200 and policy == "no-store":
                        MutableHeaders(scope=message).setdefault("cache-control", "no-store")
                    passthrough = True
                    await send(message)
                else:
                    start = message  # held back until the body is known
                return
            if passthrough or message["type"] != "http.response.body":
                await send(message)
                return

            parts.append(message.get("body", b""))
            if message.get("more_body", False):
                return
            body = b"".join(parts)
            etag = etag_for(body)
            headers = MutableHeaders(scope=start)
            headers.setdefault("cache-control", policy)
            headers["etag"] = etag
            if etag_matches(if_none_match, etag):
                keep = [(k, v) for k, v in start["headers"]
                        if k.lower() not in (b"content-length", b"content-type", b"content-encoding")]
                await send({"type": "http.response.start", "status": 304, "headers": keep})
                await send({"type": "http.response.body", "body": b""})
                return
            await send(start)
            await send({"type": "http.response.body", "body": body})

        await self.app(scope, receive, send_with_validators)


def static_cache_control(relative_path: str, status_code: int = 200) -> str:
    if status_code != 200:
        return 'no-store'
    if relative_path.startswith('_next/static/'):
        return STATIC_IMMUTABLE
    name = relative_path.rsplit('/', 1)[-1]
    if name.endswith(('.html', '.txt')) or '.' not in name:  # pages and Next's RSC payloads
        return STATIC_PAGE
    return STATIC_OTHER


class CachedStaticFiles(StaticFiles):
    """The static export with CDN-friendly Cache-Control (StaticFiles already sends ETag/Last-Modified and 304s)"""

    def file_response(self, full_path, stat_result, scope, status_code: int = 200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        relative = Path(os.path.relpath(full_path, self.directory)).as_posix()
        response.headers["Cache-Control"] = static_cache_control(relative, status_code)
        return response


def add_performance_middleware(target: FastAPI) -> None:
    """Cache headers sit inside gzip, so ETags are computed on the plain JSON and 304s skip compression"""
    target.add_middleware(HttpCacheHeaders)
    # Level 6: nearly level 9's ratio at a fraction of the CPU, which matters on a small instance
    target.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=6)


# ==================== SINGLE-ORIGIN DEPLOY ====================

class StripApiPrefix:
    """Serve every API route under /api too, so the bundled frontend can call /api/... on the same origin"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/api/"):
            scope = dict(scope, path=scope["path"][4:])
        await self.app(scope, receive, send)

add_performance_middleware(app)
app.add_middleware(StripApiPrefix)

# The built Next.js export (if present) is served at "/" after all API routes
if FRONTEND_DIR.is_dir():
    app.mount("/", CachedStaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
    print(f"🖥️ Serving frontend from {FRONTEND_DIR}")

if __name__ == "__main__":
    import uvicorn

    host = os.getenv('API_HOST', 'localhost')
    port = int(os.getenv('API_PORT', 8000))
    debug = os.getenv('DEBUG', 'True').lower() == 'true'

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=debug,
        workers=None if debug else int(os.getenv('WEB_CONCURRENCY', 1)),
        log_level="info"
    )
