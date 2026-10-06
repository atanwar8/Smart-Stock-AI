'use client';

import { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import DashboardTab from './DashboardTab';
import OrderingTab from './OrderingTab';
import PredictionsTab from './PredictionsTab';
import AlertsTab from './AlertsTab';
import ScrapeTab from './ScrapeTab';
import { CommodityProvider } from '../contexts/CommodityContext';

export default function SmartStockDashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
  };

  useEffect(() => {
    // Load Font Awesome CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
    document.head.appendChild(link);

    return () => {
      if (document.head.contains(link)) {
        document.head.removeChild(link);
      }
    };
  }, []);

  const getTabTitle = () => {
    switch (activeTab) {
      case 'dashboard': return 'Dashboard';
      case 'ordering': return 'Smart Ordering';
      case 'predictions': return 'Predictions';
      case 'alerts': return 'Alerts';
      case 'scrape': return 'Scrape Now';
      default: return 'Dashboard';
    }
  };

  return (
    <CommodityProvider>
      <div className="bg-gray-50">
      <style jsx global>{`
        .sidebar {
          transition: all 0.3s;
        }
        .sidebar.collapsed {
          width: 70px;
        }
        .sidebar.collapsed .nav-text {
          display: none;
        }
        .main-content {
          transition: margin-left 0.3s;
        }
        .card-hover:hover {
          transform: translateY(-5px);
          box-shadow: 0 10px 20px rgba(0,0,0,0.1);
        }
        .alert-pulse {
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.4); }
          70% { box-shadow: 0 0 0 10px rgba(220, 38, 38, 0); }
          100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
        }
        .smooth-transition {
          transition: all 0.3s ease;
        }
        .tab-content {
          display: none;
        }
        .tab-content.active {
          display: block;
          animation: fadeIn 0.5s;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      <div className="flex h-screen overflow-hidden">
        <Sidebar 
          activeTab={activeTab}
          sidebarCollapsed={sidebarCollapsed}
          onTabChange={handleTabChange}
          onToggleSidebar={toggleSidebar}
        />

        <div className="main-content flex-1 overflow-y-auto">
          <Header title={getTabTitle()} />
          
          {activeTab === 'dashboard' && <DashboardTab />}
          {activeTab === 'ordering' && <OrderingTab />}
          {activeTab === 'predictions' && <PredictionsTab />}
          {activeTab === 'alerts' && <AlertsTab />}
          {activeTab === 'scrape' && <ScrapeTab />}
        </div>
      </div>
    </div>
    </CommodityProvider>
  );
}
