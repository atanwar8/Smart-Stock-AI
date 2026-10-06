'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
import { useCommodity } from '../contexts/CommodityContext';

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

export default function PredictionsTab() {
  const { selectedCommodity, setSelectedCommodity, selectedZipCode } = useCommodity();
  const [forecastPeriod, setForecastPeriod] = useState('30-Day');
  const [extendedForecastData, setExtendedForecastData] = useState<any[]>([]);
  const [heatmapData, setHeatmapData] = useState<any[]>([]);
  const [volatilityData, setVolatilityData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [availableCommodities, setAvailableCommodities] = useState<string[]>([]);
  const [seasonalAnalysis, setSeasonalAnalysis] = useState<string>('');
  const [volatilityAnalysis, setVolatilityAnalysis] = useState<string>('');

  // Fetch available commodities on component mount
  useEffect(() => {
    fetchAvailableCommodities();
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

  // Fetch extended forecast data from backend
  const fetchExtendedForecast = async (commodity: string, period: string, zipCode: string) => {
    try {
      setLoading(true);
      const response = await fetch(`http://localhost:8000/extended-forecast?commodity=${encodeURIComponent(commodity)}&period=${period}&zip_code=${zipCode}`);
      if (response.ok) {
        const data = await response.json();
        console.log('Extended forecast data:', data);
        
        // Transform backend data for Plotly
        const transformedData = [
          {
            x: data.dates || ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
            y: data.base_forecast || [1.85, 1.92, 1.98, 2.05],
            type: 'scatter' as const,
            mode: 'lines+markers' as const,
            name: 'Base Forecast',
            line: { color: '#4F46E5', width: 3 }
          },
          {
            x: data.dates || ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
            y: data.optimistic || [1.85, 2.05, 2.15, 2.25],
            type: 'scatter' as const,
            mode: 'lines' as const,
            name: 'Optimistic',
            line: { color: '#10B981', width: 1, dash: 'dash' }
          },
          {
            x: data.dates || ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
            y: data.pessimistic || [1.85, 1.80, 1.75, 1.70],
            type: 'scatter' as const,
            mode: 'lines' as const,
            name: 'Pessimistic',
            line: { color: '#EF4444', width: 1, dash: 'dash' }
          }
        ];
        setExtendedForecastData(transformedData);
      }
    } catch (error) {
      console.error('Error fetching extended forecast:', error);
      // Fallback to mock data
      setExtendedForecastData([
        {
          x: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
          y: [1.85, 1.92, 1.98, 2.05],
          type: 'scatter' as const,
          mode: 'lines+markers' as const,
          name: 'Base Forecast',
          line: { color: '#4F46E5', width: 3 }
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch heatmap data from backend
  const fetchHeatmapData = async (commodity: string) => {
    try {
      const response = await fetch(`http://localhost:8000/seasonal-patterns?commodity=${encodeURIComponent(commodity)}`);
      if (response.ok) {
        const data = await response.json();
        console.log('Heatmap data:', data);
        
        const transformedData = [{
          z: data.price_matrix || [
            [1.50, 1.55, 1.60, 1.65, 1.70, 1.75, 1.80, 1.85, 1.80, 1.75, 1.70, 1.65],
            [1.55, 1.60, 1.65, 1.70, 1.75, 1.80, 1.85, 1.90, 1.85, 1.80, 1.75, 1.70],
            [1.60, 1.65, 1.70, 1.75, 1.80, 1.85, 1.90, 1.95, 1.90, 1.85, 1.80, 1.75]
          ],
          x: data.months || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
          y: data.years || ['2021', '2022', '2023'],
          type: 'heatmap' as const,
          colorscale: 'Viridis' as const
        }];
        setHeatmapData(transformedData);
        
        // Set the seasonal analysis text
        setSeasonalAnalysis(data.seasonal_analysis || `Historical price patterns for ${commodity} show typical seasonal variations with moderate price swings throughout the year.`);
      }
    } catch (error) {
      console.error('Error fetching heatmap data:', error);
      // Fallback to mock data
      setHeatmapData([{
        z: [
          [1.50, 1.55, 1.60, 1.65, 1.70, 1.75, 1.80, 1.85, 1.80, 1.75, 1.70, 1.65],
          [1.55, 1.60, 1.65, 1.70, 1.75, 1.80, 1.85, 1.90, 1.85, 1.80, 1.75, 1.70],
          [1.60, 1.65, 1.70, 1.75, 1.80, 1.85, 1.90, 1.95, 1.90, 1.85, 1.80, 1.75]
        ],
        x: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        y: ['2021', '2022', '2023'],
        type: 'heatmap' as const,
        colorscale: 'Viridis' as const
      }]);
      setSeasonalAnalysis(`Historical price patterns for ${commodity} show typical seasonal variations with moderate price swings throughout the year.`);
    }
  };

  // Fetch volatility data from backend
  const fetchVolatilityData = async (commodity: string) => {
    try {
      const response = await fetch(`http://localhost:8000/market-volatility?commodity=${encodeURIComponent(commodity)}`);
      if (response.ok) {
        const data = await response.json();
        console.log('Volatility data:', data);
        
        const transformedData = [{
          domain: { x: [0, 1], y: [0, 1] },
          value: data.volatility_score || 6.2,
          title: { text: "Market Volatility" },
          type: "indicator" as const,
          mode: "gauge+number" as const,
          gauge: {
            axis: { range: [0, 10] },
            steps: [
              { range: [0, 3], color: "green" },
              { range: [3, 7], color: "yellow" },
              { range: [7, 10], color: "red" }
            ],
            threshold: {
              line: { color: "red", width: 4 },
              thickness: 0.75,
              value: data.volatility_score || 6.2
            }
          }
        }];
        setVolatilityData(transformedData);
        
        // Set the volatility analysis text
        setVolatilityAnalysis(data.volatility_analysis || `Current market volatility is moderate (${data.volatility_score || 6.2}/10). Expect price swings based on ${commodity} market conditions.`);
      }
    } catch (error) {
      console.error('Error fetching volatility data:', error);
      // Fallback to mock data
      setVolatilityData([{
        domain: { x: [0, 1], y: [0, 1] },
        value: 6.2,
        title: { text: "Market Volatility" },
        type: "indicator" as const,
        mode: "gauge+number" as const,
        gauge: {
          axis: { range: [0, 10] },
          steps: [
            { range: [0, 3], color: "green" },
            { range: [3, 7], color: "yellow" },
            { range: [7, 10], color: "red" }
          ],
          threshold: {
            line: { color: "red", width: 4 },
            thickness: 0.75,
            value: 6.2
          }
        }
      }]);
      setVolatilityAnalysis(`Current market volatility is moderate (6.2/10). Expect price swings based on ${commodity} market conditions.`);
    }
  };

  // Load data when commodity or period changes
  useEffect(() => {
    if (selectedCommodity) {
      fetchExtendedForecast(selectedCommodity, forecastPeriod, selectedZipCode || '10001');
      fetchHeatmapData(selectedCommodity);
      fetchVolatilityData(selectedCommodity);
    }
  }, [selectedCommodity, forecastPeriod, selectedZipCode]);

  const extendedForecastLayout = {
    title: '',
    xaxis: { title: 'Week' },
    yaxis: { title: 'Price per lb ($)' },
    showlegend: true,
    legend: { orientation: 'h' as const, y: 1.1 },
    margin: { t: 0 },
    plot_bgcolor: 'rgba(0,0,0,0)',
    paper_bgcolor: 'rgba(0,0,0,0)'
  };



  const heatmapLayout = {
    title: '',
    xaxis: { title: 'Month' },
    yaxis: { title: 'Year' },
    margin: { t: 0 },
    plot_bgcolor: 'rgba(0,0,0,0)',
    paper_bgcolor: 'rgba(0,0,0,0)'
  };



  const gaugeLayout = {
    margin: { t: 0, b: 0 },
    plot_bgcolor: 'rgba(0,0,0,0)',
    paper_bgcolor: 'rgba(0,0,0,0)'
  };

  return (
    <div className="tab-content active p-6">
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Extended Price Forecasts</h2>
          <div className="flex space-x-2">
            <select 
              value={forecastPeriod}
              onChange={(e) => setForecastPeriod(e.target.value)}
              className="border rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="7-Day">7-Day</option>
              <option value="14-Day">14-Day</option>
              <option value="30-Day">30-Day</option>
            </select>
            <select 
              value={selectedCommodity}
              onChange={(e) => setSelectedCommodity(e.target.value)}
              className="border rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {availableCommodities.map((commodity) => (
                <option key={commodity} value={commodity}>{commodity}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="h-80">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500">Loading forecast data...</div>
            </div>
          ) : (
            <Plot
              data={extendedForecastData}
              layout={extendedForecastLayout}
              style={{ width: '100%', height: '100%' }}
              config={{ displayModeBar: false }}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Seasonal Pattern Heatmap */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Seasonal Price Patterns</h2>
          <div className="h-64">
            <Plot
              data={heatmapData}
              layout={heatmapLayout}
              style={{ width: '100%', height: '100%' }}
              config={{ displayModeBar: false }}
            />
          </div>
          <div className="mt-4 text-sm text-gray-600">
            <p>{seasonalAnalysis}</p>
          </div>
        </div>

        {/* Volatility Gauge */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Market Volatility</h2>
          <div className="flex justify-center">
            <div className="w-full h-64">
              <Plot
                data={volatilityData}
                layout={gaugeLayout}
                style={{ width: '100%', height: '100%' }}
                config={{ displayModeBar: false }}
              />
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-600">
            <p>{volatilityAnalysis}</p>
          </div>
        </div>
      </div>

      {/* Downloadable Reports */}
      <div className="bg-white rounded-xl shadow-md p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Download Reports</h2>
          <button className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">View All Reports</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-800">Weekly Price Report</h3>
                <p className="text-sm text-gray-500">Updated: Today</p>
              </div>
              <i className="fas fa-file-pdf text-red-500"></i>
            </div>
            <button className="mt-3 text-sm text-indigo-600 hover:text-indigo-800">Download PDF</button>
          </div>
          <div className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-800">Inventory Analysis</h3>
                <p className="text-sm text-gray-500">Updated: Yesterday</p>
              </div>
              <i className="fas fa-file-excel text-green-500"></i>
            </div>
            <button className="mt-3 text-sm text-indigo-600 hover:text-indigo-800">Download Excel</button>
          </div>
          <div className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-800">Monthly Forecast</h3>
                <p className="text-sm text-gray-500">Updated: 3 days ago</p>
              </div>
              <i className="fas fa-file-csv text-blue-500"></i>
            </div>
            <button className="mt-3 text-sm text-indigo-600 hover:text-indigo-800">Download CSV</button>
          </div>
        </div>
      </div>
    </div>
  );
}
