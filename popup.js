/**
 * popup.js — Switcheroo toolbar popup
 * No network requests. All data flows through sendMessage → background.
 */

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (response?.error) return reject(new Error(response.error));
      resolve(response);
    });
  });
}

const SERVICE_META = {
  youtube:     { label: 'YouTube',      target: 'Invidious',  accentColor: '#FFBA93' },
  reddit:      { label: 'Reddit',       target: 'Redlib',     accentColor: '#98D4B4' },
  googlefonts: { label: 'Google Fonts', target: 'Bunny Fonts', accentColor: '#C9B8F0', staticRedirect: true },
  imgur:       { label: 'Imgur',        target: 'Rimgo',      accentColor: '#8EC0E8' },
};

// ─── Card rendering ───────────────────────────────────────────────────────────

function buildCard(serviceId, settings, instances) {
  const meta = SERVICE_META[serviceId] ?? { label: serviceId, target: '?', accentColor: '#FFBA93' };

  const card = document.createElement('div');
  card.className = `card${settings.enabled ? '' : ' disabled'}`;
  card.dataset.serviceId = serviceId;

  const inner = document.createElement('div');
  inner.className = 'card-inner';

  // Coloured left accent stripe
  const accent = document.createElement('div');
  accent.className = 'card-accent';
  accent.style.background = settings.enabled ? meta.accentColor : '#E8D8CE';
  inner.append(accent);

  // Top row: label + toggle
  const top = document.createElement('div');
  top.className = 'card-top';

  const label = document.createElement('div');
  label.className = 'card-label';
  label.innerHTML =
    `${escHtml(meta.label)}&nbsp;<span class="card-label-arrow">→</span>&nbsp;<span class="card-label-target">${escHtml(meta.target)}</span>`;

  const toggle = buildToggle(serviceId, settings.enabled);
  top.append(label, toggle);

  // Status row
  const statusRow = buildStatusRow(serviceId, settings, instances);

  inner.append(top, statusRow);
  card.append(inner);
  return card;
}

function buildToggle(serviceId, checked) {
  const lbl = document.createElement('label');
  lbl.className = 'toggle';
  lbl.setAttribute('aria-label', `Enable ${SERVICE_META[serviceId]?.label ?? serviceId} redirect`);

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.dataset.serviceId = serviceId;

  const track = document.createElement('span');
  track.className = 'toggle-track';

  const thumb = document.createElement('span');
  thumb.className = 'toggle-thumb';

  lbl.append(input, track, thumb);
  return lbl;
}

