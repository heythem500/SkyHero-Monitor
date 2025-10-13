// modalManager.js - Manages modal language translations and settings
// MIGRATION STATUS: PHASE 4

import { translate, loadLanguage } from './i18n.js';

/**
 * Modal language manager class
 */
class ModalLanguageManager {
    constructor() {
        this.currentPrimaryLang = localStorage.getItem('modalPrimaryLang') || 'en';
        this.currentSecondaryLang = localStorage.getItem('modalSecondaryLang') || 'ar';
        this.translations = {};
        this.originalState = new Map();
        this.settingsModal = null;
        this.isInitialized = false;
        this.setupDynamicContentListener();
    }

    /**
     * Setup listener for dynamic content rendering events
     */
    setupDynamicContentListener() {
        document.addEventListener('modalAppsRendered', (event) => {
            // Only apply translations if we're in an active modal context
            const summaryContainer = this.getSummaryContainer();
            if (summaryContainer && summaryContainer.contains(event.detail.container)) {
                this.applyModalTranslation(this.currentPrimaryLang);
            }
        });
    }

    /**
     * Initialize the modal language manager
     */
    async init() {
        if (this.isInitialized) return;

        // Load initial translations
        await this.loadModalTranslations(this.currentPrimaryLang);
        await this.loadModalTranslations(this.currentSecondaryLang);

        // Apply primary language to modal content
        this.applyModalTranslation(this.currentPrimaryLang);

        // Create settings modal
        this.createSettingsModal();

        // Add settings icon to modal headers
        this.addSettingsIcon();

        this.isInitialized = true;
    }

    /**
     * Load translations for a specific language
     */
    async loadModalTranslations(lang) {
        try {
            const response = await fetch(`js/locales/${lang}.json`);
            if (!response.ok) throw new Error(`Failed to load ${lang} translations`);
            const data = JSON5.parse(await response.text());
            this.translations[lang] = data.translations || {};
        } catch (error) {
            console.error(`Error loading ${lang} translations:`, error);
            this.translations[lang] = {};
        }
    }

    /**
     * Get translated text for current primary language
     */
    getTranslatedText(key, lang = this.currentPrimaryLang) {
        return this.translations[lang]?.[key] || key;
    }

    /**
     * Apply translations to modal content
     */
    applyModalTranslation(lang = this.currentPrimaryLang) {
        const summaryContainer = this.getSummaryContainer();
        if (!summaryContainer) return;

        this.revertToOriginal();

        const elementsToTranslate = summaryContainer.querySelectorAll('[data-modal-i18n]');
        elementsToTranslate.forEach(el => {
            const key = el.dataset.modalI18n;
            const translatedText = this.getTranslatedText(key, lang);
            if (translatedText !== key) {
                this.originalState.set(el, el.textContent);
                el.textContent = translatedText;
            }
        });

        // Handle RTL for Arabic and Urdu
        if (lang === 'ar' || lang === 'ur') {
            this.applyRTL(summaryContainer);
        } else {
            this.removeRTL(summaryContainer);
        }

        // Translate units in text nodes
        this.translateUnits(summaryContainer, lang);

        // Update toggle buttons
        this.updateToggleButtons();
    }

    /**
     * Revert modal content to original state
     */
    revertToOriginal() {
        this.originalState.forEach((originalText, el) => {
            el.textContent = originalText;
        });
        this.originalState.clear();

        const summaryContainer = this.getSummaryContainer();
        if (summaryContainer) {
            this.removeRTL(summaryContainer);
        }
    }

    /**
     * Apply RTL styling for Arabic and Urdu
     */
    applyRTL(container) {
        const rtlElements = container.querySelectorAll('.summary-section, .monthly-usage, .top-apps, .app-list, h3, h4, .app-list li');
        rtlElements.forEach(el => {
            el.style.direction = 'rtl';
            el.style.textAlign = 'right';
        });
    }

    /**
     * Remove RTL styling
     */
    removeRTL(container) {
        const rtlElements = container.querySelectorAll('.summary-section, .monthly-usage, .top-apps, .app-list, h3, h4, .app-list li');
        rtlElements.forEach(el => {
            el.style.direction = '';
            el.style.textAlign = '';
        });
    }

