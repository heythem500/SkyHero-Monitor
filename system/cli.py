import os
import sys
import json
import hashlib
import subprocess
from datetime import datetime, timedelta
from .config import Config
from .reports import create_daily_rollup, run_traffic_monitor, create_monthly_reports
from .database import ensure_healthy_database, import_history_from_router, sync_data_from_router
from .api import app

# =============================================================================
# Section 5: CLI Command Handler
# =============================================================================

def set_password():
    """Handles setting/changing the password via CLI."""
    try:
        from getpass import getpass
        password = getpass("Enter new password: ")
        confirm_password = getpass("Confirm new password: ")
        if password != confirm_password:
            print("Passwords do not match. Aborting.")
            return
        if not password:
            print("Password cannot be empty. Aborting.")
            return

        hashed_password = hashlib.sha256(password.encode()).hexdigest()
        with open(Config.PASSWORD_FILE, 'w') as f:
            f.write(hashed_password)
        print("Password updated successfully.")
    except ImportError:
        print("Could not import getpass. Please run in an interactive terminal.")

def disable_password():
    """Handles disabling the password via CLI."""
    if os.path.exists(Config.PASSWORD_FILE):
        os.remove(Config.PASSWORD_FILE)
        print("Password disabled successfully.")
    else:
        print("No password was set.")

def create_database_backup():
    """
    Creates a compressed daily backup of the traffic.db database.
    This replicates the v2.0 backup functionality but backs up traffic.db instead of snapshot.db.
    """
    try:
        import subprocess
        import gzip
        import shutil
        from datetime import datetime
        
        # Ensure our final backup destination exists
        os.makedirs(Config.DB_BACKUPS_DIR, exist_ok=True)
        
        # Define file names and paths
        date_tag = datetime.now().strftime('%F_%H')
        # Backup the local traffic.db file, not the live database
        db_source_path = Config.LOCAL_DB_PATH
        final_backup_path = os.path.join(Config.DB_BACKUPS_DIR, f"TrafficAnalyzer_{date_tag}.db.gz")
        checksum_file = f"{final_backup_path}.sha256"
        
        # Check if local traffic.db exists
        if not os.path.exists(db_source_path):
            print(f"Local traffic.db not found at {db_source_path}. Skipping backup.")
            return
            
        # 1. Copy the traffic.db to a temporary location before compression
        print("Copying the database for backup...")
        temp_db_path = f"/tmp/superman_backup_db_{os.getpid()}"
        shutil.copy2(db_source_path, temp_db_path)
        
        # 2. Compress the database
        print("Compressing the database...")
        with open(temp_db_path, 'rb') as f_in:
            with gzip.open(final_backup_path, 'wb') as f_out:
                shutil.copyfileobj(f_in, f_out)
        
        # 3. Generate a checksum for the compressed archive for integrity verification
        print("Generating SHA256 checksum...")
        result = subprocess.run(['sha256sum', final_backup_path], capture_output=True, text=True)
        if result.returncode == 0:
            checksum = result.stdout.split()[0]
            with open(checksum_file, 'w') as f:
                f.write(checksum)
        
        # 4. Enforce retention policy: delete backups and their checksums older than 60 days
        print("Enforcing 60-day retention policy...")
        subprocess.run(['find', Config.DB_BACKUPS_DIR, '-name', 'TrafficAnalyzer_*.db.gz', '-type', 'f', '-mtime', '+60', '-exec', 'rm', '-f', '{}', ';'], check=True)
        subprocess.run(['find', Config.DB_BACKUPS_DIR, '-name', 'TrafficAnalyzer_*.db.gz.sha256', '-type', 'f', '-mtime', '+60', '-exec', 'rm', '-f', '{}', ';'], check=True)
        
        # 5. Clean up the temporary file
        if os.path.exists(temp_db_path):
            os.remove(temp_db_path)
        
        print("Database backup and cleanup complete.")
    except Exception as e:
        print(f"Error creating database backup: {e}")

