// main.js - Main application entry point and coordination
// MIGRATION STATUS: PHASE 6

/*
  Related: All other modules → coordinates their interactions
  Used by: FEATURE - Dashboard Application
  MIGRATION STATUS: PHASE 6
*/

// Helper function to convert bytes to GB
function bytes_to_gb(bytes) {
    return bytes / 1073741824;
}

// Import modular functions
import { formatBytes } from './utils.js';
import { fetchData, pollForReport } from './api.js';
import { translate, applyTranslations } from './i18n.js';
import { signalContentReady } from './settings.js';
import { renderTable, renderDeviceCards, initializeTooltips } from './components.js';
import {
    showDeviceCardModal,
    closeDeviceCardModal,
    showDailyBreakdownModal,
    closeDailyBreakdownModal,
    confirmDailyBreakdown,
    closeHistoryModal,
    viewRestoreHistory,
    initDeviceVsOthersChart
} from './modals.js';
import { renderCharts } from './charts.js';
import { checkAuth, attachLoginFormListeners } from './auth.js';
import {
    setEditMode,
    handleSelectionChange,
    updateGroupingUI,
    toggleGroupChart,
    syncCheckboxes,
    renderSavedGroups,
    saveGroup,
    resetGroupingUI,
    getSelectedDevices,
    updateSelectedDevicesWithNewData,
    toggleDeviceSelection,
    takeScreenshot
} from './grouping.js';
import { attachEventListeners, updateCurrentDevices, updateSavedGroups } from './events.js'; // Import the new events module

// Export functions needed by events.js
export {
    applyFilter,
    applyMultiMonthFilter,
    loadMonthData,
    updateMonthNavigator,
    sortTable,
    filterContent,
    showLoader,
    updateMainStats,
    initMonthNavigator,
    clearMultiMonthSelection,
    renderSelectedMonthsPills,
    updateSelectMonthsBadge
};

// Export getter and setter functions for month navigator variables
export function getAvailableMonths() {
    return availableMonths;
}

export function getCurrentMonthIndex() {
    return currentMonthIndex;
}

export function setCurrentMonthIndex(index) {
    currentMonthIndex = index;
}

// ── Multi-Month Filter: getters/setters for selectedMonths ──
export function getSelectedMonths() {
    return selectedMonths;
}

export function setSelectedMonths(months) {
    selectedMonths = months;
}

// Export getter function for currentSort
export function getCurrentSort() {
    return currentSort;
}

// ── Global Variables ──
let currentDevices = [];
let currentSort = { column: 4, ascending: false };
let availableMonths = [];
let currentMonthIndex = -1;
let sevenDayDataGlobal = null;
let currentDisplayStartDate = '';
let currentDisplayEndDate = '';
let routerTodayFormatted = '';
let currentFilterType;
let currentStats;
let savedGroups = [];
let selectedMonths = [];

// Expose applyFilter globally for settings.js
window.applyFilter = applyFilter;

/**
 * Initialize router date from last-7-days data
 * (Last 7 Days is regenerated every 5 min and never skipped,
 * so its last label is always the router's current date.
 * This replaced the All-Time dependency after Fix (1) caused
 * stale-date issues when All-Time was smart-skipped.)
 */
async function initializeRouterDate() {
    const sevenDayData = await fetchData('traffic_period_last-7-days.json');
    if (sevenDayData && sevenDayData.barChart && sevenDayData.barChart.labels && sevenDayData.barChart.labels.length > 0) {
        routerTodayFormatted = sevenDayData.barChart.labels[sevenDayData.barChart.labels.length - 1];
    } else {
        // Fallback to client date if last-7-days data is not available or empty
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        routerTodayFormatted = `${yyyy}-${mm}-${dd}`;
        console.warn("Could not determine router's date from last-7-days report. Falling back to client date.");
    }
}

/**
 * Check restore status and show warning if needed
 */
function checkRestoreStatus() {
    fetch('/data/last_restore.txt')
        .then(response => {
            if (!response.ok) { throw new Error('No restore file'); }
            return response.text();
        })
        .then(text => {
            if (text.trim()) {
                const [detected, restored, backup] = text.trim().split('|');
                const message = `⚠️ Database corruption detected at ${detected}, restored at ${restored} from ${backup}`;

                document.getElementById('restore-message').textContent = message;
                document.getElementById('restore-warning').style.display = 'flex';
            }
        })
        .catch(() => {
            // This is normal operation, do nothing if the file doesn't exist
        });
}

/**
 * Update quota display based on stats
 * @param {Object} stats_bytes - Statistics object with byte values
 * @param {string} filterType - Type of filter applied
 */
