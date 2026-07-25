// notes.js - Notes panel module
// Structured blocks with prevention-at-input DOM safety

import { translate } from './i18n.js';
import { formatBytes } from './utils.js';
import { privateDisplayName } from './settings_privatemode.js';

// ---- Constants ----
const TAG_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6'];
const MAX_UNDO = 50;
const UNDO_DEBOUNCE = 200;

// ---- State ----
let colorIndex = 0;
let undoStack = [];
let redoStack = [];
let undoIndex = -1;
let activeTag = null;
let savedNote = null; // Loaded from server
let savedEditorRange = null; // Save editor cursor position for text helpers

// ---- DOM refs ----
let panel, editor, acDropdown, statsPicker, undoBtn, redoBtn, saveBtn, lastSavedEl;

// ---- Autocomplete state ----
let acQuery = '';
let acRange = null;
let acMode = 'cursor'; // 'cursor' for @ typing, 'button' for Add Device click

/**
 * Initialize the notes panel. Call once during app startup.
 */
export function initNotes() {
    panel = document.getElementById('notes-panel');
    editor = document.getElementById('notes-editor');
    acDropdown = document.getElementById('autocomplete-dropdown');
    statsPicker = document.getElementById('notes-stats-picker');
    undoBtn = document.getElementById('notes-undo-btn');
    redoBtn = document.getElementById('notes-redo-btn');
    saveBtn = document.getElementById('notes-save-btn');
    lastSavedEl = document.getElementById('notes-last-saved');

    if (!panel || !editor) {
        console.error('Notes panel: required elements not found');
        return;
    }

    // Paste interceptor — strip to plain text
    editor.addEventListener('paste', handlePaste);

    // Autocomplete on @ typing
    editor.addEventListener('input', handleInput);

    // Click handling: tag click, tag remove, dismiss picker
    editor.addEventListener('click', handleEditorClick);

    // Toolbar buttons
    undoBtn.addEventListener('click', doUndo);
    redoBtn.addEventListener('click', doRedo);

    // Add Device button — shows full device list (empty filter)
    const addDeviceBtn = document.getElementById('notes-add-device-btn');
    if (addDeviceBtn) {
        addDeviceBtn.addEventListener('click', handleAddDevice);
    }

    // Save button
    saveBtn.addEventListener('click', handleSave);

    // Stats picker is dynamically rendered — no need for initial setup
    // It will show text helpers by default when panel opens

    // Keyboard: Enter in editor should just insert newline (default)
    // Escape dismisses picker
    editor.addEventListener('keydown', handleKeydown);

    // Load saved note from server
    loadNote();

    // Listen for language changes
    window.addEventListener('languageChanged', handleLanguageChange);
}

/**
 * Toggle the notes panel open/closed
 */
export function toggleNotesPanel() {
    if (!panel) return;
    const isExpanded = panel.classList.contains('expanded');
    if (isExpanded) {
        closePanel();
    } else {
        openPanel();
    }
}

function openPanel() {
    panel.classList.remove('collapsed');
    panel.classList.add('expanded');
    editor.focus();
    
    // Show text helpers when panel opens (no tag active)
    if (!activeTag) {
        showTextHelpers();
    }
}

function closePanel() {
    panel.classList.remove('expanded');
    panel.classList.add('collapsed');
    hideAutocomplete();
    dismissPicker();
}

// ---------- Add Device (toolbar button) ----------
function handleAddDevice() {
    editor.focus();

    acMode = 'button';
    acQuery = '';

    // Capture current cursor position in the editor
    const sel = window.getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) {
        // Place cursor at end of editor if focus was lost
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    }
    acRange = sel.getRangeAt(0).cloneRange();

    renderAutocomplete();
    positionAutocomplete();
}

// ---------- Paste Interceptor ----------
function handlePaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
}

// ---------- Autocomplete on @ ----------
function handleInput() {
    // Save cursor position
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        savedEditorRange = sel.getRangeAt(0).cloneRange();
    }
    
    if (!sel.rangeCount || sel.getRangeAt(0).startContainer.nodeType !== Node.TEXT_NODE) {
        hideAutocomplete();
        return;
    }
    const text = sel.getRangeAt(0).startContainer.textContent;
    const cursor = sel.getRangeAt(0).startOffset;
    const before = text.substring(0, cursor);
    const match = before.match(/@(\w*)$/);

    if (match) {
        acQuery = match[1].toLowerCase();
        acMode = 'cursor';
        acRange = sel.getRangeAt(0).cloneRange();
        renderAutocomplete();
        positionAutocomplete();
    } else {
        hideAutocomplete();
    }

    // Debounced undo
    handleInputDebounce();
}

