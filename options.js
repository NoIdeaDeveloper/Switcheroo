/**
 * options.js
 * Full settings page. Communicates with the background service worker
 * via chrome.runtime.sendMessage.
 *
 * Features per service:
 *   - Enable/disable toggle
 *   - Mode selector: Random / Fixed
 *   - Fixed-mode: dropdown of available instances + custom URL input
 *   - Instance list with individual checkboxes (opt-out model)
 *   - Cloudflare instances in separate collapsible section with warning
 *   - Refresh instances button
 *
 * No network requests from this page (CSP: connect-src 'none').
 * All data flows through sendMessage → background service worker.
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

// ─── Service metadata ─────────────────────────────────────────────────────────

const SERVICE_META = {
  youtube: { label: 'YouTube', target: 'Invidious' },
  reddit:  { label: 'Reddit',  target: 'Redlib' },
};

// ─── Debounce ─────────────────────────────────────────────────────────────────

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ─── Save helper ──────────────────────────────────────────────────────────────

const debouncedSave = debounce(async (serviceId, patch) => {
  try {
    await sendMessage({ action: 'setServiceSettings', serviceId, settings: patch });
  } catch (err) {
    console.error('[Switcheroo] Failed to save settings:', err);
  }
}, 300);

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Builds the full section for one service.
 */
function buildServiceSection(serviceId, settings, instances) {
  const meta = SERVICE_META[serviceId] ?? { label: serviceId, target: '?' };
  const svc = settings[serviceId] ?? {};

  const section = document.createElement('section');
  section.className = 'section';
  section.id = `section-${serviceId}`;

  // ── Section header ───────────────────────────────
  const header = document.createElement('div');
  header.className = 'section-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'section-title-row';

  titleRow.innerHTML = `
    <h2 class="section-title">${escapeHtml(meta.label)}</h2>
    <span class="section-title-arrow">→</span>
    <span class="section-target">${escapeHtml(meta.target)}</span>
  `;

  const toggle = buildToggle(serviceId, svc.enabled ?? true);
  header.append(titleRow, toggle);
  section.append(header);

  // ── Section body ─────────────────────────────────
  const body = document.createElement('div');
  body.className = 'section-body';

  // Mode selector
  body.append(buildModeSelector(serviceId, svc));

  // Fixed instance picker (shown only in fixed mode)
  const fixedWrap = buildFixedInstancePicker(serviceId, svc, instances);
  body.append(fixedWrap);

  // Instance list
  body.append(buildInstanceList(serviceId, svc, instances));

  section.append(body);
  return section;
}

function buildToggle(serviceId, checked) {
  const label = document.createElement('label');
  label.className = 'toggle';
  label.setAttribute('aria-label', `Enable ${SERVICE_META[serviceId]?.label ?? serviceId}`);

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.id = `toggle-${serviceId}`;

  const track = document.createElement('span');
  track.className = 'toggle-track';

  const thumb = document.createElement('span');
  thumb.className = 'toggle-thumb';

  input.addEventListener('change', () => {
    debouncedSave(serviceId, { enabled: input.checked });
  });

  label.append(input, track, thumb);
  return label;
}

function buildModeSelector(serviceId, svc) {
  const group = document.createElement('div');
  group.className = 'field-group';

  const label = document.createElement('div');
  label.className = 'field-label';
  label.textContent = 'Redirect mode';

  const selector = document.createElement('div');
  selector.className = 'mode-selector';

  const modes = [
    { value: 'random', label: 'Random (rotates hourly)' },
    { value: 'fixed',  label: 'Fixed instance' },
  ];

  for (const mode of modes) {
    const btn = document.createElement('button');
    btn.className = `mode-btn${svc.mode === mode.value ? ' active' : ''}`;
    btn.textContent = mode.label;
    btn.dataset.mode = mode.value;
    btn.dataset.serviceId = serviceId;

    btn.addEventListener('click', () => {
      selector.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show/hide fixed instance picker
      const fixedWrap = document.getElementById(`fixed-wrap-${serviceId}`);
      if (fixedWrap) fixedWrap.classList.toggle('visible', mode.value === 'fixed');

      debouncedSave(serviceId, { mode: mode.value });
    });

    selector.append(btn);
  }

  group.append(label, selector);
  return group;
}

