/**
 * SkyHero Notifications Module
 * Handles notification rules, provider config, history, and manual messages.
 */

import { translate } from './i18n.js';

// =============================================================================

// State
// =============================================================================

let currentProvider = null;
let currentConfig = {};
let rules = [];
let history = [];
let topAppsData = { items: [], has_data: false };
let devicesData = { devices: [], has_data: false };
let topics = [];
let historyPollInterval = null;

// =============================================================================
// Initialization
// =============================================================================

export function initNotifications() {
    // Create modal HTML if not exists
    createModalHTML();
    
    // Wire up events
    wireUpEvents();
    
    // Load initial data
    // Order matters: loadDevices must complete BEFORE loadRules so names resolve in renderRules()
    loadProviderConfig();
    loadTopics();
    loadDevices().then(() => {
        // devicesData is now populated, safe to render rules with device names
        loadRules();
    });
    loadHistory();
    loadTopApps();
}

function createModalHTML() {
    // Check if modal already exists
    if (document.getElementById('notifOverlay')) return;
    
    const modalHTML = `
        <div class="notif-overlay" id="notifOverlay">
            <div class="notif-modal">
                <div class="notif-modal-header">
                    <h2>🔔 Notifications Center</h2>
                    <button class="notif-close-btn" id="notifCloseBtn">&times;</button>
                </div>
                <div class="notif-modal-body">
                    <!-- Sidebar -->
                    <div class="notif-sidebar">
                        <div class="notif-sidebar-item active" data-tab="system-rules">
                            <span class="sidebar-icon">⚙️</span>
                            <span class="sidebar-label">System Rules</span>
                            <span class="sidebar-badge" id="ruleCount">0</span>
                        </div>
                        <div class="notif-sidebar-item" data-tab="send-message">
                            <span class="sidebar-icon">💬</span>
                            <span class="sidebar-label">Send Message</span>
                        </div>
                        <div class="notif-sidebar-item" data-tab="sent-history">
                            <span class="sidebar-icon">📋</span>
                            <span class="sidebar-label">Sent History</span>
                        </div>
                    </div>

                    <!-- Content -->
                    <div class="notif-content">

                        <!-- ========= TAB 1: System Rules ========= -->
                        <div class="tab-panel active" id="tab-system-rules">

                            <!-- Status Banner -->
                            <div class="ntfy-banner not-installed" id="ntfyBanner">
                                <span class="banner-icon">⚠️</span>
                                <span>
                                    <strong>No notification provider configured.</strong> Click ⚙️ to set up Ntfy, Gotify, Pushover, or a custom webhook.
                                </span>
                            </div>

                            <div class="persist-note">Rules are persisted to <code>data/notification_rules.json</code>.</div>

                            <div class="rule-toolbar">
                                <span style="font-size:0.82rem; color:var(--text-muted);" id="ruleSummary">0 rules · 0 active</span>
                                <div style="display: flex; gap: 8px;">
                                    <button class="notif-config-btn" id="notifConfigBtn" title="Provider Settings">⚙️</button>
                                    <button class="add-rule-btn" id="addRuleBtn">
                                        <span class="plus">+</span> Add Rule
                                    </button>
                                </div>
                            </div>

                            <!-- === NEW RULE FORM === -->
                            <div class="new-rule-form" id="newRuleForm">
                                <h4>➕ New Notification Rule</h4>
                                <div class="form-row">
                                    <label>Rule Name</label>
                                    <div class="form-control">
                                        <input type="text" class="form-input" id="newRuleName" placeholder="e.g., Netflix overuse alert">
                                    </div>
                                </div>
                                <div class="form-row">
                                    <label>Period</label>
                                    <div class="form-control">
                                        <select class="form-select" id="newRulePeriod">
                                            <option value="today">Today</option>
                                            <option value="weekly">Weekly (Last 7 Days)</option>
                                            <option value="monthly" selected>Monthly</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-row">
                                    <label>Trigger</label>
                                    <div class="form-control">
                                        <select class="form-select" id="newRuleTrigger">
                                            <option value="download">Download exceeds</option>
                                            <option value="upload">Upload exceeds</option>
                                            <option value="total">Total usage exceeds</option>
                                            <option value="avg_daily">Avg Daily Traffic exceeds</option>
                                            <option value="specific_app">Specific App/Website exceeds</option>
                                            <option value="any_app_exceeds">Any App/Website exceeds</option>
                                            <option value="new_device">New unknown device detected</option>
                                            <option value="db_restore" class="wip-option">Database restored from backup</option>
                                            <option value="daily_summary" class="wip-option">Daily summary report</option>
                                        </select>
                                        <div id="newRuleWipNotice" style="display:none; margin-top:4px; padding:4px 6px; background:rgba(255,193,7,0.15); border-left:2px solid #ffc107; border-radius:3px; font-size:0.78rem; color:var(--text-color,#e2e8f0);">⏳ Coming soon — not yet implemented</div>
                                    </div>
                                </div>
                                <div class="form-row" id="newRuleThresholdRow">
                                    <label>Threshold</label>
                                    <div class="form-control">
                                        <div class="threshold-row">
                                            <input type="number" class="threshold-input" id="newRuleThreshold" value="50">
                                            <span class="threshold-unit" id="newRuleUnit">GB</span>
                                        </div>
                                    </div>
                                </div>
                                <div class="form-row" id="newRuleAppRow" style="display:none;">
                                    <label>App / Website</label>
                                    <div class="form-control">
                                        <select class="app-select" id="newRuleApp">
                                            <option value="" disabled selected>Loading...</option>
                                        </select>
                                        <div class="template-vars-hint" style="margin-top:4px;">
                                            Populated from dashboard traffic data.
                                        </div>
                                    </div>
                                </div>
                                <div class="form-row" id="newRuleDevicesRow">
                                    <label>Devices</label>
                                    <div class="form-control">
                                        <div class="device-pill-group" id="newRuleDevices">
                                            <span class="add-device-pill-btn" id="addDeviceBtn">+ Select devices</span>
                                        </div>
                                        <div class="template-vars-hint" style="margin-top:4px;" id="newRuleDevicesHint">
                                            Leave empty for Dashboard Total. Select devices for per-device alerts.
                                        </div>
                                    </div>
                                </div>
                                <div class="form-row" id="newRuleAlertTargetRow">
                                    <label>Alert target:</label>
                                    <div class="form-control">
                                        <div class="alert-target-pill-group" id="newRuleAlertTargets">
                                            <span class="add-alert-target-pill-btn" id="addAlertTargetBtn">+ Add targets</span>
                                        </div>
                                        <div class="template-vars-hint" style="margin-top:4px;">
                                            Select where to send alerts. Default set in provider settings.
                                        </div>
                                    </div>
                                </div>
                                <div class="form-row">
                                    <label>Message</label>
                                    <div class="form-control" style="position: relative;">
                                        <textarea class="msg-template-input" id="newRuleMessage" rows="2" placeholder="⚠️ {device_name} used {used_gb} GB of {app_name}"></textarea>
                                        <button type="button" class="emoji-picker-btn" onclick="showEmojiPicker(this, 'newRuleMessage', event)">😊</button>
                                        <div class="template-vars-hint" id="newRuleMessageHint">
                                            Common variables: <code>{threshold}</code> <code>{trigger_type}</code> <code>{period}</code><br>
                                            <small style="color: var(--notif-text-muted);">📊 Dashboard Total: <code>{total_gb}</code> <code>{top_3_devices}</code></small><br>
                                            <small style="color: var(--notif-text-muted);">📱 Per-Device: <code>{device_name}</code> <code>{used_gb}</code> <code>{mac_address}</code></small>
                                        </div>
                                    </div>
                                </div>
                                <div class="form-actions">
                                    <button class="btn-cancel" id="cancelNewRule">Cancel</button>
                                    <button class="btn-create" id="createNewRule">Create Rule</button>
                                </div>
                            </div>

                            <!-- === Rule List === -->
                            <div id="ruleList"></div>
                        </div>
                        
                        <!-- ========= TAB 2: Send Message ========= -->
                        <div class="tab-panel" id="tab-send-message">
                            <div class="send-msg-section">
                                <div class="form-group">
                                    <label>Title (optional)</label>
                                    <input type="text" id="sendTitle" placeholder="e.g., Dinner Alert">
                                </div>
                                <div class="form-group send-msg-group" style="position: relative;">
                                    <label>Message</label>
                                    <textarea id="sendMessage" placeholder="Type your message..." style="min-height: 100px; padding-right: 30px;"></textarea>
                                    <button type="button" class="emoji-picker-btn" onclick="showEmojiPicker(this, 'sendMessage', event)">😊</button>
                                </div>
                                <div class="attachment-section" id="attachmentSection">
                                    <div class="attachment-row">
                                        <input type="file" id="attachmentFile" accept="image/*,.pdf,.txt,.log,.zip" style="display:none;">
                                        <button class="attach-btn" id="chooseFileBtn" title="Attach file">📎</button>
                                        <input type="text" id="attachmentUrl" class="attach-url-input" placeholder="Or paste image URL" style="display:none;">
                                        <span class="file-name" id="fileName"></span>
                                        <button class="remove-file-btn" id="removeFileBtn" title="Remove file" style="display:none;">×</button>
                                    </div>
                                    <div class="attachment-size-hint" id="attachmentSizeHint"></div>
                                </div>
                                <div class="form-group">
                                    <label>Send to</label>
                                    <div class="quick-targets-wrapper">
                                        <div class="quick-targets" id="quickTargets">
                                            <!-- Populated dynamically by updateQuickTargets() -->
                                        </div>
                                        <button class="add-topic-btn" id="addTopicBtn">
                                            + Add Topic/Category
                                        </button>
                                    </div>
                                </div>
                                <button class="send-msg-btn" id="sendMsgBtn">📤 Send Message</button>
                            </div>
                        </div>
                        
                        <!-- ========= TAB 3: Sent History ========= -->
                        <div class="tab-panel" id="tab-sent-history">
                            <div class="persist-note">History persisted to <code>data/notification_history.json</code>.</div>
                            <table class="history-table">
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>Type</th>
                                        <th>Target</th>
                                        <th>Message</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody id="historyTbody"></tbody>
                            </table>
                        </div>

                    </div>
                </div>
            </div>
        </div>
        
        <!-- Provider Config Modal -->
        <div class="notif-config-overlay" id="notifConfigOverlay">
            <div class="notif-config-panel">
                <h3>⚙️ Notification Service Config</h3>
                <label style="font-size: 13px; color: #888; margin-bottom: 6px; display: block;">Provider</label>
                <select class="form-select" id="providerSelect" style="margin-bottom: 16px;">
                    <option value="ntfy">Ntfy (self-hosted or cloud)</option>
                    <option value="gotify">Gotify (self-hosted)</option>
                    <option value="pushover">Pushover (cloud service)</option>
                    <option value="webhook">Custom Webhook</option>
                </select>
                
                <!-- Ntfy Fields -->
                <div class="provider-fields" id="ntfyFields">
                    <div class="form-group">
                        <label>Server URL</label>
                        <input type="text" id="ntfyUrl" placeholder="http://192.168.1.100:8082">
                    </div>
                    <div class="form-group">
                        <label>Topic</label>
                        <input type="text" id="ntfyTopic" placeholder="skyhero-alerts">
                    </div>
                    <div class="form-group" style="margin-top: 12px;">
                        <label class="toggle-label">
                            <input type="checkbox" id="ntfyAuthEnabled">
                            <span>Authentication (self-hosted only)</span>
                        </label>
                    </div>
                    <div id="ntfyAuthFields" style="display: none; margin-top: 8px;">
                        <div class="form-group">
                            <label>Username</label>
                            <input type="text" id="ntfyUsername" placeholder="skyhero-server">
                        </div>
                        <div class="form-group">
                            <label>Password</label>
                            <input type="password" id="ntfyPassword" placeholder="••••••••">
                        </div>
                    </div>
                    <div class="provider-hint">
                        💡 Ntfy can run on your router, PC, NAS, or use ntfy.sh
                    </div>
                </div>
                
                <!-- Gotify Fields -->
                <div class="provider-fields" id="gotifyFields" style="display: none;">
                    <div class="form-group">
                        <label>Server URL</label>
                        <input type="text" id="gotifyUrl" placeholder="http://192.168.1.100:8080">
                    </div>
                    <div class="form-group">
                        <label>App Token</label>
                        <input type="text" id="gotifyToken" placeholder="A1B2C3D4E5F6...">
                    </div>
                    <div class="provider-hint">
                        💡 Self-hosted notification server
                    </div>
                </div>
                
                <!-- Pushover Fields -->
                <div class="provider-fields" id="pushoverFields" style="display: none;">
                    <div class="form-group">
                        <label>User Key</label>
                        <input type="text" id="pushoverUserKey" placeholder="u1234abcd5678efgh...">
                    </div>
                    <div class="form-group">
                        <label>App Token</label>
                        <input type="text" id="pushoverAppToken" placeholder="a1b2c3d4e5f6g7h8...">
                    </div>
                    <div class="provider-hint">
                        💡 Cloud-based push notifications (pushover.net)<br>
                        Free tier: 10,000 messages/month
                    </div>
                </div>
                
                <!-- Webhook Fields -->
                <div class="provider-fields" id="webhookFields" style="display: none;">
                    <div class="form-group">
                        <label>Webhook URL</label>
                        <input type="text" id="webhookUrl" placeholder="https://your-server.com/webhook">
                    </div>
                    <div class="form-group">
                        <label>Headers (optional, one per line)</label>
                        <input type="text" id="webhookHeaders" placeholder="Authorization: Bearer xxx">
                    </div>
                    <div class="provider-hint">
                        💡 For advanced users with custom integrations
                    </div>
                </div>
                
                <div class="form-actions" style="margin-top: 16px;">
                    <button class="btn-cancel" id="cancelConfigBtn">Cancel</button>
                    <button class="btn-cancel" id="testConfigBtn">Test Connection</button>
                    <button class="btn-create" id="saveConfigBtn">Save</button>
                </div>
            </div>
        </div>
        
        <!-- Topic Manager Modal -->
        <div class="notif-topic-overlay" id="notifTopicOverlay">
            <div class="notif-topic-panel">
                <h3 id="topicModalTitle">➕ Create Topic/Category</h3>
                <div class="form-group">
                    <label>Topic Name</label>
                    <input type="text" id="topicName" placeholder="e.g., Dad's Devices">
                    <div class="template-vars-hint" style="margin-top:4px;">
                        Give it a friendly name to remember who this is for
                    </div>
                </div>
                <div class="form-group" id="topicProviderField">
                    <label id="topicProviderLabel">Ntfy Topic</label>
                    <input type="text" id="topicProviderIdentifier" placeholder="e.g., skyhero-dad">
                    <div class="provider-hint" id="topicProviderHint" style="margin-top:6px;">
                        💡 This is the topic name that devices will subscribe to in the Ntfy app
                    </div>
                </div>
                <div class="form-group">
                    <label>Reference Devices (optional)</label>
                    <div class="device-pill-group" id="topicDevices">
                        <span class="add-device-pill-btn" id="topicAddDeviceBtn">+ Select devices</span>
                    </div>
                    <div class="template-vars-hint" style="margin-top:4px;">
                        These are just hints to help you remember which devices should subscribe to this topic
                    </div>
                </div>
                <div class="form-actions" style="margin-top: 16px;">
                    <button class="btn-cancel" id="cancelTopicBtn">Cancel</button>
                    <button class="btn-create" id="saveTopicBtn" data-topic-id="">Create</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function wireUpEvents() {
    const overlay = document.getElementById('notifOverlay');
    const closeBtn = document.getElementById('notifCloseBtn');
    
    // Modal close
    closeBtn.addEventListener('click', () => {
        overlay.classList.remove('open');
        document.body.style.overflow = '';
        if (historyPollInterval) {
            clearInterval(historyPollInterval);
            historyPollInterval = null;
        }
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('open');
            document.body.style.overflow = '';
            if (historyPollInterval) {
                clearInterval(historyPollInterval);
                historyPollInterval = null;
            }
        }
    });
    
    // Tab switching
    const sidebarItems = document.querySelectorAll('.notif-sidebar-item');
    const tabPanels = document.querySelectorAll('.tab-panel');
    
    sidebarItems.forEach(item => {
    item.addEventListener('click', () => {
        sidebarItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        const tabId = item.dataset.tab;
        tabPanels.forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));
        
        // Handle history polling
        if (tabId === 'sent-history') {
            if (historyPollInterval) clearInterval(historyPollInterval);
            loadHistory();
            historyPollInterval = setInterval(loadHistory, 10000);
        } else {
            if (historyPollInterval) {
                clearInterval(historyPollInterval);
                historyPollInterval = null;
            }
        }
    });
    });
    
    // Add rule form
    const addRuleBtn = document.getElementById('addRuleBtn');
    const newRuleForm = document.getElementById('newRuleForm');
    const cancelNewRule = document.getElementById('cancelNewRule');
    const createNewRule = document.getElementById('createNewRule');
    const triggerSelect = document.getElementById('newRuleTrigger');
    const thresholdRow = document.getElementById('newRuleThresholdRow');
    const appRow = document.getElementById('newRuleAppRow');
    
    addRuleBtn.addEventListener('click', () => {
        newRuleForm.classList.add('open');
        newRuleForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        updateNewRuleHint();
    });
    
    cancelNewRule.addEventListener('click', () => {
        newRuleForm.classList.remove('open');
        resetNewRuleForm();
    });
    
    triggerSelect.addEventListener('change', () => {
        const v = triggerSelect.value;
        const wipTriggers = ['db_restore', 'daily_summary'];
        const noThreshold = ['new_device', ...wipTriggers];
        thresholdRow.style.display = noThreshold.includes(v) ? 'none' : 'flex';
        appRow.style.display = v === 'specific_app' ? 'flex' : 'none';
        const devicesRow = document.getElementById('newRuleDevicesRow');
        if (v === 'new_device') {
            // Clear device selection and hide picker for system-wide trigger
            const dc = document.getElementById('newRuleDevices');
            dc.querySelectorAll('.device-pill').forEach(p => p.remove());
            const badge = dc.querySelector('.dashboard-total-badge');
            if (badge) badge.remove();
            devicesRow.style.display = 'none';
        } else {
            devicesRow.style.display = '';
        }
        // Show/hide WIP notice
        document.getElementById('newRuleWipNotice').style.display = wipTriggers.includes(v) ? 'block' : 'none';
        // Disable Create button for WIP triggers
        document.getElementById('createNewRule').disabled = wipTriggers.includes(v);
        updateNewRuleHint();
    });
    
    createNewRule.addEventListener('click', createRule);
    
    // Alert target picker for new rule form
    const addAlertTargetBtn = document.getElementById('addAlertTargetBtn');
    if (addAlertTargetBtn) {
        addAlertTargetBtn.addEventListener('click', () => showAlertTargetPicker('newRuleAlertTargets'));
    }

    // Rule name emoji validation
    const newRuleNameInput = document.getElementById('newRuleName');
    if (newRuleNameInput) {
        newRuleNameInput.addEventListener('input', () => validateRuleName(newRuleNameInput, false));
    }

    // Provider config modal
    const configBtn = document.getElementById('notifConfigBtn');
    const configOverlay = document.getElementById('notifConfigOverlay');
    const cancelConfigBtn = document.getElementById('cancelConfigBtn');
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    const testConfigBtn = document.getElementById('testConfigBtn');
    const providerSelect = document.getElementById('providerSelect');
    
    configBtn.addEventListener('click', () => configOverlay.classList.add('open'));
    cancelConfigBtn.addEventListener('click', () => configOverlay.classList.remove('open'));
    // Note: Provider config modal does NOT close when clicking outside
    // User must click Cancel or Save to close it
    
    providerSelect.addEventListener('change', () => {
        const provider = providerSelect.value;
        document.querySelectorAll('.provider-fields').forEach(f => f.style.display = 'none');
        document.getElementById(`${provider}Fields`).style.display = 'block';
    });
    
    // Ntfy auth toggle
    const ntfyAuthEnabled = document.getElementById('ntfyAuthEnabled');
    const ntfyAuthFields = document.getElementById('ntfyAuthFields');
    if (ntfyAuthEnabled && ntfyAuthFields) {
        ntfyAuthEnabled.addEventListener('change', () => {
            ntfyAuthFields.style.display = ntfyAuthEnabled.checked ? 'block' : 'none';
        });
    }
    
    saveConfigBtn.addEventListener('click', saveProviderConfig);
    testConfigBtn.addEventListener('click', testProviderConnection);
    
    // Topic manager
    const addTopicBtn = document.getElementById('addTopicBtn');
    const topicOverlay = document.getElementById('notifTopicOverlay');
    const cancelTopicBtn = document.getElementById('cancelTopicBtn');
    const saveTopicBtn = document.getElementById('saveTopicBtn');
    const topicAddDeviceBtn = document.getElementById('topicAddDeviceBtn');
    
    addTopicBtn.addEventListener('click', () => {
        updateTopicManagerForProvider();
        topicOverlay.classList.add('open');
    });
    cancelTopicBtn.addEventListener('click', () => {
        topicOverlay.classList.remove('open');
        resetTopicForm();
    });
    topicOverlay.addEventListener('click', (e) => {
        if (e.target === topicOverlay) {
            topicOverlay.classList.remove('open');
            resetTopicForm();
        }
    });
    saveTopicBtn.addEventListener('click', saveTopic);
    topicAddDeviceBtn.addEventListener('click', showTopicDevicePicker);
    
    // Send message
    const sendMsgBtn = document.getElementById('sendMsgBtn');
    sendMsgBtn.addEventListener('click', sendManualMessage);
    
    // File attachment
    const chooseFileBtn = document.getElementById('chooseFileBtn');
    const attachmentFile = document.getElementById('attachmentFile');
    const attachmentUrl = document.getElementById('attachmentUrl');
    const removeFileBtn = document.getElementById('removeFileBtn');
    
    if (chooseFileBtn && attachmentFile) {
        chooseFileBtn.addEventListener('click', () => attachmentFile.click());
        attachmentFile.addEventListener('change', handleFileSelect);
    }
    
    if (removeFileBtn) {
        removeFileBtn.addEventListener('click', clearFileSelection);
    }
    
    // Clear URL when file is selected and vice versa
    if (attachmentUrl) {
        attachmentUrl.addEventListener('input', () => {
            if (attachmentUrl.value.trim() && attachmentFile) {
                clearFileSelection();
            }
        });
    }
}

// =============================================================================
// Data Loading
// =============================================================================

async function loadProviderConfig() {
    try {
        const response = await fetch('/api/notification/config');
        const data = await response.json();
        
        currentProvider = data.provider;
        currentConfig = data.config || {};
        
        updateStatusBanner();
        updateAttachmentUI(); // Update attachment UI based on provider
        
        if (currentProvider) {
            document.getElementById('providerSelect').value = currentProvider;
            providerSelect.dispatchEvent(new Event('change'));
            
            if (currentProvider === 'ntfy') {
                document.getElementById('ntfyUrl').value = currentConfig.url || '';
                document.getElementById('ntfyTopic').value = currentConfig.topic || '';
                // Load auth settings
                const authEnabled = currentConfig.username && currentConfig.password;
                document.getElementById('ntfyAuthEnabled').checked = authEnabled;
                document.getElementById('ntfyAuthFields').style.display = authEnabled ? 'block' : 'none';
                document.getElementById('ntfyUsername').value = currentConfig.username || '';
                document.getElementById('ntfyPassword').value = currentConfig.password || '';
            } else if (currentProvider === 'gotify') {
                document.getElementById('gotifyUrl').value = currentConfig.url || '';
                document.getElementById('gotifyToken').value = currentConfig.app_token || '';
            } else if (currentProvider === 'pushover') {
                document.getElementById('pushoverUserKey').value = currentConfig.user_key || '';
                document.getElementById('pushoverAppToken').value = currentConfig.app_token || '';
            } else if (currentProvider === 'webhook') {
                document.getElementById('webhookUrl').value = currentConfig.url || '';
                document.getElementById('webhookHeaders').value = currentConfig.headers || '';
            }
        }
    } catch (error) {
        console.error('[notifications] Error loading config:', error);
    }
}

async function loadRules() {
    try {
        const response = await fetch('/api/notification/rules');
        const data = await response.json();
        
        rules = data.rules || [];
        renderRules();
    } catch (error) {
        console.error('[notifications] Error loading rules:', error);
    }
}

async function loadHistory() {
    try {
        const response = await fetch('/api/notification/history');
        const data = await response.json();
        
        history = data.entries || [];
        renderHistory();
    } catch (error) {
        console.error('[notifications] Error loading history:', error);
    }
}

async function loadTopApps() {
    try {
        const response = await fetch('/api/notification/top-apps');
        const data = await response.json();
        
        topAppsData = data;
        updateAppDropdown();
    } catch (error) {
        console.error('[notifications] Error loading top apps:', error);
    }
}

function updateAppDropdown() {
    const appSelect = document.getElementById('newRuleApp');
    if (!appSelect) return;
    
    // Check for error
    if (topAppsData.error) {
        console.error('[notifications] API error:', topAppsData.error);
        appSelect.innerHTML = `<option value="" selected>Error loading apps</option>`;
        return;
    }
    
    // Get items array (handle both old and new API format)
    const items = topAppsData.items || [];
    
    if (!topAppsData.has_data || items.length === 0) {
        // No data yet - show helpful message
        appSelect.innerHTML = `
            <option value="" selected>No apps detected yet - run SkyHero first</option>
        `;
        return;
    }
    
    // Single list sorted by traffic (most used first)
    let html = '<option value="" disabled selected>Select an app or website...</option>';
    
    for (const item of items) {
        html += `<option value="${item}">${item}</option>`;
    }
    
    appSelect.innerHTML = html;
}

async function loadDevices() {
    try {
        const response = await fetch('/api/notification/devices');
        const data = await response.json();
        
        devicesData = data;
        updateDeviceSelector();
    } catch (error) {
        console.error('[notifications] Error loading devices:', error);
    }
}

async function loadTopics() {
    try {
        const response = await fetch('/api/notification/topics');
        const data = await response.json();
        
        topics = data.topics || [];
        updateQuickTargets();
    } catch (error) {
        console.error('[notifications] Error loading topics:', error);
    }
}

function updateDeviceSelector() {
    const container = document.getElementById('newRuleDevices');
    if (!container) return;
    
    if (!devicesData.has_data) {
        container.innerHTML = `
            <span class="no-devices-hint" style="color: var(--notif-text-muted); font-size: 0.78rem;">
                No devices detected yet
            </span>
        `;
        return;
    }
    
    // Keep the add button, but show device count
    container.innerHTML = `
        <span class="add-device-pill-btn" id="addDeviceBtn">+ Select devices (${devicesData.devices.length} available)</span>
    `;
    
    // Re-wire the add device button
    const addBtn = document.getElementById('addDeviceBtn');
    if (addBtn) {
        addBtn.addEventListener('click', showDevicePicker);
    }
    
    // Also update quick targets in Send Message tab
    updateQuickTargets();
}

function updateQuickTargets() {
    const container = document.getElementById('quickTargets');
    if (!container) return;
    
    // Always show "Admin Alerts (Default)" option (default admin topic)
    let html = `<span class="quick-target-chip selected" data-target="all" data-target-type="default">🚨 ${translate('Admin Alerts (Default)')}</span>`;
    
    // Add custom topics with edit/delete buttons
    for (const topic of topics) {
        const icon = topic.name.toLowerCase().includes('dad') ? '👨' : 
                     topic.name.toLowerCase().includes('mom') ? '👩' : 
                     topic.name.toLowerCase().includes('kid') ? '👶' : '📱';
        html += `<span class="quick-target-chip" data-target="${topic.provider_identifier}" data-target-type="topic" data-topic-id="${topic.id}">
            <span class="chip-content">${icon} ${topic.name}</span>
            <span class="chip-actions">
                <span class="topic-edit-btn" title="Edit topic">✎</span>
                <span class="topic-delete-btn" title="Delete topic">×</span>
            </span>
        </span>`;
    }
    
    container.innerHTML = html;
    
    // Wire up click events for chips
    container.querySelectorAll('.quick-target-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            // If clicking on delete/edit button, don't select
            if (e.target.classList.contains('topic-delete-btn') || e.target.classList.contains('topic-edit-btn')) {
                return;
            }
            
            // Single selection - deselect all others
            container.querySelectorAll('.quick-target-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
        });
        
        // Wire up edit and delete buttons for custom topics
        if (chip.dataset.targetType === 'topic') {
            const topicId = parseInt(chip.dataset.topicId);
            const topic = topics.find(t => t.id === topicId);
            
            const editBtn = chip.querySelector('.topic-edit-btn');
            const deleteBtn = chip.querySelector('.topic-delete-btn');
            
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openTopicEditor(topic);
                });
            }
            
            if (deleteBtn) {
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete topic "${topic.name}"?`)) {
                        await deleteTopic(topicId);
                    }
                });
            }
        }
    });
}