let inputTimer;
function handleInputDebounce() {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => pushUndo(), UNDO_DEBOUNCE);
}

function renderAutocomplete() {
    const devices = getDevices();
    const filtered = devices.filter(d => {
        const name = d.name ? d.name.toLowerCase() : '';
        return name.includes(acQuery);
    });
    acDropdown.innerHTML = '';
    if (filtered.length === 0) {
        acDropdown.style.display = 'none';
        return;
    }
    filtered.forEach((d, i) => {
        const item = document.createElement('div');
        item.className = 'ac-item' + (i === 0 ? ' active' : '');
        item.textContent = privateDisplayName(d.name, d.mac);
        item.addEventListener('click', () => insertTag(d));
        acDropdown.appendChild(item);
    });
    acDropdown.style.display = 'block';
}

function positionAutocomplete() {
    if (acMode === 'button') {
        // Position below the Add Device button
        const btn = document.getElementById('notes-add-device-btn');
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        acDropdown.style.left = rect.left + 'px';
        acDropdown.style.top = (rect.bottom + 4) + 'px';
    } else {
        // Position at cursor
        if (!acRange) return;
        const rect = acRange.getBoundingClientRect();
        acDropdown.style.left = rect.left + 'px';
        acDropdown.style.top = (rect.bottom + 4) + 'px';
    }
}

function hideAutocomplete() {
    acDropdown.style.display = 'none';
    acQuery = '';
    acRange = null;
    acMode = 'cursor';
}

// ---------- Device Tag Insertion ----------
function insertTag(device) {
    // IMPORTANT: save the range BEFORE hideAutocomplete() which resets acRange
    const savedRange = acRange;
    hideAutocomplete();

    // Restore the selection that was captured when @ was typed
    if (!savedRange) return;
    
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);

    const range = sel.getRangeAt(0);
    // Find the current text node (could be inside a div created by the browser)
    let node = range.startContainer;
    if (node.nodeType === Node.ELEMENT_NODE) {
        // If it's an element node, get the text node at the offset
        node = node.childNodes[range.startOffset] || node.lastChild;
    }
    if (!node || node.nodeType !== Node.TEXT_NODE) {
        // If we still don't have a text node, try to find one or create insertion point
        console.warn('insertTag: No text node found at cursor position');
        return;
    }

    const text = node.textContent;
    const cursor = range.startOffset;
    const before = text.substring(0, cursor);
    const atMatch = before.match(/@(\w*)$/);

    if (atMatch) {
        const start = cursor - atMatch[0].length;
        // Remove the @word from the text
        node.textContent = text.substring(0, start) + text.substring(cursor);
        range.setStart(node, start);
        range.setEnd(node, start);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    // Build tag element using DocumentFragment
    const color = TAG_COLORS[colorIndex % TAG_COLORS.length];
    colorIndex++;
    const temp = document.createElement('div');
    temp.innerHTML = `<span class="device-tag active-tag" style="--tag-color:${color};" contenteditable="false" data-mac="${device.mac}" data-name="${device.name}" data-stats='[]' data-stat-values='{}'>${privateDisplayName(device.name, device.mac)} <span class="tag-stats"></span><span class="tag-remove">&times;</span></span>&nbsp;`;
    const frag = document.createDocumentFragment();
    while (temp.firstChild) frag.appendChild(temp.firstChild);

    // Insert fragment at current cursor
    const curRange = sel.getRangeAt(0);
    curRange.deleteContents();
    curRange.insertNode(frag);
    curRange.collapse(false);
    sel.removeAllRanges();
    sel.addRange(curRange);

    // Find and activate the newly inserted tag
    const tag = editor.querySelector('.device-tag.active-tag:last-of-type');
    if (tag) activateTag(tag);
    pushUndo();
}

