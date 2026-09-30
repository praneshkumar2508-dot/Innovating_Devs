const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const connectionString = 'postgresql://postgres:SANTHOSH%40123@db.hnnkgopefjbkrdaamcsa.supabase.co:5432/postgres';
const DATA_DIR = path.join(__dirname, '..', 'resilienceos-predictive', 'data', 'datasets');

const createTablesSQL = `
DROP TABLE IF EXISTS telemetry_substation, telemetry_road, telemetry_water_plant CASCADE;

CREATE TABLE telemetry_substation (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    node_id TEXT NOT NULL,
    load_kw FLOAT,
    capacity_kw FLOAT,
    load_ratio FLOAT,
    voltage FLOAT,
    voltage_deviation FLOAT,
    frequency_hz FLOAT,
    temperature FLOAT,
    temperature_trend FLOAT,
    vibration FLOAT,
    humidity FLOAT,
    oil_level FLOAT,
    transformer_age_years FLOAT,
    backup_fuel_pct FLOAT,
    population_served FLOAT,
    health_status TEXT,
    failure_label FLOAT
);

CREATE TABLE telemetry_road (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    node_id TEXT NOT NULL,
    traffic_flow_pct FLOAT,
    capacity_vehicles_hr FLOAT,
    current_vehicles_hr FLOAT,
    load_ratio FLOAT,
    avg_speed_kmh FLOAT,
    speed_deviation FLOAT,
    incident_count FLOAT,
    road_surface_score FLOAT,
    visibility_km FLOAT,
    rainfall_mm FLOAT,
    flood_depth_cm FLOAT,
    debris_coverage_pct FLOAT,
    crew_access_blocked BOOLEAN,
    detour_available BOOLEAN,
    population_served FLOAT,
    health_status TEXT,
    failure_label FLOAT
);

CREATE TABLE telemetry_water_plant (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    node_id TEXT NOT NULL,
    flow_rate_lps FLOAT,
    capacity_lps FLOAT,
    load_ratio FLOAT,
    pressure_bar FLOAT,
    pressure_deviation FLOAT,
    chlorine_ppm FLOAT,
    turbidity_ntu FLOAT,
    ph_level FLOAT,
    pump_temperature FLOAT,
    pump_vibration FLOAT,
    power_supply_kw FLOAT,
    reservoir_level_pct FLOAT,
    pipeline_age_years FLOAT,
    population_served FLOAT,
    health_status TEXT,
    failure_label FLOAT
);
`;

async function main() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        console.log("Connected to Supabase Postgres.");

        console.log("Creating tables...");
        await client.query(createTablesSQL);
        console.log("Tables created successfully.");

        const processFile = (filePath, tableName) => {
            return new Promise((resolve, reject) => {
                const results = [];
                fs.createReadStream(filePath)
                    .pipe(csv())
                    .on('data', (data) => results.push(data))
                    .on('end', async () => {
                        console.log(`Uploading ${results.length} rows to ${tableName} from ${path.basename(filePath)}...`);
                        
                        if (results.length === 0) {
                            resolve();
                            return;
                        }

                        const keys = Object.keys(results[0]);
                        const query = `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(', ')})`;
                        
                        try {
                            await client.query('BEGIN');
                            for (const row of results) {
                                const values = keys.map(k => {
                                    if (row[k] === '') return null;
                                    // Handle python booleans that might be strings
                                    if (row[k] === 'True') return true;
                                    if (row[k] === 'False') return false;
                                    return row[k];
                                });
                                await client.query(query, values);
                            }
                            await client.query('COMMIT');
                            console.log(`Finished ${path.basename(filePath)}`);
                            resolve();
                        } catch (err) {
                            await client.query('ROLLBACK');
                            console.error('Failed row insert query:', query);
                            reject(err);
                        }
                    });
            });
        };

        const files = fs.readdirSync(DATA_DIR);
        for (const file of files) {
            if (!file.endsWith('.csv')) continue;
            const fullPath = path.join(DATA_DIR, file);
            let tableName = '';
            if (file.startsWith('substation_')) tableName = 'telemetry_substation';
            else if (file.startsWith('road_')) tableName = 'telemetry_road';
            else if (file.startsWith('water_plant_')) tableName = 'telemetry_water_plant';
            
            if (tableName) {
                await processFile(fullPath, tableName);
            }
        }
        
        console.log("All data uploaded successfully!");

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await client.end();
    }
}

main();
