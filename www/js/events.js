// events.js - Event listener management
// MIGRATION STATUS: PHASE 6

/*
  Related: main.js → imports event handling functions
  Used by: FEATURE - Dashboard Application Event Handling
  MIGRATION STATUS: PHASE 6
*/

import {
    showDeviceCardModal,
    closeDeviceCardModal,
    showDailyBreakdownModal,
    closeDailyBreakdownModal,
    confirmDailyBreakdown,
    closeHistoryModal,
    viewRestoreHistory
} from './modals.js';
import { saveGroup, setEditMode, resetGroupingUI, toggleGroupChart, handleSelectionChange, updateGroupingUI, syncCheckboxes, renderSavedGroups, getSavedGroups, setSavedGroups, handleSelectAllDevices, getSelectedDevices, updateSelectedDevicesWithNewData, selectedDevices, setSelectedDevices } from './grouping.js';
import {
    applyFilter,
    loadMonthData,
    updateMonthNavigator,
    sortTable,
    filterContent,
    showLoader,
    updateMainStats,
    getAvailableMonths as mainGetAvailableMonths,
    getCurrentMonthIndex as mainGetCurrentMonthIndex,
    setCurrentMonthIndex as mainSetCurrentIndex,
    getCurrentSort as mainGetCurrentSort
} from './main.js'; // These functions will need to be exported from main.js
import { fetchData, pollForReport } from './api.js';
import { renderCharts, renderTopAppsChart } from './charts.js';
import { renderTable, renderDeviceCards } from './components.js';

// Global variables to hold references to main.js variables
let currentDevices = []; // This will need to be passed from main.js or managed differently

// References to functions that can get the current values from main.js
let getAvailableMonths;
let getCurrentMonthIndex;
let setCurrentMonthIndex;

/**
 * Update the currentDevices variable in events.js
 * @param {Array} devices - The updated devices array
 */
export function updateCurrentDevices(devices) {
    currentDevices = devices;
}

/**
 * Update the savedGroups variable in events.js
 * @param {Array} groups - The updated saved groups array
 */
export function updateSavedGroups(groups) {
    setSavedGroups(groups);
}

/**
 * Attach all event listeners for the application
 * @param {Array} devices - The current devices array from main.js
 * @param {Function} getMonths - Function to get the available months array from main.js
 * @param {Function} getCurrentIndex - Function to get the current month index from main.js
 * @param {Function} setCurrentIndex - Function to set the current month index in main.js
 * @param {Array} groups - The saved groups array from main.js
 */
