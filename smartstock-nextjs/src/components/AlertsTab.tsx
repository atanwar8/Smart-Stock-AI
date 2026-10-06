import { useState, useEffect } from 'react';

interface AlertSettings {
  low_stock_threshold: number;
  price_change_alert: number;
  spoilage_warning: number;
  email_notifications: boolean;
  sms_notifications: boolean;
  push_notifications: boolean;
  alert_frequency: string;
}

interface AlertItem {
  id: string;
  type: string;
  title: string;
  message: string;
  timestamp: string;
  commodity?: string;
}

const getAlertColor = (type: string): string => {
  switch (type) {
    case 'critical': return 'border-red-500';
    case 'warning': return 'border-yellow-500';
    case 'info': return 'border-blue-500';
    case 'success': return 'border-green-500';
    case 'system': return 'border-purple-500';
    default: return 'border-gray-500';
  }
};

export default function AlertsTab() {
  const [settings, setSettings] = useState<AlertSettings>({
    low_stock_threshold: 1,
    price_change_alert: 1.0,
    spoilage_warning: 1,
    email_notifications: true,
    sms_notifications: true,
    push_notifications: false,
    alert_frequency: 'immediate'
  });

  const [recentAlerts, setRecentAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState('');

  // Load alert settings on component mount
  useEffect(() => {
    fetchAlertSettings();
    fetchRecentAlerts();
  }, []);

  const fetchAlertSettings = async () => {
    try {
      const response = await fetch('http://localhost:8000/alerts/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      }
    } catch (error) {
      console.error('Error fetching alert settings:', error);
    }
  };

  const fetchRecentAlerts = async () => {
    try {
      setAlertsLoading(true);
      const response = await fetch('http://localhost:8000/alerts/recent');
      if (response.ok) {
        const data = await response.json();
        setRecentAlerts(data.alerts);
      }
    } catch (error) {
      console.error('Error fetching recent alerts:', error);
    } finally {
      setAlertsLoading(false);
    }
  };

  const saveAlertSettings = async () => {
    try {
      setLoading(true);
      setSaveMessage('');

      const response = await fetch('http://localhost:8000/alerts/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        const data = await response.json();
        setSaveMessage('Settings saved successfully!');
        
        // Refresh alerts since thresholds may have changed
        setTimeout(() => {
          fetchRecentAlerts();
        }, 1000);
      } else {
        setSaveMessage('Error: Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving alert settings:', error);
      setSaveMessage('Error: Network error occurred');
    } finally {
      setLoading(false);
      
      // Clear message after 3 seconds
      setTimeout(() => {
        setSaveMessage('');
      }, 3000);
    }
  };

  const handleSettingChange = (key: keyof AlertSettings, value: any) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleFrequencyChange = (frequency: string) => {
    setSettings(prev => ({
      ...prev,
      alert_frequency: frequency
    }));
  };

  return (
    <div className="tab-content active p-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Alert Configuration */}
        <div className="bg-white rounded-xl shadow-md p-6 lg:col-span-1">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Alert Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Low Stock Threshold</label>
              <select 
                value={settings.low_stock_threshold}
                onChange={(e) => handleSettingChange('low_stock_threshold', parseInt(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value={1}>1 day</option>
                <option value={2}>2 days</option>
                <option value={3}>3 days</option>
                <option value={5}>5 days</option>
                <option value={7}>7 days</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price Change Alert</label>
              <select 
                value={settings.price_change_alert}
                onChange={(e) => handleSettingChange('price_change_alert', parseFloat(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value={1}>1%</option>
                <option value={3}>3%</option>
                <option value={5}>5%</option>
                <option value={10}>10%</option>
                <option value={15}>15%</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Spoilage Warning</label>
              <select 
                value={settings.spoilage_warning}
                onChange={(e) => handleSettingChange('spoilage_warning', parseInt(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value={1}>1 day before</option>
                <option value={2}>2 days before</option>
                <option value={3}>3 days before</option>
              </select>
            </div>
            <div className="pt-2">
              <button 
                onClick={saveAlertSettings}
                disabled={loading}
                className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-indigo-400 disabled:cursor-not-allowed"
              >
                {loading ? 'Saving...' : 'Save Settings'}
              </button>
              {saveMessage && (
                <p className={`mt-2 text-sm ${
                  saveMessage.includes('Error') ? 'text-red-600' : 'text-green-600'
                }`}>
                  {saveMessage}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Notification Channels */}
        <div className="bg-white rounded-xl shadow-md p-6 lg:col-span-1">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Notification Channels</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <i className="fas fa-envelope text-gray-600 mr-3"></i>
                <span className="text-sm font-medium text-gray-700">Email</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={settings.email_notifications}
                  onChange={(e) => handleSettingChange('email_notifications', e.target.checked)}
                  className="sr-only peer" 
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <i className="fas fa-mobile-alt text-gray-600 mr-3"></i>
                <span className="text-sm font-medium text-gray-700">SMS</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={settings.sms_notifications}
                  onChange={(e) => handleSettingChange('sms_notifications', e.target.checked)}
                  className="sr-only peer" 
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <i className="fas fa-bell text-gray-600 mr-3"></i>
                <span className="text-sm font-medium text-gray-700">Push Notification</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={settings.push_notifications}
                  onChange={(e) => handleSettingChange('push_notifications', e.target.checked)}
                  className="sr-only peer" 
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
            <div className="pt-6">
              <h3 className="text-md font-medium text-gray-700 mb-2">Alert Frequency</h3>
              <div className="flex space-x-2">
                <button 
                  onClick={() => handleFrequencyChange('immediate')}
                  className={`px-3 py-1 rounded-lg text-sm ${
                    settings.alert_frequency === 'immediate' 
                      ? 'bg-indigo-100 text-indigo-800' 
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  }`}
                >
                  Immediate
                </button>
                <button 
                  onClick={() => handleFrequencyChange('daily')}
                  className={`px-3 py-1 rounded-lg text-sm ${
                    settings.alert_frequency === 'daily' 
                      ? 'bg-indigo-100 text-indigo-800' 
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  }`}
                >
                  Daily Digest
                </button>
                <button 
                  onClick={() => handleFrequencyChange('weekly')}
                  className={`px-3 py-1 rounded-lg text-sm ${
                    settings.alert_frequency === 'weekly' 
                      ? 'bg-indigo-100 text-indigo-800' 
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  }`}
                >
                  Weekly Summary
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Alert Log */}
        <div className="bg-white rounded-xl shadow-md p-6 lg:col-span-1">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">Recent Alerts</h2>
            <button 
              onClick={fetchRecentAlerts}
              className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
              disabled={alertsLoading}
            >
              {alertsLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          <div className="space-y-4">
            {alertsLoading ? (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="text-sm text-gray-500 mt-2">Loading alerts...</p>
              </div>
            ) : recentAlerts.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-gray-500">No recent alerts available</p>
              </div>
            ) : (
              recentAlerts.map((alert) => (
                <div key={alert.id} className={`border-l-4 ${getAlertColor(alert.type)} pl-4 py-2`}>
                  <div className="flex justify-between">
                    <p className="text-sm font-medium text-gray-800">{alert.title}</p>
                    <span className="text-xs text-gray-500">{alert.timestamp}</span>
                  </div>
                  <p className="text-sm text-gray-600">{alert.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