function updateQuotaDisplay(stats_bytes, filterType) {
    const quotaCard = document.querySelector('.quota-card');

    if (!quotaCard) {
        return; // Exit if the card element doesn't exist
    }

    // If filter is 'all_time' or 'multi_month', hide the entire card
    // Multi-month spans different quota types across different periods — no meaningful combined quota
    if (filterType === 'all_time' || filterType === 'multi_month') {
        quotaCard.style.display = 'none';
        return;
    }

    // Otherwise, ensure the card is visible and proceed with the normal logic.
    quotaCard.style.display = 'block';

    const quotaHeader = document.querySelector('.quota-card h3'); // Get the header element
    const quotaUsedElement = document.getElementById('quotaUsed');
    const quotaTotalElement = document.getElementById('quotaTotal');
    const quotaProgressBar = document.getElementById('quotaProgressBar');
    const quotaMessageElement = document.getElementById('quotaMessage');

    // Check for new quota format (quotaGB + quotaType) or fallback to old format (monthlyQuotaGB)
    let quotaValue, quotaType;
    if (stats_bytes.quotaGB !== undefined) {
        quotaValue = stats_bytes.quotaGB;
        quotaType = stats_bytes.quotaType || 'monthly';
    } else if (stats_bytes.monthlyQuotaGB !== undefined) {
        quotaValue = stats_bytes.monthlyQuotaGB;
        quotaType = 'monthly'; // Default to monthly for old format
    } else {
        // Hide quota card if no quota data is available for other views
        quotaCard.style.display = 'none';
        return;
    }

    const totalTrafficGB = stats_bytes.total_bytes / 1073741824; // Convert bytes to GB
    const percentageUsed = (totalTrafficGB / quotaValue) * 100;

    // Update header text based on quota type
    const typeText = quotaType.charAt(0).toUpperCase() + quotaType.slice(1);
    const quotaKey = `${typeText} Quota Usage`;
    if (quotaHeader) {
        quotaHeader.innerHTML = `${translate(quotaKey)}: <span id="quotaUsed">${totalTrafficGB.toFixed(1)} GB</span> / <span id="quotaTotal">${quotaValue.toFixed(0)} GB</span>`;
    }

    // Update progress bar width and percentage text
    quotaProgressBar.style.width = `${Math.min(100, percentageUsed).toFixed(2)}%`;
    document.getElementById('quotaPercentage').textContent = `${percentageUsed.toFixed(0)}%`;

    // Set progress bar color
    if (percentageUsed < 50) {
        quotaProgressBar.className = 'progress-bar progress-green';
    } else if (percentageUsed < 60) {
        quotaProgressBar.className = 'progress-bar progress-yellow';
    } else if (percentageUsed < 75) {
        quotaProgressBar.className = 'progress-bar progress-orange';
    } else {
        quotaProgressBar.className = 'progress-bar progress-red';
    }

    // Set context-aware warning message
    let message = '';
    if (percentageUsed >= 85) {
        if (quotaType === 'daily') {
            message = translate('Warning: You are near or have exceeded your daily quota!');
        } else if (quotaType === 'weekly') {
            message = translate('Warning: You are near or have exceeded your weekly quota!');
        } else {
            message = translate('Warning: You are near or have exceeded your monthly quota!');
        }
    } else if (percentageUsed >= 55) {
        // Special logic for weekly and monthly quotas
        // Provide specific messages for high usage in daily quotas as well
        if (quotaType === 'weekly') {
            const today = new Date();
            const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
            if (dayOfWeek <= 1) { // Early in week (Sunday or Monday)
                message = translate('Red Flag: High usage early in the week!');
            } else {
                message = translate('High usage this week.');
            }
        } else if (quotaType === 'monthly') {
            const today = new Date();
            const dayOfMonth = today.getDate();
            if (dayOfMonth <= 7) { // Early in month (first 7 days)
                message = translate('Red Flag: High usage early in the month!');
            } else {
                message = translate('High usage this month.');
            }
        } else {
            // Default message for other quota types (e.g., daily) if in the 55%+ range
            // This fixes the issue where daily quotas between 55%-85% showed "well within limits"
            // Provide a more natural sounding message for daily quotas
            if (quotaType === 'daily') {
                message = translate('High usage for this day.');
            } else {
                // For any other potential quota types, use a generic message
                message = `High usage for this ${quotaType}.`;
            }
        }
    } else {
        message = translate('Usage is well within limits.');
    }
    quotaMessageElement.textContent = message;
}

/**
 * Update main statistics display
 * @param {Object} stats - Statistics object
 * @param {string} filterType - Type of filter applied
 * @param {number} daysInPeriod - Number of days in the period
 */
function updateMainStats(stats_bytes, filterType, daysInPeriod) {
    // Store current stats for language change updates
    currentStats = stats_bytes;

    document.getElementById('totalTraffic').textContent = formatBytes(stats_bytes.total_bytes);
    document.getElementById('totalDownload').textContent = formatBytes(stats_bytes.dl_bytes);
    document.getElementById('totalUpload').textContent = formatBytes(stats_bytes.ul_bytes);
    document.getElementById('totalDevices').textContent = stats_bytes.devices_count;

    const avgDailyTrafficBox = document.getElementById('avgDailyTrafficBox');
    const avgDailyTrafficElement = document.getElementById('avgDailyTraffic');

    if (daysInPeriod > 1 || filterType === 'this_month') {
        const avgDailyTraffic = stats_bytes.total_bytes / daysInPeriod;
        avgDailyTrafficElement.textContent = formatBytes(avgDailyTraffic);
        avgDailyTrafficBox.style.display = 'block';
    } else {
        avgDailyTrafficBox.style.display = 'none';
    }

    updateQuotaDisplay(stats_bytes, filterType); // Pass filterType along
}

/**
 * Filter content based on search input
 */
function filterContent() {
    const filter = document.getElementById('deviceSearch').value.toUpperCase();
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    if (isMobile) {
        const cards = document.querySelectorAll('.device-card');
        cards.forEach(card => {
            const deviceName = card.querySelector('.device-name').textContent.toUpperCase();
            const macAddress = card.querySelector('.device-mac').textContent.toUpperCase();
            if (deviceName.indexOf(filter) > -1 || macAddress.indexOf(filter) > -1) {
                card.style.display = "";
            } else {
                card.style.display = "none";
            }
        });
    } else {
        const tr = document.getElementById('deviceTableBody').getElementsByTagName('tr');
        for (let i = 0; i < tr.length; i++) {
            tr[i].style.display = (tr[i].textContent || tr[i].innerText).toUpperCase().indexOf(filter) > -1 ? "" : "none";
        }
    }
}

/**
 * Sort table by column
 * @param {number} col - Column index to sort by
 * @param {boolean} toggle - Whether to toggle sort direction
 */
function sortTable(col, toggle = true) {
    if (toggle) {
        if (currentSort.column === col) currentSort.ascending = !currentSort.ascending;
        else currentSort.column = col;
    }

    // Updated keyMap to reflect new column order
    const keyMap = ['name', 'mac', 'dl_bytes', 'ul_bytes', 'percentage', 'total_bytes'];
    const sortKey = keyMap[col];
    if (!sortKey) return;

    currentDevices.sort((a, b) => {
        const valA = a[sortKey], valB = b[sortKey];
        const comparison = typeof valA === 'string' ? valA.localeCompare(valB) : (valA || 0) - (valB || 0);
        return currentSort.ascending ? comparison : -comparison;
    });
    document.getElementById('deviceTableBody').innerHTML = renderTable(currentDevices, handleSelectionChange);
    syncCheckboxes();
}

