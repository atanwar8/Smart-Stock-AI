'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback } from 'react';
import { useCommodity } from '../contexts/CommodityContext';

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface KPIData {
  inventory_value: { value: string; change: string; trend: string };
  waste_reduction: { value: string; change: string; trend: string };
  monthly_savings: { value: string; change: string; trend: string };
  forecast_accuracy: { value: string; change: string; trend: string };
}

interface ChartData {
  data: Array<{
    x: string[];
    y: number[];
    type: string;
    mode?: string;
    name: string;
    line?: { color: string; width: number; dash?: string };
    marker?: { size: number };
    fillcolor?: string;
    fill?: string;
  }>;
  layout: {
    title: string;
    xaxis: { title: string };
    yaxis: { title: string };
    showlegend: boolean;
    legend?: { orientation: string; y: number };
    margin: { t: number };
    plot_bgcolor: string;
    paper_bgcolor: string;
  };
  config: { displayModeBar: boolean };
}

export default function DashboardTab() {
  const { selectedCommodity, setSelectedCommodity, selectedState, setSelectedState, selectedZipCode, setSelectedZipCode } = useCommodity();
  const [commodities, setCommodities] = useState<string[]>([]);
  const [kpiData, setKpiData] = useState<KPIData | null>(null);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weatherData, setWeatherData] = useState<any>(null);
  const [inventoryData, setInventoryData] = useState<any[]>([]);
  const [inventoryAlerts, setInventoryAlerts] = useState<any[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  const fetchChartData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('Fetching chart data for:', { selectedCommodity, selectedState, selectedZipCode });
      const response = await fetch(`http://localhost:8000/30-day-trends?commodity=${encodeURIComponent(selectedCommodity)}&state=${selectedState}&zip_code=${selectedZipCode}`);
      console.log('Fetching chart data from:', `http://localhost:8000/30-day-trends?commodity=${encodeURIComponent(selectedCommodity)}&state=${selectedState}&zip_code=${selectedZipCode}`);
      
      console.log('Chart data response status:', response.status);
      if (response.ok) {
        const data = await response.json();
        console.log('Chart data received:', data);
        setChartData(data);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      console.error('Failed to fetch chart data:', err);
      setError('Failed to load chart data. Using fallback data.');
      // Fallback to mock data
      setChartData({
        data: mockPriceData,
        layout: mockPriceLayout,
        config: {displayModeBar: false}
      });
    } finally {
      setLoading(false);
    }
  }, [selectedCommodity, selectedState, selectedZipCode]);

  // Fetch inventory data
  const fetchInventoryData = useCallback(async () => {
    setInventoryLoading(true);
    try {
      // Fetch inventory list
      const inventoryResponse = await fetch('http://localhost:8000/inventory/list');
      if (inventoryResponse.ok) {
        const inventoryData = await inventoryResponse.json();
        setInventoryData(inventoryData.inventory || []);
      }

      // Fetch inventory alerts
      const alertsResponse = await fetch('http://localhost:8000/dashboard/inventory-status');
      if (alertsResponse.ok) {
        const alertsData = await alertsResponse.json();
        setInventoryAlerts(alertsData.alerts || []);
      }
    } catch (err) {
      console.error('Failed to fetch inventory data:', err);
      // Use fallback data if fetch fails
      setInventoryAlerts([
        {
          commodity: "Tomatoes",
          status: "critical",
          days_left: 2,
          message: "Stock will run out in 2 days",
          icon: "exclamation-circle",
          color: "red"
        }
      ]);
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  // Fetch available commodities on component mount
  useEffect(() => {
    fetchCommodities();
    fetchKPIData();
    fetchInventoryData();
  }, [fetchInventoryData]);

  // Fetch chart data when commodity, state, or zip changes
  useEffect(() => {
    if (selectedCommodity && selectedState && selectedZipCode) {
      fetchChartData();
    }
  }, [selectedCommodity, selectedState, selectedZipCode, fetchChartData]);

  // Refresh inventory data every 30 seconds or when tab is focused
  useEffect(() => {
    const interval = setInterval(fetchInventoryData, 30000); // Refresh every 30 seconds
    
    const handleFocus = () => {
      fetchInventoryData(); // Refresh when tab gains focus
    };
    
    window.addEventListener('focus', handleFocus);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchInventoryData]);

  const fetchCommodities = async () => {
    try {
      console.log('Fetching commodities from backend...');
      const response = await fetch('http://localhost:8000/commodities');
      console.log('Commodities response status:', response.status);
      if (response.ok) {
        const data = await response.json();
        console.log('Commodities data received:', data);
        setCommodities(data.viable_commodities || []);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      console.error('Failed to fetch commodities:', err);
      // Fallback to default commodities
      const availableCommodities = ['Tomatoes', 'Lettuce', 'Onions', 'Potatoes', 'Carrots', 'Bell Peppers'];
      setCommodities(availableCommodities);
    }
  };

  // Fetch KPI data from backend
  const fetchKPIData = async () => {
    try {
      const response = await fetch('http://localhost:8000/dashboard/kpi');
      if (response.ok) {
        const data = await response.json();
        setKpiData(data);
        console.log('KPI data received:', data);
      }
    } catch (err) {
      console.error('Failed to fetch KPI data:', err);
      // Fallback to default KPI data
      setKpiData({
        forecast_accuracy: {
          value: "78.5%",
          trend: "+1.2% from last month"
        },
        active_commodities: {
          value: "0",
          trend: "No data"
        },
        avg_volatility: {
          value: "5.5/10",
          trend: "Stable"
        },
        cost_savings: {
          value: "$0",
          trend: "No data"
        }
      });
    }
  };



  // Initialize component data on mount
  useEffect(() => {
    fetchCommodities();
    fetchKPIData();
  }, []);

  // Fetch chart data when commodity changes
  useEffect(() => {
    fetchChartData();
  }, [fetchChartData]);

  // Fetch weather data when ZIP code changes
  const fetchWeatherData = useCallback(async () => {
    if (!selectedZipCode || selectedZipCode.length < 5) return;
    
    try {
      console.log('Fetching weather data for ZIP:', selectedZipCode);
      const response = await fetch('http://localhost:8000/weather', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state: selectedState,
          zip_code: selectedZipCode,
          days: 7
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('Weather data received:', data);
        setWeatherData(data);
      }
    } catch (err) {
      console.error('Failed to fetch weather data:', err);
      // Set fallback weather data
      setWeatherData({
        current: { temp: 72, humidity: 45, condition: 'Sunny' },
        forecast: 'Mostly sunny, 5% chance of rain'
      });
    }
  }, [selectedState, selectedZipCode]);

  // Fetch weather data when location changes
  useEffect(() => {
    fetchWeatherData();
  }, [fetchWeatherData]);
  // Mock chart data as fallback
  const mockPriceData = [
    {
      x: ['Jan 1', 'Jan 8', 'Jan 15', 'Jan 22', 'Jan 29', 'Feb 5', 'Feb 12'],
      y: [1.65, 1.72, 1.68, 1.75, 1.80, 1.85, 1.92],
      type: 'scatter' as const,
      mode: 'lines+markers' as const,
      name: 'Actual Price',
      line: { color: '#4F46E5', width: 3 },
      marker: { size: 8 }
    },
    {
      x: ['Feb 12', 'Feb 19', 'Feb 26', 'Mar 5'],
      y: [1.92, 2.05, 2.12, 2.15],
      type: 'scatter' as const,
      mode: 'lines+markers' as const,
      name: 'Forecast',
      line: { color: '#10B981', width: 3, dash: 'dot' },
      marker: { size: 8 }
    },
    {
      x: ['Feb 12', 'Feb 19', 'Feb 26', 'Mar 5'],
      y: [1.92, 2.15, 2.25, 2.30],
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: 'Upper Bound',
      line: { color: '#10B981', width: 1 },
      fillcolor: 'rgba(16, 185, 129, 0.2)',
      fill: 'tonexty' as const
    },
    {
      x: ['Feb 12', 'Feb 19', 'Feb 26', 'Mar 5'],
      y: [1.92, 1.95, 1.99, 2.00],
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: 'Lower Bound',
      line: { color: '#10B981', width: 1 },
      fillcolor: 'rgba(16, 185, 129, 0.2)'
    }
  ];

  const mockPriceLayout = {
    title: '',
    xaxis: { title: 'Date' },
    yaxis: { title: 'Price per lb ($)' },
    showlegend: true,
    legend: { orientation: 'h' as const, y: 1.1 },
    margin: { t: 0 },
    plot_bgcolor: 'rgba(0,0,0,0)',
    paper_bgcolor: 'rgba(0,0,0,0)'
  };

  return (
    <div className="tab-content active p-6">


      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Forecast Accuracy</p>
              <p className="text-2xl font-bold text-gray-900">
                {kpiData?.forecast_accuracy?.value || '0%'}
              </p>
              <p className="text-sm text-green-600 mt-1">
                {kpiData?.forecast_accuracy?.trend || 'No data'}
              </p>
            </div>
            <div className="p-3 bg-blue-50 rounded-full">
              <i className="fas fa-chart-line text-blue-600 text-xl"></i>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Commodities</p>
              <p className="text-2xl font-bold text-gray-900">
                {kpiData?.active_commodities?.value || '0'}
              </p>
              <p className="text-sm text-green-600 mt-1">
                {kpiData?.active_commodities?.trend || 'No data'}
              </p>
            </div>
            <div className="p-3 bg-green-50 rounded-full">
              <i className="fas fa-seedling text-green-600 text-xl"></i>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Volatility</p>
              <p className="text-2xl font-bold text-gray-900">
                {kpiData?.avg_volatility?.value || '0/10'}
              </p>
              <p className="text-sm text-gray-600 mt-1">
                {kpiData?.avg_volatility?.trend || 'No data'}
              </p>
            </div>
            <div className="p-3 bg-yellow-50 rounded-full">
              <i className="fas fa-chart-bar text-yellow-600 text-xl"></i>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Cost Savings</p>
              <p className="text-2xl font-bold text-gray-900">
                {kpiData?.cost_savings?.value || '$0'}
              </p>
              <p className="text-sm text-green-600 mt-1">
                {kpiData?.cost_savings?.trend || 'No data'}
              </p>
            </div>
            <div className="p-3 bg-purple-50 rounded-full">
              <i className="fas fa-dollar-sign text-purple-600 text-xl"></i>
            </div>
          </div>
        </div>
      </div>

      {/* Inventory Status and Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Inventory Status */}
        <div className="bg-white rounded-xl shadow-md p-6 lg:col-span-1">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">Inventory Status</h2>
            <button 
              onClick={fetchInventoryData}
              className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
            >
              {inventoryLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <div className="space-y-4">
            {inventoryLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                <span className="ml-2 text-gray-600">Loading inventory...</span>
              </div>
            ) : inventoryAlerts.length > 0 ? (
              inventoryAlerts.map((alert, index) => (
                <div key={index} className={`${
                  alert.color === 'red' ? 'alert-pulse bg-red-50 border-l-4 border-red-500' :
                  alert.color === 'yellow' ? 'bg-yellow-50 border-l-4 border-yellow-500' :
                  alert.color === 'green' ? 'bg-green-50 border-l-4 border-green-500' :
                  'bg-blue-50 border-l-4 border-blue-500'
                } p-4 rounded-r-lg`}>
              <div className="flex items-center">
                <div className="flex-shrink-0">
                      <i className={`fas fa-${alert.icon} ${
                        alert.color === 'red' ? 'text-red-500' :
                        alert.color === 'yellow' ? 'text-yellow-500' :
                        alert.color === 'green' ? 'text-green-500' :
                        'text-blue-500'
                      }`}></i>
                </div>
                <div className="ml-3">
                      <p className={`text-sm font-medium ${
                        alert.color === 'red' ? 'text-red-800' :
                        alert.color === 'yellow' ? 'text-yellow-800' :
                        alert.color === 'green' ? 'text-green-800' :
                        'text-blue-800'
                      }`}>
                        {alert.commodity} - {alert.status.charAt(0).toUpperCase() + alert.status.slice(1)}
                      </p>
                      <p className={`text-sm ${
                        alert.color === 'red' ? 'text-red-600' :
                        alert.color === 'yellow' ? 'text-yellow-600' :
                        alert.color === 'green' ? 'text-green-600' :
                        'text-blue-600'
                      }`}>
                        {alert.message}
                      </p>
              </div>
            </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <i className="fas fa-box-open text-4xl mb-2"></i>
                <p>No inventory items tracked</p>
                <p className="text-sm">Use Smart Ordering to add items</p>
              </div>
            )}
          </div>
        </div>

        {/* Price Chart */}
        <div className="bg-white rounded-xl shadow-md p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">30-Day Price Trends</h2>
            <div className="flex items-center space-x-4">
              {/* Commodity Selector */}
              <div className="flex items-center space-x-2">
                <label className="text-sm font-medium text-gray-700">Commodity:</label>
                <select 
                  value={selectedCommodity} 
                  onChange={(e) => setSelectedCommodity(e.target.value)}
                  className="border rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {commodities.map((commodity) => (
                    <option key={commodity} value={commodity}>{commodity}</option>
                  ))}
                </select>
              </div>
              {loading && (
                <div className="flex items-center text-sm text-gray-500">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600 mr-2"></div>
                  Loading...
                </div>
              )}
            </div>
          </div>
          <div className="h-64">
            {loading ? (
              <div className="flex items-center justify-center h-96">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
                <span className="ml-3 text-gray-600">Loading chart data for {selectedCommodity}...</span>
              </div>
            ) : (
              <Plot
                data={chartData?.data || mockPriceData}
                layout={chartData?.layout || mockPriceLayout}
                style={{width: '100%', height: '400px'}}
                config={chartData?.config || {displayModeBar: false}}
              />
            )}
          </div>
        </div>
      </div>



      {/* Inventory Table */}
      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">Inventory Overview</h2>
            <div className="flex items-center space-x-4">
              <button 
                onClick={fetchInventoryData}
                className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
              >
                {inventoryLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            <button className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">Export Data</button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          {inventoryLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <span className="ml-3 text-gray-600">Loading inventory data...</span>
            </div>
          ) : inventoryData.length > 0 ? (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ingredient</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Stock</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Daily Usage</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Days Left</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shelf Life</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price Trend</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
                {inventoryData.map((item, index) => (
                  <tr key={item.id || index} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10">
                          <img 
                            className="h-10 w-10 rounded-full" 
                            src={getIngredientImage(item.ingredient)} 
                            alt={item.ingredient} 
                          />
                    </div>
                    <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{item.ingredient}</div>
                          <div className="text-sm text-gray-500">Fresh, Local</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{item.current_stock}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{item.daily_usage}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{item.days_left}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{item.shelf_life}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        item.status_color === 'red' ? 'bg-red-100 text-red-800' :
                        item.status_color === 'yellow' ? 'bg-yellow-100 text-yellow-800' :
                        item.status_color === 'green' ? 'bg-green-100 text-green-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {item.status}
                      </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                        <i className={`fas fa-arrow-${item.price_trend?.direction || 'right'} ${
                          item.price_trend?.trend === 'rising' ? 'text-red-500' :
                          item.price_trend?.trend === 'falling' ? 'text-green-500' :
                          'text-gray-500'
                        } mr-1`}></i>
                        <span className="text-sm text-gray-900">
                          {item.price_trend?.percentage || '0%'} {item.price_trend?.trend === 'rising' ? 'next week' : item.price_trend?.trend === 'falling' ? 'next week' : ''}
                        </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button 
                        className={`${
                          item.action === 'Order Now' ? 'text-indigo-600 hover:text-indigo-900' : 'text-gray-600 hover:text-gray-900'
                        }`}
                        onClick={() => {
                          // Navigate to ordering tab or trigger order action
                          window.dispatchEvent(new CustomEvent('switchTab', { detail: { tab: 'ordering', commodity: item.ingredient } }));
                        }}
                      >
                        {item.action}
                      </button>
                </td>
              </tr>
                ))}
            </tbody>
          </table>
          ) : (
            <div className="text-center py-12">
              <i className="fas fa-clipboard-list text-4xl text-gray-400 mb-4"></i>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Inventory Data</h3>
              <p className="text-gray-500 mb-4">Start by adding inventory items in the Smart Ordering tab</p>
              <button 
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('switchTab', { detail: { tab: 'ordering' } }));
                }}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Go to Smart Ordering
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper function to get ingredient images
const getIngredientImage = (ingredient: string) => {
  const imageMap: { [key: string]: string } = {
    'Tomatoes': 'https://cdn-icons-png.flaticon.com/512/2909/2909896.png',
    'Lettuce': 'https://cdn-icons-png.flaticon.com/512/535/535183.png',
    'Onions, Green': 'https://cdn-icons-png.flaticon.com/512/2909/2909899.png',
    'Carrots': 'https://cdn-icons-png.flaticon.com/512/2909/2909897.png',
    'Broccoli': 'https://cdn-icons-png.flaticon.com/512/135/135620.png',
    'Cucumbers': 'https://cdn-icons-png.flaticon.com/512/765/765559.png',
    'Cauliflower': 'https://cdn-icons-png.flaticon.com/512/135/135588.png',
    'Cabbage': 'https://cdn-icons-png.flaticon.com/512/135/135578.png',
    'Asparagus': 'https://cdn-icons-png.flaticon.com/512/135/135669.png',
    'Sweet Potatoes': 'https://cdn-icons-png.flaticon.com/512/2909/2909897.png'
  };
  
  return imageMap[ingredient] || 'https://cdn-icons-png.flaticon.com/512/2909/2909896.png';
};
