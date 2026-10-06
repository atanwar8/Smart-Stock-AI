#!/usr/bin/env python3
"""
Train/Test Set Updater - Intelligently updates both training and test sets with new scraped data
Implements rolling test set approach for time-series forecasting
"""

import pandas as pd
import numpy as np
import logging
from datetime import datetime, timedelta
from pathlib import Path
import glob
import os

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class TrainTestUpdater:
    def __init__(self, train_path: str = "Example_Train.csv", test_path: str = "Example_Test.csv"):
        self.train_path = train_path
        self.test_path = test_path
        self.test_split_ratio = 0.2  # 20% of new data goes to test
        self.max_test_records = 15000  # Keep test set manageable
        
    def find_latest_scraped_file(self):
        """Find the most recently created usda_vegetables_new_*.csv file"""
        try:
            # Look for files matching the pattern
            pattern = "usda_vegetables_new_*.csv"
            files = glob.glob(pattern)
            
            if not files:
                logger.error("No new scraped files found matching pattern: usda_vegetables_new_*.csv")
                return None
            
            # Get the most recent file by modification time
            latest_file = max(files, key=os.path.getmtime)
            logger.info(f"Found latest scraped file: {latest_file}")
            return latest_file
            
        except Exception as e:
            logger.error(f"Error finding latest scraped file: {e}")
            return None

    def clean_and_standardize_data(self, df):
        """Clean and standardize the scraped data - simplified version"""
        try:
            logger.info("Cleaning and standardizing scraped data...")
            
            # Create a copy to work with
            cleaned_df = df.copy()
            
            # Define the expected column structure
            expected_columns = [
                'report_date', 'region', 'class', 'commodity', 'variety', 'organic', 
                'unit', 'environment', 'price_min', 'price_max', 'current_ad_count', 
                'current_wtd_avg_price', 'priorwk_ad_count', 'priorwk_wtd_avg_price'
            ]
            
            # Initialize the standardized dataframe
            standardized_data = []
            
            # Process each row to extract meaningful data
            for index, row in cleaned_df.iterrows():
                try:
                    # Convert row to dictionary for easier processing
                    row_dict = row.to_dict()
                    
                    # Extract basic information
                    new_row = {}
                    
                    # Try to identify the report date
                    report_date = None
                    for col, value in row_dict.items():
                        if pd.notna(value) and isinstance(value, str):
                            # Check if it looks like a date (MM/DD/YYYY format)
                            if '/' in str(value) and len(str(value).split('/')) == 3:
                                try:
                                    parsed_date = pd.to_datetime(value)
                                    report_date = value
                                    break
                                except:
                                    continue
                    
                    # Extract commodity information
                    commodity = None
                    vegetables = ['Asparagus', 'Broccoli', 'Cabbage', 'Carrots', 'Cauliflower', 
                                 'Cucumbers', 'Lettuce', 'Onions', 'Peppers', 'Tomatoes', 
                                 'Sweet Potatoes', 'Beans', 'Brussels Sprouts', 'Eggplant', 
                                 'Mushrooms', 'Radishes', 'Spinach', 'Squash']
                    
                    for veg in vegetables:
                        for col, value in row_dict.items():
                            if veg.lower() in str(col).lower() or veg.lower() in str(value).lower():
                                commodity = veg
                                break
                        if commodity:
                            break
                    
                    # Build standardized row
                    new_row['report_date'] = report_date
                    new_row['region'] = row_dict.get('Region', 'Midwest')
                    new_row['class'] = row_dict.get('Class', 'Vegetables')
                    new_row['commodity'] = commodity
                    new_row['variety'] = row_dict.get('Variety', 'N/A')
                    new_row['organic'] = row_dict.get('Organic', 'No')
                    new_row['unit'] = row_dict.get('Unit', 'per lb')
                    new_row['environment'] = row_dict.get('Environment', 'N/A')
                    
                    # Extract price and count information
                    price_min = None
                    price_max = None
                    current_ad_count = None
                    current_wtd_avg_price = None
                    
                    # Look for numeric values that could be prices or counts
                    for col, value in row_dict.items():
                        if pd.notna(value) and pd.api.types.is_numeric_dtype(type(value)):
                            col_lower = str(col).lower()
                            if 'min' in col_lower and 'price' in col_lower:
                                price_min = value
                            elif 'max' in col_lower and 'price' in col_lower:
                                price_max = value
                            elif 'count' in col_lower:
                                current_ad_count = value
                            elif 'avg' in col_lower and 'price' in col_lower:
                                current_wtd_avg_price = value
                            elif price_min is None and 0.1 <= float(value) <= 50:
                                price_min = value
                            elif price_max is None and price_min and float(value) >= float(price_min):
                                price_max = value
                    
                    new_row['price_min'] = price_min
                    new_row['price_max'] = price_max
                    new_row['current_ad_count'] = current_ad_count
                    new_row['current_wtd_avg_price'] = current_wtd_avg_price
                    new_row['priorwk_ad_count'] = None
                    new_row['priorwk_wtd_avg_price'] = None
                    
                    # Only add row if we have essential data
                    if new_row['report_date'] and new_row['commodity']:
                        standardized_data.append(new_row)
                        
                except Exception as e:
                    logger.warning(f"Error processing row {index}: {e}")
                    continue
            
            # Create DataFrame from standardized data
            if standardized_data:
                result_df = pd.DataFrame(standardized_data)
                logger.info(f"Standardized data shape: {result_df.shape}")
                return result_df
            else:
                logger.warning("No standardized data could be extracted")
                return pd.DataFrame()
                
        except Exception as e:
            logger.error(f"Error cleaning and standardizing data: {e}")
            return pd.DataFrame()

    def split_new_data_by_time(self, new_data_df):
        """Split new data into train/test based on time - most recent goes to test"""
        try:
            # Convert report_date to datetime for sorting
            new_data_df['report_date'] = pd.to_datetime(new_data_df['report_date'], errors='coerce')
            
            # Remove rows with invalid dates
            valid_data = new_data_df[new_data_df['report_date'].notna()].copy()
            
            if len(valid_data) == 0:
                logger.warning("No valid data after date filtering")
                return pd.DataFrame(), pd.DataFrame()
            
            # Sort by date (oldest to newest)
            valid_data = valid_data.sort_values('report_date')
            
            # Calculate split point - most recent 20% goes to test
            total_records = len(valid_data)
            test_records = max(1, int(total_records * self.test_split_ratio))
            train_records = total_records - test_records
            
            # Split the data
            new_train_data = valid_data.iloc[:train_records].copy()
            new_test_data = valid_data.iloc[train_records:].copy()
            
            # Convert dates back to string format
            new_train_data['report_date'] = new_train_data['report_date'].dt.strftime('%m/%d/%Y')
            new_test_data['report_date'] = new_test_data['report_date'].dt.strftime('%m/%d/%Y')
            
            logger.info(f"Split new data: {len(new_train_data)} for training, {len(new_test_data)} for testing")
            return new_train_data, new_test_data
            
        except Exception as e:
            logger.error(f"Error splitting new data: {e}")
            return pd.DataFrame(), pd.DataFrame()

    def update_train_test_sets(self):
        """Main function to update both training and test sets with new scraped data"""
        try:
            logger.info("=== Starting Train/Test Set Update ===")
            
            # Step 1: Find the latest scraped file
            latest_file = self.find_latest_scraped_file()
            if not latest_file:
                logger.error("No new scraped file found to process")
                return False
            
            # Step 2: Read the new scraped data
            logger.info(f"Reading new scraped data from: {latest_file}")
            new_raw_data = pd.read_csv(latest_file)
            logger.info(f"New raw data shape: {new_raw_data.shape}")
            
            if new_raw_data.empty:
                logger.warning("New scraped file is empty")
                return False
            
            # Step 3: Clean and standardize the new data
            cleaned_new_data = self.clean_and_standardize_data(new_raw_data)
            
            if cleaned_new_data.empty:
                logger.warning("No valid data could be extracted from scraped file")
                return False
            
            # Step 4: Split new data into train/test portions
            new_train_data, new_test_data = self.split_new_data_by_time(cleaned_new_data)
            
            if new_train_data.empty and new_test_data.empty:
                logger.warning("No data after splitting")
                return False
            
            # Step 5: Update training set
            if not new_train_data.empty:
                success_train = self.update_training_set(new_train_data)
            else:
                success_train = True
                logger.info("No new training data to add")
            
            # Step 6: Update test set
            if not new_test_data.empty:
                success_test = self.update_test_set(new_test_data)
            else:
                success_test = True
                logger.info("No new test data to add")
            
            # Step 7: Archive the processed file
            if success_train and success_test:
                processed_filename = f"processed_{latest_file}"
                os.rename(latest_file, processed_filename)
                logger.info(f"📁 Original file archived as: {processed_filename}")
                
                logger.info("\n=== UPDATE SUMMARY ===")
                logger.info("✅ Successfully updated both training and test sets")
                logger.info("🔄 Data split intelligently between train/test")
                logger.info("📈 Models can now be retrained with fresh data")
                logger.info("🎯 Test set reflects current market conditions")
                
                return True
            else:
                logger.error("❌ Failed to update train/test sets")
                return False
                
        except Exception as e:
            logger.error(f"Error in update_train_test_sets: {e}")
            import traceback
            traceback.print_exc()
            return False

    def update_training_set(self, new_train_data):
        """Update the training set with new data"""
        try:
            logger.info("📚 Updating training set...")
            
            # Read existing training data
            if os.path.exists(self.train_path):
                existing_train = pd.read_csv(self.train_path)
                logger.info(f"Existing training data: {len(existing_train)} records")
            else:
                existing_train = pd.DataFrame()
                logger.info("Creating new training file")
            
            # Combine datasets
            if not existing_train.empty:
                # Ensure both dataframes have the same columns
                all_columns = set(existing_train.columns) | set(new_train_data.columns)
                
                for col in all_columns:
                    if col not in existing_train.columns:
                        existing_train[col] = None
                    if col not in new_train_data.columns:
                        new_train_data[col] = None
                
                # Reorder columns to match
                column_order = list(existing_train.columns)
                new_train_data = new_train_data[column_order]
                
                combined_train = pd.concat([existing_train, new_train_data], ignore_index=True)
            else:
                combined_train = new_train_data
            
            # Sort by date and remove duplicates
            combined_train['report_date'] = pd.to_datetime(combined_train['report_date'], errors='coerce')
            combined_train = combined_train[combined_train['report_date'].notna()]
            combined_train = combined_train.sort_values('report_date', ascending=False)
            
            # Remove duplicates
            dedup_columns = ['report_date', 'region', 'class', 'commodity', 'variety', 'organic', 'unit']
            available_dedup_columns = [col for col in dedup_columns if col in combined_train.columns]
            if available_dedup_columns:
                before_dedup = len(combined_train)
                combined_train = combined_train.drop_duplicates(subset=available_dedup_columns, keep='first')
                after_dedup = len(combined_train)
                logger.info(f"Removed {before_dedup - after_dedup} duplicate records from training set")
            
            # Convert date back to string format
            combined_train['report_date'] = combined_train['report_date'].dt.strftime('%m/%d/%Y')
            
            # Save updated training set
            combined_train.to_csv(self.train_path, index=False)
            logger.info(f"✅ Training set updated: {len(combined_train)} total records")
            
            return True
            
        except Exception as e:
            logger.error(f"Error updating training set: {e}")
            return False

    def update_test_set(self, new_test_data):
        """Update the test set with new data, maintaining rolling window"""
        try:
            logger.info("🧪 Updating test set...")
            
            # Read existing test data
            if os.path.exists(self.test_path):
                existing_test = pd.read_csv(self.test_path)
                logger.info(f"Existing test data: {len(existing_test)} records")
            else:
                existing_test = pd.DataFrame()
                logger.info("Creating new test file")
            
            # Combine datasets
            if not existing_test.empty:
                # Ensure both dataframes have the same columns
                all_columns = set(existing_test.columns) | set(new_test_data.columns)
                
                for col in all_columns:
                    if col not in existing_test.columns:
                        existing_test[col] = None
                    if col not in new_test_data.columns:
                        new_test_data[col] = None
                
                # Reorder columns to match
                column_order = list(existing_test.columns)
                new_test_data = new_test_data[column_order]
                
                combined_test = pd.concat([existing_test, new_test_data], ignore_index=True)
            else:
                combined_test = new_test_data
            
            # Sort by date and remove duplicates
            combined_test['report_date'] = pd.to_datetime(combined_test['report_date'], errors='coerce')
            combined_test = combined_test[combined_test['report_date'].notna()]
            combined_test = combined_test.sort_values('report_date', ascending=False)
            
            # Remove duplicates
            dedup_columns = ['report_date', 'region', 'class', 'commodity', 'variety', 'organic', 'unit']
            available_dedup_columns = [col for col in dedup_columns if col in combined_test.columns]
            if available_dedup_columns:
                before_dedup = len(combined_test)
                combined_test = combined_test.drop_duplicates(subset=available_dedup_columns, keep='first')
                after_dedup = len(combined_test)
                logger.info(f"Removed {before_dedup - after_dedup} duplicate records from test set")
            
            # Implement rolling window - keep only most recent records
            if len(combined_test) > self.max_test_records:
                logger.info(f"Trimming test set to most recent {self.max_test_records} records")
                combined_test = combined_test.head(self.max_test_records)
            
            # Convert date back to string format
            combined_test['report_date'] = combined_test['report_date'].dt.strftime('%m/%d/%Y')
            
            # Save updated test set
            combined_test.to_csv(self.test_path, index=False)
            logger.info(f"✅ Test set updated: {len(combined_test)} total records")
            
            return True
            
        except Exception as e:
            logger.error(f"Error updating test set: {e}")
            return False

def main():
    """Main entry point"""
    logger.info("🔄 === Train/Test Set Updater Started ===")
    
    # Use full paths to the data files
    train_path = "/Users/aryantanwar/Desktop/SmartStock_AI/Example_Train.csv"
    test_path = "/Users/aryantanwar/Desktop/SmartStock_AI/Example_Test.csv"
    
    updater = TrainTestUpdater(train_path, test_path)
    success = updater.update_train_test_sets()
    
    if success:
        logger.info("✅ Train/Test update completed successfully!")
        print("\n" + "="*50)
        print("✅ TRAIN/TEST UPDATE COMPLETED SUCCESSFULLY!")
        print("📚 Training set updated with 80% of new data")
        print("🧪 Test set updated with 20% of most recent data")
        print("🔄 Both sets now reflect current market conditions")
        print("🎯 Ready for model retraining with proper validation")
        print("="*50)
    else:
        logger.error("❌ Train/Test update failed!")
        print("\n" + "="*50)
        print("❌ TRAIN/TEST UPDATE FAILED!")
        print("Please check the logs for details")
        print("="*50)

if __name__ == "__main__":
    main() 