function showDevicePicker() {
    // Simple implementation: toggle a dropdown or show a modal
    // For now, we'll add devices as pills when clicked
    const container = document.getElementById('newRuleDevices');
    
    if (!devicesData.has_data) {
        return;
    }
    
    // Check if picker is already open
    const existingPicker = container.querySelector('.device-picker');
    if (existingPicker) {
        existingPicker.remove();
        return;
    }
    
    // Create device picker dropdown
    const picker = document.createElement('div');
    picker.className = 'device-picker';
    picker.style.cssText = `
        background: white;
        border: 1px solid var(--notif-border-color);
        border-radius: 6px;
        padding: 8px;
        margin-top: 4px;
        max-height: 200px;
        overflow-y: auto;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    `;
    
    // Add "Dashboard Total" option
    const allOption = document.createElement('div');
    allOption.className = 'device-picker-option';
    allOption.style.cssText = 'padding: 6px 10px; cursor: pointer; border-radius: 4px; font-size: 0.82rem;';
    allOption.textContent = '📊 Dashboard Total';
    allOption.addEventListener('click', () => {
        addDevicePill('all', 'All Devices');
        picker.remove();
    });
    allOption.addEventListener('mouseenter', () => allOption.style.background = '#ebf8ff');
    allOption.addEventListener('mouseleave', () => allOption.style.background = 'transparent');
    picker.appendChild(allOption);
    
    // Add individual devices
    for (const device of devicesData.devices) {
        const option = document.createElement('div');
        option.className = 'device-picker-option';
        option.style.cssText = 'padding: 6px 10px; cursor: pointer; border-radius: 4px; font-size: 0.82rem;';
        option.textContent = `📱 ${device.name}`;
        option.addEventListener('click', () => {
            addDevicePill(device.mac, device.name);
            picker.remove();
        });
        option.addEventListener('mouseenter', () => option.style.background = '#ebf8ff');
        option.addEventListener('mouseleave', () => option.style.background = 'transparent');
        picker.appendChild(option);
    }
    
    container.appendChild(picker);
    
    // Close picker when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function closePicker(e) {
            if (!container.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closePicker);
            }
        });
    }, 10);
}

