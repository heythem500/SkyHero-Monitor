#!/usr/bin/env python3
"""
Self-Healing Control Script for Superman-Tacking v2.1
"""

import os
import sys
import glob
import gzip
import sqlite3
import subprocess
from datetime import datetime

# ANSI color codes for emojis to ensure they appear colored
RED = '\033[0;31m'
GREEN = '\033[0;32m'
YELLOW = '\033[0;33m'
CYAN = '\033[0;36m'
NC = '\033[0m'  # No Color/Reset

# Path to the database.py file (adjust if needed)
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if os.path.basename(SCRIPTS_DIR) == 'system':
    # Running from system folder
    DATABASE_PY_PATH = os.path.join(SCRIPTS_DIR, 'database.py')
else:
    # Running from project root
    DATABASE_PY_PATH = os.path.join(SCRIPTS_DIR, 'system', 'database.py')

# Import config to get paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(BASE_DIR)

try:
    from system.config import Config
    from system.database import restore_db_from_backup
    CONFIG = Config()
    LIVE_DB_PATH = CONFIG.LIVE_DB_PATH
    DB_BACKUPS_DIR = CONFIG.DB_BACKUPS_DIR
    LOGS_DIR = CONFIG.LOGS_DIR
except ImportError:
    # Fallback paths if import fails
    LIVE_DB_PATH = "/jffs/.sys/TrafficAnalyzer/TrafficAnalyzer.db"
    DB_BACKUPS_DIR = os.path.join(BASE_DIR, 'db_backups')
    LOGS_DIR = os.path.join(BASE_DIR, 'logs')
    restore_db_from_backup = None

def is_self_healing_enabled():
    """Check if self-healing is currently enabled."""
    if not os.path.exists(DATABASE_PY_PATH):
        return None

    with open(DATABASE_PY_PATH, 'r') as f:
        content = f.read()
        if 'SELF_HEALING_ENABLED = True' in content:
            return True
        elif 'SELF_HEALING_ENABLED = False' in content:
            return False
        else:
            return None

def is_auto_backup_enabled():
    """Check if auto backup cron job is currently enabled."""
    try:
        result = subprocess.run(['cru', 'l'], capture_output=True, text=True, check=True)
        return 'skyhero_backup' in result.stdout
    except FileNotFoundError:
        print("⚠️  cru command not available (this is normal on development systems)")
        return False  # Assume disabled for development
    except Exception as e:
        print(f"Error checking cron status: {e}")
        return False

def set_self_healing_state(enabled):
    """Enable or disable self-healing by modifying the flag."""
    if not os.path.exists(DATABASE_PY_PATH):
        print("Error: database.py not found")
        return False
        
    try:
        with open(DATABASE_PY_PATH, 'r') as f:
            lines = f.readlines()
        
        modified = False
        for i, line in enumerate(lines):
            if 'SELF_HEALING_ENABLED = ' in line and not line.strip().startswith('#'):
                if enabled:
                    lines[i] = 'SELF_HEALING_ENABLED = True\n'
                else:
                    lines[i] = 'SELF_HEALING_ENABLED = False\n'
                modified = True
                break
        
        if not modified:
            print("Error: Could not find SELF_HEALING_ENABLED flag")
            return False
        
        with open(DATABASE_PY_PATH, 'w') as f:
            f.writelines(lines)
        
        if enabled:
            print(f"{GREEN}✅{NC} Self-healing feature ENABLED")
        else:
            print(f"{RED}🚫{NC} Self-healing feature DISABLED")
        return True
        
    except Exception as e:
        print(f"Error: {e}")
        return False

def show_status():
    """Show current status."""
    status = is_self_healing_enabled()
    if status is True:
        print(f"{GREEN}✅{NC} Self-healing is currently ENABLED")
    elif status is False:
        print(f"{RED}🚫{NC} Self-healing is currently DISABLED")
    else:
        print(f"{YELLOW}❓{NC} Unable to determine status")

def format_bytes(bytes_value):
    """Format bytes into human readable format."""
    if bytes_value >= 1073741824:  # >= 1GB
        return f"{bytes_value / 1073741824:.1f} GB"
    elif bytes_value >= 1048576:  # >= 1MB
        return f"{bytes_value / 1048576:.1f} MB"
    elif bytes_value >= 1024:  # >= 1KB
        return f"{bytes_value / 1024:.1f} KB"
    else:
        return f"{bytes_value} B"