/**
 * Initialize the multi-month filter UI and load default month data.
 * Replaces the old month navigator (‹ Oct ›) with a "Select Months" picker.
 * Preserves the original default behavior: loads the most recent month on startup.
 */
async function initMonthNavigator() {
    console.log("initMonthNavigator called (multi-month version).");
    try {
        const response = await fetch('/get_available_months');
        availableMonths = await response.json();
        console.log("Available months fetched:", availableMonths);

        if (availableMonths.length > 0) {
            // Sort months descending (most recent first) — same as before
            availableMonths.sort((a, b) => b.localeCompare(a));

            // Check for stored default filter preference
            const validFilters = ['this_month', 'today', 'yesterday', 'last_7_days', 'all_time'];
            let defaultFilter = null;
            try {
                const raw = localStorage.getItem('settings');
                if (raw) {
                    const settings = JSON.parse(raw);
                    const profile = window.innerWidth < 768 ? 'mobile' : 'desktop';
                    const stored = settings[profile]?.defaultFilter;
                    if (stored && validFilters.includes(stored)) {
                        defaultFilter = stored;
                    }
                }
            } catch (e) { /* ignore corrupt data */ }

            if (defaultFilter && defaultFilter !== 'this_month') {
                applyFilter(defaultFilter);
                return;
            }

            // Default: select only the most recent month (matches old single-month behavior)
            selectedMonths = [availableMonths[0]];
            currentMonthIndex = 0;

            // Update the "Select Months" button badge
            updateSelectMonthsBadge();

            // Load data for the default month — identical to old behavior
            loadMonthData();
        } else {
            // No monthly data available — fallback to current month
            console.log("No available months, falling back to 'this_month'.");
            applyFilter('this_month');
        }
    } catch (error) {
        console.error('Error fetching available months:', error);
        // Fallback to 'this_month' if fetching fails
        applyFilter('this_month');
    }
}

/**
 * Update the "Select Months" button text and badge.
 * - 0 months: show "Current Month" (nothing selected → default state)
 * - 1 month = most recent available: show "Current Month"
 * - 1 month ≠ most recent: show that month's name (user manually picked a past month)
 * - 2+ months: show "Select Months" text + badge count
 */
function updateSelectMonthsBadge() {
    const btn = document.getElementById('select-months-btn');
    const badge = document.getElementById('select-months-badge');
    if (!btn || !badge) return;

    const count = selectedMonths.length;
    const countSpan = btn.querySelector('.select-months-badge');

    if (count === 0 || (count === 1 && availableMonths.length > 0 && selectedMonths[0] === availableMonths[0])) {
        // Default state — show "Current Month"
        btn.childNodes[0].textContent = translate('Current Month') + ' ';
        if (countSpan) countSpan.style.display = 'none';
    } else if (count === 1) {
        // User picked a different month — show its name
        const [y, m] = selectedMonths[0].split('-');
        const monthName = translate(monthNames[parseInt(m) - 1]);
        btn.childNodes[0].textContent = `${monthName} ${y} `;
        if (countSpan) countSpan.style.display = 'none';
    } else {
        // Multiple months
        btn.childNodes[0].textContent = translate('Select Months') + ' ';
        if (countSpan) {
            countSpan.style.display = 'inline-flex';
            countSpan.textContent = count;
        }
    }
}

/**
 * Render the selected months as removable pills in the pills bar.
 * Only shows when 2+ months are selected.
 *
 * @param {Object} [overrideDevices] - Optional devices array to use for GB calculation.
 *   Used by applyMultiMonthFilter to pass freshly merged data instead of stale window.currentDevices.
 */
function renderSelectedMonthsPills(overrideDevices) {
    const bar = document.getElementById('selected-months-bar');
    const pillsContainer = document.getElementById('selected-months-pills');
    const summary = document.getElementById('selected-months-summary');
    const quotaCard = document.querySelector('.quota-card');

    if (!bar || !pillsContainer || !summary) return;

    // Only show pills bar for multi-month (2+ months)
    if (selectedMonths.length < 2) {
        bar.style.display = 'none';
        return;
    }

    // Show the bar
    bar.style.display = 'flex';
    pillsContainer.innerHTML = '';

    // Create a pill for each selected month
    selectedMonths.forEach(monthId => {
        const [y, m] = monthId.split('-');
        const monthName = translate(monthNames[parseInt(m) - 1]);
        const pill = document.createElement('span');
        pill.className = 'month-pill';
        pill.dataset.month = monthId;
        pill.innerHTML = `${monthName} ${y} <span class="pill-remove" data-remove="${monthId}">&times;</span>`;
        pillsContainer.appendChild(pill);
    });

    // Attach remove handlers to all pill × buttons
    pillsContainer.querySelectorAll('.pill-remove').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const removeId = this.dataset.remove;
            selectedMonths = selectedMonths.filter(id => id !== removeId);
            if (selectedMonths.length === 0) {
                // No months left — fallback to current month
                bar.style.display = 'none';
                applyFilter('this_month');
            } else if (selectedMonths.length === 1) {
                // Single month — hide pills bar, reload as single month
                bar.style.display = 'none';
                updateSelectMonthsBadge();
                loadMonthData();
            } else {
                // Multiple months — reapply merged view
                updateSelectMonthsBadge();
                applyMultiMonthFilter(selectedMonths);
            }
        });
    });

    // Update summary text: "2 months · 412.8 GB"
    // Use overrideDevices if provided (fresh data), otherwise fall back to window.currentDevices
    const devices = overrideDevices || window.currentDevices || [];
    const combinedTotal = devices.reduce((s, d) => s + (d.total_bytes || 0), 0);
    const combinedGB = combinedTotal / 1073741824;

    const template = translate('{N} month(s) · {GB} GB') || '{N} month(s) · {GB} GB';
    summary.textContent = template
        .replace('{N}', selectedMonths.length)
        .replace('{GB}', combinedGB.toFixed(1));

    // Hide quota card for multi-month
    if (quotaCard) {
        quotaCard.style.display = 'none';
    }
}

/**
 * Clear multi-month selection and hide the pills bar.
 * Called when the user clicks any other quick filter (Today, Yesterday, etc.).
 */
