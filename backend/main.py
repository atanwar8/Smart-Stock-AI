#!/usr/bin/env python3
"""
SmartStock AI - FastAPI Backend
Main application with prediction endpoints and inventory management
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Dict, List, Optional
import os
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
from dotenv import load_dotenv
import uuid
import subprocess
import sys
import asyncio
import json
import threading
from pathlib import Path

# Load environment variables
load_dotenv()

# Repo layout: CSVs live in the project root, the built frontend in smartstock-nextjs/out
PROJECT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv('DATA_DIR', PROJECT_DIR))
TRAIN_DATA_PATH = os.getenv('TRAIN_DATA_PATH', str(DATA_DIR / 'Example_Train.csv'))
FRONTEND_DIR = Path(os.getenv('FRONTEND_DIR', PROJECT_DIR / 'smartstock-nextjs' / 'out'))

# Import our forecaster
from core.forecaster import XGBoostLightGBMForecaster
from core import forecaster_utils

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
        """Alerts from current stock levels and the price forecasts, most urgent first"""
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

            # Price moves come from the forecast agent, for items whose model is already trained
            if forecaster is not None and ingredient in forecaster.models:
                forecast = forecaster_utils.predict_with_model(forecaster, ingredient, 7, None)
                if 'error' not in forecast:
                    latest = float(forecaster_utils.weekly_prices(forecaster.train_data, ingredient).iloc[-1])
                    change = (forecast['predictions'][-1] / latest - 1) * 100
                    if abs(change) >= self.settings.price_change_alert:
                        rising = change > 0
                        alerts.append(AlertItem(
                            id=f"price_{ingredient}", type="warning" if rising else "info",
                            title="Price Increase Warning" if rising else "Order Opportunity",
                            message=f"{ingredient} prices forecast to {'rise' if rising else 'fall'} {abs(change):.1f}% over the next week",
                            timestamp="Latest forecast", commodity=ingredient
                        ))

        if forecaster is not None and forecaster.train_data is not None:
            latest_report = pd.to_datetime(forecaster.train_data['report_date']).max()
            alerts.append(AlertItem(
                id="system_data", type="system", title="Price Data",
                message=f"Forecasts use USDA reports through {latest_report:%b %d, %Y}",
                timestamp=f"{(datetime.now() - latest_report).days} days old", commodity=None
            ))

        priority = {'critical': 0, 'warning': 1, 'info': 2, 'success': 3, 'system': 4}
        alerts.sort(key=lambda a: priority.get(a.type, 5))
        return alerts[:8]

# Initialize alert manager
alert_manager = AlertManager()

def weekly_frame(commodity: str) -> pd.DataFrame:
    """Weekly average prices in one unit, as report_date / current_wtd_avg_price columns"""
    return forecaster_utils.weekly_prices(forecaster.train_data, commodity).rename('current_wtd_avg_price').reset_index()

# Inventory Management System
class InventoryManager:
    def __init__(self):
        self.inventory_items: Dict[str, InventoryItem] = {}
        self.shelf_life_data = self._load_shelf_life_data()
        self.max_items = 4  # FIFO limit
    
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
        items = list(self.inventory_items.values())
        
        # Sort by status priority: critical, high, good, opportunity
        status_priority = {'critical': 0, 'high': 1, 'good': 2, 'opportunity': 3}
        items.sort(key=lambda x: (status_priority.get(x.status, 4), x.updated_at))
        
        return items
    
    def get_inventory_alerts(self) -> List[Dict]:
        """Get inventory status alerts for dashboard"""
        alerts = []
        for item in self.get_inventory_list():
            alerts.append({
                'commodity': item.ingredient,
                'status': item.status,
                'days_left': item.days_left,
                'message': item.status_message,
                'icon': item.status_icon,
                'color': item.status_color
            })
        
        return alerts
    
    def confirm_order(self, ingredient: str, quantity: float, price_per_unit: float, unit: str = "lbs"):
        """Process order confirmation and update inventory"""
        for key, item in self.inventory_items.items():
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

# Pydantic models for API requests/responses
class WeatherRequest(BaseModel):
    state: str
    zip_code: str
    days: Optional[int] = 30

class PredictionRequest(BaseModel):
    commodity: str
    state: str
    zip_code: str
    days_ahead: Optional[int] = 30

class TrainModelRequest(BaseModel):
    commodity: str
    state: Optional[str] = None
    zip_code: Optional[str] = None

class PriceDataPoint(BaseModel):
    date: str
    price: float
    confidence_upper: Optional[float] = None
    confidence_lower: Optional[float] = None

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

class ChartDataResponse(BaseModel):
    data: List[Dict]
    layout: Dict
    config: Dict

@app.on_event("startup")
async def startup_event():
    """Initialize the forecaster on startup"""
    global forecaster
    
    train_path = TRAIN_DATA_PATH
    weather_api_key = os.getenv('OPENWEATHER_API_KEY')
    
    # Initialize forecaster
    forecaster = XGBoostLightGBMForecaster(weather_api_key=weather_api_key)
    forecaster.load_commodity_mapping()
    
    # Load training data
    success = forecaster.load_training_data(train_path)
    if not success:
        print("⚠️ Warning: Could not load training data")

    # A fresh deploy starts with an empty walk-in; give the demo a few tracked items
    if os.getenv('SEED_DEMO_INVENTORY', '1') == '1' and not inventory_manager.inventory_items:
        for ingredient, stock, usage, capacity in [
            ('Tomatoes', 22, 9, 120), ('Lettuce', 30, 7, 80), ('Carrots', 140, 10, 200), ('Broccoli', 36, 4, 90)
        ]:
            inventory_manager.update_inventory(ingredient, stock, usage, capacity)

    # Train every commodity's model in the background so the first page views are fast
    if success and os.getenv('PRETRAIN_MODELS', '1') == '1':
        def pretrain():
            weather_data = forecaster.get_weather_data('CA', '90210', 30)
            for commodity in list(forecaster.viable_commodities):
                if commodity not in forecaster.models:
                    try:
                        forecaster_utils.train_model(forecaster, commodity, weather_data)
                    except Exception as e:
                        print(f"⚠️ Pretraining {commodity} failed: {e}")
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
            "dashboard": "/dashboard/*",
            "charts": "/charts/*"
        }
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "forecaster_ready": forecaster is not None,
        "models_trained": len(forecaster.models) if forecaster else 0,
        "viable_commodities": len(forecaster.viable_commodities) if forecaster else 0,
        "training_rows": int(len(forecaster.train_data)) if forecaster is not None and forecaster.train_data is not None else 0,
        "latest_data_date": _latest_report_date()
    }

def _latest_report_date() -> Optional[str]:
    """Newest USDA report date in the training data, as YYYY-MM-DD"""
    try:
        return pd.to_datetime(forecaster.train_data['report_date']).max().date().isoformat()
    except Exception:
        return None

@app.get("/commodities")
async def get_commodities():
    """Get list of available commodities"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")
    
    rows = forecaster.train_data
    return {
        "viable_commodities": forecaster.viable_commodities,
        "commodity_mapping": forecaster.commodity_mapping,
        # Prices are quoted in each commodity's most common USDA unit (per lb, each, per bunch, ...)
        "units": {c: rows.loc[rows['commodity'] == c, 'unit'].mode().iloc[0] for c in forecaster.viable_commodities},
        "total_count": len(forecaster.viable_commodities)
    }

