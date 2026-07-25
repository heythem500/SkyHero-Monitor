// settings.js - Dashboard Settings Panel
// Storage abstraction + mobile/desktop profiles

import { applyPrivateModeUi, privateDisplayName } from './settings_privatemode.js';
import { renderTable, renderDeviceCards, initializeTooltips } from './components.js';
import { updateGroupingUI, getSelectedDevices, syncCheckboxes, renderSavedGroups } from './grouping.js';
import { applyTranslations } from './i18n.js';

const defaultSettings = {
    desktop: { hideNotes: false, hideNotifications: false, hideTopApps: false, showPalestineImage: true, hideDeviceTable: false, hideTotalUsageStats: false, hideLangSelector: false, hideBillingCalculator: false, defaultFilter: 'this_month', periodOverviewMode: 'both', privateMode: false },
    mobile: { hideNotes: false, hideNotifications: false, hideTopApps: false, hideDeviceCards: false, hideTotalUsageStats: false, hideLangSelector: false, hideBillingCalculator: false, defaultFilter: 'this_month', periodOverviewMode: 'both', privateMode: false }
};

let currentSettings = JSON.parse(JSON.stringify(defaultSettings));
let activeBackend = null;
let initialDefaultFilterValue = null;
let currentModalProfile = 'desktop';

// ── Storage Backend Interface ──

class LocalStorageBackend {
    async load() {
        try {
            const raw = localStorage.getItem('settings');
            if (raw) return JSON.parse(raw);
        } catch (e) { /* ignore corrupt data */ }
        return JSON.parse(JSON.stringify(defaultSettings));
    }
    async save(settings) {
        localStorage.setItem('settings', JSON.stringify(settings));
    }
}

// ── Profile Detection ──

function getCurrentProfile() {
    return window.innerWidth < 768 ? 'mobile' : 'desktop';
}

// ── Apply Settings to DOM ──

function applySettings() {
    const profile = getCurrentProfile();
    const s = currentSettings[profile] || {};

    // Notes button + panel
    const notesBtn = document.getElementById('notes-toggle-btn');
    const notesPanel = document.getElementById('notes-panel');
    if (notesBtn) notesBtn.style.display = s.hideNotes ? 'none' : '';
    if (s.hideNotes && notesPanel && !notesPanel.classList.contains('collapsed')) {
        notesPanel.classList.add('collapsed');
    }

    // Notifications button
    const notifBtn = document.getElementById('notifications-toggle-btn');
    if (notifBtn) notifBtn.style.display = s.hideNotifications ? 'none' : '';

    // Top Applications card
    const topAppsCard = document.getElementById('topAppsCard');
    if (topAppsCard) topAppsCard.style.display = s.hideTopApps ? 'none' : '';

    // Total Usage Statistics card
    const totalStatsCard = document.querySelector('.total-stats')?.closest('.card');
    if (totalStatsCard) totalStatsCard.style.display = s.hideTotalUsageStats ? 'none' : '';

    // Language selector
    const langSelector = document.querySelector('.language-selector');
    if (langSelector) langSelector.style.display = s.hideLangSelector ? 'none' : '';

    // Billing period calculator
    const billingCalc = document.querySelector('.billing-controls')?.closest('.control-section');
    if (billingCalc) billingCalc.style.display = s.hideBillingCalculator ? 'none' : '';

    // Period Overview mode
    const poCard = document.getElementById('overview-title')?.closest('.card');
    const poGrid = document.querySelector('.overview-grid');
    if (poCard && poGrid) {
        const containers = poGrid.querySelectorAll('.chart-container');
        const monthlyContainer = containers[0];
        const topDevicesContainer = containers[1];

        function setChartVisibility(container, visible) {
            if (!container) return;
            const h3 = container.querySelector('h3');
            const canvas = container.querySelector('canvas');
            if (h3) h3.style.display = visible ? '' : 'none';
            if (canvas) canvas.style.display = visible ? '' : 'none';
        }

        poGrid.classList.remove('po-top-devices-only');

        switch (s.periodOverviewMode) {
            case 'none':
                poCard.style.display = 'none';
                break;
            case 'monthly_only':
                poCard.style.display = '';
                setChartVisibility(monthlyContainer, true);
                setChartVisibility(topDevicesContainer, false);
                break;
            case 'top_devices_only':
                poCard.style.display = '';
                poGrid.classList.add('po-top-devices-only');
                setChartVisibility(monthlyContainer, false);
                setChartVisibility(topDevicesContainer, true);
                break;
            default:
                poCard.style.display = '';
                setChartVisibility(monthlyContainer, true);
                setChartVisibility(topDevicesContainer, true);
                break;
        }
    }

    // Device table (desktop)
    const deviceTable = document.getElementById('device-table-container');
    if (deviceTable) deviceTable.style.display = s.hideDeviceTable ? 'none' : '';

    // Device cards (mobile)
    const deviceCards = document.getElementById('device-cards-container');
    if (deviceCards) deviceCards.style.display = s.hideDeviceCards ? 'none' : '';

    // Search bar follows the primary viewport element
    const searchInput = document.getElementById('deviceSearch');
    if (searchInput) {
        searchInput.style.display = (profile === 'desktop' ? s.hideDeviceTable : s.hideDeviceCards) ? 'none' : '';
    }

    // When the primary device list is hidden, force saved groups to stay visible
    const primaryListHidden = profile === 'desktop' ? s.hideDeviceTable : s.hideDeviceCards;
    const sgContainer = document.getElementById('saved-groups-container');
    if (primaryListHidden && sgContainer) {
        sgContainer.style.display = '';
    }

    // Palestine solidarity image (desktop only, never controlled on mobile)
    const pkContainer = document.getElementById('palestineKidContainer');
    if (pkContainer && profile === 'desktop') {
        pkContainer.style.display = s.showPalestineImage !== false ? '' : 'none';
    }

    // Private mode: body class, indicator, re-mask visible identity when it changes
    const wantPrivate = !!s.privateMode;
    const wasPrivate = document.body.classList.contains('private-mode');
    applyPrivateModeUi(wantPrivate);
    if (wasPrivate !== wantPrivate) {
        refreshIdentityDisplays();
    }
}

