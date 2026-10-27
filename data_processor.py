#!/usr/bin/env python3
"""
CORRECTLY FIXED Data Processor - Handles the actual scraped data structure
The scraped data is already in long format in columns 0-15, with extra wide-format columns 16+
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

def find_latest_scraped_file():
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

def clean_scraped_data(df):
    """
    Clean the scraped data - it's already in long format in first 16 columns
    Just need to extract and clean the relevant columns
    """
    try:
        logger.info("Cleaning scraped data...")
        logger.info(f"Original data shape: {df.shape}")
        logger.info(f"Original columns: {list(df.columns)}")
        
        # Define the target columns that match Example_Train.csv
        target_columns = [
            'report_date', 'region', 'class', 'commodity', 'variety', 'organic', 
            'unit', 'environment', 'price_min', 'price_max', 'current_ad_count', 
            'current_wtd_avg_price', 'priorwk_ad_count', 'priorwk_wtd_avg_price',
            'prioryr_ad_count', 'prioryr_wtd_avg_price'
        ]
        
        # Map the actual column names to target names (case-insensitive)
        column_mapping = {}
        df_columns_lower = [col.lower().replace(' ', '_') for col in df.columns]
        
        for i, target_col in enumerate(target_columns):
            # Look for exact match first
            if target_col in df_columns_lower:
                actual_col = df.columns[df_columns_lower.index(target_col)]
                column_mapping[actual_col] = target_col
            else:
                # Look for similar column names
                target_words = target_col.split('_')
                for j, df_col in enumerate(df.columns):
                    df_col_clean = df_col.lower().replace(' ', '_')
                    if all(word in df_col_clean for word in target_words):
                        column_mapping[df_col] = target_col
                        break
        
        logger.info(f"Column mapping found: {column_mapping}")
        
        # Extract the relevant columns
        cleaned_data = []
        
        for _, row in df.iterrows():
            try:
                # Create a record with target structure
                record = {}
                
                # Map known columns
                for actual_col, target_col in column_mapping.items():
                    value = row[actual_col]
                    if pd.notna(value) and str(value).strip() != '':
                        record[target_col] = str(value).strip()
                    else:
                        record[target_col] = None
                
                # Fill in missing columns with defaults or None
                for col in target_columns:
                    if col not in record:
                        record[col] = None
                
                # Validate that we have essential data
                if record.get('commodity') and record.get('commodity') not in ['', 'None', 'null']:
                    # Clean up the data types
                    
                    # Date formatting
                    if record['report_date']:
                        try:
                            # Try to parse and reformat date
                            parsed_date = pd.to_datetime(record['report_date'])
                            record['report_date'] = parsed_date.strftime('%m/%d/%Y')
                        except:
                            pass
                    
                    # Numeric fields
                    numeric_fields = ['price_min', 'price_max', 'current_ad_count', 
                                    'current_wtd_avg_price', 'priorwk_ad_count', 
                                    'priorwk_wtd_avg_price', 'prioryr_ad_count', 'prioryr_wtd_avg_price']
                    
                    for field in numeric_fields:
                        if record[field] and record[field] not in ['', 'None', 'null']:
                            try:
                                record[field] = float(record[field])
                            except:
                                record[field] = None
                    
                    # Set defaults for missing essential fields
                    if not record['region']:
                        record['region'] = 'Midwest'
                    if not record['class']:
                        record['class'] = 'Vegetables'
                    if not record['organic']:
                        record['organic'] = 'No'
                    if not record['unit']:
                        record['unit'] = 'per lb'
                    if not record['environment']:
                        record['environment'] = 'N/A'
                    if not record['variety']:
                        record['variety'] = 'N/A'
                    
                    cleaned_data.append(record)
                    
            except Exception as e:
                logger.warning(f"Error processing row: {e}")
                continue
        
        if cleaned_data:
            result_df = pd.DataFrame(cleaned_data)
            
            # Ensure all target columns exist
            for col in target_columns:
                if col not in result_df.columns:
                    result_df[col] = None
            
            # Reorder columns
            result_df = result_df[target_columns]
            
            logger.info(f"✅ Cleaned data shape: {result_df.shape}")
            logger.info(f"Commodities found: {result_df['commodity'].value_counts().to_dict()}")
            
            return result_df
        else:
            logger.warning("No valid records could be extracted")
            return pd.DataFrame(columns=target_columns)
            
    except Exception as e:
        logger.error(f"Error in clean_scraped_data: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()

def process_and_append_data():
    """Main function to process new data and append to Example_Train.csv"""
    try:
        logger.info("=== Starting CORRECTLY FIXED Data Processing ===")
        
        # Step 1: Find the latest scraped file
        latest_file = find_latest_scraped_file()
        if not latest_file:
            logger.error("No new scraped file found to process")
            return False
        
        # Step 2: Read the new scraped data
        logger.info(f"Reading new scraped data from: {latest_file}")
        new_data = pd.read_csv(latest_file)
        logger.info(f"New data shape: {new_data.shape}")
        
        if new_data.empty:
            logger.warning("New scraped file is empty")
            return False
        
        # Step 3: Clean the data (extract first 16 columns properly)
        logger.info("Cleaning and extracting relevant data...")
        cleaned_data = clean_scraped_data(new_data)
        
        if cleaned_data.empty:
            logger.warning("No valid data could be extracted from scraped file")
            return False
        
        logger.info(f"Cleaned data shape: {cleaned_data.shape}")
        
        # Step 4: Read existing Example_Train.csv if it exists
        example_file = "Example_Train.csv"
        if os.path.exists(example_file):
            logger.info("Reading existing Example_Train.csv")
            existing_data = pd.read_csv(example_file)
            logger.info(f"Existing data shape: {existing_data.shape}")
        else:
            logger.info("Example_Train.csv not found, will create new file")
            existing_data = pd.DataFrame()
        
        # Step 5: Combine the datasets
        if not existing_data.empty:
            # Combine dataframes
            combined_data = pd.concat([existing_data, cleaned_data], ignore_index=True)
        else:
            combined_data = cleaned_data
        
        # Step 6: Convert report_date to datetime for sorting
        logger.info("Converting dates and sorting data...")
        combined_data['report_date'] = pd.to_datetime(combined_data['report_date'], errors='coerce')
        
        # Remove rows with invalid dates
        valid_date_mask = combined_data['report_date'].notna()
        logger.info(f"Rows with valid dates: {valid_date_mask.sum()} out of {len(combined_data)}")
        combined_data = combined_data[valid_date_mask]
        
        # Sort by date (latest to oldest)
        # Stable sort keeps existing rows ahead of new ones within a date, so keep='last' prefers the fresh scrape
        combined_data = combined_data.sort_values('report_date', ascending=False, kind='stable')
        
        # Convert date back to string format for CSV
        combined_data['report_date'] = combined_data['report_date'].dt.strftime('%m/%d/%Y')
        
        # Step 7: Remove duplicates
        logger.info("Removing duplicates...")
        before_dedup = len(combined_data)
        
        # Define columns to consider for duplicates
        dedup_columns = ['report_date', 'region', 'class', 'commodity', 'variety', 'organic', 'unit']
        combined_data = combined_data.drop_duplicates(subset=dedup_columns, keep='last')
        
        after_dedup = len(combined_data)
        logger.info(f"Removed {before_dedup - after_dedup} duplicate rows")
        
        # Step 8: Save the combined data back to Example_Train.csv
        logger.info("Saving combined data to Example_Train.csv...")
        combined_data.to_csv(example_file, index=False)
        
        # Step 9: Create a backup with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_filename = f"Example_Train_backup_{timestamp}.csv"
        combined_data.to_csv(backup_filename, index=False)
        
        # Step 10: Generate summary report
        logger.info("\n=== PROCESSING SUMMARY ===")
        logger.info(f"✅ Successfully processed and appended data")
        logger.info(f"📊 Total rows in final dataset: {len(combined_data)}")
        logger.info(f"📊 New rows added: {len(cleaned_data)}")
        
        if len(combined_data) > 0:
            logger.info(f"📅 Date range: {combined_data['report_date'].min()} to {combined_data['report_date'].max()}")
            
            # Count commodities
            commodity_counts = combined_data['commodity'].value_counts()
            logger.info(f"🥬 Commodities in dataset:")
            for commodity, count in commodity_counts.head(15).items():
                logger.info(f"   {commodity}: {count} records")
            
            # Show new commodities added
            new_commodities = cleaned_data['commodity'].value_counts()
            logger.info(f"🆕 New commodities added this run:")
            for commodity, count in new_commodities.items():
                logger.info(f"   {commodity}: {count} new records")
        
        logger.info(f"💾 Main file saved: {example_file}")
        logger.info(f"💾 Backup created: {backup_filename}")
        
        # Step 11: Archive the processed new file
        processed_filename = f"processed_{latest_file}"
        os.rename(latest_file, processed_filename)
        logger.info(f"📁 Original file archived as: {processed_filename}")
        
        return True
        
    except Exception as e:
        logger.error(f"Error in process_and_append_data: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Main entry point"""
    logger.info("🔄 === CORRECTLY FIXED Data Processor Started ===")
    
    success = process_and_append_data()
    
    if success:
        logger.info("✅ Data processing completed successfully!")
        print("\n" + "="*50)
        print("✅ DATA PROCESSING COMPLETED SUCCESSFULLY!")
        print("📊 New data has been appended to Example_Train.csv")
        print("🥬 Multiple vegetables processed and added!")
        print("📅 Data is sorted from latest to oldest date")
        print("🔄 Ready for next scraping cycle")
        print("="*50)
    else:
        logger.error("❌ Data processing failed!")
        print("\n" + "="*50)
        print("❌ DATA PROCESSING FAILED!")
        print("Please check the logs for details")
        print("="*50)

if __name__ == "__main__":
    main()
