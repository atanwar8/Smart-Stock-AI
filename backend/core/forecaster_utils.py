#!/usr/bin/env python3
"""
SmartStock AI - Forecaster Utilities
Additional methods for the forecaster class
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Tuple
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

# Handle ML library imports with better error handling
try:
    import lightgbm as lgb
    LIGHTGBM_AVAILABLE = True
except Exception as e:
    LIGHTGBM_AVAILABLE = False
    lgb = None  # Set to None for safe checking

try:
    import xgboost as xgb
    XGBOOST_AVAILABLE = True
except Exception as e:
    XGBOOST_AVAILABLE = False
    xgb = None  # Set to None for safe checking


def create_features(df: pd.DataFrame, commodity: str = None, weather_data: Dict = None) -> pd.DataFrame:
    """Create comprehensive feature set for ML models"""
    df = df.copy()
    
    # Ensure report_date is datetime
    if 'report_date' in df.columns:
        df['report_date'] = pd.to_datetime(df['report_date'])
        df = df.sort_values('report_date')
    
    # Time-based features
    if 'report_date' in df.columns:
        df['year'] = df['report_date'].dt.year
        df['month'] = df['report_date'].dt.month
        df['day'] = df['report_date'].dt.day
        df['day_of_year'] = df['report_date'].dt.dayofyear
        df['week_of_year'] = df['report_date'].dt.isocalendar().week
        df['quarter'] = df['report_date'].dt.quarter
        
        # Cyclical encoding
        df['month_sin'] = np.sin(2 * np.pi * df['month'] / 12)
        df['month_cos'] = np.cos(2 * np.pi * df['month'] / 12)
        df['day_sin'] = np.sin(2 * np.pi * df['day_of_year'] / 365)
        df['day_cos'] = np.cos(2 * np.pi * df['day_of_year'] / 365)
    
    # Price-based features
    if 'current_wtd_avg_price' in df.columns:
        # Lag features
        for lag in [1, 7, 14, 30]:
            df[f'price_lag_{lag}'] = df['current_wtd_avg_price'].shift(lag)
        
        # Rolling statistics
        for window in [7, 14, 30]:
            df[f'price_rolling_mean_{window}'] = df['current_wtd_avg_price'].rolling(window=window).mean()
            df[f'price_rolling_std_{window}'] = df['current_wtd_avg_price'].rolling(window=window).std()
            df[f'price_rolling_min_{window}'] = df['current_wtd_avg_price'].rolling(window=window).min()
            df[f'price_rolling_max_{window}'] = df['current_wtd_avg_price'].rolling(window=window).max()
        
        # Price change features
        df['price_change_1d'] = df['current_wtd_avg_price'].pct_change(1)
        df['price_change_7d'] = df['current_wtd_avg_price'].pct_change(7)
        df['price_change_30d'] = df['current_wtd_avg_price'].pct_change(30)
    
    # Add weather features if available
    if weather_data:
        df = add_weather_features(df, weather_data, commodity)
    
    return df


def add_weather_features(df: pd.DataFrame, weather_data: Dict, commodity: str = None) -> pd.DataFrame:
    """Add weather features to dataframe"""
    # Current weather
    df['current_temp'] = weather_data['current_temp']
    df['current_humidity'] = weather_data['current_humidity']
    
    # Weather forecast features (if available)
    if 'forecast' in weather_data and weather_data['forecast']:
        forecast = weather_data['forecast']
        
        # Average forecast features
        avg_temp = np.mean([day['temp_high'] for day in forecast[:7]])  # 7-day average
        avg_humidity = np.mean([day['humidity'] for day in forecast[:7]])
        
        df['forecast_temp_7d'] = avg_temp
        df['forecast_humidity_7d'] = avg_humidity
        
        # Temperature volatility
        temp_std = np.std([day['temp_high'] for day in forecast[:7]])
        df['temp_volatility_7d'] = temp_std
        
        # Weather condition encoding
        conditions = [day['condition'] for day in forecast[:7]]
        clear_days = sum(1 for c in conditions if 'clear' in c.lower())
        df['clear_days_7d'] = clear_days / len(conditions)
    
    return df


def prepare_model_data(df: pd.DataFrame, commodity: str, weather_data: Dict = None, is_training: bool = True) -> Tuple[pd.DataFrame, np.ndarray]:
    """Prepare data for model training/prediction"""
    # Filter for specific commodity
    if 'commodity' in df.columns:
        commodity_data = df[df['commodity'] == commodity].copy()
    else:
        commodity_data = df.copy()
    
    if len(commodity_data) == 0:
        raise ValueError(f"No data found for commodity: {commodity}")
    
    # Create features
    commodity_data = create_features(commodity_data, commodity, weather_data)
    
    # Define feature columns (exclude target and non-feature columns)
    exclude_cols = ['report_date', 'commodity', 'variety', 'unit', 'environment', 
                   'current_wtd_avg_price', 'region', 'class', 'organic',
                   'price_min', 'price_max', 'current_ad_count', 
                   'priorwk_ad_count', 'priorwk_wtd_avg_price',
                   'prioryr_ad_count', 'prioryr_wtd_avg_price']
    
    feature_cols = [col for col in commodity_data.columns if col not in exclude_cols]
    
    # Handle missing values
    commodity_data[feature_cols] = commodity_data[feature_cols].fillna(method='ffill').fillna(0)
    
    # Prepare features and target
    X = commodity_data[feature_cols]
    
    if is_training and 'current_wtd_avg_price' in commodity_data.columns:
        y = commodity_data['current_wtd_avg_price'].values
        # Remove rows where target is missing
        valid_idx = ~np.isnan(y)
        X = X[valid_idx]
        y = y[valid_idx]
    else:
        y = None
    
    return X, y


def train_model(forecaster, commodity: str, weather_data: Dict = None) -> Dict:
    """Train XGBoost or LightGBM model"""
    if forecaster.train_data is None:
        raise ValueError("Training data not loaded")
    
    try:
        # Prepare data
        X, y = prepare_model_data(forecaster.train_data, commodity, weather_data, is_training=True)
        
        if len(X) < 50:  # Minimum data requirement
            return train_simple_model(forecaster, commodity, forecaster.train_data[forecaster.train_data['commodity'] == commodity], weather_data)
        
        # Store feature names
        forecaster.feature_names[commodity] = list(X.columns)
        
        # Scale features
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        forecaster.scalers[commodity] = scaler
        
        # Time series split for validation
        tscv = TimeSeriesSplit(n_splits=3)
        scores = []
        
        for train_idx, val_idx in tscv.split(X_scaled):
            X_train, X_val = X_scaled[train_idx], X_scaled[val_idx]
            y_train, y_val = y[train_idx], y[val_idx]
            
            # Train model
            if forecaster.model_type == 'LightGBM' and LIGHTGBM_AVAILABLE:
                model = lgb.LGBMRegressor(
                    n_estimators=100,
                    learning_rate=0.1,
                    max_depth=6,
                    random_state=42,
                    verbose=-1
                )
            elif forecaster.model_type == 'XGBoost' and XGBOOST_AVAILABLE:
                model = xgb.XGBRegressor(
                    n_estimators=100,
                    learning_rate=0.1,
                    max_depth=6,
                    random_state=42,
                    verbosity=0
                )
            else:
                from sklearn.ensemble import RandomForestRegressor
                model = RandomForestRegressor(
                    n_estimators=100,
                    max_depth=6,
                    random_state=42
                )
            
            model.fit(X_train, y_train)
            y_pred = model.predict(X_val)
            
            # Calculate metrics
            mae = mean_absolute_error(y_val, y_pred)
            rmse = np.sqrt(mean_squared_error(y_val, y_pred))
            r2 = r2_score(y_val, y_pred)
            
            scores.append({'mae': mae, 'rmse': rmse, 'r2': r2})
        
        # Train final model on all data
        if forecaster.model_type == 'LightGBM' and LIGHTGBM_AVAILABLE:
            final_model = lgb.LGBMRegressor(
                n_estimators=100,
                learning_rate=0.1,
                max_depth=6,
                random_state=42,
                verbose=-1
            )
        elif forecaster.model_type == 'XGBoost' and XGBOOST_AVAILABLE:
            final_model = xgb.XGBRegressor(
                n_estimators=100,
                learning_rate=0.1,
                max_depth=6,
                random_state=42,
                verbosity=0
            )
        else:
            from sklearn.ensemble import RandomForestRegressor
            final_model = RandomForestRegressor(
                n_estimators=100,
                max_depth=6,
                random_state=42
            )
        
        final_model.fit(X_scaled, y)
        
        # Store model and performance
        avg_scores = {
            'mae': np.mean([s['mae'] for s in scores]),
            'rmse': np.mean([s['rmse'] for s in scores]),
            'r2': np.mean([s['r2'] for s in scores])
        }
        
        forecaster.models[commodity] = {
            'model': final_model,
            'type': forecaster.model_type,
            'performance': avg_scores,
            'trained_at': datetime.now()
        }
        
        forecaster.model_performance[commodity] = avg_scores
        
        print(f"✅ {commodity} model trained - R²: {avg_scores['r2']:.3f}, MAE: ${avg_scores['mae']:.3f}")
        
        return {
            'success': True,
            'model_type': forecaster.model_type,
            'performance': avg_scores,
            'feature_count': len(forecaster.feature_names[commodity])
        }
        
    except Exception as e:
        print(f"❌ Error training {commodity} model: {e}")
        return train_simple_model(forecaster, commodity, forecaster.train_data[forecaster.train_data['commodity'] == commodity], weather_data)


def train_simple_model(forecaster, commodity: str, commodity_data: pd.DataFrame, weather_data: Dict) -> Dict:
    """Train simple trend + seasonal model as fallback"""
    try:
        # Simple moving average with trend
        if 'current_wtd_avg_price' in commodity_data.columns:
            prices = commodity_data['current_wtd_avg_price'].dropna()
            
            if len(prices) > 0:
                forecaster.models[commodity] = {
                    'model': 'simple',
                    'type': 'Simple Model',
                    'mean_price': prices.mean(),
                    'trend': (prices.iloc[-1] - prices.iloc[0]) / len(prices) if len(prices) > 1 else 0,
                    'performance': {'mae': prices.std(), 'rmse': prices.std(), 'r2': 0.5},
                    'trained_at': datetime.now()
                }
                
                return {'success': True, 'model_type': 'Simple Model', 'performance': {'r2': 0.5}}
        
        return {'success': False, 'error': 'Insufficient data'}
        
    except Exception as e:
        return {'success': False, 'error': str(e)}


def predict_with_model(forecaster, commodity: str, days_ahead: int, weather_data: Dict) -> Dict:
    """Generate predictions using trained model"""
    if commodity not in forecaster.models:
        return {'error': f'No model trained for {commodity}'}
    
    model_info = forecaster.models[commodity]
    
    # Get recent data for prediction
    if forecaster.train_data is None:
        return {'error': 'Training data not available'}
    
    commodity_data = forecaster.train_data[forecaster.train_data['commodity'] == commodity].copy()
    
    if len(commodity_data) == 0:
        return {'error': f'No data available for {commodity}'}
    
    # Sort by date and get recent data
    commodity_data = commodity_data.sort_values('report_date')
    recent_data = commodity_data.tail(60)  # Use last 60 days for context
    
    try:
        if model_info['type'] in ['LightGBM', 'XGBoost', 'RandomForest']:
            return predict_with_ml(forecaster, commodity, days_ahead, weather_data, model_info, recent_data)
        else:
            return predict_with_simple_model(forecaster, commodity, days_ahead, weather_data, model_info, recent_data)
            
    except Exception as e:
        print(f"Prediction error for {commodity}: {e}")
        return predict_with_simple_model(forecaster, commodity, days_ahead, weather_data, model_info, recent_data)


def predict_with_ml(forecaster, commodity: str, days_ahead: int, weather_data: Dict, model_info: Dict, recent_data: pd.DataFrame) -> Dict:
    """Generate predictions using XGBoost/LightGBM"""
    model = model_info['model']
    scaler = forecaster.scalers[commodity]
    feature_names = forecaster.feature_names[commodity]
    
    # Create future dates
    last_date = recent_data['report_date'].max()
    future_dates = [last_date + timedelta(days=i+1) for i in range(days_ahead)]
    
    predictions = []
    confidence_upper = []
    confidence_lower = []
    
    # Get last known price for context
    last_price = recent_data['current_wtd_avg_price'].iloc[-1]
    
    for i, future_date in enumerate(future_dates):
        # Create a row for prediction
        pred_row = pd.DataFrame({
            'report_date': [future_date],
            'commodity': [commodity],
            'current_wtd_avg_price': [last_price]  # Will be excluded from features
        })
        
        # Create features
        pred_features = create_features(pred_row, commodity, weather_data)
        
        # Ensure all required features are present
        for feature in feature_names:
            if feature not in pred_features.columns:
                pred_features[feature] = 0
        
        # Select and order features
        X_pred = pred_features[feature_names].fillna(0)
        X_pred_scaled = scaler.transform(X_pred)
        
        # Make prediction
        pred_price = model.predict(X_pred_scaled)[0]
        
        # Add some uncertainty based on model performance
        mae = model_info['performance']['mae']
        uncertainty = mae * (1 + i * 0.1)  # Increasing uncertainty over time
        
        predictions.append(float(max(0.1, pred_price)))  # Ensure positive prices and convert to Python float
        confidence_upper.append(float(max(0.1, pred_price + uncertainty)))
        confidence_lower.append(float(max(0.1, pred_price - uncertainty)))
        
        # Update last_price for next iteration
        last_price = pred_price
    
    # Calculate additional metrics
    price_volatility = float(np.std(predictions) / np.mean(predictions)) if predictions else 0.0
    avg_price = float(np.mean(predictions)) if predictions else 0.0
    
    # Weather impact analysis
    weather_impact = calculate_weather_impact(commodity, weather_data)
    
    return {
        'commodity': commodity,
        'model_type': model_info['type'],
        'predictions': predictions,
        'confidence_upper': confidence_upper,
        'confidence_lower': confidence_lower,
        'dates': [date.strftime('%Y-%m-%d') for date in future_dates],
        'volatility': price_volatility,
        'average_price': avg_price,
        'weather_impact': weather_impact,
        'performance': model_info['performance'],
        'feature_importance': get_feature_importance(forecaster, commodity)
    }


def predict_with_simple_model(forecaster, commodity: str, days_ahead: int, weather_data: Dict, model_info: Dict, recent_data: pd.DataFrame) -> Dict:
    """Generate predictions using simple model"""
    if 'mean_price' not in model_info:
        return {'error': 'Simple model not properly configured'}
    
    mean_price = model_info['mean_price']
    trend = model_info.get('trend', 0)
    
    # Generate simple predictions
    predictions = []
    future_dates = []
    last_date = recent_data['report_date'].max()
    
    for i in range(days_ahead):
        future_date = last_date + timedelta(days=i+1)
        future_dates.append(future_date.strftime('%Y-%m-%d'))
        
        # Simple trend + seasonal + random variation
        seasonal_factor = np.sin(2 * np.pi * future_date.timetuple().tm_yday / 365) * 0.1
        predicted_price = mean_price + (trend * i) + (seasonal_factor * mean_price) + np.random.normal(0, mean_price * 0.05)
        
        predictions.append(float(max(0.1, predicted_price)))
    
    # Simple confidence intervals
    uncertainty = float(mean_price * 0.15)  # 15% uncertainty
    confidence_upper = [float(p + uncertainty) for p in predictions]
    confidence_lower = [float(max(0.1, p - uncertainty)) for p in predictions]
    
    return {
        'commodity': commodity,
        'model_type': 'Simple Model',
        'predictions': predictions,
        'confidence_upper': confidence_upper,
        'confidence_lower': confidence_lower,
        'dates': future_dates,
        'volatility': float(np.std(predictions) / np.mean(predictions)),
        'average_price': float(np.mean(predictions)),
        'weather_impact': calculate_weather_impact(commodity, weather_data),
        'performance': model_info['performance']
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