def check_db_integrity(db_path):
    """Check database integrity using PRAGMA quick_check."""
    try:
        if not os.path.exists(db_path):
            return False, "MISSING"
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("PRAGMA quick_check;")
        result = cursor.fetchone()
        conn.close()
        
        if result and result[0] == "ok":
            return True, "Healthy"
        else:
            return False, "CORRUPTED"
    except sqlite3.DatabaseError:
        return False, "CORRUPTED"
    except Exception:
        return False, "UNKNOWN"

def get_db_date_range(db_path):
    """Get the date range of data in the database."""
    try:
        if not os.path.exists(db_path):
            return "N/A"
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT MIN(timestamp), MAX(timestamp) FROM traffic")
        result = cursor.fetchone()
        conn.close()
        
        if result and result[0] and result[1]:
            min_date = datetime.fromtimestamp(result[0]).strftime('%Y-%m-%d')
            max_date = datetime.fromtimestamp(result[1]).strftime('%Y-%m-%d')
            return f"{min_date} to {max_date}" if min_date != max_date else min_date
        else:
            return "Empty/Unknown"
    except Exception:
        return "Unknown"

def check_live_db_vs_backups():
    """Check live database status vs available backups."""
    # Check live DB status
    print("\n--- Live Database Status ---")
    print(f"Source: {LIVE_DB_PATH}")
    is_healthy, status_text = check_db_integrity(LIVE_DB_PATH)
    
    if os.path.exists(LIVE_DB_PATH):
        live_size = os.path.getsize(LIVE_DB_PATH)
        live_size_formatted = format_bytes(live_size)
        date_range = get_db_date_range(LIVE_DB_PATH)
        
        if is_healthy:
            status_symbol = f"{GREEN}🟢{NC}"
        else:
            status_symbol = f"{RED}🔴{NC}"
        print(f"Status: {status_symbol} {status_text}")
        print(f"Size: {live_size_formatted}")
        print(f"Data Range: {date_range}")
    else:
        print(f"Status: {RED}🔴{NC} MISSING")
        print("Size: N/A")
        print("Data Range: N/A")
    
    # List available backups
    print("\n--- Available Backups ---")
    if not os.path.exists(DB_BACKUPS_DIR):
        print("No backup directory found.")
        return

    # Find both compressed and uncompressed backups
    backup_files = glob.glob(os.path.join(DB_BACKUPS_DIR, "TrafficAnalyzer_*.db.gz"))
    backup_files.extend(glob.glob(os.path.join(DB_BACKUPS_DIR, "TrafficAnalyzer_*.db")))

    # Also include traffic.db as a potential restore source (only if different from live DB)
    traffic_db_path = os.path.join(BASE_DIR, 'traffic.db')
    if os.path.exists(traffic_db_path) and traffic_db_path != LIVE_DB_PATH:
        backup_files.append(traffic_db_path)

    if not backup_files:
        print("No backup files found.")
        return

    # Sort by modification time (newest first)
    backup_files.sort(key=os.path.getmtime, reverse=True)

    # Store backup info for potential selection
    backup_info = []

    # Show top 10 backups
    for i, backup_path in enumerate(backup_files[:10], 1):
        filename = os.path.basename(backup_path)
        file_size = os.path.getsize(backup_path)
        file_size_formatted = format_bytes(file_size)

        is_compressed = filename.endswith('.db.gz')

        # Special handling for traffic.db
        is_traffic_db = filename == 'traffic.db'

        if is_compressed:
            # Try to get uncompressed size
            uncompressed_size = 0
            try:
                with gzip.open(backup_path, 'rb') as f:
                    uncompressed_data = f.read()
                    uncompressed_size = len(uncompressed_data)
                    uncompressed_size_formatted = format_bytes(uncompressed_size)
            except Exception:
                uncompressed_size_formatted = "Unknown"

            # Try to get date range from backup
            backup_date_range = "Unknown"
            try:
                with gzip.open(backup_path, 'rb') as f:
                    with open("/tmp/temp_db_check", "wb") as temp_f:
                        temp_f.write(f.read())
                    backup_date_range = get_db_date_range("/tmp/temp_db_check")
                    os.remove("/tmp/temp_db_check")
            except Exception:
                # Try to extract date from filename
                try:
                    date_part = filename.split('_')[1]  # Extract date part
                    backup_date_range = date_part
                except Exception:
                    pass

            # Calculate compression ratio
            if uncompressed_size > 0:
                compression_ratio = (1 - file_size / uncompressed_size) * 100
                size_info = f"{file_size_formatted} → {uncompressed_size_formatted} ({compression_ratio:.0f}% compression)"
            else:
                size_info = f"{file_size_formatted} → {uncompressed_size_formatted}"
        else:
            # Uncompressed file
            if is_traffic_db:
                size_info = f"{file_size_formatted} (project database)"
            else:
                size_info = f"{file_size_formatted} (uncompressed)"
            backup_date_range = get_db_date_range(backup_path)

        status_symbol = f"{GREEN}🟢{NC}"
        if is_traffic_db:
            print(f"{i}) {filename}  {status_symbol} {size_info}")
            print(f"   Data: {backup_date_range} (current project DB)")
        else:
            print(f"{i}) {filename}  {status_symbol} {size_info}")
            print(f"   Data: {backup_date_range}")
        print()

        # Store info for selection
        backup_info.append({
            'path': backup_path,
            'filename': filename,
            'is_compressed': is_compressed,
            'is_traffic_db': is_traffic_db
        })

    return backup_info