export function attachEventListeners(devices, getMonths, getCurrentIndex, setCurrentIndex, groups) {
    // Update local references
    currentDevices = devices;
    getAvailableMonths = getMonths;
    getCurrentMonthIndex = getCurrentIndex;
    setCurrentMonthIndex = setCurrentIndex;
    
    // Billing controls event listener
    const applyBillingFilterBtn = document.querySelector('.billing-controls .apply-btn');
    if (applyBillingFilterBtn) {
        applyBillingFilterBtn.addEventListener('click', handleBillingFilterClick);
    }

    // Quick filter buttons
    document.querySelectorAll('.quick-filters > button').forEach(button => {
        button.addEventListener('click', () => {
            applyFilter(button.dataset.filterType);
        });
    });

    // Month navigator
    const nextMonthBtn = document.getElementById('next-month');
    const prevMonthBtn = document.getElementById('prev-month');
    const currentMonthDisplay = document.getElementById('current-month-display');
    
    if (nextMonthBtn) {
        nextMonthBtn.addEventListener('click', handleNextMonthClick);
    }
    
    if (prevMonthBtn) {
        prevMonthBtn.addEventListener('click', handlePrevMonthClick);
    }
    
    if (currentMonthDisplay) {
        currentMonthDisplay.addEventListener('click', handleMonthDisplayClick);
    }

    // Smart Grouping Event Listeners
    const saveGroupBtn = document.getElementById('save-group-btn');
    const groupNameInput = document.getElementById('group-name-input');
    const savedGroupsContainer = document.getElementById('saved-groups-container');
    const pillsContainer = document.getElementById('pills-container');
    const cancelUpdateBtn = document.getElementById('cancel-update-btn');
    const toggleGroupChartBtn = document.getElementById('toggle-group-chart-btn');
    const checkboxHeader = document.getElementById('checkbox-header');

    if (saveGroupBtn) {
        saveGroupBtn.addEventListener('click', saveGroup);
    }

    if (groupNameInput) {
        groupNameInput.addEventListener('keydown', handleGroupNameInputKeydown);
    }

    if (cancelUpdateBtn) {
        cancelUpdateBtn.addEventListener('click', () => {
            setEditMode(false);
            resetGroupingUI();
        });
    }

    if (savedGroupsContainer) {
        savedGroupsContainer.addEventListener('click', handleSavedGroupsContainerClick);
    }

    if (pillsContainer) {
        pillsContainer.addEventListener('click', handlePillsContainerClick);
    }

    if (toggleGroupChartBtn) {
        toggleGroupChartBtn.addEventListener('click', toggleGroupChart);
    }

    if (checkboxHeader) {
        checkboxHeader.addEventListener('click', () => {
            const selectAllCheckbox = document.getElementById('select-all-checkbox');
            const clearAllIcon = document.getElementById('clear-all-devices-icon');
            
            // Check which element is currently visible
            if (selectAllCheckbox && selectAllCheckbox.style.display !== 'none') {
                // Select all checkbox is visible, select all devices
                handleSelectAllDevices(currentDevices);
            } else if (clearAllIcon && clearAllIcon.style.display !== 'none') {
                // Clear all icon is visible, clear all devices
                resetGroupingUI(currentDevices);
            }
        });
    }

    // Render saved groups on page load
    renderSavedGroups();

    // Add click event listener to the bar chart
    const dailyBarChartCanvas = document.getElementById('dailyBarChart');
    if (dailyBarChartCanvas) {
        dailyBarChartCanvas.onclick = (event) => {
            // Don't show daily breakdown modal for hourly views
            if (window.isHourlyView) {
                return;
            }
            
            if (window.barChart) {
                const points = window.barChart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, true);
                if (points.length) {
                    const firstPoint = points[0];
                    const label = window.barChart.data.labels[firstPoint.index];
                    console.log("Date label from chart click:", label);
                    showDailyBreakdownModal(label);
                }
            }
        };
    }

    // Device search input
    const deviceSearch = document.getElementById('deviceSearch');
    if (deviceSearch) {
        deviceSearch.addEventListener('keyup', filterContent);
    }

    // Add event listeners for sort headers
    const sortHeaders = [
        { id: 'sort-device-name', col: 0 },
        { id: 'sort-mac-address', col: 1 },
        { id: 'sort-download', col: 2 },
        { id: 'sort-upload', col: 3 },
        { id: 'sort-percentage', col: 4 },
        { id: 'sort-total', col: 5 }
    ];

    sortHeaders.forEach(header => {
        const element = document.getElementById(header.id);
        if (element) {
            element.addEventListener('click', () => sortTable(header.col));
        }
    });

    // Add event delegation for device checkboxes
    const deviceTableBody = document.getElementById('deviceTableBody');
    if (deviceTableBody) {
        deviceTableBody.addEventListener('change', (event) => {
            if (event.target.classList.contains('device-checkbox')) {
                const mac = event.target.dataset.mac;
                const isSelected = event.target.checked;
                handleSelectionChange(mac, isSelected, currentDevices);
            }
        });
    }

    // Modal close buttons
    const closeHistoryModalBtn = document.getElementById('close-history-modal-btn');
    if (closeHistoryModalBtn) {
        closeHistoryModalBtn.addEventListener('click', closeHistoryModal);
    }

    const closeDailyBreakdownModalBtn = document.getElementById('close-daily-breakdown-modal-btn');
    if (closeDailyBreakdownModalBtn) {
        closeDailyBreakdownModalBtn.addEventListener('click', closeDailyBreakdownModal);
    }

    const closeDeviceCardModalBtn = document.getElementById('close-device-card-modal-btn');
    if (closeDeviceCardModalBtn) {
        closeDeviceCardModalBtn.addEventListener('click', closeDeviceCardModal);
    }

    // Modal action buttons
    const confirmDailyBreakdownBtn = document.getElementById('confirm-daily-breakdown-btn');
    if (confirmDailyBreakdownBtn) {
        confirmDailyBreakdownBtn.addEventListener('click', () => {
            confirmDailyBreakdown(applyFilter);
        });
    }

    const cancelDailyBreakdownBtn = document.getElementById('cancel-daily-breakdown-btn');
    if (cancelDailyBreakdownBtn) {
        cancelDailyBreakdownBtn.addEventListener('click', closeDailyBreakdownModal);
    }

    // Restore warning buttons
    const viewRestoreHistoryLink = document.getElementById('view-restore-history-link');
    if (viewRestoreHistoryLink) {
        viewRestoreHistoryLink.addEventListener('click', (e) => {
            e.preventDefault();
            viewRestoreHistory();
        });
    }

    const closeRestoreWarningBtn = document.getElementById('close-restore-warning-btn');
    if (closeRestoreWarningBtn) {
        closeRestoreWarningBtn.addEventListener('click', () => {
            // Clear the restore status on the server when closing the warning
            fetch('/clear_db_restore_status', { 
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            .then(response => response.json())
            .then(data => {
                console.log('Restore status cleared:', data);
                // Hide the warning after successful clearance
                document.getElementById('restore-warning').style.display = 'none';
            })
            .catch(error => {
                console.error('Error clearing restore status:', error);
                // Still hide the warning even if the clearance fails
                document.getElementById('restore-warning').style.display = 'none';
            });
        });
    }

    // Close modals when clicking outside
    const modals = [
        { id: 'deviceCardModal', closeFn: closeDeviceCardModal },
        { id: 'history-modal', closeFn: closeHistoryModal },
        { id: 'dailyBreakdownModal', closeFn: closeDailyBreakdownModal }
    ];

    modals.forEach(modal => {
        const element = document.getElementById(modal.id);
        if (element) {
            element.addEventListener('click', function (event) {
                if (event.target === this) {
                    modal.closeFn();
                }
            });
        }
    });
}

// --- Event Handler Functions ---

// Track ongoing requests and prevent duplicate clicks
const ongoingBillingRequests = new Set();
let isBillingRequestInProgress = false;

/**
 * Handle click on the billing filter apply button
 */
async function handleBillingFilterClick() {
    // Prevent multiple simultaneous requests
    if (isBillingRequestInProgress) {
        console.log("Billing request already in progress, ignoring click");
        return;
    }
    
    const billingStartInput = document.getElementById('billingStart');
    const billingDaysSelect = document.getElementById('billingDays');
    const applyBillingFilterBtn = document.querySelector('.billing-controls .apply-btn');
    
    const startDateStr = billingStartInput.value;
    const days = parseInt(billingDaysSelect.value);
    if (!startDateStr || isNaN(days)) {
        alert('Please select a start date and period.');
        return;
    }
    
    // Calculate the date range
    const startDate = new Date(startDateStr);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + days - 1);
    const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    
    // Create a unique request key
    const requestKey = `${startDateStr}-${endDateStr}`;
    
    // Check if this request is already in progress
    if (ongoingBillingRequests.has(requestKey)) {
        console.log(`Request for ${requestKey} is already in progress`);
        return;
    }
    
    isBillingRequestInProgress = true; // Prevent multiple clicks
    ongoingBillingRequests.add(requestKey); // Track this specific request
    
    applyBillingFilterBtn.disabled = true;
    showLoader(true);
    
    try {
        const filename = `traffic_period_${startDateStr}-${endDateStr}.json`;

        const response = await fetch(`/request_generator?start=${startDateStr}&end=${endDateStr}`);
        const cgiData = await response.json();

        if (!cgiData.success) {
            throw new Error(cgiData.message || 'Failed to queue report.');
        }

        const data = await pollForReport(filename);
        document.getElementById('overview-title').textContent = `Period Overview: ${startDateStr} to ${endDateStr}`;
        updateMainStats(data.stats_bytes, 'custom', days);
        renderCharts(data.barChart, data.devices.slice(0, 10), data.topApps);
        currentDevices = data.devices;
        updateCurrentDevices(data.devices);

        // Update selectedDevices with new traffic data for the current period
        updateSelectedDevicesWithNewData(data.devices);

        // Refresh grouping UI if devices are selected
        if (getSelectedDevices().length > 0) {
            updateGroupingUI(data.devices);
            syncCheckboxes(data.devices);
        }

        sortTable(mainGetCurrentSort().column, false);
    } catch (error) {
        console.error('Error during custom report generation:', error);
        alert('Error: ' + error.message);
    } finally {
        showLoader(false);
        applyBillingFilterBtn.disabled = false;
        isBillingRequestInProgress = false; // Re-enable clicks
        ongoingBillingRequests.delete(requestKey); // Remove from tracking
    }
}

