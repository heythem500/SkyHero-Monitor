import os
import re
import json
import hashlib
import subprocess
import time
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory
from .config import Config
from .reports import get_device_apps, build_period_report

# =============================================================================
# Section 4: Web Server (Flask API)
# =============================================================================

app = Flask(__name__)

@app.route('/')
def index():
    return send_from_directory(Config.WWW_DIR, 'index.html')

@app.route('/script.js')
def serve_script_js():
    return send_from_directory(Config.WWW_DIR, 'script.js')

@app.route('/style.css')
def serve_style_css():
    return send_from_directory(Config.WWW_DIR, 'style.css')

@app.route('/chart.js')
def serve_chart_js():
    return send_from_directory(Config.WWW_DIR, 'chart.js')

@app.route('/css/<path:filename>')
def serve_css(filename):
    return send_from_directory(os.path.join(Config.WWW_DIR, 'css'), filename)

@app.route('/js/<path:filename>')
def serve_js(filename):
    return send_from_directory(os.path.join(Config.WWW_DIR, 'js'), filename)

@app.route('/third-party/<path:filename>')
def serve_third_party(filename):
    return send_from_directory(os.path.join(Config.WWW_DIR, 'third-party'), filename)

@app.route('/css/notifications.css')
def serve_notifications_css():
    return send_from_directory(os.path.join(Config.WWW_DIR, 'css'), 'notifications.css')

@app.route('/js/notifications.js')
def serve_notifications_js():
    return send_from_directory(os.path.join(Config.WWW_DIR, 'js'), 'notifications.js')

@app.route('/skyhero-icon.png')
def serve_superman_icon():
    return send_from_directory(Config.WWW_DIR, 'skyhero-icon.png')

@app.route('/palestine_kid.png')
def serve_palestine_kid():
    return send_from_directory(Config.WWW_DIR, 'palestine_kid.png')

@app.route('/palestine_flag.png')
def serve_palestine_flag():
    return send_from_directory(Config.WWW_DIR, 'palestine_flag.png')

@app.route('/debug')
def debug_route():
    return "Flask debug route is working!"

@app.route('/data/period_data/<filename>')
def get_period_data(filename):
    print(f"Attempting to serve period data from: {os.path.join(Config.PERIOD_DIR, filename)}")
    return send_from_directory(Config.PERIOD_DIR, filename)

@app.route('/data/daily_json/<filename>')
def get_daily_json(filename):
    print(f"Attempting to serve daily JSON from: {os.path.join(Config.DAILY_DIR, filename)}")
    return send_from_directory(Config.DAILY_DIR, filename)

@app.route('/data/<filename>')
def get_data_file(filename):
    print(f"Attempting to serve data file from: {os.path.join(Config.DATA_DIR, filename)}")
    return send_from_directory(Config.DATA_DIR, filename)

@app.route('/get_available_months')
def get_available_months():
    files = [f for f in os.listdir(Config.PERIOD_DIR) if f.startswith('traffic_month_')]
    months = sorted(list(set([f.split('_')[2].replace('.json', '') for f in files])), reverse=True)
    return jsonify(months)

@app.route('/get_device_apps')
def get_device_apps_api():
    mac = request.args.get('mac')
    start = request.args.get('start')
    end = request.args.get('end')
    if not all([mac, start, end]):
        return jsonify({"error": "Missing required parameters"}), 400
    return jsonify(get_device_apps(mac, start, end))

@app.route('/request_generator')
def request_generator():
    start = request.args.get('start')
    end = request.args.get('end')
    if not all([start, end]):
        return jsonify({"error": "Missing required parameters"}), 400
    # In this new architecture, we can generate the report directly
    # instead of creating a .req file.
    report = build_period_report(start, end)
    if report:
        return jsonify({"success": True, "message": "Report generated."})
    else:
        return jsonify({"success": False, "message": "Failed to generate report."}), 500

