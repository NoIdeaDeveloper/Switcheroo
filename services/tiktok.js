/**
 * tiktok.js — TikTok → ProxiTok service definition
 *
 * DNR rule strategy:
 *
 *   5000  tiktok.com homepage  (priority 2 — beats path catch-all)
 *   5001  tiktok.com path catch-all  (priority 1)
 *
 * ProxiTok uses the same URL path structure as TikTok, so the redirect
 * simply replaces the host and forwards the path:
 *   tiktok.com/@handle            → instance/@handle
 *   tiktok.com/@handle/video/ID   → instance/@handle/video/ID
 *   tiktok.com/trending           → instance/trending
 *
 * Query strings are discarded to strip tracking parameters.
 *
 * The instance list at raw.githubusercontent.com/.../instances.json is an
 * array of objects. Instances with cdn: true are flagged as cloudflare so
 * users can opt them out via the Allow CDN setting.
 */

/** @type {import('./registry.js').ServiceDefinition} */
export const tiktokService = {
  id: 'tiktok',
  name: 'TikTok',
  description: 'Redirect to ProxiTok, a privacy-friendly TikTok frontend.',
  sourceHosts: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com'],
  ruleIdStart: 5000,
  ruleIdEnd: 5999,

  instanceFetcher: {
    url: 'https://raw.githubusercontent.com/pablouser1/ProxiTok/refs/heads/master/instances.json',
    cacheTTLMs: 3_600_000, // 1 hour

    /**
     * Parses the ProxiTok instances JSON into a normalised Instance array.
     * Only clearnet HTTPS instances are included.
     * @param {Array} raw
     * @returns {import('./registry.js').Instance[]}
     */
    parse(raw) {
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(inst => typeof inst?.clearnet === 'string' && inst.clearnet.startsWith('https://'))
        .map(inst => ({
          url: inst.clearnet.replace(/\/$/, ''),
          country: inst.country ?? undefined,
          uptime: undefined, // ProxiTok instances.json does not expose uptime
          cloudflare: inst.cdn === true,
        }));
    },

    fallbackFile: 'data/tiktok-fallback.json',
  },

  /**
   * Builds DNR rules for the given instance URL.
   * Returns an empty array if the service is disabled or no instance is set.
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

    const cond = (regexFilter) => ({
      regexFilter,
      resourceTypes: ['main_frame'],
      isUrlFilterCaseSensitive: false,
      excludedInitiatorDomains,
    });

    const redirect = (regexSubstitution) => ({
      type: 'redirect',
      redirect: { regexSubstitution },
    });

    return [
      // 5000 — TikTok homepage with optional query string / fragment  (priority 2)
      // Matches tiktok.com, www.tiktok.com, m.tiktok.com, vm.tiktok.com, etc.
      {
        id: 5000,
        priority: 2,
        condition: cond('^https?://([a-z0-9]+\\.)?tiktok\\.com/?(?:[?#].*)?$'),
        action: redirect(`${instance}/`),
      },

      // 5001 — tiktok.com path catch-all  (priority 1)
      // Captures the path and discards query strings.
      // Matches any subdomain of tiktok.com.
      {
        id: 5001,
        priority: 1,
        condition: cond('^https?://([a-z0-9]+\\.)?tiktok\\.com(/[^?#]+)'),
        action: redirect(`${instance}\\2`),
      },
    ];
  },

  /**
   * Transforms a TikTok URL to a ProxiTok instance URL.
   * Returns null if the URL doesn't match.
   *
   * @param {string} href
   * @param {string} instance
   * @returns {string|null}
   */
  transformUrl(href, instance) {
    let url;
    try { url = new URL(href); } catch { return null; }

    const host = url.hostname;
    if (!host.endsWith('.tiktok.com') && host !== 'tiktok.com') return null;

    if (url.pathname === '/' || url.pathname === '') return `${instance}/`;

    // Forward path only, strip query/hash (removes tracking params)
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${instance}${path}`;
  },

  /**
   * Returns the default settings for this service on first install.
   * @returns {import('./registry.js').ServiceSettings}
   */
  defaultSettings() {
    return {
      enabled: true,
      mode: 'random',
      fixedInstance: null,
      currentInstance: null,
      enabledInstances: [],
      allowCloudflare: false,
      rotationIntervalMs: 3_600_000,
      lastRotatedAt: 0,
    };
  },
};
