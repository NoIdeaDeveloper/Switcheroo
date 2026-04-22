/**
 * dnr.js
 * Manages Declarative Net Request (DNR) dynamic rules for all services.
 *
 * Architecture:
 *   - All rules are dynamic (not static rulesets) because the redirect URL
 *     depends on the currently selected instance, which changes at runtime.
 *   - Rules are rebuilt only when:
 *       • a service is toggled enabled/disabled
 *       • the currentInstance for a service changes (rotation or fixed selection)
 *   - Each service has a reserved ID range (ruleIdStart–ruleIdEnd).
 *     Rebuilding a service's rules removes all IDs in that range and replaces them.
 *
 * Privacy:
 *   - The extension ID is passed in but used only to build the
 *     excludedInitiatorDomains list — it is never logged.
 *   - Individual request URLs are NEVER seen by this module; DNR handles
 *     interception at the browser level.
 */

import { getAll, getById } from '../services/registry.js';
import { getSettings, getServiceSettings, getCachedInstances } from './storage.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns all currently registered dynamic rule IDs.
 * @returns {Promise<number[]>}
 */
async function getExistingRuleIds() {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return rules.map(r => r.id);
}

/**
 * Computes the set of instance hostnames that should be excluded from
 * redirect rules — i.e., all known instance hostnames across all services.
 * This prevents redirect loops when an Invidious page embeds a YouTube player.
 *
 * @returns {Promise<string[]>}
 */
async function computeExcludedDomains() {
  const services = getAll();
  const hostnames = new Set();

  for (const service of services) {
    const instances = await getCachedInstances(service.id);
    for (const inst of instances) {
      try {
        hostnames.add(new URL(inst.url).hostname);
      } catch {
        // skip malformed URLs
      }
    }
  }

  return Array.from(hostnames);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Rebuilds DNR rules for a single service based on its current settings.
 * Atomically removes old rules in the service's ID range and adds new ones.
 *
 * @param {import('../services/registry.js').ServiceDefinition} service
 * @param {string} extensionId
 * @param {import('../services/registry.js').ServiceSettings} serviceSettings
 */
export async function applyRulesForService(service, extensionId, serviceSettings) {
  const existingIds = await getExistingRuleIds();
  const removeRuleIds = existingIds.filter(
    id => id >= service.ruleIdStart && id <= service.ruleIdEnd
  );

  const excludedInitiatorDomains = await computeExcludedDomains();
  const addRules = service.buildRules(extensionId, serviceSettings, excludedInitiatorDomains);

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules, removeRuleIds });
  } catch (err) {
    console.error(`[Rooroute] Failed to update DNR rules for ${service.id}:`, err);
    throw err;
  }
}

/**
 * Rebuilds DNR rules for ALL services using current storage settings.
 * Called on startup and after instance rotation.
 *
 * @param {string} extensionId
 */
export async function rebuildAllRules(extensionId) {
  const services = getAll();
  const settings = await getSettings();
  const excludedInitiatorDomains = await computeExcludedDomains();

  const existingIds = await getExistingRuleIds();
  const removeRuleIds = [...existingIds];

  const addRules = [];
  for (const service of services) {
    const serviceSettings = settings[service.id];
    if (!serviceSettings) continue;
    const rules = service.buildRules(extensionId, serviceSettings, excludedInitiatorDomains);
    addRules.push(...rules);
  }

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules, removeRuleIds });
  } catch (err) {
    console.error('[Rooroute] Failed to rebuild all DNR rules:', err);
    throw err;
  }
}

/**
 * Rebuilds DNR rules for the Google Fonts service only.
 * All other services use content scripts for redirection.
 * Called on startup, install, and when Google Fonts settings change.
 *
 * @param {string} extensionId
 */
export async function rebuildGoogleFontsRules(extensionId) {
  const service = getById('googlefonts');
  if (!service) return;

  const serviceSettings = await getServiceSettings('googlefonts');
  if (!serviceSettings) return;

  const existingIds = await getExistingRuleIds();
  const removeRuleIds = existingIds.filter(
    id => id >= service.ruleIdStart && id <= service.ruleIdEnd
  );

  const excludedInitiatorDomains = await computeExcludedDomains();
  const addRules = service.buildRules(extensionId, serviceSettings, excludedInitiatorDomains);

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules, removeRuleIds });
  } catch (err) {
    console.error('[Rooroute] Failed to update Google Fonts DNR rules:', err);
  }
}

/**
 * Removes all DNR rules managed by Rooroute.
 * Used when the extension is disabled or during cleanup.
 *
 * @param {string} extensionId
 */
export async function removeAllRules(_extensionId) {
  const existingIds = await getExistingRuleIds();
  if (existingIds.length === 0) return;
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [],
    removeRuleIds: existingIds,
  });
}
