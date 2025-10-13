// modals.js - Modal handling functions
// MIGRATION STATUS: PHASE 3

/*
  Related: main.js → calls modal functions
  Used by: FEATURE - Device Details Modal
  MIGRATION STATUS: PHASE 3
*/

import { formatBytes } from './utils.js';
import { fetchData, fetchAndRenderDeviceApps } from './api.js';
import { renderDeviceCards, initializeTooltips } from './components.js';
import { applyTranslations } from './i18n.js';
import { modalLanguageManager } from './modalTranslationManager.js';

// Global variables needed for modal functionality
let currentDevices = [];
let sevenDayDataGlobal = null;
let currentDisplayStartDate = '';
let currentDisplayEndDate = '';
let routerTodayFormatted = '';
let currentFilterType; // Global variable to store current filter type

// Modal language management is now handled by modalManager.js

// Translation functions are now handled by modalManager.js

/**
 * Generate personalized summary HTML for device modal
 * @param {Object} device - Device object
 * @param {Array<Object>} allDevices - Array of all devices
 * @param {string} filterType - Current filter type
 * @returns {string} HTML string for personalized summary
 */
function generatePersonalizedSummary(device, allDevices, filterType) {
    // Calculate device vs others data
    const deviceUsage = device.total_bytes / 1073741824 || 0; // Convert bytes to GB
    const totalUsage = allDevices.reduce((sum, d) => sum + (d.total_bytes / 1073741824 || 0), 0); // Convert bytes to GB
    const othersUsage = totalUsage - deviceUsage;

    // Fetch and display monthly usage
    const monthBeginFirstDay = `${window.routerTodayFormatted.substring(0, 7)}-01`;
    const monthBeginToday = window.routerTodayFormatted;
    
    // Check if this is the current month - if so, use the current month file
    if (monthBeginFirstDay === monthBeginToday.substring(0, 7) + "-01") {
        // For current month, try the fixed filename first
        fetchData('traffic_period_current_month.json').then(monthlyData => {
            let deviceMonthlyUsage = 0;
            if (monthlyData && monthlyData.devices) {
                const monthlyDevice = monthlyData.devices.find(d => d.mac === device.mac);
                if (monthlyDevice) {
                    deviceMonthlyUsage = monthlyDevice.total_bytes;
                }
            }
            const monthlyUsageElement = document.getElementById('monthlyUsageValue');
            if(monthlyUsageElement) monthlyUsageElement.textContent = formatBytes(deviceMonthlyUsage);
        }).catch(() => {
            // If current month file doesn't exist, try the specific date range as fallback
            const monthlyDataFilename = `traffic_period_${monthBeginFirstDay}-${monthBeginToday}.json`;
            fetchData(monthlyDataFilename).then(monthlyData => {
                let deviceMonthlyUsage = 0;
                if (monthlyData && monthlyData.devices) {
                    const monthlyDevice = monthlyData.devices.find(d => d.mac === device.mac);
                    if (monthlyDevice) {
                        deviceMonthlyUsage = monthlyDevice.total_bytes;
                    }
                }
                const monthlyUsageElement = document.getElementById('monthlyUsageValue');
                if(monthlyUsageElement) monthlyUsageElement.textContent = formatBytes(deviceMonthlyUsage);
            }).catch(error => {
                console.error('Could not fetch monthly data:', error);
                const monthlyUsageElement = document.getElementById('monthlyUsageValue');
                if(monthlyUsageElement) monthlyUsageElement.textContent = '0 B';
            });
        });
    } else {
        // For a different month (like September), try to find the completed monthly file
        const monthId = monthBeginFirstDay.substring(0, 7); // e.g., "2025-09"
        const monthlyFileName = `traffic_month_${monthId}.json`;
        
        fetchData(monthlyFileName).then(monthlyData => {
            let deviceMonthlyUsage = 0;
            if (monthlyData && monthlyData.devices) {
                const monthlyDevice = monthlyData.devices.find(d => d.mac === device.mac);
                if (monthlyDevice) {
                    deviceMonthlyUsage = monthlyDevice.total_bytes;
                }
            }
            const monthlyUsageElement = document.getElementById('monthlyUsageValue');
            if(monthlyUsageElement) monthlyUsageElement.textContent = formatBytes(deviceMonthlyUsage);
        }).catch(() => {
            // If the specific month file doesn't exist, try the specific date range as fallback
            const monthlyDataFilename = `traffic_period_${monthBeginFirstDay}-${monthBeginToday}.json`;
            fetchData(monthlyDataFilename).then(monthlyData => {
                let deviceMonthlyUsage = 0;
                if (monthlyData && monthlyData.devices) {
                    const monthlyDevice = monthlyData.devices.find(d => d.mac === device.mac);
                    if (monthlyDevice) {
                        deviceMonthlyUsage = monthlyDevice.total_bytes;
                    }
                }
                const monthlyUsageElement = document.getElementById('monthlyUsageValue');
                if(monthlyUsageElement) monthlyUsageElement.textContent = formatBytes(deviceMonthlyUsage);
            }).catch(error => {
                console.error('Could not fetch monthly data:', error);
                const monthlyUsageElement = document.getElementById('monthlyUsageValue');
                if(monthlyUsageElement) monthlyUsageElement.textContent = '0 B';
            });
        });
    }
    
    // Determine period label based on filter type
    let periodLabel = 'Current Period';
    switch (filterType) {
        case 'today':
            periodLabel = 'Today';
            break;
        case 'yesterday':
            periodLabel = 'Yesterday';
            break;
        case 'last_7_days':
            periodLabel = 'Last 7 Days';
            break;
        case 'this_month':
            periodLabel = 'This Month';
            break;
        default:
            if (filterType.startsWith('month_')) {
                periodLabel = 'This Month';
            } else if (filterType === 'all_time') {
                periodLabel = 'All Time';
            } else if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(filterType)) {
                periodLabel = filterType;
            }
            break;
    }

    return `
        <div class="summary-section">
            <h3 data-modal-i18n="Personalized Usage Summary">Personalized Usage Summary</h3>
            <div class="summary-controls-row">
                <div id="summaryTitleInput" contenteditable="true" placeholder="Enter title for screenshot..." class="editable-title"></div>
                <button id="saveSummaryImageBtn" data-modal-i18n="Save as Image">Save as Image</button>
            </div>
            <div class="summary-controls-row" id="emoji-controls-row">
                <div class="language-toggle">
                    <button id="lang1" class="active">EN</button>
                    <button id="lang2">AR</button>
                </div>
                <div style="position: relative;">
                    <button id="emoji-btn">😊</button>
                </div>
                <div id="selected-emojis"></div>
                <button id="remove-emoji-feature-btn">&times;</button>
            </div>

            <h4 data-modal-i18n="Device vs. Others">Device vs. Others</h4>
            <div class="chart-container-modal">
                <canvas id="deviceVsOthersChart"></canvas>
            </div>

            <div class="monthly-usage">
                <span class="js-localize-monthly-usage-label" data-modal-i18n="Since Month Began">Since Month Began:</span> <span id="monthlyUsageValue" class="monthly-usage-value">Loading...</span>
            </div>

            <div class="top-apps">
                <h4><span data-modal-i18n="Top 3 Apps">Top 3 Apps</span> (<span data-modal-i18n="${periodLabel}">${periodLabel}</span>)</h4>
                <ul class="app-list" id="topAppsList">
                    <li>Loading apps data...</li>
                </ul>
            </div>
        </div>
    `;
}

