#!/bin/bash
set -eu

# --- Color Definitions ---
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[0;33m'
C_CYAN='\033[0;36m'
C_RESET='\033[0m'

# Resolve the actual script path, handling symlinks in BusyBox
# This is a common BusyBox-compatible way to get the real path of the script
SOURCE="${0}"
while [ -h "${SOURCE}" ]; do
    DIR="$( cd -P "$( dirname "${SOURCE}" )" && pwd )"
    SOURCE="$(readlink "${SOURCE}")"
    [ "${SOURCE}" != /* ] && SOURCE="${DIR}/${SOURCE}"
done
SCRIPT_DIR="$( cd -P "$( dirname "${SOURCE}" )" && pwd )"

# Now that SCRIPT_DIR is correctly determined, we can set BASE_DIR
# BASE_DIR is the parent directory of SCRIPT_DIR (e.g., /path/to/project)
export BASE_DIR="$(cd "$SCRIPT_DIR" && pwd)"
PYTHON_APP_PATH="$BASE_DIR/skyhero.py"

# Ensure logs directory exists
mkdir -p "$BASE_DIR/logs"

# --- Helper Functions ---
verify_installation() {
    echo "
Verifying active cron jobs for Superman & SkyHero Monitor v2.1..."
    cru l | grep "skyhero_monitor\\|skyhero_backup" || echo "No v2.1 cron jobs found."
    
    echo "
Verifying background server..."
    if ps w | grep "python" | grep "skyhero.py" | grep -v grep | grep -q "serve"; then
        echo -e "${C_GREEN}  -> Python web server is RUNNING.${C_RESET}"
        
        # Check server configuration
        WEB_SERVER_HOST=$(grep "WEB_SERVER_HOST" "$BASE_DIR/system/config.py" | grep -o "= \".*\"" | cut -d'"' -f2)
        if [ "$WEB_SERVER_HOST" = "lan_only" ]; then
            echo -e "  -> Server configured for: ${C_GREEN}LAN only (secure)${C_RESET}"
        elif [ "$WEB_SERVER_HOST" = "0.0.0.0" ]; then
            echo -e "  -> Server configured for: ${C_YELLOW}WAN access (0.0.0.0) - SECURITY RISK!${C_RESET}"
        else
            echo -e "  -> Server configured for: ${C_YELLOW}Custom IP ($WEB_SERVER_HOST)${C_RESET}"
        fi
    else
        echo -e "${C_RED}  -> Python web server is NOT RUNNING.${C_RESET}
"
    fi

    echo "
Verifying data backups..."
    MANUAL_BACKUP_COUNT=$(find "$BASE_DIR/manual_backups" -maxdepth 1 -name "superman_v2_manual_backup_*.tar.gz" -type f 2>/dev/null | wc -l)
    echo -e "${C_GREEN}  -> Found $MANUAL_BACKUP_COUNT manual backups.${C_RESET}"
}

show_instructions() {
    clear
    echo -e "${C_GREEN}--- Superman-Tracking v2.1 Instructions ---${C_RESET}"
    echo ""
    echo "To access the dashboard, open your web browser to:"
    echo -e "${C_CYAN}http://<your_router_ip>:8082/${C_RESET}"
    echo "(Replace <your_router_ip> with your router's actual IP address)"
    echo ""
    echo "Key Information:"
    echo "- Data is updated hourly by the 'skyhero_monitor' cron job."
    echo "- Historical data is backed up daily by the 'skyhero_backup' cron job (at 3:00 AM)."
    echo "- The dashboard is served by the Python Flask server."
    echo ""
    echo "Troubleshooting Tips:"
    echo "- If the dashboard shows no data, try running 'superman' and selecting 'Verify Status' (option 2)."
    echo "- Ensure your router's Traffic Analyzer is enabled and working."
    echo "- Check that the Python web server is running (use the Web Server Management menu)."
    echo ""
    read -p "Press [Enter] to return to the menu..."
}

show_last_install_results() {
    clear
    echo -e "${C_GREEN}--- Last Installation/Update Results ---${C_RESET}"
    echo ""
    if [ -f "$BASE_DIR/logs/install.log" ]; then
        cat "$BASE_DIR/logs/install.log"
    else
        echo -e "${C_YELLOW}No installation log found. Please run 'Install / Update' first.${C_RESET}"
    fi
    echo ""
    read -p "Press [Enter] to return to the menu..."
}

change_monthly_quota() {
    clear
    echo -e "${C_GREEN}--- Change Monthly Quota ---${C_RESET}"
    echo ""

    # Read current quota from config.py
    CURRENT_QUOTA=$(grep "MONTHLY_QUOTA_GB" "$BASE_DIR/system/config.py" | cut -d'=' -f2 | tr -d ' ')
    echo "Current Monthly Quota: ${CURRENT_QUOTA} GB"
    echo ""
    read -p "Enter new monthly quota in GB (e.g., 300): " new_quota

    if [ -n "$new_quota" ] && [ "$new_quota" -eq "$new_quota" ] 2>/dev/null && [ "$new_quota" -gt 0 ]; then
        # Update the config.py file
        sed -i "s/MONTHLY_QUOTA_GB = .*/MONTHLY_QUOTA_GB = $new_quota/" "$BASE_DIR/system/config.py"
        echo -e "${C_GREEN}Monthly quota updated to ${new_quota} GB.${C_RESET}"
        echo "Triggering a manual traffic scan to update dashboard..."
        python3 "$PYTHON_APP_PATH" monitor
        echo "Dashboard update triggered."
    else
        echo -e "${C_RED}Invalid input. Please enter a positive number.${C_RESET}"
    fi
}

change_daily_quota() {
    clear
    echo -e "${C_GREEN}--- Change Daily Quota ---${C_RESET}"
    echo ""

    # Read current quota from config.py
    CURRENT_QUOTA=$(grep "DAILY_QUOTA_GB" "$BASE_DIR/system/config.py" | cut -d'=' -f2 | tr -d ' ')
    echo "Current Daily Quota: ${CURRENT_QUOTA} GB"
    echo ""
    read -p "Enter new daily quota in GB (e.g., 50): " new_quota

    if [ -n "$new_quota" ] && [ "$new_quota" -eq "$new_quota" ] 2>/dev/null && [ "$new_quota" -gt 0 ]; then
        # Update the config.py file
        sed -i "s/DAILY_QUOTA_GB = .*/DAILY_QUOTA_GB = $new_quota/" "$BASE_DIR/system/config.py"
        echo -e "${C_GREEN}Daily quota updated to ${new_quota} GB.${C_RESET}"
        echo "Triggering a manual traffic scan to update dashboard..."
        python3 "$PYTHON_APP_PATH" monitor
        echo "Dashboard update triggered."
    else
        echo -e "${C_RED}Invalid input. Please enter a positive number.${C_RESET}"
    fi
}

change_weekly_quota() {
    clear
    echo -e "${C_GREEN}--- Change Weekly Quota ---${C_RESET}"
    echo ""

    # Read current quota from config.py
    CURRENT_QUOTA=$(grep "WEEKLY_QUOTA_GB" "$BASE_DIR/system/config.py" | cut -d'=' -f2 | tr -d ' ')
    echo "Current Weekly Quota: ${CURRENT_QUOTA} GB"
    echo ""
    read -p "Enter new weekly quota in GB (e.g., 200): " new_quota

    if [ -n "$new_quota" ] && [ "$new_quota" -eq "$new_quota" ] 2>/dev/null && [ "$new_quota" -gt 0 ]; then
        # Update the config.py file
        sed -i "s/WEEKLY_QUOTA_GB = .*/WEEKLY_QUOTA_GB = $new_quota/" "$BASE_DIR/system/config.py"
        echo -e "${C_GREEN}Weekly quota updated to ${new_quota} GB.${C_RESET}"
        echo "Triggering a manual traffic scan to update dashboard..."
        python3 "$PYTHON_APP_PATH" monitor
        echo "Dashboard update triggered."
    else
        echo -e "${C_RED}Invalid input. Please enter a positive number.${C_RESET}"
    fi
}

change_device_alert_threshold() {
    clear
    echo -e "${C_GREEN}--- Change Device High Usage Alert Threshold ---${C_RESET}"
    echo ""

    # Read current threshold from config.py
    CURRENT_THRESHOLD=$(grep "DEVICE_HIGH_USAGE_ALERT_GB" "$BASE_DIR/system/config.py" | cut -d'=' -f2 | tr -d ' ')
    echo "Current Device Alert Threshold: ${CURRENT_THRESHOLD} GB"
    echo ""
    echo "This setting controls when individual devices trigger \"High usage\" alerts"
    echo "on their device cards. When a device uses more than this amount in a"
    echo "single day (Today/Yesterday views), it will show a warning like"
    echo "\"⚠️ High usage: X.XX GB\" instead of \"✅ Usage is within normal range\"."
    echo ""
    read -p "Enter new alert threshold in GB (e.g., 5): " new_threshold

    if [ -n "$new_threshold" ] && [ "$new_threshold" -eq "$new_threshold" ] 2>/dev/null && [ "$new_threshold" -gt 0 ]; then
        # Update the config.py file
        sed -i "s/DEVICE_HIGH_USAGE_ALERT_GB = .*/DEVICE_HIGH_USAGE_ALERT_GB = $new_threshold/" "$BASE_DIR/system/config.py"
        echo -e "${C_GREEN}Device alert threshold updated to ${new_threshold} GB.${C_RESET}"
        echo "Triggering a manual traffic scan to update dashboard..."
        python3 "$PYTHON_APP_PATH" monitor
        echo "Dashboard update triggered."
    else
        echo -e "${C_RED}Invalid input. Please enter a positive number.${C_RESET}"
    fi
}

show_security_menu() {
    while true; do
        clear
        echo -e "${C_GREEN}--- Security Options ---${C_RESET}"
        echo "---------------------"
        echo ""

        # Check if password is currently enabled
        if [ -f "$BASE_DIR/data/.password" ]; then
            echo -e "${C_CYAN}Password Status: ${C_GREEN}ENABLED${C_RESET}"
        else
            echo -e "${C_CYAN}Password Status: ${C_YELLOW}DISABLED${C_RESET}"
        fi
        echo ""
        echo "1) Set/Change Password"
        echo "2) Disable Password"
        echo "3) Return to Main Menu"
        echo ""
        echo -n "Enter your choice [1-3]: "
        read -r choice

        case "$choice" in
            1)
                python3 "$PYTHON_APP_PATH" set-password
                read -p "Press [Enter] to continue..."
                ;;
            2)
                python3 "$PYTHON_APP_PATH" disable-password
                read -p "Press [Enter] to continue..."
                ;;
            3)
                return
                ;;
            *)
                echo -e "${C_RED}Invalid option. Please select 1-3.${C_RESET}"
                sleep 2
                ;;
        esac
    done
}