/**
 * Handle click on the next month button
 */
function handleNextMonthClick() {
    // Left arrow moves to an older month
    const currentMonthIndex = mainGetCurrentMonthIndex();
    const availableMonths = mainGetAvailableMonths();

    if (currentMonthIndex < availableMonths.length - 1) {
        mainSetCurrentIndex(currentMonthIndex + 1);
        updateMonthNavigator();
        loadMonthData();
    }
}

/**
 * Handle click on the previous month button
 */
function handlePrevMonthClick() {
    // Right arrow moves to a newer month
    const currentMonthIndex = mainGetCurrentMonthIndex();
    const availableMonths = mainGetAvailableMonths();

    if (currentMonthIndex > 0) {
        mainSetCurrentIndex(currentMonthIndex - 1);
        updateMonthNavigator();
        loadMonthData();
    }
}

/**
 * Handle click on the current month display
 */
function handleMonthDisplayClick(event) {
    loadMonthData();
    // Add click feedback
    const target = event.currentTarget;
    target.classList.add('month-display-clicked');
    setTimeout(() => {
        target.classList.remove('month-display-clicked');
    }, 200); // Remove class after 200ms
}

/**
 * Handle keydown on the group name input
 */
function handleGroupNameInputKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault(); // Prevent default form submission
        saveGroup();
    }
}

