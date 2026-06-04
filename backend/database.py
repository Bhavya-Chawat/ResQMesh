import os
import time
import logging
import sqlite3
import threading
from datetime import datetime

log = logging.getLogger(__name__)

# Try to load Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

use_supabase = False
supabase_client = None

if SUPABASE_URL and SUPABASE_KEY:
    try:
        from supabase import create_client
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        use_supabase = True
        log.info("Supabase client initialized successfully.")
    except Exception as e:
        log.error("Failed to initialize Supabase client: %s. Falling back to SQLite.", e)
else:
    log.info("Supabase credentials missing in .env. Using local SQLite database.")

DB_FILE = "resqmesh_history.db"

# Throttle settings for database inserts to prevent cloud database bloating
DB_LOG_INTERVAL_SEC = float(os.getenv("DB_LOG_INTERVAL_SEC", "5.0"))
last_save_time = {}
last_save_lock = threading.Lock()

def init_db():
    """Initialise local SQLite database if fallback is active."""
    # Always create local SQLite table in case we are using it
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS telemetry_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                node_id TEXT NOT NULL,
                temperature REAL,
                humidity REAL,
                gas_level REAL,
                battery REAL
            )
        """)
        conn.commit()
        conn.close()
        log.info("Local SQLite database verified/initialised.")
    except Exception as e:
        log.error("Failed to initialise local SQLite database: %s", e)

# Run SQLite table creation on import
init_db()

def save_telemetry(node_id: str, temperature: float, humidity: float, gas_level: float, battery: float):
    """Save a sensor telemetry payload to the database (Supabase or SQLite)."""
    if not node_id:
        return

    # Enforce logging rate limit per node to prevent database bloating
    now = time.time()
    with last_save_lock:
        if node_id in last_save_time:
            elapsed = now - last_save_time[node_id]
            if elapsed < DB_LOG_INTERVAL_SEC:
                return
        last_save_time[node_id] = now

    # 1. Save to Supabase if active
    if use_supabase and supabase_client:
        try:
            data = {
                "node_id": node_id,
                "temperature": float(temperature),
                "humidity": float(humidity),
                "gas_level": float(gas_level),
                "battery": float(battery)
            }
            # supabase-py insert
            supabase_client.table("telemetry_history").insert(data).execute()
            log.info("[DB] Saved telemetry for node %s to Supabase", node_id)
            return
        except Exception as e:
            log.error("[DB] Supabase save failed: %s. Writing to SQLite backup.", e)

    # 2. Save to SQLite fallback
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO telemetry_history (node_id, temperature, humidity, gas_level, battery)
            VALUES (?, ?, ?, ?, ?)
        """, (node_id, float(temperature), float(humidity), float(gas_level), float(battery)))
        conn.commit()
        conn.close()
        log.info("[DB] Saved telemetry for node %s to SQLite", node_id)
    except Exception as e:
        log.error("[DB] SQLite save failed: %s", e)