show_quota_menu() {
    while true; do
        clear
        echo -e "${C_GREEN}--- Quota Management ---${C_RESET}"
        echo "----------------------"
        echo ""

        # Read current quotas from config.py (extract only the numeric value)
        CURRENT_DAILY=$(grep "DAILY_QUOTA_GB" "$BASE_DIR/system/config.py" | cut -d'=' -f2 | cut -d'#' -f1 | tr -d ' ')
        CURRENT_WEEKLY=$(grep "WEEKLY_QUOTA_GB" "$BASE_DIR/system/config.py" | cut -d'=' -f2 | cut -d'#' -f1 | tr -d ' ')
        CURRENT_MONTHLY=$(grep "MONTHLY_QUOTA_GB" "$BASE_DIR/system/config.py" | cut -d'=' -f2 | cut -d'#' -f1 | tr -d ' ')
        CURRENT_ALERT=$(grep "DEVICE_HIGH_USAGE_ALERT_GB" "$BASE_DIR/system/config.py" | cut -d'=' -f2 | cut -d'#' -f1 | tr -d ' ')

        echo -e "${C_CYAN}Current Quota Settings:${C_RESET}"
        echo "  Daily Quota:   ${CURRENT_DAILY} GB (used for single-day views like Today/Yesterday)"
        echo "  Weekly Quota:  ${CURRENT_WEEKLY} GB (used for 2-7 day views like Last 7 Days)"
        echo "  Monthly Quota: ${CURRENT_MONTHLY} GB (used for 8+ day views like This Month)"
        echo "  Device High Usage Alert: ${CURRENT_ALERT} GB (triggers device card warnings)"
        echo ""
        echo "1) Change Daily Quota (${CURRENT_DAILY} GB)"
        echo "2) Change Weekly Quota (${CURRENT_WEEKLY} GB)"
        echo "3) Change Monthly Quota (${CURRENT_MONTHLY} GB)"
        echo "4) Change Device High Usage Alert (${CURRENT_ALERT} GB)"
        echo "5) View Quota Examples"
        echo "6) Return to Main Menu"
        echo ""
        echo -n "Enter your choice [1-6]: "
        read -r choice

        case "$choice" in
            1)
                change_daily_quota
                read -p "Press [Enter] to continue..."
                ;;
            2)
                change_weekly_quota
                read -p "Press [Enter] to continue..."
                ;;
            3)
                change_monthly_quota
                read -p "Press [Enter] to continue..."
                ;;
            4)
                change_device_alert_threshold
                read -p "Press [Enter] to continue..."
                ;;
            5)
                clear
                echo -e "${C_GREEN}--- Multi-Period Quota Examples ---${C_RESET}"
                echo ""
                echo "Dashboard Behavior:"
                echo "• Today filter     → Uses Daily Quota (${CURRENT_DAILY} GB)"
                echo "• Yesterday filter → Uses Daily Quota (${CURRENT_DAILY} GB)"
                echo "• Last 7 Days      → Uses Weekly Quota (${CURRENT_WEEKLY} GB)"
                echo "• This Month       → Uses Monthly Quota (${CURRENT_MONTHLY} GB)"
                echo ""
                echo "Device Card Alerts:"
                echo "• Single-day views show \"High usage\" warnings when > ${CURRENT_ALERT} GB"
                echo "• Multi-day views show statistical anomaly alerts (>18% above average)"
                echo ""
                read -p "Press [Enter] to return..."
                ;;
            6)
                return
                ;;
            *)
                echo -e "${C_RED}Invalid option. Please select 1-6.${C_RESET}"
                sleep 2
                ;;
        esac
    done
}