function addDevicePill(mac, name) {
    const container = document.getElementById('newRuleDevices');
    const addBtn = container.querySelector('.add-device-pill-btn');
    
    // Handle "Dashboard Total" mode (mac === 'all')
    if (mac === 'all') {
        // Clear all device pills
        container.querySelectorAll('.device-pill').forEach(pill => pill.remove());
        // Show Dashboard Total badge
        let badge = container.querySelector('.dashboard-total-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'dashboard-total-badge';
            container.insertBefore(badge, addBtn);
        }
        badge.innerHTML = '📊 Dashboard Total';
        updateNewRuleHint();
        return;
    }
    
    // Check if already added
    const existing = container.querySelector(`[data-mac="${mac}"]`);
    if (existing) return;
    
    // Remove Dashboard Total badge if adding specific devices
    const badge = container.querySelector('.dashboard-total-badge');
    if (badge) badge.remove();
    
    // Create pill
    const pill = document.createElement('span');
    pill.className = 'device-pill';
    pill.setAttribute('data-mac', mac);
    pill.innerHTML = `
        📱 ${name}
        <span class="pill-remove" style="cursor: pointer; margin-left: 4px; color: #a0aec0;">×</span>
    `;
    
    // Add remove handler
    pill.querySelector('.pill-remove').addEventListener('click', () => {
        pill.remove();
        updateNewRuleHint();
    });
    
    // Insert before the add button
    container.insertBefore(pill, addBtn);
    updateNewRuleHint();
}

function getExampleContent(triggerType, isAggregate) {
    const ex = {
        download: [
            { msg: '⚠️ «iPad-Noah» download exceeded «50» GB — used «65» GB («monthly»)', tmpl: '⚠️ {device_name} download {used_gb} GB exceeds {threshold} GB ({period})' },
            { msg: '⚠️ Download threshold «50» GB was exceeded — total download is «87» GB. Top: «iPhone (45.0GB — 60%), Smart TV (30.1GB — 40%)»', tmpl: '⚠️ {trigger_type} threshold {threshold} GB was exceeded — total is {total_gb} GB. Top: {top_3_devices}' }
        ],
        upload: [
            { msg: '⚠️ «iPad-Noah» upload exceeded «5» GB — used «12» GB («weekly»)', tmpl: '⚠️ {device_name} upload {used_gb} GB exceeds {threshold} GB ({period})' },
            { msg: '⚠️ Upload threshold «5» GB was exceeded — total upload is «25» GB. Top: «iPhone (15.0GB — 65%), Smart TV (8.0GB — 35%)»', tmpl: '⚠️ {trigger_type} threshold {threshold} GB was exceeded — total is {total_gb} GB. Top: {top_3_devices}' }
        ],
        total: [
            { msg: '⚠️ «iPad-Noah» total exceeded «100» GB — used «77» GB («monthly»)', tmpl: '⚠️ {device_name} total {used_gb} GB exceeds {threshold} GB ({period})' },
            { msg: '⚠️ Total traffic threshold «100» GB was exceeded — total reached «112» GB. Top: «iPhone (60.0GB — 61%), Smart TV (38.0GB — 39%)»', tmpl: '⚠️ {trigger_type} threshold {threshold} GB was exceeded — total is {total_gb} GB. Top: {top_3_devices}' }
        ],
        avg_daily: [
            { msg: '⚠️ «iPad-Noah» avg daily «3.2» GB exceeds «2» GB threshold («monthly»)', tmpl: '⚠️ {device_name} avg daily {avg_daily_gb} GB exceeds {threshold} GB ({period})' },
            { msg: '⚠️ Dashboard daily average «8.7» GB exceeds «5» GB threshold («iPhone (4.2GB — 48%), Smart TV (2.8GB — 32%), Laptop (1.7GB — 19%)»)', tmpl: '⚠️ Dashboard daily average {total_gb} GB exceeds {threshold} GB ({top_3_devices})' }
        ],
        specific_app: [
            { msg: '⚠️ «YouTube» on «iPad-Noah» used «60.5» GB — exceeds «50» GB threshold', tmpl: '⚠️ {app_name} on {device_name} used {used_gb} GB — exceeds {threshold} GB threshold' },
            { msg: '⚠️ «YouTube» across all devices used «100.2» GB — exceeds «50» GB threshold', tmpl: '⚠️ {app_name} across all devices used {used_gb} GB — exceeds {threshold} GB threshold' }
        ],
        any_app_exceeds: [
            { msg: '⚠️ «YouTube» on «iPad-Noah» hit «60.5» GB — exceeds «50» GB threshold', tmpl: '⚠️ {app_name} on {device_name} hit {used_gb} GB — exceeds {threshold} GB threshold' },
            { msg: '⚠️ «YouTube» exceeded «50» GB threshold — total «100.2» GB across all devices. Top: «iPhone (60.0GB — 60%), Smart TV (40.0GB — 40%)»', tmpl: '⚠️ {app_name} exceeded {threshold} GB threshold — total {used_gb} GB across all devices. Top: {top_3_devices}' }
        ],
        new_device: [
            { msg: '📱 New device detected: «iPad-Noah» («aa:bb:cc:dd:ee:ff»)', tmpl: '📱 New device detected: {device_name} ({mac_address})' },
            { msg: '📱 New device detected: «iPad-Noah» («aa:bb:cc:dd:ee:ff»)', tmpl: '📱 New device detected: {device_name} ({mac_address})' }
        ],
        db_restore: [
            { msg: '🔄 Database restored from backup', tmpl: '{trigger_type} triggered ({period})' },
            { msg: '🔄 Database restored from backup', tmpl: '{trigger_type} triggered ({period})' }
        ],
        daily_summary: [
            { msg: '📊 Daily summary — today traffic: «75» GB', tmpl: '{trigger_type} — {period} report' },
            { msg: '📊 Daily summary — today traffic: «75» GB', tmpl: '{trigger_type} — {period} report' }
        ]
    };
    const idx = isAggregate ? 1 : 0;
    const entry = (ex[triggerType] || ex.download)[idx];
    return `<div style="color: var(--text-color, #e2e8f0); font-size:0.8rem; margin:2px 0;">${entry.msg}</div>
        <code style="display:inline-block; color: var(--accent-color, #63b3ed); font-size:0.78rem; white-space:pre-wrap;">${entry.tmpl}</code>`;
}