/**
 * Show device card modal for a specific device
 * @param {string} macAddress - MAC address of the device to show
 * @param {Array<Object>} devices - Array of all devices
 * @param {Object|null} sevenDayData - Seven day data for trends
 * @param {string} startDate - Start date for data display
 * @param {string} endDate - End date for data display
 * @param {string} routerDate - Router's current date
 * @param {string} filterType - Current filter type
 */
function showDeviceCardModal(macAddress, devices, sevenDayData, startDate, endDate, routerDate, filterType) {
    // Update global variables
    currentDevices = devices;
    sevenDayDataGlobal = sevenDayData;
    currentDisplayStartDate = startDate;
    currentDisplayEndDate = endDate;
    routerTodayFormatted = routerDate;
    currentFilterType = filterType;
    
    const device = currentDevices.find(d => d.mac === macAddress);
    if (device) {
        const modalContent = document.getElementById('deviceCardModalContent');
        const deviceCardHtml = renderDeviceCards([device], sevenDayDataGlobal);
        const personalizedSummaryHtml = generatePersonalizedSummary(device, currentDevices, currentFilterType);

        modalContent.innerHTML = `
            <div class="modal-header">
                <!-- Title removed as per user request - Last used: Device Split View -->
            </div>
            <div class="modal-body">
                <div class="split-view">
             <div class="device-overview-panel">
                 <h3>Device Overview</h3>
                 <div class="device-card-wrapper">${deviceCardHtml}</div>
                 <div class="device-support-section">
                     <button class="buymecoffee-close-btn buymecoffee-desktop-only">✂️</button>
                     <p>If this tool helps you, consider supporting me:</p>
                     <div class="support-button-container">
                         <a href="https://www.buymeacoffee.com/heythem500">
                             <img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=heythem500&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" />
                         </a>
                     </div>
                 </div>
             </div>
                    <div>${personalizedSummaryHtml}</div>
                </div>
            </div>
        `;

        // Apply translations to newly rendered device cards
        applyTranslations();
        // Initialize tooltips for device cards in modal
        initializeTooltips();

        document.getElementById('deviceCardModal').style.display = 'flex';

        // Close support section
        const closeBtn = modalContent.querySelector('.buymecoffee-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                closeBtn.parentElement.style.display = 'none';
            });
        }

        // Initialize modal language manager
        modalLanguageManager.init();
        modalLanguageManager.addSettingsIcon();

        // Initialize the chart after modal is displayed
        setTimeout(() => {
            console.log('Attempting to initialize chart...');
            const canvasInHTML = modalContent.innerHTML.includes('deviceVsOthersChart');
            console.log('Canvas element exists in HTML:', canvasInHTML);

            if (canvasInHTML) {
                const canvasElement = document.getElementById('deviceVsOthersChart');
                console.log('Canvas element found in DOM:', !!canvasElement);
                if (canvasElement) {
                    console.log('Canvas dimensions:', canvasElement.width, 'x', canvasElement.height);
                }
            }

            initDeviceVsOthersChart(device, currentDevices);
        }, 200);

        // Fetch and render device apps
        fetchAndRenderDeviceApps(macAddress, startDate, endDate);
        initEmojiPicker();

        // Language Toggle Event Listeners
        const lang1Btn = document.getElementById('lang1');
        const lang2Btn = document.getElementById('lang2');

        if (lang1Btn && lang2Btn) {
            lang1Btn.addEventListener('click', () => {
                modalLanguageManager.switchToLanguage(lang1Btn.dataset.lang);
                lang1Btn.classList.add('active');
                lang2Btn.classList.remove('active');
            });

            lang2Btn.addEventListener('click', () => {
                modalLanguageManager.switchToLanguage(lang2Btn.dataset.lang);
                lang2Btn.classList.add('active');
                lang1Btn.classList.remove('active');
            });
        }

        // Add event listener for save summary image button
        const saveSummaryImageBtn = document.getElementById('saveSummaryImageBtn');
        if (saveSummaryImageBtn) {
            saveSummaryImageBtn.addEventListener('click', saveSummaryImage);
        }


    }
}