def create_manual_backup():
    """
    Creates a compressed archive of the data and db_backups folders.
    """
    try:
        # Ensure the backup directory exists
        os.makedirs(Config.MANUAL_BACKUP_DIR, exist_ok=True)
        
        # Create filename with improved naming scheme
        now = datetime.now()
        timestamp_str = now.strftime('%b-%d-%Y_%Hh-%Mm-%Ss')  # e.g., Aug-08-2025_20h-31m-37s
        backup_file = os.path.join(Config.MANUAL_BACKUP_DIR, f"superman-backup-{timestamp_str}.tar.gz")
        
        # Use subprocess to run tar command
        subprocess.run(['tar', '-czf', backup_file, '-C', Config.BASE_DIR, 'data', 'db_backups'], check=True)
        print(f"Manual backup created successfully: {backup_file}")
    except subprocess.CalledProcessError as e:
        print(f"Error creating manual backup: {e}")
    except Exception as e:
        print(f"An unexpected error occurred during backup: {e}")

def restore_manual_backup(backup_file_path):
    """
    Restores data and db_backups folders from a compressed archive.
    """
    temp_restore_dir = None
    try:
        if not os.path.exists(backup_file_path):
            print(f"Error: Backup file not found at {backup_file_path}")
            return

        # Create a temporary directory for extraction
        temp_restore_dir = os.path.join(Config.BASE_DIR, 'tmp_restore_' + datetime.now().strftime('%Y%m%d%H%M%S'))
        os.makedirs(temp_restore_dir, exist_ok=True)

        # Extract the archive to the temporary directory
        print("Extracting backup...")
        subprocess.run(['tar', '-xzf', backup_file_path, '-C', temp_restore_dir], check=True)

        # --- Migration Step for v2.0 backups ---
        print("Checking for old filename formats to migrate...")
        restored_period_dir = os.path.join(temp_restore_dir, 'data', 'period_data')
        if os.path.exists(restored_period_dir):
            for filename in os.listdir(restored_period_dir):
                if '_' in filename and filename.startswith('traffic_period_'):
                    parts = filename.replace('.json', '').split('_')
                    if len(parts) == 4: # traffic_period_YYYY-MM-DD_YYYY-MM-DD
                        new_filename = f"traffic_period_{parts[2]}-{parts[3]}.json"
                        old_path = os.path.join(restored_period_dir, filename)
                        new_path = os.path.join(restored_period_dir, new_filename)
                        print(f"Migrating old backup file: {filename} -> {new_filename}")
                        os.rename(old_path, new_path)
        
        # --- Migration Step for v2.0 data format ---
        print("Checking for old data format to migrate...")
        restored_daily_dir = os.path.join(temp_restore_dir, 'data', 'daily_json')
        if os.path.exists(restored_daily_dir):
            for filename in os.listdir(restored_daily_dir):
                if filename.endswith('.json'):
                    filepath = os.path.join(restored_daily_dir, filename)
                    try:
                        with open(filepath, 'r') as f:
                            data = json.load(f)
                        
                        # Check if this is an old format file. The definitive check is the lack of a 'stats_bytes' object.
                        is_v2_1_format = 'stats_bytes' in data

                        if not is_v2_1_format:
                            print(f"Converting old format daily file: {filename}")
                            
                            # Get old stats, defaulting to empty if they don't exist
                            old_stats = data.get('stats', {})
                            
                            # Calculate total bytes, defaulting to 0
                            total_day_bytes = int(old_stats.get('traffic', 0) * 1073741824)

                            # --- Rebuild the entire file from scratch to guarantee v2.1 structure ---

                            # 1. Rebuild stats_bytes
                            new_stats_bytes = {
                                'dl_bytes': int(old_stats.get('dl', 0) * 1073741824),
                                'ul_bytes': int(old_stats.get('ul', 0) * 1073741824),
                                'total_bytes': total_day_bytes,
                                'devices_count': old_stats.get('devices', 0)
                            }

                            # 2. Rebuild devices array, preserving the correct byte counts
                            new_devices_list = []
                            for device in data.get('devices', []):
                                # The v2.0 files already have the correct byte counts, just use them directly.
                                dl_b = device.get('dl_bytes', 0)
                                ul_b = device.get('ul_bytes', 0)
                                total_device_bytes = device.get('total_bytes', 0)

                                new_devices_list.append({
                                    'mac': device.get('mac'),
                                    'name': device.get('name'),
                                    'dl_bytes': dl_b,
                                    'ul_bytes': ul_b,
                                    'total_bytes': total_device_bytes,
                                    'percentage': (total_device_bytes / total_day_bytes * 100) if total_day_bytes > 0 else 0,
                                    'topApps': device.get('topApps', [])
                                })
                            data['devices'] = new_devices_list

                            # 3. Rebuild barChart
                            date_str = filename.replace('.json', '')
                            new_bar_chart = {
                                'title': 'Daily Breakdown',
                                'labels': [date_str],
                                'values_bytes': [total_day_bytes]
                            }

                            # 4. Rebuild topApps at root level
                            new_top_apps = data.get('topApps', [])

                            # 5. Assemble the new, clean data object
                            data = {
                                'stats_bytes': new_stats_bytes,
                                'barChart': new_bar_chart,
                                'devices': sorted(new_devices_list, key=lambda x: x['total_bytes'], reverse=True),
                                'topApps': new_top_apps
                            }
                            
                            # Save the completely rebuilt file
                            with open(filepath, 'w') as f:
                                json.dump(data, f, indent=2)
                                
                            print(f"Converted {filename} to lean format")
                    except Exception as e:
                        print(f"Warning: Could not convert {filename}: {e}")
        
        # Convert period data files
        restored_period_dir = os.path.join(temp_restore_dir, 'data', 'period_data')
        if os.path.exists(restored_period_dir):
            for filename in os.listdir(restored_period_dir):
                if filename.endswith('.json'):
                    filepath = os.path.join(restored_period_dir, filename)
                    try:
                        with open(filepath, 'r') as f:
                            data = json.load(f)
                        
                        # Check if this is an old format file (has stats but no stats_bytes)
                        if 'stats' in data and 'stats_bytes' not in data:
                            print(f"Converting old format period file: {filename}")
                            
                            # Convert old format to new lean format
                            old_stats = data.get('stats', {})
                            
                            # Add byte values for stats and remove the old stats section
                            data['stats_bytes'] = {
                                'dl_bytes': int(old_stats.get('dl', 0) * 1073741824),
                                'ul_bytes': int(old_stats.get('ul', 0) * 1073741824),
                                'total_bytes': int(old_stats.get('traffic', 0) * 1073741824),
                                'devices_count': old_stats.get('devices', 0),
                                'monthlyQuotaGB': old_stats.get('monthlyQuotaGB', 500)
                            }
                            
                            # Remove the old stats section
                            del data['stats']
                            
                            # Convert device data if present
                            for device in data.get('devices', []):
                                if 'dl' in device and 'dl_bytes' not in device:
                                    device['dl_bytes'] = int(device['dl'] * 1073741824)
                                    del device['dl']
                                if 'ul' in device and 'ul_bytes' not in device:
                                    device['ul_bytes'] = int(device['ul'] * 1073741824)
                                    del device['ul']
                                if 'total' in device and 'total_bytes' not in device:
                                    device['total_bytes'] = int(device['total'] * 1073741824)
                                    del device['total']
                                # Convert topApps data if present
                                for app in device.get('topApps', []):
                                    if 'total' in app and 'total_bytes' not in app:
                                        app['total_bytes'] = int(app['total'] * 1073741824)
                                        del app['total']
                            
                            # Convert topApps data at root level if present
                            for app in data.get('topApps', []):
                                if 'total' in app and 'total_bytes' not in app:
                                    app['total_bytes'] = int(app['total'] * 1073741824)
                                    del app['total']
                            
                            # Convert barChart values if present
                            if 'barChart' in data and 'values' in data['barChart'] and 'values_bytes' not in data['barChart']:
                                data['barChart']['values_bytes'] = [int(v * 1073741824) for v in data['barChart']['values']]
                                del data['barChart']['values']
                            
                            # Save the converted file
                            with open(filepath, 'w') as f:
                                json.dump(data, f, indent=2)
                                
                            print(f"Converted {filename} to lean format")
                    except Exception as e:
                        print(f"Warning: Could not convert {filename}: {e}")
        
        # Remove current data and db_backups directories
        print("Replacing current data with backup...")
        if os.path.exists(Config.DATA_DIR): subprocess.run(['rm', '-rf', Config.DATA_DIR], check=True)
        if os.path.exists(Config.DB_BACKUPS_DIR): subprocess.run(['rm', '-rf', Config.DB_BACKUPS_DIR], check=True)

        # Move restored contents to BASE_DIR
        subprocess.run(['mv', os.path.join(temp_restore_dir, 'data'), Config.BASE_DIR], check=True)
        if os.path.exists(os.path.join(temp_restore_dir, 'db_backups')):
            subprocess.run(['mv', os.path.join(temp_restore_dir, 'db_backups'), Config.BASE_DIR], check=True)

        # Clean up .sha256 checksum files from daily_json directory
        daily_json_dir = os.path.join(Config.DATA_DIR, 'daily_json')
        if os.path.exists(daily_json_dir):
            for filename in os.listdir(daily_json_dir):
                if filename.endswith('.sha256'):
                    os.remove(os.path.join(daily_json_dir, filename))
            print("Cleaned up .sha256 checksum files from daily_json directory")

        print(f"Manual backup restored successfully from {os.path.basename(backup_file_path)}")
    except subprocess.CalledProcessError as e:
        print(f"Error restoring manual backup: {e}")
    except Exception as e:
        print(f"An unexpected error occurred during restore: {e}")
    finally:
        # Clean up temporary directory
        if temp_restore_dir is not None and os.path.exists(temp_restore_dir):
            subprocess.run(['rm', '-rf', temp_restore_dir], check=True)