window.toggleExample = function(id) {
    const el = document.getElementById(id);
    const btn = document.getElementById(id + 'Btn');
    if (!el || !btn) return;
    const hidden = el.style.display === 'none' || !el.style.display;
    el.style.display = hidden ? 'block' : 'none';
    btn.textContent = hidden ? '💡 Hide example' : '💡 Show example';
};

function updateNewRuleHint() {
    clearTemplateError('newRuleTemplateError');
    const container = document.getElementById('newRuleDevices');
    const devicesHint = document.getElementById('newRuleDevicesHint');
    const messageHint = document.getElementById('newRuleMessageHint');
    const pills = container.querySelectorAll('.device-pill');
    const triggerSelect = document.getElementById('newRuleTrigger');
    const triggerType = triggerSelect ? triggerSelect.value : 'download';
    const isAggregate = pills.length === 0;
    const noThreshold = ['new_device', 'db_restore', 'daily_summary'];
    
    // Build common line
    let commonCore = '<code>{trigger_type}</code> <code>{period}</code>';
    if (!noThreshold.includes(triggerType)) {
        commonCore = '<code>{threshold}</code> ' + commonCore;
    }
    if (triggerType === 'avg_daily') {
        commonCore = '<code>{avg_daily_gb}</code> ' + commonCore;
    }
    const commonLine = `Common variables: ${commonCore}`;
    
    // Build mode-specific line
    let modeLineHtml = '';
    const isSystemWide = triggerType === 'new_device';
    if (isSystemWide) {
        modeLineHtml = `<br><small style="color: var(--notif-text-muted);">🌐 System-wide: <code>{device_name}</code> <code>{mac_address}</code></small>`;
    } else if (isAggregate) {
        let vars = [];
        if (!noThreshold.includes(triggerType)) {
            if (triggerType === 'specific_app' || triggerType === 'any_app_exceeds') {
                vars = ['{top_3_devices}', '{used_gb}', '{app_name}'];
            } else if (triggerType === 'avg_daily') {
                vars = ['{total_gb}', '{avg_daily_gb}', '{top_3_devices}'];
            } else {
                vars = ['{total_gb}', '{top_3_devices}'];
            }
        }
        if (vars.length > 0) {
            modeLineHtml = `<br><small style="color: var(--notif-text-muted);">📊 Dashboard Total: ${vars.map(v => `<code>${v}</code>`).join(' ')}</small>`;
        }
    } else {
        let vars = ['{device_name}', '{mac_address}'];
        if (!noThreshold.includes(triggerType)) {
            vars.splice(1, 0, '{used_gb}');
            if (triggerType === 'avg_daily') {
                vars.push('{avg_daily_gb}');
            }
            if (triggerType === 'specific_app' || triggerType === 'any_app_exceeds') {
                vars.push('{app_name}');
            }
        }
        modeLineHtml = `<br><small style="color: var(--notif-text-muted);">📱 Per-Device: ${vars.map(v => `<code>${v}</code>`).join(' ')}</small>`;
    }
    
    devicesHint.style.display = 'none';
    messageHint.style.display = 'block';
    messageHint.innerHTML = `${commonLine}${modeLineHtml}
        <div style="margin-top:4px;">
            <button id="newRuleExampleBtn" onclick="toggleExample('newRuleExample')" style="background:none; border:none; color:var(--accent-color,#63b3ed); cursor:pointer; font-size:0.78rem; padding:0;">💡 Show example</button>
            <div id="newRuleExample" style="display:none; margin-top:4px; padding:4px 6px; border-left:2px solid var(--border-color,#333); font-size:0.8rem; line-height:1.4;">${getExampleContent(triggerType, isAggregate)}</div>
        </div>`;
}

// Global functions for expanded rule device picker
window.showDevicePickerForRule = function(ruleId) {
    const container = document.querySelector(`.device-pill-group[data-rule-id="${ruleId}"]`);
    
    if (!container || !devicesData.has_data) {
        if (!devicesData.has_data) {
            alert('No devices detected yet. Run SkyHero first to collect device data.');
        }
        return;
    }
    
    // Check if picker is already open
    const existingPicker = container.querySelector('.device-picker');
    if (existingPicker) {
        existingPicker.remove();
        return;
    }
    
    // Create device picker dropdown
    const picker = document.createElement('div');
    picker.className = 'device-picker';
    picker.style.cssText = `
        background: white;
        border: 1px solid var(--notif-border-color);
        border-radius: 6px;
        padding: 8px;
        margin-top: 4px;
        max-height: 200px;
        overflow-y: auto;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    `;
    
    // Add "Dashboard Total" option (same as new rule form)
    const allOption = document.createElement('div');
    allOption.className = 'device-picker-option';
    allOption.style.cssText = 'padding: 6px 10px; cursor: pointer; border-radius: 4px; font-size: 0.82rem;';
    allOption.textContent = '📊 Dashboard Total';
    allOption.addEventListener('click', () => {
        addDevicePillToRule(ruleId, 'all', 'Dashboard Total');
        picker.remove();
    });
    allOption.addEventListener('mouseenter', () => allOption.style.background = '#ebf8ff');
    allOption.addEventListener('mouseleave', () => allOption.style.background = 'transparent');
    picker.appendChild(allOption);
    
    // Add individual devices
    for (const device of devicesData.devices) {
        const option = document.createElement('div');
        option.className = 'device-picker-option';
        option.style.cssText = 'padding: 6px 10px; cursor: pointer; border-radius: 4px; font-size: 0.82rem;';
        option.textContent = `📱 ${device.name}`;
        option.addEventListener('click', () => {
            addDevicePillToRule(ruleId, device.mac, device.name);
            picker.remove();
        });
        option.addEventListener('mouseenter', () => option.style.background = '#ebf8ff');
        option.addEventListener('mouseleave', () => option.style.background = 'transparent');
        picker.appendChild(option);
    }
    
    container.appendChild(picker);
    
    // Close picker when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function closePicker(e) {
            if (!container.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closePicker);
            }
        });
    }, 10);
};

window.addDevicePillToRule = function(ruleId, mac, name) {
    const container = document.querySelector(`.device-pill-group[data-rule-id="${ruleId}"]`);
    const addBtn = container.querySelector('.add-device-pill-btn');
    
    // Handle "Dashboard Total" mode (mac === 'all')
    if (mac === 'all') {
        // Clear all device pills
        container.querySelectorAll('.device-pill').forEach(pill => pill.remove());
        // Show Dashboard Total badge
        let badge = container.querySelector('.dashboard-total-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'dashboard-total-badge';
            container.insertBefore(badge, addBtn);
        }
        badge.innerHTML = '📊 Dashboard Total';
        updateRuleHint(ruleId);
        return;
    }
    
    // Check if already added
    const existing = container.querySelector(`[data-mac="${mac}"]`);
    if (existing) return;
    
    // Remove Dashboard Total badge if adding specific devices
    const badge = container.querySelector('.dashboard-total-badge');
    if (badge) badge.remove();
    
    // Create pill
    const pill = document.createElement('span');
    pill.className = 'device-pill';
    pill.setAttribute('data-mac', mac);
    pill.innerHTML = `
        📱 ${name}
        <span class="pill-remove" style="cursor: pointer; margin-left: 4px; color: #a0aec0;">×</span>
    `;
    
    // Add remove handler
    pill.querySelector('.pill-remove').addEventListener('click', () => {
        pill.remove();
        updateRuleHint(ruleId);
    });
    
    // Insert before the add button
    container.insertBefore(pill, addBtn);
    updateRuleHint(ruleId);
};

function updateRuleHint(ruleId) {
    clearTemplateError(`rule-${ruleId}-templateError`);
    const card = document.querySelector(`.rule-card[data-rule-id="${ruleId}"]`);
    if (!card) return;
    
    const triggerType = card.getAttribute('data-trigger-type');
    const hintEl = document.getElementById(`rule-${ruleId}-hint`);
    const exampleEl = document.getElementById(`rule-${ruleId}-example`);
    if (!hintEl) return;
    
    let vars = [];
    let modeIcon, modeLabel;
    
    if (triggerType === 'new_device') {
        vars = ['{device_name}', '{mac_address}'];
        modeIcon = '🌐';
        modeLabel = 'System-wide';
    } else {
        const container = card.querySelector(`.device-pill-group[data-rule-id="${ruleId}"]`);
        const isAggregate = container ? !container.querySelector('.device-pill') : true;
        if (isAggregate) {
            if (!['new_device', 'db_restore', 'daily_summary'].includes(triggerType)) {
                if (triggerType === 'specific_app' || triggerType === 'any_app_exceeds') {
                    vars = ['{top_3_devices}', '{used_gb}', '{app_name}'];
                } else if (triggerType === 'avg_daily') {
                    vars = ['{total_gb}', '{avg_daily_gb}', '{top_3_devices}'];
                } else {
                    vars = ['{total_gb}', '{top_3_devices}'];
                }
            }
            modeIcon = '📊';
            modeLabel = 'Dashboard Total';
        } else {
            vars = ['{device_name}', '{mac_address}'];
            if (!['new_device', 'db_restore', 'daily_summary'].includes(triggerType)) {
                vars.splice(1, 0, '{used_gb}');
                if (triggerType === 'avg_daily') {
                    vars.push('{avg_daily_gb}');
                }
                if (triggerType === 'specific_app' || triggerType === 'any_app_exceeds') {
                    vars.push('{app_name}');
                }
            }
            modeIcon = '📱';
            modeLabel = 'Per-Device';
        }
    }
    
    hintEl.innerHTML = vars.length > 0
        ? `${modeIcon} ${modeLabel}: ${vars.map(v => `<code>${v}</code>`).join(' ')}`
        : `${modeIcon} ${modeLabel}: <span style="color:var(--notif-text-muted);">(no variables)</span>`;
    
    if (exampleEl) {
        const exBtn = document.getElementById(`rule-${ruleId}-exampleBtn`);
        if (exBtn) {
            exBtn.textContent = '💡 Show example';
            exBtn.style.display = '';
        }
        exampleEl.innerHTML = getExampleContent(triggerType, triggerType === 'new_device' ? true : !card.querySelector('.device-pill'));
    }
}

window.removeDeviceFromRule = function(ruleId, mac) {
    const pill = document.querySelector(`.device-pill-group[data-rule-id="${ruleId}"] [data-mac="${mac}"]`);
    if (pill) {
        pill.remove();
    }
};

// Alert Target Picker Functions
window.showAlertTargetPickerForRule = function(ruleId) {
    const container = document.querySelector(`.alert-target-pill-group[data-rule-id="${ruleId}"]`);
    if (!container) return;
    showAlertTargetPickerInContainer(container);
};

function showAlertTargetPicker(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    showAlertTargetPickerInContainer(container);
}

