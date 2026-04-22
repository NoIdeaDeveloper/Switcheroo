/**
 * instances.js
 * Fetches, caches, and selects redirect instances for each service.
 *
 * Privacy note: Fetches are made only from the background service worker
 * (never from popup or options pages). The two fetched URLs are:
 *   - https://api.invidious.io/instances.json
 *   - https://raw.githubusercontent.com/redlib-org/redlib-instances/…/instances.json
 * These requests reveal that the user has the extension installed, but contain
 * no user-identifiable browsing data. This is disclosed in the options page.
 * A fourth fetch goes to git.sr.ht for the Scribe (Medium) instance list.
 */

import { sanitizeInstanceList } from './validate.js';
import { getInstanceCache, setInstanceCache, isCacheStale } from './storage.js';

// ─── Fetching ─────────────────────────────────────────────────────────────────

/**
 * Fetches fresh instance data from the service's API endpoint,
 * parses and validates it, then stores it in the cache.
 * Returns the validated instance array, or null on error.
 *
 * @param {import('../services/registry.js').ServiceDefinition} service
 * @returns {Promise<import('../services/registry.js').Instance[]|null>}
 */
export async function fetchInstances(service) {
  // Static-redirect services (e.g. Google Fonts) have no live API to poll.
  if (!service.instanceFetcher.url) return null;

  try {
    const fetchOpts = service.instanceFetcher.fetchOptions ?? {};
    const response = await fetch(service.instanceFetcher.url, fetchOpts);
    if (!response.ok) {
      console.warn(`[Rooroute] Failed to fetch instances for ${service.id}: HTTP ${response.status}`);
      return null;
    }

    const raw = service.instanceFetcher.responseType === 'text'
      ? await response.text()
      : await response.json();
    const parsed = service.instanceFetcher.parse(raw);
    const validated = sanitizeInstanceList(parsed, service.sourceHosts);

    if (validated.length === 0) {
      console.warn(`[Rooroute] No valid instances returned for ${service.id}`);
      return null;
    }

    await setInstanceCache(service.id, validated);
    return validated;

  } catch (err) {
    console.warn(`[Rooroute] Error fetching instances for ${service.id}:`, err);
    return null;
  }
}

/**
 * Returns cached instances if fresh, otherwise fetches and caches new ones.
 * Falls back to bundled JSON if the fetch fails.
 *
 * @param {import('../services/registry.js').ServiceDefinition} service
 * @returns {Promise<import('../services/registry.js').Instance[]>}
 */
export async function getCachedOrFetchInstances(service) {
  const stale = await isCacheStale(service.id, service.instanceFetcher.cacheTTLMs);

  if (!stale) {
    const cached = await getInstanceCache(service.id);
    if (cached?.data?.length > 0) return cached.data;
  }

  const fetched = await fetchInstances(service);
  if (fetched !== null) return fetched;

  // Network failed — fall back to bundled JSON.
  // Cache the fallback data so rotateInstance can find it.
  const fallback = await loadFallback(service);
  if (fallback.length > 0) {
    await setInstanceCache(service.id, fallback);
  }
  return fallback;
}

/**
 * Loads and validates the bundled fallback instance list for a service.
 * @param {import('../services/registry.js').ServiceDefinition} service
 * @returns {Promise<import('../services/registry.js').Instance[]>}
 */
export async function loadFallback(service) {
  try {
    const url = chrome.runtime.getURL(service.instanceFetcher.fallbackFile);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    // Fallback files must be a top-level Instance[] array (url, cloudflare, collectsData fields).
    // If the file is accidentally in raw API format (object or wrong fields) this will return []
    // and trigger a console.error below — intentional so mismatches are caught early.
    if (!Array.isArray(raw)) throw new Error(`Fallback for ${service.id} is not an array`);
    return sanitizeInstanceList(raw, service.sourceHosts);
  } catch (err) {
    console.error(`[Rooroute] Failed to load fallback for ${service.id}:`, err);
    return [];
  }
}

// ─── Selection ────────────────────────────────────────────────────────────────

/**
 * Returns the subset of instances the user has enabled.
 * If enabledInstances is empty, all instances are returned (opt-out model).
 * Cloudflare instances are excluded unless allowCloudflare is true.
 *
 * @param {import('../services/registry.js').Instance[]} allInstances
 * @param {import('../services/registry.js').ServiceSettings} settings
 * @returns {import('../services/registry.js').Instance[]}
 */
export function getActiveInstances(allInstances, settings) {
  let pool = allInstances;

  // Filter out privacy-reduced instances (Cloudflare-proxied or operator-declared
  // data collection) unless the user has explicitly opted in.
  if (!settings.allowCloudflare) {
    pool = pool.filter(inst => !inst.cloudflare && !inst.collectsData);
  }

  // Filter by user's enabled-instance list (opt-out: empty = all)
  if ((settings.enabledInstances ?? []).length > 0) {
    const enabled = new Set(settings.enabledInstances);
    pool = pool.filter(inst => enabled.has(inst.url));
  }

  return pool;
}

/**
 * Picks a random instance from the active pool.
 * Returns null if the pool is empty.
 *
 * @param {import('../services/registry.js').Instance[]} instances
 * @returns {import('../services/registry.js').Instance|null}
 */
export function pickRandom(instances) {
  if (instances.length === 0) return null;
  return instances[Math.floor(Math.random() * instances.length)];
}

/**
 * Determines which instance should be used for a service right now,
 * based on its mode and settings.
 *
 * - fixed mode: uses fixedInstance (falls back to random if unset)
 * - random mode: picks randomly from the active pool
 *
 * Returns the instance URL string, or null if none available.
 *
 * @param {import('../services/registry.js').ServiceDefinition} service
 * @param {import('../services/registry.js').ServiceSettings} settings
 * @param {import('../services/registry.js').Instance[]} allInstances
 * @returns {string|null}
 */
export function resolveCurrentInstance(service, settings, allInstances) {
  if (settings.mode === 'fixed' && settings.fixedInstance) {
    return settings.fixedInstance;
  }

  const active = getActiveInstances(allInstances, settings);
  const picked = pickRandom(active);
  return picked?.url ?? null;
}
