/**
 * background.js — Rooroute service worker
 *
 * Responsibilities:
 *   1. On install: initialise storage defaults, fetch instances, build DNR rules
 *   2. On startup: rebuild DNR rules immediately (from cache), then refresh if stale
 *   3. On alarm:   rotate instances (random mode), rebuild rules
 *   4. On storage change: rebuild rules for the affected service
 *   5. Handle messages from popup and options page
 *
 * Privacy guarantee:
 *   - This module NEVER logs, stores, or processes the URLs of individual
 *     YouTube/Reddit requests. DNR handles interception at the browser level
 *     without exposing request URLs to extension code.
 *   - Fetch calls are limited to the two instance-list endpoints declared in
 *     host_permissions. No other outbound requests are made.
 */

import { getAll, getById } from './services/registry.js';
import {
  initializeDefaults,
  initializeGlobalDefaults,
  getSettings,
  getServiceSettings,
  setServiceSettings,
  getCachedInstances,
  getInstanceCache,
  setInstanceCache,
  isCacheStale,
  getGlobalSettings,
  setGlobalSettings,
} from './utils/storage.js';
import {
  getCachedOrFetchInstances,
  fetchInstances,
  loadFallback,
  resolveCurrentInstance,
} from './utils/instances.js';
import { rebuildGoogleFontsRules, applyRulesForService, removeAllRules } from './utils/dnr.js';

const ALARM_NAME = 'instanceRefresh';
// 1-minute tick so sub-hour rotation intervals fire accurately.
// Instance list fetches are gated by cache staleness, so the upstream APIs
// are still only contacted at most once per hour regardless of alarm frequency.
const ALARM_PERIOD_MINUTES = 1;

// ─── Instance rotation ────────────────────────────────────────────────────────

/**
 * Picks a new currentInstance for a service based on its mode and available
 * instances, then persists it. Returns the chosen instance URL or null.
 *
 * @param {import('./services/registry.js').ServiceDefinition} service
 * @returns {Promise<string|null>}
 */
async function rotateInstance(service) {
  const settings = await getServiceSettings(service.id);
  const instances = await getCachedInstances(service.id);

  const chosen = resolveCurrentInstance(service, settings, instances);

  // Always record the rotation attempt time so the interval logic stays accurate.
  const patch = { lastRotatedAt: Date.now() };
  if (chosen !== settings.currentInstance) patch.currentInstance = chosen;
  await setServiceSettings(service.id, patch);

  return chosen;
}

/**
 * Rotates instances for all services in random mode, then rebuilds DNR rules.
 * @param {string} extensionId
 */
async function rotateAllInstances(extensionId) {
  const services = getAll();
  await Promise.all(services.map(s => rotateInstance(s)));
  await rebuildGoogleFontsRules(extensionId);
}

// ─── Startup & install ────────────────────────────────────────────────────────

/**
 * Registers the periodic refresh alarm (idempotent).
 */
function registerAlarm() {
  chrome.alarms.get(ALARM_NAME, alarm => {
    // Recreate the alarm if it doesn't exist or has a different period.
    // This ensures a period change (e.g. after an extension update) takes effect.
    if (!alarm || alarm.periodInMinutes !== ALARM_PERIOD_MINUTES) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
    }
  });
}

/**
 * Full initialisation: fetch instances, rotate, build rules.
 * Called on first install.
 * @param {string} extensionId
 */
async function fullInit(extensionId) {
  const services = getAll();
  await initializeDefaults(services);
  await initializeGlobalDefaults();

  // Fetch (or load fallback) for all services in parallel.
  // getCachedOrFetchInstances handles the fallback path and caches the result.
  await Promise.all(services.map(service => getCachedOrFetchInstances(service)));

  await rotateAllInstances(extensionId);
  registerAlarm();
}

/**
 * Light startup: rebuild rules from cache immediately, refresh stale caches.
 * @param {string} extensionId
 */
