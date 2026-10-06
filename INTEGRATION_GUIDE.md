# SmartStock AI - Frontend-Backend Integration Guide

## Quick Start

### 1. Backend Setup

1. **Install Python dependencies:**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Configure environment:**
   - Edit `backend/.env` and add your OpenWeather API key
   - Get a free API key at: https://openweathermap.org/api

3. **Start the backend server:**
   ```bash
   cd backend
   python start_backend.py
   ```
   
   The API will be available at: http://localhost:8000

### 2. Frontend Setup

1. **Start the Next.js development server:**
   ```bash
   cd smartstock-nextjs
   npm run dev
   ```
   
   The frontend will be available at: http://localhost:3000

## API Endpoints

### Core Endpoints

- `GET /health` - Health check and status
- `GET /commodities` - List available commodities
- `POST /predict` - Generate price predictions
- `POST /weather` - Get weather data

### Dashboard Endpoints

- `GET /dashboard/kpi` - KPI metrics for dashboard cards
- `GET /dashboard/inventory-status` - Inventory status alerts
- `POST /charts/price-trends` - 30-day price trends chart
- `POST /charts/forecast-7day` - 7-day forecast chart
- `POST /charts/extended-forecast` - Extended forecast chart
- `GET /charts/seasonality-heatmap/{commodity}` - Seasonality heatmap
- `POST /charts/volatility-gauge` - Market volatility gauge

## Frontend Integration

### Example API Calls

```javascript
// Get available commodities
const commodities = await fetch('http://localhost:8000/commodities').then(r => r.json());

// Get price predictions
const prediction = await fetch('http://localhost:8000/predict', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    commodity: 'Tomatoes',
    state: 'CA',
    zip_code: '90210',
    days_ahead: 30
  })
}).then(r => r.json());

// Get chart data for dashboard
const chartData = await fetch('http://localhost:8000/charts/price-trends', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    commodity: 'Tomatoes',
    state: 'CA',
    zip_code: '90210',
    days_ahead: 30
  })
}).then(r => r.json());
```

### Updating Frontend Components

To connect your existing frontend components to the backend:

1. **Dashboard Tab** - Update `DashboardTab.tsx`:
   - Replace mock KPI data with `/dashboard/kpi`
   - Replace mock chart data with `/charts/price-trends`
   - Replace mock alerts with `/dashboard/inventory-status`

2. **Ordering Tab** - Update `OrderingTab.tsx`:
   - Replace mock forecast with `/charts/forecast-7day`
   - Add commodity/location form inputs
   - Connect to `/predict` endpoint

3. **Predictions Tab** - Update `PredictionsTab.tsx`:
   - Replace mock extended forecast with `/charts/extended-forecast`
   - Replace mock heatmap with `/charts/seasonality-heatmap/{commodity}`
   - Replace mock volatility with `/charts/volatility-gauge`

### Sample Integration Code

```typescript
// In your React components
const [chartData, setChartData] = useState(null);

useEffect(() => {
  const fetchChartData = async () => {
    try {
      const response = await fetch('http://localhost:8000/charts/price-trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commodity: selectedCommodity,
          state: selectedState,
          zip_code: selectedZipCode,
          days_ahead: 30
        })
      });
      
      const data = await response.json();
      setChartData(data);
    } catch (error) {
      console.error('Failed to fetch chart data:', error);
    }
  };

  fetchChartData();
}, [selectedCommodity, selectedState, selectedZipCode]);

// Use chartData in your Plotly component
{chartData && (
  <Plot
    data={chartData.data}
    layout={chartData.layout}
    config={chartData.config}
  />
)}
```

## Environment Variables

### Backend (.env)
```
OPENWEATHER_API_KEY=your_api_key_here
API_HOST=localhost
API_PORT=8000
DEBUG=True
TRAIN_DATA_PATH=../Example_Train.csv
TEST_DATA_PATH=../Example_Test.csv
USDA_COMMODITY_PATH=../usda_commodity.csv
```

### Frontend (if needed)
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Testing the Integration

1. **Start both servers:**
   - Backend: `cd backend && python start_backend.py`
   - Frontend: `cd smartstock-nextjs && npm run dev`

2. **Test API endpoints:**
   - Visit http://localhost:8000/docs for interactive API documentation
   - Test health check: http://localhost:8000/health
   - Test commodities: http://localhost:8000/commodities

3. **Test frontend:**
   - Visit http://localhost:3000
   - Navigate through all tabs
   - Check browser console for any errors

## Troubleshooting

### Common Issues

1. **CORS errors:**
   - Backend is configured to allow localhost:3000
   - Make sure both servers are running

2. **Missing dependencies:**
   - Run `pip install -r requirements.txt` in backend
   - Run `npm install` in frontend

3. **Data file errors:**
   - Ensure CSV files are in the project root
   - Check file paths in .env

4. **Weather API errors:**
   - Add your OpenWeather API key to .env
   - Check API key validity

### Performance Notes

- First prediction request may take longer (model training)
- Subsequent requests for the same commodity are faster
- Weather data is cached for 6 hours
- Models are cached in memory

## Next Steps

1. Replace mock data in frontend components with API calls
2. Add error handling and loading states
3. Add user input forms for commodity/location selection
4. Test with real OpenWeather API key
5. Deploy to production environment

## API Documentation

Full interactive API documentation is available at:
http://localhost:8000/docs (when backend is running)