show_menu() {
    clear
    
    echo -e "${C_CYAN}"
    if [ -f "$BASE_DIR/www/ascii_art.txt" ]; then
        cat "$BASE_DIR/www/ascii_art.txt"
    else
        echo "Skyhero-Tracking v2.1"
    fi
    echo -e "${C_RESET}"
    echo ""
    echo -e "    ${C_GREEN}Welcome to the SkyHero-Tracking Management Menu${C_RESET}"
    echo "---------------------------------------------------------------------------"
    echo ""
    echo "  1) Install / Update - Run this first or to update scripts."
    echo ""
    echo "  2) Verify Status    - Check cron jobs, server, and backup count."
    echo ""
    echo "  3) Run Manual Traffic Grab   - instant on-demand dashboard refresh."
    echo ""
    echo "  4) Configure Web Server (Manual Start/Stop)"
    echo ""
    echo -e "  ${C_RED}5) Remove Project   - Uninstall the entire project.${C_RESET}"
    echo ""
    echo "  6) Database Self-Healing Options."
    echo ""
    echo "  7) Manual Data Backup & Restore."
    echo ""
    echo "  8) Manage Quota Limits."
    echo ""
    echo "  9) Restart Python Web Server."
    echo ""
    echo "  10) Security Options (Set/Change Password)."
    echo ""
    echo "  11) Check Resource Impact (RAM, CPU, Disk usage by our app)."
    echo ""
    echo "  12) Quit             - Exit this menu."
    echo ""
    echo -e "Dashboard URL: ${C_CYAN}http://<your_router_ip>:8082/${C_RESET}"
    echo ""
    echo -n "Enter your choice [1-12]: "
    read -r menu_choice

    case "$menu_choice" in
        1) 
            "$BASE_DIR/install.sh"
            read -p "Press [Enter] to return to the menu..."
            show_menu
            ;;
        2) 
            verify_installation
            read -p "