/**
 * Re-render device table/cards/groups/pie labels after private mode toggles.
 */
function refreshIdentityDisplays() {
    const devices = window.currentDevices;

    if (Array.isArray(devices) && devices.length > 0) {
        const tbody = document.getElementById('deviceTableBody');
        if (tbody) {
            tbody.innerHTML = renderTable(devices, null);
        }

        const cardsContainer = document.getElementById('device-cards-container');
        if (cardsContainer && window.matchMedia('(max-width: 768px)').matches) {
            cardsContainer.innerHTML = renderDeviceCards(devices, window.sevenDayDataGlobal || null);
            applyTranslations();
            initializeTooltips();
        }

        if (typeof getSelectedDevices === 'function' && getSelectedDevices().length > 0) {
            updateGroupingUI(devices);
            syncCheckboxes(devices);
        }

        if (window.pieChart && Array.isArray(window.lastPieData)) {
            window.pieChart.data.labels = window.lastPieData.map(d => privateDisplayName(d.name, d.mac));
            window.pieChart.update();
        }
    }

    // Saved group name pills (even if no devices loaded yet)
    if (typeof renderSavedGroups === 'function') {
        renderSavedGroups();
    }

    // Notes tags: update visible label text; keep data-name / data-mac real
    document.querySelectorAll('.device-tag').forEach(tag => {
        const mac = tag.dataset.mac;
        const realName = tag.dataset.name;
        const statsEl = tag.querySelector('.tag-stats');
        const removeEl = tag.querySelector('.tag-remove');
        const statsHtml = statsEl ? statsEl.outerHTML : '<span class="tag-stats"></span>';
        const removeHtml = removeEl ? removeEl.outerHTML : '<span class="tag-remove">&times;</span>';
        tag.innerHTML = `${privateDisplayName(realName, mac)} ${statsHtml}${removeHtml}`;
    });
}

// ── Save Settings ──

async function saveSettings() {
    await activeBackend.save(currentSettings);
    applySettings();
}

// ── Modal ──

