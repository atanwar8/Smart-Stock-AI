#!/usr/bin/env python3
"""
Automated USDA Scraper - Keeps ALL original working logic, only removes debug elements
Based on the working debug_usda_scraper.py with date range automation
"""

import time
import logging
import json
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path
import subprocess
import sys

def run_data_processor():
    """Run the data processor script"""
    try:
        logger.info("🔄 Starting automatic data processing...")
        
        # Import and run the data processor directly
        from data_processor import process_and_append_data
        success = process_and_append_data()
        
        if success:
            logger.info("✅ Data processing completed successfully!")
        else:
            logger.error("❌ Data processing failed!")
            
        return success
        
    except ImportError:
        # If import fails, try running as separate script
        try:
            logger.info("Running data processor as separate script...")
            result = subprocess.run([sys.executable, "data_processor.py"], 
                                  capture_output=True, text=True, timeout=300)
            
            if result.returncode == 0:
                logger.info("✅ Data processor script completed successfully!")
                return True
            else:
                logger.error(f"❌ Data processor script failed: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Failed to run data processor: {e}")
            return False
    
    except Exception as e:
        logger.error(f"❌ Error in data processing: {e}")
        return False

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def setup_chrome_driver():
    """Setup ChromeDriver - EXACT SAME as debug version"""
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service
        from webdriver_manager.chrome import ChromeDriverManager
        
        chrome_options = Options()
        # Don't use headless so we can see what's happening
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--window-size=1920,1080")
        
        # Use system ChromeDriver
        service = Service('/opt/homebrew/bin/chromedriver')
        driver = webdriver.Chrome(service=service, options=chrome_options)
        driver.set_page_load_timeout(30)
        
        return driver
        
    except Exception as e:
        logger.error(f"Failed to setup driver: {e}")
        return None

def get_date_range_from_csv():
    """Read Example_Train.csv and get the last date, return date range for scraping"""
    try:
        # Read the existing CSV file
        df = pd.read_csv('Example_Train.csv')
        
        if df.empty:
            logger.warning("Example_Train.csv is empty, using default date range")
            end_date = datetime.now()
            start_date = end_date - timedelta(days=7)
        else:
            # Convert report_date column to datetime
            df['report_date'] = pd.to_datetime(df['report_date'])
            
            # Get the last date in the CSV
            last_date = df['report_date'].max()
            logger.info(f"Last date in Example_Train.csv: {last_date.strftime('%m/%d/%Y')}")
            
            # Set start date as the day after the last date in CSV
            start_date = last_date + timedelta(days=1)
            end_date = datetime.now()
            
            # If start_date is in the future or same as today, use yesterday
            if start_date.date() >= end_date.date():
                end_date = datetime.now() - timedelta(days=1)
                start_date = end_date - timedelta(days=7)
                logger.info("Adjusted date range to ensure data availability")
        
        logger.info(f"Scraping date range: {start_date.strftime('%m/%d/%Y')} to {end_date.strftime('%m/%d/%Y')}")
        return start_date, end_date
        
    except FileNotFoundError:
        logger.warning("Example_Train.csv not found, using default date range")
        end_date = datetime.now() - timedelta(days=1)
        start_date = end_date - timedelta(days=7)
        return start_date, end_date
    except Exception as e:
        logger.error(f"Error reading Example_Train.csv: {e}")
        end_date = datetime.now() - timedelta(days=1)
        start_date = end_date - timedelta(days=7)
        return start_date, end_date