async function lightStartup(extensionId) {
  const services = getAll();

  // Seed any empty caches from bundled fallback data before rotating.
  // This handles newly-added services that have never been fetched — without
  // making any network calls. Once seeded, the stale-cache logic below takes over.
  await Promise.all(services.map(async service => {
    const cached = await getCachedInstances(service.id);
    if (cached.length === 0) {
      const fallback = await loadFallback(service);
      if (fallback.length > 0) await setInstanceCache(service.id, fallback);
    }
  }));

  // Rebuild immediately from whatever's in the cache
  await rotateAllInstances(extensionId);
  registerAlarm();

  // Then asynchronously refresh any stale caches — unless auto-refresh is Off
  const { instanceRefreshIntervalMs } = await getGlobalSettings();
  if (instanceRefreshIntervalMs === null) return;

  for (const service of services) {
    if (!service.instanceFetcher.url) continue;
    const stale = await isCacheStale(service.id, instanceRefreshIntervalMs);
    if (stale) {
      fetchInstances(service).catch(err => console.debug('[Rooroute] fire-and-forget fetch failed:', err)); // alarm will retry
    }
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const extensionId = chrome.runtime.id;

  if (reason === 'install') {
    await fullInit(extensionId);

  } else if (reason === 'update') {
    // Merge any new service defaults without overwriting existing settings
    const services = getAll();
    await initializeDefaults(services);
    // Clear any stale DNR rules from previous versions (which used DNR for all services).
    // rebuildGoogleFontsRules called inside lightStartup will re-add the only rule we still need.
    await removeAllRules(extensionId);
    await lightStartup(extensionId);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await lightStartup(chrome.runtime.id);
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM_NAME) return;

  const services = getAll();
  const extensionId = chrome.runtime.id;
  const now = Date.now();

  // Fetch fresh instance data only when auto-refresh is enabled and the cache is stale.
  const { instanceRefreshIntervalMs } = await getGlobalSettings();
  if (instanceRefreshIntervalMs !== null) {
    await Promise.all(
      services
        .filter(s => s.instanceFetcher.url)
        .map(async service => {
          const stale = await isCacheStale(service.id, instanceRefreshIntervalMs);
          if (stale) await fetchInstances(service).catch(err => console.debug('[Rooroute] stale-cache refresh failed:', err));
        })
    );
  }

  // Rotate only random-mode services whose configured interval has elapsed.
  // Services set to 'startup only' (rotationIntervalMs === 0) are skipped here
  // but are still rotated by lightStartup on browser start.
  for (const service of services) {
    const settings = await getServiceSettings(service.id);
    if (settings.mode !== 'random') continue;
    const intervalMs = settings.rotationIntervalMs ?? 3_600_000;
    if (intervalMs === 0) continue;
    if (now - (settings.lastRotatedAt ?? 0) >= intervalMs) {
      await rotateInstance(service);
    }
  }

  // Rebuild Google Fonts DNR rule — the only service still using DNR.
  await rebuildGoogleFontsRules(extensionId);
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (!changes.settings) return;

  const extensionId = chrome.runtime.id;
  const oldSettings = changes.settings.oldValue ?? {};
  const newSettings = changes.settings.newValue ?? {};

  // Find which services changed
  const services = getAll();
  for (const service of services) {
    const oldSvc = oldSettings[service.id];
    const newSvc = newSettings[service.id];

    if (JSON.stringify(oldSvc) === JSON.stringify(newSvc)) continue;

    // Only Google Fonts uses DNR — skip all other services.
    if (service.id !== 'googlefonts') continue;

    // Guard: if the service's settings were removed entirely, skip.
    if (!newSvc) continue;

    // Something user-visible changed — rebuild Google Fonts DNR rule.
    await applyRulesForService(service, extensionId, newSvc);
  }
});

// ─── Message handling ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Validate sender: only accept messages from within this extension
  if (sender.id !== chrome.runtime.id) return false;

  handleMessage(message).then(sendResponse).catch(err => {
    console.error('[Rooroute] Message handler error:', err);
    sendResponse({ error: err.message });
  });

  return true; // keep message channel open for async response
});

/**
 * @param {{action: string, [key: string]: any}} message
 * @returns {Promise<any>}
 */
async function handleMessage(message) {
  const extensionId = chrome.runtime.id;

  switch (message.action) {
    case 'getSettings':
      return getSettings();

    case 'getGlobalSettings':
      return getGlobalSettings();

    case 'setGlobalSettings': {
      await setGlobalSettings(message.settings);
      return { ok: true };
    }

    case 'setServiceSettings': {
      const { serviceId, settings } = message;
      const service = getById(serviceId);
      if (!service) throw new Error(`Unknown service: ${serviceId}`);

      // Merge the patch with the current settings first, then resolve the new
      // currentInstance — all in one atomic write so storage.onChanged fires
      // exactly once with the final, consistent state.
      // Parallelise the two independent storage reads.
      const [current, instances] = await Promise.all([
        getServiceSettings(serviceId),
        getCachedInstances(serviceId),
      ]);
      const merged = { ...current, ...settings };

      // Only re-resolve the active instance when settings that affect which
      // instance is used have actually changed. Changing rotationIntervalMs,
      // lastRotatedAt, etc. must not silently re-pick a random instance.
      const instanceSelectionChanged =
        'mode' in settings ||
        'fixedInstance' in settings ||
        'enabledInstances' in settings ||
        'allowCloudflare' in settings;

      if (merged.mode === 'fixed' && merged.fixedInstance) {
        merged.currentInstance = merged.fixedInstance;
      } else if (merged.mode === 'random' && instanceSelectionChanged) {
        merged.currentInstance = resolveCurrentInstance(service, merged, instances);
      }

      await setServiceSettings(serviceId, merged);
      // Only Google Fonts uses DNR; content scripts handle all other services.
      if (service.id === 'googlefonts') {
        await applyRulesForService(service, extensionId, merged);
      }
      return { ok: true };
    }

    case 'refreshInstances': {
      const { serviceId } = message;
      const service = getById(serviceId);
      if (!service) throw new Error(`Unknown service: ${serviceId}`);

      const instances = await fetchInstances(service);
      if (instances) await rotateInstance(service);
      if (service.id === 'googlefonts') {
        await applyRulesForService(service, extensionId, await getServiceSettings(serviceId));
      }
      return { ok: true, count: instances?.length ?? 0 };
    }

    case 'refreshAllInstances': {
      const services = getAll();
      await Promise.all(services.map(s => fetchInstances(s).catch(() => {})));
      await rotateAllInstances(extensionId);
      return { ok: true };
    }

    case 'getCacheInfo': {
      const { serviceId } = message;
      const cache = await getInstanceCache(serviceId);
      return { fetchedAt: cache?.fetchedAt ?? null, count: cache?.data?.length ?? 0 };
    }

    case 'getInstances': {
      const { serviceId } = message;
      const service = getById(serviceId);
      if (!service) return [];

      // If the cache is empty (e.g. popup opened before fullInit completed),
      // trigger a fetch now and wait for it rather than returning an empty list.
      let instances = await getCachedInstances(serviceId);
      if (instances.length === 0) {
        instances = await getCachedOrFetchInstances(service);
      }
      return instances;
    }

    default:
      throw new Error(`Unknown action: ${message.action}`);
  }
}
