"""
SkyHero Notifications Module
Handles multi-provider notification sending, rule evaluation, and provider testing.
"""

import os
import json
import re
import string
import time
import requests
from datetime import datetime, date
from .config import Config

def rename_app(app_name):
    """
    Helper function to rename/group common, generic traffic types.
    Mirrors the logic from reports.rename_app() to avoid circular import.
    Used by evaluate_rules() for specific_app trigger type.
    """
    generic_names = {"QUIC", "SSL/TLS", "General", "HTTP Protocol over TLS SSL"}
    if app_name in generic_names:
        return "Other Sources"
    return app_name


# =============================================================================
# Provider Configuration
# =============================================================================

NOTIFICATION_CONFIG_FILE = os.path.join(Config.DATA_DIR, "notification_config.json")
NOTIFICATION_RULES_FILE = os.path.join(Config.DATA_DIR, "notification_rules.json")
NOTIFICATION_HISTORY_FILE = os.path.join(Config.DATA_DIR, "notification_history.json")
NOTIFICATION_STATE_FILE = os.path.join(Config.DATA_DIR, "notification_state.json")
NOTIFICATION_TOPICS_FILE = os.path.join(Config.DATA_DIR, "notification_topics.json")

# History limit
MAX_HISTORY_ENTRIES = 200

# =============================================================================
# Configuration Management
# =============================================================================

def load_notification_config():
    """Load notification provider configuration."""
    if not os.path.exists(NOTIFICATION_CONFIG_FILE):
        return {"provider": None, "config": {}}
    
    try:
        with open(NOTIFICATION_CONFIG_FILE, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"[notify] Error loading config: {e}")
        return {"provider": None, "config": {}}