def get_last_entry_timestamp(db_path):
    """Get the last entry timestamp from the database."""
    try:
        if not os.path.exists(db_path):
            return None, "N/A"
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT MAX(timestamp) FROM traffic")
        result = cursor.fetchone()
        conn.close()
        
        if result and result[0]:
            return result[0], datetime.fromtimestamp(result[0]).strftime('%Y-%m-%d %H:%M:%S')
        else:
            return None, "Empty"
    except Exception:
        return None, "Error"


def get_last_entry_age(timestamp_raw):
    """Calculate human-readable age from a Unix timestamp."""
    if not timestamp_raw or timestamp_raw == "N/A" or timestamp_raw == "NULL":
        return "N/A"
    
    try:
        # Get current time (seconds since epoch)
        now = int(datetime.now().timestamp())
        
        # Calculate difference in seconds
        diff = now - int(timestamp_raw)
        
        # Handle future timestamps (shouldn't happen, but be safe)
        if diff < 0:
            return "In the future?"
        
        # Calculate human-readable difference with better precision
        if diff < 60:
            return f"{diff} seconds ago"
        elif diff < 3600:  # 60 minutes
            mins = diff // 60
            secs = diff % 60
            # Round to nearest minute
            if secs > 30:
                mins += 1
            # Don't show 0 minutes
            if mins == 0:
                return "Just now"
            else:
                return f"{mins} minute{'s' if mins > 1 else ''} ago"
        elif diff < 86400:  # 24 hours
            hours = diff // 3600
            mins = (diff % 3600) // 60
            # For better precision, show hours and minutes when mins > 0
            if mins > 0:
                return f"{hours} hour{'s' if hours > 1 else ''} and {mins} minute{'s' if mins > 1 else ''} ago"
            else:
                return f"{hours} hour{'s' if hours > 1 else ''} ago"
        else:
            # For periods longer than a day, show days and hours
            days = diff // 86400
            hours = (diff % 86400) // 3600
            # Show days and hours for better precision
            if hours > 0:
                return f"{days} day{'s' if days > 1 else ''} and {hours} hour{'s' if hours > 1 else ''} ago"
            else:
                return f"{days} day{'s' if days > 1 else ''} ago"
    except Exception:
        return "Error"