function renderQuotaSection(quotaData) {
    if (!quotaData) return '<div class="settings-quota-section"><div class="settings-section-divider">⚡ Quota Limits</div><p class="settings-quota-loading">Loading...</p></div>';
    return `
        <div class="settings-quota-section">
            <div class="settings-section-divider">⚡ Quota Limits</div>
            <div class="settings-quota-row">
                <label for="quota-daily">Daily Quota (GB):</label>
                <input type="number" class="settings-quota-input" id="quota-daily" data-key="daily_quota_gb" min="1" value="${quotaData.daily_quota_gb}">
            </div>
            <div class="settings-quota-row">
                <label for="quota-weekly">Weekly Quota (GB):</label>
                <input type="number" class="settings-quota-input" id="quota-weekly" data-key="weekly_quota_gb" min="1" value="${quotaData.weekly_quota_gb}">
            </div>
            <div class="settings-quota-row">
                <label for="quota-monthly">Monthly Quota (GB):</label>
                <input type="number" class="settings-quota-input" id="quota-monthly" data-key="monthly_quota_gb" min="1" value="${quotaData.monthly_quota_gb}">
            </div>
            <div class="settings-quota-row">
                <label for="quota-alert">Device High Usage Alert (GB):</label>
                <input type="number" class="settings-quota-input" id="quota-alert" data-key="device_high_usage_alert_gb" min="1" value="${quotaData.device_high_usage_alert_gb}">
            </div>
            <button class="settings-quota-update-btn" id="settingsQuotaUpdateBtn">⟳ Update Quota</button>
            <div class="settings-quota-status" id="settingsQuotaStatus"></div>
        </div>`;
}