// ---------- Stats Picker ----------
function activateTag(tag) {
    if (activeTag && activeTag !== tag) {
        activeTag.classList.remove('active-tag');
    }
    activeTag = tag;
    tag.classList.add('active-tag');

    // Show stats picker for device tag
    showStatsPicker();

    // Pre-select pills based on tag's existing stats
    const existingStats = tag.dataset.stats ? JSON.parse(tag.dataset.stats) : [];
    statsPicker.querySelectorAll('.sp-pill').forEach(p => {
        p.classList.toggle('selected', existingStats.includes(p.dataset.stat));
    });

    // Translate pill labels
    updateStatPillLabels();
}

function dismissPicker() {
    if (activeTag) {
        activeTag.classList.remove('active-tag');
    }
    activeTag = null;
    // Show text helpers when no tag is active
    showTextHelpers();
}

// Stats Picker - Device Stats
function showStatsPicker() {
    statsPicker.innerHTML = `
        <span class="sp-label" data-i18n="Stats:">Stats:</span>
        <span class="sp-pill" data-stat="download">⬇ Download</span>
        <span class="sp-pill" data-stat="upload">⬆ Upload</span>
        <span class="sp-pill" data-stat="total">📊 Total</span>
        <span class="sp-pill" data-stat="percentage">% Percentage</span>
    `;
    statsPicker.classList.add('visible');
    
    // Re-attach pill click handlers
    statsPicker.querySelectorAll('.sp-pill').forEach(pill => {
        pill.addEventListener('click', () => handleStatPillClick(pill));
    });
    
    // Translate labels
    updateStatPillLabels();
}

// Text Helpers - shown when no device pill is selected
function showTextHelpers() {
    statsPicker.innerHTML = `
        <span class="sp-label" data-i18n="Format:">Format:</span>
        <span class="sp-pill sp-helper" data-insert="→">→ Arrow</span>
        <span class="sp-pill sp-helper" data-insert="⚠️">⚠️ Warning</span>
        <span class="sp-pill sp-helper" data-insert="✅">✅ OK</span>
        <span class="sp-pill sp-helper" data-insert="❓">❓ Question</span>
        <span class="sp-pill sp-helper" data-insert="🔴">🔴 Offline</span>
        <span class="sp-pill sp-helper" data-insert="🟢">🟢 Online</span>
    `;
    statsPicker.classList.add('visible');
    
    // Re-attach helper click handlers
    statsPicker.querySelectorAll('.sp-helper').forEach(pill => {
        pill.addEventListener('click', () => insertTextAtCursor(pill.dataset.insert));
    });
    
    // Translate label
    const label = statsPicker.querySelector('.sp-label');
    if (label) label.textContent = translate('Format:');
}

// Insert text at saved editor cursor position
function insertTextAtCursor(text) {
    if (!savedEditorRange) {
        // If no saved position, try to get current selection in editor
        const sel = window.getSelection();
        if (!sel.rangeCount || !editor.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
        savedEditorRange = sel.getRangeAt(0).cloneRange();
    }
    
    const range = savedEditorRange;
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    
    // Update the selection to the new position
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    
    // Save the new position
    savedEditorRange = range.cloneRange();
    
    editor.focus();
    pushUndo();
}

function handleStatPillClick(pill) {
    if (!activeTag) return;
    const stat = pill.dataset.stat;
    let stats = activeTag.dataset.stats ? JSON.parse(activeTag.dataset.stats) : [];
    let statValues = activeTag.dataset.statValues ? JSON.parse(activeTag.dataset.statValues) : {};
    const device = getDevices().find(d => d.mac === activeTag.dataset.mac);
    if (!device) return;

    if (stats.includes(stat)) {
        // Remove this stat
        stats = stats.filter(s => s !== stat);
        delete statValues[stat];
        pill.classList.remove('selected');
    } else {
        // Add this stat
        stats.push(stat);
        const valMap = {
            download: formatBytes(device.dl_bytes || 0),
            upload: formatBytes(device.ul_bytes || 0),
            total: formatBytes(device.total_bytes || 0),
            percentage: (device.percentage || 0).toFixed(2) // Don't add % - icon already provides it
        };
        statValues[stat] = valMap[stat] || '';
        pill.classList.add('selected');
    }

    activeTag.dataset.stats = JSON.stringify(stats);
    activeTag.dataset.statValues = JSON.stringify(statValues);

    // Render stats inside the tag
    renderTagStats(activeTag, stats, statValues);
    pushUndo();
}

function renderTagStats(tag, stats, statValues) {
    const statsSpan = tag.querySelector('.tag-stats');
    if (!statsSpan) return;
    const icons = {
        download: '⬇',
        upload: '⬆',
        total: '📊',
        percentage: '%'
    };
    statsSpan.textContent = stats.map(s => icons[s] + (statValues[s] || '')).join(' ');
}

function updateStatPillLabels() {
    statsPicker.querySelectorAll('.sp-pill').forEach(pill => {
        // Use existing translate keys: Download, Upload, Total, Percentage
        const key = pill.dataset.stat === 'percentage' ? 'Percentage' : pill.dataset.stat.charAt(0).toUpperCase() + pill.dataset.stat.slice(1);
        pill.textContent = pill.dataset.stat === 'download' ? '⬇ ' + translate(key) :
                          pill.dataset.stat === 'upload' ? '⬆ ' + translate(key) :
                          pill.dataset.stat === 'total' ? '📊 ' + translate(key) :
                          '% ' + translate(key);
    });
}

// ---------- Editor Click Handling ----------
function handleEditorClick(e) {
    // Save the current cursor position in the editor
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        savedEditorRange = sel.getRangeAt(0).cloneRange();
    }
    
    if (e.target.classList.contains('tag-remove')) {
        // Remove the tag entirely
        e.target.closest('.device-tag')?.remove();
        dismissPicker();
        pushUndo();
    } else {
        const tag = e.target.closest('.device-tag');
        if (tag) {
            activateTag(tag);
        } else {
            dismissPicker();
        }
    }
}

