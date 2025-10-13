import os
import json
from datetime import datetime, timedelta
from .config import Config
from .database import get_db_connection, ensure_healthy_database
from .utils import bytes_to_gb, get_date_range, get_device_name

def get_appropriate_quota(start_date_str, end_date_str):
    """
    Determines the appropriate quota type based on the period length.
    Returns the quota value and type identifier for dashboard display.

    Args:
        start_date_str (str): Start date in YYYY-MM-DD format
        end_date_str (str): End date in YYYY-MM-DD format

    Returns:
        tuple: (quota_value, quota_type) where quota_type is 'daily', 'weekly', or 'monthly'
    """
    try:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
        days_in_period = (end_date - start_date).days + 1  # Include both start and end days

        # Check if this is a month-to-date view (starts on 1st of any month)
        is_month_start_to_date = (
            start_date.day == 1  # Starts on the 1st of any month
        )

        # For periods starting from the 1st (month-to-date views), use monthly quota
        if is_month_start_to_date:
            return Config.MONTHLY_QUOTA_GB, "monthly"
        elif days_in_period == 1:
            return Config.DAILY_QUOTA_GB, "daily"
        elif days_in_period <= 7:
            return Config.WEEKLY_QUOTA_GB, "weekly"
        else:
            return Config.MONTHLY_QUOTA_GB, "monthly"
    except Exception:
        # Fallback to monthly quota if date parsing fails or quota attribute doesn't exist
        return Config.MONTHLY_QUOTA_GB, "monthly"

def rename_app(app_name):
    """
    Helper function to rename/group common, generic traffic types,
    mimicking the logic from the old get_device_apps.sh script.
    """
    generic_names = {"QUIC", "SSL/TLS", "General", "HTTP Protocol over TLS SSL"}
    if app_name in generic_names:
        return "Other Sources"
    return app_name