function clearMultiMonthSelection() {
    selectedMonths = [];
    const bar = document.getElementById('selected-months-bar');
    if (bar) bar.style.display = 'none';
    updateSelectMonthsBadge();
}

// Month names array
const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

/**
 * Update month navigator display.
 * NOTE: The old month navigator DOM elements (arrows, display) have been replaced
 * by the new multi-month picker UI. This function is kept for backward compatibility
 * with loadMonthData() and the Apply handler — it now safely does nothing.
 */
function updateMonthNavigator() {
    if (currentMonthIndex === -1) return;
    // Old DOM elements removed — function retained as no-op for compatibility
}

/**
 * Load data for the currently selected single month.
 * Used on page load and when user has only 1 month selected.
 */
function loadMonthData() {
    if (currentMonthIndex === -1) return;
    const monthId = availableMonths[currentMonthIndex];
    const currentYearMonth = new Date().toISOString().slice(0, 7);

    if (monthId === currentYearMonth) {
        applyFilter('this_month');
    } else {
        applyFilter(`month_${monthId}`);
    }

    // Update pills bar — only show when 2+ months selected (multi-month view)
    if (selectedMonths.length > 1) {
        renderSelectedMonthsPills();
    } else {
        // Single month — hide pills bar entirely
        const bar = document.getElementById('selected-months-bar');
        if (bar) bar.style.display = 'none';
    }
}

/**
 * Show loader overlay
 * @param {boolean} show - Whether to show or hide the loader
 */
function showLoader(show) {
    document.getElementById('loader-overlay').style.display = show ? 'flex' : 'none';
}

/**
 * Fetch, merge, and render data for multiple selected months.
 * This is the core multi-month filter function — replaces single-month loading
 * when the user selects 2+ months via the picker panel.
 *
 * @param {string[]} monthIds - Array of month IDs like ['2025-10', '2025-09']
 */
async function applyMultiMonthFilter(monthIds) {
    console.log("applyMultiMonthFilter called with months:", monthIds);

    if (!monthIds || monthIds.length === 0) {
        // Fallback to current month if nothing selected
        console.log("No months selected, falling back to 'this_month'.");
        applyFilter('this_month');
        return;
    }

    // Single month → use existing loadMonthData() path (no merge needed)
    if (monthIds.length === 1) {
        currentMonthIndex = availableMonths.indexOf(monthIds[0]);
        if (currentMonthIndex === -1) currentMonthIndex = 0;
        updateMonthNavigator();
        loadMonthData();
        return;
    }

    // 2+ months: fetch each month's JSON in parallel, then merge client-side
    showLoader(true);
    try {
        const fetchPromises = monthIds.map(monthId => {
            const currentYearMonth = new Date().toISOString().slice(0, 7);
            // Current month uses the live-updating file; past months use archived files
            if (monthId === currentYearMonth) {
                return fetchData('traffic_period_current_month.json');
            } else {
                return fetchData(`traffic_month_${monthId}.json`);
            }
        });

        const results = await Promise.all(fetchPromises);

        // Filter out any failed fetches (null results) but proceed with what we have
        const validResults = results.filter(r => r !== null);
        if (validResults.length === 0) {
            console.error("All month fetches failed.");
            alert("Could not load data for any selected month.");
            showLoader(false);
            return;
        }

        // Warn if some months failed
        if (validResults.length < monthIds.length) {
            console.warn(`Only ${validResults.length} of ${monthIds.length} months loaded successfully.`);
        }

        // Merge data from all months into a single combined object
        const mergedData = mergeMonthData(validResults, monthIds);

        // Set filter type — 'multi_month' triggers quota hiding (same as all_time)
        currentFilterType = 'multi_month';

        // Calculate the combined date range for device modal apps API
        const sortedMonthIds = [...monthIds].sort(); // oldest first
        const [oldestYear, oldestMonth] = sortedMonthIds[0].split('-');
        const [newestYear, newestMonth] = sortedMonthIds[sortedMonthIds.length - 1].split('-');
        currentDisplayStartDate = `${oldestYear}-${oldestMonth}-01`;
        const newestLastDay = new Date(parseInt(newestYear), parseInt(newestMonth), 0).getDate();
        currentDisplayEndDate = `${newestYear}-${newestMonth}-${String(newestLastDay).padStart(2, '0')}`;

        // Clear sevenDayData — no trend for multi-month views
        sevenDayDataGlobal = null;

        // Update global state
        currentDevices = mergedData.devices;
        window.currentDevices = currentDevices;
        updateCurrentDevices(mergedData.devices);
        updateSelectedDevicesWithNewData(mergedData.devices);

        // Refresh grouping UI if devices are selected
        if (getSelectedDevices().length > 0) {
            updateGroupingUI(mergedData.devices);
            syncCheckboxes(mergedData.devices);
        }

        // Build the display title: "Period Overview: Oct 2025 + Sep 2025"
        const titleLabels = monthIds.map(id => {
            const [y, m] = id.split('-');
            return translate(monthNames[parseInt(m) - 1]) + ' ' + y;
        });
        document.getElementById('overview-title').textContent =
            `${translate('Period Overview')}: ${titleLabels.join(' + ')}`;

        // Render charts and stats (same pipeline as applyFilter)
        console.log("Merged data before rendering:", mergedData);
        const daysInPeriod = mergedData.stats_bytes.days_in_period || 1;
        updateMainStats(mergedData.stats_bytes, 'multi_month', daysInPeriod);
        renderCharts(mergedData.barChart, mergedData.devices.slice(0, 10), mergedData.topApps);

        // Render device view
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (isMobile) {
            const container = document.getElementById('device-cards-container');
            container.innerHTML = renderDeviceCards(mergedData.devices, null);
            applyTranslations();
            initializeTooltips();
        } else {
            sortTable(currentSort.column, false);
        }

        // Update the pills bar — pass fresh merged data so GB is accurate
        renderSelectedMonthsPills(mergedData.devices);

    } catch (error) {
        console.error("Error in applyMultiMonthFilter:", error);
        alert("Error loading multi-month data: " + error.message);
    } finally {
        showLoader(false);
    }
}