def get_telemetry_history(node_id=None, limit=150):
    """Retrieve historical telemetry entries (descending by timestamp)."""
    records = []
    
    # 1. Query from Supabase if active
    if use_supabase and supabase_client:
        try:
            query = supabase_client.table("telemetry_history").select("*").order("created_at", desc=True)
            if node_id:
                query = query.eq("node_id", node_id)
            query = query.limit(limit)
            
            res = query.execute()
            # Supabase response contains .data
            for row in res.data:
                # Convert ISO string (e.g. 2026-06-03T18:00:00.000Z) to readable format
                try:
                    dt = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
                    ts_str = dt.strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    ts_str = row["created_at"]
                
                records.append({
                    "id": row["id"],
                    "timestamp": ts_str,
                    "node_id": row["node_id"],
                    "temperature": row["temperature"],
                    "humidity": row["humidity"],
                    "gas_level": row["gas_level"],
                    "battery": row["battery"]
                })
            return records
        except Exception as e:
            log.error("[DB] Supabase query failed: %s. Querying SQLite backup.", e)

    # 2. Query from SQLite
    try:
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        if node_id:
            cursor.execute("""
                SELECT id, created_at, node_id, temperature, humidity, gas_level, battery
                FROM telemetry_history
                WHERE node_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            """, (node_id, limit))
        else:
            cursor.execute("""
                SELECT id, created_at, node_id, temperature, humidity, gas_level, battery
                FROM telemetry_history
                ORDER BY created_at DESC
                LIMIT ?
            """, (limit,))
        
        rows = cursor.fetchall()
        for row in rows:
            # SQLite default timestamp format: 2026-06-03 18:00:00
            records.append({
                "id": row["id"],
                "timestamp": row["created_at"],
                "node_id": row["node_id"],
                "temperature": row["temperature"],
                "humidity": row["humidity"],
                "gas_level": row["gas_level"],
                "battery": row["battery"]
            })
        conn.close()
    except Exception as e:
        log.error("[DB] SQLite query failed: %s", e)
        
    return records

def get_analytics_summary():
    """Compute and return descriptive statistical summary for all active nodes."""
    summary = {}
    
    # We load all recent rows to calculate averages and anomalies
    raw_history = []
    
    # 1. Fetch from Supabase
    if use_supabase and supabase_client:
        try:
            res = supabase_client.table("telemetry_history").select("*").order("created_at", desc=True).limit(500).execute()
            raw_history = res.data
        except Exception as e:
            log.error("[DB] Supabase analytics fetch failed: %s. Fetching from SQLite.", e)

    # 2. Fetch from SQLite if Supabase failed or not used
    if not raw_history:
        try:
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("""
                SELECT created_at, node_id, temperature, humidity, gas_level, battery
                FROM telemetry_history
                ORDER BY created_at DESC
                LIMIT 500
            """)
            rows = cursor.fetchall()
            raw_history = [dict(r) for r in rows]
            conn.close()
        except Exception as e:
            log.error("[DB] SQLite analytics fetch failed: %s", e)

    if not raw_history:
        return summary

    # Group by node_id
    node_groups = {}
    for entry in raw_history:
        nid = entry["node_id"]
        node_groups.setdefault(nid, []).append(entry)

    # Calculate metrics for each node
    for nid, entries in node_groups.items():
        temps = [e["temperature"] for e in entries if e["temperature"] is not None]
        hums  = [e["humidity"] for e in entries if e["humidity"] is not None]
        gases = [e["gas_level"] for e in entries if e["gas_level"] is not None]
        bats  = [e["battery"] for e in entries if e["battery"] is not None]

        if not temps:
            continue

        avg_temp = sum(temps) / len(temps)
        avg_hum  = sum(hums) / len(hums) if hums else 50.0
        avg_gas  = sum(gases) / len(gases) if gases else 100.0
        
        peak_gas = max(gases) if gases else 100.0
        min_temp = min(temps)
        max_temp = max(temps)

        # Basic anomaly detection (e.g. gas spikes > 250 ppm, or temperature > 45°C)
        gas_anomalies = sum(1 for g in gases if g > 250.0)
        temp_anomalies = sum(1 for t in temps if t > 45.0)

        summary[nid] = {
            "node_id": nid,
            "sample_count": len(entries),
            "avg_temp": round(avg_temp, 2),
            "min_temp": round(min_temp, 2),
            "max_temp": round(max_temp, 2),
            "avg_hum": round(avg_hum, 2),
            "avg_gas": round(avg_gas, 2),
            "peak_gas": round(peak_gas, 2),
            "avg_bat": round(sum(bats)/len(bats), 2) if bats else 100.0,
            "anomalies_detected": gas_anomalies + temp_anomalies,
            "gas_anomalies": gas_anomalies,
            "temp_anomalies": temp_anomalies
        }

    return summary