def save_notification_config(provider, config):
    """Save notification provider configuration."""
    os.makedirs(Config.DATA_DIR, exist_ok=True)
    
    data = {
        "provider": provider,
        "config": config,
        "last_saved": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    
    # Atomic write
    tmp_file = NOTIFICATION_CONFIG_FILE + ".tmp"
    with open(tmp_file, 'w') as f:
        json.dump(data, f, indent=2)
    os.rename(tmp_file, NOTIFICATION_CONFIG_FILE)
    
    return True

def resolve_alert_targets(alert_target, topics=None, config=None):
    """
    Resolve alert_target array to list of provider identifiers.
    
    Args:
        alert_target: Array of targets (e.g., ["default", "1", "2"])
        topics: Optional pre-loaded topics list to avoid re-reading file
        config: Optional pre-loaded config to avoid re-reading file
    
    Returns:
        List of (target_name, provider_identifier) tuples
    """
    targets = []
    if config is None:
        config = load_notification_config()
    default_identifier = None
    
    # Get default provider identifier
    provider = config.get("provider")
    provider_config = config.get("config", {})
    if provider == "ntfy":
        default_identifier = provider_config.get("topic")
    elif provider == "gotify":
        default_identifier = provider_config.get("app_token")
    elif provider == "pushover":
        default_identifier = provider_config.get("user_key")
    elif provider == "webhook":
        default_identifier = provider_config.get("url")
    
    # Load custom topics if not provided
    if topics is None:
        topics = load_topics()
    
    # Deduplicate targets
    seen = set()
    unique_targets = []
    for t in alert_target:
        t_str = str(t)
        if t_str not in seen:
            seen.add(t_str)
            unique_targets.append(t)
    
    topic_map = {str(t["id"]): t for t in topics}
    
    for target in unique_targets:
        target_str = str(target)
        if target_str == "default":
            if default_identifier:
                targets.append(("Admin (Default)", default_identifier))
        else:
            topic = topic_map.get(target_str)
            if topic:
                targets.append((topic["name"], topic["provider_identifier"]))
    
    return targets

# =============================================================================
# Rules Management
# =============================================================================
# Rules Management
# =============================================================================

def load_rules():
    """Load notification rules."""
    if not os.path.exists(NOTIFICATION_RULES_FILE):
        # Create default rules on first load
        return create_default_rules()
    
    try:
        with open(NOTIFICATION_RULES_FILE, 'r') as f:
            data = json.load(f)
        return data.get("rules", [])
    except Exception as e:
        print(f"[notify] Error loading rules: {e}")
        return []


def save_rules(rules):
    """Save notification rules."""
    os.makedirs(Config.DATA_DIR, exist_ok=True)
    
    # Sort by order field
    rules = sorted(rules, key=lambda r: r.get("order", 0))
    
    data = {
        "rules": rules,
        "last_saved": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    
    # Backup existing file
    if os.path.exists(NOTIFICATION_RULES_FILE):
        backup = NOTIFICATION_RULES_FILE + ".bak"
        try:
            os.replace(NOTIFICATION_RULES_FILE, backup)
        except:
            pass
    
    # Atomic write
    tmp_file = NOTIFICATION_RULES_FILE + ".tmp"
    with open(tmp_file, 'w') as f:
        json.dump(data, f, indent=2)
    os.rename(tmp_file, NOTIFICATION_RULES_FILE)
    
    return True


def create_default_rules():
    """Create default notification rules on first install."""
    default_rules = [
        {
            "id": 1,
            "name": "Any device exceeds 50 GB download",
            "active": False,
            "period": "monthly",
            "trigger_type": "download",
            "trigger_app": None,
            "threshold_gb": 50,
            "devices": [],
            "message_template": "⚠️ {device_name} exceeded {threshold} GB download!",
            "order": 1
        },
        {
            "id": 2,
            "name": "Any app/website exceeds 20 GB",
            "active": False,
            "period": "monthly",
            "trigger_type": "any_app_exceeds",
            "trigger_app": None,
            "threshold_gb": 20,
            "devices": [],
            "message_template": "⚠️ {app_name} exceeded {threshold} GB on {device_name}!",
            "order": 2
        },
        {
            "id": 3,
            "name": "New unknown device detected",
            "active": True,
            "period": "today",
            "trigger_type": "new_device",
            "trigger_app": None,
            "threshold_gb": None,
            "devices": [],
            "message_template": "📱 New unknown device detected: {mac_address}",
            "order": 3
        }
    ]
    
    save_rules(default_rules)
    return default_rules


def get_next_rule_id():
    """Get the next available rule ID."""
    rules = load_rules()
    if not rules:
        return 1
    return max(r.get("id", 0) for r in rules) + 1


# =============================================================================
# Topics Management
# =============================================================================

def load_topics():
    """Load notification topics/categories."""
    if not os.path.exists(NOTIFICATION_TOPICS_FILE):
        return []
    
    try:
        with open(NOTIFICATION_TOPICS_FILE, 'r') as f:
            data = json.load(f)
        return data.get("topics", [])
    except Exception as e:
        print(f"[notify] Error loading topics: {e}")
        return []


def save_topics(topics):
    """Save notification topics/categories."""
    os.makedirs(Config.DATA_DIR, exist_ok=True)
    
    data = {
        "topics": topics,
        "last_saved": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    
    # Atomic write
    tmp_file = NOTIFICATION_TOPICS_FILE + ".tmp"
    with open(tmp_file, 'w') as f:
        json.dump(data, f, indent=2)
    os.rename(tmp_file, NOTIFICATION_TOPICS_FILE)
    
    return True


def get_next_topic_id():
    """Get the next available topic ID."""
    topics = load_topics()
    if not topics:
        return 1
    return max(t.get("id", 0) for t in topics) + 1


# =============================================================================
# History Management
# =============================================================================

def load_history():
    """Load notification history."""
    if not os.path.exists(NOTIFICATION_HISTORY_FILE):
        return []
    
    try:
        with open(NOTIFICATION_HISTORY_FILE, 'r') as f:
            data = json.load(f)
        return data.get("entries", [])
    except Exception as e:
        print(f"[notify] Error loading history: {e}")
        return []


def save_history_entry(entry):
    """Add a new entry to notification history."""
    os.makedirs(Config.DATA_DIR, exist_ok=True)
    
    entries = load_history()
    entries.insert(0, entry)  # Add to beginning
    
    # Trim to max entries
    if len(entries) > MAX_HISTORY_ENTRIES:
        entries = entries[:MAX_HISTORY_ENTRIES]
    
    data = {
        "entries": entries,
        "last_saved": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    
    # Atomic write
    tmp_file = NOTIFICATION_HISTORY_FILE + ".tmp"
    with open(tmp_file, 'w') as f:
        json.dump(data, f, indent=2)
    os.rename(tmp_file, NOTIFICATION_HISTORY_FILE)
    
    return True


def delete_history_entry(entry_id):
    """Delete a history entry by ID."""
    entries = load_history()
    entries = [e for e in entries if e.get("id") != entry_id]
    
    data = {
        "entries": entries,
        "last_saved": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    
    tmp_file = NOTIFICATION_HISTORY_FILE + ".tmp"
    with open(tmp_file, 'w') as f:
        json.dump(data, f, indent=2)
    os.rename(tmp_file, NOTIFICATION_HISTORY_FILE)
    
    return True


# =============================================================================
# State Management (Deduplication)
# =============================================================================

def load_state():
    """Load notification state (for deduplication)."""
    if not os.path.exists(NOTIFICATION_STATE_FILE):
        return {"last_fired": {}, "last_reset_date": date.today().isoformat()}
    
    try:
        with open(NOTIFICATION_STATE_FILE, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"[notify] Error loading state: {e}")
        return {"last_fired": {}, "last_reset_date": date.today().isoformat()}


def save_state(state):
    """Save notification state."""
    os.makedirs(Config.DATA_DIR, exist_ok=True)
    
    tmp_file = NOTIFICATION_STATE_FILE + ".tmp"
    with open(tmp_file, 'w') as f:
        json.dump(state, f, indent=2)
    os.rename(tmp_file, NOTIFICATION_STATE_FILE)


def format_message(template, rule_id, rule_name, target_names, target_macs, **kwargs):
    """Format a notification template with given variables.
    
    Wraps each variable value in « » so recipients can distinguish
    rendered data from fixed text (e.g., «YouTube» vs the surrounding message).
    
    On KeyError, finds ALL missing variables and logs a failed history entry.
    Returns None so caller can skip sending.
    """
    try:
        parts = []
        for literal_text, field_name, format_spec, conversion in string.Formatter().parse(template):
            parts.append(literal_text)
            if field_name is not None:
                value = kwargs[field_name]
                parts.append(f'\u00ab{value}\u00bb')
        return ''.join(parts)
    except KeyError:
        provided = set(kwargs.keys())
        placeholders = set(re.findall(r'\{([^}]+)\}', template))
        missing = sorted(placeholders - provided)
        print(f"[notify] Rule {rule_id} template error: {missing} - not available in this mode")
        save_history_entry({
            "id": f"hist_{int(time.time())}_{rule_id}_err",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "type": "rule",
            "rule_id": rule_id,
            "rule_name": rule_name,
            "targets": target_names,
            "target_macs": target_macs,
            "message": f"Template error: {missing} - not available in this mode",
            "status": "failed"
        })
        return None


def reset_dedup_for_rule(rule_id):
    """Clear all dedup keys for a specific rule so it can fire again today."""
    state = load_state()
    today = date.today().isoformat()
    
    prefix = f"{rule_id}:"
    keys_to_remove = [k for k in state.get("last_fired", {}) if k.startswith(prefix)]
    
    if keys_to_remove:
        for key in keys_to_remove:
            del state["last_fired"][key]
        save_state(state)


def check_and_update_dedup(rule_id, device_mac):
    """Check if notification already fired today, update if not."""
    state = load_state()
    today = date.today().isoformat()
    
    # Reset if new day
    if state.get("last_reset_date") != today:
        state = {"last_fired": {}, "last_reset_date": today}
    
    # Key format: "{rule_id}:{device_mac}" (MAC is stored as-is)
    key = f"{rule_id}:{device_mac}" if device_mac != "aggregate" else f"{rule_id}:aggregate"
    
    if state["last_fired"].get(key) == today:
        return False  # Already fired today
    
    # Update state
    state["last_fired"][key] = today
    save_state(state)
    return True  # Can fire


# =============================================================================
# Notification Sending (Multi-Provider)
# =============================================================================

def send_notification(title, message, target_identifier=None, attachment_data=None, attachment_filename=None, attachment_url=None, retry=True, config=None):
    """
    Send notification via configured provider.
    
    Args:
        title: Notification title
        message: Notification message
        target_identifier: Optional provider-specific identifier (topic/token/key)
                          If None, uses default from config
        attachment_data: Optional file data (bytes) for file upload
        attachment_filename: Optional filename for the attachment
        attachment_url: Optional URL for Ntfy URL attachment
        retry: Whether to retry once on failure
        config: Optional pre-loaded config to avoid re-reading file
    
    Returns:
        (success: bool, error_message: str or None)
    """
    if config is None:
        config = load_notification_config()
    provider = config.get("provider")
    
    if not provider:
        return False, "No notification provider configured"
    
    provider_config = config.get("config", {}).copy()
    
    # Override with custom target if provided
    if target_identifier and target_identifier != "all":
        if provider == "ntfy":
            provider_config["topic"] = target_identifier
        elif provider == "gotify":
            provider_config["app_token"] = target_identifier
        elif provider == "pushover":
            provider_config["user_key"] = target_identifier
        elif provider == "webhook":
            provider_config["url"] = target_identifier
    
    try:
        if provider == "ntfy":
            success = send_via_ntfy(provider_config, title, message, attachment_data, attachment_filename, attachment_url)
        elif provider == "gotify":
            success = send_via_gotify(provider_config, title, message)
        elif provider == "pushover":
            success = send_via_pushover(provider_config, title, message, attachment_data, attachment_filename)
        elif provider == "webhook":
            success = send_via_webhook(provider_config, title, message)
        else:
            return False, f"Unknown provider: {provider}"
        
        if success:
            return True, None
        else:
            # Retry once after 30 seconds
            if retry:
                time.sleep(30)
                return send_notification(title, message, target_identifier, attachment_data, attachment_filename, attachment_url, retry=False)
            return False, "Failed to send notification"
            
    except Exception as e:
        if retry:
            time.sleep(30)
            return send_notification(title, message, target_identifier, attachment_data, attachment_filename, attachment_url, retry=False)
        return False, str(e)


def send_via_ntfy(cfg, title, message, attachment_data=None, attachment_filename=None, attachment_url=None):
    """Send via Ntfy with optional file upload or URL attachment."""
    url = cfg.get("url", "").rstrip("/")
    topic = cfg.get("topic", "skyhero-alerts")
    username = cfg.get("username")
    password = cfg.get("password")
    
    if not url:
        return False
    
    # Setup auth if provided
    auth = None
    if username and password:
        auth = (username, password)
    
    try:
        headers = {"Title": title}
        
        # Handle file upload
        if attachment_data:
            headers["X-Filename"] = attachment_filename or "attachment"
            response = requests.put(
                f"{url}/{topic}",
                data=attachment_data,
                headers=headers,
                auth=auth,
                timeout=30
            )
            return response.status_code == 200
        
        # Handle URL attachment
        if attachment_url:
            headers["Attach"] = attachment_url
            response = requests.post(
                f"{url}/{topic}",
                data=message.encode("utf-8"),
                headers=headers,
                auth=auth,
                timeout=10
            )
            return response.status_code == 200
        
        # Regular message
        response = requests.post(
            f"{url}/{topic}",
            data=message.encode("utf-8"),
            headers=headers,
            auth=auth,
            timeout=10
        )
        return response.status_code == 200
    except Exception as e:
        print(f"[notify] Ntfy error: {e}")
        return False


def send_via_gotify(cfg, title, message):
    """Send via Gotify."""
    url = cfg.get("url", "").rstrip("/")
    token = cfg.get("app_token", "")
    
    if not url or not token:
        return False
    
    try:
        response = requests.post(
            f"{url}/message",
            params={"token": token},
            json={"title": title, "message": message},
            timeout=10
        )
        return response.status_code == 200
    except Exception as e:
        print(f"[notify] Gotify error: {e}")
        return False


def send_via_pushover(cfg, title, message, attachment_data=None, attachment_filename=None):
    """Send via Pushover with optional file attachment."""
    user_key = cfg.get("user_key", "")
    app_token = cfg.get("app_token", "")
    
    if not user_key or not app_token:
        return False
    
    try:
        data = {
            "user": user_key,
            "token": app_token,
            "title": title,
            "message": message
        }
        
        # Handle file attachment
        if attachment_data:
            files = {
                "attachment": (attachment_filename or "attachment", attachment_data)
            }
            response = requests.post(
                "https://api.pushover.net/1/messages.json",
                data=data,
                files=files,
                timeout=30
            )
        else:
            response = requests.post(
                "https://api.pushover.net/1/messages.json",
                data=data,
                timeout=10
            )
        
        return response.status_code == 200
    except Exception as e:
        print(f"[notify] Pushover error: {e}")
        return False


def send_via_webhook(cfg, title, message):
    """Send via custom webhook."""
    url = cfg.get("url", "")
    headers_raw = cfg.get("headers", "")
    
    if not url:
        return False
    
    # Parse headers
    headers = {"Content-Type": "application/json"}
    if headers_raw:
        for line in headers_raw.strip().split("\n"):
            if ":" in line:
                key, value = line.split(":", 1)
                headers[key.strip()] = value.strip()
    
    try:
        response = requests.post(
            url,
            json={"title": title, "message": message},
            headers=headers,
            timeout=10
        )
        return response.status_code in [200, 201, 204]
    except Exception as e:
        print(f"[notify] Webhook error: {e}")
        return False


# =============================================================================
# Provider Testing
# =============================================================================

def test_provider(provider, config):
    """Test a notification provider connection."""
    test_title = "SkyHero Test"
    test_message = "This is a test notification from SkyHero."
    
    try:
        if provider == "ntfy":
            return send_via_ntfy(config, test_title, test_message)
        elif provider == "gotify":
            return send_via_gotify(config, test_title, test_message)
        elif provider == "pushover":
            return send_via_pushover(config, test_title, test_message)
        elif provider == "webhook":
            return send_via_webhook(config, test_title, test_message)
        else:
            return False
    except Exception as e:
        print(f"[notify] Test failed: {e}")
        return False


# =============================================================================
# Rule Evaluation
# =============================================================================

def get_known_macs_from_db():
    """
    Get set of all known MAC addresses from the database.
    Used by evaluate_rules() for new_device trigger type detection.
    Returns empty set on error (safe fallback).
    """
    try:
        from .database import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT mac FROM traffic")
        rows = cursor.fetchall()
        conn.close()
        return set(row[0] for row in rows if row[0])
    except Exception as e:
        print(f"[notify] Error getting known MACs: {e}")
        return set()


def load_period_devices(period_type):
    """
    Load devices data from the appropriate JSON file based on period type.
    Aggregated period files contain the full period's device data.
    Returns a list of device dicts with dl_bytes, ul_bytes, total_bytes, name, mac.
    """
    try:
        if period_type == "daily":
            # Caller should pass daily devices_data directly
            return None
        
        period_file = None
        if period_type == "weekly":
            period_file = os.path.join(Config.PERIOD_DIR, "traffic_period_last-7-days.json")
        elif period_type == "monthly":
            period_file = os.path.join(Config.PERIOD_DIR, "traffic_period_current_month.json")
        else:
            return None
        
        if not period_file or not os.path.exists(period_file):
            return None
        
        with open(period_file, 'r') as f:
            data = json.load(f)
            return data.get('devices', [])
    except Exception as e:
        print(f"[notify] Error loading period devices for {period_type}: {e}")
        return None


def evaluate_rules(devices_data, known_macs=None):
    """
    Evaluate all active rules against current device data.
    Called from run_traffic_monitor() or create_daily_rollup().
    
    Args:
        devices_data: List of device dicts with dl_bytes, ul_bytes, total_bytes, topApps, etc.
        known_macs: Set of known MAC addresses (for new_device detection)
    
    Returns:
        Number of notifications sent
    """
    rules = load_rules()
    active_rules = [r for r in rules if r.get("active", False)]
    
    if not active_rules:
        return 0
    
    notifications_sent = 0
    
    # Pre-load all data once (avoid repeated file I/O)
    topics = load_topics()
    config = load_notification_config()
    
    for rule in active_rules:
        trigger_type = rule.get("trigger_type")
        period_type = rule.get("period", "daily")
        alert_target = rule.get("alert_target", ["default"])  # Default to ["default"] if not set
        
        # Resolve alert targets (use pre-loaded config)
        resolved_targets = resolve_alert_targets(alert_target, topics, config)
        if not resolved_targets:
            print(f"[notify] No valid targets for rule {rule.get('id')}, skipping")
            continue
        
        # Determine which devices_data to use based on rule period
        if period_type == "daily":
            rule_devices_data = devices_data
        else:
            # Load period-appropriate data
            period_devices = load_period_devices(period_type)
            rule_devices_data = period_devices if period_devices else devices_data
        
        target_devices = rule.get("devices", [])
        
        # Aggregate mode: empty devices = Dashboard Total
        if not target_devices:
            notifications_sent += _evaluate_aggregate_rule(rule, rule_devices_data, trigger_type, period_type, resolved_targets, config)
            continue
        
        # Per-device mode: evaluate each selected device
        if trigger_type == "new_device":
            # Handle new device detection (uses passed devices_data and known_macs)
            if known_macs:
                for device in devices_data:
                    mac = device.get("mac", "")
                    if mac and mac not in known_macs:
                        if check_and_update_dedup(rule["id"], mac):
                            target_names = [t[0] for t in resolved_targets]
                            message = format_message(
                                rule["message_template"], rule["id"], rule["name"],
                                target_names, [mac],
                                mac_address=mac,
                                device_name=device.get("name", "Unknown"),
                                trigger_type=trigger_type,
                                period=period_type
                            )
                            if message is None:
                                continue
                            for target_name, target_id in resolved_targets:
                                success, error = send_notification(rule["name"], message, target_identifier=target_id, config=config)
                                # Log to history once per rule/device, including all targets
                                save_history_entry({
                                    "id": f"hist_{int(time.time())}_{rule['id']}",
                                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                    "type": "rule",
                                    "rule_id": rule["id"],
                                    "rule_name": rule["name"],
                                    "targets": target_names,
                                    "target_macs": [mac],
                                    "message": message,
                                    "status": "sent" if success else "failed"
                                })
                                if success:
                                    notifications_sent += 1
        
        elif trigger_type in ["download", "upload", "total"]:
            # Handle threshold-based rules
            threshold_gb = rule.get("threshold_gb", 0)
            threshold_bytes = threshold_gb * 1073741824  # GB to bytes
            
            for device in rule_devices_data:
                mac = device.get("mac", "")
                if not mac:
                    continue

                # Skip if not in target list (case-insensitive MAC comparison)
                mac_upper = mac.upper()
                if not any(mac_upper == d.upper() for d in target_devices):
                    continue

                # Get the relevant value
                if trigger_type == "download":
                    value = device.get("dl_bytes", 0)
                elif trigger_type == "upload":
                    value = device.get("ul_bytes", 0)
                else:  # total
                    value = device.get("total_bytes", 0)
                
                if value >= threshold_bytes:
                    if check_and_update_dedup(rule["id"], mac):
                        used_gb = value / 1073741824
                        target_names = [t[0] for t in resolved_targets]
                        message = format_message(
                            rule["message_template"], rule["id"], rule["name"],
                            target_names, [mac],
                            device_name=device.get("name", "Unknown"),
                            trigger_type=trigger_type,
                            threshold=threshold_gb,
                            used_gb=round(used_gb, 2),
                            period=period_type
                        )
                        if message is None:
                            continue
                        for target_name, target_id in resolved_targets:
                            success, error = send_notification(rule["name"], message, target_identifier=target_id, config=config)
                            # Log to history once per rule/device, including all targets
                            save_history_entry({
                                "id": f"hist_{int(time.time())}_{rule['id']}",
                                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                "type": "rule",
                                "rule_id": rule["id"],
                                "rule_name": rule["name"],
                                "targets": target_names,
                                "target_macs": [mac],
                                "message": message,
                                "status": "sent" if success else "failed"
                            })
                            if success:
                                notifications_sent += 1
        
        elif trigger_type == "specific_app":
            # Handle specific app exceeds threshold
            threshold_gb = rule.get("threshold_gb", 0)
            threshold_bytes = threshold_gb * 1073741824
            trigger_app = rule.get("trigger_app", "")
            
            for device in rule_devices_data:
                mac = device.get("mac", "")
                
                # Case-insensitive MAC comparison
                mac_upper = mac.upper()
                if not any(mac_upper == d.upper() for d in target_devices):
                    continue
                
                top_apps = device.get("topApps", [])
                
                for app in top_apps:
                    app_name = rename_app(app.get("name", ""))
                    if app_name == trigger_app:
                        app_bytes = app.get("total_bytes", 0)
                        if app_bytes >= threshold_bytes:
                            if check_and_update_dedup(rule["id"], f"{mac}:{trigger_app}"):
                                used_gb = app_bytes / 1073741824
                                target_names = [t[0] for t in resolved_targets]
                                message = format_message(
                                    rule["message_template"], rule["id"], rule["name"],
                                    target_names, [mac],
                                    device_name=device.get("name", "Unknown"),
                                    app_name=trigger_app,
                                    threshold=threshold_gb,
                                    used_gb=round(used_gb, 2),
                                    trigger_type=trigger_type,
                                    period=period_type
                                )
                                if message is None:
                                    continue
                                for target_name, target_id in resolved_targets:
                                    success, error = send_notification(rule["name"], message, target_identifier=target_id, config=config)
                                    # Log to history once per rule/device, including all targets
                                    save_history_entry({
                                        "id": f"hist_{int(time.time())}_{rule['id']}",
                                        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                        "type": "rule",
                                        "rule_id": rule["id"],
                                        "rule_name": rule["name"],
                                        "targets": target_names,
                                        "target_macs": [mac],
                                        "message": message,
                                        "status": "sent" if success else "failed"
                                    })
                                    if success:
                                        notifications_sent += 1
                        break
        
        elif trigger_type == "any_app_exceeds":
            # Handle any app exceeds threshold
            threshold_gb = rule.get("threshold_gb", 0)
            threshold_bytes = threshold_gb * 1073741824
            
            for device in rule_devices_data:
                mac = device.get("mac", "")
                
                # Case-insensitive MAC comparison
                mac_upper = mac.upper()
                if not any(mac_upper == d.upper() for d in target_devices):
                    continue
                
                top_apps = device.get("topApps", [])
                
                for app in top_apps:
                    app_bytes = app.get("total_bytes", 0)
                    if app_bytes >= threshold_bytes:
                        if check_and_update_dedup(rule["id"], f"{mac}:{app.get('name', 'unknown')}"):
                            used_gb = app_bytes / 1073741824
                            target_names = [t[0] for t in resolved_targets]
                            message = format_message(
                                rule["message_template"], rule["id"], rule["name"],
                                target_names, [mac],
                                device_name=device.get("name", "Unknown"),
                                app_name=app.get("name", "Unknown"),
                                threshold=threshold_gb,
                                used_gb=round(used_gb, 2),
                                trigger_type=trigger_type,
                                period=period_type
                            )
                            if message is None:
                                continue
                            for target_name, target_id in resolved_targets:
                                success, error = send_notification(rule["name"], message, target_identifier=target_id, config=config)
                                # Log to history once per rule/device, including all targets
                                save_history_entry({
                                    "id": f"hist_{int(time.time())}_{rule['id']}",
                                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                    "type": "rule",
                                    "rule_id": rule["id"],
                                    "rule_name": rule["name"],
                                    "targets": target_names,
                                    "target_macs": [mac],
                                    "message": message,
                                    "status": "sent" if success else "failed"
                                })
                                if success:
                                    notifications_sent += 1
        
        elif trigger_type == "avg_daily":
            # Handle avg daily traffic exceeds threshold
            threshold_gb = rule.get("threshold_gb", 0)
            
            for device in rule_devices_data:
                mac = device.get("mac", "")
                
                # Case-insensitive MAC comparison
                mac_upper = mac.upper()
                if not any(mac_upper == d.upper() for d in target_devices):
                    continue
                
                avg_daily = device.get("avg_daily_gb", 0)
                # On-the-fly fallback if avg_daily_gb is missing from period data
                if avg_daily == 0 and device.get("total_bytes", 0) > 0:
                    avg_daily = device.get("total_bytes", 0) / 1073741824
                
                if avg_daily >= threshold_gb:
                    if check_and_update_dedup(rule["id"], mac):
                        target_names = [t[0] for t in resolved_targets]
                        message = format_message(
                            rule["message_template"], rule["id"], rule["name"],
                            target_names, [mac],
                            device_name=device.get("name", "Unknown"),
                            threshold=threshold_gb,
                            used_gb=round(avg_daily, 2),
                            avg_daily_gb=round(avg_daily, 2),
                            trigger_type=trigger_type,
                            period=period_type
                        )
                        if message is None:
                            continue
                        for target_name, target_id in resolved_targets:
                            success, error = send_notification(rule["name"], message, target_identifier=target_id, config=config)
                            # Log to history once per rule/device, including all targets
                            save_history_entry({
                                "id": f"hist_{int(time.time())}_{rule['id']}",
                                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                "type": "rule",
                                "rule_id": rule["id"],
                                "rule_name": rule["name"],
                                "targets": target_names,
                                "target_macs": [mac],
                                "message": message,
                                "status": "sent" if success else "failed"
                            })
                            if success:
                                notifications_sent += 1
    
    return notifications_sent

def _evaluate_aggregate_rule(rule, devices_data, trigger_type, period_type, resolved_targets, config=None):
    """
    Evaluate aggregate (Dashboard Total) rule - sum all devices' traffic.
    Sends ONE notification for the total, with top contributing devices.
    """
    if config is None:
        config = load_notification_config()
    threshold_gb = rule.get("threshold_gb", 0)
    threshold_bytes = threshold_gb * 1073741824
    target_names = [t[0] for t in resolved_targets]
    
    # ---------------------------------------------------------------
    # any_app_exceeds: combine all devices' topApps, find worst offender
    # ---------------------------------------------------------------
    if trigger_type == "any_app_exceeds":
        combined_apps = {}
        for device in devices_data:
            for app in device.get("topApps", []):
                name = app.get("name", "")
                if name:
                    combined_apps[name] = combined_apps.get(name, 0) + app.get("total_bytes", 0)
        
        # Find the app that exceeds threshold by the largest margin
        top_app_name = None
        top_app_bytes = 0
        for name, bytes_val in combined_apps.items():
            if bytes_val >= threshold_bytes and bytes_val > top_app_bytes:
                top_app_name = name
                top_app_bytes = bytes_val
        
        if not top_app_name:
            return 0
        
        # Get top 3 devices contributing to this app
        device_contrib = {}
        for device in devices_data:
            for app in device.get("topApps", []):
                if app.get("name", "") == top_app_name:
                    dev_name = device.get("name", "Unknown")
                    device_contrib[dev_name] = device_contrib.get(dev_name, 0) + app.get("total_bytes", 0)
        
        total_for_app = top_app_bytes
        top_3_str = ", ".join(
            f"{name} ({b / 1e9:.1f}GB — {b / total_for_app * 100:.0f}%)"
            for name, b in sorted(device_contrib.items(), key=lambda x: x[1], reverse=True)[:3]
        )
        
        # Dedup (rule-level, not per-device)
        if not check_and_update_dedup(rule["id"], "aggregate"):
            return 0
        
        used_gb = top_app_bytes / 1073741824
        message = format_message(
            rule["message_template"], rule["id"], rule["name"],
            target_names, [],
            app_name=top_app_name,
            used_gb=round(used_gb, 2),
            top_3_devices=top_3_str,
            threshold=threshold_gb,
            period=period_type,
            trigger_type=trigger_type
        )
        if message is None:
            return 0
        
        notifications_sent = 0
        for target_name, target_id in resolved_targets:
            success, error = send_notification(rule["name"], message, target_identifier=target_id, config=config)
            save_history_entry({
                "id": f"hist_{int(time.time())}_{rule['id']}",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "type": "rule",
                "rule_id": rule["id"],
                "rule_name": rule["name"],
                "targets": target_names,
                "target_macs": [],
                "message": message,
                "status": "sent" if success else "failed"
            })
            if success:
                notifications_sent += 1
        
        return 1 if notifications_sent > 0 else 0
    
    # ---------------------------------------------------------------
    # specific_app: sum a specific app's bytes across all devices
    # ---------------------------------------------------------------
    if trigger_type == "specific_app":
        trigger_app = rule.get("trigger_app", "")
        if not trigger_app:
            return 0
        total_app_bytes = 0
        for device in devices_data:
            for app in device.get("topApps", []):
                if rename_app(app.get("name", "")) == trigger_app:
                    total_app_bytes += app.get("total_bytes", 0)
        if total_app_bytes < threshold_bytes:
            return 0
        if not check_and_update_dedup(rule["id"], "aggregate"):
            return 0
        used_gb = total_app_bytes / 1073741824
        # Get top 3 devices for this app
        device_contrib = {}
        for device in devices_data:
            for app in device.get("topApps", []):
                if rename_app(app.get("name", "")) == trigger_app:
                    dev_name = device.get("name", "Unknown")
                    device_contrib[dev_name] = device_contrib.get(dev_name, 0) + app.get("total_bytes", 0)
        top_3_str = ", ".join(
            f"{name} ({b / 1e9:.1f}GB — {b / total_app_bytes * 100:.0f}%)"
            for name, b in sorted(device_contrib.items(), key=lambda x: x[1], reverse=True)[:3]
        )
        message = format_message(
            rule["message_template"], rule["id"], rule["name"],
            target_names, [],
            app_name=trigger_app,
            used_gb=round(used_gb, 2),
            top_3_devices=top_3_str,
            threshold=threshold_gb,
            period=period_type,
            trigger_type=trigger_type
        )
        if message is None:
            return 0
        notifications_sent = 0
        for target_name, target_id in resolved_targets:
            success, error = send_notification(rule["name"], message, target_identifier=target_id, config=config)
            save_history_entry({
                "id": f"hist_{int(time.time())}_{rule['id']}",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "type": "rule",
                "rule_id": rule["id"],
                "rule_name": rule["name"],
                "targets": target_names,
                "target_macs": [],
                "message": message,
                "status": "sent" if success else "failed"
            })
            if success:
                notifications_sent += 1
        return 1 if notifications_sent > 0 else 0
    
    # ---------------------------------------------------------------
    # download / upload / total / avg_daily: sum devices, compare total
    # ---------------------------------------------------------------
    
    # Calculate total across all devices
    total_bytes = 0
    for device in devices_data:
        if trigger_type == "download":
            total_bytes += device.get("dl_bytes", 0)
        elif trigger_type == "upload":
            total_bytes += device.get("ul_bytes", 0)
        elif trigger_type == "total":
            total_bytes += device.get("total_bytes", 0)
        elif trigger_type == "avg_daily":
            total_bytes += device.get("total_bytes", 0)
        else:
            # Aggregate mode only supports download/upload/total/avg_daily/any_app_exceeds/specific_app
            return 0
    
    if trigger_type == "avg_daily":
        # Total daily average (Dashboard Total) = all devices' total / days / GB
        days_in_period = 1
        if period_type == "weekly":
            days_in_period = 7
        elif period_type == "monthly":
            days_in_period = datetime.now().day  # days from 1st to today
        avg_daily_gb = total_bytes / 1073741824 / days_in_period
        if avg_daily_gb < threshold_gb:
            return 0
    elif total_bytes < threshold_bytes:
        return 0
    
    # Get top 3 devices by traffic for the message
    top_3_devices_sorted = sorted(
        [d for d in devices_data if d.get("mac")],
        key=lambda d: d.get("dl_bytes" if trigger_type == "download" else
                       "ul_bytes" if trigger_type == "upload" else "total_bytes", 0),
        reverse=True
    )[:3]
    
    top_3_devices_str = ", ".join(
        f"{d.get('name', 'Unknown')} ({d.get('dl_bytes' if trigger_type == 'download' else 'ul_bytes' if trigger_type == 'upload' else 'total_bytes', 0) / 1e9:.1f}GB — {d.get('dl_bytes' if trigger_type == 'download' else 'ul_bytes' if trigger_type == 'upload' else 'total_bytes', 0) / total_bytes * 100:.0f}%)"
        for d in top_3_devices_sorted
    )
    
    # Check dedup (rule-level, not per-device)
    if not check_and_update_dedup(rule["id"], "aggregate"):
        return 0
    
    total_gb = avg_daily_gb if trigger_type == "avg_daily" else total_bytes / 1073741824
    message = format_message(
        rule["message_template"], rule["id"], rule["name"],
        target_names, [],
        total_gb=round(total_gb, 2),
        avg_daily_gb=round(avg_daily_gb, 2),
        top_3_devices=top_3_devices_str,
        threshold=threshold_gb,
        period=period_type,
        trigger_type=trigger_type
    )
    if message is None:
        return 0
    
    notifications_sent = 0
    for target_name, target_id in resolved_targets:
        success, error = send_notification(rule["name"], message, target_identifier=target_id, config=config)
        # Log to history once per rule, including all targets
        save_history_entry({
            "id": f"hist_{int(time.time())}_{rule['id']}",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "type": "rule",
            "rule_id": rule["id"],
            "rule_name": rule["name"],
            "targets": target_names,
            "target_macs": [],
            "message": message,
            "status": "sent" if success else "failed"
        })
        if success:
            notifications_sent += 1
    
    return 1 if notifications_sent > 0 else 0