/**
 * Merge data from multiple month JSON files into a single combined dataset.
 * Strategy: sum numeric values, concatenate arrays, key-by-MAC for devices.
 *
 * @param {Object[]} dataResults - Array of month data objects from fetchData()
 * @param {string[]} monthIds - Corresponding month IDs (for ordering)
 * @returns {Object} Merged data object with same structure as a single month file
 */
function mergeMonthData(dataResults, monthIds) {
    // ── Merge stats_bytes (sum all numeric fields) ──
    const mergedStats = {
        dl_bytes: 0,
        ul_bytes: 0,
        total_bytes: 0,
        devices_count: 0,
        // Quota hidden for multi-month — set placeholder values
        quotaType: 'multi_month',
        quotaGB: 0,
        days_in_period: 0
    };

    // ── Merge barChart (concatenate labels + values in chronological order) ──
    // Sort results by monthId ascending so oldest month's days come first
    const sorted = dataResults
        .map((data, i) => ({ data, monthId: monthIds[i] }))
        .sort((a, b) => a.monthId.localeCompare(b.monthId));

    const mergedLabels = [];
    const mergedValuesBytes = [];

    // ── Merge devices (key by MAC, sum bytes) ──
    const deviceMap = new Map(); // MAC -> merged device object

    // ── Merge topApps (key by app name, sum total_bytes) ──
    const appMap = new Map(); // name -> { name, total_bytes }

    sorted.forEach(({ data, monthId }) => {
        if (!data) return;

        // Stats: sum numeric fields
        if (data.stats_bytes) {
            const sb = data.stats_bytes;
            mergedStats.dl_bytes += (sb.dl_bytes || 0);
            mergedStats.ul_bytes += (sb.ul_bytes || 0);
            mergedStats.total_bytes += (sb.total_bytes || 0);
            // days_in_period accumulates across months
            const daysInMonth = data.barChart?.labels?.length || 30;
            mergedStats.days_in_period += daysInMonth;
        }

        // Bar chart: concatenate labels and values (chronological order)
        if (data.barChart) {
            if (data.barChart.labels) {
                mergedLabels.push(...data.barChart.labels);
            }
            if (data.barChart.values_bytes) {
                mergedValuesBytes.push(...data.barChart.values_bytes);
            }
        }

        // Devices: key by MAC, sum bytes across months
        if (data.devices) {
            data.devices.forEach(device => {
                const mac = device.mac;
                if (deviceMap.has(mac)) {
                    // Accumulate into existing entry
                    const existing = deviceMap.get(mac);
                    existing.dl_bytes += (device.dl_bytes || 0);
                    existing.ul_bytes += (device.ul_bytes || 0);
                    existing.total_bytes += (device.total_bytes || 0);
                    // Name/MAC from most recent month (since sorted ascending,
                    // the last month processed is the most recent)
                    existing.name = device.name;
                } else {
                    // First time seeing this device — clone it
                    deviceMap.set(mac, { ...device });
                }
            });
        }

        // Top apps: key by name, sum total_bytes
        if (data.topApps) {
            data.topApps.forEach(app => {
                if (appMap.has(app.name)) {
                    appMap.get(app.name).total_bytes += (app.total_bytes || 0);
                } else {
                    appMap.set(app.name, { name: app.name, total_bytes: app.total_bytes || 0 });
                }
            });
        }
    });

    // Build merged barChart object
    const mergedBarChart = {
        labels: mergedLabels,
        values_bytes: mergedValuesBytes,
        title: translate('Combined Daily Traffic') || 'Combined Daily Traffic'
    };

    // Convert deviceMap back to array, recalculate percentages, reset period-specific metrics
    const mergedDevices = Array.from(deviceMap.values()).map(device => ({
        ...device,
        // Recalculate percentage based on combined totals
        percentage: mergedStats.total_bytes > 0
            ? (device.total_bytes / mergedStats.total_bytes) * 100
            : 0,
        // Reset period-specific metrics — meaningless for multi-month view
        trend_bytes: [],
        avg_daily_gb: 0,
        peak_day: null,
        recent_vs_avg_percent: 0
    }));

    // Sort devices by total_bytes descending (same as backend does)
    mergedDevices.sort((a, b) => (b.total_bytes || 0) - (a.total_bytes || 0));

    // Set device count in stats
    mergedStats.devices_count = mergedDevices.length;

    // Convert appMap back to array, sort by total descending, take top 15
    const mergedTopApps = Array.from(appMap.values())
        .sort((a, b) => (b.total_bytes || 0) - (a.total_bytes || 0))
        .slice(0, 15);

    return {
        stats_bytes: mergedStats,
        barChart: mergedBarChart,
        devices: mergedDevices,
        topApps: mergedTopApps
    };
}

/**
 * Apply filter to the dashboard data
 * @param {string} filterType - Type of filter to apply
 */