/**
 * Show personalized summary in a clean overlay for mobile screenshot
 * @param {string} macAddress - MAC address of the device to show
 * @param {Array<Object>} devices - Array of all devices
 * @param {Object|null} sevenDayData - Seven day data for trends
 * @param {string} startDate - Start date for data display
 * @param {string} endDate - End date for data display
 * @param {string} routerDate - Router's current date
 * @param {string} filterType - Current filter type
 */
function showPersonalizedSummaryClean(macAddress, devices, sevenDayData, startDate, endDate, routerDate, filterType) {
    // Get the device by MAC address
    const device = devices.find(d => d.mac === macAddress);
    if (!device) {
        console.error(`Device with MAC ${macAddress} not found`);
        return;
    }

    // Set global variables for data context
    window.routerTodayFormatted = routerDate;
    window.currentFilterType = filterType;

    // Create or get the clean overlay element
    let cleanOverlay = document.getElementById('clean-screenshot-overlay');
    if (!cleanOverlay) {
        cleanOverlay = document.createElement('div');
        cleanOverlay.id = 'clean-screenshot-overlay';
        document.body.appendChild(cleanOverlay);
    }

    // Generate the personalized summary HTML
    const personalizedSummaryHtml = generatePersonalizedSummary(device, devices, filterType);
    
    // Set the content with clean, focused layout
    cleanOverlay.innerHTML = `
        <div class="clean-summary-container">
            <button class="clean-close-button">&times;</button>
            <div class="summary-content">
                ${personalizedSummaryHtml}
            </div>
        </div>
    `;

    // Show the overlay
    cleanOverlay.style.display = 'flex';

    // Initialize modal language manager
    modalLanguageManager.init();
    modalLanguageManager.addSettingsIcon();

    // Initialize the chart after overlay is displayed
    setTimeout(() => {
        initDeviceVsOthersChart(device, devices);
    }, 200);

    // Fetch and render device apps
    fetchAndRenderDeviceApps(macAddress, startDate, endDate);
    initEmojiPicker();

    // Language Toggle Event Listeners
    const lang1Btn = document.getElementById('lang1');
    const lang2Btn = document.getElementById('lang2');

        if (lang1Btn && lang2Btn) {
            lang1Btn.addEventListener('click', () => {
                modalLanguageManager.switchToLanguage(lang1Btn.dataset.lang);
                lang1Btn.classList.add('active');
                lang2Btn.classList.remove('active');
            });

            lang2Btn.addEventListener('click', () => {
                modalLanguageManager.switchToLanguage(lang2Btn.dataset.lang);
                lang2Btn.classList.add('active');
                lang1Btn.classList.remove('active');
            });
        }

    // Add event listener for save summary image button
    const saveSummaryImageBtn = document.getElementById('saveSummaryImageBtn');
    if (saveSummaryImageBtn) {
        saveSummaryImageBtn.addEventListener('click', saveSummaryImage);
    }



    // Add event listener to close button
    const closeBtn = cleanOverlay.querySelector('.clean-close-button');
    closeBtn.addEventListener('click', () => {
        // Destroy the chart before closing overlay
        if (window.deviceVsOthersChart && typeof window.deviceVsOthersChart.destroy === 'function') {
            window.deviceVsOthersChart.destroy();
            window.deviceVsOthersChart = null;
        }
        cleanOverlay.style.display = 'none';
    });

    // Close overlay when clicking outside the content
    cleanOverlay.addEventListener('click', (event) => {
        if (event.target === cleanOverlay) {
            // Destroy the chart before closing overlay
            if (window.deviceVsOthersChart && typeof window.deviceVsOthersChart.destroy === 'function') {
                window.deviceVsOthersChart.destroy();
                window.deviceVsOthersChart = null;
            }
            cleanOverlay.style.display = 'none';
        }
    });
}

