/**
 * tiktok.js — TikTok → ProxiTok service definition
 *
 * Redirection is performed by the content script (content/redirect.js) via
 * transformUrl() below. ProxiTok uses the same URL path structure as TikTok,
 * so the redirect simply replaces the host and forwards the path:
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
      excludedUrls: [],             // URL prefixes that should not be redirected
    };
  },
};