@app.route('/auth_status')
def auth_status():
    return jsonify({"enabled": os.path.exists(Config.PASSWORD_FILE)})

@app.route('/auth_check', methods=['POST'])
def auth_check():
    password_attempt = request.get_data(as_text=True)
    if not os.path.exists(Config.PASSWORD_FILE):
        return jsonify({"success": True}) # No password set

    with open(Config.PASSWORD_FILE, 'r') as f:
        stored_hash = f.read().strip()
    
    attempted_hash = hashlib.sha256(password_attempt.encode()).hexdigest()

    if attempted_hash == stored_hash:
        return jsonify({"success": True})
    else:
        return jsonify({"success": False, "error": "Incorrect password"})

@app.route('/db_restore_status')
def db_restore_status():
    """API endpoint to check if there was a recent database restoration."""
    last_restore_file = os.path.join(Config.DATA_DIR, "last_restore.txt")
    
    if os.path.exists(last_restore_file):
        try:
            with open(last_restore_file, 'r') as f:
                content = f.read().strip()
                if content:
                    # Parse the content (format: corruption_time|restore_time|backup_file)
                    parts = content.split('|')
                    if len(parts) == 3:
                        return jsonify({
                            "restored": True,
                            "corruption_time": parts[0],
                            "restore_time": parts[1],
                            "backup_file": parts[2]
                        })
        except Exception as e:
            print(f"Error reading last_restore.txt: {e}")
    
    return jsonify({"restored": False})

@app.route('/clear_db_restore_status', methods=['POST'])
def clear_db_restore_status():
    """API endpoint to clear the database restoration status."""
    last_restore_file = os.path.join(Config.DATA_DIR, "last_restore.txt")
    
    if os.path.exists(last_restore_file):
        try:
            os.remove(last_restore_file)
            return jsonify({"success": True, "message": "Restore status cleared."})
        except Exception as e:
            print(f"Error removing last_restore.txt: {e}")
            return jsonify({"success": False, "error": str(e)}), 500
    
    return jsonify({"success": True, "message": "No restore status to clear."})

@app.route('/logs/db_restore_history.log')
def serve_db_restore_history():
    """Serve the database restore history log file."""
    log_file_path = os.path.join(Config.LOGS_DIR, "db_restore_history.log")
    if os.path.exists(log_file_path):
        return send_from_directory(Config.LOGS_DIR, "db_restore_history.log")
    else:
        return "Log file not found", 404

@app.route('/save_group', methods=['POST'])
def save_group():
    """Save or update a group in saved_groups.json."""
    data = request.get_json()
    if not data or 'name' not in data or 'devices' not in data:
        return jsonify({"success": False, "error": "Missing name or devices"}), 400

    name = data['name']
    devices = data['devices']
    groups_file = os.path.join(Config.DATA_DIR, "saved_groups.json")

    try:
        # Load existing groups
        if os.path.exists(groups_file):
            with open(groups_file, 'r') as f:
                groups_data = json.load(f)
        else:
            groups_data = {"groups": []}

        # Find existing group or add new
        group_found = False
        for group in groups_data["groups"]:
            if group["name"] == name:
                group["devices"] = devices
                group_found = True
                break
        if not group_found:
            groups_data["groups"].append({"name": name, "devices": devices})

        # Save back
        with open(groups_file, 'w') as f:
            json.dump(groups_data, f)

        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/load_groups')
def load_groups():
    """Load all groups from saved_groups.json."""
    groups_file = os.path.join(Config.DATA_DIR, "saved_groups.json")
    if not os.path.exists(groups_file):
        return jsonify({"groups": []})

    try:
        with open(groups_file, 'r') as f:
            groups_data = json.load(f)
        return jsonify(groups_data)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/delete_group', methods=['POST'])