/**
 * Initialize the device vs others chart in the modal
 * @param {Object} device - Device object
 * @param {Array<Object>} allDevices - Array of all devices
 */
function initDeviceVsOthersChart(device, allDevices) {
    console.log('initDeviceVsOthersChart called for device:', device.name);

    // Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
        console.error('Chart.js is not loaded!');
        return;
    }

    const deviceUsage = device.total_bytes / 1073741824 || 0; // Convert bytes to GB
    const totalUsage = allDevices.reduce((sum, d) => sum + (d.total_bytes / 1073741824 || 0), 0); // Convert bytes to GB
    const othersUsage = totalUsage - deviceUsage;

    console.log('Chart data:', { deviceUsage, othersUsage, totalUsage });

    const ctx = document.getElementById('deviceVsOthersChart');
    console.log('Canvas element found:', !!ctx);
    if (!ctx) {
        console.error('Chart canvas not found!');
        return;
    }

    // Destroy existing chart if it exists
    if (window.deviceVsOthersChart && typeof window.deviceVsOthersChart.destroy === 'function') {
        window.deviceVsOthersChart.destroy();
    }

    window.deviceVsOthersChart = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: [device.name || 'This Device', 'Other Devices'],
            datasets: [{
                data: [deviceUsage, othersUsage],
                backgroundColor: ['#0d6efd', '#6c757d'],
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 10,
                        font: {
                            size: 12
                        },
                        usePointStyle: true,
                        textAlign: 'left'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const value = context.raw || 0;
                            const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
                            const percentage = total > 0 ? (value / total * 100).toFixed(1) : 0;
                            return `${formatBytes(value * 1073741824)} (${percentage}%)`;
                        }
                    }
                }
            }
        },
        plugins: [{
            id: 'centerText',
            afterDraw: function (chart) {
                const ctx = chart.ctx;
                const meta = chart.getDatasetMeta(0);
                if (meta && meta.data && meta.data[0]) {
                    const element = meta.data[0];
                    const data = chart.data.datasets[0].data[0];
                    const total = chart.data.datasets[0].data.reduce((sum, val) => sum + val, 0);
                    const percentage = total > 0 ? (data / total * 100).toFixed(1) : 0;

                    // Get the tooltip position which is in the center of the slice
                    const position = element.tooltipPosition();

                    ctx.save();
                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold 14px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
                    ctx.lineWidth = 3;
                    ctx.strokeText(percentage + '%', position.x, position.y);
                    ctx.fillText(percentage + '%', position.x, position.y);
                    ctx.restore();
                }
            }
        }]
    });
}

