/**
 * dnr.js
 * Manages Declarative Net Request (DNR) dynamic rules for the Google Fonts
 * service — the only service still using DNR. All navigation services
 * (YouTube, Reddit, Imgur, TikTok, Medium) redirect via the content script
 * (content/redirect.js) and do not use this module.
 *
 * Architecture:
 *   - The rule is dynamic (not a static ruleset) so its excludedInitiatorDomains
 *     can be recomputed from the current instance caches at runtime.
 *   - It is rebuilt only when:
 *       • Google Fonts is toggled enabled/disabled
 *       • a fresh instance fetch may have changed the excluded-domains set
 *   - Google Fonts owns the reserved ID range 3000–3999; rebuilding removes all
 *     IDs in that range and replaces them.
 *
 * Privacy:
 *   - The extension ID is passed in but used only to build the
 *     excludedInitiatorDomains list — it is never logged.
 *   - Individual request URLs are NEVER seen by this module; DNR handles
 *     interception at the browser level.
 */

import { getById } from '../services/registry.js';
import { getServiceSettings, getAllCachedInstances } from './storage.js';

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
  const allInstances = await getAllCachedInstances();
  const hostnames = new Set();

  for (const instances of allInstances.values()) {
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
  await applyRulesForService(service, extensionId, serviceSettings);
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