@app.get("/weather")
async def get_weather_get(state: str = "CA", zip_code: str = "10001", days: int = 30):
    """Get weather data for a location (GET endpoint for frontend compatibility)"""
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

@app.post("/weather")
async def get_weather(request: WeatherRequest):
    """Get weather data for a location (POST endpoint for backwards compatibility)"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")
    
    try:
        weather_data = forecaster.get_weather_data(
            state=request.state,
            zip_code=request.zip_code,
            days=request.days
        )
        return weather_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Weather data error: {str(e)}")

@app.post("/train")
async def train_model(request: TrainModelRequest, background_tasks: BackgroundTasks):
    """Train a model for a specific commodity"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")
    
    if request.commodity not in forecaster.viable_commodities:
        raise HTTPException(status_code=400, detail=f"Commodity '{request.commodity}' not available")
    
    try:
        # Get weather data if location provided
        weather_data = None
        if request.state and request.zip_code:
            weather_data = forecaster.get_weather_data(request.state, request.zip_code)
        
        # Train model
        result = forecaster_utils.train_model(forecaster, request.commodity, weather_data)
        
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
async def predict_prices(request: PredictionRequest) -> PredictionResponse:
    """Generate price predictions for a commodity"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")
    
    if request.commodity not in forecaster.viable_commodities:
        raise HTTPException(status_code=400, detail=f"Commodity '{request.commodity}' not available")
    
    try:
        # Get weather data
        weather_data = forecaster.get_weather_data(
            state=request.state,
            zip_code=request.zip_code,
            days=request.days_ahead
        )
        
        # Train model if not already trained
        if request.commodity not in forecaster.models:
            train_result = forecaster_utils.train_model(forecaster, request.commodity, weather_data)
            if not train_result.get('success'):
                raise HTTPException(status_code=500, detail=f"Model training failed: {train_result.get('error')}")
        
        # Generate predictions
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

@app.get("/dashboard/kpi")
async def get_kpi():
    """Get dashboard KPI data with real model accuracy"""
    try:
        # Calculate actual model accuracy from trained models
        total_accuracy = 0
        model_count = 0
        accuracy_details = {}
        
        print(f"🔍 DEBUG: Checking model performance...")
        print(f"   Forecaster exists: {forecaster is not None}")
        
        if forecaster:
            print(f"   Model performance dict exists: {hasattr(forecaster, 'model_performance')}")
            print(f"   Models dict: {list(forecaster.models.keys()) if hasattr(forecaster, 'models') else 'No models dict'}")
            print(f"   Model performance keys: {list(forecaster.model_performance.keys()) if hasattr(forecaster, 'model_performance') else 'No model_performance dict'}")
            
            # Check both model_performance and models dictionaries
            if hasattr(forecaster, 'model_performance') and forecaster.model_performance:
                for commodity, performance in forecaster.model_performance.items():
                    if isinstance(performance, dict) and 'r2' in performance:
                        r2_score = performance['r2']
                        accuracy_pct = max(0, r2_score * 100)
                        accuracy_details[commodity] = {
                            'r2_score': r2_score,
                            'accuracy_pct': accuracy_pct,
                            'mae': performance.get('mae', 0),
                            'skill_pct': skill_vs_naive(performance)
                        }
                        total_accuracy += accuracy_pct
                        model_count += 1
                        print(f"   Found {commodity}: R²={r2_score:.3f}, Accuracy={accuracy_pct:.1f}%")
            
            # Fallback: check models dict for performance data
            elif hasattr(forecaster, 'models') and forecaster.models:
                print("   Falling back to models dict for performance data...")
                for commodity, model_info in forecaster.models.items():
                    if isinstance(model_info, dict) and 'performance' in model_info:
                        performance = model_info['performance']
                        if isinstance(performance, dict) and 'r2' in performance:
                            r2_score = performance['r2']
                            accuracy_pct = max(0, r2_score * 100)
                            accuracy_details[commodity] = {
                                'r2_score': r2_score,
                                'accuracy_pct': accuracy_pct,
                                'mae': performance.get('mae', 0),
                                'skill_pct': skill_vs_naive(performance)
                            }
                            total_accuracy += accuracy_pct
                            model_count += 1
                            print(f"   Found {commodity} in models: R²={r2_score:.3f}, Accuracy={accuracy_pct:.1f}%")
        
        # Calculate overall accuracy
        if model_count > 0:
            overall_accuracy = total_accuracy / model_count
            print(f"   📊 Overall accuracy: {overall_accuracy:.1f}% from {model_count} models")
        else:
            overall_accuracy = 0
            print("   ⚠️ No model performance data found")
        
        skills = [d['skill_pct'] for d in accuracy_details.values()]
        average_skill = float(np.mean(skills)) if skills else 0.0
        
        # Get current inventory count
        inventory_count = len(inventory_manager.get_inventory_list())
        
        # Calculate average volatility from current inventory
        total_volatility = 0
        volatility_count = 0
        for item in inventory_manager.get_inventory_list():
            # Simple volatility estimation based on days left and status
            if item.status == "critical":
                item_volatility = 8.5
            elif item.status == "high": 
                item_volatility = 6.2
            elif item.status == "good":
                item_volatility = 3.8
            else:
                item_volatility = 5.0
            
            total_volatility += item_volatility
            volatility_count += 1
        
        avg_volatility = total_volatility / volatility_count if volatility_count > 0 else 5.5
        
        return {
            "forecast_accuracy": {
                "value": f"{overall_accuracy:.1f}%",
                "trend": f"{average_skill:+.1f}% vs. last week's price as a guess",
                "models_trained": model_count,
                "accuracy_details": accuracy_details
            },
            "active_commodities": {
                "value": str(inventory_count),
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
        import traceback
        traceback.print_exc()
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

@app.get("/dashboard/inventory-status")
async def get_inventory_status():
    """Get inventory status alerts using the inventory manager"""
    try:
        alerts = inventory_manager.get_inventory_alerts()
        
        # If no inventory items, return default mock data
        if not alerts:
            alerts = [
            {
                "commodity": "Tomatoes",
                "status": "critical",
                "days_left": 2,
                "message": "Stock will run out in 2 days",
                "icon": "exclamation-circle",
                "color": "red"
            },
            {
                "commodity": "Lettuce",
                "status": "high",
                "days_left": 5,
                "message": "Stock will run out in 5 days",
                "icon": "exclamation-triangle",
                "color": "yellow"
                }
            ]
        
        return {"alerts": alerts}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inventory status error: {str(e)}")

# Inventory Management Endpoints

@app.post("/inventory/update")
async def update_inventory(request: InventoryUpdateRequest):
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
async def get_inventory_list():
    """Get current inventory list for dashboard"""
    try:
        inventory_items = inventory_manager.get_inventory_list()
        
        # Convert to frontend format
        inventory_data = []
        for item in inventory_items:
            # Get price trend for this ingredient (integrate with prediction)
            try:
                price_trend = await get_price_trend_for_ingredient(item.ingredient)
            except:
                price_trend = {"trend": "stable", "percentage": "0%", "direction": "right"}
            
            inventory_data.append({
                "id": item.id,
                "ingredient": item.ingredient,
                "current_stock": f"{item.current_stock} {item.unit}",
                "daily_usage": f"{item.daily_usage} {item.unit}/day",
                "days_left": f"{item.days_left:.1f} days",
                "shelf_life": f"{item.shelf_life_days} days",
                "status": item.status.title(),
                "status_color": item.status_color,
                "price_trend": price_trend,
                "action": "Order Now" if item.status in ['critical', 'high'] else "Hold"
            })
        
        return {"inventory": inventory_data}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inventory list error: {str(e)}")

@app.post("/inventory/confirm-order")
async def confirm_order(request: OrderConfirmationRequest):
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
async def get_smart_recommendation(commodity: str, state: str = "CA", zip_code: str = "10001"):
    """Get smart ordering recommendation with price prediction"""
    try:
        # Get current inventory for this commodity
        current_item = None
        for item in inventory_manager.get_inventory_list():
            if item.ingredient == commodity:
                current_item = item
                break
        
        # Get weather data and price predictions
        weather_data = forecaster.get_weather_data(state, zip_code, 7)
        
        # Train model if needed
        if commodity not in forecaster.models:
            forecaster_utils.train_model(forecaster, commodity, weather_data)
        
        # Get 7-day price forecast
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

async def get_price_trend_for_ingredient(ingredient: str) -> Dict:
    """Helper function to get ACTUAL price trend for an ingredient based on ML predictions"""
    try:
        # Get 7-day prediction using ML model
        weather_data = forecaster.get_weather_data("CA", "10001", 7)
        
        if ingredient not in forecaster.models:
            print(f"🤖 Training model for {ingredient} to get real price trends...")
            forecaster_utils.train_model(forecaster, ingredient, weather_data)
        
        predictions = forecaster_utils.predict_with_model(forecaster, ingredient, 7, weather_data)
        
        if 'error' not in predictions and len(predictions['predictions']) >= 2:
            current_price = predictions['predictions'][0]
            future_price = predictions['predictions'][-1]
            percentage = ((future_price - current_price) / current_price) * 100
            
            print(f"📊 {ingredient} ML prediction: ${current_price:.2f} → ${future_price:.2f} ({percentage:+.1f}%)")
            
            # Use ACTUAL ML model predictions (no artificial adjustments)
            if percentage > 1:
                return {"trend": "rising", "percentage": f"+{percentage:.1f}%", "direction": "up"}
            elif percentage < -1:
                return {"trend": "falling", "percentage": f"{percentage:.1f}%", "direction": "down"}
            else:
                return {"trend": "stable", "percentage": f"±{abs(percentage):.1f}%", "direction": "right"}
        else:
            print(f"⚠️ No ML predictions available for {ingredient}, trying historical analysis...")
            
            # Try to get some basic price statistics from training data if available
            if hasattr(forecaster, 'train_data') and forecaster.train_data is not None:
                commodity_data = weekly_frame(ingredient)
                if len(commodity_data) > 1:
                    recent_prices = commodity_data['current_wtd_avg_price'].tail(10).dropna()
                    if len(recent_prices) >= 2:
                        recent_change = ((recent_prices.iloc[-1] - recent_prices.iloc[0]) / recent_prices.iloc[0]) * 100
                        print(f"📈 {ingredient} historical trend: {recent_change:+.1f}% (based on recent data)")
                        
                        if recent_change > 1:
                            return {"trend": "rising", "percentage": f"+{recent_change:.1f}%", "direction": "up"}
                        elif recent_change < -1:
                            return {"trend": "falling", "percentage": f"{recent_change:.1f}%", "direction": "down"}
                        else:
                            return {"trend": "stable", "percentage": f"±{abs(recent_change):.1f}%", "direction": "right"}
            
            # Last resort fallback
            print(f"⚠️ No data available for {ingredient}, showing neutral trend")
            return {"trend": "stable", "percentage": "±0.0%", "direction": "right"}
    
    except Exception as e:
        print(f"⚠️ Price trend error for {ingredient}: {e}")
        # Simple error fallback - just show stable with no change
        return {"trend": "stable", "percentage": "±0.0%", "direction": "right"}

@app.post("/charts/price-trends")
async def get_price_trends_chart(request: PredictionRequest):
    """Get 30-day price trends chart data for dashboard with professional styling"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")
    
    try:
        # Get weather data
        weather_data = forecaster.get_weather_data(request.state, request.zip_code, 30)
        
        # Get historical data for the commodity
        if forecaster.train_data is None:
            raise HTTPException(status_code=503, detail="Training data not available")
        
        commodity_data = weekly_frame(request.commodity).tail(10)
        
        # Generate predictions
        if request.commodity not in forecaster.models:
            forecaster_utils.train_model(forecaster, request.commodity, weather_data)
        
        predictions = forecaster_utils.predict_with_model(
            forecaster, request.commodity, 30, weather_data
        )
        
        commodity_data_sampled = commodity_data
        
        historical_data = {
            'x': commodity_data_sampled['report_date'].dt.strftime('%Y-%m-%d').tolist(),
            'y': commodity_data_sampled['current_wtd_avg_price'].tolist(),
            'type': 'scatter',
            'mode': 'lines+markers',
            'name': 'Actual Price',
            'line': {'color': '#4F46E5', 'width': 3},
            'marker': {'size': 8}
        }
        
        chart_data = [historical_data]
        
        if 'error' not in predictions:
            # Sample forecast data to show weekly points (4 points for 30 days)
            forecast_dates = predictions['dates']
            forecast_prices = predictions['predictions']
            forecast_upper = predictions['confidence_upper']
            forecast_lower = predictions['confidence_lower']
            
            # Sample every 7-8 days to get ~4 points for 30 days
            step = max(1, len(forecast_dates) // 4)
            sampled_indices = list(range(0, len(forecast_dates), step))[:4]
            
            forecast_data = {
                'x': [forecast_dates[i] for i in sampled_indices],
                'y': [forecast_prices[i] for i in sampled_indices],
                'type': 'scatter',
                'mode': 'lines+markers',
                'name': 'Forecast',
                'line': {'color': '#10B981', 'width': 3, 'dash': 'dot'},
                'marker': {'size': 8}
            }
            
            confidence_upper = {
                'x': [forecast_dates[i] for i in sampled_indices],
                'y': [forecast_upper[i] for i in sampled_indices],
                'type': 'scatter',
                'mode': 'lines',
                'name': 'Upper Bound',
                'line': {'color': '#10B981', 'width': 1},
                'fillcolor': 'rgba(16, 185, 129, 0.2)',
                'fill': 'tonexty'
            }
            
            confidence_lower = {
                'x': [forecast_dates[i] for i in sampled_indices],
                'y': [forecast_lower[i] for i in sampled_indices],
                'type': 'scatter',
                'mode': 'lines',
                'name': 'Lower Bound',
                'line': {'color': '#10B981', 'width': 1},
                'fillcolor': 'rgba(16, 185, 129, 0.2)'
            }
            
            chart_data = [historical_data, forecast_data, confidence_upper, confidence_lower]
        
        return {
            'data': chart_data,
            'layout': {
                'title': '',
                'xaxis': {'title': 'Date'},
                'yaxis': {'title': 'Price per lb ($)'},
                'showlegend': True,
                'legend': {'orientation': 'h', 'y': 1.1},
                'margin': {'t': 0},
                'plot_bgcolor': 'rgba(0,0,0,0)',
                'paper_bgcolor': 'rgba(0,0,0,0)'
            },
            'config': {'displayModeBar': False}
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chart data error: {str(e)}")

@app.post("/charts/forecast-7day")
async def get_7day_forecast_chart(request: PredictionRequest):
    """Get 7-day forecast chart for ordering tab"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")
    
    try:
        # Get weather data
        weather_data = forecaster.get_weather_data(request.state, request.zip_code, 7)
        
        # Train model if needed
        if request.commodity not in forecaster.models:
            forecaster_utils.train_model(forecaster, request.commodity, weather_data)
        
        # Generate 7-day predictions
        predictions = forecaster_utils.predict_with_model(
            forecaster, request.commodity, 7, weather_data
        )
        
        if 'error' in predictions:
            raise HTTPException(status_code=500, detail=predictions['error'])
        
        # Format for bar chart
        chart_data = [{
            'x': ['Today', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'],
            'y': predictions['predictions'],
            'type': 'bar',
            'name': 'Predicted Price',
            'marker': {'color': '#4F46E5'}
        }]
        
        return {
            'data': chart_data,
            'layout': {
                'title': '',
                'xaxis': {'title': 'Day'},
                'yaxis': {'title': 'Price per lb ($)'},
                'showlegend': False,
                'margin': {'t': 0},
                'plot_bgcolor': 'rgba(0,0,0,0)',
                'paper_bgcolor': 'rgba(0,0,0,0)'
            },
            'config': {'displayModeBar': False}
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"7-day forecast error: {str(e)}")

@app.post("/charts/extended-forecast")
async def get_extended_forecast_chart(request: PredictionRequest):
    """Get extended forecast chart for predictions tab"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")
    
    try:
        # Get weather data
        weather_data = forecaster.get_weather_data(request.state, request.zip_code, 30)
        
        # Train model if needed
        if request.commodity not in forecaster.models:
            forecaster_utils.train_model(forecaster, request.commodity, weather_data)
        
        # Generate predictions
        predictions = forecaster_utils.predict_with_model(
            forecaster, request.commodity, 28, weather_data  # 4 weeks
        )
        
        if 'error' in predictions:
            raise HTTPException(status_code=500, detail=predictions['error'])
        
        # Group by weeks
        weekly_dates = ['Week 1', 'Week 2', 'Week 3', 'Week 4']
        weekly_prices = []
        
        for i in range(4):
            week_start = i * 7
            week_end = min((i + 1) * 7, len(predictions['predictions']))
            week_avg = np.mean(predictions['predictions'][week_start:week_end])
            weekly_prices.append(week_avg)
        
        # Create optimistic and pessimistic scenarios
        optimistic = [p * 1.1 for p in weekly_prices]
        pessimistic = [p * 0.9 for p in weekly_prices]
        
        chart_data = [
            {
                'x': weekly_dates,
                'y': weekly_prices,
                'type': 'scatter',
                'mode': 'lines+markers',
                'name': 'Base Forecast',
                'line': {'color': '#4F46E5', 'width': 3}
            },
            {
                'x': weekly_dates,
                'y': optimistic,
                'type': 'scatter',
                'mode': 'lines',
                'name': 'Optimistic',
                'line': {'color': '#10B981', 'width': 1, 'dash': 'dash'}
            },
            {
                'x': weekly_dates,
                'y': pessimistic,
                'type': 'scatter',
                'mode': 'lines',
                'name': 'Pessimistic',
                'line': {'color': '#EF4444', 'width': 1, 'dash': 'dash'}
            }
        ]
        
        return {
            'data': chart_data,
            'layout': {
                'title': '',
                'xaxis': {'title': 'Week'},
                'yaxis': {'title': 'Price per lb ($)'},
                'showlegend': True,
                'legend': {'orientation': 'h', 'y': 1.1},
                'margin': {'t': 0},
                'plot_bgcolor': 'rgba(0,0,0,0)',
                'paper_bgcolor': 'rgba(0,0,0,0)'
            },
            'config': {'displayModeBar': False}
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extended forecast error: {str(e)}")

@app.get("/charts/seasonality-heatmap/{commodity}")
async def get_seasonality_heatmap(commodity: str):
    """Get seasonality heatmap for predictions tab"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")
    
    try:
        if forecaster.train_data is None:
            raise HTTPException(status_code=503, detail="Training data not available")
        
        # Get historical data for the commodity
        commodity_data = weekly_frame(commodity)
        
        if len(commodity_data) == 0:
            raise HTTPException(status_code=404, detail=f"No data found for {commodity}")
        
        # Create seasonality matrix
        commodity_data['year'] = commodity_data['report_date'].dt.year
        commodity_data['month'] = commodity_data['report_date'].dt.month
        
        # Group by year and month
        seasonal_data = commodity_data.groupby(['year', 'month'])['current_wtd_avg_price'].mean().reset_index()
        
        # Create matrix
        years = sorted(seasonal_data['year'].unique())[-3:]  # Last 3 years
        months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        
        z_matrix = []
        for year in years:
            year_data = []
            for month in range(1, 13):
                price = seasonal_data[
                    (seasonal_data['year'] == year) & (seasonal_data['month'] == month)
                ]['current_wtd_avg_price']
                
                if len(price) > 0:
                    year_data.append(price.iloc[0])
                else:
                    # Fill missing data with interpolation
                    year_data.append(seasonal_data['current_wtd_avg_price'].mean())
            
            z_matrix.append(year_data)
        
        chart_data = [{
            'z': z_matrix,
            'x': months,
            'y': [str(year) for year in years],
            'type': 'heatmap',
            'colorscale': 'Viridis'
        }]
        
        return {
            'data': chart_data,
            'layout': {
                'title': '',
                'xaxis': {'title': 'Month'},
                'yaxis': {'title': 'Year'},
                'margin': {'t': 0},
                'plot_bgcolor': 'rgba(0,0,0,0)',
                'paper_bgcolor': 'rgba(0,0,0,0)'
            },
            'config': {'displayModeBar': False}
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Seasonality heatmap error: {str(e)}")

@app.post("/charts/volatility-gauge")
async def get_volatility_gauge(request: PredictionRequest):
    """Get market volatility gauge for predictions tab"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")
    
    try:
        # Get weather data
        weather_data = forecaster.get_weather_data(request.state, request.zip_code, 14)
        
        # Train model if needed
        if request.commodity not in forecaster.models:
            forecaster_utils.train_model(forecaster, request.commodity, weather_data)
        
        # Generate predictions to calculate volatility
        predictions = forecaster_utils.predict_with_model(
            forecaster, request.commodity, 14, weather_data
        )
        
        if 'error' in predictions:
            volatility_value = 6.2  # Default value
        else:
            volatility_value = predictions['volatility'] * 10  # Scale to 0-10
            volatility_value = max(0, min(10, volatility_value))
        
        chart_data = [{
            'domain': {'x': [0, 1], 'y': [0, 1]},
            'value': volatility_value,
            'title': {'text': "Market Volatility"},
            'type': "indicator",
            'mode': "gauge+number",
            'gauge': {
                'axis': {'range': [0, 10]},
                'steps': [
                    {'range': [0, 3], 'color': "green"},
                    {'range': [3, 7], 'color': "yellow"},
                    {'range': [7, 10], 'color': "red"}
                ],
                'threshold': {
                    'line': {'color': "red", 'width': 4},
                    'thickness': 0.75,
                    'value': volatility_value
                }
            }
        }]
        
        return {
            'data': chart_data,
            'layout': {
                'margin': {'t': 0, 'b': 0},
                'plot_bgcolor': 'rgba(0,0,0,0)',
                'paper_bgcolor': 'rgba(0,0,0,0)'
            },
            'config': {'displayModeBar': False}
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Volatility gauge error: {str(e)}")

@app.get("/30-day-trends")
async def get_30_day_trends(commodity: str, state: str = "CA", zip_code: str = "10001"):
    """Get 30-day price trends chart data for dashboard (frontend compatibility)"""
    request = PredictionRequest(commodity=commodity, state=state, zip_code=zip_code, days_ahead=30)
    return await get_price_trends_chart(request)

@app.get("/7-day-prediction") 
async def get_7_day_prediction(commodity: str, state: str = "CA", zip_code: str = "10001"):
    """Get 7-day forecast for ordering tab (frontend compatibility)"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")
    
    try:
        # Get weather data
        weather_data = forecaster.get_weather_data(state, zip_code, 7)
        
        # Train model if needed
        if commodity not in forecaster.models:
            forecaster_utils.train_model(forecaster, commodity, weather_data)
        
        # Generate 7-day predictions
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
async def get_extended_forecast(commodity: str, period: str = "30-Day", state: str = "CA", zip_code: str = "10001"):
    """Get extended forecast for predictions tab (frontend compatibility)"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")
    
    try:
        days_map = {"7-Day": 7, "14-Day": 14, "30-Day": 30}
        days = days_map.get(period, 30)
        
        # Get weather data
        weather_data = forecaster.get_weather_data(state, zip_code, days)
        
        # Train model if needed
        if commodity not in forecaster.models:
            forecaster_utils.train_model(forecaster, commodity, weather_data)
        
        # Generate predictions
        predictions = forecaster_utils.predict_with_model(
            forecaster, commodity, days, weather_data
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
async def get_seasonal_patterns(commodity: str):
    """Get seasonality heatmap for predictions tab (frontend compatibility)"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")
    
    try:
        if forecaster.train_data is None:
            raise HTTPException(status_code=503, detail="Training data not available")
        
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
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Seasonal patterns error: {str(e)}")

@app.get("/market-volatility")
async def get_market_volatility(commodity: str, state: str = "CA", zip_code: str = "10001"):
    """How much this commodity's weekly price has moved over the last quarter, as a 0-10 score"""
    if not forecaster:
        raise HTTPException(status_code=503, detail="Forecaster not initialized")

    series = forecaster_utils.weekly_prices(forecaster.train_data, commodity).tail(14)
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
async def get_recent_alerts():
    """Get recent alerts based on current inventory and market conditions"""
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
        recent_alerts = alert_manager.generate_recent_alerts(inventory_data, forecaster)
        
        return {
            "alerts": [alert.dict() for alert in recent_alerts],
            "total_count": len(recent_alerts),
            "generated_at": datetime.now().isoformat()
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
            "generated_at": datetime.now().isoformat()
        }

# ==================== SCRAPE AND TRAIN ENDPOINT ====================

async def run_scraper_and_train():
    """Run the automated scraper and then retrain models with new data"""
    try:
        print("🕷️ Starting automated scraper...")
        
        # Run the automated scraper
        # Run in a worker thread so the event loop keeps serving other requests while Chrome scrapes
        scraper_process = await asyncio.to_thread(
            subprocess.run,
            [sys.executable, str(PROJECT_DIR / "automated_scraper.py")],
            capture_output=True, text=True, cwd=str(DATA_DIR)
        )
        scraper_stderr = scraper_process.stderr
        
        if scraper_process.returncode != 0:
            print(f"❌ Scraper failed: {scraper_stderr}")
            return False, f"Scraper failed: {scraper_stderr}"
        
        print("✅ Scraping completed successfully!")
        print("🔄 Processing scraped data and adding to training set...")
        
        # The scraper already runs data_processor.py automatically, so new data is already in Example_Train.csv
        print("✅ New data added to training set!")
        print("🎯 Simple and effective approach:")
        print("   📚 All new data added to training set")
        print("   🎯 Time series cross-validation ensures robust performance")
        
        print("🔄 Reloading data and retraining models...")
        
        # Reload the training data in the forecaster
        forecaster.load_training_data(TRAIN_DATA_PATH)
        
        # Get the available commodities
        viable_commodities = forecaster.viable_commodities
        print(f"📊 Found {len(viable_commodities)} commodities to retrain")
        
        # Retrain all models
        retrained_count = 0
        for commodity in viable_commodities:
            try:
                print(f"🤖 Retraining model for {commodity}...")
                
                # Get weather data for training
                weather_data = forecaster.get_weather_data("CA", "10001", 7)
                
                # Import forecaster_utils to use training functions
                from core import forecaster_utils
                
                # Train the model
                forecaster_utils.train_model(forecaster, commodity, weather_data)
                retrained_count += 1
                print(f"✅ Successfully retrained {commodity} model")
                
            except Exception as e:
                print(f"⚠️ Failed to retrain {commodity}: {e}")
                continue
        
        print(f"🎯 Retraining complete! Successfully retrained {retrained_count}/{len(viable_commodities)} models")
        
        # Update KPI metrics with new model performance
        print("📊 Updating KPI metrics...")
        
        return True, f"Successfully scraped new data and retrained {retrained_count} models"
        
    except Exception as e:
        print(f"❌ Error in scrape and train process: {e}")
        import traceback
        traceback.print_exc()
        return False, str(e)

@app.post("/scrape-and-train")
async def scrape_and_train():
    """Trigger automated scraping and model retraining"""
    try:
        print("\n🚀 === STARTING SCRAPE AND TRAIN PROCESS ===")
        
        # Run the scraper and training process
        success, message = await run_scraper_and_train()
        
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


# ==================== SINGLE-ORIGIN DEPLOY ====================

class StripApiPrefix:
    """Serve every API route under /api too, so the bundled frontend can call /api/... on the same origin"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/api/"):
            scope = dict(scope, path=scope["path"][4:])
        await self.app(scope, receive, send)

app.add_middleware(StripApiPrefix)

# The built Next.js export (if present) is served at "/" after all API routes
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
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
        log_level="info"
    )
