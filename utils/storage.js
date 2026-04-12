/**
 * storage.js
 * Thin, promise-based wrapper around chrome.storage.local.
 *
 * Privacy: chrome.storage.local is used exclusively (not sync).
 * sync uploads data to Google's servers and has tight quota limits.
 */

const SETTINGS_KEY = 'settings';
const INSTANCE_CACHE_KEY = 'instanceCache';
const GLOBAL_SETTINGS_KEY = 'globalSettings';

const GLOBAL_DEFAULTS = {
  // How often to automatically fetch updated instance lists.
  // null = Off (never fetch automatically; user must refresh manually).
  instanceRefreshIntervalMs: 3_600_000, // 1 hour
};

// ─── Settings ────────────────────────────────────────────────────────────────

/**
 * Returns the full settings object from storage.
 * @returns {Promise<object>}
 */
export async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return result[SETTINGS_KEY] ?? {};
}

/**
 * Returns settings for a single service.
 * @param {string} serviceId
 * @returns {Promise<object>}
 */
export async function getServiceSettings(serviceId) {
  const settings = await getSettings();
  return settings[serviceId] ?? {};
}

/**
 * Overwrites settings for a single service, merging with existing values.
 * @param {string} serviceId
 * @param {object} patch
 */
export async function setServiceSettings(serviceId, patch) {
  const settings = await getSettings();
  settings[serviceId] = { ...(settings[serviceId] ?? {}), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

/**
 * Overwrites the entire settings object.
 * @param {object} settings
 */
export async function setSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

/**
 * Initialises default settings for all services without overwriting
 * existing values. Safe to call on every install/update.
 * @param {import('../services/registry.js').ServiceDefinition[]} services
 */
export async function initializeDefaults(services) {
  const existing = await getSettings();
  const merged = { ...existing };

  for (const service of services) {
    if (!merged[service.id]) {
      merged[service.id] = service.defaultSettings();
    }
  }

  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
}

// ─── Global settings ─────────────────────────────────────────────────────────

/**
 * Returns the global (cross-service) settings, merged with defaults.
 * @returns {Promise<{instanceRefreshIntervalMs: number|null}>}
 */
export async function getGlobalSettings() {
  const result = await chrome.storage.local.get(GLOBAL_SETTINGS_KEY);
  return { ...GLOBAL_DEFAULTS, ...(result[GLOBAL_SETTINGS_KEY] ?? {}) };
}

/**
 * Merges a patch into the global settings.
 * @param {object} patch
 */
export async function setGlobalSettings(patch) {
  const current = await getGlobalSettings();
  await chrome.storage.local.set({ [GLOBAL_SETTINGS_KEY]: { ...current, ...patch } });
}

/**
 * Writes global defaults to storage without overwriting existing values.
 * Safe to call on every install/update.
 */
export async function initializeGlobalDefaults() {
  const result = await chrome.storage.local.get(GLOBAL_SETTINGS_KEY);
  if (!result[GLOBAL_SETTINGS_KEY]) {
    await chrome.storage.local.set({ [GLOBAL_SETTINGS_KEY]: GLOBAL_DEFAULTS });
  }
}

// ─── Instance cache ───────────────────────────────────────────────────────────

/**
 * Returns the cached instance list for a service, or null if not cached.
 * @param {string} serviceId
 * @returns {Promise<{data: object[], fetchedAt: number}|null>}
 */
export async function getInstanceCache(serviceId) {
  const result = await chrome.storage.local.get(INSTANCE_CACHE_KEY);
  const cache = result[INSTANCE_CACHE_KEY] ?? {};
  return cache[serviceId] ?? null;
}

/**
 * Stores a validated instance list for a service with the current timestamp.
 * @param {string} serviceId
 * @param {object[]} instances
 */
export async function setInstanceCache(serviceId, instances) {
  const result = await chrome.storage.local.get(INSTANCE_CACHE_KEY);
  const cache = result[INSTANCE_CACHE_KEY] ?? {};
  cache[serviceId] = { data: instances, fetchedAt: Date.now() };
  await chrome.storage.local.set({ [INSTANCE_CACHE_KEY]: cache });
}

/**
 * Returns the cached instance data array for a service, or an empty array.
 * @param {string} serviceId
 * @returns {Promise<object[]>}
 */
export async function getCachedInstances(serviceId) {
  const cache = await getInstanceCache(serviceId);
  return cache?.data ?? [];
}

/**
 * Returns true if the cache for a service is older than the given TTL.
 * @param {string} serviceId
 * @param {number} ttlMs
 * @returns {Promise<boolean>}
 */
export async function isCacheStale(serviceId, ttlMs) {
  const cache = await getInstanceCache(serviceId);
  if (!cache) return true;
  return Date.now() - cache.fetchedAt > ttlMs;
}
