// grouping.js - Smart grouping functionality
// MIGRATION STATUS: PHASE 3

/*
  Related: main.js → event listeners for grouping controls
  Used by: FEATURE - Device Grouping
  MIGRATION STATUS: PHASE 3
*/

import { formatBytes } from './utils.js';
import { translate } from './i18n.js';

// Global variables for grouping functionality
export let selectedDevices = [];
let savedGroups = [];
let groupChart;
let editingGroupIndex = -1; // -1 means no group is being edited
let groupChartVisible = true; // Track chart visibility

/**
 * Get the current selected devices
 * @returns {Array} The current selected devices array
 */
export function getSelectedDevices() {
    return selectedDevices;
}

/**
 * Set the selected devices
 * @param {Array} devices - The new selected devices array
 */
export function setSelectedDevices(devices) {
    selectedDevices = devices;
}

/**
 * Update selected devices with new traffic data from current devices
 * @param {Array} currentDevices - Array of current devices with updated traffic data
 */
export function updateSelectedDevicesWithNewData(currentDevices) {
    if (selectedDevices.length === 0) return;

    // Create a map of current devices by MAC for quick lookup
    const currentDevicesMap = new Map();
    currentDevices.forEach(device => {
        currentDevicesMap.set(device.mac, device);
    });

    // Update selectedDevices with new data from currentDevices
    selectedDevices = selectedDevices.map(selectedDevice => {
        const updatedDevice = currentDevicesMap.get(selectedDevice.mac);
        return updatedDevice || selectedDevice; // Keep original if not found in new data
    });
}

/**
 * Set edit mode for group management
 * @param {boolean} isEditing - Whether we're in edit mode
 * @param {string} groupName - Name of the group being edited
 */
function setEditMode(isEditing, groupName = '') {
    const saveGroupBtn = document.getElementById('save-group-btn');
    const cancelUpdateBtn = document.getElementById('cancel-update-btn');
    const groupNameInput = document.getElementById('group-name-input');

    if (isEditing) {
        editingGroupIndex = savedGroups.findIndex(group => group.name === groupName);
        saveGroupBtn.textContent = translate('Update Group');
        cancelUpdateBtn.style.display = 'inline-block';
        groupNameInput.value = groupName;
    } else {
        editingGroupIndex = -1;
        saveGroupBtn.textContent = translate('Save Group');
        cancelUpdateBtn.style.display = 'none';
        groupNameInput.value = '';
    }
}

/**
 * Handle device selection change for grouping
 * @param {string} mac - MAC address of the device
 * @param {boolean} isSelected - Whether the device is selected
 * @param {Array<Object>} devices - Array of all devices
 */
function handleSelectionChange(mac, isSelected, devices) {
    const device = devices.find(d => d.mac === mac);
    if (!device) return;

    const isAlreadySelected = selectedDevices.some(d => d.mac === mac);

    if (isSelected && !isAlreadySelected) {
        selectedDevices.push(device);
    } else if (!isSelected) {
        selectedDevices = selectedDevices.filter(d => d.mac !== mac);
    }
    updateGroupingUI(devices);
    syncCheckboxes();
}

/**
 * Toggle device selection for circle clicks
 * @param {string} mac - MAC address of the device
 * @param {Event} event - The click event
 */
export function toggleDeviceSelection(mac, event) {
    event.stopPropagation();
    const card = document.querySelector(`.device-card[data-mac="${mac}"]`);
    const circle = card.querySelector('.selection-circle-test');

    const device = window.currentDevices.find(d => d.mac === mac);
    if (!device) return;

    card.classList.toggle('selected');
    if (card.classList.contains('selected')) {
        circle.classList.add('selected');
        // Add to selectedDevices if not already
        if (!selectedDevices.some(d => d.mac === mac)) {
            selectedDevices.push(device);
        }
    } else {
        circle.classList.remove('selected');
        selectedDevices = selectedDevices.filter(d => d.mac !== mac);
    }
    updateGroupingUI(window.currentDevices);
}

/**
 * Take screenshot of device
 * @param {string} mac - MAC address of the device
 */
export function takeScreenshot(mac) {
    // Get the device by MAC address
    const device = window.currentDevices.find(d => d.mac === mac);
    if (!device) {
        console.error(`Device with MAC ${mac} not found`);
        return;
    }

    // Show the personalized summary in a clean overlay
    window.showPersonalizedSummaryClean(mac, window.currentDevices, window.sevenDayDataGlobal, 
        window.currentDisplayStartDate, window.currentDisplayEndDate, 
        window.routerTodayFormatted, window.currentFilterType);
}