     /**
      * Translate units (GB/MB/KB) in text nodes
      */
    translateUnits(container, lang) {
        const gbUnit = this.getTranslatedText('GB', lang);
        const mbUnit = this.getTranslatedText('MB', lang);
        const kbUnit = this.getTranslatedText('KB', lang);
        const bUnit = this.getTranslatedText('B', lang);

        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            const originalText = node.nodeValue;
            let newText = originalText;
            let changed = false;

            if (newText.includes(' GB')) {
                newText = newText.replace(/ GB/g, ` ${gbUnit}`);
                changed = true;
            }
            if (newText.includes(' MB')) {
                newText = newText.replace(/ MB/g, ` ${mbUnit}`);
                changed = true;
            }
            if (newText.includes(' KB')) {
                newText = newText.replace(/ KB/g, ` ${kbUnit}`);
                changed = true;
            }
            if (newText.includes(' B')) {
                newText = newText.replace(/ B/g, ` ${bUnit}`);
                changed = true;
            }

            if (changed) {
                if (!this.originalState.has(node)) {
                    this.originalState.set(node, originalText);
                }
                node.nodeValue = newText;
            }
        }
    }

    /**
     * Get summary container from modal
     */
    getSummaryContainer() {
        return document.querySelector('#deviceCardModalContent .summary-section') ||
               document.querySelector('#clean-screenshot-overlay .summary-section') ||
               document.querySelector('.summary-content .summary-section');
    }

    /**
     * Create settings modal for language selection
     */
    createSettingsModal() {
        if (this.settingsModal) return;

        this.settingsModal = document.createElement('div');
        this.settingsModal.id = 'modal-settings-modal';
        this.settingsModal.className = 'modal-settings-overlay';
        this.settingsModal.innerHTML = `
            <div class="modal-settings-content">
                <div class="modal-settings-header">
                    <h3 data-modal-i18n="Language Settings">Language Settings</h3>
                    <button class="modal-settings-close">&times;</button>
                </div>
                <div class="modal-settings-body">
                     <div class="setting-group">
                         <label for="modal-primary-lang" data-modal-i18n="Primary Language">Primary Language:</label>
                         <select id="modal-primary-lang">
                             <option value="en">English</option>
                             <option value="ar">Arabic</option>
                             <option value="es">Español</option>
                             <option value="fr">Français</option>
                             <option value="it">Italiano</option>
                             <option value="id">Indonesian</option>
                             <option value="sv">Swedish</option>
                             <option value="nl">Dutch</option>
                             <option value="tr">Türkçe</option>
                             <option value="pt">Português</option>
                             <option value="bn">Bengali</option>
                             <option value="ur">Urdu</option>
                             <option value="hi">Hindi</option>
                         </select>
                     </div>
                     <div class="setting-group">
                         <label for="modal-secondary-lang" data-modal-i18n="Secondary Language">Secondary Language:</label>
                          <select id="modal-secondary-lang">
                              <option value="ar">Arabic</option>
                              <option value="en">English</option>
                              <option value="es">Español</option>
                              <option value="fr">Français</option>
                              <option value="it">Italiano</option>
                              <option value="id">Indonesian</option>
                              <option value="sv">Swedish</option>
                              <option value="nl">Dutch</option>
                              <option value="tr">Türkçe</option>
                              <option value="pt">Português</option>
                              <option value="bn">Bengali</option>
                              <option value="ur">Urdu</option>
                              <option value="hi">Hindi</option>
                          </select>
                      </div>
                     <div class="modal-reset-options">
                         <button class="btn-small btn-reset-lang" data-modal-i18n="Reset Language Settings"><span class="icon">🔄</span> Reset Language Settings</button>
                         <button class="btn-small btn-clear-storage" data-modal-i18n="Clear Browser Storage"><span class="icon">🗑️</span> Clear Browser Storage</button>
                     </div>
                 </div>
                 <div class="modal-settings-actions">
                     <button class="btn-cancel" data-modal-i18n="Cancel">Cancel</button>
                     <button class="btn-save" data-modal-i18n="Save Settings">Save Settings</button>
                 </div>
            </div>
        `;

        document.body.appendChild(this.settingsModal);

        // Add event listeners
        this.setupSettingsModalEvents();
    }

    /**
     * Setup event listeners for settings modal
     */
    setupSettingsModalEvents() {
        const closeBtn = this.settingsModal.querySelector('.modal-settings-close');
        const cancelBtn = this.settingsModal.querySelector('.btn-cancel');
        const saveBtn = this.settingsModal.querySelector('.btn-save');

        const closeModal = () => {
            this.settingsModal.style.display = 'none';
        };

        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);

        this.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.settingsModal) {
                closeModal();
            }
        });

        saveBtn.addEventListener('click', async () => {
            const primarySelect = document.getElementById('modal-primary-lang');
            const secondarySelect = document.getElementById('modal-secondary-lang');

            this.currentPrimaryLang = primarySelect.value;
            this.currentSecondaryLang = secondarySelect.value;

            // Save to localStorage
            localStorage.setItem('modalPrimaryLang', this.currentPrimaryLang);
            localStorage.setItem('modalSecondaryLang', this.currentSecondaryLang);

            // Load translations
            await this.loadModalTranslations(this.currentPrimaryLang);
            await this.loadModalTranslations(this.currentSecondaryLang);

            // Apply primary language
            this.applyModalTranslation(this.currentPrimaryLang);

            // Update toggle buttons
            this.updateToggleButtons();

            closeModal();
        });

        const resetLangBtn = this.settingsModal.querySelector('.btn-reset-lang');
        resetLangBtn.addEventListener('click', async () => {
            if (confirm('Are you sure you want to reset language settings to defaults?')) {
                // Remove modal language keys from localStorage
                localStorage.removeItem('modalPrimaryLang');
                localStorage.removeItem('modalSecondaryLang');

                // Reset to defaults
                this.currentPrimaryLang = 'en';
                this.currentSecondaryLang = 'ar';

                // Load default translations
                await this.loadModalTranslations(this.currentPrimaryLang);
                await this.loadModalTranslations(this.currentSecondaryLang);

                // Apply primary language
                this.applyModalTranslation(this.currentPrimaryLang);

                // Update toggle buttons
                this.updateToggleButtons();

                // Update settings modal selects
                const primarySelect = document.getElementById('modal-primary-lang');
                const secondarySelect = document.getElementById('modal-secondary-lang');
                if (primarySelect) primarySelect.value = this.currentPrimaryLang;
                if (secondarySelect) secondarySelect.value = this.currentSecondaryLang;

                // Close the modal
                closeModal();
            }
        });

        const clearStorageBtn = this.settingsModal.querySelector('.btn-clear-storage');
        clearStorageBtn.addEventListener('click', async () => {
            if (confirm('Are you sure you want to clear all browser storage? This cannot be undone.')) {
                // Clear all localStorage
                localStorage.clear();

                // Reset modal languages to defaults
                this.currentPrimaryLang = 'en';
                this.currentSecondaryLang = 'ar';

                // Load default translations
                await this.loadModalTranslations(this.currentPrimaryLang);
                await this.loadModalTranslations(this.currentSecondaryLang);

                // Apply primary language
                this.applyModalTranslation(this.currentPrimaryLang);

                // Update toggle buttons
                this.updateToggleButtons();

                // Update settings modal selects
                const primarySelect = document.getElementById('modal-primary-lang');
                const secondarySelect = document.getElementById('modal-secondary-lang');
                if (primarySelect) primarySelect.value = this.currentPrimaryLang;
                if (secondarySelect) secondarySelect.value = this.currentSecondaryLang;

                alert('All browser storage cleared. Settings reset to defaults.');
            }
        });
    }

    /**
     * Add settings icon before language toggles
     */
    addSettingsIcon() {
        const languageToggles = document.querySelectorAll('.language-toggle');
        languageToggles.forEach(toggle => {
            const parent = toggle.parentElement;
            if (parent.querySelector('.modal-settings-icon')) return; // Already added

            const settingsIcon = document.createElement('div');
            settingsIcon.className = 'modal-settings-icon';
            settingsIcon.innerHTML = '⚙️';
            settingsIcon.title = 'Language Settings';
            settingsIcon.addEventListener('click', () => {
                this.showSettingsModal();
            });

            parent.insertBefore(settingsIcon, toggle);
        });
    }

    /**
     * Show settings modal
     */
    showSettingsModal() {
        if (!this.settingsModal) return;

        // Set current values
        const primarySelect = document.getElementById('modal-primary-lang');
        const secondarySelect = document.getElementById('modal-secondary-lang');

        if (primarySelect) primarySelect.value = this.currentPrimaryLang;
        if (secondarySelect) secondarySelect.value = this.currentSecondaryLang;

        // Apply translations to settings modal
        this.applySettingsModalTranslation();

        this.settingsModal.style.display = 'flex';
    }

    /**
     * Apply translations to settings modal
     */
    applySettingsModalTranslation() {
        if (!this.settingsModal) return;

        const elements = this.settingsModal.querySelectorAll('[data-modal-i18n]');
        elements.forEach(el => {
            const key = el.dataset.modalI18n;
            const translatedText = this.getTranslatedText(key, this.currentPrimaryLang);
            if (translatedText !== key) {
                el.textContent = translatedText;
            }
        });
    }

    /**
     * Update toggle buttons based on current languages
     */
    updateToggleButtons() {
        const lang1Btn = document.getElementById('lang1');
        const lang2Btn = document.getElementById('lang2');

        if (lang1Btn) {
            lang1Btn.textContent = this.currentPrimaryLang.toUpperCase();
            lang1Btn.dataset.lang = this.currentPrimaryLang;
            lang1Btn.classList.add('active');
        }
        if (lang2Btn) {
            lang2Btn.textContent = this.currentSecondaryLang.toUpperCase();
            lang2Btn.dataset.lang = this.currentSecondaryLang;
            lang2Btn.classList.remove('active');
        }
    }

    /**
     * Switch to specific language
     */
    switchToLanguage(lang) {
        if (lang === this.currentPrimaryLang) {
            this.applyModalTranslation(this.currentPrimaryLang);
        } else if (lang === this.currentSecondaryLang) {
            this.applyModalTranslation(this.currentSecondaryLang);
        }
    }
}

// Create singleton instance
const modalLanguageManager = new ModalLanguageManager();

// Export for use in other modules
export { modalLanguageManager, ModalLanguageManager };
