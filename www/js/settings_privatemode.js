// settings_privatemode.js — Private mode display helpers + status indicator
// Display-only: real MAC/name stay in data attributes and saved JSON.

import { translate } from './i18n.js';

/**
 * @returns {boolean}
 */
export function isPrivateMode() {
    return document.body.classList.contains('private-mode');
}

/**
 * Stable hash → non-negative int from MAC string
 * @param {string} mac
 * @returns {number}
 */
function macHash(mac) {
    const s = String(mac || '').toLowerCase().replace(/[^a-f0-9]/g, '');
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h);
}

/**
 * Stable alias: Device A … Device Z, Device AA …
 * @param {string} mac
 * @returns {string}
 */
export function privateAlias(mac) {
    // Excel-style columns, 0-based → A, B, … Z, AA, …
    let n = (macHash(mac) % 702) + 1; // 1..702 → A..ZZ
    let label = '';
    while (n > 0) {
        n--;
        label = String.fromCharCode(65 + (n % 26)) + label;
        n = Math.floor(n / 26);
    }
    return `Device ${label}`;
}

/**
 * @param {string} name
 * @param {string} mac
 * @returns {string}
 */
export function privateDisplayName(name, mac) {
    if (!isPrivateMode()) return name || 'Unknown Device';
    return privateAlias(mac);
}

/**
 * Mask MAC to last octet only when private mode is on.
 * Example: ••:••:••:••:••:9f
 * @param {string} mac
 * @returns {string}
 */
export function privateDisplayMac(mac) {
    if (!mac) return '';
    if (!isPrivateMode()) return mac;
    const parts = String(mac).trim().split(/[:\-]/).filter(Boolean);
    const last = (parts[parts.length - 1] || '??').toLowerCase();
    return `••:••:••:••:••:${last}`;
}

/**
 * Mask saved group names for screenshots while keeping a small hint.
 * - Long names: first 2 chars + …  (e.g. "Family Phones" → "Fa…")
 * - Short names (≤2 chars): half-mask — first char + "."  (e.g. "LE" → "L.", "LW" → "L.")
 * @param {string} name
 * @returns {string}
 */
export function privateDisplayGroupName(name) {
    if (!isPrivateMode()) return name || '';
    const n = String(name || '').trim();
    if (n.length === 0) return '•';
    if (n.length <= 2) return n.charAt(0) + '.';
    return n.slice(0, 2) + '…';
}

/**
 * Ensure floating indicator exists in the DOM.
 * @returns {HTMLElement}
 */
function ensureIndicator() {
    let el = document.getElementById('private-mode-indicator');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'private-mode-indicator';
    el.className = 'private-mode-indicator';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;
    el.innerHTML = `
        <span class="pm-lock" aria-hidden="true">🔒</span>
        <span class="pm-label" data-i18n="Private mode">Private mode</span>
        <span class="pm-on-badge">ON</span>
    `;
    document.body.appendChild(el);
    return el;
}

/**
 * Toggle body class and fixed indicator.
 * @param {boolean} on
 */
export function applyPrivateModeUi(on) {
    document.body.classList.toggle('private-mode', !!on);
    const el = ensureIndicator();
    el.hidden = !on;
    if (on) {
        const span = el.querySelector('.pm-label');
        if (span) span.textContent = translate('Private mode') || 'Private mode';
        // Restart pulse so each activation feels fresh
        el.classList.remove('pm-just-on');
        // force reflow so animation can re-run
        void el.offsetWidth;
        el.classList.add('pm-just-on');
    }
}