function showAlertTargetPickerInContainer(container) {
    // Check if picker is already open
    const existingPicker = container.querySelector('.alert-target-picker');
    if (existingPicker) {
        existingPicker.remove();
        return;
    }
    
    // Create picker dropdown
    const picker = document.createElement('div');
    picker.className = 'alert-target-picker device-picker'; // Reuse device picker styles
    picker.style.cssText = `
        background: white;
        border: 1px solid var(--notif-border-color);
        border-radius: 6px;
        padding: 8px;
        margin-top: 4px;
        max-height: 200px;
        overflow-y: auto;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        position: absolute;
        z-index: 100;
    `;
    
    // Add "Admin Alerts (Default)" option (always shown)
    const defaultOption = document.createElement('div');
    defaultOption.className = 'device-picker-option';
    defaultOption.style.cssText = 'padding: 6px 10px; cursor: pointer; border-radius: 4px; font-size: 0.82rem;';
    defaultOption.innerHTML = '🚨 ' + translate('Admin Alerts (Default)');
    defaultOption.addEventListener('click', () => {
        addAlertTargetPillToContainer(container, 'default', translate('Admin Alerts (Default)'));
        picker.remove();
    });
    defaultOption.addEventListener('mouseenter', () => defaultOption.style.background = '#ebf8ff');
    defaultOption.addEventListener('mouseleave', () => defaultOption.style.background = 'transparent');
    picker.appendChild(defaultOption);
    
    // Add custom topics (if any)
    if (topics && topics.length > 0) {
        topics.forEach(topic => {
            const option = document.createElement('div');
            option.className = 'device-picker-option';
            option.style.cssText = 'padding: 6px 10px; cursor: pointer; border-radius: 4px; font-size: 0.82rem;';
            option.textContent = topic.name;
            option.addEventListener('click', () => {
                addAlertTargetPillToContainer(container, topic.id.toString(), topic.name);
                picker.remove();
            });
            option.addEventListener('mouseenter', () => option.style.background = '#ebf8ff');
            option.addEventListener('mouseleave', () => option.style.background = 'transparent');
            picker.appendChild(option);
        });
    } else {
        // Show a hint if no custom topics exist
        const hint = document.createElement('div');
        hint.className = 'device-picker-option';
        hint.style.cssText = 'padding: 6px 10px; font-size: 0.78rem; color: var(--notif-text-muted); font-style: italic;';
        hint.textContent = 'No custom topics yet. Create topics in Send Message tab.';
        picker.appendChild(hint);
    }
    
    container.appendChild(picker);
    
    // Close picker when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function closeAlertPicker(e) {
            if (!container.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closeAlertPicker);
            }
        });
    }, 10);
}

window.addAlertTargetPillToRule = function(ruleId, targetId, targetName) {
    const container = document.querySelector(`.alert-target-pill-group[data-rule-id="${ruleId}"]`);
    if (!container) return;
    addAlertTargetPillToContainer(container, targetId, targetName);
};

window.addAlertTargetPillToContainer = function(container, targetId, targetName) {
    if (!container) return;
    const addBtn = container.querySelector('.add-alert-target-pill-btn');
    
    // Check if already added
    const existing = container.querySelector(`[data-target="${targetId}"]`);
    if (existing) return;
    
    // Create pill
    const pill = document.createElement('span');
    pill.className = 'alert-target-pill';
    pill.setAttribute('data-target', targetId);
    pill.innerHTML = `
        ${targetName}
        <span class="pill-remove" style="cursor: pointer; margin-left: 4px; color: #a0aec0;">×</span>
    `;
    
    // Add remove handler
    pill.querySelector('.pill-remove').addEventListener('click', () => pill.remove());
    
    // Insert before the add button
    container.insertBefore(pill, addBtn);
};

window.removeAlertTargetFromRule = function(ruleId, targetId) {
    const pill = document.querySelector(`.alert-target-pill-group[data-rule-id="${ruleId}"] [data-target="${targetId}"]`);
    if (pill) {
        pill.remove();
    }
};

// =============================================================================
// Rendering
// =============================================================================

function updateStatusBanner() {
    const banner = document.getElementById('ntfyBanner');
    
    if (!currentProvider) {
        banner.className = 'ntfy-banner not-installed';
        banner.innerHTML = `
            <span class="banner-icon">⚠️</span>
            <span>
                <strong>No notification provider configured.</strong> Click ⚙️ to set up Ntfy, Gotify, Pushover, or a custom webhook.
            </span>
        `;
    } else {
        banner.className = 'ntfy-banner installed';
        const providerNames = {
            ntfy: 'Ntfy',
            gotify: 'Gotify',
            pushover: 'Pushover',
            webhook: 'Webhook'
        };
        banner.innerHTML = `
            <span class="banner-icon">✅</span>
            <span>
                <strong>${providerNames[currentProvider]} configured.</strong> Notifications are active.
            </span>
        `;
    }
}

function renderRules() {
    const ruleList = document.getElementById('ruleList');
    const ruleCount = document.getElementById('ruleCount');
    const ruleSummary = document.getElementById('ruleSummary');
    
    const activeCount = rules.filter(r => r.active).length;
    ruleCount.textContent = rules.length;
    ruleSummary.textContent = `${rules.length} rules · ${activeCount} active`;
    
    if (rules.length === 0) {
        ruleList.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px; font-size: 0.9rem;">No rules configured. Click "+ Add Rule" to create one.</p>';
        return;
    }
    
    ruleList.innerHTML = rules.map((rule, index) => {
        const periodClass = rule.period === 'today' ? 'today' : rule.period === 'weekly' ? 'weekly' : 'monthly';
        const triggerPreview = getTriggerPreview(rule);
        
        return `
            <div class="rule-card" data-rule-id="${rule.id}" data-trigger-type="${rule.trigger_type}">
                <div class="rule-header">
                    <span class="drag-handle">⠿</span>
                    <span class="rule-number">${index + 1}</span>
                    <div class="rule-info">
                        <div class="rule-name">${rule.name}</div>
                        <div class="rule-meta">
                            <span class="rule-trigger-tag">${triggerPreview}</span>
                            <span class="rule-period-tag ${periodClass}">${rule.period}</span>
                        </div>
                    </div>
                    <label class="rule-toggle">
                        <input type="checkbox" ${rule.active ? 'checked' : ''} data-rule-id="${rule.id}">
                        <span class="rule-toggle-slider"></span>
                    </label>
                </div>
                <div class="rule-detail">
                    <div class="rule-detail-row">
                        <span class="rule-detail-label">Name</span>
                        <div class="rule-detail-value">
                            <input type="text" class="rule-name-input form-input" value="${rule.name}" data-rule-id="${rule.id}" placeholder="Rule name">
                        </div>
                    </div>
                    <div class="rule-detail-row">
                        <span class="rule-detail-label">Period</span>
                        <div class="rule-detail-value">
                            <select class="period-select" data-rule-id="${rule.id}">
                                <option value="today" ${rule.period === 'today' ? 'selected' : ''}>Today</option>
                                <option value="weekly" ${rule.period === 'weekly' ? 'selected' : ''}>Weekly</option>
                                <option value="monthly" ${rule.period === 'monthly' ? 'selected' : ''}>Monthly</option>
                                </select>
                            </div>
                        </div>
                    <div class="rule-detail-row">
                        <span class="rule-detail-label">Trigger</span>
                        <div class="rule-detail-value">
                            <div class="threshold-row">
                                <span class="threshold-unit">${getTriggerLabel(rule.trigger_type)}</span>
                                ${rule.threshold_gb ? `
                                    <span class="threshold-unit">exceeds</span>
                                    <input type="number" class="threshold-input" value="${rule.threshold_gb}" data-rule-id="${rule.id}">
                                    <span class="threshold-unit">GB</span>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                    ${rule.trigger_type !== 'new_device' ? `
                    <div class="rule-detail-row">
                        <span class="rule-detail-label">Devices</span>
                        <div class="rule-detail-value">
                            <div class="device-pill-group" data-rule-id="${rule.id}">
                                ${rule.devices && rule.devices.length > 0 
                                    ? rule.devices.map(mac => {
                                        const device = devicesData.devices.find(d => d.mac === mac);
                                        return `<span class="device-pill" data-mac="${mac}">📱 ${device ? device.name : mac} <span class="pill-remove" onclick="removeDeviceFromRule('${rule.id}', '${mac}')">×</span></span>`;
                                    }).join('')
                                    : '<span class="dashboard-total-badge">📊 Dashboard Total</span>'
                                }
                                <span class="add-device-pill-btn" onclick="showDevicePickerForRule(${rule.id})">+ Select devices</span>
                            </div>
                            <div class="template-vars-hint" style="margin-top:4px;">
                                Leave empty for Dashboard Total. Select devices for per-device alerts.
                            </div>
                        </div>
                    </div>
                    ` : ''}
                    <div class="rule-detail-row">
                        <span class="rule-detail-label">Alert target:</span>
                        <div class="rule-detail-value">
                            <div class="alert-target-pill-group" data-rule-id="${rule.id}">
                                ${getAlertTargetPills(rule)}
                                <span class="add-alert-target-pill-btn" onclick="showAlertTargetPickerForRule(${rule.id})">+ Add targets</span>
                            </div>
                            <div class="template-vars-hint" style="margin-top:4px;">
                                Select where to send alerts. Default set in provider settings.
                            </div>
                        </div>
                    </div>
<div class="rule-detail-row">
                        <span class="rule-detail-label">Message</span>
                        <div class="rule-detail-value" style="position: relative;">
                            <textarea class="msg-template-input" data-rule-id="${rule.id}" id="ruleMsg${rule.id}">${rule.message_template || ''}</textarea>
                            <button type="button" class="emoji-picker-btn" onclick="showEmojiPicker(this, 'ruleMsg${rule.id}', event)">😊</button>
                            <div class="template-vars-hint">Common variables: ${['new_device', 'db_restore', 'daily_summary'].includes(rule.trigger_type) ? '' : '<code>{threshold}</code> '}<code>{trigger_type}</code> <code>{period}</code>${rule.trigger_type === 'avg_daily' ? ' <code>{avg_daily_gb}</code>' : ''}<br>
                                <small style="color: var(--notif-text-muted);" id="rule-${rule.id}-hint">${rule.trigger_type === 'new_device' ? '🌐 System-wide: <code>{device_name}</code> <code>{mac_address}</code>' : rule.devices && rule.devices.length > 0 ? '📱 Per-Device: <code>{device_name}</code> <code>{used_gb}</code> <code>{mac_address}</code>' : '📊 Dashboard Total: <code>{total_gb}</code> <code>{top_3_devices}</code>'}</small>
                                <div style="margin-top:4px;">
                                    <button id="rule-${rule.id}-exampleBtn" onclick="toggleExample('rule-${rule.id}-example')" style="background:none; border:none; color:var(--accent-color,#63b3ed); cursor:pointer; font-size:0.78rem; padding:0;">💡 Show example</button>
                                    <div id="rule-${rule.id}-example" style="display:none; margin-top:4px; padding:4px 6px; border-left:2px solid var(--border-color,#333); font-size:0.8rem; line-height:1.4;">${getExampleContent(rule.trigger_type, !rule.devices || rule.devices.length === 0)}</div>
                                </div></div>
                        </div>
                    </div>
                    <div class="rule-actions">
                        <button class="rule-action-btn save-rule-btn" data-rule-id="${rule.id}">Save</button>
                        <button class="rule-action-btn danger delete-rule-btn" data-rule-id="${rule.id}">Delete</button>
                        <button class="rule-action-btn cancel-rule-btn" data-rule-id="${rule.id}">Cancel</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // Wire up events
    wireRuleCardEvents();
}

function getTriggerPreview(rule) {
    const triggerType = rule.trigger_type;
    
    if (triggerType === 'new_device') {
        return 'New MAC → "📱 New device detected"';
    } else if (triggerType === 'db_restore') {
        return 'System event → "🔄 DB restored"';
    } else if (triggerType === 'daily_summary') {
        return 'System event → "📊 Daily summary"';
    } else if (triggerType === 'specific_app') {
        return `${rule.trigger_app || 'App'} > ${rule.threshold_gb} GB`;
    } else {
        return `${triggerType.charAt(0).toUpperCase() + triggerType.slice(1)} > ${rule.threshold_gb} GB`;
    }
}

function getTriggerLabel(triggerType) {
    const labels = {
        download: 'Download',
        upload: 'Upload',
        total: 'Total usage',
        avg_daily: 'Avg Daily Traffic',
        specific_app: 'App/Website',
        any_app_exceeds: 'Any App/Website',
        new_device: 'New device detected',
        db_restore: 'DB restored',
        daily_summary: 'Daily summary'
    };
    return labels[triggerType] || triggerType;
}

function getAlertTargetPills(rule) {
    const alertTargets = rule.alert_target || ["default"];
    return alertTargets.map(target => {
        if (target === "default") {
            return `<span class="alert-target-pill" data-target="default">🚨 ${translate('Admin Alerts (Default)')} <span class="pill-remove" onclick="removeAlertTargetFromRule('${rule.id}', 'default')">×</span></span>`;
        } else {
            const topic = topics.find(t => t.id.toString() === target.toString());
            if (topic) {
                return `<span class="alert-target-pill" data-target="${topic.id}">${topic.name} <span class="pill-remove" onclick="removeAlertTargetFromRule('${rule.id}', '${topic.id}')">×</span></span>`;
            } else {
                return `<span class="alert-target-pill invalid" data-target="${target}">⚠️ Invalid topic (${target}) <span class="pill-remove" onclick="removeAlertTargetFromRule('${rule.id}', '${target}')">×</span></span>`;
            }
        }
    }).join('');
}

function wireRuleCardEvents() {
    // Rule header click - expand/collapse
    document.querySelectorAll('.rule-header').forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.closest('.rule-toggle') || e.target.closest('.drag-handle')) return;
            const detail = header.nextElementSibling;
            document.querySelectorAll('.rule-detail.open').forEach(d => {
                if (d !== detail) d.classList.remove('open');
            });
            const wasClosed = !detail.classList.contains('open');
            detail.classList.toggle('open');
            if (wasClosed) {
                const card = header.closest('.rule-card');
                if (card) updateRuleHint(parseInt(card.dataset.ruleId));
            }
        });
    });
    
    // Toggle switches
    document.querySelectorAll('.rule-toggle input').forEach(toggle => {
        toggle.addEventListener('change', (e) => {
            const ruleId = parseInt(e.target.dataset.ruleId);
            toggleRuleActive(ruleId, e.target.checked);
        });
    });
    