function handleKeydown(e) {
    // Autocomplete keyboard navigation
    if (acDropdown.style.display === 'block') {
        const items = acDropdown.querySelectorAll('.ac-item');
        const activeItem = acDropdown.querySelector('.ac-item.active');
        const activeIndex = Array.from(items).indexOf(activeItem);

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            items.forEach(item => item.classList.remove('active'));
            const nextIndex = (activeIndex + 1) % items.length;
            items[nextIndex].classList.add('active');
            items[nextIndex].scrollIntoView({ block: 'nearest' });
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            items.forEach(item => item.classList.remove('active'));
            const prevIndex = (activeIndex - 1 + items.length) % items.length;
            items[prevIndex].classList.add('active');
            items[prevIndex].scrollIntoView({ block: 'nearest' });
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            if (activeItem) {
                // Find the device name from the active item
                const deviceName = activeItem.textContent;
                const devices = getDevices();
                const device = devices.find(d => d.name === deviceName);
                if (device) insertTag(device);
            }
            return;
        }
    }

    if (e.key === 'Escape') {
        dismissPicker();
        hideAutocomplete();
    }
}

// ---------- Undo / Redo ----------
function pushUndo() {
    const html = editor.innerHTML;
    if (undoIndex < undoStack.length - 1) {
        undoStack = undoStack.slice(0, undoIndex + 1);
    }
    undoStack.push(html);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    undoIndex = undoStack.length - 1;
    redoStack = [];
    updateUndoRedoButtons();
}

function doUndo() {
    if (undoIndex > 0) {
        redoStack.push(undoStack[undoIndex]);
        undoIndex--;
        editor.innerHTML = undoStack[undoIndex];
        updateUndoRedoButtons();
        dismissPicker();
    }
}

function doRedo() {
    if (redoStack.length > 0) {
        undoIndex++;
        const state = redoStack.pop();
        undoStack[undoIndex] = state;
        editor.innerHTML = state;
        updateUndoRedoButtons();
        dismissPicker();
    }
}

function updateUndoRedoButtons() {
    if (undoBtn) undoBtn.disabled = undoIndex <= 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

// ---------- Save ----------
function serializeBlocks() {
    const blocks = [];
    editor.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            if (node.textContent.trim() || node.textContent.includes('\n')) {
                blocks.push({ type: 'text', content: node.textContent });
            }
        } else if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('device-tag')) {
            blocks.push({
                type: 'device_tag',
                mac: node.dataset.mac,
                name: node.dataset.name,
                stats: node.dataset.stats ? JSON.parse(node.dataset.stats) : [],
                stat_values: node.dataset.statValues ? JSON.parse(node.dataset.statValues) : {}
            });
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            // Handle line breaks: <div>, <br>, <p> elements
            if (node.tagName === 'BR') {
                // Append newline to previous text block or create new one
                if (blocks.length > 0 && blocks[blocks.length - 1].type === 'text') {
                    blocks[blocks.length - 1].content += '\n';
                } else {
                    blocks.push({ type: 'text', content: '\n' });
                }
            } else if (node.tagName === 'DIV' || node.tagName === 'P') {
                // Block element — treat its content as a line, append newline
                const text = node.textContent || '';
                if (text.trim() || text.includes('\n')) {
                    blocks.push({ type: 'text', content: text + '\n' });
                }
            } else if (node.textContent.trim()) {
                // Unknown elements with text — preserve as text
                blocks.push({ type: 'text', content: node.textContent });
            }
        }
    });
    return blocks;
}

