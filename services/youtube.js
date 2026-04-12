/**
 * youtube.js — YouTube → Invidious service definition
 *
 * DNR rule strategy (all rules priority 1, resourceTypes as noted):
 *
 *   1000  /watch?v=VIDEO_ID           → /watch?v=\2
 *   1001  /shorts/VIDEO_ID            → /watch?v=\2
 *   1002  /results?search_query=QUERY → /search?q=\2
 *   1003  /playlist?list=LIST_ID      → /playlist?list=\2
 *   1004  youtube.com/embed/VIDEO_ID             → /embed/\2   (main+sub frame)
 *   1009  youtube-nocookie.com/embed/VIDEO_ID    → /embed/\2   (main+sub frame)
 *   1005  /channel/CHANNEL_ID         → /channel/\2
 *   1006  /@HANDLE                    → /@\2
 *   1007  /user/USERNAME              → /user/\2
 *   1008  youtu.be/VIDEO_ID           → /watch?v=\1
 *
 * Capture group numbering:
 *   For rules 1000–1007: group 1 = optional "www.", group 2 = key identifier
 *   For rule  1008:      group 1 = video ID (youtu.be has no "www." group)
 *
 * Tracking params stripped at the rule level: only the essential identifier is
 * forwarded (v, q, list, embed ID). UTM params, si, pp, feature, ab_channel
 * are discarded naturally because we reconstruct the URL from scratch.
 *
 * Regex note: patterns do NOT use [^#]* or similar broad Unicode character
 * classes. Chrome's DNR RE2 compiler expands these to large DFAs that exceed
 * the 2KB compiled-regex memory limit. All character classes are ASCII-bounded.
 *
 * Known limitation: timestamp (?t=) and playlist context on watch pages are
 * not forwarded. This is an acceptable tradeoff to keep DNR rules simple and
 * to avoid forwarding any unnecessary URL data.
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
   * Builds DNR rules for the given instance URL.
   * Returns an empty array if the service is disabled or no instance is set.
   *
   * @param {string} _extensionId - unused (kept for ServiceDefinition interface consistency)
   * @param {import('./registry.js').ServiceSettings} settings
   * @param {string[]} excludedInitiatorDomains - all known instance hostnames
   * @returns {chrome.declarativeNetRequest.Rule[]}
   */
  buildRules(_extensionId, settings, excludedInitiatorDomains = []) {
    if (!settings.enabled) return [];

    const instance = settings.currentInstance;
    if (!instance) return [];

    const shared = {
      priority: 1,
      action: { type: 'redirect' },
    };

    const cond = (regexFilter, resourceTypes = ['main_frame']) => ({
      regexFilter,
      resourceTypes,
      isUrlFilterCaseSensitive: false,
      excludedInitiatorDomains,
    });

    const sub = path => ({ redirect: { regexSubstitution: `${instance}${path}` } });

    return [
      // 1000 — /watch?v=VIDEO_ID
      // v= is always the first query param in YouTube watch URLs.
      // Trailing params (&list=, &t=, etc.) are naturally ignored by the regex.
      {
        ...shared,
        id: 1000,
        condition: cond('^https?://(www\\.)?youtube\\.com/watch\\?v=([a-zA-Z0-9_-]+)'),
        action: { type: 'redirect', ...sub('/watch?v=\\2') },
      },

      // 1001 — /shorts/VIDEO_ID
      {
        ...shared,
        id: 1001,
        condition: cond('^https?://(www\\.)?youtube\\.com/shorts/([a-zA-Z0-9_-]+)'),
        action: { type: 'redirect', ...sub('/watch?v=\\2') },
      },

      // 1002 — /results?search_query=QUERY
      {
        ...shared,
        id: 1002,
        condition: cond('^https?://(www\\.)?youtube\\.com/results\\?search_query=([^&#]*)'),
        action: { type: 'redirect', ...sub('/search?q=\\2') },
      },

      // 1003 — /playlist?list=LIST_ID
      {
        ...shared,
        id: 1003,
        condition: cond('^https?://(www\\.)?youtube\\.com/playlist\\?list=([^&#]*)'),
        action: { type: 'redirect', ...sub('/playlist?list=\\2') },
      },

      // 1004 — youtube.com/embed/VIDEO_ID  (also intercepts sub_frame for embedded players)
      {
        ...shared,
        id: 1004,
        condition: cond(
          '^https?://(www\\.)?youtube\\.com/embed/([a-zA-Z0-9_-]+)',
          ['main_frame', 'sub_frame']
        ),
        action: { type: 'redirect', ...sub('/embed/\\2') },
      },

      // 1009 — youtube-nocookie.com/embed/VIDEO_ID  (privacy-enhanced embeds)
      // Split from 1004 to avoid (?:-nocookie)? optional group inflating compiled DFA size.
      {
        ...shared,
        id: 1009,
        condition: cond(
          '^https?://(www\\.)?youtube-nocookie\\.com/embed/([a-zA-Z0-9_-]+)',
          ['main_frame', 'sub_frame']
        ),
        action: { type: 'redirect', ...sub('/embed/\\2') },
      },

      // 1005 — /channel/CHANNEL_ID
      {
        ...shared,
        id: 1005,
        condition: cond('^https?://(www\\.)?youtube\\.com/channel/([a-zA-Z0-9_-]+)'),
        action: { type: 'redirect', ...sub('/channel/\\2') },
      },

      // 1006 — /@HANDLE
      {
        ...shared,
        id: 1006,
        condition: cond('^https?://(www\\.)?youtube\\.com/@([^/?#&]+)'),
        action: { type: 'redirect', ...sub('/@\\2') },
      },

      // 1007 — /user/USERNAME  (legacy channel URLs)
      {
        ...shared,
        id: 1007,
        condition: cond('^https?://(www\\.)?youtube\\.com/user/([^/?#&]+)'),
        action: { type: 'redirect', ...sub('/user/\\2') },
      },

      // 1008 — youtu.be/VIDEO_ID  (short links — no "www" capture group here)
      {
        ...shared,
        id: 1008,
        condition: cond('^https?://youtu\\.be/([a-zA-Z0-9_-]+)'),
        action: { type: 'redirect', ...sub('/watch?v=\\1') },
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
