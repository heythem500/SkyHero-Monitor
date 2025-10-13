// api.js - Data fetching and API interaction functions
// MIGRATION STATUS: PHASE 3

/*
  Related: main.js → calls fetchData for initial data
  Used by: FEATURE - Dashboard Data Loading
  MIGRATION STATUS: PHASE 3
*/

import { renderTopAppsList } from './components.js';

/**
 * Fetch data from the server
 * @param {string} filename - Name of the JSON file to fetch
 * @returns {Promise<Object|null>} Parsed JSON data or null if error
 */
async function fetchData(filename) {
    let path;
    // Check if this is a single-day period file (traffic_period_YYYY-MM-DD-YYYY-MM-DD.json format)
    const singleDayPattern = /^traffic_period_(\d{4}-\d{2}-\d{2})-\1\.json$/;
    if (singleDayPattern.test(filename)) {
        // For single-day period files, fetch from daily_json directory
        const date = filename.match(singleDayPattern)[1];
        path = `/data/daily_json/${date}.json`;
    } else {
        // For multi-day period files, use period_data directory
        path = `/data/period_data/${filename}`;
    }

    try {
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Could not fetch data: ", error);
        return null;
    }
}

/**
 * Fetch device apps data for a specific period
 * @param {string} macAddress - MAC address of the device
 * @param {string} currentDisplayStartDate - Start date for data display
 * @param {string} currentDisplayEndDate - End date for data display
 * @returns {Promise<void>}
 */
async function fetchAndRenderDeviceApps(macAddress, currentDisplayStartDate, currentDisplayEndDate) {
    try {
        // Use the same date range logic as the old implementation
        const currentPeriodStart = currentDisplayStartDate;
        const currentPeriodEnd = currentDisplayEndDate;

        if (!currentPeriodStart || !currentPeriodEnd) {
            renderTopAppsList([]);
            return;
        }

        const response = await fetch(`/get_device_apps?mac=${macAddress}&start=${currentPeriodStart}&end=${currentPeriodEnd}`);
        if (response.ok) {
            const appData = await response.json();
            renderTopAppsList(appData.apps || []);
        } else {
            console.error(`Failed to fetch device apps: ${response.status} ${response.statusText}`);
            renderTopAppsList([]);
        }
    } catch (error) {
        console.error('Error fetching device apps:', error);
        renderTopAppsList([]);
    }
}

/**
 * Poll for a report file to be generated
 * @param {string} filename - Name of the file to poll for
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} Parsed JSON data
 */
async function pollForReport(filename, timeout = 60000) {
    const pollInterval = 2000;
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
        const intervalId = setInterval(async () => {
            if (Date.now() - startTime > timeout) {
                clearInterval(intervalId);
                reject(new Error('Report generation timed out.'));
                return;
            }
            try {
                const response = await fetch(`/data/period_data/${filename}`);
                if (!response.ok) {
                    // If response is 404, do nothing and wait for the next poll
                    if (response.status === 404) {
                        return;
                    }
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                clearInterval(intervalId);
                resolve(await response.json());
            } catch (error) {
                // Ignore fetch errors
            }
        }, pollInterval);
    });
}

// Export functions for use in other modules
export { fetchData, fetchAndRenderDeviceApps, pollForReport };