/**
 * Handle click on the saved groups container
 */
async function handleSavedGroupsContainerClick(e) {
    if (e.target.classList.contains('saved-group-pill')) {
        if (currentDevices.length === 0) {
            alert('Please wait for device data to load before loading a group.');
            return;
        }
        const index = parseInt(e.target.dataset.index);
        const savedGroups = getSavedGroups();
        const group = savedGroups[index];
        const groupMacs = group.devices;
        // Match MACs with current devices to get full device objects
        setSelectedDevices(currentDevices.filter(device => groupMacs.includes(device.mac)));
        if (selectedDevices.length === 0) {
            alert('No matching devices found for this group. The devices may have changed.');
        }
        updateGroupingUI(currentDevices);
        syncCheckboxes();
        setEditMode(true, group.name); // Enter edit mode
    } else if (e.target.classList.contains('remove-saved-group-btn')) {
        const indexToRemove = parseInt(e.target.dataset.index);
        const savedGroups = getSavedGroups();
        const groupName = savedGroups[indexToRemove].name;
        try {
            const response = await fetch('/delete_group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: groupName })
            });
            const result = await response.json();
            if (result.success) {
                savedGroups.splice(indexToRemove, 1);
                setSavedGroups(savedGroups);
                renderSavedGroups();
            } else {
                alert('Failed to delete group: ' + result.error);
            }
        } catch (error) {
            alert('Error deleting group: ' + error.message);
        }
    } else if (e.target.classList.contains('clear-all-saved-groups-btn')) {
        // Clear all groups
        try {
            const savedGroups = getSavedGroups();
            for (const group of savedGroups) {
                await fetch('/delete_group', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: group.name })
                });
            }
            setSavedGroups([]);
            renderSavedGroups();
            resetGroupingUI(); // Hide the grouping area like "hide filters"
        } catch (error) {
            alert('Error clearing groups: ' + error.message);
        }
    } else if (e.target.classList.contains('hide-grouping-btn')) {
        resetGroupingUI();
    }
}

/**
 * Handle click on the pills container
 */
function handlePillsContainerClick(e) {
    if (e.target.classList.contains('remove-btn')) {
        const mac = e.target.dataset.mac;
        handleSelectionChange(mac, false, currentDevices);
    }
}