/**
 * googlefonts.js — Google Fonts → Bunny Fonts service definition
 *
 * This is a static-redirect service: there is exactly one redirect target
 * (fonts.bunny.net) and no live instance API to fetch or rotate.
 *
 * Privacy rationale:
 *   Google Fonts serves fonts from fonts.googleapis.com (CSS API) and
 *   fonts.gstatic.com (font files). Every request leaks the user's IP address
 *   and the page they're visiting to Google.
 *
 *   Bunny Fonts (fonts.bunny.net) is a drop-in API replacement:
 *     - Identical URL path and query-param structure (family=, display=, etc.)
 *     - No tracking, GDPR-compliant, operated by BunnyWay d.o.o. (Slovenia/EU)
 *     - The CSS returned by Bunny references Bunny CDN URLs for font files,
 *       so fonts.gstatic.com is never contacted — Google sees zero requests.
 *
 * DNR rule:
 *   3000  fonts.googleapis.com/(.*)  →  fonts.bunny.net/\1
 *
 *   Resource types: stylesheet + xmlhttprequest.
 *   stylesheet covers <link rel="stylesheet" href="fonts.googleapis.com/css2?...">
 *   xmlhttprequest covers programmatic fetch()/XHR calls to the CSS API.
 *
 * instanceFetcher.url is null — no remote fetch is ever made for this service.
 * The fallback file (data/googlefonts-fallback.json) holds the single entry and
 * acts as the canonical instance list for storage/UI purposes.
 */

/** @type {import('./registry.js').ServiceDefinition} */
export const googleFontsService = {
  id: 'googlefonts',
  name: 'Google Fonts',
  description: 'Redirect Google Fonts to Bunny Fonts, a privacy-friendly alternative with no tracking.',
  sourceHosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
  ruleIdStart: 3000,
  ruleIdEnd: 3999,

  instanceFetcher: {
    url: null,       // No live API — this service uses a static redirect target only.
    cacheTTLMs: Infinity, // Never stale; fallback is authoritative.
    parse: () => [], // No-op; parse is never called (url is null → fetchInstances returns early).
    fallbackFile: 'data/googlefonts-fallback.json',
  },

  /**
   * Builds the single DNR redirect rule when the service is enabled.
   *
   * @param {string} _extensionId - unused (kept for ServiceDefinition interface consistency)
   * @param {import('./registry.js').ServiceSettings} settings
   * @param {string[]} excludedInitiatorDomains
   * @returns {chrome.declarativeNetRequest.Rule[]}
   */
  buildRules(_extensionId, settings, excludedInitiatorDomains = []) {
    if (!settings.enabled) return [];

    const instance = settings.currentInstance;
    if (!instance) return [];

    return [
      {
        id: 3000,
        priority: 1,
        condition: {
          regexFilter: '^https://fonts\\.googleapis\\.com/(.*)',
          resourceTypes: ['stylesheet', 'xmlhttprequest'],
          isUrlFilterCaseSensitive: false,
          excludedInitiatorDomains,
        },
        action: {
          type: 'redirect',
          redirect: { regexSubstitution: `${instance}/\\1` },
        },
      },
    ];
  },

  /**
   * Default settings for first install.
   * Mode is always 'fixed' pointing to fonts.bunny.net.
   * @returns {import('./registry.js').ServiceSettings}
   */
  defaultSettings() {
    return {
      enabled: true,
      mode: 'fixed',
      fixedInstance: 'https://fonts.bunny.net',
      currentInstance: 'https://fonts.bunny.net',
      enabledInstances: ['https://fonts.bunny.net'],
      allowCloudflare: false,
    };
  },
};
