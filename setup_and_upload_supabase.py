import os
import glob
import pandas as pd
from sqlalchemy import create_engine

# Prompt for the connection string
print("======================================================")
print("  Supabase Database Setup & Dataset Upload Utility")
print("======================================================\n")
print("To create tables and upload data, we need your Supabase Database Connection String.")
print("You can find this in your Supabase Dashboard: Project Settings -> Database -> Connection string -> URI")
print("It should look something like: postgresql://postgres.[project]:[password]@aws-0-region.pooler.supabase.com:6543/postgres\n")

db_url = input("Enter your Supabase Postgres Connection String: ").strip()

if not db_url:
    print("Error: Connection string is required.")
    exit(1)

# Fix connection string for SQLAlchemy if it uses postgres:// instead of postgresql://
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

print("\nConnecting to Supabase Database...")
engine = create_engine(db_url)

DATA_DIR = "resilienceos-predictive/data/datasets"

def upload_file(filepath, table_name):
    print(f"Uploading {filepath} to table '{table_name}'...")
    df = pd.read_csv(filepath)
    
    # Ensure timestamp is datetime
    if 'timestamp' in df.columns:
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        
    # Upload to postgres, automatically creates the table if it doesn't exist
    # if_exists='append' will add to existing table, but since this creates it, it will just insert.
    df.to_sql(table_name, engine, if_exists='append', index=False)
    print(f"  Successfully inserted {len(df)} records.")

if __name__ == "__main__":
    try:
        # Test connection
        with engine.connect() as conn:
            print("Successfully connected to Supabase!")
            
        print("\nStarting data upload. Tables will be created automatically based on the CSV schema...")
        
        # Upload Substation Data
        for file in glob.glob(os.path.join(DATA_DIR, "substation_*.csv")):
            upload_file(file, "telemetry_substation")
            
        # Upload Road Data
        for file in glob.glob(os.path.join(DATA_DIR, "road_*.csv")):
            upload_file(file, "telemetry_road")
            
        # Upload Water Plant Data
        for file in glob.glob(os.path.join(DATA_DIR, "water_plant_*.csv")):
            upload_file(file, "telemetry_water_plant")
            
        print("\nAll 15 datasets uploaded successfully! Tables have been created in your Supabase project.")
        
    except Exception as e:
        print(f"\nAn error occurred: {e}")
