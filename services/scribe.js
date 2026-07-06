/**
 * scribe.js — Medium → Scribe service definition
 *
 * Redirection is performed by the content script (content/redirect.js) via
 * transformUrl() below. Scribe mirrors the Medium URL structure exactly, so
 * the redirect simply swaps the host:
 *   medium.com/@user/my-post-09a6af907a2  →  instance/@user/my-post-09a6af907a2
 *   medium.com/topic/technology            →  instance/topic/technology
 *   user.medium.com/my-post               →  instance/my-post
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
  sourceHosts: ['medium.com', 'www.medium.com', '*.medium.com'],
  ruleIdStart: 6000,
  ruleIdEnd: 6999,

  instanceFetcher: {
    // The blob view URL returns an HTML page, not raw markdown. Sending
    // Accept: text/plain causes SourceHut to respond with the raw file content.
    url: 'https://git.sr.ht/~edwardloveall/scribe/blob/main/docs/instances.md',
    fetchOptions: { headers: { 'Accept': 'text/plain' } },
    responseType: 'text',
    cacheTTLMs: 86_400_000, // 24 hours — the list changes infrequently

    /**
     * Parses the instances.md content into a normalised Instance array.
     * Handles both raw markdown (from Accept: text/plain) and the SourceHut
     * HTML blob view (fallback if the server ignores the Accept header).
     * @param {string} raw - raw markdown or HTML
     * @returns {import('./registry.js').Instance[]}
     */
    parse(raw) {
      if (typeof raw !== 'string') return [];

      // Domains to exclude from both HTML and markdown paths.
      // Catches sr.ht navigation links in HTML and Tor/I2P addresses in markdown.
      const SKIP = ['git.sr.ht', 'sr.ht', '.onion', '.i2p', 'man.sr.ht', 'todo.sr.ht'];
      const keep = url => !SKIP.some(d => url.includes(d));

      let urls;
      const trimmed = raw.trimStart();
      if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
        // SourceHut blob view HTML — extract href="https://..." anchor attributes.
        urls = [...raw.matchAll(/href="(https:\/\/[^"]+)"/g)]
          .map(m => m[1].replace(/\/$/, ''))
          .filter(keep);
      } else {
        // Raw markdown: bare links formatted as <https://instance.example/>
        urls = [...raw.matchAll(/<(https:\/\/[^\s>]+)>/g)]
          .map(m => m[1].replace(/\/$/, ''))
          .filter(keep);
      }

      return urls.map(url => ({ url, cloudflare: false, collectsData: false }));
    },

    fallbackFile: 'data/scribe-fallback.json',
  },

  /**
   * Transforms a medium.com URL to a Scribe instance URL.
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

    // Subdomains like user.medium.com — forward the path to the instance
    if (host.endsWith('.medium.com') && host !== 'medium.com') {
      if (url.pathname === '/' || url.pathname === '') return `${instance}/`;
      const path = url.pathname.replace(/\/+$/, '') || '/';
      return `${instance}${path}`;
    }

    if (host !== 'medium.com') return null;

    if (url.pathname === '/' || url.pathname === '') return `${instance}/`;

    // Forward path only, strip query/hash (removes UTM tracking params)
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