/**
 * Save summary image from modal
 */
function saveSummaryImage() {
    // Look for summary content in both regular modal and clean overlay
    const summaryContainer = document.querySelector('#deviceCardModalContent .summary-section') || 
                           document.querySelector('#clean-screenshot-overlay .summary-section') ||
                           document.querySelector('.summary-content .summary-section');
    const modalContent = document.querySelector('#deviceCardModal .modal-content');
    const titleInput = document.getElementById('summaryTitleInput');
    const saveButton = document.getElementById('saveSummaryImageBtn');
    const originalTitle = titleInput ? titleInput.textContent.trim() : '';
    const titleForImage = originalTitle || 'Device Usage Summary';

    // Temporarily hide the input and button
    if (titleInput) titleInput.style.display = 'none';
    if (saveButton) saveButton.style.display = 'none';

    // Hide emoji controls and picker
    const emojiControlsRow = document.getElementById('emoji-controls-row');
    const emojiPicker = document.getElementById('emoji-picker');
    if (emojiControlsRow) emojiControlsRow.style.display = 'none';
    if (emojiPicker) emojiPicker.style.display = 'none';

    // Temporarily create a div for the title to be included in the screenshot
    const titleElement = document.createElement('h2');
    titleElement.style.display = 'block';
    titleElement.style.margin = '15px auto 25px auto';
    titleElement.style.color = '#2c3e50';
    titleElement.style.fontSize = '24px';
    titleElement.style.fontFamily = '"Segoe UI", Arial, sans-serif';
    titleElement.style.fontWeight = '400';
    titleElement.style.textShadow = '1px 1px 2px rgba(0,0,0,0.1)';
    titleElement.style.padding = '10px 15px';
    titleElement.style.backgroundColor = 'rgba(240, 240, 240, 0.8)';
    titleElement.style.borderRadius = '5px';
    titleElement.style.width = '100%';
    titleElement.style.textAlign = 'center';
    titleElement.style.boxSizing = 'border-box';

    // Add selected emojis to the title element on a new line
    const selectedEmojisContainer = document.getElementById('selected-emojis');
    const selectedEmojis = selectedEmojisContainer ? selectedEmojisContainer.textContent.trim() : '';
    if (selectedEmojis) {
        titleElement.innerHTML = `📄 ${titleForImage}<br><span style="font-size: 20px;">${selectedEmojis}</span>`;
    } else {
        titleElement.textContent = `📄 ${titleForImage}`;
    }

    // Insert the title element at the beginning of the summary container for screenshot
    if (summaryContainer) summaryContainer.prepend(titleElement);

    // Sanitize filename
    let sanitizedFilename = titleForImage
        .replace(/[^a-zA-Z0-9\s-_]/g, '')
        .replace(/\s+/g, '_')
        .replace(/__+/g, '_')
        .replace(/^-+|-+$/g, '')
        .replace(/^_|_$/g, '');

    if (sanitizedFilename === '') {
        sanitizedFilename = 'Device_Summary_Report';
    }

    // Store original transform and remove it for screenshot
    let originalTransform = '';
    if (modalContent) {
        const computedTransform = window.getComputedStyle(modalContent).transform;
        if (computedTransform && computedTransform !== 'none') {
            originalTransform = computedTransform;
            modalContent.style.transform = 'none';
        }
    }

    // Get device pixel ratio for high-DPI displays (especially important for mobile)
    const pixelRatio = window.devicePixelRatio || 1;
    console.log('Device pixel ratio:', pixelRatio);

    // Calculate dimensions with pixel ratio for crisp images on high-DPI displays
    const rect = summaryContainer.getBoundingClientRect();
    const width = rect.width * pixelRatio;
    const height = rect.height * pixelRatio;

    domtoimage.toJpeg(summaryContainer, {
        quality: 1.0, // Maximum quality for crisp images
        bgcolor: '#ffffff',
        width: width,
        height: height,
        style: {
            // Scale content for high-DPI displays
            transform: `scale(${pixelRatio})`,
            transformOrigin: 'top left',
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            background: '#ffffff',
            // Font smoothing for better text rendering on mobile
            '-webkit-font-smoothing': 'antialiased',
            '-moz-osx-font-smoothing': 'grayscale'
        }
    }).then(function (dataUrl) {
        // Remove the temporary title element after image is generated
        titleElement.remove();

        // Restore visibility of emoji controls and picker
        if (emojiControlsRow) emojiControlsRow.style.display = '';
        if (emojiPicker) emojiPicker.style.display = '';

        const link = document.createElement('a');
        link.download = `${sanitizedFilename}.jpg`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }).catch(function (error) {
        console.error('Error generating image:', error);
        alert('Failed to save image. Please try again.');
        titleElement.remove();
        if (selectedEmojis) {
            const emojiElement = summaryContainer.querySelector('div[style*="font-size: 24px"]');
            if (emojiElement) {
                emojiElement.remove();
            }
        }
    }).finally(() => {
        // Always restore visibility of input and button
        if (titleInput) titleInput.style.display = '';
        if (saveButton) saveButton.style.display = '';

        // Restore visibility of emoji controls and picker
        if (emojiControlsRow) emojiControlsRow.style.display = '';
        if (emojiPicker) emojiPicker.style.display = '';

        // Restore original transform if it was changed
        if (originalTransform) {
            modalContent.style.transform = originalTransform;
        }
    });
}