/**
 * Update grouping UI based on selected devices
 * @param {Array<Object>} devices - Array of all devices
 */
function updateGroupingUI(devices) {
    const groupingArea = document.getElementById('grouping-area');
    const pillsContainer = document.getElementById('pills-container');
    const analyticsSummary = document.getElementById('analytics-summary');

    if (selectedDevices.length === 0) {
        groupingArea.style.display = 'none';
        return;
    }
    groupingArea.style.display = 'block';
    renderSavedGroups();

    pillsContainer.innerHTML = '';
    let groupTraffic = 0;
    const chartLabels = [];
    const chartData = [];

    selectedDevices.forEach(device => {
        const pill = document.createElement('div');
        pill.className = 'pill';
        pill.innerHTML = `
            ${device.name}
            <button class="remove-btn" data-mac="${device.mac}">&times;</button>
        `;
        pillsContainer.appendChild(pill);
        groupTraffic += device.total_bytes;
        chartLabels.push(device.name);
        chartData.push(device.total_bytes);
    });

    const totalNetworkTraffic = devices.reduce((sum, device) => sum + device.total_bytes, 0);
    const percentage = (groupTraffic / totalNetworkTraffic * 100).toFixed(2);
    analyticsSummary.innerHTML = `
        ${translate('Total Group Traffic')}: <span style="font-weight: normal;">${formatBytes(groupTraffic)}</span> (<span style="color: var(--primary-color);">${percentage}%</span> ${translate('of total')})
    `;

    updateGroupChart(chartLabels, chartData);

    // Ensure chart visibility is consistent with groupChartVisible state
    const chartContainer = document.querySelector('#grouping-area .chart-container');
    const toggleButton = document.getElementById('toggle-group-chart-btn');
    if (chartContainer && toggleButton) {
        if (groupChartVisible) {
            chartContainer.style.display = 'block';
            toggleButton.textContent = translate('Hide Chart');
        } else {
            chartContainer.style.display = 'none';
            toggleButton.textContent = translate('Show Chart');
        }
    }
}

/**
 * Update the group chart with new data
 * @param {Array<string>} labels - Chart labels
 * @param {Array<number>} data - Chart data
 */
