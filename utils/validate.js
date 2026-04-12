/**
 * validate.js
 * Instance URL validation — runs before any URL is stored or used in a DNR rule.
 * Privacy goal: ensure we never redirect to HTTP, to source domains, or to
 * malformed URLs that could cause unexpected behaviour.
 */

/**
 * Returns true if the given URL string is a safe, valid redirect target.
 *
 * Rules:
 *  - Must start with https://
 *  - Must parse as a valid URL
 *  - Hostname must not be in the sourceHosts list (prevents redirect loops)
 *  - Must not use a browser-internal scheme
 *
 * @param {string} url
 * @param {string[]} sourceHosts - hostnames that should never be redirect targets
 * @returns {boolean}
 */
export function isValidInstanceUrl(url, sourceHosts = []) {
  if (typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Reject browser-internal schemes (belt-and-suspenders; already guarded by https check)
  const disallowed = ['chrome-extension:', 'moz-extension:', 'chrome:', 'about:', 'data:'];
  if (disallowed.some(s => parsed.protocol === s)) return false;

  // Must be HTTPS
  if (parsed.protocol !== 'https:') return false;

  // Must not redirect back to a source domain
  const hostname = parsed.hostname.toLowerCase();
  const normalizedSources = sourceHosts.map(h => h.toLowerCase());
  if (normalizedSources.includes(hostname)) return false;

  return true;
}

/**
 * Filters an array of Instance objects, keeping only those with valid URLs.
 * Mutates nothing — returns a new array.
 *
 * @param {Array<{url: string, [key: string]: any}>} instances
 * @param {string[]} sourceHosts
 * @returns {Array<{url: string, [key: string]: any}>}
 */
export function sanitizeInstanceList(instances, sourceHosts = []) {
  if (!Array.isArray(instances)) return [];
  return instances.filter(inst =>
    inst && typeof inst === 'object' && isValidInstanceUrl(inst.url, sourceHosts)
  );
}

/**
 * Validates a user-supplied custom instance URL and returns a normalised
 * version (trailing slash removed) or null if invalid.
 *
 * @param {string} url
 * @param {string[]} sourceHosts
 * @returns {string|null}
 */
export function validateUserInstanceUrl(url, sourceHosts = []) {
  if (!isValidInstanceUrl(url, sourceHosts)) return null;
  try {
    const parsed = new URL(url);
    // Return origin only (scheme + host + port) — no path
    return parsed.origin;
  } catch {
    return null;
  }
}