// Save buttons
    document.querySelectorAll('.save-rule-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const ruleId = parseInt(e.target.dataset.ruleId);
            saveRuleChanges(ruleId);
        });
    });

    // Cancel buttons
    document.querySelectorAll('.cancel-rule-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const ruleId = parseInt(e.target.dataset.ruleId);
            const rule = rules.find(r => r.id === ruleId);
            if (!rule) return;
            const card = document.querySelector(`.rule-card[data-rule-id="${ruleId}"]`);
            if (card) {
                const nameInput = card.querySelector('.rule-name-input');
                const periodSelect = card.querySelector('.period-select');
                const thresholdInput = card.querySelector('.threshold-input');
                const msgInput = card.querySelector('.msg-template-input');
                if (nameInput) {
                    nameInput.value = rule.name;
                    const warning = nameInput.parentElement.querySelector('.input-warning');
                    if (warning) warning.remove();
                }
                if (periodSelect) periodSelect.value = rule.period;
                if (thresholdInput) thresholdInput.value = rule.threshold_gb || '';
                if (msgInput) msgInput.value = rule.message_template || '';
                const detail = card.querySelector('.rule-detail');
                if (detail) detail.classList.remove('open');
            }
        });
    });

    // Rule name input validation for edit form
    document.querySelectorAll('.rule-name-input').forEach(input => {
        input.addEventListener('input', () => validateRuleName(input, true));
    });

    // Drag and Drop
    initDragAndDrop();
}

function initDragAndDrop() {
    let draggedCard = null;
    
    document.querySelectorAll('.rule-card').forEach(card => {
        card.setAttribute('draggable', 'true');
        
        card.addEventListener('dragstart', function(e) {
            draggedCard = this;
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        
        card.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            document.querySelectorAll('.rule-card').forEach(c => c.classList.remove('drag-over'));
            draggedCard = null;
        });
        
        card.addEventListener('dragover', function(e) {
            e.preventDefault();
            if (this !== draggedCard) {
                this.classList.add('drag-over');
            }
        });
        
        card.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
        });
        
        card.addEventListener('drop', function(e) {
            e.preventDefault();
            this.classList.remove('drag-over');
            
            if (this !== draggedCard && draggedCard) {
                const list = document.getElementById('ruleList');
                const all = [...list.querySelectorAll('.rule-card')];
                
                if (all.indexOf(draggedCard) < all.indexOf(this)) {
                    this.after(draggedCard);
                } else {
                    this.before(draggedCard);
                }
                
                // Renumber all cards
                list.querySelectorAll('.rule-card').forEach((c, i) => {
                    c.querySelector('.rule-number').textContent = i + 1;
                });
                
                updateRuleSummary();
            }
        });
    });
}

function renderHistory() {
    const tbody = document.getElementById('historyTbody');
    
    if (history.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">No notifications sent yet.</td></tr>';
        return;
    }
    
    tbody.innerHTML = history.map(entry => `
        <tr data-entry-id="${entry.id}">
            <td style="white-space:nowrap;">${entry.timestamp}</td>
            <td class="history-type-cell">${entry.type === 'rule' ? '🔴 Rule' : '💬 Manual'}</td>
            <td><span class="history-target-tag" title="${entry.targets.join(', ')}">${entry.targets.join(', ')}</span></td>
            <td class="history-message-cell" title="${entry.message}">${entry.message.substring(0, 30)}${entry.message.length > 30 ? '...' : ''}</td>
            <td class="history-status-cell" title="${entry.status === 'sent' ? 'Sent' : 'Failed'}">
                <span class="history-status ${entry.status}">${entry.status === 'sent' ? '✅ Sent' : '❌ Failed'}</span>
                <span class="history-action-btn history-resend-btn" data-message="${encodeURIComponent(entry.message.replace(' [📎 URL]', ''))}" data-title="${encodeURIComponent(entry.title || '')}" data-attachment-url="${encodeURIComponent(entry.attachment_url || '')}" title="Resend this message">↻</span>
                <span class="history-action-btn history-delete-btn" data-entry-id="${entry.id}" title="Delete this entry">🗑️</span>
            </td>
        </tr>
    `).join('');
    
    // Wire up resend buttons
    tbody.querySelectorAll('.history-resend-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const message = decodeURIComponent(btn.getAttribute('data-message'));
            const title = decodeURIComponent(btn.getAttribute('data-title') || '');
            const attachmentUrl = decodeURIComponent(btn.getAttribute('data-attachment-url') || '');
            resendMessage(message, title, attachmentUrl);
        });
    });
    
    // Wire up delete buttons
    tbody.querySelectorAll('.history-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const entryId = btn.getAttribute('data-entry-id');
            if (confirm('Delete this history entry?')) {
                await deleteHistoryEntry(entryId);
            }
        });
    });
}

function resendMessage(message, title, attachmentUrl) {
    // Switch to Send Message tab
    const sendTab = document.querySelector('.notif-sidebar-item[data-tab="send-message"]');
    if (sendTab) {
        sendTab.click();
    }
    
    // Fill in the message and title
    document.getElementById('sendMessage').value = message;
    document.getElementById('sendTitle').value = title;
    
    // Clear any existing file attachment
    clearFileSelection();
    
    // Restore attachment URL if present
    const attachmentUrlInput = document.getElementById('attachmentUrl');
    if (attachmentUrlInput && attachmentUrl) {
        attachmentUrlInput.value = attachmentUrl;
    } else if (attachmentUrlInput) {
        attachmentUrlInput.value = '';
    }
    
    // Scroll to the message field
    document.getElementById('sendMessage').focus();
}

