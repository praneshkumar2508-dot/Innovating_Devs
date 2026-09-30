import os
import glob
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables (Make sure you have SUPABASE_URL and SUPABASE_KEY in .env)
load_dotenv()

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")

if not url or not key:
    print("Error: SUPABASE_URL and SUPABASE_KEY must be set in .env")
    exit(1)

supabase: Client = create_client(url, key)

DATA_DIR = "resilienceos-predictive/data/datasets"

def upload_file(filepath, table_name):
    print(f"Uploading {filepath} to table {table_name}...")
    df = pd.read_csv(filepath)
    # Convert dataframe to list of dicts
    # Replace NaN with None so it translates to NULL in Supabase
    df = df.where(pd.notnull(df), None)
    records = df.to_dict(orient="records")
    
    # Upload in batches of 500 to avoid request size limits
    batch_size = 500
    for i in range(0, len(records), batch_size):
        batch = records[i:i+batch_size]
        response = supabase.table(table_name).insert(batch).execute()
        print(f"  Inserted {len(batch)} records (batch {i//batch_size + 1})")
    
    print(f"Finished uploading {filepath}\n")

if __name__ == "__main__":
    print("Starting data upload to Supabase...")
    
    # Upload Substation Data
    for file in glob.glob(os.path.join(DATA_DIR, "substation_*.csv")):
        upload_file(file, "telemetry_substation")
        
    # Upload Road Data
    for file in glob.glob(os.path.join(DATA_DIR, "road_*.csv")):
        upload_file(file, "telemetry_road")
        
    # Upload Water Plant Data
    for file in glob.glob(os.path.join(DATA_DIR, "water_plant_*.csv")):
        upload_file(file, "telemetry_water_plant")
        
    print("All datasets uploaded successfully!")
