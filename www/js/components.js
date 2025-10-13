// components.js - Component rendering functions
// MIGRATION STATUS: PHASE 3

/*
  Related: main.js → calls render functions to display data
  Used by: FEATURE - Dashboard UI Components
  MIGRATION STATUS: PHASE 3
*/

import { formatBytes, generateSparkline, renderDeviceBarChart } from './utils.js';
import { translate } from './i18n.js';

/**
 * Render device table rows
 * @param {Array<Object>} devices - Array of device objects
 * @param {Function} handleSelectionChange - Function to handle device selection (kept for compatibility but not used)
 * @returns {string} HTML string for table rows
 */
function renderTable(devices, handleSelectionChange) {
    return devices.map(d => {
        const totalVal = d.total_bytes / 1073741824; // Convert bytes to GB for comparison
        const trafficClass = totalVal > 40 ? 'traffic-high' : totalVal > 10 ? 'traffic-medium' : 'traffic-low';
        return `<tr>
                    <td><input type="checkbox" class="device-checkbox" data-mac="${d.mac}"></td>
                    <td><span style="cursor: pointer;" onclick="window.showDeviceCardModalFromTable('${d.mac}')">${d.name}</span></td>
                    <td>${d.mac}</td>
                    <td>${formatBytes(d.dl_bytes)}</td>
                    <td>${formatBytes(d.ul_bytes)}</td>
                    <td>${(d.percentage || 0).toFixed(2)}%</td>
                    <td class="${trafficClass}">${formatBytes(d.total_bytes)}</td>
                </tr>`;
    }).join('');
}

/**
 * Render device cards for mobile view
 * @param {Array<Object>} devices - Array of device objects
 * @param {Object|null} sevenDayData - Seven day data for trend visualization
 * @returns {string} HTML string for device cards
 */
function renderDeviceCards(devices, sevenDayData = null) {
    const sevenDayMap = new Map();
    if (sevenDayData && sevenDayData.devices) {
        sevenDayData.devices.forEach(d => {
            sevenDayMap.set(d.mac, d.trend_bytes || []);
        });
    }

    return devices.map(d => {
        const trendBytes = sevenDayData ? (sevenDayMap.get(d.mac) || []) : (d.trend_bytes || []);
        const totalVal = d.total_bytes / 1073741824; // Convert bytes to GB for comparison
        const trafficClass = totalVal > 40 ? 'traffic-high' : totalVal > 10 ? 'traffic-medium' : 'traffic-low';

        const recentVsAvg = d.recent_vs_avg_percent;  // Use calculated value from backend
        const alertClass = recentVsAvg > 18 ? 'alert-high' : 'alert-normal';
        const alertIcon = recentVsAvg > 18 ? '⚠️' : '✅';
        let alertMessage;

        if (recentVsAvg === 999) {
            alertMessage = `<span data-i18n="High usage:">High usage:</span> ${formatBytes(d.total_bytes)}`;
        } else if (recentVsAvg > 18) {
            alertMessage = `<span data-i18n="Recent usage is">Recent usage is</span> ${recentVsAvg.toFixed(0)}<span data-i18n="% above this period's avg">% above this period's avg</span>`;
        } else {
            alertMessage = `<span data-i18n="Usage is within normal range">Usage is within normal range</span>`;
        }

        return `
        <div class="device-card" data-mac="${d.mac}">
            <div class="card-header">
                <div>
                    <div class="device-name">${d.name || 'Unknown Device'}</div>
                    <div class="device-mac">${d.mac || ''}</div>
                </div>
                <div class="selection-circle-test" onclick="toggleDeviceSelection('${d.mac}', event)"></div>
            </div>
            <div class="card-body">
                <div class="stat-row">
                    <span data-i18n="Total Usage">Total Usage:</span>
                    <span class="${trafficClass}">${formatBytes(d.total_bytes)} (${(d.percentage || 0).toFixed(1)}%)</span>
                </div>
                <div class="stat-row">
                    <span data-i18n="Download">Download:</span>
                    <span>${formatBytes(d.dl_bytes)}</span>
                </div>
                <div class="stat-row">
                    <span data-i18n="Upload">Upload:</span>
                    <span>${formatBytes(d.ul_bytes)}</span>
                </div>
            </div>
             <div class="card-footer">
                  <div class="stat-row">
                     <div class="label-with-tooltip"><span data-i18n="Avg Daily">Avg Daily:</span><span class="tooltip-icon" data-tooltip-key="AvgDailyTooltip">${translate('tooltipIcon')}</span></div>
                     <span>${d.avg_daily_gb > 0 ? formatBytes(d.avg_daily_gb * 1073741824) : 'N/A'}</span>
                 </div>
                  <div class="stat-row">
                     <div class="label-with-tooltip"><span data-i18n="Peak Day">Peak Day:</span><span class="tooltip-icon" data-tooltip-key="PeakDayTooltip">${translate('tooltipIcon')}</span></div>
                     <span>${d.peak_day && d.peak_day.gb > 0 ? `${d.peak_day.date.slice(5)} (${formatBytes(d.peak_day.gb * 1073741824)})` : 'N/A'}</span>
                 </div>
                 <div class="trend-row">
                     <div class="label-with-tooltip"><span data-i18n="Trend">Trend:</span><span class="tooltip-icon" data-tooltip-key="TrendTooltip">${translate('tooltipIcon')}</span></div>
                     ${sevenDayData ? renderDeviceBarChart(trendBytes) : generateSparkline(trendBytes)}
                 </div>
                 <div class="alert-row ${alertClass}" data-tooltip-key="AlertTooltip">
                     ${alertIcon} ${alertMessage}
                 </div>
                <div class="percentage-bar-container">
                    <div class="percentage-bar ${trafficClass}" style="width: ${(d.percentage || 0).toFixed(1)}%;"></div>
                </div>
            </div>
            <div class="screenshot">
                <button class="screenshot-btn" onclick="takeScreenshot('${d.mac}')">📸 <span data-i18n="Take Screenshot">Take Screenshot</span></button>
            </div>
        </div>`;
    }).join('');
}