/**
 * Initialize emoji picker in modal
 */
function initEmojiPicker() {
    const emojiBtn = document.getElementById('emoji-btn');
    const selectedEmojisContainer = document.getElementById('selected-emojis');
    const removeEmojiFeatureBtn = document.getElementById('remove-emoji-feature-btn');
    let emojiPicker = document.getElementById('emoji-picker');

    const emojis = ['😊', '😂', '😍', '🤔', '😢', '😠', '👍', '👎', '❤️', '💔', '🔥', '💯'];

    if (emojiBtn) {
        emojiBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            if (!emojiPicker) {
                emojiPicker = document.createElement('div');
                emojiPicker.id = 'emoji-picker';
                emojis.forEach(emoji => {
                    const emojiSpan = document.createElement('span');
                    emojiSpan.className = 'emoji';
                    emojiSpan.textContent = emoji;
                    emojiSpan.addEventListener('click', () => {
                        const selectedEmojiSpan = document.createElement('span');
                        selectedEmojiSpan.className = 'selected-emoji';
                        selectedEmojiSpan.textContent = emoji;
                        selectedEmojiSpan.addEventListener('click', () => {
                            if (selectedEmojisContainer) {
                                selectedEmojisContainer.removeChild(selectedEmojiSpan);
                            }
                        });
                        if (selectedEmojisContainer) {
                            selectedEmojisContainer.appendChild(selectedEmojiSpan);
                        }
                    });
                    emojiPicker.appendChild(emojiSpan);
                });
                emojiBtn.parentElement.appendChild(emojiPicker);
            }
            if (emojiPicker) {
                emojiPicker.style.display = emojiPicker.style.display === 'block' ? 'none' : 'block';
            }
        });
    }

    if (removeEmojiFeatureBtn) {
        removeEmojiFeatureBtn.addEventListener('click', () => {
            const emojiControlsRow = document.getElementById('emoji-controls-row');
            if (emojiControlsRow) {
                emojiControlsRow.remove();
            }
            if (emojiPicker) {
                emojiPicker.remove();
            }
        });
    }

    document.addEventListener('click', (event) => {
        if (emojiPicker && !emojiPicker.contains(event.target) && event.target !== emojiBtn) {
            if (emojiPicker) {
                emojiPicker.style.display = 'none';
            }
        }
    });
}