function updateGroupChart(labels, data) {
    const ctx = document.getElementById('group-chart').getContext('2d');
    if (groupChart) {
        groupChart.destroy();
    }
    groupChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const value = context.raw || 0;
                            const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
                            const percentage = total > 0 ? (value / total * 100).toFixed(2) : 0;
                            return `${formatBytes(value)} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Toggle visibility of the group chart
 */
function toggleGroupChart() {
    const chartContainer = document.querySelector('#grouping-area .chart-container');
    const toggleButton = document.getElementById('toggle-group-chart-btn');

    if (chartContainer && toggleButton) {
        groupChartVisible = !groupChartVisible;
        if (groupChartVisible) {
            chartContainer.style.display = 'block';
            toggleButton.textContent = translate('Hide Chart');
            // Re-render chart if it was hidden and there are selected devices
            if (selectedDevices.length > 0) {
                updateGroupChart(selectedDevices.map(d => d.name), selectedDevices.map(d => d.total_bytes));
            }
        } else {
            chartContainer.style.display = 'none';
            toggleButton.textContent = translate('Show Chart');
            if (groupChart) {
                groupChart.destroy();
                groupChart = null;
            }
        }
    }
}

/**
 * Synchronize checkboxes with selected devices
 * @param {Array<Object>} allDevices - Array of all devices in the current view
 */
function syncCheckboxes(allDevices = []) {
    const selectedMacs = new Set(selectedDevices.map(d => d.mac));
    document.querySelectorAll('.device-checkbox').forEach(checkbox => {
        const mac = checkbox.dataset.mac;
        checkbox.checked = selectedMacs.has(mac);
    });
    updateSelectionControlsVisibility(allDevices);
}

/**
 * Update visibility of selection controls based on current selection state
 * @param {Array<Object>} allDevices - Array of all devices in the current view
 */
function updateSelectionControlsVisibility(allDevices) {
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    const clearAllIcon = document.getElementById('clear-all-devices-icon');
    
    if (!selectAllCheckbox || !clearAllIcon) return;
    
    // If no devices are selected, show the select all checkbox
    if (selectedDevices.length === 0) {
        selectAllCheckbox.style.display = 'inline-block';
        clearAllIcon.style.display = 'none';
        selectAllCheckbox.checked = false;
    } else {
        // If any devices are selected, show the clear all icon
        selectAllCheckbox.style.display = 'none';
        clearAllIcon.style.display = 'inline-block';
        selectAllCheckbox.checked = false;
    }
}

/**
 * Render saved groups in the UI
 */
async function renderSavedGroups() {
    const savedGroupsContainer = document.getElementById('saved-groups-container');
    try {
        const response = await fetch('/load_groups');
        const data = await response.json();
        savedGroups = data.groups || [];
        if (savedGroups.length === 0) {
            savedGroupsContainer.style.display = 'none';
        } else {
            savedGroupsContainer.style.display = 'block';
            savedGroupsContainer.innerHTML = '<h5>' + translate('Saved Groups:') + '</h5>';
            savedGroups.forEach((group, index) => {
                const pill = document.createElement('div');
                pill.className = 'saved-group-pill';
                pill.textContent = group.name;
                pill.dataset.index = index;
                savedGroupsContainer.appendChild(pill);
            });
            // Add Clear All button
            const clearAllBtn = document.createElement('button');
            clearAllBtn.textContent = translate('Clear All');
            clearAllBtn.className = 'clear-all-saved-groups-btn';
            savedGroupsContainer.appendChild(clearAllBtn);

            // Add Hide Grouping button
            const hideGroupingBtn = document.createElement('button');
            hideGroupingBtn.textContent = translate('Hide Filters');
            hideGroupingBtn.className = 'hide-grouping-btn';
            savedGroupsContainer.appendChild(hideGroupingBtn);
        }
    } catch (error) {
        console.error('Error loading groups:', error);
        savedGroupsContainer.style.display = 'none';
    }
}

/**
 * Save a group of devices
 */
async function saveGroup() {
    const groupNameInput = document.getElementById('group-name-input');
    const name = groupNameInput.value.trim();
    if (name && selectedDevices.length > 0) {
        const deviceMacs = selectedDevices.map(device => device.mac);
        try {
            const response = await fetch('/save_group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, devices: deviceMacs })
            });
            const result = await response.json();
            if (result.success) {
                // Update local savedGroups array
                if (editingGroupIndex !== -1) {
                    savedGroups[editingGroupIndex] = { name: name, devices: deviceMacs };
                } else {
                    savedGroups.push({ name: name, devices: deviceMacs });
                }
                setEditMode(false); // Exit edit mode after saving/updating
                renderSavedGroups();
            } else {
                alert('Failed to save group: ' + result.error);
            }
        } catch (error) {
            alert('Error saving group: ' + error.message);
        }
    }
}

/**
 * Reset grouping UI to initial state
 */
function resetGroupingUI() {
    selectedDevices = [];
    // We need to pass the devices array to updateGroupingUI, but we don't have it here
    // This will be handled by the caller in main.js
    const groupingArea = document.getElementById('grouping-area');
    if (groupingArea) {
        groupingArea.style.display = 'none';
    }
    syncCheckboxes();
    // Hide saved groups container and the hide filters button
    const savedGroupsContainer = document.getElementById('saved-groups-container');
    const hideGroupingBtn = document.querySelector('.hide-grouping-btn');
    if (savedGroupsContainer) {
        savedGroupsContainer.style.display = 'none';
    }
    if (hideGroupingBtn) {
        hideGroupingBtn.style.display = 'none';
    }
    updateSelectionControlsVisibility([]); // Ensure icon visibility is updated
}

/**
 * Get the current saved groups
 * @returns {Array} The current saved groups array
 */
export function getSavedGroups() {
    return savedGroups;
}

/**
 * Set the saved groups
 * @param {Array} groups - The new saved groups array
 */
export function setSavedGroups(groups) {
    savedGroups = groups;
}

// Export functions for use in other modules

/**
 * Handle select all devices functionality
 * @param {Array<Object>} allDevices - Array of all devices in the current view
 */
function handleSelectAllDevices(allDevices) {
    // Add all devices to selected devices
    selectedDevices = [...allDevices];
    updateGroupingUI(allDevices);
    syncCheckboxes(allDevices);
    updateSelectionControlsVisibility(allDevices);
}

export { 
    setEditMode,
    handleSelectionChange,
    updateGroupingUI,
    toggleGroupChart,
    syncCheckboxes,
    renderSavedGroups,
    saveGroup,
    resetGroupingUI,
    handleSelectAllDevices
};