import sqlite3
import os
import shutil
import glob
from datetime import datetime, timedelta
from .config import Config

def get_db_connection():
    """Establishes a connection to the SQLite database."""
    # When running on a router, use the local traffic.db file instead of the live database
    if os.path.exists(Config.ROUTER_DB_PATH) and Config.LIVE_DB_PATH == Config.ROUTER_DB_PATH:
        return sqlite3.connect(Config.LOCAL_DB_PATH)
    return sqlite3.connect(Config.LIVE_DB_PATH)

def get_router_db_connection():
    """Establishes a connection to the router's live SQLite database."""
    if os.path.exists(Config.ROUTER_DB_PATH):
        return sqlite3.connect(Config.ROUTER_DB_PATH)
    return None

def get_local_traffic_db_connection():
    """Establishes a connection to the local traffic.db database."""
    return sqlite3.connect(Config.LOCAL_DB_PATH)

def sync_data_from_router():
    """
    Synchronize data from router's live database to local traffic.db.
    Uses a rolling window approach to handle router database resets.
    """
    try:
        # Connect to both databases
        router_conn = get_router_db_connection()
        if not router_conn:
            print("Router database not found. Skipping sync.")
            return False
            
        # Set router connection to read-only mode to prevent any writes
        router_conn.execute("PRAGMA query_only = ON")
            
        local_conn = get_local_traffic_db_connection()
        
        # Use a rolling window (last 48 hours) to handle router resets
        window_start_time = int((datetime.now() - timedelta(hours=48)).timestamp())
        print(f"Syncing data from last 48 hours (timestamp >= {window_start_time})")
        
        # Get records from router database within the rolling window
        router_cursor = router_conn.cursor()
        router_cursor.execute("""
            SELECT mac, app_name, cat_name, timestamp, tx, rx
            FROM traffic 
            WHERE timestamp >= ?
            ORDER BY timestamp
        """, (window_start_time,))
        
        records = router_cursor.fetchall()
        print(f"Found {len(records)} records in sync window")
        
        if records:
            # Insert records into local database, ignoring duplicates
            local_cursor = local_conn.cursor()
            local_cursor.executemany("""
                INSERT OR IGNORE INTO traffic (mac, app_name, cat_name, timestamp, tx, rx) 
                VALUES (?, ?, ?, ?, ?, ?)
            """, records)
            local_conn.commit()
            inserted_count = local_cursor.rowcount
            print(f"Successfully synced {inserted_count} new records")
        else:
            print("No new records to sync")
            
        # Close connections
        router_conn.close()
        local_conn.close()
        
        return True
    except Exception as e:
        print(f"Error syncing data from router: {e}")
        return False