function renderSettingsModal(quotaData) {
    const profile = currentModalProfile;
    const s = currentSettings[profile] || {};
    const isDesktop = profile === 'desktop';
    const quotaSection = renderQuotaSection(quotaData);

    const profileTabs = `
        <div class="settings-profile-tabs">
            <button class="settings-profile-tab ${profile === 'mobile' ? 'active' : ''}" data-profile="mobile">📱 Mobile</button>
            <button class="settings-profile-tab ${profile === 'desktop' ? 'active' : ''}" data-profile="desktop">🖥️ Desktop</button>
        </div>`;

    const checkboxes = `
        <label class="settings-checkbox">
            <input type="checkbox" class="settings-toggle" data-key="hideNotes" ${!s.hideNotes ? 'checked' : ''}>
            <span>Show Notes button</span>
        </label>
        <label class="settings-checkbox">
            <input type="checkbox" class="settings-toggle" data-key="hideNotifications" ${!s.hideNotifications ? 'checked' : ''}>
            <span>Show Notifications button</span>
        </label>
        <label class="settings-checkbox">
            <input type="checkbox" class="settings-toggle" data-key="hideTopApps" ${!s.hideTopApps ? 'checked' : ''}>
            <span>Show Top Apps/Sites card (main dashboard)</span>
        </label>
        <label class="settings-checkbox">
            <input type="checkbox" class="settings-toggle" data-key="hideTotalUsageStats" ${!s.hideTotalUsageStats ? 'checked' : ''}>
            <span>Show Total Usage Statistics card</span>
        </label>
        <label class="settings-checkbox">
            <input type="checkbox" class="settings-toggle" data-key="hideLangSelector" ${!s.hideLangSelector ? 'checked' : ''}>
            <span>Show language selector</span>
        </label>
        <label class="settings-checkbox">
            <input type="checkbox" class="settings-toggle" data-key="hideBillingCalculator" ${!s.hideBillingCalculator ? 'checked' : ''}>
            <span>Show billing period calculator</span>
        </label>
        ${isDesktop ? `
        <label class="settings-checkbox">
            <input type="checkbox" class="settings-toggle" data-key="showPalestineImage" ${s.showPalestineImage !== false ? 'checked' : ''}>
            <span>Show Palestine solidarity image (desktop)</span>
        </label>
        <label class="settings-checkbox">
            <input type="checkbox" class="settings-toggle" data-key="hideDeviceTable" ${!s.hideDeviceTable ? 'checked' : ''}>
            <span>Show device table</span>
        </label>
        <div class="settings-checkbox settings-switch-row">
            <span>Private mode (hide sensitive info)</span>
            <label class="settings-switch">
                <input type="checkbox" class="settings-toggle" data-key="privateMode" ${s.privateMode ? 'checked' : ''}>
                <span class="settings-switch-track" aria-hidden="true">
                    <span class="settings-switch-thumb"></span>
                    <span class="settings-switch-text on">ON</span>
                    <span class="settings-switch-text off">OFF</span>
                </span>
            </label>
        </div>
        <div class="settings-filter-row">
            <label for="periodOverviewSelect">Period Charts card:</label>
            <select class="settings-select" id="periodOverviewSelect">
                <option value="both" ${s.periodOverviewMode === 'both' ? 'selected' : ''}>Show All</option>
                <option value="monthly_only" ${s.periodOverviewMode === 'monthly_only' ? 'selected' : ''}>Bar Chart Only</option>
                <option value="top_devices_only" ${s.periodOverviewMode === 'top_devices_only' ? 'selected' : ''}>Pie Chart Only</option>
                <option value="none" ${s.periodOverviewMode === 'none' ? 'selected' : ''}>Hide All</option>
            </select>
        </div>
        <div class="settings-filter-row">
            <label for="defaultFilterSelect">Default time period on load:</label>
            <select class="settings-select" id="defaultFilterSelect">
                <option value="this_month" ${s.defaultFilter === 'this_month' ? 'selected' : ''}>Current Month</option>
                <option value="today" ${s.defaultFilter === 'today' ? 'selected' : ''}>Today</option>
                <option value="yesterday" ${s.defaultFilter === 'yesterday' ? 'selected' : ''}>Yesterday</option>
                <option value="last_7_days" ${s.defaultFilter === 'last_7_days' ? 'selected' : ''}>Last 7 Days</option>
                <option value="all_time" ${s.defaultFilter === 'all_time' ? 'selected' : ''}>All Time</option>
            </select>
        </div>` : ''}
        ${!isDesktop ? `
        <label class="settings-checkbox">
            <input type="checkbox" class="settings-toggle" data-key="hideDeviceCards" ${!s.hideDeviceCards ? 'checked' : ''}>
            <span>Show device cards</span>
        </label>
        <div class="settings-checkbox settings-switch-row">
            <span>Private mode (hide sensitive info)</span>
            <label class="settings-switch">
                <input type="checkbox" class="settings-toggle" data-key="privateMode" ${s.privateMode ? 'checked' : ''}>
                <span class="settings-switch-track" aria-hidden="true">
                    <span class="settings-switch-thumb"></span>
                    <span class="settings-switch-text on">ON</span>
                    <span class="settings-switch-text off">OFF</span>
                </span>
            </label>
        </div>
        <div class="settings-filter-row">
            <label for="periodOverviewSelect">Period Charts card:</label>
            <select class="settings-select" id="periodOverviewSelect">
                <option value="both" ${s.periodOverviewMode === 'both' ? 'selected' : ''}>Show All</option>
                <option value="monthly_only" ${s.periodOverviewMode === 'monthly_only' ? 'selected' : ''}>Bar Chart Only</option>
                <option value="top_devices_only" ${s.periodOverviewMode === 'top_devices_only' ? 'selected' : ''}>Pie Chart Only</option>
                <option value="none" ${s.periodOverviewMode === 'none' ? 'selected' : ''}>Hide All</option>
            </select>
        </div>
        <div class="settings-filter-row">
            <label for="defaultFilterSelect">Default time period on load:</label>
            <select class="settings-select" id="defaultFilterSelect">
                <option value="this_month" ${s.defaultFilter === 'this_month' ? 'selected' : ''}>Current Month</option>
                <option value="today" ${s.defaultFilter === 'today' ? 'selected' : ''}>Today</option>
                <option value="yesterday" ${s.defaultFilter === 'yesterday' ? 'selected' : ''}>Yesterday</option>
                <option value="last_7_days" ${s.defaultFilter === 'last_7_days' ? 'selected' : ''}>Last 7 Days</option>
                <option value="all_time" ${s.defaultFilter === 'all_time' ? 'selected' : ''}>All Time</option>
            </select>
        </div>` : ''}
        `;

    return `
        <div class="settings-overlay" id="settingsOverlay">
            <div class="settings-modal">
                <div class="settings-header">
                    <h3>⚙️ Dashboard Settings</h3>
                    <button class="settings-close-btn" id="settingsCloseBtn">&times;</button>
                </div>
                <div class="settings-body">
                    ${profileTabs}
                    <div class="settings-checkboxes">
                        ${checkboxes}
                    </div>
                    ${quotaSection}
                </div>
                <div class="settings-footer">
                    <button class="settings-reset-btn" id="settingsResetBtn">🔄 Reset to defaults</button>
                    <div class="settings-footer-actions">
                        <button class="btn-cancel" id="settingsCancelBtn">Cancel</button>
                        <button class="btn-create" id="settingsSaveBtn">Save</button>
                    </div>
                </div>
            </div>
        </div>`;
}

