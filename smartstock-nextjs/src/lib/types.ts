// Response shapes of the FastAPI backend (backend/main.py)

export interface Health {
  status: string;
  forecaster_ready: boolean;
  models_trained: number;
  viable_commodities: number;
  training_rows?: number;
  latest_data_date?: string | null;
}

export interface Commodities {
  viable_commodities: string[];
  units?: Record<string, string>; // e.g. "per lb", "each", "2 lb bag"
}

export interface KpiTile {
  value: string;
  trend: string;
}

export interface Kpis {
  forecast_accuracy: KpiTile & {
    models_trained?: number;
    // skill_pct: how much smaller the model's error is than repeating last week's price
    accuracy_details?: Record<string, { accuracy_pct: number; r2_score: number; mae: number; skill_pct: number }>;
  };
  active_commodities: KpiTile;
  avg_volatility: KpiTile;
  cost_savings: KpiTile;
}

export interface PlotlyTrace {
  x: string[];
  y: number[];
  name: string;
}

export interface TrendChart {
  data: PlotlyTrace[];
}

export interface InventoryRow {
  id: string;
  ingredient: string;
  current_stock: string; // "40.0 lbs"
  daily_usage: string; // "12.0 lbs/day"
  days_left: string; // "3.3 days"
  shelf_life: string; // "7 days"
  status: string; // "Critical" | "High" | "Good" | "Opportunity"
  status_color: 'red' | 'yellow' | 'green' | 'blue';
  price_trend: { trend: 'rising' | 'falling' | 'stable'; percentage: string; direction: string };
  action: string;
}

export interface InventoryStatus {
  commodity: string;
  status: string;
  days_left: number;
  message: string;
  color: 'red' | 'yellow' | 'green' | 'blue';
}

export interface WeatherImpact {
  impact: 'positive' | 'negative' | 'neutral';
  explanation: string;
  total_impact: number;
}

export interface Weather {
  city: string;
  state: string;
  zip_code: string;
  current_temp: number;
  current_humidity: number;
  current_condition: string;
  forecast: { date: string; temp_high: number; temp_low: number; humidity: number; condition: string }[];
}

export interface SevenDay {
  commodity: string;
  predictions: { day: string; price: number }[];
  dates: string[];
  weather_impact?: WeatherImpact;
}

export interface Recommendation {
  commodity: string;
  recommended_quantity: number;
  current_price: number;
  total_cost: number;
  urgency: 'high' | 'medium' | 'low' | string;
  reason: string;
  price_trend: string;
  trend_percentage: number;
  weather_impact?: WeatherImpact;
  current_stock: number;
  current_days_left: number;
}

export interface ExtendedForecast {
  dates: string[];
  base_forecast: number[];
  optimistic: number[];
  pessimistic: number[];
  period: string;
}

export interface Seasonal {
  price_matrix: number[][];
  months: string[];
  years: (string | number)[];
  seasonal_analysis: string;
  peak_month: string;
  low_month: string;
  price_range: number;
}

export interface Volatility {
  volatility_score: number;
  volatility_level: string;
  volatility_analysis: string;
  expected_price_swing: number;
  period: string;
}

export interface AlertItem {
  id: string;
  type: 'critical' | 'warning' | 'info' | 'success' | 'system' | string;
  title: string;
  message: string;
  timestamp: string;
  commodity?: string | null;
}

export interface AlertSettings {
  low_stock_threshold: number;
  price_change_alert: number;
  spoilage_warning: number;
  email_notifications: boolean;
  sms_notifications: boolean;
  push_notifications: boolean;
  alert_frequency: string;
}