async function deleteHistoryEntry(entryId) {
    try {
        const response = await fetch(`/api/notification/history/${entryId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Remove from local array
            history = history.filter(e => e.id !== entryId);
            // Re-render
            renderHistory();
        } else {
            alert('Failed to delete entry: ' + data.error);
        }
    } catch (error) {
        console.error('[notifications] Error deleting history entry:', error);
        alert('Failed to delete entry');
    }
}

// =============================================================================
// Actions
// =============================================================================

function resetNewRuleForm() {
    document.getElementById('newRuleName').value = '';
    document.getElementById('newRuleThreshold').value = '50';
    document.getElementById('newRuleMessage').value = '';
    document.getElementById('newRuleTrigger').value = 'download';
    document.getElementById('newRulePeriod').value = 'monthly';
    document.getElementById('newRuleThresholdRow').style.display = 'flex';
    document.getElementById('newRuleAppRow').style.display = 'none';
    const devicesRow = document.getElementById('newRuleDevicesRow');
    if (devicesRow) devicesRow.style.display = '';
    
    // Clear device pills and Dashboard Total badge
    const deviceContainer = document.getElementById('newRuleDevices');
    if (deviceContainer) {
        const pills = deviceContainer.querySelectorAll('.device-pill');
        pills.forEach(pill => pill.remove());
        const badge = deviceContainer.querySelector('.dashboard-total-badge');
        if (badge) badge.remove();
    }
    
    // Clear alert target pills and add default
    const alertContainer = document.getElementById('newRuleAlertTargets');
    if (alertContainer) {
        const alertPills = alertContainer.querySelectorAll('.alert-target-pill');
        alertPills.forEach(pill => pill.remove());
        // Add default alert target
        const defaultPill = document.createElement('span');
        defaultPill.className = 'alert-target-pill';
        defaultPill.setAttribute('data-target', 'default');
        defaultPill.innerHTML = `🚨 ${translate('Admin Alerts (Default)')} <span class="pill-remove" style="cursor: pointer; margin-left: 4px; color: #a0aec0;">×</span>`;
        defaultPill.querySelector('.pill-remove').addEventListener('click', () => defaultPill.remove());
        const addBtn = alertContainer.querySelector('.add-alert-target-pill-btn');
        alertContainer.insertBefore(defaultPill, addBtn);
    }
    
    // Reset hints
    const wipNotice = document.getElementById('newRuleWipNotice');
    if (wipNotice) wipNotice.style.display = 'none';
    document.getElementById('createNewRule').disabled = false;
    const devicesHint = document.getElementById('newRuleDevicesHint');
    if (devicesHint) {
        devicesHint.style.display = 'block';
        devicesHint.textContent = 'Leave empty for Dashboard Total. Select devices for per-device alerts.';
    }
    const messageHint = document.getElementById('newRuleMessageHint');
    if (messageHint) {
        messageHint.style.display = 'block';
        messageHint.innerHTML = `Common variables: <code>{threshold}</code> <code>{trigger_type}</code> <code>{period}</code><br><small style="color: var(--notif-text-muted);">📊 Dashboard Total: <code>{total_gb}</code> <code>{top_3_devices}</code></small><br><small style="color: var(--notif-text-muted);">📱 Per-Device: <code>{device_name}</code> <code>{used_gb}</code> <code>{app_name}</code> <code>{mac_address}</code></small>`;
    }
}

function containsEmoji(text) {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/u;
    return emojiRegex.test(text);
}

function showNameWarning(inputId, show) {
    const input = document.getElementById(inputId);
    if (!input) return;
    let warning = input.parentElement.querySelector('.input-warning');
    if (show) {
        if (!warning) {
            warning = document.createElement('div');
            warning.className = 'input-warning';
            warning.innerHTML = '⛔️ Note: Some notification providers may not handle emojis properly. Consider using plain text.';
            input.parentElement.appendChild(warning);
        }
    } else if (warning) {
        warning.remove();
    }
}

function validateRuleName(inputElement, isEdit = false) {
    const value = inputElement.value;
    const warning = isEdit ? inputElement.parentElement.querySelector('.input-warning') : null;
    if (containsEmoji(value)) {
        if (isEdit) {
            if (!warning) {
                const w = document.createElement('div');
                w.className = 'input-warning';
                w.innerHTML = '⛔️ Some providers may not handle emojis properly.';
                inputElement.parentElement.appendChild(w);
            }
        } else {
            showNameWarning('newRuleName', true);
        }
    } else {
        if (isEdit && warning) warning.remove();
        else showNameWarning('newRuleName', false);
    }
}

const EMOJI_LIST = ['👍','👎','❤️','😊','😂','🔥','💯','🎉','👏','🙌','✨','🌟','💪','🤝','👋','🎯','💡','📊','📱','💻','🖥️','📺','🔔','⚠️','❗','✅','❌','🔴','🟢','🟡','📌','📎','🔗','💬','📝','📧','📤','📥','🔒','🔓','👤','👥','👨','👩','👶','🎮','🎬','🎵','🍕','🍔','🍟','🌐','📶','📡','💀','🆕'];

let activeEmojiPicker = null;
let emojiPickerEl = null;

function buildEmojiPicker() {
    if (emojiPickerEl) return emojiPickerEl;
    const picker = document.createElement('div');
    picker.className = 'emoji-picker-popup';
    picker.style.visibility = 'hidden';
    picker.style.pointerEvents = 'none';
    EMOJI_LIST.forEach(emoji => {
        const opt = document.createElement('span');
        opt.className = 'emoji-option';
        opt.textContent = emoji;
        opt.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const ta = document.getElementById(emojiPickerEl._textareaId);
            if (ta) insertEmojiAtCursor(ta, emoji);
            closeEmojiPicker();
        });
        picker.appendChild(opt);
    });
    document.getElementById('notifOverlay').appendChild(picker);
    emojiPickerEl = picker;
    return picker;
}

window.showEmojiPicker = function(btn, textareaId, e) {
    if (e) e.stopPropagation();
    if (activeEmojiPicker) {
        activeEmojiPicker.style.visibility = 'hidden';
        activeEmojiPicker.style.pointerEvents = 'none';
        activeEmojiPicker = null;
    }
    const textarea = document.getElementById(textareaId);
    if (!textarea) return;
    const picker = buildEmojiPicker();
    picker._textareaId = textareaId;
    if (!btn.parentElement) return;
    btn.appendChild(picker);
    picker.style.visibility = '';
    picker.style.pointerEvents = '';
    activeEmojiPicker = picker;
    setTimeout(() => {
        document.addEventListener('click', function closeOnOutside(ev) {
            if (!picker.contains(ev.target) && ev.target !== btn) {
                picker.style.visibility = 'hidden';
                picker.style.pointerEvents = 'none';
                if (activeEmojiPicker === picker) activeEmojiPicker = null;
                document.removeEventListener('click', closeOnOutside);
            }
        });
    }, 50);
}

function closeEmojiPicker() {
    if (activeEmojiPicker) {
        activeEmojiPicker.style.visibility = 'hidden';
        activeEmojiPicker.style.pointerEvents = 'none';
        activeEmojiPicker = null;
    }
}

function insertEmojiAtCursor(textarea, emoji) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    textarea.value = text.substring(0, start) + emoji + text.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
    textarea.focus();
}

function getValidTemplateVars(triggerType, isAggregate) {
    const noThreshold = ['new_device', 'db_restore', 'daily_summary'];
    const common = ['{trigger_type}', '{period}'];
    if (!noThreshold.includes(triggerType)) {
        common.push('{threshold}');
    }
    if (triggerType === 'new_device') {
        return [...common, '{device_name}', '{mac_address}'];
    }
    if (isAggregate) {
        const vars = [...common];
        if (triggerType === 'avg_daily') {
            vars.push('{total_gb}', '{avg_daily_gb}', '{top_3_devices}');
        } else if (triggerType === 'download' || triggerType === 'upload' || triggerType === 'total') {
            vars.push('{total_gb}', '{top_3_devices}');
        } else if (triggerType === 'specific_app' || triggerType === 'any_app_exceeds') {
            vars.push('{app_name}', '{used_gb}', '{top_3_devices}');
        }
        return vars;
    } else {
        const vars = [...common, '{device_name}', '{mac_address}'];
        if (!noThreshold.includes(triggerType)) {
            vars.push('{used_gb}');
        }
        if (triggerType === 'avg_daily') {
            vars.push('{avg_daily_gb}');
        }
        if (triggerType === 'specific_app' || triggerType === 'any_app_exceeds') {
            vars.push('{app_name}');
        }
        return vars;
    }
}

function validateTemplate(template, triggerType, isAggregate) {
    const matches = template.match(/\{([^}]+)\}/g);
    if (!matches) return [];
    const valid = getValidTemplateVars(triggerType, isAggregate);
    const invalid = matches.filter(v => !valid.includes(v));
    return [...new Set(invalid)];
}

function showTemplateError(containerId, invalid) {
    let el = document.getElementById(containerId);
    if (!el) {
        el = document.createElement('div');
        el.id = containerId;
        el.style.cssText = 'color:#c53030; font-size:0.78rem; margin-top:4px; line-height:1.5;';
        const hint = document.getElementById('newRuleMessageHint');
        if (hint) hint.after(el);
    }
    el.innerHTML = `✗ Invalid variable: ${invalid.map(v => `<code style="background:#fff5f5; color:#c53030; padding:1px 5px; border-radius:3px; font-size:0.75rem;">${v}</code>`).join(' ')}`;
    el.style.display = 'block';
}

function clearTemplateError(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.style.display = 'none';
}

function showCardTemplateError(ruleId, invalid) {
    const id = `rule-${ruleId}-templateError`;
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.cssText = 'color:#c53030; font-size:0.78rem; margin-top:4px; line-height:1.5;';
        const card = document.querySelector(`.rule-card[data-rule-id="${ruleId}"]`);
        if (!card) return;
        const hint = card.querySelector('.template-vars-hint');
        if (hint) hint.after(el);
    }
    el.innerHTML = `✗ Invalid variable: ${invalid.map(v => `<code style="background:#fff5f5; color:#c53030; padding:1px 5px; border-radius:3px; font-size:0.75rem;">${v}</code>`).join(' ')}`;
    el.style.display = 'block';
}

async function createRule() {
    const name = document.getElementById('newRuleName').value.trim() || 'Untitled Rule';
    const period = document.getElementById('newRulePeriod').value;
    const triggerType = document.getElementById('newRuleTrigger').value;
    
    // Block WIP triggers
    if (['db_restore', 'daily_summary'].includes(triggerType)) {
        alert('⏳ This trigger is not yet implemented. Please select another trigger type.');
        return;
    }
    
    const threshold = parseFloat(document.getElementById('newRuleThreshold').value) ||0;
    const app = document.getElementById('newRuleApp').value;
    const message = document.getElementById('newRuleMessage').value.trim() || 'No message set';
    
    // Collect selected devices from the new rule form
    const devicePills = document.querySelectorAll('#newRuleDevices .device-pill');
    const devices = Array.from(devicePills).map(pill => pill.getAttribute('data-mac'));
    
    // Validate template variables
    const isAggregate = devices.length === 0;
    const invalid = validateTemplate(message, triggerType, isAggregate);
    clearTemplateError('newRuleTemplateError');
    if (invalid.length > 0) {
        showTemplateError('newRuleTemplateError', invalid);
        document.getElementById('newRuleMessage').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
    }
    
    // Collect selected alert targets from the new rule form
    const alertTargetPills = document.querySelectorAll('#newRuleAlertTargets .alert-target-pill');
    const alert_target = Array.from(alertTargetPills).map(pill => pill.getAttribute('data-target'));
    // Ensure at least default target is present if empty
    const finalAlertTarget = (!alert_target || alert_target.length === 0) ? ["default"] : alert_target;
    
    const rule = {
        name,
        period,
        trigger_type: triggerType,
        threshold_gb: ['new_device', 'db_restore', 'daily_summary'].includes(triggerType) ? null : threshold,
        trigger_app: triggerType === 'specific_app' ? app : null,
        devices: devices,
        alert_target: finalAlertTarget,
        message_template: message,
        active: true
    };
    
    try {
        const response = await fetch('/api/notification/rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rule)
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('newRuleForm').classList.remove('open');
            resetNewRuleForm();
            loadRules();
        } else {
            alert('Failed to create rule: ' + data.error);
        }
    } catch (error) {
        console.error('[notifications] Error creating rule:', error);
        alert('Failed to create rule');
    }
}

async function toggleRuleActive(ruleId, active) {
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;
    
    rule.active = active;
    
    try {
        await fetch('/api/notification/rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rule)
        });
        
        updateRuleSummary();
    } catch (error) {
        console.error('[notifications] Error updating rule:', error);
    }
}

async function saveRuleChanges(ruleId) {
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;
    
    const card = document.querySelector(`.rule-card[data-rule-id="${ruleId}"]`);
    rule.name = card.querySelector('.rule-name-input')?.value?.trim() || rule.name;
    rule.period = card.querySelector('.period-select').value;
    rule.threshold_gb = parseFloat(card.querySelector('.threshold-input')?.value) || rule.threshold_gb;
    rule.message_template = card.querySelector('.msg-template-input').value;
    
    // Validate template variables
    const devicePillsInCard = card.querySelectorAll('.device-pill-group .device-pill');
    const deviceMacsInCard = Array.from(devicePillsInCard).map(pill => pill.getAttribute('data-mac'));
    const isAggregate = deviceMacsInCard.length === 0 || deviceMacsInCard.includes('all');
    const invalid = validateTemplate(rule.message_template, rule.trigger_type, isAggregate);
    clearTemplateError(`rule-${ruleId}-templateError`);
    if (invalid.length > 0) {
        showCardTemplateError(ruleId, invalid);
        return;
    }
    
    // Collect selected devices from the device pill group
    const devicePills = card.querySelectorAll('.device-pill-group .device-pill');
    let deviceMacs = Array.from(devicePills).map(pill => pill.getAttribute('data-mac'));

    // Handle "Dashboard Total" mode - if 'all' is present, set devices to empty array for aggregate mode
    if (deviceMacs.includes('all')) {
        rule.devices = [];
    } else {
        rule.devices = deviceMacs;
    }
    
    // Collect selected alert targets from the alert target pill group
    const alertTargetPills = card.querySelectorAll('.alert-target-pill-group .alert-target-pill');
    rule.alert_target = Array.from(alertTargetPills).map(pill => pill.getAttribute('data-target'));
    // Ensure at least default target is present if empty
    if (!rule.alert_target || rule.alert_target.length === 0) {
        rule.alert_target = ["default"];
    }
    
    try {
        await fetch('/api/notification/rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rule)
        });
        
        alert('✅ Rule saved!');
        loadRules(); // Reload to reflect changes
    } catch (error) {
        console.error('[notifications] Error saving rule:', error);
        alert('Failed to save rule');
    }
}

async function deleteRule(ruleId) {
    if (!confirm('Delete this rule?')) return;
    
    try {
        await fetch(`/api/notification/rules/${ruleId}`, {
            method: 'DELETE'
        });
        
        loadRules();
    } catch (error) {
        console.error('[notifications] Error deleting rule:', error);
    }
}

function updateRuleSummary() {
    const cards = document.querySelectorAll('.rule-card');
    const total = cards.length;
    const active = [...cards].filter(c => c.querySelector('.rule-toggle input').checked).length;
    document.getElementById('ruleSummary').textContent = `${total} rules · ${active} active`;
    document.getElementById('ruleCount').textContent = total;
}

async function saveProviderConfig() {
    const provider = document.getElementById('providerSelect').value;
    let config = {};
    
    if (provider === 'ntfy') {
        config = {
            url: document.getElementById('ntfyUrl').value.trim(),
            topic: document.getElementById('ntfyTopic').value.trim() || 'skyhero-alerts'
        };
        // Add auth if enabled
        const authEnabled = document.getElementById('ntfyAuthEnabled').checked;
        if (authEnabled) {
            config.username = document.getElementById('ntfyUsername').value.trim();
            config.password = document.getElementById('ntfyPassword').value;
        }
    } else if (provider === 'gotify') {
        config = {
            url: document.getElementById('gotifyUrl').value.trim(),
            app_token: document.getElementById('gotifyToken').value.trim()
        };
    } else if (provider === 'pushover') {
        config = {
            user_key: document.getElementById('pushoverUserKey').value.trim(),
            app_token: document.getElementById('pushoverAppToken').value.trim()
        };
    } else if (provider === 'webhook') {
        config = {
            url: document.getElementById('webhookUrl').value.trim(),
            headers: document.getElementById('webhookHeaders').value.trim()
        };
    }
    
    try {
        const response = await fetch('/api/notification/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, config })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentProvider = provider;
            currentConfig = config;
            updateStatusBanner();
            updateAttachmentUI(); // Update attachment UI when provider changes
            document.getElementById('notifConfigOverlay').classList.remove('open');
            alert('✅ Configuration saved!');
        } else {
            alert('Failed to save config: ' + data.error);
        }
    } catch (error) {
        console.error('[notifications] Error saving config:', error);
        alert('Failed to save configuration');
    }
}

async function testProviderConnection() {
    alert('Testing connection... (feature coming soon)');
}

function updateTopicManagerForProvider() {
    const provider = currentProvider || 'ntfy';
    const label = document.getElementById('topicProviderLabel');
    const input = document.getElementById('topicProviderIdentifier');
    const hint = document.getElementById('topicProviderHint');
    
    const providerLabels = {
        ntfy: 'Ntfy Topic',
        gotify: 'Gotify App Token',
        pushover: 'Pushover User Key',
        webhook: 'Webhook URL'
    };
    
    const providerHints = {
        ntfy: '💡 This is the topic name that devices will subscribe to in the Ntfy app',
        gotify: '💡 This is the app token that devices will use in the Gotify app',
        pushover: '💡 This is the user key that devices will use in the Pushover app',
        webhook: '💡 This is the custom webhook URL that will receive notifications'
    };
    
    const providerPlaceholders = {
        ntfy: 'e.g., skyhero-dad',
        gotify: 'e.g., A1B2C3D4E5F6',
        pushover: 'e.g., u1234abcd5678efgh',
        webhook: 'e.g., https://your-server.com/webhook/dad'
    };
    
    label.textContent = providerLabels[provider] || 'Provider Identifier';
    hint.textContent = providerHints[provider] || '';
    input.placeholder = providerPlaceholders[provider] || '';
}

function openTopicEditor(topic) {
    // Update modal title and button text for editing
    const modalTitle = document.getElementById('topicModalTitle');
    const saveBtn = document.getElementById('saveTopicBtn');
    
    modalTitle.textContent = '✎ Edit Topic/Category';
    saveBtn.textContent = 'Update';
    saveBtn.setAttribute('data-topic-id', topic.id);
    
    // Populate form with existing topic data
    document.getElementById('topicName').value = topic.name || '';
    document.getElementById('topicProviderIdentifier').value = topic.provider_identifier || '';
    
    // Clear existing device pills
    const container = document.getElementById('topicDevices');
    const existingPills = container.querySelectorAll('.device-pill');
    existingPills.forEach(pill => pill.remove());
    
    // Add reference devices as pills
    if (topic.reference_devices && topic.reference_devices.length > 0) {
        for (const mac of topic.reference_devices) {
            const device = devicesData.devices.find(d => d.mac === mac);
            if (device) {
                addTopicDevicePill(mac, device.name);
            }
        }
    }
    
    // Update provider-specific labels
    updateTopicManagerForProvider();
    
    // Open the modal
    document.getElementById('notifTopicOverlay').classList.add('open');
}

function resetTopicForm() {
    // Reset modal title and button for create mode
    const modalTitle = document.getElementById('topicModalTitle');
    const saveBtn = document.getElementById('saveTopicBtn');
    
    modalTitle.textContent = '➕ Create Topic/Category';
    saveBtn.textContent = 'Create';
    saveBtn.setAttribute('data-topic-id', '');
    
    // Clear form fields
    document.getElementById('topicName').value = '';
    document.getElementById('topicProviderIdentifier').value = '';
    
    // Clear device pills
    const container = document.getElementById('topicDevices');
    const pills = container.querySelectorAll('.device-pill');
    pills.forEach(pill => pill.remove());
}

function showTopicDevicePicker() {
    const container = document.getElementById('topicDevices');
    
    if (!devicesData.has_data) {
        alert('No devices detected yet. Run SkyHero first to collect device data.');
        return;
    }
    
    // Check if picker is already open
    const existingPicker = container.querySelector('.device-picker');
    if (existingPicker) {
        existingPicker.remove();
        return;
    }
    
    // Create device picker dropdown
    const picker = document.createElement('div');
    picker.className = 'device-picker';
    picker.style.cssText = `
        background: white;
        border: 1px solid var(--notif-border-color);
        border-radius: 6px;
        padding: 8px;
        margin-top: 4px;
        max-height: 200px;
        overflow-y: auto;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        position: absolute;
        z-index: 1000;
    `;
    
    // Add individual devices
    for (const device of devicesData.devices) {
        const option = document.createElement('div');
        option.className = 'device-picker-option';
        option.style.cssText = 'padding: 6px 10px; cursor: pointer; border-radius: 4px; font-size: 0.82rem;';
        option.textContent = `📱 ${device.name}`;
        option.addEventListener('click', () => {
            addTopicDevicePill(device.mac, device.name);
            picker.remove();
        });
        option.addEventListener('mouseenter', () => option.style.background = '#ebf8ff');
        option.addEventListener('mouseleave', () => option.style.background = 'transparent');
        picker.appendChild(option);
    }
    
    container.appendChild(picker);
    
    // Close picker when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function closePicker(e) {
            if (!container.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closePicker);
            }
        });
    }, 10);
}

function addTopicDevicePill(mac, name) {
    const container = document.getElementById('topicDevices');
    const addBtn = container.querySelector('.add-device-pill-btn');
    
    // Check if already added
    const existing = container.querySelector(`[data-mac="${mac}"]`);
    if (existing) return;
    
    // Create pill
    const pill = document.createElement('span');
    pill.className = 'device-pill';
    pill.setAttribute('data-mac', mac);
    pill.innerHTML = `
        📱 ${name}
        <span class="pill-remove" style="cursor: pointer; margin-left: 4px; color: #a0aec0;">×</span>
    `;
    
    // Add remove handler
    pill.querySelector('.pill-remove').addEventListener('click', () => pill.remove());
    
    // Insert before the add button
    container.insertBefore(pill, addBtn);
}

async function saveTopic() {
    const name = document.getElementById('topicName').value.trim();
    const providerIdentifier = document.getElementById('topicProviderIdentifier').value.trim();
    const saveBtn = document.getElementById('saveTopicBtn');
    const topicId = saveBtn.getAttribute('data-topic-id');
    
    if (!name) {
        alert('Please enter a topic name');
        return;
    }
    
    if (!providerIdentifier) {
        alert('Please enter a provider identifier');
        return;
    }
    
    // Collect reference devices
    const devicePills = document.querySelectorAll('#topicDevices .device-pill');
    const referenceDevices = Array.from(devicePills).map(pill => pill.getAttribute('data-mac'));
    
    const topic = {
        name,
        provider_identifier: providerIdentifier,
        reference_devices: referenceDevices
    };
    
    // If editing, include the topic ID
    if (topicId) {
        topic.id = parseInt(topicId);
    }
    
    try {
        const response = await fetch('/api/notification/topics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(topic)
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('notifTopicOverlay').classList.remove('open');
            resetTopicForm();
            loadTopics();
            alert(topicId ? '✅ Topic updated!' : '✅ Topic created!');
        } else {
            alert('Failed to save topic: ' + data.error);
        }
    } catch (error) {
        console.error('[notifications] Error saving topic:', error);
        alert('Failed to save topic');
    }
}

async function deleteTopic(topicId) {
    try {
        await fetch(`/api/notification/topics/${topicId}`, {
            method: 'DELETE'
        });
        
        loadTopics();
    } catch (error) {
        console.error('[notifications] Error deleting topic:', error);
    }
}

async function sendManualMessage() {
    const title = document.getElementById('sendTitle').value.trim();
    const message = document.getElementById('sendMessage').value.trim();
    
    if (!message) {
        alert('Please enter a message');
        return;
    }
    
    const selectedChip = document.querySelector('.quick-target-chip.selected');
    const targetIdentifier = selectedChip ? selectedChip.dataset.target : 'all';
    
    // Check for file or URL attachment
    const attachmentFile = document.getElementById('attachmentFile');
    const attachmentUrl = document.getElementById('attachmentUrl');
    const hasFile = attachmentFile && attachmentFile.files && attachmentFile.files.length > 0;
    const hasUrl = attachmentUrl && attachmentUrl.value.trim();
    
    try {
        let response;
        
        if (hasFile) {
            // Send with file upload
            const formData = new FormData();
            formData.append('title', title);
            formData.append('message', message);
            formData.append('target_identifier', targetIdentifier);
            formData.append('attachment', attachmentFile.files[0]);
            
            response = await fetch('/api/notification/send', {
                method: 'POST',
                body: formData
            });
        } else {
            // Send with URL attachment or no attachment
            const body = { 
                title, 
                message, 
                target_identifier: targetIdentifier 
            };
            
            if (hasUrl) {
                body.attachment_url = attachmentUrl.value.trim();
            }
            
            response = await fetch('/api/notification/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        }
        
        const data = await response.json();
        
        if (data.success) {
            alert('✅ Message sent!');
            document.getElementById('sendMessage').value = '';
            document.getElementById('sendTitle').value = '';
            // Clear attachment fields
            clearFileSelection();
            if (attachmentUrl) attachmentUrl.value = '';
            loadHistory();
        } else {
            alert('❌ Failed to send message: ' + data.error);
        }
    } catch (error) {
        console.error('[notifications] Error sending message:', error);
        alert('Failed to send message');
    }
}

// =============================================================================
// Attachment Handling
// =============================================================================

function handleFileSelect(e) {
    const file = e.target.files[0];
    const fileNameEl = document.getElementById('fileName');
    const attachmentUrl = document.getElementById('attachmentUrl');
    const removeFileBtn = document.getElementById('removeFileBtn');
    
    if (file) {
        fileNameEl.textContent = `${file.name} (${formatFileSize(file.size)})`;
        fileNameEl.classList.add('has-file');
        if (removeFileBtn) removeFileBtn.style.display = 'flex';
        // Clear URL if file is selected
        if (attachmentUrl) attachmentUrl.value = '';
    } else {
        clearFileSelection();
    }
}

function clearFileSelection() {
    const fileNameEl = document.getElementById('fileName');
    const attachmentFile = document.getElementById('attachmentFile');
    const removeFileBtn = document.getElementById('removeFileBtn');
    
    if (fileNameEl) {
        fileNameEl.textContent = '';
        fileNameEl.classList.remove('has-file');
    }
    if (attachmentFile) attachmentFile.value = '';
    if (removeFileBtn) removeFileBtn.style.display = 'none';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function updateAttachmentUI() {
    const attachmentSection = document.getElementById('attachmentSection');
    const chooseFileBtn = document.getElementById('chooseFileBtn');
    const attachmentUrl = document.getElementById('attachmentUrl');
    const sizeHint = document.getElementById('attachmentSizeHint');
    
    if (!attachmentSection) return;
    
    const provider = currentProvider || 'ntfy';
    
    // Hide entire attachment section for Gotify
    if (provider === 'gotify') {
        attachmentSection.style.display = 'none';
        return;
    }
    
    attachmentSection.style.display = 'block';
    
    // Show/hide file upload button (Ntfy and Pushover support it)
    if (chooseFileBtn) {
        chooseFileBtn.style.display = (provider === 'ntfy' || provider === 'pushover') ? 'flex' : 'none';
        // Change button text based on provider
        if (provider === 'pushover') {
            chooseFileBtn.innerHTML = '📎 Attach image/file';
        } else {
            chooseFileBtn.innerHTML = '📎';
        }
    }
    
    // Show/hide URL input (only Ntfy supports it)
    if (attachmentUrl) {
        attachmentUrl.style.display = provider === 'ntfy' ? 'block' : 'none';
        attachmentUrl.placeholder = provider === 'ntfy' ? 'Or paste image URL' : '';
    }
    
    // Update size hint
    if (sizeHint) {
        if (provider === 'ntfy') {
            const ntfyUrl = currentConfig.url || '';
            const isNtfySh = ntfyUrl.includes('ntfy.sh');
            sizeHint.textContent = isNtfySh ? '⚠️ Max file size: 2 MB (ntfy.sh cloud)' : '⚠️ Max file size: 15 MB (self-hosted Ntfy)';
            sizeHint.style.display = 'block';
        } else if (provider === 'pushover') {
            sizeHint.textContent = '⚠️ Max file size: 5 MB';
            sizeHint.style.display = 'block';
        } else {
            sizeHint.style.display = 'none';
        }
    }
}

function getMaxAttachmentSize() {
    const provider = currentProvider || 'ntfy';
    
    if (provider === 'ntfy') {
        const ntfyUrl = currentConfig.url || '';
        const isNtfySh = ntfyUrl.includes('ntfy.sh');
        return isNtfySh ? 2 * 1024 * 1024 : 15 * 1024 * 1024; // 2 MB or 15 MB
    } else if (provider === 'pushover') {
        return 5 * 1024 * 1024; // 5 MB
    }
    
    return 0; // No file support
}

// =============================================================================
// Export for events.js
// =============================================================================

export function openNotificationsModal() {
    const overlay = document.getElementById('notifOverlay');
    if (overlay) {
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}
