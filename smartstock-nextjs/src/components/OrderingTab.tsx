'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback } from 'react';
import { useCommodity } from '../contexts/CommodityContext';

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

export default function OrderingTab() {
  const { selectedCommodity, setSelectedCommodity, selectedZipCode, setSelectedZipCode } = useCommodity();
  const [zipCode, setZipCode] = useState(selectedZipCode);
  const [weatherData, setWeatherData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [forecastData, setForecastData] = useState<any>(null);
  const [availableCommodities, setAvailableCommodities] = useState<string[]>([]);
  
  // Inventory form state
  const [inventoryForm, setInventoryForm] = useState({
    currentStock: '',
    dailyUsage: '',
    maxCapacity: ''
  });
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryMessage, setInventoryMessage] = useState('');
  
  // Smart recommendation state
  const [smartRecommendation, setSmartRecommendation] = useState<any>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  
  // Inventory-based commodities for 7-day forecast
  const [inventoryCommodities, setInventoryCommodities] = useState<string[]>([]);
  const [forecastCommodity, setForecastCommodity] = useState<string>('');

  // Fetch available commodities on component mount
  useEffect(() => {
    fetchAvailableCommodities();
    fetchInventoryCommodities();
  }, []);

  const fetchAvailableCommodities = async () => {
    try {
      const response = await fetch('http://localhost:8000/commodities');
      if (response.ok) {
        const data = await response.json();
        setAvailableCommodities(data.viable_commodities || []);
        
        // Set default commodity if none selected
        if (!selectedCommodity && data.viable_commodities && data.viable_commodities.length > 0) {
          setSelectedCommodity(data.viable_commodities[0]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch commodities:', err);
      // Fallback to the USDA commodity list
      setAvailableCommodities(['Tomatoes', 'Lettuce', 'Carrots', 'Broccoli']);
    }
  };

  // Fetch commodities that are currently in inventory
  const fetchInventoryCommodities = async () => {
    try {
      const response = await fetch('http://localhost:8000/inventory/list');
      if (response.ok) {
        const data = await response.json();
        const inventoryItems = data.inventory || [];
        const commodityNames = inventoryItems.map((item: any) => item.ingredient);
        setInventoryCommodities(commodityNames);
        
        // Set default forecast commodity to first inventory item
        if (commodityNames.length > 0 && !forecastCommodity) {
          setForecastCommodity(commodityNames[0]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch inventory commodities:', err);
    }
  };

  // Update inventory and refresh inventory commodities
  const updateInventory = async () => {
    if (!selectedCommodity || !inventoryForm.currentStock || !inventoryForm.dailyUsage || !inventoryForm.maxCapacity) {
      setInventoryMessage('Please fill in all inventory fields');
      return;
    }

    setInventoryLoading(true);
    setInventoryMessage('');

    try {
      const response = await fetch('http://localhost:8000/inventory/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ingredient: selectedCommodity,
          current_stock: parseFloat(inventoryForm.currentStock),
          daily_usage: parseFloat(inventoryForm.dailyUsage),
          max_capacity: parseFloat(inventoryForm.maxCapacity),
          unit: 'lbs'
        })
      });

      if (response.ok) {
        const data = await response.json();
        setInventoryMessage(`✅ ${data.message}`);
        
        // Fetch updated smart recommendation
        fetchSmartRecommendation();
        
        // Refresh inventory commodities for 7-day forecast
        fetchInventoryCommodities();
        
        // Clear form after successful update
        setTimeout(() => {
          setInventoryMessage('');
        }, 3000);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      console.error('Failed to update inventory:', err);
      setInventoryMessage('❌ Failed to update inventory');
    } finally {
      setInventoryLoading(false);
    }
  };

  // Fetch smart recommendation
  const fetchSmartRecommendation = useCallback(async () => {
    if (!selectedCommodity) return;
    
    setRecommendationLoading(true);
    try {
      const response = await fetch(`http://localhost:8000/inventory/smart-recommendation/${encodeURIComponent(selectedCommodity)}?state=CA&zip_code=${zipCode}`);
      if (response.ok) {
        const data = await response.json();
        setSmartRecommendation(data);
      }
    } catch (err) {
      console.error('Failed to fetch smart recommendation:', err);
    } finally {
      setRecommendationLoading(false);
    }
  }, [selectedCommodity, zipCode]);

  // Confirm order
  const confirmOrder = async () => {
    if (!smartRecommendation) return;

    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/inventory/confirm-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ingredient: selectedCommodity,
          quantity: smartRecommendation.recommended_quantity,
          price_per_unit: smartRecommendation.current_price,
          unit: 'lbs'
        })
      });

      if (response.ok) {
        const data = await response.json();
        setInventoryMessage(`✅ ${data.message}`);
        
        // Refresh recommendation after order
        fetchSmartRecommendation();
        
        setTimeout(() => {
          setInventoryMessage('');
        }, 3000);
      }
    } catch (err) {
      console.error('Failed to confirm order:', err);
      setInventoryMessage('❌ Failed to confirm order');
    } finally {
      setLoading(false);
    }
  };

  // Fetch smart recommendation when commodity or zipcode changes
  useEffect(() => {
    fetchSmartRecommendation();
  }, [fetchSmartRecommendation]);

  // Weather-based logic for market factors
  const getWeatherIcon = (condition: string) => {
    const cond = condition?.toLowerCase() || '';
    if (cond.includes('clear') || cond.includes('sunny')) return 'fas fa-sun text-yellow-400';
    if (cond.includes('cloud')) return 'fas fa-cloud text-gray-400';
    if (cond.includes('rain') || cond.includes('storm')) return 'fas fa-cloud-rain text-blue-500';
    if (cond.includes('snow')) return 'fas fa-snowflake text-blue-300';
    if (cond.includes('fog') || cond.includes('mist')) return 'fas fa-smog text-gray-500';
    return 'fas fa-sun text-yellow-400'; // default
  };

  const calculateMarketFactors = (weather: any) => {
    if (!weather) return { sentiment: 65, cropGood: 78, cropFair: 15, cropPoor: 7 };
    
    const condition = weather.current_condition?.toLowerCase() || '';
    const temp = weather.current_temp || 70;
    const humidity = weather.current_humidity || 50;
    
    // Weather-based logic
    let sentimentScore = 65; // base
    let cropGood = 78;
    let cropFair = 15;
    let cropPoor = 7;
    
    // Bad weather reduces sentiment and crop conditions
    if (condition.includes('rain') || condition.includes('storm')) {
      sentimentScore -= 15;
      cropGood -= 20;
      cropFair += 10;
      cropPoor += 10;
    }
    
    // Extreme temperatures
    if (temp > 90 || temp < 32) {
      sentimentScore -= 10;
      cropGood -= 15;
      cropFair += 8;
      cropPoor += 7;
    }
    
    // High humidity can be bad for some crops
    if (humidity > 80) {
      sentimentScore -= 5;
      cropGood -= 8;
      cropFair += 5;
      cropPoor += 3;
    }
    
    // Ensure values stay within bounds
    sentimentScore = Math.max(20, Math.min(85, sentimentScore));
    cropGood = Math.max(40, Math.min(85, cropGood));
    cropFair = Math.max(10, Math.min(40, cropFair));
    cropPoor = Math.max(5, Math.min(30, cropPoor));
    
    return { sentiment: sentimentScore, cropGood, cropFair, cropPoor };
  };

  // Fetch weather data when ZIP code changes
  const fetchWeatherData = useCallback(async () => {
    if (!zipCode || zipCode.length < 5) return;
    
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:8000/weather?zip_code=${zipCode}`);
      console.log('Weather API URL:', `http://localhost:8000/weather?zip_code=${zipCode}`);
      if (response.ok) {
        const data = await response.json();
        setWeatherData(data);
      }
    } catch (err) {
      console.error('Failed to fetch weather data:', err);
    } finally {
      setLoading(false);
    }
  }, [zipCode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchWeatherData();
    }, 500); // Debounce ZIP code input
    
    return () => clearTimeout(timer);
  }, [fetchWeatherData]);

  const marketFactors = calculateMarketFactors(weatherData);

  // Fetch 7-day forecast data for inventory commodities
  const fetch7DayForecast = useCallback(async () => {
    if (!forecastCommodity) return;
    
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:8000/7-day-prediction?commodity=${encodeURIComponent(forecastCommodity)}&zip_code=${zipCode}`);
      if (response.ok) {
        const data = await response.json();
        setForecastData(data);
      }
    } catch (err) {
      console.error('Failed to fetch 7-day forecast:', err);
    } finally {
      setLoading(false);
    }
  }, [forecastCommodity, zipCode]);

  // Fetch 7-day forecast when forecast commodity changes
  useEffect(() => {
    if (forecastCommodity) {
    fetch7DayForecast();
    }
  }, [fetch7DayForecast]);

  // Prepare chart data from API response or fallback
  const forecastChartData = forecastData ? [
    {
      x: forecastData.predictions?.map((p: any) => p.day) || ['Today', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'],
      y: forecastData.predictions?.map((p: any) => p.price) || [1.85, 1.88, 1.92, 1.95, 2.01, 2.05, 2.08],
      type: 'bar' as const,
      name: 'Predicted Price',
      marker: { color: '#4F46E5' }
    }
  ] : [
    {
      x: ['Today', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'],
      y: [1.85, 1.88, 1.92, 1.95, 2.01, 2.05, 2.08],
      type: 'bar' as const,
      name: 'Predicted Price',
      marker: { color: '#4F46E5' }
    }
  ];

  const forecastChartLayout = {
    title: '',
    xaxis: { title: 'Day' },
    yaxis: { title: 'Price per lb ($)' },
    showlegend: false,
    margin: { t: 0 },
    plot_bgcolor: 'rgba(0,0,0,0)',
    paper_bgcolor: 'rgba(0,0,0,0)'
  };

  return (
    <div className="tab-content active p-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Ingredient Selector and Stock Inputs */}
        <div className="bg-white rounded-xl shadow-md p-6 lg:col-span-1">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Ingredient Details</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Select Ingredient</label>
              <select 
                value={selectedCommodity} 
                onChange={(e) => setSelectedCommodity(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {availableCommodities.map((commodity) => (
                  <option key={commodity} value={commodity}>{commodity}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Stock (lbs)</label>
              <input 
                type="number" 
                value={inventoryForm.currentStock}
                onChange={(e) => setInventoryForm({...inventoryForm, currentStock: e.target.value})}
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                placeholder="Enter current stock" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Daily Usage (lbs)</label>
              <input 
                type="number" 
                value={inventoryForm.dailyUsage}
                onChange={(e) => setInventoryForm({...inventoryForm, dailyUsage: e.target.value})}
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                placeholder="Enter daily usage" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Storage Capacity (lbs)</label>
              <input 
                type="number" 
                value={inventoryForm.maxCapacity}
                onChange={(e) => setInventoryForm({...inventoryForm, maxCapacity: e.target.value})}
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                placeholder="Enter max capacity" 
              />
            </div>
            <button 
              onClick={updateInventory}
              disabled={inventoryLoading}
              className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {inventoryLoading ? 'Updating...' : 'Update Inventory'}
            </button>
            {inventoryMessage && (
              <div className={`text-sm p-2 rounded ${inventoryMessage.includes('✅') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {inventoryMessage}
              </div>
            )}
          </div>
        </div>



        {/* Market Factors */}
        <div className="bg-white rounded-xl shadow-md p-6 lg:col-span-1">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Market Factors</h2>
          <div className="space-y-6">
            {/* ZIP Code Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Location (ZIP Code)</label>
              <input 
                type="text" 
                value={zipCode}
                onChange={(e) => {
                  setZipCode(e.target.value);
                  setSelectedZipCode(e.target.value);
                }}
                placeholder="Enter ZIP code"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            
            {/* Weather Conditions */}
            <div>
              <h3 className="text-md font-medium text-gray-700 mb-2">Weather Conditions</h3>
              <div className="flex items-center space-x-4">
                <div className="text-4xl">
                  <i className={getWeatherIcon(weatherData?.current_condition)}></i>
                </div>
                <div>
                  <p className="text-sm text-gray-600">
                    {weatherData?.city || 'Location'}, {weatherData?.state || 'State'}
                  </p>
                  <p className="text-lg font-semibold">
                    {Math.round(weatherData?.current_temp || 72)}°F, {weatherData?.current_condition || 'Sunny'}
                  </p>
                  <p className="text-sm text-gray-600">
                    Humidity: {weatherData?.current_humidity || 45}%
                  </p>
                </div>
              </div>
              <div className="mt-2">
                <p className="text-sm text-gray-600">
                  {weatherData?.forecast ? 
                    `Next 7 days: ${weatherData.forecast[0]?.condition || 'Clear'}, High ${Math.round(weatherData.forecast[0]?.temp_high || 75)}°F` : 
                    'Next 7 days: Mostly sunny, 5% chance of rain'
                  }
                </p>
              </div>
            </div>
            
            {/* Market Sentiment */}
            <div>
              <h3 className="text-md font-medium text-gray-700 mb-2">Market Sentiment</h3>
              <div className="flex items-center space-x-2">
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div 
                    className={`h-2.5 rounded-full ${
                      marketFactors.sentiment >= 60 ? 'bg-green-600' : 
                      marketFactors.sentiment >= 40 ? 'bg-yellow-600' : 'bg-red-600'
                    }`} 
                    style={{width: `${marketFactors.sentiment}%`}}
                  ></div>
                </div>
                <span className="text-sm font-medium text-gray-700">
                  {marketFactors.sentiment}% {marketFactors.sentiment >= 60 ? 'Positive' : marketFactors.sentiment >= 40 ? 'Neutral' : 'Negative'}
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                Based on weather conditions and USDA reports
              </p>
            </div>
            
            {/* Crop Conditions */}
            <div>
              <h3 className="text-md font-medium text-gray-700 mb-2">Crop Conditions</h3>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-green-50 p-2 rounded-lg">
                  <p className="text-xs text-gray-500">Good</p>
                  <p className="font-semibold">{marketFactors.cropGood}%</p>
                </div>
                <div className="bg-yellow-50 p-2 rounded-lg">
                  <p className="text-xs text-gray-500">Fair</p>
                  <p className="font-semibold">{marketFactors.cropFair}%</p>
                </div>
                <div className="bg-red-50 p-2 rounded-lg">
                  <p className="text-xs text-gray-500">Poor</p>
                  <p className="font-semibold">{marketFactors.cropPoor}%</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Smart Order Recommendation */}
        <div className="bg-white rounded-xl shadow-md p-6 lg:col-span-1">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Smart Order Recommendation</h2>
          
          {recommendationLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <span className="ml-2 text-gray-600">Loading recommendation...</span>
            </div>
          ) : smartRecommendation ? (
            <>
              <div className={`border-l-4 p-4 rounded-r-lg mb-4 ${
                smartRecommendation.urgency === 'high' ? 'bg-red-50 border-red-500' :
                smartRecommendation.urgency === 'low' ? 'bg-blue-50 border-blue-500' :
                'bg-indigo-50 border-indigo-500'
              }`}>
            <div className="flex">
              <div className="flex-shrink-0">
                    <i className={`fas ${
                      smartRecommendation.urgency === 'high' ? 'fa-exclamation-triangle text-red-500' :
                      smartRecommendation.urgency === 'low' ? 'fa-info-circle text-blue-500' :
                      'fa-lightbulb text-indigo-500'
                    }`}></i>
              </div>
              <div className="ml-3">
                    <p className={`text-sm ${
                      smartRecommendation.urgency === 'high' ? 'text-red-700' :
                      smartRecommendation.urgency === 'low' ? 'text-blue-700' :
                      'text-indigo-700'
                    }`}>
                      <span className="font-semibold">AI Recommendation:</span> {smartRecommendation.reason}
                </p>
              </div>
            </div>
          </div>
              
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recommended Order Quantity</label>
                  <input 
                    type="number" 
                    value={smartRecommendation.recommended_quantity} 
                    className="w-full border rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                    readOnly 
                  />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Market Price</label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">$</span>
                    <input 
                      type="number" 
                      value={smartRecommendation.current_price} 
                      className="rounded-none rounded-r-lg border border-gray-300 w-full px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                      readOnly 
                    />
                <span className="inline-flex items-center px-3 rounded-r-lg border border-l-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">/lb</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Total Cost</label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">$</span>
                    <input 
                      type="number" 
                      value={smartRecommendation.total_cost} 
                      className="rounded-none rounded-r-lg border border-gray-300 w-full px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                      readOnly 
                    />
              </div>
            </div>
            <div className="pt-2">
                  <button 
                    onClick={confirmOrder}
                    disabled={loading}
                    className="w-full bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white inline-block mr-2"></div>
                        Processing...
                      </>
                    ) : (
                      <>
                <i className="fas fa-check-circle mr-2"></i> Confirm Order
                      </>
                    )}
              </button>
            </div>
          </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <i className="fas fa-chart-line text-4xl mb-2"></i>
              <p>Update inventory to get smart recommendations</p>
            </div>
          )}
        </div>
      </div>

      {/* 7-Day Forecast Plot */}
      <div className="bg-white rounded-xl shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">7-Day Price Forecast</h2>
          {inventoryCommodities.length > 0 ? (
          <div className="flex space-x-2">
              {inventoryCommodities.map((commodity) => (
              <button 
                key={commodity}
                  onClick={() => setForecastCommodity(commodity)}
                className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                    forecastCommodity === commodity 
                    ? 'bg-indigo-100 text-indigo-800' 
                    : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                }`}
              >
                {commodity}
              </button>
            ))}
          </div>
          ) : (
            <div className="text-sm text-gray-500">
              Add inventory items to see forecasts
            </div>
          )}
        </div>
        
        {inventoryCommodities.length > 0 ? (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                <span className="ml-3 text-gray-600">Loading forecast...</span>
              </div>
            ) : forecastData && forecastData.predictions ? (
          <Plot
                data={[
                  {
                    x: forecastData.predictions.map((p: any) => p.day),
                    y: forecastData.predictions.map((p: any) => p.price),
                    type: 'bar',
                    marker: { color: '#6366f1' },
                    name: `${forecastCommodity} Price`
                  }
                ]}
                layout={{
                  title: { text: `${forecastCommodity} - 7-Day Price Forecast` },
                  xaxis: { title: 'Days' },
                  yaxis: { title: 'Price ($)' },
                  showlegend: false,
                  margin: { t: 40 },
                  plot_bgcolor: 'rgba(0,0,0,0)',
                  paper_bgcolor: 'rgba(0,0,0,0)'
                }}
                style={{ width: '100%', height: '300px' }}
            config={{ displayModeBar: false }}
          />
            ) : (
              <div className="flex items-center justify-center py-12 text-gray-500">
                <i className="fas fa-chart-bar text-4xl mb-2"></i>
                <p>Select a commodity to view forecast</p>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <i className="fas fa-chart-line text-4xl mb-4"></i>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Inventory Items</h3>
            <p className="text-center mb-4">
              Add inventory items above to see their 7-day price forecasts here
            </p>
            <div className="text-sm text-gray-400">
              💡 Tip: Use the form above to add vegetables like Tomatoes, Lettuce, or Broccoli
            </div>
        </div>
        )}
      </div>
    </div>
  );
}
