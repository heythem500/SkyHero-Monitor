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
    loadMonthData, 
    updateMonthNavigator, 
    sortTable, 
    filterContent,
    showLoader,
    updateMainStats,
    initMonthNavigator
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

// Export getter function for currentSort
export function getCurrentSort() {
    return currentSort;
}

/**
 * Initialize router date from all-time data
 */
async function initializeRouterDate() {
    const allTimeData = await fetchData('traffic_period_all-time.json');
    if (allTimeData && allTimeData.barChart && allTimeData.barChart.labels && allTimeData.barChart.labels.length > 0) {
        routerTodayFormatted = allTimeData.barChart.labels[allTimeData.barChart.labels.length - 1];
    } else {
        // Fallback to client date if all_time_data.json is not available or empty
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        routerTodayFormatted = `${yyyy}-${mm}-${dd}`;
        console.warn("Could not determine router's date from all_time_data.json. Falling back to client date.");
    }
}

// Global variables
let currentDevices = [];
let currentSort = { column: 4, ascending: false }; // Default sort is now Total (new index)
let availableMonths = [];
let currentMonthIndex = -1;
let sevenDayDataGlobal = null; // New global variable for sevenDayData
let currentDisplayStartDate = ''; // New global variable
let currentDisplayEndDate = '';   // New global variable
let routerTodayFormatted = ''; // Global variable to store router's current date
let currentFilterType; // Global variable to store current filter type
let currentStats; // Global variable to store current stats for quota updates
let savedGroups = [];

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

    // If filter is 'all_time', hide the entire card.
    if (filterType === 'all_time') {
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
 * Initialize month navigator
 */
async function initMonthNavigator() {
    console.log("initMonthNavigator called.");
    try {
        const response = await fetch('/get_available_months');
        availableMonths = await response.json();
        console.log("Available months fetched:", availableMonths);

        if (availableMonths.length > 0) {
            // Sort months in descending order (most recent first)
            availableMonths.sort((a, b) => b.localeCompare(a));
            currentMonthIndex = 0; // Start with the most recent month
            const monthNavigator = document.getElementById('month-navigator');
            if (monthNavigator) {
                monthNavigator.style.display = 'flex';
                console.log("Month navigator display set to flex.");
            } else {
                console.error("Month navigator element not found!");
            }
            updateMonthNavigator();
            loadMonthData(); // Load data for the initial month
        } else {
            const monthNavigator = document.getElementById('month-navigator');
            if (monthNavigator) {
                monthNavigator.style.display = 'none';
                console.log("No available months, month navigator hidden.");
            }
            // If no monthly data, default to 'this_month' quick filter
            applyFilter('this_month');
        }
    } catch (error) {
        console.error('Error fetching available months:', error);
        const monthNavigator = document.getElementById('month-navigator');
        if (monthNavigator) {
            monthNavigator.style.display = 'none';
        }
        // Fallback to 'this_month' quick filter if fetching fails
        applyFilter('this_month');
    }
}

// Month names array
const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

/**
 * Update month navigator display
 */
function updateMonthNavigator() {
    if (currentMonthIndex === -1) return;

    const [year, month] = availableMonths[currentMonthIndex].split('-');
    const monthName = translate(monthNames[parseInt(month) - 1]); // Get translated month name

    document.getElementById('current-month-display').textContent = `${monthName} ${year}`;
    document.getElementById('next-month').disabled = (currentMonthIndex === availableMonths.length - 1);
    document.getElementById('prev-month').disabled = (currentMonthIndex === 0);
}

/**
 * Load data for the currently selected month
 */
function loadMonthData() {
    if (currentMonthIndex === -1) return;
    console.log("loadMonthData called. currentMonthIndex:", currentMonthIndex);
    const monthId = availableMonths[currentMonthIndex]; // e.g., "2025-08"
    console.log("monthId from availableMonths:", monthId);
    const currentYearMonth = new Date().toISOString().slice(0, 7); // e.g., "2025-08"

    if (monthId === currentYearMonth) {
        // If the selected month is the current month, use the 'this_month' quick filter
        // which is updated more frequently by traffic_monitor.sh
        applyFilter('this_month');
    } else {
        // For past months, use the pre-aggregated monthly file
        applyFilter(`month_${monthId}`);
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
    const allTimeData = await fetchData('traffic_period_all-time.json');
    if (allTimeData && allTimeData.barChart && allTimeData.barChart.labels && allTimeData.barChart.labels.length > 0) {
        routerTodayFormatted = allTimeData.barChart.labels[allTimeData.barChart.labels.length - 1];
    } else {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        routerTodayFormatted = `${yyyy}-${mm}-${dd}`;
        console.warn("Could not determine router's date from all_time_data.json. Falling back to client date.");
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
    await checkAuth(initMonthNavigator, applyFilter, initPalestineKid);
    attachLoginFormListeners(initMonthNavigator, initPalestineKid);

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
        // Update quota display if we have current stats
        if (currentStats && currentFilterType) {
            updateQuotaDisplay(currentStats, currentFilterType);
        }
    });
});