def create_daily_rollup(date_str):
    """
    Creates a single, immutable JSON file for a given calendar day.
    This replaces daily_rollup.sh.
    """
    try:
        day_start = datetime.strptime(date_str, '%Y-%m-%d')
        day_end = day_start + timedelta(days=1)
        day_start_ts = int(day_start.timestamp())
        day_end_ts = int(day_end.timestamp())

        conn = get_db_connection()
        cursor = conn.cursor()

        # Overall stats
        cursor.execute("""
            SELECT SUM(rx), SUM(tx), SUM(rx+tx) FROM traffic
            WHERE timestamp >= ? AND timestamp < ?
        """, (day_start_ts, day_end_ts))
        stats_row = cursor.fetchone()
        dl_bytes, ul_bytes, total_bytes = stats_row if stats_row and stats_row[0] is not None else (0, 0, 0)

        # Per-device stats
        cursor.execute("""
            SELECT mac, SUM(rx), SUM(tx), SUM(rx+tx) FROM traffic
            WHERE timestamp >= ? AND timestamp < ?
            GROUP BY mac
        """, (day_start_ts, day_end_ts))
        devices_rows = cursor.fetchall()

        # Per-device app usage
        cursor.execute("""
            SELECT mac, app_name, SUM(rx+tx) as total FROM traffic
            WHERE timestamp >= ? AND timestamp < ?
            GROUP BY mac, app_name
        """, (day_start_ts, day_end_ts))
        device_apps_rows = cursor.fetchall()
        
        device_app_map = {}
        for mac, app_name, total in device_apps_rows:
            # Apply rename logic during daily aggregation to group common traffic types
            renamed_app_name = rename_app(app_name)
            if mac not in device_app_map:
                device_app_map[mac] = []
            # Aggregate apps with the same renamed name
            existing_app = next((item for item in device_app_map[mac] if item["name"] == renamed_app_name), None)
            if existing_app:
                existing_app["total_bytes"] += total
            else:
                device_app_map[mac].append({"name": renamed_app_name, "total_bytes": total})

        # Top apps overall - Keep original names for main dashboard, don't group them
        cursor.execute("""
            SELECT app_name, SUM(rx+tx) as total FROM traffic
            WHERE timestamp >= ? AND timestamp < ?
            GROUP BY app_name ORDER BY total DESC LIMIT 10
        """, (day_start_ts, day_end_ts))
        top_apps_rows = cursor.fetchall()

        # Hourly aggregation for single-day detailed views (Optimized to use a single query)
        hourly_values = [0] * 24
        cursor.execute("""
            SELECT timestamp, rx, tx FROM traffic
            WHERE timestamp >= ? AND timestamp < ?
        """, (day_start_ts, day_end_ts))
        
        for ts, rx, tx in cursor.fetchall():
            # Calculate which hour bucket the record falls into
            hour_index = (ts - day_start_ts) // 3600
            if 0 <= hour_index < 24:
                hourly_values[hour_index] += (rx + tx)

        conn.close()

        # --- LEAN APPROACH: Daily rollup contains only raw byte counts ---
        devices_list = []
        for mac, dl, ul, total in devices_rows:
            percentage = (total / total_bytes * 100) if total_bytes > 0 else 0
            devices_list.append({
                "mac": mac,
                "name": get_device_name(mac),
                "dl_bytes": dl,
                "ul_bytes": ul,
                "total_bytes": total,
                "percentage": percentage,
                "topApps": sorted(device_app_map.get(mac, []), key=lambda x: x['total_bytes'], reverse=True)
            })

        # --- ENHANCE: Add 30-day context metrics and anomaly for single-day views ---
        thirty_days_ago = (datetime.strptime(date_str, '%Y-%m-%d') - timedelta(days=30)).strftime('%Y-%m-%d')
        thirty_files = [os.path.join(Config.DAILY_DIR, f"{d}.json") for d in get_date_range(thirty_days_ago, date_str)]
        for device in devices_list:
            device_30_total = 0
            device_30_daily = []
            for f in thirty_files:
                if os.path.exists(f) and os.path.getsize(f) > 0:
                    try:
                        with open(f, 'r') as fp:
                            d = json.load(fp)
                            for dev in d.get('devices', []):
                                if dev['mac'] == device['mac']:
                                    device_30_total += dev.get('total_bytes', 0)
                                    device_30_daily.append({"date": d['barChart']['labels'][0], "total_bytes": dev.get('total_bytes', 0)})
                    except (json.JSONDecodeError, KeyError):
                        continue  # Skip corrupted or incomplete files
            if device_30_total > 0 and len([f for f in thirty_files if os.path.exists(f)]) >= 7:  # Require at least 7 days of data
                device['avg_daily_gb'] = bytes_to_gb(device_30_total) / len([f for f in thirty_files if os.path.exists(f)])
                peak_30 = max(device_30_daily, key=lambda x: x['total_bytes']) if device_30_daily else {"date": "N/A", "total_bytes": 0}
                device['peak_day'] = {"date": peak_30['date'], "gb": bytes_to_gb(peak_30.get('total_bytes', 0))}
                # Add anomaly detection for single-day
                total_gb = bytes_to_gb(device['total_bytes'])
                device['recent_vs_avg_percent'] = 999 if total_gb > Config.DEVICE_HIGH_USAGE_ALERT_GB else 0
            else:
                # Fallback to single-day values if insufficient 30-day data
                device['avg_daily_gb'] = bytes_to_gb(device['total_bytes'])
                device['peak_day'] = {"date": date_str, "gb": bytes_to_gb(device['total_bytes'])}
                device['recent_vs_avg_percent'] = 0  # No anomaly if no data

        # The stats section will also be lean, storing only bytes.
        # The GB conversion will happen in the period_builder.
        rollup_data = {
            "stats_bytes": {
                "dl_bytes": dl_bytes,
                "ul_bytes": ul_bytes,
                "total_bytes": total_bytes,
                "devices_count": len(devices_list)
            },
            "barChart": {
                "title": "Daily Breakdown",
                "labels": [date_str],
                "values_bytes": [total_bytes],
                "hourly_values_bytes": hourly_values,
                "hourly_labels": [f"{h+1}h" for h in range(24)]
            },
            "devices": sorted(devices_list, key=lambda x: x['total_bytes'], reverse=True),
            "topApps": [{"name": name, "total_bytes": total} for name, total in top_apps_rows]
        }

        # Add quota info to stats
        quota_value, quota_type = get_appropriate_quota(date_str, date_str)
        rollup_data["stats_bytes"]["quotaGB"] = quota_value
        rollup_data["stats_bytes"]["quotaType"] = quota_type

        filepath = os.path.join(Config.DAILY_DIR, f"{date_str}.json")
        with open(filepath, 'w') as f:
            json.dump(rollup_data, f, indent=2)
        return True
    except Exception as e:
        print(f"Error creating daily rollup for {date_str}: {e}")
        return False

