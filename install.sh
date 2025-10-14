#!/bin/ash
set -eu

# Ensure Entware paths are in the script's PATH
export PATH=/opt/bin:/opt/sbin:$PATH

# --- Color Definitions ---
C_GREEN='\033[0;32m'
C_RED='\033[0;31m'
C_YELLOW='\033[0;33m'
C_CYAN='\033[0;36m'
C_RESET='\033[0m'

# --- Script Setup ---
SOURCE="${0}"
while [ -h "${SOURCE}" ]; do
    DIR="$( cd -P "$( dirname "${SOURCE}" )" && pwd )"
    SOURCE="$(readlink "${SOURCE}")"
    [ "${SOURCE}" != /* ] && SOURCE="${DIR}/${SOURCE}"
done
SCRIPT_DIR="$( cd -P "$( dirname "${SOURCE}" )" && pwd )"

BASE_DIR="$SCRIPT_DIR"
PYTHON_APP_PATH="$BASE_DIR/skyhero.py"
PYTHON_CMD="/opt/bin/python3"

echo -e "${C_CYAN}--- Superman & skyHero Monitor v2.1 Installer ---${C_RESET}"

# 1. Dependency Check
echo "Checking dependencies..."
if [ ! -x "/opt/bin/python3" ]; then
    echo -e "${C_YELLOW}Python3 not found. Attempting to install with opkg...${C_RESET}"
    opkg update
    opkg install python3 python3-pip
    hash -r # Re-hash the PATH to find the new command
    if [ ! -x "/opt/bin/python3" ]; then
        echo -e "${C_RED}Failed to install Python3. Please install it manually and re-run.${C_RESET}"
        exit 1
    fi
fi

if ! python3 -c "import flask" >/dev/null 2>&1; then
    echo -e "${C_YELLOW}Flask not found. Attempting to install with pip3...${C_RESET}"
    pip3 install Flask
    hash -r # Re-hash the PATH to find the new command
    if ! python3 -c "import flask" >/dev/null 2>&1; then
        echo -e "${C_RED}Failed to install Flask. Please install it manually and re-run.${C_RESET}"
        exit 1
    fi
fi
echo -e "${C_GREEN}Dependencies are satisfied.${C_RESET}"

# 2. Stop existing services
echo "Stopping existing SkyHero v2.1 services (if any)..."
kill $(ps | grep 'skyhero.py serve' | grep -v grep | awk '{print $1}') 2>/dev/null || true

echo "Ensuring port 8082 is free..."
if command -v fuser >/dev/null 2>&1; then
    fuser -k 8082/tcp 2>/dev/null || true
else
    # Fallback for systems without fuser
    # Kill processes that might be using the port
    ps | grep 'skyhero.py' | grep 'serve' | grep -v grep | awk '{print $1}' | xargs kill 2>/dev/null || true
fi
sleep 1 # Give the port a moment to be released

# 3. Set up Cron Jobs
echo "Setting up cron jobs..."
cru d skyhero_monitor 2>/dev/null
cru d skyhero_backup 2>/dev/null
cru a skyhero_monitor "*/5 * * * *" "python3 $PYTHON_APP_PATH monitor"
cru a skyhero_backup "0 3 * * *" "python3 $PYTHON_APP_PATH backup"
echo -e "${C_GREEN}Cron jobs set up successfully.${C_RESET}"

# 4. Run initial data generation
echo "Running initial data generation..."
python3 "$PYTHON_APP_PATH" monitor

# 5. Import all historical data on first installation
echo "Checking for historical data import..."
if [ -f "$BASE_DIR/traffic.db" ]; then
    # Check if we have router database available for comparison
    if [ -f "/jffs/.sys/TrafficAnalyzer/TrafficAnalyzer.db" ]; then
        # Get date range from local database
        LOCAL_EARLIEST=$(sqlite3 "$BASE_DIR/traffic.db" "SELECT MIN(timestamp) FROM traffic;" 2>/dev/null || echo "")
        LOCAL_LATEST=$(sqlite3 "$BASE_DIR/traffic.db" "SELECT MAX(timestamp) FROM traffic;" 2>/dev/null || echo "")
        
        # Get date range from router database
        ROUTER_EARLIEST=$(sqlite3 "/jffs/.sys/TrafficAnalyzer/TrafficAnalyzer.db" "SELECT MIN(timestamp) FROM traffic;" 2>/dev/null || echo "")
        ROUTER_LATEST=$(sqlite3 "/jffs/.sys/TrafficAnalyzer/TrafficAnalyzer.db" "SELECT MAX(timestamp) FROM traffic;" 2>/dev/null || echo "")
        
        # Check if router has significantly more historical data
        if [ -n "$ROUTER_EARLIEST" ] && ([ -z "$LOCAL_EARLIEST" ] || [ "$ROUTER_EARLIEST" -lt "$LOCAL_EARLIEST" ]); then
            echo "Router database contains older data not present in local database."
            echo "Importing all historical traffic data (this may take several minutes)..."
            python3 "$PYTHON_APP_PATH" import-history
            
            if [ $? -eq 0 ]; then
                echo "Historical data import completed successfully."
            else
                echo "WARNING: Historical data import failed. You can run it manually later with 'python skyhero.py import-history'"
            fi
        elif [ -z "$LOCAL_EARLIEST" ]; then
            echo "Local database is empty. Importing all historical traffic data (this may take several minutes)..."
            python3 "$PYTHON_APP_PATH" import-history
            
            if [ $? -eq 0 ]; then
                echo "Historical data import completed successfully."
            else
                echo "WARNING: Historical data import failed. You can run it manually later with 'python skyhero.py import-history'"
            fi
        else
            echo "Local database contains all available historical data. Skipping import."
        fi
    else
        echo "Router database not found at /jffs/.sys/TrafficAnalyzer/TrafficAnalyzer.db. Skipping historical import check."
    fi
else
    echo "Database file not found. This may indicate an installation issue."
fi

# 6. Run initial monthly report generation
echo "Generating initial monthly reports..."
python3 "$PYTHON_APP_PATH" monthly-aggregator

# 6. Start the Python web server as a background service
echo "Starting the SkyHero v2.1 web server..."
nohup python3 "$PYTHON_APP_PATH" serve > "$BASE_DIR/logs/server.log" 2>&1 &
sleep 2

if ps | grep 'skyhero.py serve' | grep -v grep > /dev/null; then
    echo -e "${C_GREEN}Server started successfully.${C_RESET}"
else
    echo -e "${C_RED}Failed to start the server. Check logs/server.log for details.${C_RESET}"
    exit 1
fi

# 6. Configure for Boot-time Startup
echo "Configuring for boot-time startup..."
STARTUP_SCRIPT="/jffs/scripts/services-start" # Common ASUSWRT-Merlin startup script

# Check if the startup script exists, if not, create it with a shebang and make it executable
if [ ! -f "$STARTUP_SCRIPT" ]; then
    echo "#!/bin/ash" > "$STARTUP_SCRIPT"
    chmod +x "$STARTUP_SCRIPT"
fi

# Create a simple startup script that starts the web server
cat > "$STARTUP_SCRIPT" << EOF
#!/bin/ash
# Simple services-start script for Superman-Trackingf

# Start the web server using the dynamically found path
/opt/bin/python3 $BASE_DIR/skyhero.py serve > $BASE_DIR/logs/server.log 2>&1 &
EOF

chmod +x "$STARTUP_SCRIPT"
echo -e "${C_GREEN}Updated $STARTUP_SCRIPT with simple startup approach.${C_RESET}"

# 7. Set up auto-start mechanism for USB mount events
echo "Setting up auto-start mechanism for USB mount events..."

# Create a completely new post-mount script to avoid any conflicts
POST_MOUNT_SCRIPT="/jffs/scripts/post-mount"

# Create temporary file with clean content
TEMP_FILE="${POST_MOUNT_SCRIPT}.tmp"

# Write the header
cat > "$TEMP_FILE" << 'EOF'
#!/bin/sh
. /jffs/addons/amtm/mount-entware.mod # Added by amtm

# Superman-Tracking auto-start
MOUNT_PATH="$1"

# Function to find Superman-Tracking installation
find_superman_installation() {
    local search_path="$1"
    
    # Check if skyhero.py and system directory are directly in this path
    if [ -f "$search_path/skyhero.py" ] && [ -d "$search_path/system" ]; then
        echo "$search_path"
        return 0
    fi
    
    # Check common subdirectories where Superman-Tracking might be located
    for subdir in "$search_path"/*; do
        if [ -d "$subdir" ] && [ -f "$subdir/skyhero.py" ] && [ -d "$subdir/system" ]; then
            echo "$subdir"
            return 0
        fi
    done
    
    # Check one level deeper (for nested directories)
    for subdir in "$search_path"/*; do
        if [ -d "$subdir" ]; then
            for subsubdir in "$subdir"/*; do
                if [ -d "$subsubdir" ] && [ -f "$subsubdir/skyhero.py" ] && [ -d "$subsubdir/system" ]; then
                    echo "$subsubdir"
                    return 0
                fi
            done
        fi
    done
    
    return 1
}

# Try to find Superman-Tracking installation
if APP_PATH=$(find_superman_installation "$MOUNT_PATH"); then
    echo "Found Superman-Tracking installation at $APP_PATH"
    ln -sfn "$APP_PATH" /opt/superman-v2
    # Only start our specific service, not all services via rc.unslung
    if [ -f "/opt/etc/init.d/S99superman-v2" ]; then
        /opt/etc/init.d/S99superman-v2 restart
    fi
else
    echo "Superman-Tracking installation not found in $MOUNT_PATH"
fi
EOF

# Replace the old post-mount script with our clean version
mv "$TEMP_FILE" "$POST_MOUNT_SCRIPT"
chmod 755 "$POST_MOUNT_SCRIPT"
echo -e "${C_GREEN}Created clean post-mount script with enhanced auto-start logic.${C_RESET}"

# 8. Create Entware service script
echo "Creating Entware service script..."
SERVICE_SCRIPT="/opt/etc/init.d/S99superman-v2"
mkdir -p "/opt/etc/init.d"

# Create the service script
cat > "$SERVICE_SCRIPT" << 'EOF'
#!/bin/sh
# Superman-Tracking service script

# Determine the actual location of the application
if [ -L "/opt/superman-v2" ]; then
    BASE_DIR=$(readlink -f /opt/superman-v2)
else
    # Fallback to default location
    BASE_DIR="/opt/superman-v2"
fi

PYTHON_APP_PATH="$BASE_DIR/skyhero.py"
PYTHON_CMD="/opt/bin/python3"

start() {
    printf "Starting Superman-Tracking... "
    if [ -f "$PYTHON_APP_PATH" ]; then
        # Ensure logs directory exists
        mkdir -p "$BASE_DIR/logs"
        
        # Start the server
        nohup /opt/bin/python3 "$PYTHON_APP_PATH" serve > "$BASE_DIR/logs/server.log" 2>&1 &
        
        # Wait a moment and check if it started
        sleep 2
        if ps | grep 'skyhero.py serve' | grep -v grep > /dev/null; then
            echo "OK"
        else
            echo "FAILED (Server did not start)"
        fi
    else
        echo "FAILED (Application not found at $PYTHON_APP_PATH)"
    fi
}

stop() {
    printf "Stopping Superman-Tracking... "
    kill $(ps | grep 'skyhero.py serve' | grep -v grep | awk '{print $1}') 2>/dev/null || true
    sleep 2
    echo "OK"
}

restart() {
    stop
    start
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    *)
        echo "Usage: $0 {start|stop|restart}"
        exit 1
        ;;
esac
EOF

chmod +x "$SERVICE_SCRIPT"
echo -e "${C_GREEN}Created Entware service script at $SERVICE_SCRIPT.${C_RESET}"

# 9. Set up initial cron jobs using cru commands
echo "Setting up initial cron jobs..."

# Remove any existing cron jobs to avoid duplicates
cru d skyhero_monitor 2>/dev/null
cru d skyhero_backup 2>/dev/null

# Set up cron jobs using cru commands (application will maintain these after startup)
cru a skyhero_monitor "*/5 * * * *" "$PYTHON_CMD $PYTHON_APP_PATH monitor"
cru a skyhero_backup "0 3 * * *" "$PYTHON_CMD $PYTHON_APP_PATH backup"

echo -e "${C_GREEN}✅ Cron jobs successfully configured! System will maintain these automatically.${C_RESET}"

# 7. Set executable permissions and create symlink for easy access
echo "Setting executable permissions..."
chmod +x "$PYTHON_APP_PATH" 2>/dev/null || echo -e "${C_YELLOW}Could not set executable permission on skyhero.py${C_RESET}"
chmod +x "$BASE_DIR/menu.sh" 2>/dev/null || echo -e "${C_YELLOW}Could not set executable permission on menu.sh${C_RESET}"

# Create a smart symlink - use 'superman' if available, otherwise 'superman2'
echo "Creating command symlink..."
if [ -w "/opt/bin" ]; then
    # Check if /opt/bin/superman exists and points to a valid v2.0 installation
    if [ -L "/opt/bin/superman" ] && [ -f "/tmp/mnt/ym/superman-v2/scripts/menu.sh" ]; then
        # v2.0 is installed, use skyhero2 for v2.1
        SYMLINK_PATH="/opt/bin/skyhero2"
        SYMLINK_NAME="skyhero2"
        echo "v2.0 installation detected. Creating symlink as 'skyhero2' to avoid conflict."
    else
        # Either no v2.0 or v2.0 is not properly installed, use skyhero
        SYMLINK_PATH="/opt/bin/skyhero"
        SYMLINK_NAME="skyhero"
        echo "Creating symlink as 'skyhero'."
    fi
    
    ln -sf "$BASE_DIR/menu.sh" "$SYMLINK_PATH"
    echo -e "${C_GREEN}Symlink created. You can now type '$SYMLINK_NAME' to launch the v2.1 menu.${C_RESET}"

    # Save the symlink name to a file for removal script to know which one to remove
    echo "$SYMLINK_NAME" > "$BASE_DIR/.symlink_name"
 else
    echo -e "${C_YELLOW}Could not write to /opt/bin. You will need to run the menu using: $BASE_DIR/menu.sh${C_RESET}"
    SYMLINK_NAME="skyhero"  # Default name for the message below
fi

echo -e "
${C_GREEN}--- Installation Complete! ---${C_RESET}"
echo -e "The dashboard is now running. Access it at ${C_CYAN}http://<your_router_ip>:8082${C_RESET}"
echo -e "You can now use the '${SYMLINK_NAME}' command to access the menu."
echo -e "${C_GREEN}Auto-start feature is now enabled!${C_RESET}"
echo -e "Your application will automatically start after router reboots."
