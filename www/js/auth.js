// auth.js - Authentication handling functions
// MIGRATION STATUS: PHASE 3

/*
  Related: main.js → calls checkAuth on page load
  Used by: FEATURE - Dashboard Authentication
  MIGRATION STATUS: PHASE 3
*/

import { translate } from './i18n.js';

/**
 * Check authentication status and show login overlay if needed
 * @param {Function} initMonthNavigator - Function to initialize month navigator
 * @param {Function} applyFilter - Function to apply filters
 * @param {Function} initPalestineKid - Function to initialize Palestine kid image
 * @returns {Promise<void>}
 */
async function checkAuth(initMonthNavigator, applyFilter, initPalestineKid) {
    try {
        const response = await fetch('/auth_status');
        if (!response.ok) {
            throw new Error(`Auth status check failed with status: ${response.status}`);
        }
        const data = await response.json();

        // Initialize palestineKidContainer here so it's available globally within this scope
        const palestineKidContainer = document.getElementById('palestineKidContainer');

        if (data.enabled) {
            // If password is enabled, get the dashboard-content element and blur it
            const dashboardContent = document.getElementById('dashboard-content');
            if (dashboardContent) {
                dashboardContent.classList.add('blurred');
            }
            document.getElementById('login-overlay').style.display = 'flex';

            // Auto-focus password input on desktop after a short delay to ensure overlay is visible
            const isMobile = window.matchMedia('(max-width: 768px)').matches;
            if (!isMobile) {
                setTimeout(() => {
                    const passwordInput = document.getElementById('password-input');
                    if (passwordInput) {
                        passwordInput.focus();
                    }
                }, 100);
            }

            // Control Palestine Kid image visibility based on device type when login overlay appears
            if (palestineKidContainer) {
                if (isMobile) {
                    palestineKidContainer.style.display = 'block'; // Show on mobile
                    initPalestineKid(); // Start timer/buttons for mobile
                } else {
                    palestineKidContainer.style.display = 'none'; // Hide on desktop
                }
            }
        } else {
            // If not enabled, proceed to load the month navigator
            initMonthNavigator();
            // Show Palestine Kid image if not enabled
            if (palestineKidContainer) {
                palestineKidContainer.style.display = 'block';
            }
            initPalestineKid();
        }
    }
    catch (e) {
        console.error("Error checking auth status:", e);
        // If auth_status.sh fails, assume no password and load dashboard
        applyFilter('this_month');
        // In case of auth check error, default to showing the image (as if no password)
        const palestineKidContainer = document.getElementById('palestineKidContainer');
        if (palestineKidContainer) {
            palestineKidContainer.style.display = 'block';
        }
        initPalestineKid();
    }
}

/**
 * Attach event listeners to the login form
 * @param {Function} initMonthNavigator - Function to initialize month navigator
 * @param {Function} initPalestineKid - Function to initialize Palestine kid image
 */
function attachLoginFormListeners(initMonthNavigator, initPalestineKid) {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        const passwordInput = document.getElementById('password-input');
        const loginBox = document.querySelector('.login-box');
        const errorMessage = document.getElementById('error-message');

        loginForm.addEventListener('submit', async function (event) {
            event.preventDefault();
            const passwordAttempt = passwordInput.value;

            try {
                const response = await fetch('/auth_check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: passwordAttempt
                });
                const data = await response.json();

                if (data.success) {
                    document.getElementById('login-overlay').style.display = 'none';
                    const dashboardContent = document.getElementById('dashboard-content');
                    if (dashboardContent) {
                        dashboardContent.classList.remove('blurred');
                    }
                    initMonthNavigator();
                    // Show Palestine Kid image after successful login
                    const palestineKidContainer = document.getElementById('palestineKidContainer');
                    if (palestineKidContainer) {
                        palestineKidContainer.style.display = 'block';
                    }
                    initPalestineKid();
                } else {
                    errorMessage.classList.add('visible');
                    loginBox.classList.add('shake');
                    passwordInput.classList.add('error'); // Add error class
                    passwordInput.value = '';
                    setTimeout(() => {
                        loginBox.classList.remove('shake');
                    }, 500);
                }
            } catch (e) {
                console.error("Error during authentication:", e);
                errorMessage.textContent = "Authentication error.";
                errorMessage.classList.add('visible');
                passwordInput.classList.add('error'); // Add error class on general auth error
            }
        });

        // Remove error class when user starts typing
        passwordInput.addEventListener('input', () => {
            passwordInput.classList.remove('error');
            errorMessage.classList.remove('visible'); // Hide error message on input
        });

        // Mobile keyboard handling
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (isMobile) {
            const loginOverlay = document.getElementById('login-overlay');

            // Handle virtual keyboard appearance on mobile
            passwordInput.addEventListener('focus', () => {
                setTimeout(() => {
                    loginBox.classList.add('keyboard-active');
                    loginOverlay.classList.add('keyboard-mode');
                }, 300); // Small delay to allow keyboard animation
            });

            passwordInput.addEventListener('blur', () => {
                loginBox.classList.remove('keyboard-active');
                loginOverlay.classList.remove('keyboard-mode');
            });

            // Handle viewport resize (keyboard show/hide)
            let initialViewportHeight = window.innerHeight;
            window.addEventListener('resize', () => {
                const currentHeight = window.innerHeight;
                const heightDifference = initialViewportHeight - currentHeight;

                // If height decreased significantly (keyboard appeared)
                if (heightDifference > 150) {
                    loginBox.classList.add('keyboard-active');
                    loginOverlay.classList.add('keyboard-mode');
                } else {
                    loginBox.classList.remove('keyboard-active');
                    loginOverlay.classList.remove('keyboard-mode');
                }
            });
        }
    }
}

// Export functions for use in other modules
export { checkAuth, attachLoginFormListeners };