/**
 * Render top apps list in device modal
 * @param {Array<Object>} apps - Array of app objects
 * @returns {void}
 */
function renderTopAppsList(apps) {
    const topAppsListElement = document.getElementById('topAppsList');
    if (!topAppsListElement) return;

    topAppsListElement.innerHTML = ''; // Clear previous list

    if (apps && apps.length > 0) {
        apps.slice(0, 3).forEach(app => { // Display top 3 apps
            const listItem = document.createElement('li');
            listItem.innerHTML = `
                <span class="app-name" data-modal-i18n="${app.name}">${app.name}</span>
                <span class="app-usage">${formatBytes(app.total_bytes || 0)}</span>
            `;
            topAppsListElement.appendChild(listItem);
        });
    } else {
        const listItem = document.createElement('li');
        listItem.innerHTML = '<span class="app-name" data-modal-i18n="No app data available">No app data available</span><span class="app-usage">-</span>';
        topAppsListElement.appendChild(listItem);
    }

    // Dispatch event to notify translation system of new content
    const event = new CustomEvent('modalAppsRendered', {
        detail: { container: topAppsListElement }
    });
    document.dispatchEvent(event);
}

// Tooltip handling functions
let tooltipElement = null;

function showTooltip(event) {
    const icon = event.target;
    const key = icon.dataset.tooltipKey;
    const text = translate(key);

    if (!tooltipElement) {
        tooltipElement = document.createElement('div');
        tooltipElement.className = 'tooltip';
        document.body.appendChild(tooltipElement);
    }

    tooltipElement.textContent = text;

    const rect = icon.getBoundingClientRect();
    const tooltipRect = tooltipElement.getBoundingClientRect();
    let left = rect.left + window.scrollX;
    let top = rect.bottom + window.scrollY + 5;

    // Adjust if tooltip goes off screen
    if (left + tooltipRect.width > window.innerWidth) {
        left = window.innerWidth - tooltipRect.width - 10;
    }
    if (top + tooltipRect.height > window.innerHeight + window.scrollY) {
        top = rect.top + window.scrollY - tooltipRect.height - 5;
    }

    tooltipElement.style.left = `${left}px`;
    tooltipElement.style.top = `${top}px`;
    tooltipElement.classList.add('visible');
}

function hideTooltip() {
    if (tooltipElement) {
        tooltipElement.classList.remove('visible');
    }
}

function initializeTooltips() {
    document.querySelectorAll('[data-tooltip-key]').forEach(element => {
        element.addEventListener('mouseenter', showTooltip);
        element.addEventListener('mouseleave', hideTooltip);
    });
}

// Export functions for use in other modules
export { renderTable, renderDeviceCards, renderTopAppsList, initializeTooltips };