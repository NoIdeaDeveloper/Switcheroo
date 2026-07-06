/**
 * imgur.js — Imgur → Rimgo service definition
 *
 * Redirection is performed by the content script (content/redirect.js) via
 * transformUrl() below.
 *
 * Rimgo URL mapping:
 *   imgur.com/* paths are served at the same path on the rimgo instance.
 *   i.imgur.com/HASH.ext direct image links are served at /media/HASH.ext.
 *
 * Tracking params are discarded because URLs are reconstructed from the path
 * only (query strings are not forwarded).
 *
 * The instance API at rimgo.codeberg.page/api.json returns a `clearnet`
 * array. There is no uptime or Cloudflare field — instances are flagged
 * only by the `note` string ("✅ Data not collected" / "⚠️ Data collected").
 * Instances with a "Data collected" note are flagged so users can filter them.
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
          uptime: undefined,
          cloudflare: false,
          collectsData: typeof inst.note === 'string' && inst.note.includes('Data collected'),
          meta: (() => {
            const m = {};
            if (inst.provider) m['Provider'] = inst.provider;
            if (inst.note) m['Status'] = inst.note.replace(/[✅⚠️]/gu, '').trim();
            return Object.keys(m).length ? m : undefined;
          })(),
        }));
    },

    fallbackFile: 'data/imgur-fallback.json',
  },

  /**
   * Transforms an Imgur URL to a Rimgo instance URL.
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

    if (host === 'i.imgur.com') {
      if (url.pathname === '/' || url.pathname === '') return `${instance}/`;
      return `${instance}/media${url.pathname}`;
    }

    if (host !== 'imgur.com') return null;

    if (url.pathname === '/' || url.pathname === '') return `${instance}/`;

    // Forward path only, strip query/hash
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
