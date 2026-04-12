/**
 * reddit.js — Reddit → Redlib service definition
 *
 * DNR rule strategy:
 *
 *   2000  /search?q=QUERY  (priority 2 — must win over the path catch-all)
 *   2001  reddit.com homepage  (priority 2)
 *   2002  /r/... /u/... /user/... etc. path catch-all  (priority 1)
 *   2003  old.reddit.com path catch-all  (priority 1)
 *
 * All rules strip query parameters except for /search (which preserves q=).
 * Tracking params (utm_*, ref, ref_source, correlation_id, share_id) are
 * discarded naturally because we reconstruct URLs from the path only.
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
      // 2000 — /search?q=QUERY  (priority 2: must beat the path catch-all)
      {
        id: 2000,
        priority: 2,
        condition: cond('^https?://(www\\.)?reddit\\.com/search\\?(?:[^#]*&)?q=([^&#]*)'),
        action: redirect(`${instance}/search?q=\\2`),
      },

      // 2001 — Reddit homepage with optional query string / fragment
      //   (priority 2: must beat path catch-all)
      //   ^…\.com/? — optional trailing slash
      //   (?:[?#].*)? — optional query string or hash (e.g. ?sort=hot, ?ref=homepage)
      //   Fixes: reddit.com/?sort=hot previously slipped through and hit Reddit directly.
      {
        id: 2001,
        priority: 2,
        condition: cond('^https?://(www\\.)?reddit\\.com/?(?:[?#].*)?$'),
        action: redirect(`${instance}/`),
      },

      // 2002 — www.reddit.com path catch-all  (priority 1)
      // Captures the path (e.g. /r/privacy/comments/abc123/title/) and discards
      // query strings. This strips all tracking params cleanly.
      {
        id: 2002,
        priority: 1,
        condition: cond('^https?://(www\\.)?reddit\\.com(/[^?#]+)'),
        action: redirect(`${instance}\\2`),
      },

      // 2003 — old.reddit.com path catch-all  (priority 1)
      {
        id: 2003,
        priority: 1,
        condition: cond('^https?://old\\.reddit\\.com(/[^?#]*)'),
        action: redirect(`${instance}\\1`),
      },
    ];
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
    };
  },
};
