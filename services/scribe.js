/**
 * scribe.js — Medium → Scribe service definition
 *
 * DNR rule strategy:
 *
 *   6000  medium.com homepage  (priority 2 — beats path catch-all)
 *   6001  medium.com path catch-all  (priority 1)
 *
 * Scribe mirrors the Medium URL structure exactly, so the redirect simply
 * swaps the host:
 *   medium.com/@user/my-post-09a6af907a2  →  instance/@user/my-post-09a6af907a2
 *   medium.com/topic/technology            →  instance/topic/technology
 *
 * Query strings are discarded to strip tracking parameters.
 *
 * The instance list at git.sr.ht is a plain markdown file. The fetcher
 * is configured with responseType: 'text' so fetchInstances() will call
 * response.text() instead of response.json(). parse() extracts all bare
 * <https://...> links while skipping Tor (.onion) and I2P (.i2p) entries.
 */

/** @type {import('./registry.js').ServiceDefinition} */
export const scribeService = {
  id: 'scribe',
  name: 'Medium',
  description: 'Redirect to Scribe, a privacy-friendly Medium frontend.',
  sourceHosts: ['medium.com', 'www.medium.com'],
  ruleIdStart: 6000,
  ruleIdEnd: 6999,

  instanceFetcher: {
    url: 'https://git.sr.ht/~edwardloveall/scribe/blob/main/docs/instances.md',
    responseType: 'text',
    cacheTTLMs: 86_400_000, // 24 hours — the list changes infrequently

    /**
     * Parses the instances.md markdown into a normalised Instance array.
     * Extracts bare <https://...> links; skips Tor and I2P entries.
     * @param {string} raw - raw markdown text
     * @returns {import('./registry.js').Instance[]}
     */
    parse(raw) {
      if (typeof raw !== 'string') return [];
      return [...raw.matchAll(/<(https:\/\/[^\s>]+)>/g)]
        .map(m => m[1].replace(/\/$/, ''))
        .filter(url => !url.includes('.onion') && !url.includes('.i2p'))
        .map(url => ({
          url,
          cloudflare: false,
          collectsData: false,
        }));
    },

    fallbackFile: 'data/scribe-fallback.json',
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
      // 6000 — Medium homepage with optional query string / fragment  (priority 2)
      {
        id: 6000,
        priority: 2,
        condition: cond('^https?://(www\\.)?medium\\.com/?(?:[?#].*)?$'),
        action: redirect(`${instance}/`),
      },

      // 6001 — medium.com path catch-all  (priority 1)
      // Captures the path and discards query strings.
      {
        id: 6001,
        priority: 1,
        condition: cond('^https?://(www\\.)?medium\\.com(/[^?#]+)'),
        action: redirect(`${instance}\\2`),
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
      rotationIntervalMs: 3_600_000,
      lastRotatedAt: 0,
    };
  },
};