def improved_step_9_submit_form(driver):
    """EXACT SAME improved Step 9 from debug version"""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.common.exceptions import TimeoutException, ElementClickInterceptedException
    
    logger.info("=== STEP 9: Improved Form Submission ===")
    
    # Scroll to bottom to ensure button is visible
    driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
    time.sleep(2)
    
    # Wait for page to be fully loaded
    time.sleep(3)
    
    # Strategy 1: Try the exact button ID from the HTML
    button_selectors = [
        "btnGetDataMarketType",  # Direct ID
        "//a[@id='btnGetDataMarketType']",  # XPath with ID
        "//a[contains(@class, 'btn') and contains(@class, 'mars-form-control') and contains(text(), 'GET DATA')]",  # XPath with class and text
        "//a[contains(@class, 'btn') and text()='GET DATA']",  # XPath with exact text
        "//a[contains(@id, 'btnGetData')]",  # XPath with partial ID
        "#btnGetDataMarketType"  # CSS selector
    ]
    
    button_found = False
    button_element = None
    
    for i, selector in enumerate(button_selectors):
        try:
            logger.info(f"Trying selector {i+1}: {selector}")
            
            if selector == "btnGetDataMarketType":
                # Direct ID lookup
                button_element = driver.find_element(By.ID, selector)
            elif selector.startswith("//"):
                # XPath selector
                button_element = driver.find_element(By.XPATH, selector)
            elif selector.startswith("#"):
                # CSS selector
                button_element = driver.find_element(By.CSS_SELECTOR, selector)
            
            if button_element and button_element.is_displayed():
                logger.info(f"✓ Found button with selector: {selector}")
                logger.info(f"Button text: '{button_element.text}'")
                logger.info(f"Button classes: '{button_element.get_attribute('class')}'")
                logger.info(f"Button enabled: {button_element.is_enabled()}")
                button_found = True
                break
                
        except Exception as e:
            logger.info(f"Selector {i+1} failed: {str(e)}")
            continue
    
    if not button_found:
        logger.error("❌ Could not find GET DATA button with any selector")
        return False
    
    # Strategy 2: Multiple click methods
    click_methods = [
        ("Regular Click", lambda btn: btn.click()),
        ("JavaScript Click", lambda btn: driver.execute_script("arguments[0].click();", btn)),
        ("Action Chains Click", lambda btn: ActionChains(driver).move_to_element(btn).click().perform()),
        ("JavaScript Force Click", lambda btn: driver.execute_script("""
            arguments[0].scrollIntoView({block: 'center'});
            arguments[0].focus();
            arguments[0].click();
        """, btn)),
        ("Event Dispatch Click", lambda btn: driver.execute_script("""
            var event = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true
            });
            arguments[0].dispatchEvent(event);
        """, btn))
    ]
    
    for method_name, click_method in click_methods:
        try:
            logger.info(f"Attempting {method_name}...")
            
            # Scroll to button and ensure it's in view
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", button_element)
            time.sleep(1)
            
            # Try the click
            click_method(button_element)
            logger.info(f"✓ {method_name} executed successfully")
            
            # Wait and check for results
            time.sleep(5)
            
            # Check for loading indicators or results
            result_found = False
            result_indicators = [
                "//div[contains(@class, 'loading')]",
                "//div[contains(@class, 'spinner')]",
                "//div[contains(text(), 'Loading')]",
                "//div[contains(text(), 'Total Rows')]",
                "//div[contains(text(), 'No data available')]",
                "//table[contains(@class, 'table')]",
                "//div[@class='result']",
                "//*[contains(text(), 'ASPARAGUS')]",
                "//*[contains(text(), 'BROCCOLI')]",
                "//*[contains(text(), 'VEGETABLES')]"
            ]
            
            for indicator in result_indicators:
                try:
                    element = driver.find_element(By.XPATH, indicator)
                    if element.is_displayed():
                        logger.info(f"✓ Found result indicator: {indicator}")
                        logger.info(f"Indicator text: {element.text[:100]}...")
                        result_found = True
                        break
                except:
                    continue
            
            if result_found:
                logger.info(f"✅ {method_name} successful - results detected!")
                return True
            else:
                logger.info(f"⚠️ {method_name} executed but no results detected yet")
                # Continue to next method if no results
                
        except ElementClickInterceptedException as e:
            logger.info(f"❌ {method_name} failed - element intercepted: {str(e)}")
            continue
        except Exception as e:
            logger.info(f"❌ {method_name} failed: {str(e)}")
            continue
    
    # Strategy 3: Try direct JavaScript function calls
    logger.info("Attempting direct JavaScript function calls...")
    js_functions = [
        "document.getElementById('btnGetDataMarketType').click();",
        "$('#btnGetDataMarketType').click();",
        "btnGetDataMarketType.click();",
        "getData();",
        "getDataMarketType();",
        "performSearch();",
        "searchData();"
    ]
    
    for func in js_functions:
        try:
            logger.info(f"Trying JavaScript function: {func}")
            driver.execute_script(func)
            time.sleep(3)
            
            # Check for results
            try:
                result_element = driver.find_element(By.XPATH, "//div[contains(text(), 'Total Rows') or contains(text(), 'No data available')]")
                if result_element.is_displayed():
                    logger.info(f"✅ JavaScript function successful: {func}")
                    return True
            except:
                pass
                
        except Exception as e:
            logger.info(f"JavaScript function {func} failed: {str(e)}")
            continue
    
    # Strategy 4: Try form submission
    logger.info("Attempting direct form submission...")
    try:
        # Find the form containing the button
        forms = driver.find_elements(By.TAG_NAME, "form")
        for form in forms:
            form_html = form.get_attribute("innerHTML")
            if "btnGetDataMarketType" in form_html or "GET DATA" in form_html:
                logger.info("Found form containing GET DATA button")
                driver.execute_script("arguments[0].submit();", form)
                time.sleep(5)
                logger.info("✓ Form submitted directly")
                return True
    except Exception as e:
        logger.info(f"❌ Direct form submission failed: {str(e)}")
    
    # Strategy 5: Try triggering the underlying AJAX call
    logger.info("Attempting to trigger AJAX call directly...")
    try:
        ajax_script = """
            // Try to find and execute the AJAX call that the button would trigger
            if (typeof jQuery !== 'undefined' && jQuery('#btnGetDataMarketType').length) {
                jQuery('#btnGetDataMarketType').trigger('click');
                return 'jQuery trigger executed';
            }
            
            // Try to find the button's onclick handler
            var btn = document.getElementById('btnGetDataMarketType');
            if (btn && btn.onclick) {
                btn.onclick();
                return 'onclick handler executed';
            }
            
            // Try to simulate the AJAX call manually
            if (typeof $ !== 'undefined') {
                $.ajax({
                    url: '/public_data/ajax-search-data-by-market-type',
                    type: 'POST',
                    data: {
                        'market_type': 'Retail',
                        'class': 'Vegetables',
                        'region': 'Midwest',
                        'from_date': '07/10/2025',
                        'to_date': '07/17/2025'
                    },
                    success: function(data) {
                        console.log('AJAX call successful');
                        // Try to update the results div
                        if (document.querySelector('.result')) {
                            document.querySelector('.result').innerHTML = data;
                        }
                    }
                });
                return 'AJAX call initiated';
            }
            
            return 'No method available';
        """
        
        result = driver.execute_script(ajax_script)
        logger.info(f"AJAX script result: {result}")
        
        if result and "executed" in result:
            time.sleep(10)  # Wait longer for AJAX to complete
            logger.info("✓ AJAX call potentially successful")
            return True
            
    except Exception as e:
        logger.info(f"❌ AJAX call failed: {str(e)}")
    
    logger.error("❌ All strategies failed to click the GET DATA button")
    return False