def init_db():
    # When running on a router, initialize the local traffic.db file
    if os.path.exists(Config.ROUTER_DB_PATH) and Config.LIVE_DB_PATH == Config.ROUTER_DB_PATH:
        conn = sqlite3.connect(Config.LOCAL_DB_PATH)
    else:
        conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if the traffic table exists and has the correct schema
    cursor.execute("PRAGMA table_info(traffic)")
    columns = cursor.fetchall()
    
    # If table doesn't exist, create it with the correct schema
    if not columns:
        cursor.execute("""
            CREATE TABLE traffic (
                mac TEXT,
                app_name VARCHAR(50),
                cat_name VARCHAR(50),
                timestamp UNSIGNED BIG INT,
                tx UNSIGNED BIG INT,
                rx UNSIGNED BIG INT,
                PRIMARY KEY (mac, timestamp, app_name)
            );
        """)
    else:
        # Check if we have the primary key constraint
        # We can check this by looking for existing data and trying to insert duplicates
        # For now, let's just ensure the table is created properly for new databases
        # Existing databases with the old schema will need manual migration or will continue to have the duplication issue
        pass
    
    # Create the traffic table with schema identical to the router's TrafficAnalyzer.db
    # Note: We omit the 'id' column to maintain exact schema compatibility
    # We also add a PRIMARY KEY constraint to prevent duplicates
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS traffic (
            mac TEXT,
            app_name VARCHAR(50),
            cat_name VARCHAR(50),
            timestamp UNSIGNED BIG INT,
            tx UNSIGNED BIG INT,
            rx UNSIGNED BIG INT,
            PRIMARY KEY (mac, timestamp, app_name)
        );
    """)
    conn.commit()
    conn.close()

def check_db_integrity():
    """
    Checks the integrity of the SQLite database using PRAGMA quick_check.
    Returns True if database is healthy, False if corrupted or missing.
    """
    try:
        # Check if database file exists
        if not os.path.exists(Config.LIVE_DB_PATH):
            print(f"Database file not found: {Config.LIVE_DB_PATH}")
            return False
            
        # Try to connect and run integrity check
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Run SQLite's built-in integrity check
        cursor.execute("PRAGMA quick_check;")
        result = cursor.fetchone()
        
        conn.close()
        
        # Check if integrity is OK
        if result and result[0] == "ok":
            return True
        else:
            print(f"Database integrity check failed: {result}")
            return False
    except sqlite3.DatabaseError as e:
        print(f"Database error during integrity check: {e}")
        return False
    except Exception as e:
        print(f"Unexpected error during integrity check: {e}")
        return False

def restore_db_from_backup(backup_path=None):
    """
    Restores the database from a backup file.
    If backup_path is None, uses the most recent backup.
    Supports both compressed (.db.gz) and uncompressed (.db) files.
    Returns True if successful, False otherwise.
    """
    try:
        # Ensure logs directory exists
        os.makedirs(Config.LOGS_DIR, exist_ok=True)

        if backup_path is None:
            # Find the most recent backup
            if not os.path.exists(Config.DB_BACKUPS_DIR):
                print(f"Backup directory not found: {Config.DB_BACKUPS_DIR}")
                return False

            # Find all backup files (both compressed and uncompressed)
            backup_files = glob.glob(os.path.join(Config.DB_BACKUPS_DIR, "TrafficAnalyzer_*.db.gz"))
            backup_files.extend(glob.glob(os.path.join(Config.DB_BACKUPS_DIR, "TrafficAnalyzer_*.db")))

            if not backup_files:
                print("No database backups found.")
                return False

            # Sort by modification time (newest first)
            backup_files.sort(key=os.path.getmtime, reverse=True)

            # Get the most recent backup
            backup_path = backup_files[0]

        # Validate the backup file exists
        if not os.path.exists(backup_path):
            print(f"Backup file not found: {backup_path}")
            return False

        print(f"Restoring database from backup: {os.path.basename(backup_path)}")

        # Determine if file is compressed
        is_compressed = backup_path.endswith('.db.gz')
        
        # Log the corruption event
        restore_log = os.path.join(Config.LOGS_DIR, "db_restore_history.log")
        corruption_timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        with open(restore_log, "a") as f:
            f.write(f"[{corruption_timestamp}] DETECTED: TrafficAnalyzer.db is missing/corrupt\n")
        
        # Extract the backup
        import subprocess
        # Restore to the local traffic.db file, not the live database
        temp_db_path = Config.LOCAL_DB_PATH + ".tmp"

        # Handle compressed or uncompressed files
        if is_compressed:
            # Decompress the backup
            with open(temp_db_path, "wb") as temp_db_file:
                result = subprocess.run(
                    ["gunzip", "-c", backup_path],
                    stdout=temp_db_file,
                    stderr=subprocess.PIPE
                )

            if result.returncode != 0:
                print(f"Failed to decompress backup: {result.stderr.decode()}")
                if os.path.exists(temp_db_path):
                    os.remove(temp_db_path)
                with open(restore_log, "a") as f:
                    f.write(f"[{corruption_timestamp}] FAILED: Could not decompress {os.path.basename(backup_path)}\n")
                return False
        else:
            # Copy uncompressed file directly
            shutil.copy2(backup_path, temp_db_path)
            
        # Check integrity of restored database
        temp_config = Config
        temp_config.LIVE_DB_PATH = temp_db_path
        
        # Create a temporary function to check integrity of the restored DB
        def check_temp_db_integrity(db_path):
            try:
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                cursor.execute("PRAGMA quick_check;")
                result = cursor.fetchone()
                conn.close()
                return result and result[0] == "ok"
            except Exception:
                return False
        
        if not check_temp_db_integrity(temp_db_path):
            print("Restored database is corrupted. Cannot restore.")
            os.remove(temp_db_path)
            with open(restore_log, "a") as f:
                f.write(f"[{corruption_timestamp}] FAILED: Restored database {os.path.basename(backup_path)} is corrupted\n")
            return False
            
        # Backup the corrupted database if it exists
        # Backup the local traffic.db file, not the live database
        if os.path.exists(Config.LOCAL_DB_PATH):
            corrupted_backup = Config.LOCAL_DB_PATH + ".corrupted." + datetime.now().strftime("%Y%m%d_%H%M%S")
            shutil.move(Config.LOCAL_DB_PATH, corrupted_backup)
            print(f"Corrupted database backed up to: {corrupted_backup}")
            
        # Move the restored database to the correct location
        # Restore to the local traffic.db file
        shutil.move(temp_db_path, Config.LOCAL_DB_PATH)
        os.chmod(Config.LOCAL_DB_PATH, 0o600)  # Set proper permissions
        
        # Log the successful restoration
        restore_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        with open(restore_log, "a") as f:
            f.write(f"[{restore_time}] RESTORED: Successfully restored from {os.path.basename(backup_path)}\n")
            f.write(f"[{restore_time}] TIME GAP: DB was unavailable between {corruption_timestamp} and {restore_time}\n")

        # Create marker for dashboard
        last_restore_info = f"{corruption_timestamp}|{restore_time}|{os.path.basename(backup_path)}"
        last_restore_file = os.path.join(Config.DATA_DIR, "last_restore.txt")
        with open(last_restore_file, "w") as f:
            f.write(last_restore_info)
            
        print("Database successfully restored from backup.")
        return True
    except Exception as e:
        print(f"Error restoring database from backup: {e}")
        # Log the failure
        restore_log = os.path.join(Config.LOGS_DIR, "db_restore_history.log")
        corruption_timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        with open(restore_log, "a") as f:
            f.write(f"[{corruption_timestamp}] CRITICAL: Exception during restore process: {e}\n")
        return False

# Global flag to enable/disable self-healing
SELF_HEALING_ENABLED = False

def ensure_healthy_database():
    """
    Ensures the database is healthy, restoring from backup if necessary.
    This function replicates the self-healing behavior from v2.0.
    Returns True if database is healthy, False otherwise.
    """
    # Check if self-healing is disabled globally
    if not SELF_HEALING_ENABLED:
        return True
    
    # Ensure logs directory exists
    os.makedirs(Config.LOGS_DIR, exist_ok=True)
    
    # When running on a router, check the local traffic.db file instead of the live database
    original_live_db_path = Config.LIVE_DB_PATH
    if os.path.exists(Config.ROUTER_DB_PATH) and Config.LOCAL_DB_PATH != Config.ROUTER_DB_PATH:
        # Temporarily set LIVE_DB_PATH to the local traffic.db for health check
        Config.LIVE_DB_PATH = Config.LOCAL_DB_PATH
    
    try:
        if not check_db_integrity():
            print("Database integrity check failed. Attempting to restore from backup...")
            
            if restore_db_from_backup():
                # Verify integrity after restoration
                if check_db_integrity():
                    print("Database successfully restored and verified.")
                    return True
                else:
                    print("Database restored but still failing integrity check.")
                    return False
            else:
                print("Failed to restore database from backup.")
                return False
        else:
            return True
    finally:
        # Restore the original LIVE_DB_PATH
        Config.LIVE_DB_PATH = original_live_db_path

def import_history_from_router():
    """
    Import all historical data from router's database to local traffic.db.
    This is a one-time operation to populate traffic.db with all existing data.
    """
    try:
        # Connect to both databases
        router_conn = get_router_db_connection()
        if not router_conn:
            print("Router database not found. Skipping import.")
            return False
            
        # Set router connection to read-only mode to prevent any writes
        router_conn.execute("PRAGMA query_only = ON")
            
        local_conn = get_local_traffic_db_connection()
        
        print("Importing all historical data from router database...")
        
        # Get all records from router database
        router_cursor = router_conn.cursor()
        router_cursor.execute("""
            SELECT mac, app_name, cat_name, timestamp, tx, rx
            FROM traffic 
            ORDER BY timestamp
        """)
        
        records = router_cursor.fetchall()
        print(f"Found {len(records)} total records to import")
        
        if records:
            # Insert records into local database, ignoring duplicates
            local_cursor = local_conn.cursor()
            local_cursor.executemany("""
                INSERT OR IGNORE INTO traffic (mac, app_name, cat_name, timestamp, tx, rx) 
                VALUES (?, ?, ?, ?, ?, ?)
            """, records)
            local_conn.commit()
            inserted_count = local_cursor.rowcount
            print(f"Successfully imported {inserted_count} new records")
        else:
            print("No records to import")
            
        # Close connections
        router_conn.close()
        local_conn.close()
        
        return True
    except Exception as e:
        print(f"Error importing data from router: {e}")
        return False