def delete_group():
    """Delete a group from saved_groups.json."""
    data = request.get_json()
    if not data or 'name' not in data:
        return jsonify({"success": False, "error": "Missing name"}), 400

    name = data['name']
    groups_file = os.path.join(Config.DATA_DIR, "saved_groups.json")

    try:
        if os.path.exists(groups_file):
            with open(groups_file, 'r') as f:
                groups_data = json.load(f)
            groups_data["groups"] = [g for g in groups_data["groups"] if g["name"] != name]
            with open(groups_file, 'w') as f:
                json.dump(groups_data, f)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# =============================================================================
# Notifications API Endpoints
# =============================================================================

from .notify import (
    load_notification_config, save_notification_config, test_provider,
    load_rules, save_rules, get_next_rule_id,
    load_history, save_history_entry, delete_history_entry,
    send_notification,
    load_topics, save_topics, get_next_topic_id
)

@app.route('/api/notification/config', methods=['GET'])
def get_notification_config():
    """Get notification provider configuration."""
    config = load_notification_config()
    return jsonify(config)


@app.route('/api/notification/config', methods=['POST'])
def save_notification_config_api():
    """Save notification provider configuration."""
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400
    
    provider = data.get('provider')
    config = data.get('config', {})
    
    if not provider:
        return jsonify({"success": False, "error": "Provider is required"}), 400
    
    try:
        save_notification_config(provider, config)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/notification/test', methods=['POST'])
def test_notification_provider():
    """Test notification provider connection."""
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400
    
    provider = data.get('provider')
    config = data.get('config', {})
    
    if not provider:
        return jsonify({"success": False, "error": "Provider is required"}), 400
    
    try:
        success = test_provider(provider, config)
        return jsonify({"success": success})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/notification/rules', methods=['GET'])
def get_notification_rules():
    """Get all notification rules."""
    rules = load_rules()
    return jsonify({"rules": rules})


