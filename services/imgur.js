/**
 * imgur.js — Imgur → Rimgo service definition
 *
 * DNR rule strategy:
 *
 *   4000  imgur.com homepage  (priority 2 — beats path catch-all)
 *   4001  imgur.com path catch-all  (priority 1)
 *   4002  i.imgur.com direct image URLs  (priority 1, main_frame + image)
 *
 * Rimgo URL mapping:
 *   imgur.com/* paths are served at the same path on the rimgo instance.
 *   i.imgur.com/HASH.ext direct image links are served at /media/HASH.ext.
 *
 * Tracking params are discarded naturally because we reconstruct URLs from
 * the path only (query strings are not forwarded).
 *
 * The instance API at rimgo.codeberg.page/api.json returns a `clearnet`
 * array. There is no uptime or Cloudflare field — instances are flagged
 * only by the `note` string ("✅ Data not collected" / "⚠️ Data collected").
 * We treat any instance with a "Data collected" note as a Cloudflare/
 * privacy-reduced instance so users can filter them.
 */

/** @type {import('./registry.js').ServiceDefinition} */
export const imgurService = {
  id: 'imgur',
  name: 'Imgur',
  description: 'Redirect to Rimgo, a privacy-friendly Imgur frontend.',
  sourceHosts: ['imgur.com', 'www.imgur.com', 'i.imgur.com'],
  ruleIdStart: 4000,
  ruleIdEnd: 4999,

  instanceFetcher: {
    url: 'https://rimgo.codeberg.page/api.json',
    cacheTTLMs: 3_600_000, // 1 hour

    /**
     * Parses the rimgo instances JSON into a normalised Instance array.
     * Only clearnet HTTPS instances are included.
     * @param {{clearnet: Array}} raw
     * @returns {import('./registry.js').Instance[]}
     */
    parse(raw) {
      if (!raw || !Array.isArray(raw.clearnet)) return [];
      return raw.clearnet
        .filter(inst => typeof inst?.url === 'string' && inst.url.startsWith('https://'))
        .map(inst => ({
          url: inst.url.replace(/\/$/, ''),
          country: inst.country ?? undefined,
          uptime: undefined,   // rimgo instances.json does not expose uptime
          cloudflare: false,
          collectsData: typeof inst.note === 'string' && inst.note.includes('Data collected'),
        }));
    },

    fallbackFile: 'data/imgur-fallback.json',
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

    const cond = (regexFilter, resourceTypes = ['main_frame']) => ({
      regexFilter,
      resourceTypes,
      isUrlFilterCaseSensitive: false,
      excludedInitiatorDomains,
    });

    const redirect = (regexSubstitution) => ({
      type: 'redirect',
      redirect: { regexSubstitution },
    });

    return [
      // 4000 — Imgur homepage with optional query string / fragment  (priority 2)
      {
        id: 4000,
        priority: 2,
        condition: cond('^https?://(www\\.)?imgur\\.com/?(?:[?#].*)?$'),
        action: redirect(`${instance}/`),
      },

      // 4001 — imgur.com path catch-all  (priority 1)
      // Captures the path and discards query strings.
      {
        id: 4001,
        priority: 1,
        condition: cond('^https?://(www\\.)?imgur\\.com(/[^?#]+)'),
        action: redirect(`${instance}\\2`),
      },

      // 4002 — i.imgur.com direct image URLs  (priority 1)
      // Rimgo serves these at /media/<hash>.<ext>.
      // Intercepts both direct navigation (main_frame) and embedded images.
      {
        id: 4002,
        priority: 1,
        condition: cond('^https?://i\\.imgur\\.com(/[^?#]+)', ['main_frame', 'image']),
        action: redirect(`${instance}/media\\1`),
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