function buildFixedInstancePicker(serviceId, svc, instances) {
  const wrap = document.createElement('div');
  wrap.className = `fixed-instance-wrap${svc.mode === 'fixed' ? ' visible' : ''}`;
  wrap.id = `fixed-wrap-${serviceId}`;

  const group = document.createElement('div');
  group.className = 'field-group';

  const label = document.createElement('div');
  label.className = 'field-label';
  label.textContent = 'Choose instance';

  // Dropdown of known instances
  const select = document.createElement('select');
  select.className = 'instance-select';
  select.id = `fixed-select-${serviceId}`;

  const clearOpt = document.createElement('option');
  clearOpt.value = '';
  clearOpt.textContent = '— Select an instance —';
  select.append(clearOpt);

  const nonCF = instances.filter(i => !i.cloudflare);
  const cfInstances = instances.filter(i => i.cloudflare);

  for (const inst of nonCF) {
    const opt = new Option(formatInstanceOption(inst), inst.url);
    if (svc.fixedInstance === inst.url) opt.selected = true;
    select.append(opt);
  }

  if (cfInstances.length > 0) {
    const grp = document.createElement('optgroup');
    grp.label = '⚠ Cloudflare instances';
    for (const inst of cfInstances) {
      const opt = new Option(`⚠ ${formatInstanceOption(inst)}`, inst.url);
      if (svc.fixedInstance === inst.url) opt.selected = true;
      grp.append(opt);
    }
    select.append(grp);
  }

  select.addEventListener('change', () => {
    if (select.value) {
      debouncedSave(serviceId, { fixedInstance: select.value });
    }
  });

  group.append(label, select);

  // Custom URL input
  const customGroup = document.createElement('div');
  customGroup.className = 'field-group';

  const customLabel = document.createElement('div');
  customLabel.className = 'field-label';
  customLabel.textContent = 'Or enter a custom HTTPS instance URL';

  const customWrap = document.createElement('div');
  customWrap.className = 'custom-url-wrap';

  const input = document.createElement('input');
  input.type = 'url';
  input.className = 'custom-url-input';
  input.placeholder = 'https://your-instance.example.com';
  input.id = `custom-url-${serviceId}`;

  const useBtn = document.createElement('button');
  useBtn.className = 'btn-use-custom';
  useBtn.textContent = 'Use';

  useBtn.addEventListener('click', () => {
    const val = input.value.trim();
    if (!val.startsWith('https://')) {
      input.classList.add('invalid');
      return;
    }
    input.classList.remove('invalid');

    // Add to dropdown if not already present
    const exists = Array.from(select.options).some(o => o.value === val);
    if (!exists) {
      const opt = new Option(val.replace('https://', ''), val);
      select.insertBefore(opt, select.options[1]);
    }
    select.value = val;
    debouncedSave(serviceId, { fixedInstance: val });
    input.value = '';
  });

  input.addEventListener('input', () => input.classList.remove('invalid'));

  customWrap.append(input, useBtn);
  customGroup.append(customLabel, customWrap);

  wrap.append(group, customGroup);
  return wrap;
}