async function applyFilter(filterType) {
    // Add this check at the very beginning
    if (typeof filterType !== 'string') {
        console.error("Invalid filterType provided to applyFilter:", filterType);
        return;
    }
    console.log("applyFilter called with filterType:", filterType);
    
    // Set the current filter type
    currentFilterType = filterType;
    console.log('routerTodayFormatted:', routerTodayFormatted);
    let filename;
    let sevenDayData = null;

    let daysInPeriod = 0;

    // Ensure routerTodayFormatted is set before any other logic
    // (Last 7 Days is regenerated every 5 min and never skipped,
    // so its last label is always the router's current date.)
    sevenDayData = await fetchData('traffic_period_last-7-days.json');
    if (sevenDayData && sevenDayData.barChart && sevenDayData.barChart.labels && sevenDayData.barChart.labels.length > 0) {
        routerTodayFormatted = sevenDayData.barChart.labels[sevenDayData.barChart.labels.length - 1];
    } else {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        routerTodayFormatted = `${yyyy}-${mm}-${dd}`;
        console.warn("Could not determine router's date from last-7-days report. Falling back to client date.");
    }

    // Now use todayFormatted (which is the router's date) for all calculations
    const todayDate = new Date(routerTodayFormatted);
    const sevenDaysAgo = new Date(todayDate);
    sevenDaysAgo.setDate(todayDate.getDate() - 6); // Go back 6 days to include today
    const sevenDaysAgoFormatted = `${sevenDaysAgo.getFullYear()}-${String(sevenDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(sevenDaysAgo.getDate()).padStart(2, '0')}`;

    // Check if filterType is a date string (YYYY-MM-DD)
    const isDateFilter = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(filterType);
    const isMonthFilter = filterType.startsWith('month_');

    console.log("isDateFilter:", isDateFilter);
    console.log("isMonthFilter:", isMonthFilter);

    if (isDateFilter) {
        // Instead of trying to load individual period file, load daily file directly
        filename = `../daily_json/${filterType}.json`;
        daysInPeriod = 1;
        // For single-day view, fetch last 7 days data for trend display
        sevenDayData = await fetchData('traffic_period_last-7-days.json');
        sevenDayDataGlobal = sevenDayData; // Store in global variable
    } else if (isMonthFilter) {
        const month = filterType.split('_')[1];
        filename = `traffic_month_${month}.json`;
        sevenDayDataGlobal = null; // Clear global sevenDayData for month view
    } else {
        switch (filterType) {
            case 'all_time':
                filename = 'traffic_period_all-time.json';
                sevenDayDataGlobal = null; // Clear global sevenDayData for all_time view
                break;
            case 'today':
                // Fetch from daily_json directly to avoid redundant period files
                filename = `../daily_json/${routerTodayFormatted}.json`;
                daysInPeriod = 1;
                sevenDayData = await fetchData('traffic_period_last-7-days.json'); // Fetch for trend
                sevenDayDataGlobal = sevenDayData; // Store in global variable
                break;
            case 'yesterday':
                const yesterday = new Date(todayDate);
                yesterday.setDate(todayDate.getDate() - 1);
                const yesterdayFormatted = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
                // Fetch from daily_json directly to avoid redundant period files
                filename = `../daily_json/${yesterdayFormatted}.json`;
                daysInPeriod = 1;
                sevenDayData = await fetchData('traffic_period_last-7-days.json'); // Fetch for trend
                sevenDayDataGlobal = sevenDayData; // Store in global variable
                break;
            case 'last_7_days':
                filename = 'traffic_period_last-7-days.json';
                daysInPeriod = 7;
                sevenDayDataGlobal = sevenDayData; // Store in global variable
                break;
            case 'this_month':
                filename = 'traffic_period_current_month.json';
                sevenDayDataGlobal = null; // Clear global sevenDayData for this_month view
                break;
            default:
                console.error("Invalid filter type:", filterType);
                return;
        }
    }

    const data = await fetchData(filename);
    if (!data) {
        console.warn(`Data for ${filterType} (${filename}) not found.`);
        alert(`Data for ${filterType} is not available. Please ensure the daily rollup has run for this date.`);
        return;
    }
    console.log("Fetched data for filter type " + filterType + ":", data);

    // Force monthly quota display for 'this_month' filter
    if (filterType === 'this_month') {
        // Ensure stats_bytes object exists
        if (!data.stats_bytes) {
            data.stats_bytes = {};
        }
        // Set quota type to monthly
        // This overrides any quota type determined by the backend based on date range duration
        // The quotaGB value should already be provided by the backend
        data.stats_bytes.quotaType = 'monthly';
    }

    // Update global start and end dates for personalized summary
    if (isDateFilter) {
        currentDisplayStartDate = filterType;
        currentDisplayEndDate = filterType;
    } else if (isMonthFilter) {
        const [year, month] = filterType.split('_')[1].split('-');
        currentDisplayStartDate = `${year}-${month}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        currentDisplayEndDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

        const startDate = new Date(currentDisplayStartDate);
        const endDate = new Date(currentDisplayEndDate);
        daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    } else if (filterType === 'last_7_days' || filterType === 'all_time') {
        // For these filters, the date range is in the data itself
        if (data.barChart && data.barChart.labels && data.barChart.labels.length > 0) {
            currentDisplayStartDate = data.barChart.labels[0];
            currentDisplayEndDate = data.barChart.labels[data.barChart.labels.length - 1];

            const startDate = new Date(currentDisplayStartDate);
            const endDate = new Date(currentDisplayEndDate);
            daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
        }
    } else if (filterType === 'today' || filterType === 'yesterday') {
        // For today/yesterday filters using daily_json, extract the date from the filename
        if (isDateFilter) {
            currentDisplayStartDate = filterType;
            currentDisplayEndDate = filterType;
        } else {
            // Extract date from the daily_json filename format (../daily_json/YYYY-MM-DD.json or YYYY-MM-DD.json)
            const dateMatch = filename.match(/daily_json\/?(\d{4}-\d{2}-\d{2})\.json$/);
            if (dateMatch) {
                currentDisplayStartDate = dateMatch[1];
                currentDisplayEndDate = dateMatch[1];
            } else {
                // Fallback to router date for both
                currentDisplayStartDate = routerTodayFormatted;
                currentDisplayEndDate = routerTodayFormatted;
            }
        }
        daysInPeriod = 1;
    } else {
        // For quick filters like 'this_month', the filename is now traffic_period_YYYY-MM-DD-YYYY-MM-DD.json
        // Extract dates directly from the filename, assuming the new hyphenated format
        const dateParts = filename.replace('traffic_period_', '').replace('.json', '').split('-');
        if (dateParts.length === 6) { // YYYY-MM-DD-YYYY-MM-DD
            currentDisplayStartDate = `${dateParts[0]}-${dateParts[1]}-${dateParts[2]}`;
            currentDisplayEndDate = `${dateParts[3]}-${dateParts[4]}-${dateParts[5]}`;
            
            // Calculate daysInPeriod for this date range
            const startDate = new Date(currentDisplayStartDate);
            const endDate = new Date(currentDisplayEndDate);
            daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
        } else if (dateParts.length === 3) { // YYYY-MM-DD (for single day like today/yesterday) - this should be handled above now
            currentDisplayStartDate = `${dateParts[0]}-${dateParts[1]}-${dateParts[2]}`;
            currentDisplayEndDate = `${dateParts[0]}-${dateParts[1]}-${dateParts[2]}`;
        } else {
            // Only show warning for truly unexpected filename formats
            if (filename !== 'traffic_period_current_month.json') {
                console.warn("Unexpected filename format for date parsing:", filename);
            }
            // For 'this_month' filter (whether using fixed filename or not), extract dates from the data
            if (filterType === 'this_month' && data && data.barChart && data.barChart.labels && data.barChart.labels.length > 0) {
                currentDisplayStartDate = data.barChart.labels[0];
                currentDisplayEndDate = data.barChart.labels[data.barChart.labels.length - 1];
                const startDate = new Date(currentDisplayStartDate);
                const endDate = new Date(currentDisplayEndDate);
                daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
            } else {
                // Default to today for both dates
                currentDisplayStartDate = routerTodayFormatted;
                currentDisplayEndDate = routerTodayFormatted;
            }
        }
    }

    // Single-day device cards now use 30-day aggregates from backend

    document.querySelectorAll('.quick-filters button').forEach(b => b.classList.remove('active'));
    // Only activate quick filter button if it's not a specific date or month filter
    if (!isDateFilter && !isMonthFilter) {
        const activeButton = document.querySelector(`.quick-filters button[data-filter-type="${filterType}"]`);
        if (activeButton) {
            activeButton.classList.add('active');
        }
    }
    
    // Show active state for Select Months button when viewing month(s)
    const selectMonthsBtn = document.getElementById('select-months-btn');
    if (selectMonthsBtn) {
        if (isMonthFilter || filterType === 'this_month') {
            selectMonthsBtn.classList.add('active');
        } else if (selectedMonths && selectedMonths.length > 0) {
            selectMonthsBtn.classList.add('active');
        }
    }

    currentDevices = data.devices;
    window.currentDevices = currentDevices; // Make global for circle selection
    updateCurrentDevices(data.devices); // Update the currentDevices in events.js

    // Update selectedDevices with new traffic data for the current period
    updateSelectedDevicesWithNewData(data.devices);

    // Refresh grouping UI if devices are selected
    if (getSelectedDevices().length > 0) {
        updateGroupingUI(data.devices);
        syncCheckboxes(data.devices);
    }

    let displayFilter = '';
    if (isDateFilter) {
        displayFilter = filterType;
    } else if (isMonthFilter) {
        displayFilter = translate('Month:') + ' ' + filterType.split('_')[1];
    } else {
        const formatted = filterType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        displayFilter = translate(formatted) || formatted;
    }
    document.getElementById('overview-title').textContent = `${translate('Period Overview')}: ${displayFilter}`;

    console.log("Data before rendering:", data);
    updateMainStats(data.stats_bytes, filterType, daysInPeriod);
    renderCharts(data.barChart, data.devices.slice(0, 10), data.topApps);

    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) {
        const container = document.getElementById('device-cards-container');
        container.innerHTML = renderDeviceCards(data.devices, sevenDayData);
        // Apply translations to newly rendered device cards
        applyTranslations();
        // Initialize tooltips for device cards
        initializeTooltips();
    } else {
        sortTable(currentSort.column, false);
    }
}

/**
 * Initialize Palestine kid image functionality
 */
function initPalestineKid() {
    const palestineKidContainer = document.getElementById('palestineKidContainer');
    const hidePalestineKidButton = document.getElementById('hidePalestineKid');
    const countdownSpan = document.getElementById('countdownSpan');
    const keepPalestineKidButton = document.getElementById('keepPalestineKid');

    // Helper function to start bleed effect
    function startBleed() {
        const imageWrapper = document.getElementById('palestineImageWrapper');
        const drops = [];
        let dropCount = 0;
        const maxDrops = 20;
        const interval = setInterval(() => {
            if (dropCount >= maxDrops) {
                clearInterval(interval);
                return;
            }
            const drop = document.createElement('div');
            drop.className = 'blood-drop';
            drop.style.width = Math.random() * 7 + 3 + 'px';
            drop.style.height = drop.style.width;
            drop.style.left = Math.random() * 100 + '%';
            drop.style.top = Math.random() * 100 + '%';
            drop.style.animation = `bloodDrip ${Math.random() * 2 + 3}s ease-out forwards`;
            imageWrapper.appendChild(drop);
            drops.push(drop);
            dropCount++;
        }, 300); // Create a drop every 300ms

        // Clean up drops after bleed
        setTimeout(() => {
            drops.forEach(drop => drop.remove());
        }, 5000); // Adjusted to 5 seconds
    }

    // Helper function to handle slide-up animation
    function handleSlideUp() {
        // If in banner mode, preserve the banner positioning during slide-up
        if (palestineKidContainer.classList.contains('banner-mode')) {
            // Ensure the element maintains its banner position during slide-up
            palestineKidContainer.style.left = '5px';
            palestineKidContainer.style.top = '50%';
            palestineKidContainer.style.transform = 'translateY(-50%)';
            palestineKidContainer.style.position = 'fixed';
        }
        // Add hidden class for slide-up animation
        palestineKidContainer.classList.add('hidden');
        // Remove element after animation completes
        setTimeout(() => {
            palestineKidContainer.style.display = 'none';
            palestineKidContainer.classList.remove('reveal', 'banner-mode', 'hidden');
            // Reset position styles
            palestineKidContainer.style.left = '';
            palestineKidContainer.style.top = '';
            palestineKidContainer.style.transform = '';
            palestineKidContainer.style.position = '';
        }, 1500); // Increased from 500ms to 1500ms to match animation duration
    }

    if (palestineKidContainer && hidePalestineKidButton && countdownSpan && keepPalestineKidButton) {
        // Add reveal class for initial animation
        palestineKidContainer.classList.add('reveal');
        palestineKidContainer.style.display = 'block'; // Ensure it's visible when initialized
        countdownSpan.style.display = 'inline';
        keepPalestineKidButton.style.display = 'inline';

        let countdown = 30;
        countdownSpan.textContent = `(${countdown}s)`;

        if (window.countdownInterval) {
            clearInterval(window.countdownInterval);
        }

        // Transition to banner mode after 3 seconds
        setTimeout(() => {
            // Check if we're on mobile
            const isMobile = window.matchMedia('(max-width: 768px)').matches;
            
            if (isMobile) {
                // On mobile, do a subtle movement animation similar to desktop but returning to center
                palestineKidContainer.classList.add('mobile-subtle-move');
            } else {
                // On desktop, use the original banner mode transition
                // Set initial position for animation
                const rect = palestineKidContainer.getBoundingClientRect();
                const centerX = window.innerWidth / 2;
                const centerY = window.innerHeight / 2;
                
                // Apply initial position before adding banner-mode class
                palestineKidContainer.style.left = `${centerX}px`;
                palestineKidContainer.style.top = `${centerY}px`;
                palestineKidContainer.style.transform = 'translate(-50%, -50%)';
                palestineKidContainer.style.position = 'fixed';
                
                // Force reflow
                palestineKidContainer.offsetHeight;
                
                // Add banner mode class for animation
                palestineKidContainer.classList.add('banner-mode');
            }
        }, 3000);

        window.countdownInterval = setInterval(() => {
            countdown--;
            countdownSpan.textContent = `(${countdown}s)`;
            if (countdown === 4) {
                // Start bleed effect
                startBleed();
            }
            if (countdown <= 0) {
                clearInterval(window.countdownInterval);
                // Handle slide-up animation
                handleSlideUp();
            }
        }, 1000);

        hidePalestineKidButton.addEventListener('click', () => {
            clearInterval(window.countdownInterval);
            // On mobile, play subtle movement even when manually hidden
            const isMobile = window.matchMedia('(max-width: 768px)').matches;
            if (isMobile) {
                palestineKidContainer.classList.add('mobile-subtle-move');
            }
            // Start bleed effect and delay slide-up
            startBleed();
            setTimeout(() => {
                handleSlideUp();
            }, 5000);
        });

        keepPalestineKidButton.addEventListener('click', () => {
            clearInterval(window.countdownInterval);
            countdownSpan.style.display = 'none';
            // If in banner mode, remove it to return to original position
            palestineKidContainer.classList.remove('banner-mode');
            // Reset position styles after a delay to allow animation to finish
            setTimeout(() => {
                palestineKidContainer.style.left = '';
                palestineKidContainer.style.top = '';
                palestineKidContainer.style.transform = '';
                palestineKidContainer.style.position = '';
            }, 2000);
        });
    }
}

/**
 * Show device card modal from table click (global function for backward compatibility)
 * @param {string} macAddress - MAC address of the device to show
 */
function showDeviceCardModalFromTable(macAddress) {
    showDeviceCardModal(macAddress, currentDevices, sevenDayDataGlobal, currentDisplayStartDate, currentDisplayEndDate, routerTodayFormatted, currentFilterType);
}

// Make the function globally accessible
window.showDeviceCardModalFromTable = showDeviceCardModalFromTable;
window.toggleDeviceSelection = toggleDeviceSelection;
window.takeScreenshot = takeScreenshot;

// Make routerTodayFormatted, currentFilterType, currentDisplayStartDate, and currentDisplayEndDate globally accessible
Object.defineProperty(window, 'routerTodayFormatted', {
    get: function() {
        return routerTodayFormatted;
    },
    set: function(value) {
        routerTodayFormatted = value;
    }
});

Object.defineProperty(window, 'currentFilterType', {
    get: function() {
        return currentFilterType;
    },
    set: function(value) {
        currentFilterType = value;
    }
});

Object.defineProperty(window, 'currentDisplayStartDate', {
    get: function() {
        return currentDisplayStartDate;
    },
    set: function(value) {
        currentDisplayStartDate = value;
    }
});

Object.defineProperty(window, 'currentDisplayEndDate', {
    get: function() {
        return currentDisplayEndDate;
    },
    set: function(value) {
        currentDisplayEndDate = value;
    }
});

// DOM Content Loaded event listener
document.addEventListener('DOMContentLoaded', async () => {
    await initializeRouterDate(); // Call the new function here

    // --- AUTHENTICATION LOGIC ---
    await checkAuth(initMonthNavigator, applyFilter, async () => {
        initPalestineKid();
        signalContentReady();
    });
    attachLoginFormListeners(initMonthNavigator, async () => {
        initPalestineKid();
        signalContentReady();
    });

    // --- ORIGINAL PAGE SETUP LOGIC ---
    checkRestoreStatus(); // Check for restore events on page load

    const billingStartInput = document.getElementById('billingStart');
    const billingDaysSelect = document.getElementById('billingDays');
    const applyBillingFilterBtn = document.querySelector('.billing-controls .apply-btn');

    const initialData = await fetchData('traffic_period_all-time.json');
    if (initialData && initialData.barChart && initialData.barChart.labels.length > 0) {
        billingStartInput.value = initialData.barChart.labels[initialData.barChart.labels.length - 1];
    }

    // Attach event listeners
    attachEventListeners(currentDevices, getAvailableMonths, getCurrentMonthIndex, setCurrentMonthIndex, savedGroups);

    // Listen for language changes to update dynamic translations
    window.addEventListener('languageChanged', () => {
        // Update overview title with current filter
        if (currentFilterType) {
            const isDateFilter = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(currentFilterType);
            const isMonthFilter = currentFilterType.startsWith('month_');
            let displayFilter = '';
            if (isDateFilter) {
                displayFilter = currentFilterType;
            } else if (isMonthFilter) {
                displayFilter = translate('Month:') + ' ' + currentFilterType.split('_')[1];
            } else {
                const formatted = currentFilterType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                displayFilter = translate(formatted) || formatted;
            }
            document.getElementById('overview-title').textContent = `${translate('Period Overview')}: ${displayFilter}`;
        }
        // Update month navigator if visible
        if (currentMonthIndex !== -1) {
            updateMonthNavigator();
        }
        // Update the "Current Month" button text
        updateSelectMonthsBadge();
        // Update quota display if we have current stats
        if (currentStats && currentFilterType) {
            updateQuotaDisplay(currentStats, currentFilterType);
        }
    });
});
