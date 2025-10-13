import os
import json
import hashlib
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
