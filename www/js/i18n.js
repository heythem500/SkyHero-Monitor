let translations = {};
let currentLang = 'en';

// Loads the language file
async function loadLanguage(lang) {
    try {
        const response = await fetch(`js/locales/${lang}.json`);
        if (!response.ok) {
            console.error(`Could not load language file: js/locales/${lang}.json`);
            // Fallback to English if the language file is not found
            if (lang !== 'en') {
                return loadLanguage('en');
            }
            return;
        }
        const data = JSON5.parse(await response.text());
        translations = data.translations || data; // Handle both formats
        currentLang = lang;
        document.documentElement.lang = lang;
        // Don't change global direction - use selective RTL instead
        return data;
    } catch (error) {
        console.error('Error loading language file:', error);
    }
}

// Translates a single string
function translate(key) {
    return translations[key] || key;
}

// Applies the translations to all elements with data-i18n attribute
function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.dataset.i18n;
        if (translations[key]) {
            element.textContent = translations[key];
        }
    });
    
    // Update placeholder texts
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        const key = element.dataset.i18nPlaceholder;
        if (translations[key]) {
            element.placeholder = translations[key];
        }
    });
    
    // Handle selective RTL for Arabic content
    if (currentLang === 'ar') {
        // Apply RTL only to Controls section and headlines/titles, not content areas
        document.querySelectorAll('.control-panel, .control-section h3, #overview-title, .card h2, .quota-card h3, .device-card').forEach(el => {
            el.style.direction = 'rtl';
            el.style.textAlign = 'right';
        });
    } else {
        // Reset RTL for other languages
        document.querySelectorAll('.control-panel, .control-section h3, #overview-title, .card h2, .quota-card h3, .device-card').forEach(el => {
            el.style.direction = '';
            el.style.textAlign = '';
        });
    }

    // Update tooltip icons for language changes
    document.querySelectorAll('.tooltip-icon').forEach(el => el.textContent = translate('tooltipIcon'));
}

// Main function to initialize and apply translations
async function initTranslations(lang = 'en') {
    await loadLanguage(lang);
    applyTranslations();
}

// Change language
async function changeLanguage(lang) {
    await loadLanguage(lang);
    applyTranslations();
    // Save language preference to localStorage
    localStorage.setItem('preferredLanguage', lang);
    
    // Dispatch custom event for other modules to listen to
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
}

// Initialize with saved language or browser language
function detectLanguage() {
    // Check localStorage first
    const savedLang = localStorage.getItem('preferredLanguage');
    if (savedLang && ['en', 'ar', 'es', 'fr', 'it', 'id'].includes(savedLang)) {
        return savedLang;
    }
    
    // Check browser language
    const browserLang = navigator.language.substring(0, 2);
    if (['en', 'ar', 'es', 'fr', 'it', 'id'].includes(browserLang)) {
        return browserLang;
    }
    
    // Default to English
    return 'en';
}

// Set up language switcher
document.addEventListener('DOMContentLoaded', () => {
    const langSwitcher = document.getElementById('lang-switcher');
    if (langSwitcher) {
        // Set initial value
        const initialLang = detectLanguage();
        langSwitcher.value = initialLang;
        
        // Load initial language
        initTranslations(initialLang);
        
        // Add event listener
        langSwitcher.addEventListener('change', (e) => {
            changeLanguage(e.target.value);
        });
    }
});

// Export functions for use in other modules
export { 
    translate, 
    changeLanguage, 
    initTranslations,
    loadLanguage,
    applyTranslations
};