Press [Enter] to return to the menu..."
            show_menu
            ;;
        3)
            echo "Forcing an immediate data update for the dashboard..."
            python3 "$PYTHON_APP_PATH" monitor
            echo "Manual data update complete."
            read -p "
Press [Enter] to return to the menu..."
            show_menu
            ;;
        4)
            show_web_server_menu
            read -p "
Press [Enter] to return to the menu..."
            show_menu
            ;;
        5)
            echo -e "${C_RED}This will stop the server, remove cron jobs, and delete all project files.${C_RESET}"
            echo -e "Project base directory is: ${C_CYAN}$BASE_DIR${C_RESET}"
            echo ""

            # General confirmation
            printf "Are you sure you want to uninstall the project? [y/N]: "
            read -r choice
            case "$choice" in
                [yY][eE][sS]|[yY])
                    ;;
                *)
                    echo "Removal aborted by user."
                    read -p "Press [Enter] to return to the menu..."
                    show_menu
                    return
                    ;;
            esac

            # Specific confirmation for backups
            printf "Do you want to delete the database backups? (This is permanent) [y/N]: "
            read -r delete_backups_choice

            echo "Stopping Python web server..."
            kill $(ps | grep 'python' | grep 'skyhero.py serve' | grep -v grep | awk '{print $1}') 2>/dev/null || true
            sleep 2 # Give server time to shut down

            if ps | grep 'python' | grep 'skyhero.py serve' | grep -v grep > /dev/null; then
                echo -e "${C_RED}ERROR: Python web server is still running. Cannot uninstall.${C_RESET}"
                echo "Please stop it manually and try again."
                read -p "Press [Enter] to return..."
                show_menu
                return
            fi

            echo "Removing cron jobs..."
            cru d skyhero_monitor 2>/dev/null
            cru d skyhero_backup 2>/dev/null
            echo "Cron jobs removed."

            # Remove the symlink
            echo ""
            echo "Removing command symlink (if it exists)..."
            if [ -f "$BASE_DIR/.symlink_name" ]; then
                SYMLINK_NAME=$(cat "$BASE_DIR/.symlink_name")
                SYMLINK_PATH="/opt/bin/$SYMLINK_NAME"
                if [ -L "$SYMLINK_PATH" ]; then
                    rm "$SYMLINK_PATH"
                    echo "Symlink '$SYMLINK_NAME' removed."
                else
                    echo "Symlink '$SYMLINK_NAME' not found or not a symlink."
                fi
                # Clean up the .symlink_name file
                rm -f "$BASE_DIR/.symlink_name"
            else
                # Fallback to default behavior for backward compatibility
                echo "Checking for known symlink names..."
                if [ -L "/opt/bin/skyhero2" ]; then
                    rm "/opt/bin/skyhero2"
                    echo "Symlink 'skyhero2' removed."
                elif [ -L "/opt/bin/skyhero" ]; then
                    rm "/opt/bin/skyhero"
                    echo "Symlink 'skyhero' removed."
                else
                    echo "No skyhero symlink found."
                fi
            fi

            # Remove startup command from services-start script
            echo ""
            echo "Removing startup command from services-start script..."
            STARTUP_SCRIPT="/jffs/scripts/services-start"
            GREP_ID="skyhero.py serve" # Use a unique part of the command to identify the line
            
            if [ -f "$STARTUP_SCRIPT" ]; then
                if grep -qF "$GREP_ID" "$STARTUP_SCRIPT"; then
                    # Use grep -v to filter out the line and the comment before it
                    grep -vF "$GREP_ID" "$STARTUP_SCRIPT" | grep -vF "# Added by Superman-Tracking v2.1 Installer" > "$STARTUP_SCRIPT.tmp" && mv "$STARTUP_SCRIPT.tmp" "$STARTUP_SCRIPT"
                    echo "Startup command removed from $STARTUP_SCRIPT."
                else
                    echo "Startup command not found in $STARTUP_SCRIPT. Nothing to remove."
                fi
            else
                echo "services-start script not found. Nothing to remove."
            fi

            # Remove post-mount command block
            echo ""
            echo "Removing auto-start logic from post-mount script..."
            POST_MOUNT_SCRIPT="/jffs/scripts/post-mount"
            START_MARKER="# START Superman-Tracking v2.1 auto-start"
            END_MARKER="# END Superman-Tracking v2.1 auto-start"
            if [ -f "$POST_MOUNT_SCRIPT" ] && grep -qF "$START_MARKER" "$POST_MOUNT_SCRIPT"; then
                # Use sed to delete the block between the markers. Using a temp file for compatibility.
                sed '/'"$START_MARKER"'/,/'"$END_MARKER"'/d' "$POST_MOUNT_SCRIPT" > "$POST_MOUNT_SCRIPT.tmp"
                mv "$POST_MOUNT_SCRIPT.tmp" "$POST_MOUNT_SCRIPT"
                echo "Auto-start logic removed from $POST_MOUNT_SCRIPT."
            else
                echo "Auto-start logic not found in $POST_MOUNT_SCRIPT. Nothing to remove."
            fi

            # Remove project files
            echo ""
            case "$delete_backups_choice" in
                [yY][eE][sS]|[yY])
                    echo -e "${C_RED}Deleting entire project directory, including all backups...${C_RESET}"
                    rm -rf "$BASE_DIR"
                    echo "Project directory '$BASE_DIR' removed."
                    ;;
                *)
                    echo -e "${C_YELLOW}Deleting all project files, but PRESERVING database backups...${C_RESET}"
                    DB_BACKUPS_DIR_NAME=$(basename "$BASE_DIR/db_backups")
                    MANUAL_BACKUPS_DIR_NAME=$(basename "$BASE_DIR/manual_backups")
                    
                    # Remove all items except the backup directories
                    for item in "$BASE_DIR"/*; do
                        if [ -e "$item" ]; then
                            item_name=$(basename "$item")
                            if [ "$item_name" != "$DB_BACKUPS_DIR_NAME" ] && [ "$item_name" != "$MANUAL_BACKUPS_DIR_NAME" ]; then
                                echo "Removing $item_name..."
                                rm -rf "$item"
                            fi
                        fi
                    done
                    
                    # Also remove hidden files/directories except . and ..
                    find "$BASE_DIR" -mindepth 1 -maxdepth 1 -name ".*" -not -name "." -not -name ".." -exec rm -rf {} +
                    
                    echo "Project files removed. Backups preserved in '$BASE_DIR/$DB_BACKUPS_DIR_NAME' and '$BASE_DIR/$MANUAL_BACKUPS_DIR_NAME'."
                    ;;
            esac

            echo -e "${C_GREEN}Superman-Tracking v2.1 has been uninstalled successfully.${C_RESET}"
            echo "Note: If you had a v2.0 installation, its 'superman' command is still available."
            exit 0
            ;;
        6)
            # Run the self-healing control script in its own interactive mode
            clear
            python3 "$BASE_DIR/system/self-healing-control.py"
            read -p "
Press [Enter] to return to the menu..." </dev/tty
            show_menu
            ;;
        7)
            show_backup_restore_menu
            read -p "
Press [Enter] to return to the menu..."
            show_menu
            ;;
        8)
            show_quota_menu
            read -p "
Press [Enter] to return to the menu..."
            show_menu
            ;;
        9)
            echo "Restarting Python web server..."
            # Stop the server
            kill $(ps | grep 'python' | grep 'skyhero.py serve' | grep -v grep | awk '{print $1}') 2>/dev/null || true
            sleep 2 # Give it a moment to shut down

            # Start the server
            nohup python3 "$PYTHON_APP_PATH" serve > "$BASE_DIR/logs/server.log" 2>&1 &
            sleep 2 # Give it a moment to start

            if ps | grep 'python' | grep 'skyhero.py' | grep -v grep > /dev/null; then
                echo -e "${C_GREEN}Server restarted successfully.${C_RESET}"
            else
                echo -e "${C_RED}ERROR: Failed to restart server. Check logs/server.log.${C_RESET}"
            fi
            read -p "
Press [Enter] to return to the menu..."
            show_menu
            ;;
         10)
             show_security_menu
             read -p "
Press [Enter] to return to the menu..."
             show_menu
             ;;
        11)
            show_resource_impact
            read -p "
Press [Enter] to return to the menu..."
            show_menu
            ;;
        12)
            echo "Exiting management menu."
            exit 0
            ;;
        *)
            echo -e "${C_RED}Invalid option. Please try again.${C_RESET}"
            sleep 2
            show_menu
            ;;
    esac
}

# Web Server Management Sub-menu
show_web_server_menu() {
    while true; do
        clear
        echo -e "${C_GREEN}--- Python Web Server Management ---${C_RESET}"
        echo "-----------------------------------"
        echo "To access the dashboard, open your web browser to:"
        echo -e "${C_CYAN}http://<your_router_ip>:8082/${C_RESET}"
        echo "(Replace <your_router_ip> with your router's actual IP address)"
        echo ""
        echo "1) Start Python Web Server"
        echo "2) Stop Python Web Server"
        echo "3) Restart Python Web Server"
        echo "4) View Server Logs"
        echo "5) Check Server Status"
        echo "6) Return to Main Menu"
        echo "-----------------------------------"
        echo -n "Enter your choice: "
        read -r choice

        case "$choice" in
            1)
                echo "Starting the Python web server..."
                # Check if server is already running
                if ps | grep 'python' | grep 'skyhero.py' | grep -v grep > /dev/null; then
                    echo -e "${C_YELLOW}Server is already running.${C_RESET}"
                else
                    nohup python3 "$PYTHON_APP_PATH" serve > "$BASE_DIR/logs/server.log" 2>&1 &
                    sleep 2 # Give it a moment to start
                    
                    if ps | grep 'python' | grep 'skyhero.py' | grep -v grep > /dev/null; then
                        echo -e "${C_GREEN}Server started successfully.${C_RESET}"
                    else
                        echo -e "${C_RED}ERROR: Failed to start server. Check logs/server.log.${C_RESET}"
                    fi
                fi
                read -p "Press [Enter] to continue..."
                ;;
            2)
                echo "Stopping the Python web server..."
                kill $(ps | grep 'python' | grep 'skyhero.py serve' | grep -v grep | awk '{print $1}') 2>/dev/null || true
                sleep 2 # Give it a moment to shut down
                
                if ps | grep 'python' | grep 'skyhero.py serve' | grep -v grep > /dev/null; then
                    echo -e "${C_RED}ERROR: Failed to stop server.${C_RESET}"
                else
                    echo -e "${C_GREEN}Server stopped successfully.${C_RESET}"
                fi
                read -p "Press [Enter] to continue..."
                ;;
            3)
                echo "Restarting Python web server..."
                # Stop the server
                kill $(ps | grep 'python' | grep 'skyhero.py serve' | grep -v grep | awk '{print $1}') 2>/dev/null || true
                sleep 2 # Give it a moment to shut down

                # Start the server
                nohup python3 "$PYTHON_APP_PATH" serve > "$BASE_DIR/logs/server.log" 2>&1 &
                sleep 2 # Give it a moment to start

                if ps | grep 'python' | grep 'skyhero.py' | grep -v grep > /dev/null; then
                    echo -e "${C_GREEN}Server restarted successfully.${C_RESET}"
                else
                    echo -e "${C_RED}ERROR: Failed to restart server. Check logs/server.log.${C_RESET}"
                fi
                read -p "Press [Enter] to continue..."
                ;;
            4)
                echo "--- Displaying Server Logs (Press Ctrl+C to exit) ---"
                tail -f "$BASE_DIR/logs/server.log"
                read -p "Press [Enter] to continue..."
                ;;
            5)
                echo "Checking Python web server status..."
                if ps | grep 'python' | grep 'skyhero.py' | grep -v grep > /dev/null; then
                    echo -e "${C_GREEN}Python web server is RUNNING.${C_RESET}"
                    
                    # Check server configuration
                    WEB_SERVER_HOST=$(grep "WEB_SERVER_HOST" "$BASE_DIR/system/config.py" | grep -o "= \".*\"" | cut -d'"' -f2)
                    if [ "$WEB_SERVER_HOST" = "lan_only" ]; then
                        echo -e "  -> Server configured for: ${C_GREEN}LAN only access (secure)${C_RESET}"
                    elif [ "$WEB_SERVER_HOST" = "0.0.0.0" ]; then
                        echo -e "  -> Server configured for: ${C_YELLOW}WAN access (0.0.0.0) - SECURITY RISK!${C_RESET}"
                        echo -e "  -> ${C_YELLOW}WARNING: The server is accessible from the internet. Ensure you have a strong password set.${C_RESET}"
                    else
                        echo -e "  -> Server configured for: ${C_YELLOW}Custom IP ($WEB_SERVER_HOST)${C_RESET}"
                    fi
                else
                    echo -e "${C_RED}Python web server is NOT RUNNING.${C_RESET}"
                fi
                read -p "Press [Enter] to continue..."
                ;;
            6)
                return
                ;;
            *)
                echo -e "${C_RED}Invalid option.${C_RESET}"
                sleep 1
                ;;
        esac
    done
}

# Manual Backup/Restore Sub-menu
show_backup_restore_menu() {
    while true; do
        clear
        echo -e "${C_GREEN}--- Manual Data Backup & Restore ---${C_RESET}"
        echo "-----------------------------------"
        echo "1) Create New Full Data Backup"
        echo "2) Restore Full Data Backup"
        echo "3) Return to Main Menu"
        echo "-----------------------------------"
        echo -n "Enter your choice: "
        read -r choice

        case "$choice" in
            1)
                python3 "$PYTHON_APP_PATH" backup-manual
                read -p "Press [Enter] to return..."
                ;;
            2)
                # List available backups
                BACKUPS=$(find "$BASE_DIR/manual_backups" -maxdepth 1 -name "superman_v2_manual_backup_*.tar.gz" -type f 2>/dev/null | sort -r)
                if [ -z "$BACKUPS" ]; then
                    echo -e "${C_YELLOW}No manual backups found.${C_RESET}"
                    read -p "Press [Enter] to return..."
                    continue
                fi

                echo -e "${C_GREEN}Available Backups:${C_RESET}"
                i=1
                echo "$BACKUPS" | while read -r backup; do
                    echo "$i) $(basename "$backup")"
                    i=$((i + 1))
                done
                
                printf "Enter the number of the backup to restore, or 'q' to cancel: "
                read -r choice

                if [ "$choice" = "q" ] || [ "$choice" = "Q" ]; then
                    echo -e "${C_YELLOW}Restore cancelled.${C_RESET}"
                    read -p "Press [Enter] to return..."
                    continue
                fi

                # Get the selected backup file path
                SELECTED_BACKUP=$(echo "$BACKUPS" | sed -n "${choice}p")
                if [ -z "$SELECTED_BACKUP" ]; then
                    echo -e "${C_RED}Invalid choice. Please enter a valid number.${C_RESET}"
                    read -p "Press [Enter] to return..."
                    continue
                fi

                echo -e "\n${C_YELLOW}WARNING: Restoring will OVERWRITE your current 'data' and 'db_backups' folders!${C_RESET}"
                echo -e "${C_YELLOW}This action cannot be undone.${C_RESET}"
                printf "Are you sure you want to restore from ${C_CYAN}$(basename "$SELECTED_BACKUP")${C_RESET}? [y/N]: "
                read -r confirm_restore

                case "$confirm_restore" in
                    [yY][eE][sS]|[yY])
                        python3 "$PYTHON_APP_PATH" restore-manual "$SELECTED_BACKUP"
                        read -p "Press [Enter] to return..."
                        ;;
                    *)
                        echo -e "${C_YELLOW}Restore cancelled.${C_RESET}"
                        read -p "Press [Enter] to return..."
                        ;;
                esac
                ;;
            3)
                return
                ;;
            *)
                echo -e "${C_RED}Invalid option.${C_RESET}"
                sleep 1
                ;;
        esac
    done
}

# Resource Impact Check Function
show_resource_impact() {
    clear
    echo -e "${C_GREEN}--- Resource Impact Check ---${C_RESET}"
    echo "Analyzing RAM, CPU, and disk usage by Superman-Tracking v2.1..."
    echo ""
    
    # Check Python server process
    PYTHON_PID=$(ps | grep 'python' | grep 'skyhero.py' | grep 'serve' | grep -v grep | awk '{print $1}')
    
    if [ -n "$PYTHON_PID" ]; then
        echo -e "${C_CYAN}Python Web Server Process:${C_RESET}"
        echo "  PID: $PYTHON_PID"
        
        # Get process details using ps (BusyBox-compatible approach)
        PROCESS_LINE=$(ps w | grep "$PYTHON_PID" | grep -v grep)
        if [ -n "$PROCESS_LINE" ]; then
            echo "  Command: $(echo "$PROCESS_LINE" | awk '{for(i=5;i<=NF;i++) printf "%s ", $i; print ""}')"
            CPU_TIME=$(echo "$PROCESS_LINE" | awk '{print $3}')
            echo "  CPU Time: $CPU_TIME"
            
            # Try to get process start time for better CPU analysis
            START_INFO=$(echo "$PROCESS_LINE" | awk '{print $4, $5, $6, $7}')
            if [ -n "$START_INFO" ] && [ "$START_INFO" != "0 0" ]; then
                echo "  Started: $START_INFO"
            fi
            
            # Try to get memory info from /proc if available
            if [ -r "/proc/$PYTHON_PID/status" ]; then
                VmRSS_KB=$(grep "VmRSS:" "/proc/$PYTHON_PID/status" 2>/dev/null | awk '{print $2}' || echo "0")
                VmSize_KB=$(grep "VmSize:" "/proc/$PYTHON_PID/status" 2>/dev/null | awk '{print $2}' || echo "0")
                
                if [ "$VmRSS_KB" -gt 0 ] 2>/dev/null; then
                    RAM_MB=$((VmRSS_KB / 1024))
                    TOTAL_RAM_MB=$((VmSize_KB / 1024))
                    echo "  Physical Memory (RAM): ${RAM_MB} MB"
                    echo "  Virtual Memory: ${TOTAL_RAM_MB} MB"
                fi
            fi
        else
            echo "  Unable to retrieve detailed process information."
        fi
        
        # Resource usage assessment
        echo ""
        echo -e "${C_CYAN}Resource Usage Assessment:${C_RESET}"
        if [ "$VmRSS_KB" -gt 0 ] 2>/dev/null; then
            if [ "$RAM_MB" -lt 30 ]; then
                echo -e "  RAM Usage: ${C_GREEN}[EFFICIENT]${C_RESET} ${RAM_MB} MB - Excellent memory efficiency"
            elif [ "$RAM_MB" -lt 50 ]; then
                echo -e "  RAM Usage: ${C_YELLOW}[GOOD]${C_RESET} ${RAM_MB} MB - Good memory usage"
            elif [ "$RAM_MB" -lt 80 ]; then
                echo -e "  RAM Usage: ${C_YELLOW}[MODERATE]${C_RESET} ${RAM_MB} MB - Acceptable memory usage"
            else
                echo -e "  RAM Usage: ${C_RED}[HIGH]${C_RESET} ${RAM_MB} MB - High memory consumption"
            fi
        fi
        
        # Enhanced CPU assessment
                    echo ""
                    echo -e "${C_CYAN}CPU Usage Analysis:${C_RESET}"
                    if [ -n "$CPU_TIME" ]; then
                        # Note: On BusyBox systems, detailed CPU % monitoring is limited
                        # We'll provide context based on the CPU time value
                        # Adjusted thresholds for more realistic web server behavior
                        if [ "$CPU_TIME" -lt 20000 ] 2>/dev/null; then
                            echo -e "  CPU Usage: ${C_GREEN}[LOW]${C_RESET} $CPU_TIME - Minimal CPU consumption"
                        elif [ "$CPU_TIME" -lt 100000 ] 2>/dev/null; then
                            echo -e "  CPU Usage: ${C_YELLOW}[MODERATE]${C_RESET} $CPU_TIME - Normal CPU consumption"
                        else
                            echo -e "  CPU Usage: ${C_RED}[HIGH]${C_RESET} $CPU_TIME - High CPU consumption"
                        fi
                        echo "  Note: CPU time is cumulative. Lower values indicate less intensive processing."
                    fi
    else
        echo -e "${C_YELLOW}Python Web Server is not currently running.${C_RESET}"
    fi
    
    # Check disk usage of application directories
    echo ""
    echo -e "${C_CYAN}Application Storage:${C_RESET}"
    if [ -f "$BASE_DIR/traffic.db" ]; then
        DB_SIZE=$(du -sh "$BASE_DIR/traffic.db" 2>/dev/null | cut -f1)
        echo "  Database file: $DB_SIZE"
    else
        echo "  Database file: Not found"
    fi
    
    if [ -d "$BASE_DIR/data" ]; then
        DATA_SIZE=$(du -sh "$BASE_DIR/data" 2>/dev/null | cut -f1)
        echo "  Data directory: $DATA_SIZE"
    else
        echo "  Data directory: Not found"
    fi
    
    # Check log file sizes and recent errors
    echo ""
    echo -e "${C_CYAN}Log Analysis:${C_RESET}"
    if [ -f "$BASE_DIR/logs/server.log" ]; then
        LOG_SIZE=$(du -sh "$BASE_DIR/logs/server.log" 2>/dev/null | cut -f1)
        LOG_LINES=$(wc -l "$BASE_DIR/logs/server.log" 2>/dev/null | awk '{print $1}' || echo "0")
        echo "  Server log size: $LOG_SIZE ($LOG_LINES lines)"
        
        # Check for recent errors
        RECENT_ERRORS=$(tail -n 50 "$BASE_DIR/logs/server.log" 2>/dev/null | grep -ci "error\|exception\|traceback\|warning" 2>/dev/null || echo "0")
        RECENT_ERRORS=$(echo "$RECENT_ERRORS" | grep -E "^[0-9]+$" || echo "0")
        if [ "$RECENT_ERRORS" -gt 0 ] 2>/dev/null; then
            echo -e "  Recent errors/warnings (last 50 lines): ${C_YELLOW}$RECENT_ERRORS${C_RESET}"
            echo "  Last 3 error/warning lines:"
            tail -n 50 "$BASE_DIR/logs/server.log" 2>/dev/null | grep -i "error\|exception\|traceback\|warning" | tail -3 | sed 's/^/    /'
        else
            echo "  Recent errors/warnings (last 50 lines): None"
        fi
    else
        echo "  Server log: Not found"
    fi
    
    # Check for large backup files
    echo ""
    echo -e "${C_CYAN}Backup Information:${C_RESET}"
    if [ -d "$BASE_DIR/manual_backups" ]; then
        BACKUP_COUNT=$(find "$BASE_DIR/manual_backups" -name "*.tar.gz" 2>/dev/null | wc -l)
        echo "  Manual backups: $BACKUP_COUNT"
        
        if [ "$BACKUP_COUNT" -gt 0 ]; then
            echo "  Backup details:"
            find "$BASE_DIR/manual_backups" -name "*.tar.gz" 2>/dev/null | head -5 | while read backup; do
                BACKUP_SIZE=$(du -sh "$backup" 2>/dev/null | cut -f1)
                BACKUP_DATE=$(stat -c %y "$backup" 2>/dev/null | cut -d' ' -f1 || echo "Unknown")
                echo "    $(basename "$backup"): $BACKUP_SIZE (Created: $BACKUP_DATE)"
            done
            
            if [ "$BACKUP_COUNT" -gt 5 ]; then
                echo "    ... and $(($BACKUP_COUNT - 5)) more backups"
            fi
        fi
    else
        echo "  Manual backups: Directory not found"
    fi
    
    # Performance summary
    echo ""
    echo -e "${C_CYAN}Performance Summary:${C_RESET}"
    if [ -n "$CPU_TIME" ] && [ "$CPU_TIME" -gt 100000 ] 2>/dev/null; then
        echo -e "  Resource Impact Check: ${C_YELLOW}[MODERATE]${C_RESET} - Normal system load for long-running processes"
    else
        echo -e "  Resource Impact Check: ${C_GREEN}[LOW]${C_RESET} - Minimal system load"
    fi
    echo "  Execution Time: Typically <0.5 seconds"
    echo "  No background processes spawned"
    echo "  All metrics collected via standard system calls"
    echo ""
    echo "Resource impact check complete."
}

# --- Main Script Execution ---
show_menu
