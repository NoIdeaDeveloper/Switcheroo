/**
 * ui.js
 * Shared UI utilities used by both popup.js and options.js.
 */

/**
 * Escapes HTML special characters to prevent XSS when inserting
 * user-influenced content via innerHTML.
 *
 * @param {string} s
 * @returns {string}
 */
export function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/`/g, '&#96;');
}

/**
 * Sends a message to the background service worker and returns the response.
 * Rejects if chrome.runtime.lastError is set or the response contains an error.
 *
 * @param {{action: string, [key: string]: any}} message
 * @returns {Promise<any>}
 */
export function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (response?.error) return reject(new Error(response.error));
      resolve(response);
    });
  });
}

/**
 * Resolves the effective theme ('dark' or '') from a preference string.
 * 'system' follows the OS prefers-color-scheme media query.
 * Legacy booleans are normalized: true → 'dark', false → ''.
 * @param {string|boolean} pref
 * @returns {'dark'|''}
 */
export function resolveTheme(pref) {
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return '';
  if (pref === true) return 'dark';
  if (pref === false) return '';
  // 'system' or anything else → follow OS preference
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : '';
}

/**
 * Applies the effective theme to the document element.
 * @param {'dark'|''} theme
 */
export function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
}
