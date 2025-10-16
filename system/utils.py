import os
import subprocess
from datetime import datetime, timedelta

def bytes_to_gb(b):
    """Converts bytes to gigabytes, rounded to 2 decimal places."""
    if b is None:
        return 0
    return round(b / 1073741824, 2)

def get_date_range(start_date_str, end_date_str):
    """Generates a list of date strings between two dates."""
    start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
    end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
    delta = end_date - start_date
    return [(start_date + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(delta.days + 1)]

def get_device_name(mac):
    """Resolves a device name from its MAC address by checking router data sources."""
    try:
        # Normalize MAC address to uppercase for comparison
        search_mac = mac.upper()
        
        # Try to get the name from the router's NVRAM custom client list
        # This is the primary source of custom device names set by the user
        nvram_cmd = "/bin/nvram"
        if not os.path.exists(nvram_cmd):
            nvram_cmd = "/usr/sbin/nvram"
            
        result = subprocess.run([nvram_cmd, 'get', 'custom_clientlist'], 
                               capture_output=True, text=True, timeout=5)
        if result.returncode == 0 and result.stdout:
            # Parse the custom client list format: <name>mac>ip>hostname>>>>> <name>mac>ip>hostname>>>>> ...
            custom_list = result.stdout.strip()
            if custom_list:
                # Split by '<' to get individual entries
                entries = custom_list.split('<')
                for entry in entries:
                    if entry:
                        # Each entry format: name>mac>ip>hostname>>>>
                        parts = entry.split('>')
                        if len(parts) >= 4:
                            name = parts[0]
                            entry_mac = parts[1]
                            # Compare MAC addresses (case insensitive)
                            if entry_mac.upper() == search_mac and name and name != "*":
                                return name
        
        # Try to get the name from the router's NVRAM dhcp_staticlist
        # This contains static DHCP reservations
        result = subprocess.run([nvram_cmd, 'get', 'dhcp_staticlist'], 
                               capture_output=True, text=True, timeout=5)
        if result.returncode == 0 and result.stdout:
            # Parse the dhcp_staticlist format: mac>ip>hostname>lease_time>>>>>
            dhcp_static_list = result.stdout.strip()
            if dhcp_static_list:
                # Split by '<' to get individual entries
                entries = dhcp_static_list.split('<')
                for entry in entries:
                    if entry:
                        # Each entry format: mac>ip>hostname>lease_time>>>>>
                        parts = entry.split('>')
                        if len(parts) >= 3:
                            entry_mac = parts[0]
                            hostname = parts[2]
                            # Compare MAC addresses (case insensitive)
                            if entry_mac.upper() == search_mac and hostname and hostname != "*":
                                return hostname
        
        # Try to get the name from the router's DHCP leases file
        # This contains dynamic DHCP assignments
        dhcp_leases_file = "/var/lib/misc/dnsmasq.leases"
        if os.path.exists(dhcp_leases_file):
            with open(dhcp_leases_file, 'r') as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) >= 4:
                        # parts[1] is MAC, parts[3] is hostname
                        if parts[1].upper() == search_mac and parts[3] and parts[3] != "*":
                            return parts[3]
        
    except (subprocess.SubprocessError, FileNotFoundError, subprocess.TimeoutExpired, IOError, OSError):
        # If any step fails, continue to the next method
        pass
    except Exception:
        # Catch any other unexpected exceptions
        pass
    
    # If we can't find a real name, return a generic name with the MAC suffix
    # This ensures we don't show fake names for real router data
    mac_suffix = mac[-5:].replace(':', '')
    return f"Device-{mac_suffix}"

def get_lan_ip():
    """Gets the router's LAN IP address from NVRAM."""
    try:
        # Command to get LAN IP from NVRAM, common on ASUS routers
        result = subprocess.run(['nvram', 'get', 'lan_ipaddr'], capture_output=True, text=True, check=True)
        lan_ip = result.stdout.strip()
        if lan_ip:
            return lan_ip
    except (subprocess.CalledProcessError, FileNotFoundError):
        # If command fails, nvram might not be available or variable is not set
        pass
    return None # Return None if not found