def quick_health_check():
    """Perform a quick health check comparing live DB and project DB."""
    PROJECT_DB_PATH = os.path.join(BASE_DIR, 'traffic.db')
    
    print("\n--- Check Live DB vs Project DB ---")
    
    # Get live DB info
    live_exists = os.path.exists(LIVE_DB_PATH)
    live_healthy, live_status = check_db_integrity(LIVE_DB_PATH) if live_exists else (False, "MISSING")
    live_size = format_bytes(os.path.getsize(LIVE_DB_PATH)) if live_exists else "N/A"
    live_date_range = get_db_date_range(LIVE_DB_PATH) if live_exists else "N/A"
    live_timestamp_raw, live_timestamp_readable = get_last_entry_timestamp(LIVE_DB_PATH) if live_exists else (None, "N/A")
    live_age = get_last_entry_age(live_timestamp_raw) if live_exists else "N/A"
    
    # Get project DB info
    project_exists = os.path.exists(PROJECT_DB_PATH)
    project_healthy, project_status = check_db_integrity(PROJECT_DB_PATH) if project_exists else (False, "MISSING")
    project_size = format_bytes(os.path.getsize(PROJECT_DB_PATH)) if project_exists else "N/A"
    project_date_range = get_db_date_range(PROJECT_DB_PATH) if project_exists else "N/A"
    project_timestamp_raw, project_timestamp_readable = get_last_entry_timestamp(PROJECT_DB_PATH) if project_exists else (None, "N/A")
    project_age = get_last_entry_age(project_timestamp_raw) if project_exists else "N/A"
    
    # Calculate time differences
    time_diff = 0
    if live_timestamp_raw and project_timestamp_raw:
        time_diff = abs(int(live_timestamp_raw) - int(project_timestamp_raw))
        minutes_diff = time_diff // 60
        if minutes_diff < 1:
            time_diff_str = "Less than a minute"
        else:
            time_diff_str = f"{minutes_diff} minutes"
    else:
        time_diff_str = "N/A"
    
    # Format status for display
    def format_status(healthy, status, exists):
        if not exists:
            return "MISSING"
        elif not healthy:
            return "CORRUPT"
        else:
            return "OK"
    
    live_status_display = format_status(live_healthy, live_status, live_exists)
    project_status_display = format_status(project_healthy, project_status, project_exists)
    
    # Print table
    print(f"\nLive DB Path:      {LIVE_DB_PATH}")
    print(f"Project DB Path:   {PROJECT_DB_PATH}")
    
    print()
    # Table with proper alignment matching the shell script format
    print("Feature               | Live Database            | Project Database")
    print("----------------------|--------------------------|-------------------------")
    print(f"{'Status':<21} | {live_status_display:<24} | {project_status_display:<24}")
    print(f"{'Size':<21} | {live_size:<24} | {project_size:<24}")
    print(f"{'Data Range':<21} | {live_date_range:<24} | {project_date_range:<24}")
    print(f"{'Last Entry (Raw)':<21} | {str(live_timestamp_raw) if live_timestamp_raw else 'N/A':<24} | {str(project_timestamp_raw) if project_timestamp_raw else 'N/A':<24}")
    print(f"{'Last Entry (Readable)':<21} | {live_timestamp_readable:<24} | {project_timestamp_readable:<24}")
    print(f"{'Last Entry Age':<21} | {live_age:<24} | {project_age:<24}")
    print("----------------------|--------------------------|-------------------------")
    
    # Diagnosis
    diagnosis = "Check Manually"
    if not live_exists:
        diagnosis = "❌ Live DB Issue"
    elif not project_exists:
        diagnosis = "❌ Project DB Issue"
    elif not live_healthy:
        diagnosis = "❌ Live DB Corrupted"
    elif not project_healthy:
        diagnosis = "❌ Project DB Corrupted"
    elif live_timestamp_raw is None or project_timestamp_raw is None:
        diagnosis = "⚠️ Timestamp N/A"
    elif time_diff <= 30:
        diagnosis = f"{GREEN}✅{NC} Looks Healthy"
    elif time_diff <= 600:  # 10 minutes
        diagnosis = "⚠️ Slight Lag"
    else:
        diagnosis = "❌ Project DB Stale"
    
    print(f"Diagnosis: {diagnosis}")
    if time_diff_str != "N/A":
        print(f"Time Difference: {time_diff_str}")
    
    # Get router time
    router_time = subprocess.check_output(['date'], stderr=subprocess.STDOUT).decode().strip()
    print(f"Router Time: {YELLOW}{router_time}{NC}")

def toggle_auto_backup():
    """Toggle auto live DB backup on/off."""
    try:
        # Check if cru is available
        subprocess.run(['cru', '--help'], capture_output=True, check=True)
    except FileNotFoundError:
        print("❌ cru command not available - this feature requires router environment")
        input("\nPress Enter to return to menu...")
        return
    except Exception:
        pass  # cru is available

    try:
        # Check if cron job exists
        result = subprocess.run(['cru', 'l'], capture_output=True, text=True, check=True)
        exists = 'skyhero_backup' in result.stdout

        if exists:
            # Disable backup
            subprocess.run(['cru', 'd', 'skyhero_backup'], check=True)
            print(f"✅ Auto backup {RED}DISABLED{NC}")
        else:
            # Enable backup
            subprocess.run(['cru', 'a', 'skyhero_backup', f'0 3 * * * /opt/bin/python3 {BASE_DIR}/skyhero.py backup'], check=True)
            print(f"✅ Auto backup {GREEN}ENABLED{NC}")
    except subprocess.CalledProcessError as e:
        print(f"❌ Error executing cru command: {e}")
    except Exception as e:
        print(f"❌ Error toggling auto backup: {e}")

    input("\nPress Enter to return to menu...")