def build_period_report(start_date_str, end_date_str, output_filename=None):
    """
    Builds a report for a given period by aggregating daily files.
    This replaces period_builder.sh and now handles all GB conversions.
    """
    try:
        date_range = list(get_date_range(start_date_str, end_date_str))
        all_files = [os.path.join(Config.DAILY_DIR, f"{d}.json") for d in date_range]
        total_days = len(date_range)

        created_count = 0
        for i, dt_str in enumerate(date_range, 1):
            filepath = os.path.join(Config.DAILY_DIR, f"{dt_str}.json")
            if not os.path.exists(filepath):
                create_daily_rollup(dt_str)
                created_count += 1
                # Show progress more frequently for better UX
                if total_days > 10 and (created_count % 5 == 0 or created_count == total_days):
                    progress_pct = int((created_count / total_days) * 100) if total_days > 0 else 0
                    print(f"Progress: {created_count}/{total_days} daily rollups generated ({progress_pct}%)...")

        if created_count > 0:
            print(f"✅ Completed: Generated {created_count} daily rollups for period {start_date_str} to {end_date_str}")

        daily_data = []
        for f in all_files:
            if os.path.exists(f) and os.path.getsize(f) > 0:
                with open(f, 'r') as fp:
                    daily_data.append(json.load(fp))
            else:
                print(f"WARNING: Skipping empty or missing daily file: {f}")

        # Even if no data, we should still return a valid report structure for single day reports
        # This helps with UI consistency, especially for "Today" view
        if not daily_data:
            # For single day reports, create a minimal valid structure
            if start_date_str == end_date_str:
                # Determine appropriate quota for this single day
                quota_value, quota_type = get_appropriate_quota(start_date_str, end_date_str)

                report = {
                    "stats_bytes": {
                        "dl_bytes": 0,
                        "ul_bytes": 0,
                        "total_bytes": 0,
                        "devices_count": 0,
                        "quotaGB": quota_value,
                        "quotaType": quota_type
                    },
                    "devices": [],
                    "barChart": {
                        "labels": [start_date_str],
                        "values_bytes": [0],
                        "title": f"Daily Traffic ({start_date_str})"
                    },
                    "topApps": []
                }
                
                if output_filename:
                    filename = output_filename
                else:
                    filename = f"traffic_period_{start_date_str}-{end_date_str}.json"

                filepath = os.path.join(Config.PERIOD_DIR, filename)
                with open(filepath, 'w') as f:
                    json.dump(report, f, indent=2)
                    
                return report
            else:
                return None # Return None to indicate no data was found for multi-day reports

        # Aggregate raw byte stats - new lean format only
        total_dl_bytes = 0
        total_ul_bytes = 0
        total_traffic_bytes = 0
        
        for d in daily_data:
            # New format only
            total_dl_bytes += d.get('stats_bytes', {}).get('dl_bytes', 0)
            total_ul_bytes += d.get('stats_bytes', {}).get('ul_bytes', 0)
            total_traffic_bytes += d.get('stats_bytes', {}).get('total_bytes', 0)

        # Aggregate devices from raw bytes
        all_devices = {}
        for d in daily_data:
            for device in d.get('devices', []):
                mac = device['mac']
                if mac not in all_devices:
                    all_devices[mac] = {"mac": mac, "name": device['name'], "dl_bytes": 0, "ul_bytes": 0, "total_bytes": 0, "daily_traffic": [], "topApps": {}}
                
                all_devices[mac]['dl_bytes'] += device.get('dl_bytes', 0)
                all_devices[mac]['ul_bytes'] += device.get('ul_bytes', 0)
                all_devices[mac]['total_bytes'] += device.get('total_bytes', 0)
                all_devices[mac]['daily_traffic'].append({"date": d['barChart']['labels'][0], "total_bytes": device.get('total_bytes', 0)})
                
                # Aggregate individual device top apps for "Top 3 Apps (Period)" in Personalized Usage Summary
                for app in device.get('topApps', []):
                    app_name = rename_app(app['name'])  # Apply rename logic during aggregation
                    all_devices[mac]['topApps'][app_name] = all_devices[mac]['topApps'].get(app_name, 0) + app.get('total_bytes', 0)

        # Aggregate top apps from raw bytes
        all_top_apps = {}
        for d in daily_data:
            for app in d.get('topApps', []):
                all_top_apps[app['name']] = all_top_apps.get(app['name'], 0) + app.get('total_bytes', 0)

        # --- Determine appropriate quota for this period ---
        quota_value, quota_type = get_appropriate_quota(start_date_str, end_date_str)

        # --- Final Conversion and Formatting ---
        total_traffic_gb = bytes_to_gb(total_traffic_bytes)

        def calculate_anomaly_percent(device_data, days_in_period):
            """Calculate anomaly percentage for device card alerts"""
            if days_in_period == 1:
                # Single day threshold check (configurable)
                total_gb = bytes_to_gb(device_data['total_bytes'])
                return 999 if total_gb > Config.DEVICE_HIGH_USAGE_ALERT_GB else 0
            else:
                # Multi-day statistical comparison
                if len(device_data['daily_traffic']) <= 1 or device_data['total_bytes'] == 0:
                    return 0
                    
                most_recent = device_data['daily_traffic'][-1]['total_bytes']
                avg_daily = device_data['total_bytes'] / days_in_period
                
                if avg_daily == 0:
                    return 0
                    
                return ((most_recent - avg_daily) / avg_daily) * 100

        final_devices = []
        for mac, data in all_devices.items():
            if data['total_bytes'] < 5368709: # Filter insignificant devices
                continue

            peak_day = max(data['daily_traffic'], key=lambda x: x['total_bytes']) if data['daily_traffic'] else {"date": "N/A", "total_bytes": 0}
            
            # Calculate percentage using byte values directly
            data['percentage'] = (data['total_bytes'] / total_traffic_bytes * 100) if total_traffic_bytes > 0 else 0
            # Keep pre-calculated metrics in GB for convenience
            data['avg_daily_gb'] = bytes_to_gb(data['total_bytes']) / len(daily_data) if daily_data else 0
            data['peak_day'] = {"date": peak_day['date'], "gb": bytes_to_gb(peak_day.get('total_bytes', 0))}
            data['trend_bytes'] = [day['total_bytes'] for day in data['daily_traffic']]
            # Calculate anomaly detection percentage for device card alerts
            data['recent_vs_avg_percent'] = calculate_anomaly_percent(data, len(daily_data))

            # For single-day reports, override with 30-day aggregates for better context
            if len(daily_data) == 1:
                thirty_days_ago = (datetime.strptime(start_date_str, '%Y-%m-%d') - timedelta(days=30)).strftime('%Y-%m-%d')
                thirty_files = [os.path.join(Config.DAILY_DIR, f"{d}.json") for d in get_date_range(thirty_days_ago, end_date_str)]
                thirty_daily_data = []
                for f in thirty_files:
                    if os.path.exists(f) and os.path.getsize(f) > 0:
                        with open(f, 'r') as fp:
                            thirty_daily_data.append(json.load(fp))
                if thirty_daily_data:
                    device_30_total = 0
                    device_30_daily = []
                    for d in thirty_daily_data:
                        for dev in d.get('devices', []):
                            if dev['mac'] == mac:
                                device_30_total += dev.get('total_bytes', 0)
                                device_30_daily.append({"date": d['barChart']['labels'][0], "total_bytes": dev.get('total_bytes', 0)})
                    if device_30_total > 0 and len(thirty_daily_data) >= 7:  # Require at least 7 days for reliability
                        data['avg_daily_gb'] = bytes_to_gb(device_30_total) / len(thirty_daily_data)
                        peak_30 = max(device_30_daily, key=lambda x: x['total_bytes']) if device_30_daily else {"date": "N/A", "total_bytes": 0}
                        data['peak_day'] = {"date": peak_30['date'], "gb": bytes_to_gb(peak_30.get('total_bytes', 0))}
                    # If <7 days, keep original single-day values
            
            top_apps_list = sorted([{"name": k, "total_bytes": v} for k, v in data['topApps'].items()], key=lambda x: x['total_bytes'], reverse=True)
            data['topApps'] = [{"name": a['name'], "total_bytes": a['total_bytes']} for a in top_apps_list[:5]]
            
            final_devices.append(data)

        final_top_apps = sorted([{"name": k, "total_bytes": v} for k, v in all_top_apps.items()], key=lambda x: x['total_bytes'], reverse=True)

        report = {
            "stats_bytes": {
                "dl_bytes": total_dl_bytes,
                "ul_bytes": total_ul_bytes,
                "total_bytes": total_traffic_bytes,
                "devices_count": len(final_devices),
                "quotaGB": quota_value,
                "quotaType": quota_type
            },
            "devices": sorted(final_devices, key=lambda x: x['total_bytes'], reverse=True),
            "barChart": {
                "labels": [d['barChart']['labels'][0] for d in daily_data],
                "values_bytes": [d['barChart'].get('values_bytes', [0])[0] for d in daily_data],
                "title": f"Daily Traffic ({start_date_str} to {end_date_str})",
                # --- FIX: Carry over hourly data for single-day reports ---
                "hourly_values_bytes": daily_data[0]['barChart'].get('hourly_values_bytes') if len(daily_data) == 1 else None,
                "hourly_labels": daily_data[0]['barChart'].get('hourly_labels') if len(daily_data) == 1 else None
            },
            "topApps": [{"name": a['name'], "total_bytes": a['total_bytes']} for a in final_top_apps[:10]]
        }
        
        if output_filename:
            filename = output_filename
        else:
            filename = f"traffic_period_{start_date_str}-{end_date_str}.json"

        filepath = os.path.join(Config.PERIOD_DIR, filename)
        with open(filepath, 'w') as f:
            json.dump(report, f, indent=2)
            
        return report

    except Exception as e:
        print(f"Error building period report for {start_date_str} to {end_date_str}: {e}")
        return None

