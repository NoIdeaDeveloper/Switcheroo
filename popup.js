/**
 * popup.js
 * Renders the extension popup. Communicates with the background service worker
 * via chrome.runtime.sendMessage.
 *
 * No network requests are made from this page (CSP: connect-src 'none').
 */

// ─── Messaging ────────────────────────────────────────────────────────────────

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (response?.error) return reject(new Error(response.error));
      resolve(response);
    });
  });
}

// ─── Service metadata (display only) ─────────────────────────────────────────

const SERVICE_META = {
  youtube: { label: 'YouTube', target: 'Invidious' },
  reddit:  { label: 'Reddit',  target: 'Redlib' },
};

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Builds a service card element.
 * @param {string} serviceId
 * @param {object} settings  - service-level settings from storage
 * @param {object[]} instances - cached instance list
 * @returns {HTMLElement}
 */
function buildCard(serviceId, settings, instances) {
  const meta = SERVICE_META[serviceId] ?? { label: serviceId, target: '?' };

  const card = document.createElement('div');
  card.className = `card${settings.enabled ? '' : ' disabled'}`;
  card.dataset.serviceId = serviceId;

  // ── Top row: name + toggle ─────────────────────────
  const top = document.createElement('div');
  top.className = 'card-top';

  const nameEl = document.createElement('div');
  nameEl.className = 'card-name';
  nameEl.innerHTML = `
    ${escapeHtml(meta.label)}
    <span class="card-name-arrow">→</span>
    <span class="card-name-target">${escapeHtml(meta.target)}</span>
  `;

  const toggle = buildToggle(serviceId, settings.enabled);
  top.append(nameEl, toggle);

  // ── Status row ─────────────────────────────────────
  const status = buildStatusRow(serviceId, settings, instances);

  card.append(top, status);
  return card;
}

/**
 * Builds a labelled toggle switch.
 */
function buildToggle(serviceId, checked) {
  const label = document.createElement('label');
  label.className = 'toggle';
  label.setAttribute('aria-label', `Enable ${SERVICE_META[serviceId]?.label ?? serviceId}`);

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.dataset.serviceId = serviceId;

  const track = document.createElement('span');
  track.className = 'toggle-track';

  const thumb = document.createElement('span');
  thumb.className = 'toggle-thumb';

  label.append(input, track, thumb);
  return label;
}

/**
 * Builds the status line below the service title.
 */
