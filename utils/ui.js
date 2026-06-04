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