def get_device_apps(mac, start_date, end_date):
    """
    Gets the top applications for a single device over a given period.
    This replaces get_device_apps.sh
    """
    try:
        # For single-day reports, directly load the daily JSON file instead of building a full period report
        if start_date == end_date:
            daily_file_path = os.path.join(Config.DAILY_DIR, f"{start_date}.json")
            if os.path.exists(daily_file_path):
                with open(daily_file_path, 'r') as f:
                    daily_data = json.load(f)
                
                # Find the specific device in the daily data
                for device in daily_data.get('devices', []):
                    if device['mac'] == mac:
                        return {"apps": device.get('topApps', [])}
                return {"apps": []}
            else:
                # If daily file doesn't exist, create it first
                create_daily_rollup(start_date)
                return get_device_apps(mac, start_date, end_date)  # Recursive call after creation
        
        # Check for existing period files to avoid creating redundant ones
        # For current month date range, check if we can use traffic_period_current_month.json
        start_of_current_month = datetime.now().strftime('%Y-%m-01')
        today = datetime.now().strftime('%Y-%m-%d')
        if start_date == start_of_current_month and end_date == today:
            current_month_file_path = os.path.join(Config.PERIOD_DIR, "traffic_period_current_month.json")
            if os.path.exists(current_month_file_path):
                with open(current_month_file_path, 'r') as f:
                    current_month_data = json.load(f)
                
                # Find the specific device in the monthly data
                for device in current_month_data.get('devices', []):
                    if device['mac'] == mac:
                        return {"apps": device.get('topApps', [])}
                return {"apps": []}
        
        # For last 7 days date range, check if we can use traffic_period_last-7-days.json
        seven_days_ago = (datetime.now() - timedelta(days=6)).strftime('%Y-%m-%d')
        if start_date == seven_days_ago and end_date == today:
            last_7_days_file_path = os.path.join(Config.PERIOD_DIR, "traffic_period_last-7-days.json")
            if os.path.exists(last_7_days_file_path):
                with open(last_7_days_file_path, 'r') as f:
                    last_7_days_data = json.load(f)
                
                # Find the specific device in the last 7 days data
                for device in last_7_days_data.get('devices', []):
                    if device['mac'] == mac:
                        return {"apps": device.get('topApps', [])}
                return {"apps": []}
        
        # For completed monthly date ranges, check if we can use traffic_month_YYYY-MM.json
        try:
            start_dt = datetime.strptime(start_date, '%Y-%m-%d')
            end_dt = datetime.strptime(end_date, '%Y-%m-%d')
            
            # Check if this is a complete month (starts on day 1 and ends on month end)
            next_month_first = datetime(end_dt.year + (end_dt.month // 12), ((end_dt.month % 12) + 1), 1)
            last_day_of_month = (next_month_first - timedelta(days=1)).strftime('%Y-%m-%d')
            
            if start_date.endswith('-01') and end_date == last_day_of_month:
                month_file_name = f"traffic_month_{end_date[:7]}.json"
                month_file_path = os.path.join(Config.PERIOD_DIR, month_file_name)
                if os.path.exists(month_file_path):
                    with open(month_file_path, 'r') as f:
                        month_data = json.load(f)
                    
                    # Find the specific device in the monthly data
                    for device in month_data.get('devices', []):
                        if device['mac'] == mac:
                            return {"apps": device.get('topApps', [])}
                    return {"apps": []}
        except ValueError:
            # If date parsing fails, continue with regular build_period_report approach
            pass
        
        # For multi-day periods where no existing file is suitable, use build_period_report approach
        report = build_period_report(start_date, end_date)
        if report:
            for device in report['devices']:
                if device['mac'] == mac:
                    return {"apps": device.get('topApps', [])}
        return {"apps": []}
    except Exception as e:
        print(f"Error getting device apps for {mac}: {e}")
        return {"apps": []}

def create_monthly_reports():
    """
    Generates an aggregated JSON report for each month that has data.
    This replaces monthly_aggregator.sh.
    """
    print("Generating monthly reports...")
    daily_files = [f for f in os.listdir(Config.DAILY_DIR) if f.endswith('.json')]
    
    if not daily_files:
        print("No daily data found. Skipping monthly aggregation.")
        return

    # Filter out daily files that have no real data (empty or minimal files)
    meaningful_daily_files = []
    for daily_file in daily_files:
        filepath = os.path.join(Config.DAILY_DIR, daily_file)
        try:
            # Check if file has meaningful content
            if os.path.getsize(filepath) > 500:  # Only process files larger than 500 bytes (likely to have real data)
                meaningful_daily_files.append(daily_file)
        except OSError:
            continue  # Skip files we can't access
    
    if not meaningful_daily_files:
        print("No meaningful daily data found. Skipping monthly aggregation.")
        return

    monthly_prefixes = sorted(list(set([f.split('-')[0] + '-' + f.split('-')[1] for f in meaningful_daily_files])))
    
    # Filter out months that don't have sufficient data
    valid_monthly_prefixes = []
    for month_prefix in monthly_prefixes:
        # Count how many days in this month actually have data
        days_with_data = [f for f in meaningful_daily_files if f.startswith(month_prefix)]
        if len(days_with_data) >= 1:  # Only process months with at least 1 day of real data
            valid_monthly_prefixes.append(month_prefix)
    
    if not valid_monthly_prefixes:
        print("No months with sufficient data found. Skipping monthly aggregation.")
        return
    
    for month_prefix in valid_monthly_prefixes:
        try:
            parts = month_prefix.split('-')
            if len(parts) != 2:
                raise ValueError(f"Invalid month_prefix format: {month_prefix}")
            year, month = map(int, parts)
            start_date = f"{year:04d}-{month:02d}-01"

            # Find the last day of the month
            next_month = month + 1
            next_year = year
            if next_month > 12:
                next_month = 1
                next_year += 1
            last_day_of_month = datetime(next_year, next_month, 1) - timedelta(days=1)
            end_date = last_day_of_month.strftime('%Y-%m-%d')

            # For the current month, only aggregate up to today
            today_str = datetime.now().strftime('%Y-%m-%d')
            if end_date > today_str:
                end_date = today_str

            print(f"Processing month: {month_prefix}")
            output_filename = f"traffic_month_{month_prefix}.json"
            build_period_report(start_date, end_date, output_filename=output_filename)
        except (ValueError, IndexError) as e:
            print(f"Skipping invalid month_prefix '{month_prefix}': {e}")
            continue
    print("Monthly reports generated.")

def run_traffic_monitor():
    """Generates the standard set of reports for the UI."""
    # First check database health and attempt self-healing if needed
    if not ensure_healthy_database():
        print("ERROR: Database is not healthy and could not be restored. Aborting monitor run.")
        return False
    
    # Sync data from router's live database to local traffic.db
    # This ensures we have the latest data before generating reports
    from .database import sync_data_from_router
    if not sync_data_from_router():
        print("WARNING: Failed to sync data from router. Continuing with existing data.")
    
    print("Generating standard reports...")
    today = datetime.now().strftime('%Y-%m-%d')
    yesterday_dt = datetime.now() - timedelta(days=1)
    yesterday = yesterday_dt.strftime('%Y-%m-%d')
    seven_days_ago = (datetime.now() - timedelta(days=6)).strftime('%Y-%m-%d')
    start_of_month = datetime.now().strftime('%Y-%m-01')
    
    # --- FIX: Ensure today's daily rollup is always freshly generated ---
    # This is critical because build_period_report only creates missing files,
    # not stale ones. We need the latest data for "Today" and any report that includes today.
    print(f"Ensuring daily rollup for today ({today}) is up-to-date...")
    if not create_daily_rollup(today):
        print(f"ERROR: Failed to generate daily rollup for today ({today}).")
        # Depending on requirements, you might want to abort or continue.
        # For now, let's continue but log the error.
    # --- END OF FIX ---
    
    # Today and Yesterday (Single Day Reports) - Skipped
    # Single-day views now use enhanced daily JSON files directly, no period reports needed
    # build_period_report(today, today, output_filename=f"traffic_period_{today}-{today}.json")
    # build_period_report(yesterday, yesterday, output_filename=f"traffic_period_{yesterday}-{yesterday}.json")
    
    # Last 7 Days (Multi-Day Report)
    # This will now include the freshly updated data for today.
    build_period_report(seven_days_ago, today, output_filename="traffic_period_last-7-days.json")
    
    # This Month (Multi-Day Report) - Fixed filename to prevent accumulation
    # This will now include the freshly updated data for today.
    build_period_report(start_of_month, today, output_filename="traffic_period_current_month.json")
    
    # All-Time
    # Query database for earliest timestamp to ensure all historical data is included
    first_day = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT MIN(timestamp) FROM traffic")
        result = cursor.fetchone()
        if result and result[0]:
            earliest_ts = result[0]
            first_day = datetime.fromtimestamp(earliest_ts).strftime('%Y-%m-%d')
        conn.close()
    except Exception as e:
        print(f"Warning: Could not query database for earliest date: {e}")

    if first_day:
        build_period_report(first_day, today, output_filename="traffic_period_all-time.json")
        print(f"Generated 'All-Time' report from {first_day} to {today}")
    else:
        print("No historical data found in database, skipping 'All-Time' report.")
    print("Standard reports generated.")
    
    # Also generate monthly reports
    create_monthly_reports()
    return True