export async function openSettingsModal() {
    currentModalProfile = getCurrentProfile();
    let overlay = document.getElementById('settingsOverlay');
    if (overlay) overlay.remove();

    // Fetch current quota values
    let quotaData = null;
    try {
        const res = await fetch('/api/settings/quota');
        if (res.ok) quotaData = await res.json();
    } catch (e) { /* settings.js/api/settings/quota not available */ }

    document.body.insertAdjacentHTML('beforeend', renderSettingsModal(quotaData));
    overlay = document.getElementById('settingsOverlay');
    overlay.style.display = 'flex';

    const fs = document.getElementById('defaultFilterSelect');
    if (fs) initialDefaultFilterValue = fs.value;

    // Profile tab switching
    overlay.querySelectorAll('.settings-profile-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentModalProfile = tab.dataset.profile;
            // Re-render checkboxes
            const checkboxesDiv = overlay.querySelector('.settings-checkboxes');
            const s = currentSettings[currentModalProfile] || {};
            const isDesktop = currentModalProfile === 'desktop';
            checkboxesDiv.innerHTML = `
                <label class="settings-checkbox">
                    <input type="checkbox" class="settings-toggle" data-key="hideNotes" ${!s.hideNotes ? 'checked' : ''}>
                    <span>Show Notes button</span>
                </label>
                <label class="settings-checkbox">
                    <input type="checkbox" class="settings-toggle" data-key="hideNotifications" ${!s.hideNotifications ? 'checked' : ''}>
                    <span>Show Notifications button</span>
                </label>
                <label class="settings-checkbox">
                    <input type="checkbox" class="settings-toggle" data-key="hideTopApps" ${!s.hideTopApps ? 'checked' : ''}>
                    <span>Show Top Apps/Sites card (main dashboard)</span>
                </label>
                <label class="settings-checkbox">
                    <input type="checkbox" class="settings-toggle" data-key="hideTotalUsageStats" ${!s.hideTotalUsageStats ? 'checked' : ''}>
                    <span>Show Total Usage Statistics card</span>
                </label>
                <label class="settings-checkbox">
                    <input type="checkbox" class="settings-toggle" data-key="hideLangSelector" ${!s.hideLangSelector ? 'checked' : ''}>
                    <span>Show language selector</span>
                </label>
                <label class="settings-checkbox">
                    <input type="checkbox" class="settings-toggle" data-key="hideBillingCalculator" ${!s.hideBillingCalculator ? 'checked' : ''}>
                    <span>Show billing period calculator</span>
                </label>
                ${isDesktop ? `
                <label class="settings-checkbox">
                    <input type="checkbox" class="settings-toggle" data-key="showPalestineImage" ${s.showPalestineImage !== false ? 'checked' : ''}>
                    <span>Show Palestine solidarity image (desktop)</span>
                </label>
                <label class="settings-checkbox">
                    <input type="checkbox" class="settings-toggle" data-key="hideDeviceTable" ${!s.hideDeviceTable ? 'checked' : ''}>
                    <span>Show device table</span>
                </label>
                <div class="settings-checkbox settings-switch-row">
                    <span>Private mode (hide sensitive info)</span>
                    <label class="settings-switch">
                        <input type="checkbox" class="settings-toggle" data-key="privateMode" ${s.privateMode ? 'checked' : ''}>
                        <span class="settings-switch-track" aria-hidden="true">
                            <span class="settings-switch-thumb"></span>
                            <span class="settings-switch-text on">ON</span>
                            <span class="settings-switch-text off">OFF</span>
                        </span>
                    </label>
                </div>
                <div class="settings-filter-row">
                    <label for="periodOverviewSelect">Period Charts card:</label>
                    <select class="settings-select" id="periodOverviewSelect">
                        <option value="both" ${s.periodOverviewMode === 'both' ? 'selected' : ''}>Show All</option>
                        <option value="monthly_only" ${s.periodOverviewMode === 'monthly_only' ? 'selected' : ''}>Bar Chart Only</option>
                        <option value="top_devices_only" ${s.periodOverviewMode === 'top_devices_only' ? 'selected' : ''}>Pie Chart Only</option>
                        <option value="none" ${s.periodOverviewMode === 'none' ? 'selected' : ''}>Hide All</option>
                    </select>
                </div>
                <div class="settings-filter-row">
                    <label for="defaultFilterSelect">Default time period on load:</label>
                    <select class="settings-select" id="defaultFilterSelect">
                        <option value="this_month" ${s.defaultFilter === 'this_month' ? 'selected' : ''}>Current Month</option>
                        <option value="today" ${s.defaultFilter === 'today' ? 'selected' : ''}>Today</option>
                        <option value="yesterday" ${s.defaultFilter === 'yesterday' ? 'selected' : ''}>Yesterday</option>
                        <option value="last_7_days" ${s.defaultFilter === 'last_7_days' ? 'selected' : ''}>Last 7 Days</option>
                        <option value="all_time" ${s.defaultFilter === 'all_time' ? 'selected' : ''}>All Time</option>
                    </select>
                </div>` : ''}
                ${!isDesktop ? `
                <label class="settings-checkbox">
                    <input type="checkbox" class="settings-toggle" data-key="hideDeviceCards" ${!s.hideDeviceCards ? 'checked' : ''}>
                    <span>Show device cards</span>
                </label>
                <div class="settings-checkbox settings-switch-row">
                    <span>Private mode (hide sensitive info)</span>
                    <label class="settings-switch">
                        <input type="checkbox" class="settings-toggle" data-key="privateMode" ${s.privateMode ? 'checked' : ''}>
                        <span class="settings-switch-track" aria-hidden="true">
                            <span class="settings-switch-thumb"></span>
                            <span class="settings-switch-text on">ON</span>
                            <span class="settings-switch-text off">OFF</span>
                        </span>
                    </label>
                </div>
                <div class="settings-filter-row">
                    <label for="periodOverviewSelect">Period Charts card:</label>
                    <select class="settings-select" id="periodOverviewSelect">
                        <option value="both" ${s.periodOverviewMode === 'both' ? 'selected' : ''}>Show All</option>
                        <option value="monthly_only" ${s.periodOverviewMode === 'monthly_only' ? 'selected' : ''}>Bar Chart Only</option>
                        <option value="top_devices_only" ${s.periodOverviewMode === 'top_devices_only' ? 'selected' : ''}>Pie Chart Only</option>
                        <option value="none" ${s.periodOverviewMode === 'none' ? 'selected' : ''}>Hide All</option>
                    </select>
                </div>
                <div class="settings-filter-row">
                    <label for="defaultFilterSelect">Default time period on load:</label>
                    <select class="settings-select" id="defaultFilterSelect">
                        <option value="this_month" ${s.defaultFilter === 'this_month' ? 'selected' : ''}>Current Month</option>
                        <option value="today" ${s.defaultFilter === 'today' ? 'selected' : ''}>Today</option>
                        <option value="yesterday" ${s.defaultFilter === 'yesterday' ? 'selected' : ''}>Yesterday</option>
                        <option value="last_7_days" ${s.defaultFilter === 'last_7_days' ? 'selected' : ''}>Last 7 Days</option>
                        <option value="all_time" ${s.defaultFilter === 'all_time' ? 'selected' : ''}>All Time</option>
                    </select>
                </div>` : ''}
        `;
            overlay.querySelectorAll('.settings-profile-tab').forEach(t => t.classList.toggle('active', t.dataset.profile === currentModalProfile));
            const fs2 = document.getElementById('defaultFilterSelect');
            if (fs2) initialDefaultFilterValue = fs2.value;
        });
    });

    // Close handlers
    function closeModal() {
        overlay.style.display = 'none';
        overlay.remove();
    }

    document.getElementById('settingsCloseBtn').addEventListener('click', closeModal);
    document.getElementById('settingsCancelBtn').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    // Save visibility settings
    document.getElementById('settingsSaveBtn').addEventListener('click', async () => {
        overlay.querySelectorAll('.settings-toggle').forEach(cb => {
            const key = cb.dataset.key;
            if (key === 'privateMode') {
                currentSettings[currentModalProfile][key] = cb.checked;
            } else {
                currentSettings[currentModalProfile][key] = key.startsWith('show') ? cb.checked : !cb.checked;
            }
        });
        const filterSelect = document.getElementById('defaultFilterSelect');
        if (filterSelect) {
            currentSettings[currentModalProfile].defaultFilter = filterSelect.value;
            if (filterSelect.value !== initialDefaultFilterValue && typeof window.applyFilter === 'function') {
                window.applyFilter(filterSelect.value);
            }
        }
        const poSelect = document.getElementById('periodOverviewSelect');
        if (poSelect) {
            currentSettings[currentModalProfile].periodOverviewMode = poSelect.value;
        }
        await saveSettings();
        closeModal();
    });

    // Reset visibility settings
    document.getElementById('settingsResetBtn').addEventListener('click', async () => {
        if (!confirm('Reset all settings to defaults?')) return;
        currentSettings = JSON.parse(JSON.stringify(defaultSettings));
        await saveSettings();
        // Re-render checkboxes
        const s = currentSettings[currentModalProfile] || {};
        overlay.querySelectorAll('.settings-toggle').forEach(cb => {
            const key = cb.dataset.key;
            if (key === 'privateMode') {
                cb.checked = !!s[key];
            } else {
                cb.checked = key.startsWith('show') ? s[key] : !s[key];
            }
        });
        const filterSelect = document.getElementById('defaultFilterSelect');
        if (filterSelect) {
            filterSelect.value = s.defaultFilter || 'this_month';
        }
        const poSelect = document.getElementById('periodOverviewSelect');
        if (poSelect) {
            poSelect.value = s.periodOverviewMode || 'both';
        }
        closeModal();
    });

    // Update quota
    const quotaUpdateBtn = document.getElementById('settingsQuotaUpdateBtn');
    if (quotaUpdateBtn) {
        quotaUpdateBtn.addEventListener('click', async () => {
            const statusEl = document.getElementById('settingsQuotaStatus');
            statusEl.textContent = 'Updating...';
            statusEl.className = 'settings-quota-status';
            const payload = {};
            overlay.querySelectorAll('.settings-quota-input').forEach(input => {
                payload[input.dataset.key] = parseInt(input.value, 10);
            });
            try {
                const res = await fetch('/api/settings/quota', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.success) {
                    statusEl.textContent = '✅ Quota updated. Refreshing data...';
                    statusEl.className = 'settings-quota-status success';
                } else {
                    statusEl.textContent = '❌ ' + (data.error || 'Failed to update');
                    statusEl.className = 'settings-quota-status error';
                }
            } catch (e) {
                statusEl.textContent = '❌ Network error';
                statusEl.className = 'settings-quota-status error';
            }
        });
    }
}