function renderBlocks(blocks) {
    editor.innerHTML = '';
    if (!blocks || blocks.length === 0) return;

    blocks.forEach((block, blockIdx) => {
        if (block.type === 'text') {
            // Split text by newlines and create text nodes + <br> elements
            const lines = block.content.split('\n');
            lines.forEach((line, i) => {
                if (line) {
                    editor.appendChild(document.createTextNode(line));
                }
                // Add <br> after each line except the last one
                if (i < lines.length - 1) {
                    editor.appendChild(document.createElement('br'));
                }
            });
        } else if (block.type === 'device_tag') {
            const color = TAG_COLORS[colorIndex % TAG_COLORS.length];
            colorIndex++;

            const tag = document.createElement('span');
            tag.className = 'device-tag';
            tag.dataset.mac = block.mac;
            tag.dataset.name = block.name;
            tag.dataset.stats = JSON.stringify(block.stats || []);
            tag.dataset.statValues = JSON.stringify(block.stat_values || {});
            tag.style.setProperty('--tag-color', color);

            const icons = { download: '⬇', upload: '⬆', total: '📊', percentage: '%' };
            const statsText = (block.stats || []).map(s =>
                icons[s] + ((block.stat_values || {})[s] || '')
            ).join(' ');

            tag.innerHTML = `${privateDisplayName(block.name, block.mac)} <span class="tag-stats">${statsText}</span><span class="tag-remove">&times;</span>`;
            editor.appendChild(tag);
            
            // Add trailing space after tag so user can type after it
            editor.appendChild(document.createTextNode('\u00A0')); // Non-breaking space
        }
    });
}

async function handleSave() {
    const blocks = serializeBlocks();
    const noteData = { blocks, last_saved: new Date().toLocaleString() };

    try {
        const response = await fetch('/api/note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(noteData)
        });
        const result = await response.json();
        if (result.success) {
            savedNote = noteData;
            lastSavedEl.textContent = translate('Last saved:') + ' ' + noteData.last_saved;
            saveBtn.textContent = translate('Saved!');
            saveBtn.classList.add('saved');
            setTimeout(() => {
                saveBtn.textContent = translate('Save');
                saveBtn.classList.remove('saved');
            }, 1500);
        } else {
            console.error('Save failed:', result.error);
        }
    } catch (error) {
        console.error('Error saving note:', error);
    }
}

// ---------- Load ----------
async function loadNote() {
    try {
        const response = await fetch('/api/note');
        if (!response.ok) return; // No saved note yet
        const result = await response.json();
        if (result.blocks && result.blocks.length > 0) {
            savedNote = result;
            renderBlocks(result.blocks);
            pushUndo();
        }
        if (result.last_saved) {
            lastSavedEl.textContent = translate('Last saved:') + ' ' + result.last_saved;
        }
    } catch (error) {
        // No note saved yet — that's fine
    }
}

// ---------- Language Change ----------
function handleLanguageChange() {
    // Update static labels
    const header = document.getElementById('notes-header-title');
    if (header) header.textContent = translate('Device Notes');

    const hint = document.getElementById('notes-hint-text');
    if (hint) hint.textContent = translate('Type @ to mention a device. Click an existing tag to edit its stats.');

    const placeholder = document.getElementById('notes-editor');
    if (placeholder) placeholder.dataset.placeholder =
        translate('Type @ to mention a device. Click an existing tag to edit its stats.');

    updateStatPillLabels();
    saveBtn.textContent = translate('Save');
    undoBtn.textContent = translate('Undo');
    redoBtn.textContent = translate('Redo');

    if (savedNote && savedNote.last_saved) {
        lastSavedEl.textContent = translate('Last saved:') + ' ' + savedNote.last_saved;
    }
}

// ---------- Helpers ----------
function getDevices() {
    return window.currentDevices || [];
}