def show_smart_menu():
    """Show interactive menu with smart options based on current status."""
    status = is_self_healing_enabled()
    backup_status = is_auto_backup_enabled()

    print("Self-Healing Control for Superman-Tacking v2.1")
    print("=" * 50)
    show_status()
    print("\nOptions:")

    if status is True:
        print("1) Disable self-healing")  # Show opposite action
        print("2) Show status")
        if backup_status:
            print(f"3) Auto backup: {GREEN}ENABLED{NC}")
        else:
            print(f"3) Auto backup: {RED}DISABLED{NC}")
        print("4) Check Live DB vs Backups")  # Info only (no restore)
        print("5) Check Live DB vs Project DB")  # New option
        print("6) Exit")
    else:
        print("1) Enable self-healing")   # Show opposite action
        print("2) Show status")
        if backup_status:
            print(f"3) Auto backup: {GREEN}ENABLED{NC}")
        else:
            print(f"3) Auto backup: {RED}DISABLED{NC}")
        print("4) Check Live DB vs Backups")  # Info + restore capability
        print("5) Check Live DB vs Project DB")  # New option
        print("6) Exit")

    print("\nEnter your choice (1-6): ", end='')

def main():
    # If arguments provided, use command line mode
    if len(sys.argv) > 1:
        action = sys.argv[1].lower()
        if action == 'enable':
            set_self_healing_state(True)
        elif action == 'disable':
            set_self_healing_state(False)
        elif action == 'status':
            show_status()
        else:
            print("Usage: self-healing-control [enable|disable|status]")
        return
    
    # Interactive mode
    while True:
        show_smart_menu()
        try:
            choice = input().strip()
            status = is_self_healing_enabled()
            
            if choice == '1':
                # Toggle self-healing state
                if status is True:
                    set_self_healing_state(False)
                else:
                    set_self_healing_state(True)
            elif choice == '2':
                show_status()
            elif choice == '3':
                toggle_auto_backup()
                input("\nPress Enter to return to menu...")
            elif choice == '4':
                backup_info = check_live_db_vs_backups()
                # Show appropriate note based on self-healing status
                if status is True:
                    print("ℹ️  Note: Self-healing is ENABLED - system will automatically restore if needed")
                else:
                    print("⚠️  Note: Self-healing is DISABLED - manual restore capability available below")
                    if backup_info and restore_db_from_backup:
                        try:
                            selection = input("Enter backup number to restore (1-10), or 'q' to cancel: ").strip()
                            if selection.lower() == 'q':
                                print("Restore cancelled.")
                            elif selection.isdigit():
                                idx = int(selection) - 1
                                if 0 <= idx < len(backup_info):
                                    selected_backup = backup_info[idx]
                                    print(f"\nSelected: {selected_backup['filename']}")
                                    confirm = input("WARNING: This will overwrite the router's live database! Type 'yes' to confirm: ").strip()
                                    if confirm.lower() == 'yes':
                                        print("Starting restore...")
                                        if restore_db_from_backup(selected_backup['path']):
                                            print("✅ Restore completed successfully!")
                                        else:
                                            print("❌ Restore failed!")
                                    else:
                                        print("Restore cancelled.")
                                else:
                                    print("❌ Invalid selection.")
                            else:
                                print("❌ Invalid input.")
                        except (EOFError, KeyboardInterrupt):
                            print("\nRestore cancelled.")
                    else:
                        print("❌ Restore function not available.")
                input("Press [Enter] to return to menu...")
            elif choice == '5':
                quick_health_check()
                input("Press [Enter] to return to menu...")
            elif choice == '6':
                print("Goodbye!")
                break
            else:
                if choice:  # Only show error if there was actual input
                    print("Invalid choice. Please enter 1-6.")
                else:
                    # For empty input, treat as exit request
                    print("Returning to main menu...")
                    break
        except KeyboardInterrupt:
            print("\n\nGoodbye!")
            break
        except EOFError:
            print("\n\nGoodbye!")
            break
        
        # Only pause in interactive mode and only if we didn't break out of the loop
        if choice != '6':  # Don't pause after exit
            if choice != '3' and choice != '4' and choice != '5':  # Don't pause after backup check, health check, or toggle since they have their own pause
                try:
                    input("\nPress Enter to continue...")
                except EOFError:
                    pass  # Handle pipe/redirect cases gracefully

if __name__ == '__main__':
    main()