#!/usr/bin/env python3
"""
Superman-Tacking v2.1 - Main Application Entry Point

This is the main entry point for the Superman-Tacking application.
It has been refactored to use modular components from the system package.

The bulk of the application logic has been moved to:
- system/config.py      (Configuration management)
- system/database.py    (Database operations)
- system/utils.py       (Utility functions)
- system/reports.py     (Data processing and reporting)
- system/api.py         (Web API endpoints)
- system/cli.py         (Command-line interface)

This file now serves as a coordinator that imports and initializes the modular components.
"""

import os
import sys
from datetime import datetime, timedelta

# Import modular components
from system.config import Config
from system.database import init_db, sync_data_from_router
from system.cli import main

# Ensure directories exist
Config.ensure_dirs()

# Initialize database
init_db()

# Run main application
if __name__ == '__main__':
    main()