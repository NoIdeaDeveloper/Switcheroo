/**
 * popup.js — Rooroute toolbar popup
 * No network requests. All data flows through sendMessage → background.
 */

// Apply dark mode from storage immediately to minimise flash before init() runs.
chrome.storage.local.get('globalSettings', result => {
  if (result.globalSettings?.darkMode) document.documentElement.dataset.theme = 'dark';
});

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
  youtube:     { label: 'YouTube',      target: 'Invidious',   accentColor: '#FFBA93', fetchUrl: 'https://api.invidious.io/instances.json?sort_by=type,users' },
  reddit:      { label: 'Reddit',       target: 'Redlib',      accentColor: '#98D4B4', fetchUrl: 'https://raw.githubusercontent.com/redlib-org/redlib-instances/refs/heads/main/instances.json' },
  googlefonts: { label: 'Google Fonts', target: 'Bunny Fonts', accentColor: '#C9B8F0', staticRedirect: true, fetchUrl: null },
  imgur:       { label: 'Imgur',        target: 'Rimgo',       accentColor: '#8EC0E8', fetchUrl: 'https://rimgo.codeberg.page/api.json' },
  tiktok:      { label: 'TikTok',       target: 'ProxiTok',    accentColor: '#D9A0BC', fetchUrl: 'https://raw.githubusercontent.com/pablouser1/ProxiTok/refs/heads/master/instances.json' },
  scribe:      { label: 'Medium',       target: 'Scribe',      accentColor: '#AACCA4', fetchUrl: 'https://git.sr.ht/~edwardloveall/scribe/blob/main/docs/instances.md' },
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
  let pool = settings.allowCloudflare
    ? instances
    : instances.filter(i => !i.cloudflare && !i.collectsData);
  if (settings.enabledInstances?.length > 0) {
    const enabled = new Set(settings.enabledInstances);
    pool = pool.filter(i => enabled.has(i.url));
  }
  return pool.length;
}

// ─── Refresh All consent modal ────────────────────────────────────────────────

/**
 * Shows a compact consent modal listing all fetch URLs before triggering
 * a Refresh All when auto-updates are Off.
 * @returns {Promise<boolean>}
 */
function confirmRefreshAll() {
  return new Promise(resolve => {
    let overlay = document.getElementById('popup-refresh-all-overlay');

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'popup-refresh-all-overlay';
      overlay.className = 'popup-modal-overlay';
      overlay.setAttribute('hidden', '');

      const box = document.createElement('div');
      box.className = 'popup-modal-box';

      const title = document.createElement('div');
      title.className = 'popup-modal-title';
      title.textContent = 'Network requests required';

      const body = document.createElement('div');
      body.className = 'popup-modal-body';

      const services = Object.values(SERVICE_META).filter(m => !m.staticRedirect && m.fetchUrl);
      const hostLines = services.map(m => {
        const host = (() => { try { return new URL(m.fetchUrl).hostname; } catch { return m.fetchUrl; } })();
        return `<li><strong>${escHtml(m.label)}</strong>: ${escHtml(host)}</li>`;
      }).join('');

      body.innerHTML =
        `Refreshing requires contacting:<br>` +
        `<ul class="popup-modal-url-list">${hostLines}</ul>` +
        `Your IP &amp; browser will be visible to each host.`;

      const actions = document.createElement('div');
      actions.className = 'popup-modal-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'popup-modal-btn';
      cancelBtn.textContent = 'Cancel';

      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'popup-modal-btn popup-modal-btn--primary';
      confirmBtn.textContent = 'Refresh All';

      actions.append(cancelBtn, confirmBtn);
      box.append(title, body, actions);
      overlay.append(box);
      document.body.append(overlay);
    }

    overlay.removeAttribute('hidden');

    const cancelBtn  = overlay.querySelector('.popup-modal-btn:not(.popup-modal-btn--primary)');
    const confirmBtn = overlay.querySelector('.popup-modal-btn--primary');

    function finish(confirmed) {
      overlay.setAttribute('hidden', '');
      cancelBtn.replaceWith(cancelBtn.cloneNode(true));
      confirmBtn.replaceWith(confirmBtn.cloneNode(true));
      overlay.removeEventListener('click', onOverlayClick);
      resolve(confirmed);
    }

    function onOverlayClick(e) { if (e.target === overlay) finish(false); }

    cancelBtn.addEventListener('click', () => finish(false));
    confirmBtn.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', onOverlayClick);
  });
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
    container.innerHTML = `<div class="loading-wrap loading-wrap--error">Could not load settings.</div>`;
    return;
  }

  _instancesCache = allInstances;
  container.innerHTML = '';

  let cardsAdded = 0;
  for (const id of Object.keys(SERVICE_META)) {
    if (!settings[id]) continue;
    if (!settings[id].enabled) continue; // disabled services are hidden from the popup
    container.append(buildCard(id, settings[id], allInstances[id] ?? []));
    cardsAdded++;
  }

  if (cardsAdded === 0) {
    const empty = document.createElement('div');
    empty.className = 'loading-wrap loading-wrap--muted';
    empty.textContent = 'All redirects are off. Enable one in Settings.';
    container.append(empty);
  }

  attachListeners(settings);
}

/**
 * Animates a card element to height 0 then removes it from the DOM.
 * Uses a forced-reflow trick so the transition fires correctly.
 * @param {HTMLElement} card
 */
function animateCardOut(card) {
  card.style.height = card.offsetHeight + 'px';
  card.style.overflow = 'hidden';
  // Reading offsetHeight forces layout, committing the initial height before transition starts
  card.offsetHeight; // eslint-disable-line no-unused-expressions
  card.style.transition = 'height 0.28s ease, opacity 0.22s ease';
  card.style.height = '0';
  card.style.opacity = '0';
  setTimeout(() => card.remove(), 300);
}

function attachListeners(settings) {
  // Toggle switches
  document.querySelectorAll('.toggle input').forEach(input => {
    input.addEventListener('change', async () => {
      const id = input.dataset.serviceId;
      const enabled = input.checked;

      if (!enabled) {
        // Optimistically animate the card out immediately for snappy feel
        const card = document.querySelector(`.card[data-service-id="${id}"]`);
        if (card) animateCardOut(card);
      }

      try {
        await sendMessage({ action: 'setServiceSettings', serviceId: id, settings: { enabled } });
      } catch {
        // Save failed — restore the full popup state
        if (!enabled) await init();
        else input.checked = false;
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

  // Refresh All
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    const icon = document.getElementById('refresh-icon');

    // If auto-updates are Off, ask for consent before making network calls
    try {
      const globalSettings = await sendMessage({ action: 'getGlobalSettings' });
      if (globalSettings.instanceRefreshIntervalMs === null) {
        const confirmed = await confirmRefreshAll();
        if (!confirmed) return;
      }
    } catch {/* if getGlobalSettings fails, proceed anyway */}

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


init();
