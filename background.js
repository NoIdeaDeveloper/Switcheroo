/**
 * background.js — Switcheroo service worker
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
  getSettings,
  getServiceSettings,
  setServiceSettings,
  getCachedInstances,
  isCacheStale,
} from './utils/storage.js';
import {
  getCachedOrFetchInstances,
  fetchInstances,
  loadFallback,
  resolveCurrentInstance,
} from './utils/instances.js';
import { rebuildAllRules, applyRulesForService } from './utils/dnr.js';

const ALARM_NAME = 'instanceRefresh';
const ALARM_PERIOD_MINUTES = 60;

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

  if (chosen !== settings.currentInstance) {
    await setServiceSettings(service.id, { currentInstance: chosen });
  }

  return chosen;
}

/**
 * Rotates instances for all services in random mode, then rebuilds DNR rules.
 * @param {string} extensionId
 */
async function rotateAllInstances(extensionId) {
  const services = getAll();
  await Promise.all(services.map(s => rotateInstance(s)));
  await rebuildAllRules(extensionId);
}

// ─── Startup & install ────────────────────────────────────────────────────────

/**
 * Registers the periodic refresh alarm (idempotent).
 */
function registerAlarm() {
  chrome.alarms.get(ALARM_NAME, alarm => {
    if (!alarm) {
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

  // Fetch instances for all services in parallel
  await Promise.all(services.map(async service => {
    let instances = await getCachedOrFetchInstances(service);
    if (!instances.length) instances = await loadFallback(service);
    // setInstanceCache is called inside getCachedOrFetchInstances already
  }));

  await rotateAllInstances(extensionId);
  registerAlarm();
}

/**
 * Light startup: rebuild rules from cache immediately, refresh stale caches.
 * @param {string} extensionId
 */
async function lightStartup(extensionId) {
  // Rebuild immediately from whatever's in the cache
  await rotateAllInstances(extensionId);
  registerAlarm();

  // Then asynchronously refresh any stale caches
  const services = getAll();
  for (const service of services) {
    const stale = await isCacheStale(service.id, service.instanceFetcher.cacheTTLMs);
    if (stale) {
      fetchInstances(service).catch(() => {}); // fire-and-forget; alarm will retry
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

  // Fetch fresh instance data for all services
  await Promise.all(services.map(service => fetchInstances(service).catch(() => {})));

  // Rotate instances and rebuild rules
  await rotateAllInstances(extensionId);
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

    // If currentInstance changed as a result of our own write, skip rebuilding
    // (rebuildAllRules was already called by rotateInstance flow)
    const sameEverythingButCurrent =
      oldSvc && newSvc &&
      oldSvc.enabled === newSvc.enabled &&
      oldSvc.mode === newSvc.mode &&
      oldSvc.fixedInstance === newSvc.fixedInstance &&
      JSON.stringify(oldSvc.enabledInstances) === JSON.stringify(newSvc.enabledInstances) &&
      oldSvc.allowCloudflare === newSvc.allowCloudflare;

    if (sameEverythingButCurrent) continue;

    // Something user-visible changed — rebuild rules for this service
    await applyRulesForService(service, extensionId, newSvc);
  }
});

// ─── Message handling ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Validate sender: only accept messages from within this extension
  if (sender.id !== chrome.runtime.id) return false;

  handleMessage(message).then(sendResponse).catch(err => {
    console.error('[Switcheroo] Message handler error:', err);
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

    case 'setServiceSettings': {
      const { serviceId, settings } = message;
      const service = getById(serviceId);
      if (!service) throw new Error(`Unknown service: ${serviceId}`);

      await setServiceSettings(serviceId, settings);

      // If the user changed mode or fixedInstance, resolve a new currentInstance
      const updated = await getServiceSettings(serviceId);
      if (updated.mode === 'fixed' && updated.fixedInstance) {
        await setServiceSettings(serviceId, { currentInstance: updated.fixedInstance });
      } else if (updated.mode === 'random') {
        await rotateInstance(service);
      }

      await applyRulesForService(service, extensionId, await getServiceSettings(serviceId));
      return { ok: true };
    }

    case 'refreshInstances': {
      const { serviceId } = message;
      const service = getById(serviceId);
      if (!service) throw new Error(`Unknown service: ${serviceId}`);

      const instances = await fetchInstances(service);
      if (instances) await rotateInstance(service);
      await applyRulesForService(service, extensionId, await getServiceSettings(serviceId));
      return { ok: true, count: instances?.length ?? 0 };
    }

    case 'refreshAllInstances': {
      const services = getAll();
      await Promise.all(services.map(s => fetchInstances(s).catch(() => {})));
      await rotateAllInstances(extensionId);
      return { ok: true };
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
