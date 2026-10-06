#!/usr/bin/env python3
"""
SmartStock AI Backend Startup Script
Handles environment setup and server launch
"""

import os
import sys
import subprocess
from pathlib import Path

def check_requirements():
    """Check if all required packages are installed"""
    try:
        import fastapi
        import uvicorn
        import pandas
        import numpy
        import sklearn
        import requests
        from dotenv import load_dotenv
        print("✅ Core dependencies found")
        
        # Check optional ML libraries
        try:
            import lightgbm
            print("✅ LightGBM available")
        except ImportError:
            print("⚠️ LightGBM not found - will use fallback models")
        
        try:
            import xgboost
            print("✅ XGBoost available")
        except ImportError:
            print("⚠️ XGBoost not found - will use fallback models")
            
        return True
        
    except ImportError as e:
        print(f"❌ Missing dependency: {e}")
        print("Please install requirements: pip install -r requirements.txt")
        return False

def check_data_files():
    """Check if required data files exist"""
    backend_dir = Path(__file__).parent
    project_dir = backend_dir.parent
    
    required_files = [
        project_dir / "Example_Train.csv",
        project_dir / "usda_commodity.csv"
    ]
    
    missing_files = []
    for file_path in required_files:
        if file_path.exists():
            print(f"✅ Found {file_path.name}")
        else:
            print(f"❌ Missing {file_path.name}")
            missing_files.append(file_path.name)
    
    if missing_files:
        print(f"\n⚠️ Missing data files: {', '.join(missing_files)}")
        print("The backend will still start but some features may not work properly.")
    
    return len(missing_files) == 0

def check_environment():
    """Check environment configuration"""
    from dotenv import load_dotenv
    load_dotenv()
    
    api_key = os.getenv('OPENWEATHER_API_KEY')
    if not api_key or api_key == 'your_openweather_api_key_here':
        print("⚠️ OpenWeather API key not configured")
        print("Please set OPENWEATHER_API_KEY in .env file")
        print("Get your free API key at: https://openweathermap.org/api")
    else:
        print("✅ OpenWeather API key configured")
    
    host = os.getenv('API_HOST', 'localhost')
    port = os.getenv('API_PORT', '8000')
    print(f"🌐 Server will start at: http://{host}:{port}")

def install_requirements():
    """Install requirements in virtual environment if needed"""
    requirements_file = Path(__file__).parent / "requirements.txt"
    venv_path = Path(__file__).parent / "smartstock_env"
    
    if not venv_path.exists():
        print("Creating virtual environment...")
        subprocess.run([sys.executable, "-m", "venv", "smartstock_env"])
    
    if requirements_file.exists():
        print("Installing requirements in virtual environment...")
        if sys.platform == "win32":
            pip_path = venv_path / "Scripts" / "pip"
        else:
            pip_path = venv_path / "bin" / "pip"
        
        subprocess.run([str(pip_path), "install", "-r", str(requirements_file)])
        return True
    else:
        print("❌ requirements.txt not found")
        return False

def activate_venv():
    """Activate virtual environment"""
    venv_path = Path(__file__).parent / "smartstock_env"
    
    if sys.platform == "win32":
        activate_script = venv_path / "Scripts" / "activate_this.py"
        python_path = venv_path / "Scripts" / "python"
    else:
        python_path = venv_path / "bin" / "python"
    
    if venv_path.exists() and python_path.exists():
        # Add virtual environment to path
        venv_site_packages = venv_path / "lib" / "python3.9" / "site-packages"
        if venv_site_packages.exists():
            sys.path.insert(0, str(venv_site_packages))
        print("✅ Virtual environment activated")
        return True
    else:
        print("⚠️ Virtual environment not found")
        return False

def main():
    """Main startup function"""
    print("🚀 SmartStock AI Backend Startup")
    print("=" * 40)
    
    # Check if we're in the right directory
    backend_dir = Path(__file__).parent
    os.chdir(backend_dir)
    
    # Activate virtual environment
    if not activate_venv():
        response = input("\nCreate and setup virtual environment? (y/n): ")
        if response.lower() == 'y':
            if install_requirements():
                activate_venv()
            else:
                print("❌ Failed to setup virtual environment")
                return
        else:
            print("Please setup virtual environment manually")
            return
    
    # Check requirements
    if not check_requirements():
        response = input("\nInstall requirements automatically? (y/n): ")
        if response.lower() == 'y':
            if install_requirements():
                print("✅ Requirements installed. Please restart the script.")
                return
            else:
                print("❌ Failed to install requirements")
                return
        else:
            print("Please install requirements manually: pip install -r requirements.txt")
            return
    
    # Check data files
    check_data_files()
    
    # Check environment
    check_environment()
    
    print("\n" + "=" * 40)
    print("🎯 Starting FastAPI server...")
    print("📊 Dashboard endpoints will be available at:")
    print("   - Health check: http://localhost:8000/health")
    print("   - API docs: http://localhost:8000/docs")
    print("   - Commodities: http://localhost:8000/commodities")
    print("\n💡 Frontend should connect to: http://localhost:8000")
    print("🔄 Use Ctrl+C to stop the server")
    print("=" * 40)
    
    # Start the server
    try:
        # Import uvicorn from virtual environment
        import uvicorn
        
        print("\n🔥 Starting server with virtual environment...")
        uvicorn.run(
            "main:app",
            host=os.getenv('API_HOST', 'localhost'),
            port=int(os.getenv('API_PORT', 8000)),
            reload=True,
            log_level="info"
        )
    except KeyboardInterrupt:
        print("\n👋 Server stopped")
    except Exception as e:
        print(f"❌ Server error: {e}")

if __name__ == "__main__":
    main()