/**
 * Close device card modal
 */
function closeDeviceCardModal() {
    console.log('Closing device card modal');
    // Destroy the chart before closing modal
    if (window.deviceVsOthersChart && typeof window.deviceVsOthersChart.destroy === 'function') {
        window.deviceVsOthersChart.destroy();
        window.deviceVsOthersChart = null;
    }

    document.getElementById('deviceCardModal').style.display = 'none';
    document.getElementById('deviceCardModalContent').innerHTML = ''; // Clear content
}

/**
 * Show daily breakdown modal for a specific date
 * @param {string} date - Date to show breakdown for
 */
function showDailyBreakdownModal(date) {
    document.getElementById('dailyBreakdownMessage').textContent = `Do you want to view data for ${date}?`;
    document.getElementById('dailyBreakdownModal').style.display = 'flex';
}

/**
 * Close daily breakdown modal
 */
function closeDailyBreakdownModal() {
    document.getElementById('dailyBreakdownModal').style.display = 'none';
}

/**
 * Confirm daily breakdown and apply filter
 * @param {Function} applyFilter - Function to apply the date filter
 */
function confirmDailyBreakdown(applyFilter) {
    const dateToFilter = document.getElementById('dailyBreakdownMessage').textContent.match(/\d{4}-\d{2}-\d{2}/)[0];
    closeDailyBreakdownModal();
    console.log("Confirming daily breakdown for date: ", dateToFilter);
    if (dateToFilter) {
        applyFilter(dateToFilter); // Apply filter for the stored date
    }
}

/**
 * Close history modal
 */
function closeHistoryModal() {
    document.getElementById('history-modal').style.display = 'none';
}

/**
 * View restore history
 */
function viewRestoreHistory() {
    fetch('/logs/db_restore_history.log')
        .then(response => {
            if (!response.ok) { throw new Error('No history log'); }
            return response.text();
        })
        .then(log => {
            // Colorize the log content
            let formattedLog = log.trim() || 'No restore events recorded.';
            if (formattedLog !== 'No restore events recorded.') {
                // Split log into lines and colorize each line
                const lines = formattedLog.split('\n');
                formattedLog = lines.map(line => {
                    if (line.includes('DETECTED:')) {
                        return `<span style="color: #dc3545; font-weight: bold;">${line}</span>`; // Red for detected
                    } else if (line.includes('RESTORED:')) {
                        return `<span style="color: #198754; font-weight: bold;">${line}</span>`; // Green for restored
                    } else if (line.includes('TIME GAP:')) {
                        return `<span style="color: #ffc107; font-weight: bold;">${line}</span>`; // Yellow for time gap
                    } else if (line.includes('FAILED:') || line.includes('CRITICAL:')) {
                        return `<span style="color: #dc3545; font-weight: bold;">${line}</span>`; // Red for failures
                    } else {
                        return `<span style="color: #6c757d;">${line}</span>`; // Gray for other lines
                    }
                }).join('<br>');
            }
            
            document.getElementById('history-log-content').innerHTML = formattedLog;
            document.getElementById('history-modal').style.display = 'block';
        })
        .catch(() => {
            document.getElementById('history-log-content').textContent = 'Could not load restore history log.';
            document.getElementById('history-modal').style.display = 'block';
        });
}

// Make the function globally accessible
window.showPersonalizedSummaryClean = showPersonalizedSummaryClean;

// Export functions for use in other modules
export { 
    showDeviceCardModal, 
    closeDeviceCardModal, 
    showDailyBreakdownModal, 
    closeDailyBreakdownModal, 
    confirmDailyBreakdown, 
    closeHistoryModal, 
    viewRestoreHistory,
    initDeviceVsOthersChart,
    saveSummaryImage,
    showPersonalizedSummaryClean
};