def ensure_cron_jobs():
    """Ensure cron jobs are set up for the application."""
    try:
        import subprocess
        import os
        
        # Get the current working directory (where skyhero.py is located)
        app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        superman_py = os.path.join(app_dir, 'skyhero.py')
        
        # Remove existing cron jobs to avoid duplicates
        subprocess.run(['cru', 'd', 'skyhero_monitor'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['cru', 'd', 'skyhero_backup'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        # Set up new cron jobs
        subprocess.run(['cru', 'a', 'skyhero_monitor', '*/5 * * * *', f'/opt/bin/python3 {superman_py} monitor'])
        subprocess.run(['cru', 'a', 'skyhero_backup', '0 3 * * *', f'/opt/bin/python3 {superman_py} backup'])
        
        print("Cron jobs set up successfully")
    except Exception as e:
        print(f"Failed to set up cron jobs: {e}")

def main():
    """Main entry point for CLI commands."""
    if len(sys.argv) > 1:
        command = sys.argv[1]
        # Sync data from router if applicable, but skip for password commands
        if command not in ['set-password', 'disable-password']:
            if os.path.exists(Config.ROUTER_DB_PATH) and Config.LOCAL_DB_PATH != Config.ROUTER_DB_PATH:
                print("Running on router - syncing data from router database to local traffic.db")
                sync_data_from_router()
        if command == 'serve':
            # Ensure cron jobs are set up when server starts
            ensure_cron_jobs()
            app.run(host='0.0.0.0', port=8082)
        elif command == 'rollup':
            day = sys.argv[3] if len(sys.argv) > 3 else 'today'
            if day == 'today':
                create_daily_rollup(datetime.now().strftime('%Y-%m-%d'))
            elif day == 'yesterday':
                create_daily_rollup((datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d'))
            else:
                create_daily_rollup(day)
        elif command == 'monitor':
            # Check database health before running monitor
            if ensure_healthy_database():
                if run_traffic_monitor():
                    print("Monitor run completed successfully.")
                else:
                    print("Monitor run failed.")
                    sys.exit(1)
            else:
                print("Database is not healthy and could not be restored. Monitor run aborted.")
                sys.exit(1)
        elif command == 'check-db':
            print("Checking database health...")
            if ensure_healthy_database():
                print("Database is healthy.")
            else:
                print("Database check failed.")
                sys.exit(1)
        elif command == 'backup':
            # Implement automatic database backup functionality
            create_database_backup()
        elif command == 'set-password':
            set_password()
        elif command == 'disable-password':
            disable_password()
        elif command == 'backup-manual':
            create_manual_backup()
        elif command == 'restore-manual':
            if len(sys.argv) < 3:
                print("Usage: python skyhero.py restore-manual <path_to_backup_file>")
            else:
                restore_manual_backup(sys.argv[2])
        elif command == 'monthly-aggregator':
            create_monthly_reports()
        elif command == 'import-history':
            if import_history_from_router():
                print("Import-history completed successfully.")
            else:
                print("Import-history failed.")
                sys.exit(1)
        else:
            print(f"Unknown command: {command}")
    else:
        print("Usage: python skyhero.py [serve|rollup|monitor|backup|set-password|disable-password|backup-manual|restore-manual|monthly-aggregator|check-db|import-history]")