interface SidebarProps {
  activeTab: string;
  sidebarCollapsed: boolean;
  onTabChange: (tabId: string) => void;
  onToggleSidebar: () => void;
}

export default function Sidebar({ activeTab, sidebarCollapsed, onTabChange, onToggleSidebar }: SidebarProps) {
  return (
    <div className={`sidebar bg-indigo-800 text-white flex flex-col h-full ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="p-4 flex items-center justify-between border-b border-indigo-700">
        <div className="flex items-center">
          <i className="fas fa-robot text-2xl mr-3"></i>
          <span className="nav-text text-xl font-bold">SmartStock AI</span>
        </div>
        <button onClick={onToggleSidebar} className="text-white focus:outline-none">
          <i className="fas fa-bars"></i>
        </button>
      </div>
      
      <nav className="flex-1 overflow-y-auto py-4">
        <div className="px-4 mb-6">
          <div className="text-xs uppercase text-indigo-300 font-semibold mb-2 nav-text">Navigation</div>
          <ul>
            <li>
              <button
                onClick={() => onTabChange('dashboard')}
                className={`w-full text-left flex items-center py-2 px-3 rounded-lg ${
                  activeTab === 'dashboard' 
                    ? 'bg-indigo-700 text-white' 
                    : 'hover:bg-indigo-700 text-indigo-200 hover:text-white'
                }`}
              >
                <i className="fas fa-tachometer-alt mr-3"></i>
                <span className="nav-text">Dashboard</span>
              </button>
            </li>
            <li>
              <button
                onClick={() => onTabChange('ordering')}
                className={`w-full text-left flex items-center py-2 px-3 rounded-lg ${
                  activeTab === 'ordering' 
                    ? 'bg-indigo-700 text-white' 
                    : 'hover:bg-indigo-700 text-indigo-200 hover:text-white'
                }`}
              >
                <i className="fas fa-shopping-cart mr-3"></i>
                <span className="nav-text">Smart Ordering</span>
              </button>
            </li>
            <li>
              <button
                onClick={() => onTabChange('predictions')}
                className={`w-full text-left flex items-center py-2 px-3 rounded-lg ${
                  activeTab === 'predictions' 
                    ? 'bg-indigo-700 text-white' 
                    : 'hover:bg-indigo-700 text-indigo-200 hover:text-white'
                }`}
              >
                <i className="fas fa-chart-line mr-3"></i>
                <span className="nav-text">Predictions</span>
              </button>
            </li>
            <li>
              <button
                onClick={() => onTabChange('alerts')}
                className={`w-full text-left flex items-center py-2 px-3 rounded-lg ${
                  activeTab === 'alerts' 
                    ? 'bg-indigo-700 text-white' 
                    : 'hover:bg-indigo-700 text-indigo-200 hover:text-white'
                }`}
              >
                <i className="fas fa-bell mr-3"></i>
                <span className="nav-text">Alerts</span>
              </button>
            </li>
            <li>
              <button
                onClick={() => onTabChange('scrape')}
                className={`w-full text-left flex items-center py-2 px-3 rounded-lg ${
                  activeTab === 'scrape' 
                    ? 'bg-indigo-700 text-white' 
                    : 'hover:bg-indigo-700 text-indigo-200 hover:text-white'
                }`}
              >
                <i className="fas fa-sync mr-3"></i>
                <span className="nav-text">Scrape Now</span>
              </button>
            </li>
          </ul>
        </div>
        
        <div className="px-4 mb-6">
          <div className="text-xs uppercase text-indigo-300 font-semibold mb-2 nav-text">Settings</div>
          <ul>
            <li>
              <button className="w-full text-left flex items-center py-2 px-3 rounded-lg hover:bg-indigo-700 text-indigo-200 hover:text-white">
                <i className="fas fa-cog mr-3"></i>
                <span className="nav-text">Settings</span>
              </button>
            </li>
            <li>
              <button className="w-full text-left flex items-center py-2 px-3 rounded-lg hover:bg-indigo-700 text-indigo-200 hover:text-white">
                <i className="fas fa-question-circle mr-3"></i>
                <span className="nav-text">Help</span>
              </button>
            </li>
          </ul>
        </div>
      </nav>
      
      <div className="p-4 border-t border-indigo-700">
        <div className="flex items-center">
          <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center mr-2">
            <i className="fas fa-user text-white text-sm"></i>
          </div>
          <div className="nav-text">
            <div className="text-sm font-medium">Aryan Tanwar</div>
            <div className="text-xs text-indigo-300">Restaurant Owner</div>
          </div>
        </div>
      </div>
    </div>
  );
}
