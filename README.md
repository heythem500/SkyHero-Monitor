# SkyHero-Monitor
 SkyHero v2.1 — Bandwidth &amp; Quota Analytics for ASUS Routers running ASUSWRT-Merlin (Unofficial) built on a modern Python foundation.
 
This project is an example of collaboration between a human and AI — a small experiment built with curiosity and code.
<p align="center">
  <img src="https://github.com/heythem500/SkyHero-Monitor/blob/main/screnshots/skyhero-img01.jpg">
  </p>

# About 

SkyHero is a lightweight analytics suite built for **ASUS routers running ASUSWRT-Merlin firmware**.  

It provides clear insights into bandwidth usage, device quotas, and traffic behavior — all from your router, without cloud dependencies.

Built on a **modern Python foundation**, SkyHero v2.1 runs locally, processes data efficiently, and displays results in an easy-to-read format.

---

## ✳️ Main Features

- Real-time bandwidth tracking  
- Daily, weekly, and monthly usage reports  
- Per-device analytics and quota alerts  
- Lightweight web interface with responsive design  
- Zero cloud reliance — all data stays on your router  
- Simple installation and maintenance

---

## 🧩 Requirements

SkyHero is designed to be user friendly just cosnider that you have:
- ASUS router with **ASUSWRT-Merlin** firmware
- JFFS custom scripts and configs Enabled from system settings
- **USB drive** mounted (e.g. `/tmp/mnt/usb-name`) change **usb-name**
- **Entware** installed and running "it's merlin realtd, use **amtm** ssh command to install it"
- **Python components** (installed via install sh automaticaly)

### Compatibility

**Tested on:**
- RT-AX58U v2  
(Other Merlin-compatible models should also work.)

---
### Installation

## 🌐 Installation — Online (the easy way)
(remember to change USB label name.)
```bash
cd /tmp/mnt/USB-NAME
curl -L https://github.com/heythem500/SkyHero-Monitor/archive/main.zip -o skyhero.zip
unzip skyhero.zip
mv SkyHero-Monitor-main skyhero-v2 # Rename the directory to your preferred name
rm skyhero.zip  # Clean up the ZIP file
cd skyhero-v2
./install.sh
```

once installation completes, you'll see a success message.  
press Enter to open the main management menu.

you can access menu CLi manager anytime by typing:
skyhero   or   skyhero2

## ⚙️ Installation — Manual Mode

For manual installation, copy the package to your router’s USB drive.

### Steps

```bash
# 1. Make the installer executable
chmod +x /tmp/mnt/usb-name/skyhero-v2/install.sh

# 2. Run the installer
/tmp/mnt/usb-name/skyhero-v2/install.sh
```

---

## 🖼️ Screenshots

*( Dashboard overview, Bandwidth charts  , Device quota summary )*
<p align="center">
  <img src="https://github.com/heythem500/SkyHero-Monitor/blob/main/screnshots/skyhero-img02.jpg" width="30%" height="auto">
  <img src="https://github.com/heythem500/SkyHero-Monitor/blob/main/screnshots/skyhero-img03.jpg" width="30%" height="auto">
  <img src="https://github.com/heythem500/SkyHero-Monitor/blob/main/screnshots/skyhero-img04.jpg" width="30%" height="auto">
  </p>
  
  ---

## data location and safety

your data is stored inside the "data" folder on the USB drive.  
it includes:

- traffic.db → main database file that stores long-term usage records  
- json backups → generated automatically for archive and restore
- you have menu cli to backup , also for manual backup, simply copy the "data" folder to your computer.  

---

⭐ rate my repo
Give a ⭐ if this project deserve populrity!

💖 If you find SkyHero useful and valuable to you, and would like to support the effort!
[Buy Me a Coffee](https://buymeacoffee.com/heythem500)