function buildStatusRow(serviceId, settings, instances) {
  const row = document.createElement('div');
  row.className = 'card-status';

  const left = document.createElement('div');
  left.className = 'status-left';

  const dot = document.createElement('span');
  dot.className = `status-dot${settings.enabled ? '' : ' off'}`;

  const text = document.createElement('span');
  text.className = 'status-text';

  const meta = SERVICE_META[serviceId] ?? {};

  if (!settings.enabled) {
    text.textContent = 'Disabled';
    left.append(dot, text);
  } else if (meta.staticRedirect) {
    // Static-redirect services always use a single fixed target — show it directly.
    const host = hostOnly(settings.currentInstance ?? meta.target);
    text.innerHTML = `→ <strong>${escHtml(host)}</strong>`;
    left.append(dot, text);
  } else if (settings.mode === 'fixed' && settings.currentInstance) {
    const host = hostOnly(settings.currentInstance);
    text.innerHTML = `Fixed: <strong>${escHtml(host)}</strong>`;
    const cfMatch = instances?.find(i => i.url === settings.currentInstance && i.cloudflare);
    if (cfMatch) {
      const badge = document.createElement('span');
      badge.className = 'badge-cf';
      badge.textContent = 'CF';
      badge.title = 'This instance is behind Cloudflare';
      left.append(dot, text, badge);
    } else {
      left.append(dot, text);
    }
  } else {
    const count = countActive(instances, settings);
    text.innerHTML = `Random &middot; <strong>${count}</strong> instance${count !== 1 ? 's' : ''}`;
    left.append(dot, text);
  }

  // Settings link
  const link = document.createElement('button');
  link.className = 'settings-link';
  link.textContent = 'Settings ›';
  link.dataset.serviceId = serviceId;

  row.append(left, link);
  return row;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hostOnly(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

// ─── Main ─────────────────────────────────────────────────────────────────────

let _instancesCache = {};

async function init() {
  const container = document.getElementById('services');

  let settings, allInstances;
  try {
    [settings, allInstances] = await Promise.all([
      sendMessage({ action: 'getSettings' }),
      (async () => {
        const out = {};
        await Promise.all(Object.keys(SERVICE_META).map(async id => {
          out[id] = await sendMessage({ action: 'getInstances', serviceId: id }) ?? [];
        }));
        return out;
      })(),
    ]);
  } catch (err) {
    container.innerHTML = `<div class="loading-wrap" style="color:var(--peach-dk)">Could not load settings.</div>`;
    return;
  }

  _instancesCache = allInstances;
  container.innerHTML = '';

  for (const id of Object.keys(SERVICE_META)) {
    if (!settings[id]) continue;
    container.append(buildCard(id, settings[id], allInstances[id] ?? []));
  }

  attachListeners(settings);
}

function attachListeners(settings) {
  // Toggle switches
  document.querySelectorAll('.toggle input').forEach(input => {
    input.addEventListener('change', async () => {
      const id = input.dataset.serviceId;
      const enabled = input.checked;

      const card = document.querySelector(`.card[data-service-id="${id}"]`);
      if (card) {
        card.classList.toggle('disabled', !enabled);
        const accent = card.querySelector('.card-accent');
        if (accent) accent.style.background = enabled ? SERVICE_META[id]?.accentColor : '#E8D8CE';
        const dot = card.querySelector('.status-dot');
        if (dot) dot.classList.toggle('off', !enabled);
      }

      try {
        await sendMessage({ action: 'setServiceSettings', serviceId: id, settings: { enabled } });
        const freshSettings = await sendMessage({ action: 'getSettings' });
        rerenderCard(id, freshSettings[id], _instancesCache[id] ?? []);
      } catch {
        input.checked = !enabled;
      }
    });
  });

  // Settings links
  document.querySelectorAll('.settings-link').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.storage.local.set({ optionsScrollTo: btn.dataset.serviceId });
      chrome.runtime.openOptionsPage();
    });
  });

  // Refresh
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    const icon = document.getElementById('refresh-icon');
    btn.disabled = true;
    icon?.classList.add('spinning');
    try {
      await sendMessage({ action: 'refreshAllInstances' });
      await init();
    } catch {/* swallow */} finally {
      btn.disabled = false;
      icon?.classList.remove('spinning');
    }
  });

  // Open settings page
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

function rerenderCard(serviceId, newSettings, instances) {
  const old = document.querySelector(`.card[data-service-id="${serviceId}"]`);
  if (!old) return;
  const fresh = buildCard(serviceId, newSettings, instances);
  old.replaceWith(fresh);

  // Re-attach listeners for the new card
  fresh.querySelector('.toggle input')?.addEventListener('change', async (e) => {
    const id = e.target.dataset.serviceId;
    const enabled = e.target.checked;
    const card = document.querySelector(`.card[data-service-id="${id}"]`);
    if (card) {
      card.classList.toggle('disabled', !enabled);
      const accent = card.querySelector('.card-accent');
      if (accent) accent.style.background = enabled ? SERVICE_META[id]?.accentColor : '#E8D8CE';
    }
    try {
      await sendMessage({ action: 'setServiceSettings', serviceId: id, settings: { enabled } });
      const freshSettings = await sendMessage({ action: 'getSettings' });
      rerenderCard(id, freshSettings[id], _instancesCache[id] ?? []);
    } catch { e.target.checked = !enabled; }
  });
  fresh.querySelector('.settings-link')?.addEventListener('click', () => {
    chrome.storage.local.set({ optionsScrollTo: serviceId });
    chrome.runtime.openOptionsPage();
  });
}

init();