function buildStatusRow(serviceId, settings, instances) {
  const row = document.createElement('div');
  row.className = 'card-status';

  const textWrap = document.createElement('div');
  textWrap.className = 'card-status-text';

  const dot = document.createElement('span');
  dot.className = `status-dot${settings.enabled ? '' : ' off'}`;

  const label = document.createElement('span');
  label.className = 'status-label';

  if (!settings.enabled) {
    label.textContent = 'Disabled';
  } else if (settings.mode === 'fixed' && settings.currentInstance) {
    const host = hostOnly(settings.currentInstance);
    label.textContent = `Fixed: ${host}`;
    if (isCloudflareMaybe(settings.currentInstance, instances)) {
      const badge = document.createElement('span');
      badge.className = 'badge-cf';
      badge.textContent = 'CF';
      badge.title = 'This instance uses Cloudflare';
      textWrap.append(dot, label, badge);
    } else {
      textWrap.append(dot, label);
    }
  } else {
    const activeCount = countActive(instances, settings);
    label.textContent = `Random · ${activeCount} instance${activeCount !== 1 ? 's' : ''}`;
    textWrap.append(dot, label);
  }

  if (!textWrap.hasChildNodes()) textWrap.append(dot, label);

  // Settings link
  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'card-settings-link';
  settingsBtn.textContent = 'Settings';
  settingsBtn.dataset.serviceId = serviceId;

  row.append(textWrap, settingsBtn);
  return row;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hostOnly(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function countActive(instances, settings) {
  if (!instances?.length) return 0;
  let pool = settings.allowCloudflare ? instances : instances.filter(i => !i.cloudflare);
  if (settings.enabledInstances?.length > 0) {
    const enabled = new Set(settings.enabledInstances);
    pool = pool.filter(i => enabled.has(i.url));
  }
  return pool.length;
}

function isCloudflareMaybe(url, instances) {
  return instances?.some(i => i.url === url && i.cloudflare);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function init() {
  const container = document.getElementById('services');

  let settings, allInstances;
  try {
    [settings, allInstances] = await Promise.all([
      sendMessage({ action: 'getSettings' }),
      (async () => {
        const ids = Object.keys(SERVICE_META);
        const results = {};
        await Promise.all(ids.map(async id => {
          results[id] = await sendMessage({ action: 'getInstances', serviceId: id });
        }));
        return results;
      })(),
    ]);
  } catch (err) {
    container.innerHTML = `<div class="loading">Error loading settings.</div>`;
    console.error(err);
    return;
  }

  container.innerHTML = '';

  const serviceIds = Object.keys(SERVICE_META);
  for (const id of serviceIds) {
    const svcSettings = settings[id];
    const instances = allInstances[id] ?? [];
    if (!svcSettings) continue;
    const card = buildCard(id, svcSettings, instances);
    container.append(card);
  }

  attachListeners(settings, allInstances);
}

function attachListeners(settings, allInstances) {
  // Toggle switches
  document.querySelectorAll('.toggle input').forEach(input => {
    input.addEventListener('change', async () => {
      const id = input.dataset.serviceId;
      const enabled = input.checked;

      // Optimistic UI
      const card = document.querySelector(`.card[data-service-id="${id}"]`);
      if (card) card.classList.toggle('disabled', !enabled);

      try {
        await sendMessage({ action: 'setServiceSettings', serviceId: id, settings: { enabled } });
        // Re-render card with fresh settings
        const freshSettings = await sendMessage({ action: 'getSettings' });
        rerenderCard(id, freshSettings[id], allInstances[id] ?? []);
      } catch (err) {
        console.error(err);
        input.checked = !enabled; // revert on error
      }
    });
  });

  // Per-card settings links
  document.querySelectorAll('.card-settings-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.serviceId;
      chrome.runtime.openOptionsPage();
      // options page will receive a hash to scroll to the right section
      // but openOptionsPage doesn't support hash, so we store intent
      chrome.storage.local.set({ optionsScrollTo: id });
    });
  });

  // Footer: refresh
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    const icon = btn.querySelector('svg');
    btn.disabled = true;
    icon?.classList.add('spinning');

    try {
      await sendMessage({ action: 'refreshAllInstances' });
      await init(); // full re-render
    } catch (err) {
      console.error(err);
    } finally {
      btn.disabled = false;
      icon?.classList.remove('spinning');
    }
  });

  // Footer: open settings
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

function rerenderCard(serviceId, newSettings, instances) {
  const old = document.querySelector(`.card[data-service-id="${serviceId}"]`);
  if (!old) return;
  const fresh = buildCard(serviceId, newSettings, instances);
  old.replaceWith(fresh);
  // Re-attach listeners for just this card
  fresh.querySelector('.toggle input')?.addEventListener('change', async (e) => {
    const id = e.target.dataset.serviceId;
    const enabled = e.target.checked;
    const card = document.querySelector(`.card[data-service-id="${id}"]`);
    if (card) card.classList.toggle('disabled', !enabled);
    try {
      await sendMessage({ action: 'setServiceSettings', serviceId: id, settings: { enabled } });
      const freshSettings = await sendMessage({ action: 'getSettings' });
      rerenderCard(id, freshSettings[id], instances);
    } catch { e.target.checked = !enabled; }
  });
  fresh.querySelector('.card-settings-link')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    chrome.storage.local.set({ optionsScrollTo: serviceId });
  });
}

init();
