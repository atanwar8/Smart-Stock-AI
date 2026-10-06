import React, { useState } from 'react';

const ScrapeTab: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [lastScrapeTime, setLastScrapeTime] = useState<string | null>(null);
  const [scrapeStatus, setScrapeStatus] = useState<'idle' | 'scraping' | 'processing' | 'training' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [progressDetail, setProgressDetail] = useState<string>('');

  const handleScrapeAndTrain = async () => {
    setIsLoading(true);
    setScrapeStatus('scraping');
    setStatusMessage('Initializing automated scraper...');
    setProgress(0);
    setProgressDetail('');

    try {
      const response = await fetch('/api/scrape-and-train', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Simulate progress for better UX
      const progressSteps = [
        { status: 'scraping', progress: 25, message: 'Scraping USDA market data...', detail: 'Connecting to USDA servers' },
        { status: 'processing', progress: 50, message: 'Processing scraped data...', detail: 'Cleaning and standardizing data' },
        { status: 'training', progress: 75, message: 'Retraining ML models...', detail: 'Updating XGBoost and LightGBM models' },
        { status: 'success', progress: 100, message: 'Process completed successfully', detail: 'Models updated with fresh data' },
      ];

      for (let i = 0; i < progressSteps.length; i++) {
        const step = progressSteps[i];
        setScrapeStatus(step.status as any);
        setStatusMessage(step.message);
        setProgressDetail(step.detail);
        
        // Animate progress
        for (let p = (i > 0 ? progressSteps[i-1].progress : 0); p <= step.progress; p += 2) {
          setProgress(p);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        // Wait at each step
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      const result = await response.json();
      
      if (result.success) {
        setScrapeStatus('success');
        setStatusMessage('Scraping and training completed successfully');
        setProgressDetail('All models have been updated with the latest data');
        setLastScrapeTime(new Date().toLocaleString());
        setProgress(100);
      } else {
        throw new Error(result.error || 'Unknown error occurred');
      }

    } catch (error) {
      console.error('Scrape and train error:', error);
      setScrapeStatus('error');
      setStatusMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setProgressDetail('Process failed - please try again');
      setProgress(0);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = () => {
    switch (scrapeStatus) {
      case 'success': return 'text-green-600';
      case 'error': return 'text-red-600';
      case 'scraping': case 'processing': case 'training': return 'text-blue-600';
      default: return 'text-gray-600';
    }
  };

  const getProgressColor = () => {
    switch (scrapeStatus) {
      case 'success': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      case 'scraping': case 'processing': case 'training': return 'bg-blue-500';
      default: return 'bg-gray-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
        <div className="flex items-center space-x-4 mb-4">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Data Scraping & Model Training</h2>
            <p className="text-sm text-gray-600">Automatically scrape fresh USDA data and retrain ML models</p>
          </div>
        </div>

        {lastScrapeTime && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg border">
            <p className="text-sm text-gray-600">
              <span className="font-medium">Last successful scrape:</span> {lastScrapeTime}
            </p>
          </div>
        )}
      </div>

      {/* Main Scrape Section */}
      <div className="bg-white rounded-lg shadow-sm p-8 border border-gray-200">
        <div className="text-center max-w-2xl mx-auto">
          <div className="mb-8">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mx-auto flex items-center justify-center mb-6">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-3">Scrape and Train Now</h3>
            <p className="text-gray-600 leading-relaxed">
              Click the button below to automatically scrape the latest USDA vegetable price data 
              and retrain your forecasting models with fresh market information.
            </p>
          </div>

          <button
            onClick={handleScrapeAndTrain}
            disabled={isLoading}
            className={`px-8 py-4 rounded-lg font-semibold text-white transition-all duration-200 ${
              isLoading 
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 hover:shadow-lg transform hover:-translate-y-0.5'
            }`}
          >
            {isLoading ? (
              <div className="flex items-center space-x-3">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Processing...</span>
              </div>
            ) : (
              'Scrape and Train Now'
            )}
          </button>
        </div>
      </div>

      {/* Progress Section */}
      {scrapeStatus !== 'idle' && (
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Process Status</h3>
          
          <div className="space-y-4">
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className={`text-sm font-medium ${getStatusColor()}`}>
                  {statusMessage}
                </span>
                <span className="text-sm text-gray-500">{progress}%</span>
              </div>
              
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full transition-all duration-500 ease-out ${getProgressColor()}`}
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              
              {progressDetail && (
                <p className="text-sm text-gray-600">{progressDetail}</p>
              )}
            </div>

            {/* Process Steps */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
              <div className={`p-4 rounded-lg border-2 transition-colors ${
                ['scraping', 'processing', 'training', 'success'].includes(scrapeStatus) 
                  ? 'border-green-200 bg-green-50' 
                  : 'border-gray-200 bg-gray-50'
              }`}>
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${
                    ['scraping', 'processing', 'training', 'success'].includes(scrapeStatus) ? 'bg-green-500' : 'bg-gray-300'
                  }`}></div>
                  <span className="text-sm font-medium">Scraping Data</span>
                </div>
              </div>

              <div className={`p-4 rounded-lg border-2 transition-colors ${
                ['processing', 'training', 'success'].includes(scrapeStatus) 
                  ? 'border-green-200 bg-green-50' 
                  : 'border-gray-200 bg-gray-50'
              }`}>
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${
                    ['processing', 'training', 'success'].includes(scrapeStatus) ? 'bg-green-500' : 'bg-gray-300'
                  }`}></div>
                  <span className="text-sm font-medium">Processing Data</span>
                </div>
              </div>

              <div className={`p-4 rounded-lg border-2 transition-colors ${
                ['training', 'success'].includes(scrapeStatus) 
                  ? 'border-green-200 bg-green-50' 
                  : 'border-gray-200 bg-gray-50'
              }`}>
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${
                    ['training', 'success'].includes(scrapeStatus) ? 'bg-green-500' : 'bg-gray-300'
                  }`}></div>
                  <span className="text-sm font-medium">Training Models</span>
                </div>
              </div>

              <div className={`p-4 rounded-lg border-2 transition-colors ${
                scrapeStatus === 'success' 
                  ? 'border-green-200 bg-green-50' 
                  : 'border-gray-200 bg-gray-50'
              }`}>
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${
                    scrapeStatus === 'success' ? 'bg-green-500' : 'bg-gray-300'
                  }`}></div>
                  <span className="text-sm font-medium">Complete</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Information Section */}
      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">What This Process Does</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <span className="text-sm font-semibold text-blue-600">1</span>
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-1">Automated Data Scraping</h4>
                <p className="text-sm text-gray-600">
                  Scrapes the latest vegetable price data from USDA market reports
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <span className="text-sm font-semibold text-blue-600">2</span>
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-1">Data Processing</h4>
                <p className="text-sm text-gray-600">
                  Cleans and standardizes the new data, then appends to training dataset
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <span className="text-sm font-semibold text-blue-600">3</span>
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-1">Model Retraining</h4>
                <p className="text-sm text-gray-600">
                  Retrains XGBoost and LightGBM models with the updated dataset
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <span className="text-sm font-semibold text-blue-600">4</span>
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-1">Improved Accuracy</h4>
                <p className="text-sm text-gray-600">
                  Fresh models provide more accurate forecasts with latest market trends
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScrapeTab; 