/**
 * registry.js
 * Central service registry. To add a new service (e.g., Nitter, SearXNG):
 *   1. Create services/myservice.js implementing the ServiceDefinition shape
 *   2. Import it below and add it to the SERVICES array
 *   3. Nothing else needs to change
 *
 * @typedef {object} Instance
 * @property {string}   url        - HTTPS base URL, no trailing slash
 * @property {string}   [country]  - ISO 2-letter country code
 * @property {number}   [uptime]   - 0–100 uptime percentage
 * @property {boolean}  [cloudflare]   - true if behind Cloudflare
 * @property {boolean}  [collectsData] - true if the operator has indicated they log user data
 * @property {Record<string,string>} [meta] - additional display metadata (version, provider, etc.)
 *
 * @typedef {object} ServiceSettings
 * @property {boolean}  enabled
 * @property {'random'|'fixed'} mode
 * @property {string|null} fixedInstance  - URL of the user-selected instance
 * @property {string}   currentInstance   - URL of the actively used instance
 * @property {string[]} enabledInstances  - empty = all enabled (opt-out model)
 * @property {boolean}  allowCloudflare
 *
 * @typedef {object} ServiceDefinition
 * @property {string}   id
 * @property {string}   name
 * @property {string}   description
 * @property {string[]} sourceHosts  - hostnames that trigger redirects
 * @property {number}   ruleIdStart  - inclusive start of reserved DNR rule ID range
 * @property {number}   ruleIdEnd    - inclusive end of reserved DNR rule ID range
 * @property {{url: string, cacheTTLMs: number, parse: function, fallbackFile: string}} instanceFetcher
 * @property {function(string, ServiceSettings): import('chrome').declarativeNetRequest.Rule[]} buildRules
 * @property {function(): ServiceSettings} defaultSettings
 */

import { youtubeService } from './youtube.js';
import { redditService } from './reddit.js';
import { googleFontsService } from './googlefonts.js';
import { imgurService } from './imgur.js';
import { tiktokService } from './tiktok.js';
import { scribeService } from './scribe.js';

const SERVICES = [
  youtubeService,
  redditService,
  googleFontsService,
  imgurService,
  tiktokService,
  scribeService,
];

/**
 * Returns all registered service definitions.
 * @returns {ServiceDefinition[]}
 */
export function getAll() {
  return SERVICES;
}

/**
 * Returns a service definition by ID, or undefined if not found.
 * @param {string} id
 * @returns {ServiceDefinition|undefined}
 */
export function getById(id) {
  return SERVICES.find(s => s.id === id);
}

/**
 * Returns the initial settings object for all services.
 * Suitable for use as the default storage value on first install.
 * @returns {object}
 */
export function getDefaultSettings() {
  return Object.fromEntries(SERVICES.map(s => [s.id, s.defaultSettings()]));
}