function buildInstanceList(serviceId, svc, instances) {
  const group = document.createElement('div');
  group.className = 'field-group';

  // Header row: label + last-updated + refresh button
  const headerRow = document.createElement('div');
  headerRow.className = 'instance-list-header';

  const labelEl = document.createElement('div');
  labelEl.className = 'field-label';
  labelEl.textContent = 'Available instances';

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn-refresh-instances';
  refreshBtn.id = `refresh-btn-${serviceId}`;
  refreshBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13.65 2.35A8 8 0 1 0 15 8h-2a6 6 0 1 1-1.1-3.47L10 6h5V1l-1.35 1.35Z" fill="currentColor"/>
    </svg>
    Refresh
  `;

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    const icon = refreshBtn.querySelector('svg');
    icon?.classList.add('spinning');

    try {
      const result = await sendMessage({ action: 'refreshInstances', serviceId });
      const freshInstances = await sendMessage({ action: 'getInstances', serviceId });
      const freshSettings = await sendMessage({ action: 'getSettings' });

      // Re-render the instance list
      const oldList = document.getElementById(`list-${serviceId}`);
      const newList = buildInstanceListItems(serviceId, freshSettings[serviceId], freshInstances);
      newList.id = `list-${serviceId}`;
      oldList?.replaceWith(newList);

      const countEl = document.getElementById(`instance-count-${serviceId}`);
      if (countEl) countEl.textContent = `Updated · ${result.count} instances`;
    } catch (err) {
      console.error(err);
    } finally {
      refreshBtn.disabled = false;
      icon?.classList.remove('spinning');
    }
  });

  headerRow.append(labelEl, refreshBtn);

  const countEl = document.createElement('div');
  countEl.className = 'instance-last-updated';
  countEl.id = `instance-count-${serviceId}`;
  countEl.textContent = `${instances.length} instance${instances.length !== 1 ? 's' : ''} available`;

  const list = buildInstanceListItems(serviceId, svc, instances);
  list.id = `list-${serviceId}`;

  group.append(headerRow, countEl, list);
  return group;
}

function buildInstanceListItems(serviceId, svc, instances) {
  const list = document.createElement('div');
  list.className = 'instance-list';

  const nonCF = instances.filter(i => !i.cloudflare);
  const cfInstances = instances.filter(i => i.cloudflare);

  if (instances.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'no-instances';
    empty.textContent = 'No instances loaded. Click Refresh to fetch them.';
    list.append(empty);
    return list;
  }

  // Normal instances
  for (const inst of nonCF) {
    list.append(buildInstanceRow(serviceId, svc, inst, false));
  }

  // Cloudflare section
  if (cfInstances.length > 0) {
    const cfLabel = document.createElement('div');
    cfLabel.className = 'cf-section-label';
    cfLabel.innerHTML = `
      <span>⚠</span>
      <span>Cloudflare instances (not recommended — can log your traffic)</span>
    `;
    list.append(cfLabel);

    for (const inst of cfInstances) {
      list.append(buildInstanceRow(serviceId, svc, inst, true));
    }
  }

  // Warning if nothing is checked
  const checkedCount = nonCF.filter(i => isEnabled(i, svc)).length;
  if (checkedCount === 0 && !svc.allowCloudflare) {
    const warn = document.createElement('div');
    warn.className = 'warn-no-instances';
    warn.textContent = '⚠ No instances selected — all will be used as fallback.';
    list.append(warn);
  }

  return list;
}

function buildInstanceRow(serviceId, svc, inst, isCF) {
  const row = document.createElement('div');
  row.className = `instance-item${isCF ? ' cloudflare-item' : ''}`;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'instance-checkbox';
  checkbox.checked = isEnabled(inst, svc);
  checkbox.dataset.url = inst.url;

  checkbox.addEventListener('change', () => {
    updateEnabledInstances(serviceId, inst.url, checkbox.checked);
  });

  const urlEl = document.createElement('span');
  urlEl.className = 'instance-url';
  urlEl.textContent = inst.url.replace('https://', '');
  urlEl.title = inst.url;

  const meta = document.createElement('span');
  meta.className = 'instance-meta';

  if (inst.country) {
    const flag = document.createElement('span');
    flag.className = 'instance-country';
    flag.textContent = countryToFlag(inst.country);
    flag.title = inst.country;
    meta.append(flag);
  }

  if (typeof inst.uptime === 'number') {
    const uptimeEl = document.createElement('span');
    uptimeEl.className = `instance-uptime${inst.uptime < 80 ? ' low' : ''}`;
    uptimeEl.textContent = `${Math.round(inst.uptime)}%`;
    meta.append(uptimeEl);
  }

  if (isCF) {
    const badge = document.createElement('span');
    badge.className = 'badge-cf';
    badge.textContent = 'CF';
    meta.append(badge);
  }

  row.append(checkbox, urlEl, meta);
  return row;
}

// ─── Instance enable/disable ──────────────────────────────────────────────────

const pendingEnabledChanges = {};

async function updateEnabledInstances(serviceId, url, enabled) {
  const settings = await sendMessage({ action: 'getSettings' });
  const svc = settings[serviceId] ?? {};

  let enabledInstances = [...(svc.enabledInstances ?? [])];

  // If the list is empty it means "all enabled" — materialise it first
  if (enabledInstances.length === 0) {
    const instances = await sendMessage({ action: 'getInstances', serviceId });
    enabledInstances = (instances ?? []).map(i => i.url);
  }

  if (enabled) {
    if (!enabledInstances.includes(url)) enabledInstances.push(url);
  } else {
    enabledInstances = enabledInstances.filter(u => u !== url);
  }

  // Debounce the actual save
  clearTimeout(pendingEnabledChanges[serviceId]);
  pendingEnabledChanges[serviceId] = setTimeout(() => {
    sendMessage({ action: 'setServiceSettings', serviceId, settings: { enabledInstances } })
      .catch(err => console.error('[Switcheroo] Failed to save enabled instances:', err));
  }, 300);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isEnabled(inst, svc) {
  if (!svc.enabledInstances || svc.enabledInstances.length === 0) return true;
  return svc.enabledInstances.includes(inst.url);
}

function formatInstanceOption(inst) {
  const host = inst.url.replace('https://', '');
  const parts = [host];
  if (inst.country) parts.push(countryToFlag(inst.country));
  if (typeof inst.uptime === 'number') parts.push(`${Math.round(inst.uptime)}%`);
  return parts.join(' ');
}

function countryToFlag(code) {
  if (!code || code.length !== 2) return '';
  const offset = 127397;
  return [...code.toUpperCase()].map(c => String.fromCodePoint(c.charCodeAt(0) + offset)).join('');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function init() {
  const container = document.getElementById('services-container');

  let settings, allInstances;
  try {
    settings = await sendMessage({ action: 'getSettings' });
    const ids = Object.keys(SERVICE_META);
    allInstances = {};
    await Promise.all(ids.map(async id => {
      allInstances[id] = await sendMessage({ action: 'getInstances', serviceId: id }) ?? [];
    }));
  } catch (err) {
    container.innerHTML = `<div class="loading">Error loading settings. Try reloading the page.</div>`;
    console.error(err);
    return;
  }

  container.innerHTML = '';

  for (const id of Object.keys(SERVICE_META)) {
    if (!settings[id]) continue;
    const section = buildServiceSection(id, settings, allInstances[id] ?? []);
    container.append(section);
  }

  // Scroll to a specific service section if requested from popup
  const scrollResult = await chrome.storage.local.get('optionsScrollTo');
  const scrollTarget = scrollResult?.optionsScrollTo;
  if (scrollTarget) {
    await chrome.storage.local.remove('optionsScrollTo');
    const el = document.getElementById(`section-${scrollTarget}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

init();