def scrape_usda_vegetables():
    """EXACT SAME main scraping function with original working logic"""
    driver = setup_chrome_driver()
    if not driver:
        return False
    
    try:
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.common.keys import Keys
        
        # Get date range from existing CSV
        start_date, end_date = get_date_range_from_csv()
        from_date_str = start_date.strftime("%m/%d/%Y")
        to_date_str = end_date.strftime("%m/%d/%Y")
        
        # Step 1: Navigate to USDA site
        logger.info("=== STEP 1: Navigating to USDA ===")
        driver.get("https://mymarketnews.ams.usda.gov/public_data")
        
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.TAG_NAME, "body"))
        )
        logger.info("✓ Page loaded")
        
        # Step 2: Click "Search By Market Types" tab
        logger.info("=== STEP 2: Clicking Market Types Tab ===")
        
        market_tab = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.ID, "market-tab"))
        )
        market_tab.click()
        logger.info("✓ Clicked Search By Market Types tab")
        time.sleep(3)
        
        # Step 3: Wait for Market Types content to be active
        logger.info("=== STEP 3: Waiting for Market Types Content ===")
        
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, "market"))
        )
        logger.info("✓ Market Types content loaded")
        
        # Step 4: Check Section 1 (but DON'T click it - it's already open!)
        logger.info("=== STEP 4: Checking Section 1 ===")
        
        # Look for Section 1 but don't click it
        section1_elements = driver.find_elements(By.XPATH, 
            "//*[contains(text(), 'Section 1')] | "
            "//*[contains(text(), 'Report Type and Time period')]")
        
        if section1_elements:
            section1 = section1_elements[0]
            logger.info(f"Found Section 1: {section1.text}")
            logger.info("✓ Section 1 is already open - not clicking it!")
        else:
            logger.info("Section 1 not found, but continuing...")
        
        # Give a moment for the page to be ready
        time.sleep(2)
        
        # Step 5: Fill Market Type
        logger.info("=== STEP 5: Setting Market Type ===")
        
        # Wait for elements to be ready (but don't wait too long since sections are already open)
        time.sleep(2)
        
        # Try multiple approaches to interact with Market Type dropdown
        market_type_success = False
        
        # Approach 1: Try the select element directly
        try:
            logger.info("Approach 1: Trying select element directly...")
            market_select = driver.find_element(By.ID, "market-types-by-market-types")
            
            # Check if it's visible and enabled
            is_displayed = market_select.is_displayed()
            is_enabled = market_select.is_enabled()
            logger.info(f"Market select: displayed={is_displayed}, enabled={is_enabled}")
            
            if is_displayed and is_enabled:
                # Try using regular Select dropdown first
                from selenium.webdriver.support.ui import Select
                select_obj = Select(market_select)
                
                # Get options
                options = [opt.text.strip() for opt in select_obj.options if opt.text.strip()]
                logger.info(f"Available options: {options}")
                
                # Look for Retail option
                for option_text in options:
                    if "retail" in option_text.lower():
                        select_obj.select_by_visible_text(option_text)
                        logger.info(f"✓ Selected via regular select: {option_text}")
                        market_type_success = True
                        break
            
        except Exception as e:
            logger.info(f"Approach 1 failed: {e}")
        
        # Approach 2: Try Chosen.js interface if Approach 1 failed
        if not market_type_success:
            try:
                logger.info("Approach 2: Trying Chosen.js interface...")
                
                # Wait for chosen container to be ready
                chosen_container = WebDriverWait(driver, 10).until(
                    EC.presence_of_element_located((By.XPATH, 
                        "//select[@id='market-types-by-market-types']/following-sibling::div[contains(@class, 'chosen-container')]"))
                )
                
                logger.info("Found chosen container")
                
                # Check if container is visible
                is_displayed = chosen_container.is_displayed()
                logger.info(f"Chosen container displayed: {is_displayed}")
                
                if is_displayed:
                    # Find the clickable part
                    chosen_single = chosen_container.find_element(By.CLASS_NAME, "chosen-single")
                    
                    # Ensure it's in view and wait
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", chosen_single)
                    time.sleep(2)
                    
                    # Try clicking with JavaScript if regular click fails
                    try:
                        chosen_single.click()
                        logger.info("✓ Clicked chosen dropdown")
                    except:
                        driver.execute_script("arguments[0].click();", chosen_single)
                        logger.info("✓ Clicked chosen dropdown with JavaScript")
                    
                    time.sleep(2)
                    
                    # Type "Retail" in the search box
                    search_input = chosen_container.find_element(By.XPATH, ".//input[@type='text']")
                    search_input.send_keys("Retail")
                    time.sleep(1)
                    logger.info("✓ Typed 'Retail'")
                    
                    # Look for Retail option and click it
                    retail_option = WebDriverWait(driver, 5).until(
                        EC.element_to_be_clickable((By.XPATH, 
                            "//div[contains(@class, 'chosen-drop')]//li[contains(text(), 'Retail')]"))
                    )
                    retail_option.click()
                    logger.info("✓ Selected Retail via Chosen.js")
                    market_type_success = True
                
            except Exception as e:
                logger.info(f"Approach 2 failed: {e}")
        
        # Approach 3: Try alternative selectors
        if not market_type_success:
            logger.info("Approach 3: Trying alternative selectors...")
            # Look for any input with market type placeholder
            market_inputs = driver.find_elements(By.XPATH, "//input[contains(@placeholder, 'market type')]")
            for i, inp in enumerate(market_inputs):
                if inp.is_displayed() and inp.is_enabled():
                    logger.info(f"Found market type input {i}")
                    # Scroll to input
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", inp)
                    time.sleep(1)
                    # Click and type
                    inp.click()
                    inp.clear()
                    inp.send_keys("Retail")
                    time.sleep(1)
                    # Try pressing Enter
                    inp.send_keys(Keys.ENTER)
                    logger.info("✓ Selected Retail via input method")
                    market_type_success = True
                    break
        
        if not market_type_success:
            logger.error("❌ All approaches failed for Market Type")
            return False
        
        time.sleep(3)  # Wait for dependent dropdowns
        
        # Step 6: Fill Class (using the same successful method as Market Type)
        logger.info("=== STEP 6: Setting Class ===")
        
        # Try the same approach that worked for Market Type
        class_success = False
        
        # Wait a bit longer for dependent dropdown to populate
        time.sleep(5)
        
        # Approach 1: Try alternative selectors (this worked for Market Type)
        try:
            logger.info("Trying input method for Class...")
            
            # Look for class-related inputs
            class_inputs = driver.find_elements(By.XPATH, 
                "//input[contains(@placeholder, 'class')] | "
                "//input[contains(@placeholder, 'Class')]")
            
            logger.info(f"Found {len(class_inputs)} class input elements")
            
            for i, inp in enumerate(class_inputs):
                if inp.is_displayed() and inp.is_enabled():
                    logger.info(f"Trying class input {i}")
                    
                    # Scroll to input
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", inp)
                    time.sleep(1)
                    
                    # Click and type
                    inp.click()
                    inp.clear()
                    inp.send_keys("Vegetables")
                    time.sleep(2)
                    
                    # Try pressing Enter
                    inp.send_keys(Keys.ENTER)
                    logger.info("✓ Selected Vegetables via input method")
                    class_success = True
                    break
            
        except Exception as e:
            logger.info(f"Input method for Class failed: {e}")
        
        # Approach 2: Try Chosen.js for Class dropdown
        if not class_success:
            try:
                logger.info("Trying Chosen.js for Class...")
                
                class_chosen = driver.find_element(By.XPATH, 
                    "//select[@id='class-market-type']/following-sibling::div[contains(@class, 'chosen-container')]")
                
                if class_chosen.is_displayed():
                    # Click to open dropdown
                    class_chosen_single = class_chosen.find_element(By.CLASS_NAME, "chosen-single")
                    class_chosen_single.click()
                    time.sleep(1)
                    
                    # Type "Vegetables"
                    class_search = class_chosen.find_element(By.XPATH, ".//input[@type='text']")
                    class_search.send_keys("Vegetables")
                    time.sleep(1)
                    
                    # Look for Vegetables option with more flexible xpath
                    veg_options = driver.find_elements(By.XPATH, 
                        "//li[contains(text(), 'Vegetables')] | "
                        "//li[contains(text(), 'vegetables')] | "
                        "//li[contains(text(), 'VEGETABLES')] | "
                        "//*[contains(@class, 'chosen-drop')]//li[contains(., 'Veg')]")
                    
                    if veg_options:
                        veg_options[0].click()
                        logger.info("✓ Selected Vegetables via Chosen.js")
                        class_success = True
                    else:
                        logger.info("No Vegetables option found in dropdown")
                        
                        # Check what options are available
                        all_options = driver.find_elements(By.XPATH, "//div[contains(@class, 'chosen-drop')]//li")
                        available_options = [opt.text.strip() for opt in all_options if opt.text.strip()]
                        logger.info(f"Available Class options: {available_options}")
                
            except Exception as e:
                logger.info(f"Chosen.js method for Class failed: {e}")
        
        # Manual fallback for Class
        if not class_success:
            logger.error("❌ Automatic Class selection failed")
            return False
        
        time.sleep(3)  # Wait for Region dropdown to populate
        
        # Step 7: Fill Region (using the same successful methods)
        logger.info("=== STEP 7: Setting Region ===")
        
        region_success = False
        
        # Wait for Region dropdown to populate
        time.sleep(3)
        
        # Approach 1: Try input method (this has been most successful)
        try:
            logger.info("Trying input method for Region...")
            
            # Look for region-related inputs
            region_inputs = driver.find_elements(By.XPATH, 
                "//input[contains(@placeholder, 'region')] | "
                "//input[contains(@placeholder, 'Region')]")
            
            logger.info(f"Found {len(region_inputs)} region input elements")
            
            for i, inp in enumerate(region_inputs):
                if inp.is_displayed() and inp.is_enabled():
                    logger.info(f"Trying region input {i}")
                    
                    # Scroll to input
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", inp)
                    time.sleep(1)
                    
                    # Click and type
                    inp.click()
                    inp.clear()
                    inp.send_keys("Midwest")
                    time.sleep(2)
                    
                    # Try pressing Enter
                    inp.send_keys(Keys.ENTER)
                    logger.info("✓ Selected Midwest via input method")
                    region_success = True
                    break
            
        except Exception as e:
            logger.info(f"Input method for Region failed: {e}")
        
        # Approach 2: Try Chosen.js for Region
        if not region_success:
            try:
                logger.info("Trying Chosen.js for Region...")
                
                region_chosen = driver.find_element(By.XPATH, 
                    "//select[@id='region-market-type']/following-sibling::div[contains(@class, 'chosen-container')]")
                
                if region_chosen.is_displayed():
                    # Click to open dropdown
                    region_chosen_single = region_chosen.find_element(By.CLASS_NAME, "chosen-single")
                    region_chosen_single.click()
                    time.sleep(1)
                    
                    # Type "Midwest"
                    region_search = region_chosen.find_element(By.XPATH, ".//input[@type='text']")
                    region_search.send_keys("Midwest")
                    time.sleep(1)
                    
                    # Look for Midwest option
                    midwest_options = driver.find_elements(By.XPATH, 
                        "//li[contains(text(), 'Midwest')] | "
                        "//li[contains(text(), 'midwest')] | "
                        "//li[contains(text(), 'MIDWEST')] | "
                        "//*[contains(@class, 'chosen-drop')]//li[contains(., 'Mid')]")
                    
                    if midwest_options:
                        midwest_options[0].click()
                        logger.info("✓ Selected Midwest via Chosen.js")
                        region_success = True
                    else:
                        logger.info("No Midwest option found in dropdown")
                        
                        # Check what options are available
                        all_options = driver.find_elements(By.XPATH, "//div[contains(@class, 'chosen-drop')]//li")
                        available_options = [opt.text.strip() for opt in all_options if opt.text.strip()]
                        logger.info(f"Available Region options: {available_options}")
                
            except Exception as e:
                logger.info(f"Chosen.js method for Region failed: {e}")
        
        # Manual fallback for Region
        if not region_success:
            logger.error("❌ Automatic Region selection failed")
            return False
        
        time.sleep(2)
        
        # Step 8: Set dates (use calculated date range)
        logger.info("=== STEP 8: Setting Dates ===")
        
        # Find the date inputs by their IDs
        from_date_input = driver.find_element(By.ID, "from-date-by-market-types-section-2")
        to_date_input = driver.find_element(By.ID, "to-date-by-market-types-section-2")
        
        # Set dates
        from_date_input.clear()
        from_date_input.send_keys(from_date_str)
        
        to_date_input.clear()
        to_date_input.send_keys(to_date_str)
        
        logger.info(f"✓ Set date range: {from_date_str} - {to_date_str}")
        
        # Wait after setting dates as requested
        logger.info("Waiting 5 seconds after setting dates...")
        time.sleep(5)
        
        # Step 9: Submit the form with ENHANCED METHOD (EXACT SAME)
        logger.info("=== STEP 9: Submitting Form with Enhanced Method ===")
        
        # Use the improved submission method
        success = improved_step_9_submit_form(driver)
        
        if success:
            logger.info("✅ Form submission completed!")
            
            # Wait for results to load
            logger.info("Waiting for results to load...")
            time.sleep(15)
            
            # Check for results or "No data available"
            try:
                # Look for result indicators
                result_elements = driver.find_elements(By.XPATH, 
                    "//div[contains(text(), 'Total Rows') or contains(text(), 'No data available') or contains(text(), 'results')]")
                
                for elem in result_elements:
                    if elem.is_displayed():
                        logger.info(f"Result indicator: {elem.text}")
                        
            except Exception as e:
                logger.info(f"Could not check for results: {e}")
        else:
            logger.error("❌ Form submission failed")
            return False

        # Step 10: Wait for results and analyze all tables (EXACT SAME as debug version)
        logger.info("=== STEP 10: Waiting for Results and Analyzing Tables ===")
        logger.info("⏳ Waiting 25+ seconds for data to load completely...")
        time.sleep(25)  # Wait longer as requested
        
        # Check if data is still loading
        loading_indicators = driver.find_elements(By.XPATH, 
            "//*[contains(text(), 'Loading')] | "
            "//*[contains(text(), 'Please wait')] | "
            "//*[contains(@class, 'loading')] | "
            "//*[contains(@class, 'spinner')]")
        
        if loading_indicators:
            visible_loading = [li for li in loading_indicators if li.is_displayed()]
            if visible_loading:
                logger.info("Data still loading, waiting additional 10 seconds...")
                time.sleep(10)
        
        # Look for "Total Rows" or result indicators
        result_indicators = driver.find_elements(By.XPATH, 
            "//*[contains(text(), 'Total Rows')] | "
            "//*[contains(text(), 'rows returned')] | "
            "//*[contains(text(), 'Results')] | "
            "//*[contains(text(), 'records found')]")
        
        if result_indicators:
            for indicator in result_indicators:
                if indicator.is_displayed():
                    logger.info(f"📊 Result indicator found: {indicator.text}")
        
        # Analyze all tables on the page with enhanced debugging
        logger.info("\n=== 🔍 ANALYZING ALL TABLES ===")
        
        try:
            tables = driver.find_elements(By.TAG_NAME, "table")
            logger.info(f"📋 Found {len(tables)} total tables on the page")
            
            # Also look for collapsible sections that might contain tables
            sections = driver.find_elements(By.XPATH, 
                "//*[contains(text(), 'ASPARAGUS')] | "
                "//*[contains(text(), 'BROCCOLI')] | "
                "//*[contains(text(), 'CABBAGE')] | "
                "//*[contains(text(), 'CARROTS')] | "
                "//*[contains(text(), 'CAULIFLOWER')] | "
                "//*[contains(text(), 'CUCUMBERS')] | "
                "//*[contains(text(), 'LETTUCE')] | "
                "//*[contains(text(), 'ONIONS')] | "
                "//*[contains(text(), 'PEPPERS')] | "
                "//*[contains(text(), 'TOMATOES')]")
            
            if sections:
                logger.info(f"🥬 Found {len(sections)} vegetable sections on page")
                for i, section in enumerate(sections[:5]):  # Show first 5
                    logger.info(f"  Vegetable section {i+1}: {section.text[:50]}...")
            
            all_vegetable_data = []
            
            for table_index, table in enumerate(tables):
                logger.info(f"\n📊 --- ANALYZING TABLE {table_index + 1} ---")
                
                try:
                    # Get table headers - try multiple row strategies
                    header_cells = []
                    
                    # Try first row
                    first_row_cells = table.find_elements(By.XPATH, ".//tr[1]//th | .//tr[1]//td")
                    if first_row_cells:
                        header_cells = first_row_cells
                    
                    # If no headers in first row, try second row
                    if not header_cells:
                        second_row_cells = table.find_elements(By.XPATH, ".//tr[2]//th | .//tr[2]//td")
                        if second_row_cells:
                            header_cells = second_row_cells
                    
                    headers = [cell.text.strip() for cell in header_cells if cell.text.strip()]
                    
                    if headers:
                        logger.info(f"  📋 Headers: {headers}")
                        
                        # Get all data rows (skip header row)
                        all_rows = table.find_elements(By.XPATH, ".//tr")
                        data_rows = all_rows[1:] if len(all_rows) > 1 else []
                        logger.info(f"  📊 Data rows found: {len(data_rows)}")
                        
                        table_data = []
                        vegetables_in_table = []
                        
                        for row_index, row in enumerate(data_rows):
                            cells = row.find_elements(By.XPATH, ".//td | .//th")
                            cell_data = [cell.text.strip() for cell in cells]
                            
                            if cell_data and any(cell for cell in cell_data):
                                # Pad or trim cell_data to match headers length
                                while len(cell_data) < len(headers):
                                    cell_data.append("")
                                cell_data = cell_data[:len(headers)]
                                
                                row_dict = dict(zip(headers, cell_data))
                                table_data.append(row_dict)
                                
                                # Check if this row contains vegetable data
                                row_text = " ".join(cell_data).upper()
                                for vegetable in ["ASPARAGUS", "BROCCOLI", "CABBAGE", "CARROTS", "CAULIFLOWER", 
                                                "CUCUMBERS", "LETTUCE", "ONIONS", "PEPPERS", "TOMATOES", "SWEET POTATOES"]:
                                    if vegetable in row_text and vegetable not in vegetables_in_table:
                                        vegetables_in_table.append(vegetable)
                        
                        if vegetables_in_table:
                            logger.info(f"  ✅ TABLE {table_index + 1} contains vegetables: {vegetables_in_table}")
                            logger.info(f"  📊 Sample data from this table:")
                            for i, row in enumerate(table_data[:2]):  # Show first 2 rows
                                logger.info(f"    Row {i+1}: {row}")
                            if len(table_data) > 2:
                                logger.info(f"    ... and {len(table_data) - 2} more rows")
                            
                            all_vegetable_data.extend(table_data)
                        elif table_data:
                            logger.info(f"  ℹ️  TABLE {table_index + 1} has {len(table_data)} rows but no vegetable data")
                        else:
                            logger.info(f"  ❌ TABLE {table_index + 1} has no data rows")
                    else:
                        logger.info(f"  ❓ TABLE {table_index + 1} has no headers - checking for data anyway")
                        
                        # Even without headers, check if table contains vegetable names
                        table_text = table.text.upper()
                        vegetables_found = []
                        for vegetable in ["ASPARAGUS", "BROCCOLI", "CABBAGE", "CARROTS", "CAULIFLOWER", 
                                        "CUCUMBERS", "LETTUCE", "ONIONS", "PEPPERS", "TOMATOES", "SWEET POTATOES"]:
                            if vegetable in table_text:
                                vegetables_found.append(vegetable)
                        
                        if vegetables_found:
                            logger.info(f"  🥬 TABLE {table_index + 1} contains vegetable text: {vegetables_found}")
                        
                except Exception as table_error:
                    logger.info(f"  ❌ Error analyzing TABLE {table_index + 1}: {table_error}")
            
            # Summary of findings
            logger.info(f"\n🎯 === SUMMARY ===")
            logger.info(f"📊 Total tables analyzed: {len(tables)}")
            logger.info(f"🥬 Total vegetable data rows extracted: {len(all_vegetable_data)}")
            
            # Count vegetables found
            all_vegetables_found = set()
            for row in all_vegetable_data:
                row_text = " ".join(str(v) for v in row.values()).upper()
                for vegetable in ["ASPARAGUS", "BROCCOLI", "CABBAGE", "CARROTS", "CAULIFLOWER", 
                                "CUCUMBERS", "LETTUCE", "ONIONS", "PEPPERS", "TOMATOES", "SWEET POTATOES"]:
                    if vegetable in row_text:
                        all_vegetables_found.add(vegetable)
            
            logger.info(f"🥬 Vegetables found: {sorted(all_vegetables_found)}")
            
            # Save new data and append to existing CSV
            # After successful data extraction and saving
            if all_vegetable_data:
                logger.info(f"Extracted {len(all_vegetable_data)} rows of vegetable data")
            
                # Create DataFrame from new data
                new_df = pd.DataFrame(all_vegetable_data)
            
                # Save new data with timestamp (keep existing logic)
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                new_csv_filename = f"usda_vegetables_new_{timestamp}.csv"
                new_df.to_csv(new_csv_filename, index=False)
                logger.info(f"💾 New data saved as: {new_csv_filename}")
                
                # 🆕 NEW: Automatically process and append the data
                logger.info("\n" + "="*60)
                logger.info("🔄 STARTING AUTOMATIC DATA PROCESSING")
                logger.info("="*60)
                
                processing_success = run_data_processor()
                
                if processing_success:
                    logger.info("\n" + "="*60)
                    logger.info("✅ COMPLETE WORKFLOW FINISHED SUCCESSFULLY!")
                    logger.info("📊 Data scraped, processed, and appended to Example_Train.csv")
                    logger.info("📅 Data sorted from latest to oldest")
                    logger.info("="*60)
                else:
                    logger.warning("\n" + "="*60)
                    logger.warning("⚠️ SCRAPING SUCCESSFUL BUT PROCESSING FAILED")
                    logger.warning(f"📁 Raw data saved in: {new_csv_filename}")
                    logger.warning("🔧 Please run data_processor.py manually")
                    logger.warning("="*60)
                
                return True
            else:
                logger.info("❌ No vegetable data found to save")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error analyzing tables: {e}")
            import traceback
            traceback.print_exc()
            return False
            
    except Exception as e:
        logger.error(f"❌ Scraping failed: {e}")
        import traceback
        traceback.print_exc()
        return False
        
    finally:
        logger.info("\nClosing browser...")
        driver.quit()

if __name__ == "__main__":
    logger.info("🚀 === Starting Integrated USDA Scraper ===")
    success = scrape_usda_vegetables()
    
    if success:
        logger.info("✅ Complete scraping and processing workflow completed!")
    else:
        logger.error("❌ Scraping workflow failed")