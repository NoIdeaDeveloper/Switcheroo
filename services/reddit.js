/**
 * reddit.js — Reddit → Redlib service definition
 *
 * Redirection is performed by the content script (content/redirect.js) via
 * transformUrl() below. transformUrl forwards the path only (preserving q= on
 * /search) and discards query strings, so tracking params (utm_*, ref,
 * ref_source, correlation_id, share_id) are stripped naturally.
 *
 * Cloudflare instances: Redlib's instances.json includes a `cloudflare` field.
 * Instances with cloudflare: true are stored but excluded from the active
 * set unless settings.allowCloudflare === true.
 */

/** @type {import('./registry.js').ServiceDefinition} */
export const redditService = {
  id: 'reddit',
  name: 'Reddit',
  description: 'Redirect to Redlib, a privacy-friendly Reddit frontend.',
  sourceHosts: ['reddit.com', 'www.reddit.com', 'old.reddit.com'],
  ruleIdStart: 2000,
  ruleIdEnd: 2999,

  instanceFetcher: {
    url: 'https://raw.githubusercontent.com/redlib-org/redlib-instances/refs/heads/main/instances.json',
    cacheTTLMs: 3_600_000, // 1 hour

    /**
     * Parses the raw Redlib instances JSON into a normalised Instance array.
     * @param {{instances: Array}} raw
     * @returns {import('./registry.js').Instance[]}
     */
    parse(raw) {
      if (!raw || !Array.isArray(raw.instances)) return [];
      return raw.instances
        .filter(inst => typeof inst?.url === 'string' && inst.url.startsWith('https://'))
        .map(inst => ({
          url: inst.url.replace(/\/$/, ''),
          country: inst.country ?? undefined,
          uptime: undefined, // Redlib instances.json does not expose uptime
          cloudflare: inst.cloudflare === true,
        }));
    },

    fallbackFile: 'data/reddit-fallback.json',
  },

  /**
   * Transforms a Reddit URL to a Redlib instance URL.
   * Returns null if the URL doesn't match.
   *
   * @param {string} href
   * @param {string} instance
   * @returns {string|null}
   */
  transformUrl(href, instance) {
    let url;
    try { url = new URL(href); } catch { return null; }

    const host = url.hostname.replace(/^www\./, '');
    if (host !== 'reddit.com' && host !== 'old.reddit.com') return null;

    // Homepage
    if (url.pathname === '/' || url.pathname === '') {
      return `${instance}/`;
    }

    // Search: preserve q param, strip everything else
    if (url.pathname === '/search') {
      const q = url.searchParams.get('q');
      if (q) return `${instance}/search?q=${encodeURIComponent(q)}`;
      return `${instance}/search`;
    }

    // All other paths: forward path only, strip query/hash
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
      rotationIntervalMs: 3_600_000, // how often to rotate in random mode (ms)
      lastRotatedAt: 0,              // timestamp of last rotation (set by background.js)
      excludedUrls: [],             // URL prefixes that should not be redirected
    };
  },
};
