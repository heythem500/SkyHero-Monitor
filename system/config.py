import os

# =============================================================================
# Section 1: Configuration
# =============================================================================

def detect_usb_backup_dir():
    """Auto-detect USB mount point with Superman-Tacking project and set backup directory."""
    # Common mount point patterns to check
    mount_patterns = [
        '/tmp/mnt',
        '/mnt',
        '/media'
    ]
    
    # Project identifiers to look for
    project_identifiers = [
        'skyhero.py',
        'system',
        'www'
    ]
    
    # Check common mount points
    for mount_base in mount_patterns:
        if os.path.exists(mount_base):
            try:
                # List directories in mount point
                for item in os.listdir(mount_base):
                    usb_path = os.path.join(mount_base, item)
                    if os.path.isdir(usb_path):
                        # Check if this directory contains our project
                        has_project = True
                        for identifier in project_identifiers:
                            if not os.path.exists(os.path.join(usb_path, identifier)):
                                has_project = False
                                break
                        
                        # If we found our project, set the backup directory
                        if has_project:
                            return os.path.join(usb_path, 'superman-backups')
            except (OSError, PermissionError):
                # Skip directories we can't read
                continue
    
    # Fallback to default if no USB with project found
    return '/tmp/mnt/ym/superman-backups'

class Config:
    """
    Central configuration class. All paths and settings are defined here.
    This replaces the need for config.sh.
    """
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # Go up one level from system/
    DATA_DIR = os.path.join(BASE_DIR, 'data')
    DAILY_DIR = os.path.join(DATA_DIR, 'daily_json')
    PERIOD_DIR = os.path.join(DATA_DIR, 'period_data')
    DB_BACKUPS_DIR = os.path.join(BASE_DIR, 'db_backups')
    MANUAL_BACKUP_DIR = detect_usb_backup_dir()  # Auto-detect USB backup directory
    LOGS_DIR = os.path.join(BASE_DIR, 'logs')
    WWW_DIR = os.path.join(BASE_DIR, 'www')
    
    # Router database path (always the same on routers)
    ROUTER_DB_PATH = "/jffs/.sys/TrafficAnalyzer/TrafficAnalyzer.db"
    
    # Local traffic database path (always local file)
    LOCAL_DB_PATH = os.path.join(BASE_DIR, 'traffic.db')
    
    # Sync configuration
    SYNC_WINDOW_HOURS = 48
    
    # Smart database path detection - use router DB if available, otherwise local traffic.db for development
    if os.path.exists(ROUTER_DB_PATH):
        LIVE_DB_PATH = ROUTER_DB_PATH
    else:
        LIVE_DB_PATH = LOCAL_DB_PATH
        
    PASSWORD_FILE = os.path.join(DATA_DIR, '.password')

    # Quota configuration - flexible period-based quotas
    DAILY_QUOTA_GB = 50      # Daily usage limit (single day tracking)
    WEEKLY_QUOTA_GB = 200    # Weekly usage limit (short-term tracking)
    MONTHLY_QUOTA_GB = 500   # Monthly usage limit (long-term tracking)
    
    # Device high usage alert threshold for single-day views
    DEVICE_HIGH_USAGE_ALERT_GB = 5  # Single-day usage threshold for device alerts

    @staticmethod
    def ensure_dirs():
        """Ensures all necessary directories exist."""
        for path in [Config.DATA_DIR, Config.DAILY_DIR, Config.PERIOD_DIR, Config.DB_BACKUPS_DIR, Config.LOGS_DIR]:
            os.makedirs(path, exist_ok=True)
        # Note: MANUAL_BACKUP_DIR is created on-demand during backup creation