@app.route('/api/notification/rules', methods=['POST'])
def save_notification_rule():
    """Create or update a notification rule."""
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400
    
    # Validate alert_target if present
    if 'alert_target' in data:
        alert_target = data['alert_target']
        if not isinstance(alert_target, list):
            return jsonify({"success": False, "error": "alert_target must be an array"}), 400
        # Validate each target
        topics = load_topics()
        valid_topics = [str(t['id']) for t in topics]  # Convert to string for comparison
        for target in alert_target:
            target_str = str(target)
            if target_str != 'default' and target_str not in valid_topics:
                return jsonify({"success": False, "error": f"Invalid target: {target}"}), 400
    else:
        # Default to ["default"] if not provided (backward compatibility)
        data['alert_target'] = ["default"]
    
    rules = load_rules()
    
    # Check if updating existing rule
    rule_id = data.get('id')
    if rule_id:
        # Update existing
        for i, rule in enumerate(rules):
            if rule.get('id') == rule_id:
                rules[i] = data
                break
        # Clear dedup state so edited rule can fire again today
        try:
            from system.notify import reset_dedup_for_rule
            reset_dedup_for_rule(rule_id)
        except Exception as e:
            print(f"[api] Warning: could not reset dedup state for rule {rule_id}: {e}")
    else:
        # Create new
        data['id'] = get_next_rule_id()
        data['order'] = len(rules) + 1
        rules.append(data)
    
    try:
        save_rules(rules)
        return jsonify({"success": True, "rule": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/notification/rules/<int:rule_id>', methods=['DELETE'])
def delete_notification_rule(rule_id):
    """Delete a notification rule."""
    rules = load_rules()
    rules = [r for r in rules if r.get('id') != rule_id]
    
    try:
        save_rules(rules)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/notification/history', methods=['GET'])
def get_notification_history():
    """Get notification history."""
    entries = load_history()
    return jsonify({"entries": entries})


@app.route('/api/notification/history/<entry_id>', methods=['DELETE'])
def delete_notification_history_entry(entry_id):
    """Delete a notification history entry."""
    try:
        delete_history_entry(entry_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/notification/send', methods=['POST'])
def send_manual_notification():
    """Send a manual notification message with optional file attachment."""
    # Check if this is a file upload (multipart/form-data) or JSON
    content_type = request.content_type or ''
    
    if 'multipart/form-data' in content_type:
        # Handle file upload
        title = request.form.get('title', 'SkyHero Alert')
        message = request.form.get('message', '')
        target_identifier = request.form.get('target_identifier', None)
        attachment_file = request.files.get('attachment')
        
        if not message:
            return jsonify({"success": False, "error": "Message is required"}), 400
        
        if not attachment_file:
            return jsonify({"success": False, "error": "No file attached"}), 400
        
        # Read file data
        file_data = attachment_file.read()
        file_name = attachment_file.filename
        file_size = len(file_data)
        
        # Check file size limits
        config = load_notification_config()
        provider = config.get("provider")
        
        max_size = 2 * 1024 * 1024  # Default 2 MB
        if provider == "ntfy":
            ntfy_url = config.get("config", {}).get("url", "")
            if "ntfy.sh" not in ntfy_url:
                max_size = 15 * 1024 * 1024  # 15 MB for self-hosted
        elif provider == "pushover":
            max_size = 5 * 1024 * 1024  # 5 MB
        
        if file_size > max_size:
            max_mb = max_size / (1024 * 1024)
            return jsonify({"success": False, "error": f"File too large. Max: {max_mb:.0f} MB"}), 400
        
        try:
            success, error = send_notification(
                title, message, target_identifier,
                attachment_data=file_data,
                attachment_filename=file_name
            )
            
            # Determine target name for history
            target_name = "Admin (Default)"
            if target_identifier and target_identifier != "all":
                topics = load_topics()
                for topic in topics:
                    if topic.get("provider_identifier") == target_identifier:
                        target_name = topic.get("name", target_identifier)
                        break
                else:
                    target_name = target_identifier
            
            # Log to history
            save_history_entry({
                "id": f"hist_{int(time.time())}_manual",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "type": "manual",
                "rule_id": None,
                "rule_name": None,
                "targets": [target_name],
                "target_macs": [],
                "title": title,
                "message": f"{message} [📎 Attachment]",
                "status": "sent" if success else "failed"
            })
            
            if success:
                return jsonify({"success": True})
            else:
                return jsonify({"success": False, "error": error}), 500
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500
    
    else:
        # Handle JSON request (with optional URL attachment)
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "No data provided"}), 400
        
        title = data.get('title', 'SkyHero Alert')
        message = data.get('message', '')
        target_identifier = data.get('target_identifier', None)
        attachment_url = data.get('attachment_url')
        
        if not message:
            return jsonify({"success": False, "error": "Message is required"}), 400
        
        try:
            success, error = send_notification(
                title, message, target_identifier,
                attachment_url=attachment_url
            )
            
            # Determine target name for history
            target_name = "Admin (Default)"
            if target_identifier and target_identifier != "all":
                topics = load_topics()
                for topic in topics:
                    if topic.get("provider_identifier") == target_identifier:
                        target_name = topic.get("name", target_identifier)
                        break
                else:
                    target_name = target_identifier
            
            # Log to history
            history_message = message
            if attachment_url:
                history_message += f" [📎 URL]"
            
            save_history_entry({
                "id": f"hist_{int(time.time())}_manual",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "type": "manual",
                "rule_id": None,
                "rule_name": None,
                "targets": [target_name],
                "target_macs": [],
                "title": title,
                "message": history_message,
                "attachment_url": attachment_url,
                "status": "sent" if success else "failed"
            })
            
            if success:
                return jsonify({"success": True})
            else:
                return jsonify({"success": False, "error": error}), 500
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/notification/topics', methods=['GET'])
def get_notification_topics():
    """Get all notification topics/categories."""
    topics = load_topics()
    return jsonify({"topics": topics})


@app.route('/api/notification/topics', methods=['POST'])
def save_notification_topic():
    """Create or update a notification topic/category."""
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400
    
    topics = load_topics()
    
    # Check if updating existing topic
    topic_id = data.get('id')
    if topic_id:
        # Update existing
        for i, topic in enumerate(topics):
            if topic.get('id') == topic_id:
                topics[i] = data
                break
    else:
        # Create new
        data['id'] = get_next_topic_id()
        data['created'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        topics.append(data)
    
    try:
        save_topics(topics)
        return jsonify({"success": True, "topic": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/notification/topics/<int:topic_id>', methods=['DELETE'])
def delete_notification_topic(topic_id):
    """Delete a notification topic/category."""
    topics = load_topics()
    topics = [t for t in topics if t.get('id') != topic_id]
    
    try:
        save_topics(topics)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/notification/top-apps', methods=['GET'])
def get_top_apps():
    """
    Get top apps/websites from current dashboard data.
    Checks daily, weekly, and monthly data for comprehensive list.
    Returns all items sorted by total traffic (most used first).
    Note: The dashboard already groups generic traffic (QUIC, SSL/TLS, etc.) 
    into "Other Sources" via rename_app() in reports.py.
    """
    try:
        all_traffic = {}  # name -> total_bytes
        
        # Helper to extract apps from data
        def extract_apps(data):
            if not data:
                return
            devices = data.get('devices', [])
            for device in devices:
                top_apps = device.get('topApps', [])
                for app in top_apps:
                    name = app.get('name', '')
                    traffic = app.get('total_bytes', 0) or 0
                    if name:
                        all_traffic[name] = all_traffic.get(name, 0) + traffic
            
            # Also check top-level topApps
            for app in data.get('topApps', []):
                name = app.get('name', '')
                traffic = app.get('total_bytes', 0) or 0
                if name:
                    all_traffic[name] = all_traffic.get(name, 0) + traffic
        
        # 1. Check today's daily JSON (primary source)
        today = datetime.now().strftime('%Y-%m-%d')
        daily_file = os.path.join(Config.DAILY_DIR, f'{today}.json')
        if os.path.exists(daily_file):
            with open(daily_file, 'r') as f:
                extract_apps(json.load(f))
        
        # 2. Check weekly (last 7 days)
        weekly_file = os.path.join(Config.PERIOD_DIR, 'traffic_period_last-7-days.json')
        if os.path.exists(weekly_file):
            with open(weekly_file, 'r') as f:
                extract_apps(json.load(f))
        
        # 3. Check latest monthly
        if os.path.exists(Config.PERIOD_DIR):
            period_files = [f for f in os.listdir(Config.PERIOD_DIR) if f.startswith('traffic_month_')]
            if period_files:
                latest_month = sorted(period_files)[-1]
                month_file = os.path.join(Config.PERIOD_DIR, latest_month)
                if os.path.exists(month_file):
                    with open(month_file, 'r') as f:
                        extract_apps(json.load(f))
        
        # Sort by traffic (most used first)
        all_items = sorted(all_traffic.keys(), key=lambda x: all_traffic[x], reverse=True)
        
        return jsonify({
            "items": all_items,
            "has_data": len(all_items) > 0
        })
    except Exception as e:
        print(f"[get_top_apps] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"items": [], "has_data": False, "error": str(e)})


@app.route('/api/notification/devices', methods=['GET'])
def get_notification_devices():
    """
    Get list of devices from current dashboard data.
    Checks daily, weekly, and monthly data for comprehensive list.
    """
    try:
        devices_map = {}  # Use map to dedupe by MAC
        
        # Helper to extract devices
        def extract_devices(data):
            if not data:
                return
            for device in data.get('devices', []):
                mac = device.get('mac', '')
                name = device.get('name', 'Unknown')
                if mac and mac not in devices_map:
                    devices_map[mac] = {"mac": mac, "name": name}
        
        # 1. Check today's daily JSON
        today = datetime.now().strftime('%Y-%m-%d')
        daily_file = os.path.join(Config.DAILY_DIR, f'{today}.json')
        if os.path.exists(daily_file):
            with open(daily_file, 'r') as f:
                extract_devices(json.load(f))
        
        # 2. Check weekly (last 7 days)
        if os.path.exists(Config.PERIOD_DIR):
            weekly_file = os.path.join(Config.PERIOD_DIR, 'traffic_period_last-7-days.json')
            if os.path.exists(weekly_file):
                with open(weekly_file, 'r') as f:
                    extract_devices(json.load(f))
            
            # 3. Check latest monthly
            period_files = [f for f in os.listdir(Config.PERIOD_DIR) if f.startswith('traffic_month_')]
            if period_files:
                latest_month = sorted(period_files)[-1]
                month_file = os.path.join(Config.PERIOD_DIR, latest_month)
                if os.path.exists(month_file):
                    with open(month_file, 'r') as f:
                        extract_devices(json.load(f))
        
        devices_list = list(devices_map.values())
        
        return jsonify({
            "devices": devices_list,
            "has_data": len(devices_list) > 0
        })
    except Exception as e:
        return jsonify({"devices": [], "has_data": False, "error": str(e)})


# =============================================================================
# Settings API Endpoints
# =============================================================================

CONFIG_FILE = os.path.join(os.path.dirname(__file__), 'config.py')

@app.route('/api/settings/quota', methods=['GET'])
def get_quota_settings():
    try:
        with open(CONFIG_FILE, 'r') as f:
            content = f.read()
        return jsonify({
            'daily_quota_gb': int(re.search(r'DAILY_QUOTA_GB\s*=\s*(\d+)', content).group(1)),
            'weekly_quota_gb': int(re.search(r'WEEKLY_QUOTA_GB\s*=\s*(\d+)', content).group(1)),
            'monthly_quota_gb': int(re.search(r'MONTHLY_QUOTA_GB\s*=\s*(\d+)', content).group(1)),
            'device_high_usage_alert_gb': int(re.search(r'DEVICE_HIGH_USAGE_ALERT_GB\s*=\s*(\d+)', content).group(1)),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/settings/quota', methods=['POST'])
def set_quota_settings():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        with open(CONFIG_FILE, 'r') as f:
            content = f.read()

        replacements = {
            'DAILY_QUOTA_GB': data.get('daily_quota_gb'),
            'WEEKLY_QUOTA_GB': data.get('weekly_quota_gb'),
            'MONTHLY_QUOTA_GB': data.get('monthly_quota_gb'),
            'DEVICE_HIGH_USAGE_ALERT_GB': data.get('device_high_usage_alert_gb'),
        }

        for key, value in replacements.items():
            if value is not None:
                content = re.sub(
                    rf'({key}\s*=\s*)\d+',
                    rf'\g<1>{int(value)}',
                    content
                )

        with open(CONFIG_FILE, 'w') as f:
            f.write(content)

        # Trigger data refresh with new quota values
        subprocess.Popen(
            ['python3', 'skyhero.py', 'monitor'],
            cwd=os.path.dirname(os.path.dirname(__file__))
        )

        return jsonify({'success': True, 'message': 'Quota updated. Data refresh triggered.'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# =============================================================================
# Notes API Endpoints
# =============================================================================

@app.route('/api/note', methods=['GET'])
def get_note():
    """Load saved note content from data/notes.json."""
    note_file = os.path.join(Config.DATA_DIR, "notes.json")
    if not os.path.exists(note_file):
        return jsonify({})

    try:
        with open(note_file, 'r') as f:
            return jsonify(json.load(f))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/note', methods=['POST'])
def save_note():
    """Save note content to data/notes.json."""
    data = request.get_json()
    if not data or 'blocks' not in data:
        return jsonify({"success": False, "error": "Missing blocks"}), 400

    note_file = os.path.join(Config.DATA_DIR, "notes.json")

    try:
        with open(note_file, 'w') as f:
            json.dump(data, f)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