// ── Init ──

export async function initSettings() {
    if (!activeBackend) {
        activeBackend = new LocalStorageBackend();
    }
    const loaded = await activeBackend.load();
    // Merge defaults so older localStorage blobs gain new keys (e.g. privateMode)
    currentSettings = {
        desktop: { ...defaultSettings.desktop, ...(loaded.desktop || {}) },
        mobile: { ...defaultSettings.mobile, ...(loaded.mobile || {}) }
    };
    applySettings();

    // Re-apply on resize (mobile ↔ desktop switch)
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(applySettings, 200);
    });

    // Re-apply when content modules signal readiness (e.g. initPalestineKid)
    window.addEventListener('settingsContentReady', applySettings);

    // Watch for resetGroupingUI hiding saved groups when the primary list is hidden
    const sgContainer = document.getElementById('saved-groups-container');
    if (sgContainer) {
        const observer = new MutationObserver(() => {
            const profile = getCurrentProfile();
            const s = currentSettings[profile] || {};
            const primaryListHidden = profile === 'desktop' ? s.hideDeviceTable : s.hideDeviceCards;
            if (primaryListHidden && sgContainer.style.display === 'none') {
                sgContainer.style.display = '';
            }
        });
        observer.observe(sgContainer, { attributes: true, attributeFilter: ['style'] });
    }
}

// External trigger for content modules to signal readiness
export function signalContentReady() {
    window.dispatchEvent(new CustomEvent('settingsContentReady'));
}

// For external re-apply after other modules load dynamic elements
export function reapplySettings() {
    applySettings();
}
