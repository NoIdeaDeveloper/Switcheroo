/**
 * youtube.js — YouTube → Invidious service definition
 *
 * Redirection is performed by the content script (content/redirect.js) via
 * transformUrl() below. The earlier DNR-rule strategy was removed when
 * navigation services moved to content scripts; only Google Fonts still uses DNR.
 *
 * transformUrl() forwards only the essential identifier (v, q, list, embed ID,
 * channel/handle/user). Tracking params (si, pp, feature, ab_channel, utm_*)
 * are discarded because the destination URL is reconstructed from scratch.
 *
 * Known limitation: timestamp (?t=) and playlist context on watch pages are
 * not forwarded — an acceptable tradeoff to avoid forwarding unnecessary data.
 */

/** @type {import('./registry.js').ServiceDefinition} */
export const youtubeService = {
  id: 'youtube',
  name: 'YouTube',
  description: 'Redirect to Invidious, a privacy-friendly YouTube frontend.',
  sourceHosts: ['youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'],
  ruleIdStart: 1000,
  ruleIdEnd: 1999,

  instanceFetcher: {
    url: 'https://api.invidious.io/instances.json?sort_by=type,users',
    cacheTTLMs: 3_600_000, // 1 hour

    /**
     * Parses the raw Invidious API response into a normalised Instance array.
     * Filters to HTTPS instances with >80% uptime.
     * @param {Array} raw - Array of [id, data] pairs
     * @returns {import('./registry.js').Instance[]}
     */
    parse(raw) {
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(([, data]) =>
          data?.type === 'https' &&
          typeof data?.uri === 'string' &&
          (data?.monitor?.uptime ?? 0) > 80
        )
        .map(([, data]) => {
          const meta = {};
          const version = data.stats?.software?.version ?? data.stats?.version;
          if (version) meta['Version'] = version;
          if (typeof data.stats?.openRegistrations === 'boolean') {
            meta['Registration'] = data.stats.openRegistrations ? 'Open' : 'Closed';
          }
          const users = data.stats?.usage?.users?.total;
          if (typeof users === 'number') meta['Users'] = users.toLocaleString();
          if (data.cors === true)  meta['CORS'] = 'Yes';
          if (data.api  === false) meta['API']  = 'Disabled';

          return {
            url: data.uri.replace(/\/$/, ''),
            country: data.region ?? data.stats?.region ?? undefined,
            uptime: data.monitor?.uptime ?? undefined,
            cloudflare: false,
            meta: Object.keys(meta).length ? meta : undefined,
          };
        })
        .slice(0, 30); // cap to avoid bloated storage
    },

    fallbackFile: 'data/youtube-fallback.json',
  },

  /**
   * Transforms a YouTube/youtu.be URL to an Invidious instance URL.
   * Returns null if the URL doesn't match any handled pattern.
   *
   * @param {string} href - the full URL being navigated to
   * @param {string} instance - base URL of the Invidious instance (no trailing slash)
   * @returns {string|null}
   */
  transformUrl(href, instance) {
    let url;
    try { url = new URL(href); } catch { return null; }

    const host = url.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      if (/^[a-zA-Z0-9_-]+$/.test(id)) return `${instance}/watch?v=${id}`;
      return null;
    }

    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;

    const p = url.pathname;

    if (p.startsWith('/watch')) {
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]+$/.test(v)) return `${instance}/watch?v=${v}`;
      return null;
    }
    if (p.startsWith('/shorts/')) {
      const id = p.split('/')[2];
      if (id && /^[a-zA-Z0-9_-]+$/.test(id)) return `${instance}/watch?v=${id}`;
      return null;
    }
    if (p.startsWith('/results')) {
      const q = url.searchParams.get('search_query');
      if (q) return `${instance}/search?q=${encodeURIComponent(q)}`;
      return null;
    }
    if (p.startsWith('/playlist')) {
      const list = url.searchParams.get('list');
      if (list) return `${instance}/playlist?list=${encodeURIComponent(list)}`;
      return null;
    }
    if (p.startsWith('/embed/')) {
      const id = p.split('/')[2];
      if (id && /^[a-zA-Z0-9_-]+$/.test(id)) return `${instance}/embed/${id}`;
      return null;
    }
    if (p.startsWith('/channel/')) {
      const id = p.split('/')[2];
      if (id) return `${instance}/channel/${id}`;
      return null;
    }
    if (p.startsWith('/@')) {
      const handle = p.slice(2).split('/')[0];
      if (handle) return `${instance}/@${handle}`;
      return null;
    }
    if (p.startsWith('/user/')) {
      const name = p.split('/')[2];
      if (name) return `${instance}/user/${name}`;
      return null;
    }

    return null;
  },

  /**
   * Returns the default settings for this service on first install.
   * @returns {import('./registry.js').ServiceSettings}
   */
  defaultSettings() {
    return {
      enabled: true,
      mode: 'random',          // 'random' | 'fixed'
      fixedInstance: null,     // URL string when mode === 'fixed'
      currentInstance: null,   // actively used instance (set by background.js)
      enabledInstances: [],    // empty = all instances enabled (opt-out model)
      allowCloudflare: false,
      rotationIntervalMs: 3_600_000, // how often to rotate in random mode (ms)
      lastRotatedAt: 0,              // timestamp of last rotation (set by background.js)
    };
  },
};
