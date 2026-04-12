/**
 * options.js — Switcheroo full settings page.
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
  youtube: { label: 'YouTube', target: 'Invidious' },
  reddit:  { label: 'Reddit',  target: 'Redlib'    },
  googlefonts: {
    label: 'Google Fonts',
    target: 'Bunny Fonts',
    staticRedirect: true,
    description: 'Redirects Google Fonts to fonts.bunny.net — a privacy-friendly, GDPR-compliant CDN. No Google tracking. Works for every font.',
  },
  imgur: { label: 'Imgur', target: 'Rimgo' },
};

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const debouncedSave = debounce(async (serviceId, patch) => {
  try { await sendMessage({ action: 'setServiceSettings', serviceId, settings: patch }); }
  catch (err) { console.error('[Switcheroo] Save failed:', err); }
}, 350);

// ─── Section builder ──────────────────────────────────────────────────────────

function buildSection(serviceId, settings, instances, order = 0) {
  const meta = SERVICE_META[serviceId];
  const svc  = settings[serviceId] ?? {};

  const section = document.createElement('section');
  section.className = `section section--${serviceId} section--order-${order}`;
  section.id = `section-${serviceId}`;

  // Header
  const header = document.createElement('div');
  header.className = 'section-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'section-title-row';
  titleRow.innerHTML = `
    <h2 class="section-title">${escHtml(meta.label)}</h2>
    <span class="section-arrow">→</span>
    <span class="section-target">${escHtml(meta.target)}</span>
  `;

  const toggle = buildToggle(serviceId, svc.enabled ?? true);
  header.append(titleRow, toggle);
  section.append(header);

  // Body
  const body = document.createElement('div');
  body.className = 'section-body';

  if (meta.staticRedirect) {
    // Static-redirect services (e.g. Google Fonts) have a single fixed target
    // and no instance list to manage — show a styled info box.
    const box = document.createElement('div');
    box.className = 'static-redirect-box';

    const desc = document.createElement('p');
    desc.className = 'static-redirect-desc';
    desc.textContent = meta.description ?? '';

    const pill = document.createElement('span');
    pill.className = 'static-redirect-pill';
    const target = settings[serviceId]?.currentInstance ?? `https://${meta.target.toLowerCase().replace(' ', '')}`;
    pill.textContent = `→ ${target.replace('https://', '')}`;

    box.append(desc, pill);
    body.append(box);
  } else {
    // Random-mode-only controls: rotation interval + instance list.
    // Hidden when mode is 'fixed' so the instance checklist doesn't confuse
    // users who have already selected a specific fixed instance.
    const randomControls = document.createElement('div');
    randomControls.id = `random-controls-${serviceId}`;
    randomControls.className = `random-controls${svc.mode === 'fixed' ? ' hidden' : ''}`;
    randomControls.append(
      buildRotationInterval(serviceId, svc),
      buildInstanceList(serviceId, svc, instances),
    );

    body.append(
      buildModeSelector(serviceId, svc),
      buildFixedPicker(serviceId, svc, instances),
      randomControls,
    );
  }

  section.append(body);
  return section;
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function buildToggle(serviceId, checked) {
  const lbl = document.createElement('label');
  lbl.className = 'toggle';
  lbl.setAttribute('aria-label', `Enable ${SERVICE_META[serviceId]?.label} redirect`);

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;

  const track = document.createElement('span');
  track.className = 'toggle-track';

  const thumb = document.createElement('span');
  thumb.className = 'toggle-thumb';

  input.addEventListener('change', () => debouncedSave(serviceId, { enabled: input.checked }));
  lbl.append(input, track, thumb);
  return lbl;
}

// ── Mode selector ─────────────────────────────────────────────────────────────

function buildModeSelector(serviceId, svc) {
  const group = document.createElement('div');
  group.className = 'field-group';

  const lbl = document.createElement('div');
  lbl.className = 'field-label';
  lbl.textContent = 'Redirect mode';

  const sel = document.createElement('div');
  sel.className = 'mode-selector';

  const modes = [
    { value: 'random', text: 'Random' },
    { value: 'fixed',  text: 'Fixed'  },
  ];

  for (const m of modes) {
    const btn = document.createElement('button');
    btn.className = `mode-btn${svc.mode === m.value ? ' active' : ''}`;
    btn.textContent = m.text;

    btn.addEventListener('click', () => {
      sel.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const fixedWrap = document.getElementById(`fixed-wrap-${serviceId}`);
      const randomControls = document.getElementById(`random-controls-${serviceId}`);
      if (fixedWrap) fixedWrap.classList.toggle('visible', m.value === 'fixed');
      if (randomControls) randomControls.classList.toggle('hidden', m.value !== 'random');
      debouncedSave(serviceId, { mode: m.value });
    });
    sel.append(btn);
  }

  group.append(lbl, sel);
  return group;
}

// ── Fixed instance picker ─────────────────────────────────────────────────────

function buildFixedPicker(serviceId, svc, instances) {
  const wrap = document.createElement('div');
  wrap.className = `fixed-instance-wrap${svc.mode === 'fixed' ? ' visible' : ''}`;
  wrap.id = `fixed-wrap-${serviceId}`;

  // Dropdown
  const grp1 = document.createElement('div');
  grp1.className = 'field-group';

  const lbl1 = document.createElement('div');
  lbl1.className = 'field-label';
  lbl1.textContent = 'Choose from available instances';

  const select = document.createElement('select');
  select.className = 'instance-select';

  const placeholder = new Option('— Select an instance —', '');
  select.append(placeholder);

  const nonCF = instances.filter(i => !i.cloudflare);
  const cfList = instances.filter(i => i.cloudflare);

  for (const inst of nonCF) {
    const opt = new Option(formatOpt(inst), inst.url);
    if (svc.fixedInstance === inst.url) opt.selected = true;
    select.append(opt);
  }

  if (cfList.length) {
    const grp = document.createElement('optgroup');
    grp.label = '⚠ Cloudflare instances';
    for (const inst of cfList) {
      const opt = new Option(`⚠ ${formatOpt(inst)}`, inst.url);
      if (svc.fixedInstance === inst.url) opt.selected = true;
      grp.append(opt);
    }
    select.append(grp);
  }

  // Save immediately — no debounce. Fixed instance changes must apply before
  // the user navigates away, and there is no rapid-fire scenario to debounce.
  select.addEventListener('change', () => {
    if (select.value) {
      sendMessage({ action: 'setServiceSettings', serviceId, settings: { fixedInstance: select.value } })
        .catch(err => console.error('[Switcheroo] Save failed:', err));
    }
  });

  grp1.append(lbl1, select);

  // Custom URL
  const grp2 = document.createElement('div');
  grp2.className = 'field-group';

  const lbl2 = document.createElement('div');
  lbl2.className = 'field-label';
  lbl2.textContent = 'Or enter a custom HTTPS URL';

  const row = document.createElement('div');
  row.className = 'custom-url-wrap';

  const input = document.createElement('input');
  input.type = 'url';
  input.className = 'custom-url-input';
  input.placeholder = 'https://your-instance.example.com';

  const useBtn = document.createElement('button');
  useBtn.className = 'btn-use';
  useBtn.textContent = 'Use';

  useBtn.addEventListener('click', () => {
    const val = input.value.trim();
    if (!val.startsWith('https://')) { input.classList.add('invalid'); return; }
    input.classList.remove('invalid');
    if (!Array.from(select.options).some(o => o.value === val)) {
      const opt = new Option(val.replace('https://', ''), val);
      select.insertBefore(opt, select.options[1]);
    }
    select.value = val;
    sendMessage({ action: 'setServiceSettings', serviceId, settings: { fixedInstance: val } })
      .catch(err => console.error('[Switcheroo] Save failed:', err));
    input.value = '';
  });

  input.addEventListener('input', () => input.classList.remove('invalid'));
  row.append(input, useBtn);
  grp2.append(lbl2, row);

  wrap.append(grp1, grp2);
  return wrap;
}

// ── Rotation interval ─────────────────────────────────────────────────────────

const ROTATION_OPTIONS = [
  { label: 'Every minute (approx. per-redirect)', value: 60_000 },
  { label: 'Every 15 minutes',                    value: 900_000 },
  { label: 'Every hour (default)',                 value: 3_600_000 },
  { label: 'Every 6 hours',                        value: 21_600_000 },
  { label: 'Every day',                            value: 86_400_000 },
  { label: 'On startup only',                      value: 0 },
];

function buildRotationInterval(serviceId, svc) {
  const group = document.createElement('div');
  group.className = 'field-group';

  const lbl = document.createElement('div');
  lbl.className = 'field-label';
  lbl.textContent = 'Rotation interval';

  const select = document.createElement('select');
  select.className = 'instance-select';

  const current = svc.rotationIntervalMs ?? 3_600_000;
  for (const opt of ROTATION_OPTIONS) {
    const o = new Option(opt.label, String(opt.value));
    if (current === opt.value) o.selected = true;
    select.append(o);
  }

  select.addEventListener('change', () => {
    debouncedSave(serviceId, { rotationIntervalMs: Number(select.value) });
  });

  group.append(lbl, select);
  return group;
}

// ── Instance list ─────────────────────────────────────────────────────────────

function buildInstanceList(serviceId, svc, instances) {
  const group = document.createElement('div');
  group.className = 'field-group';

  const headerRow = document.createElement('div');
  headerRow.className = 'instance-list-header';

  const lbl = document.createElement('div');
  lbl.className = 'field-label';
  lbl.textContent = 'Available instances';

  const countEl = document.createElement('span');
  countEl.className = 'instance-count';
  countEl.id = `instance-count-${serviceId}`;
  countEl.textContent = `${instances.length} instance${instances.length !== 1 ? 's' : ''}`;

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn-refresh-list';
  refreshBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.65 2.35A8 8 0 1 0 15 8h-2a6 6 0 1 1-1.1-3.47L10 6h5V1l-1.35 1.35Z" fill="currentColor"/></svg> Refresh`;

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    const svg = refreshBtn.querySelector('svg');
    svg?.classList.add('spinning');
    try {
      const result = await sendMessage({ action: 'refreshInstances', serviceId });
      const fresh = await sendMessage({ action: 'getInstances', serviceId });
      const freshSettings = await sendMessage({ action: 'getSettings' });
      const oldList = document.getElementById(`list-${serviceId}`);
      const newList = buildInstanceRows(serviceId, freshSettings[serviceId], fresh ?? []);
      newList.id = `list-${serviceId}`;
      oldList?.replaceWith(newList);
      countEl.textContent = `Updated · ${result.count} instances`;
    } catch (err) { console.error(err); }
    finally { refreshBtn.disabled = false; svg?.classList.remove('spinning'); }
  });

  headerRow.append(lbl);
  const rightRow = document.createElement('div');
  rightRow.className = 'instance-list-actions';
  rightRow.append(countEl, refreshBtn);
  headerRow.append(rightRow);

  const list = buildInstanceRows(serviceId, svc, instances);
  list.id = `list-${serviceId}`;

  group.append(headerRow, list);
  return group;
}

function buildInstanceRows(serviceId, svc, instances) {
  const list = document.createElement('div');
  list.className = 'instance-list';

  if (!instances.length) {
    const empty = document.createElement('div');
    empty.className = 'no-instances';
    empty.textContent = 'No instances loaded — click Refresh to fetch them.';
    list.append(empty);
    return list;
  }

  const nonCF = instances.filter(i => !i.cloudflare);
  const cfList = instances.filter(i => i.cloudflare);

  for (const inst of nonCF) list.append(buildRow(serviceId, svc, inst, false));

  if (cfList.length) {
    const divider = document.createElement('div');
    divider.className = 'cf-divider';
    divider.textContent = '⚠ Cloudflare instances — may log your traffic';
    list.append(divider);
    for (const inst of cfList) list.append(buildRow(serviceId, svc, inst, true));
  }

  // Warn if nothing is enabled (and non-CF list is non-empty)
  const checkedCount = nonCF.filter(i => isEnabled(i, svc)).length;
  if (checkedCount === 0 && nonCF.length > 0) {
    const warn = document.createElement('div');
    warn.className = 'warn-no-selection';
    warn.textContent = '⚠ No instances selected — all instances will be used as fallback.';
    list.append(warn);
  }

  return list;
}

function buildRow(serviceId, svc, inst, isCF) {
  const row = document.createElement('div');
  row.className = `instance-row${isCF ? ' cf-row' : ''}`;

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'instance-check';
  cb.checked = isEnabled(inst, svc);
  cb.addEventListener('change', () => updateEnabled(serviceId, inst.url, cb.checked));

  const urlEl = document.createElement('span');
  urlEl.className = 'instance-url';
  urlEl.textContent = inst.url.replace('https://', '');
  urlEl.title = inst.url;

  const meta = document.createElement('div');
  meta.className = 'instance-meta';

  if (inst.country) {
    const flag = document.createElement('span');
    flag.className = 'instance-flag';
    flag.textContent = countryFlag(inst.country);
    flag.title = inst.country;
    meta.append(flag);
  }

  if (typeof inst.uptime === 'number') {
    const up = document.createElement('span');
    up.className = `instance-uptime${inst.uptime < 80 ? ' low' : ''}`;
    up.textContent = `${Math.round(inst.uptime)}%`;
    meta.append(up);
  }

  if (isCF) {
    const badge = document.createElement('span');
    badge.className = 'badge-cf';
    badge.textContent = 'CF';
    meta.append(badge);
  }

  row.append(cb, urlEl, meta);
  // Clicking the row toggles the checkbox
  row.addEventListener('click', e => { if (e.target !== cb) cb.click(); });

  return row;
}

// ── Enable/disable instances ──────────────────────────────────────────────────

const pendingEnabled = {};

async function updateEnabled(serviceId, url, enabled) {
  const settings = await sendMessage({ action: 'getSettings' });
  const svc = settings[serviceId] ?? {};
  let list = [...(svc.enabledInstances ?? [])];

  if (list.length === 0) {
    // Materialise the "all enabled" implicit state
    const all = await sendMessage({ action: 'getInstances', serviceId });
    list = (all ?? []).map(i => i.url);
  }

  if (enabled) { if (!list.includes(url)) list.push(url); }
  else { list = list.filter(u => u !== url); }

  clearTimeout(pendingEnabled[serviceId]);
  pendingEnabled[serviceId] = setTimeout(() => {
    sendMessage({ action: 'setServiceSettings', serviceId, settings: { enabledInstances: list } })
      .catch(console.error);
  }, 350);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isEnabled(inst, svc) {
  if (!svc.enabledInstances?.length) return true;
  return svc.enabledInstances.includes(inst.url);
}

function formatOpt(inst) {
  const host = inst.url.replace('https://', '');
  const parts = [host];
  if (inst.country) parts.push(countryFlag(inst.country));
  if (typeof inst.uptime === 'number') parts.push(`${Math.round(inst.uptime)}%`);
  return parts.join(' · ');
}

function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  return [...code.toUpperCase()].map(c => String.fromCodePoint(c.charCodeAt(0) + 127397)).join('');
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function init() {
  const container = document.getElementById('services-container');

  let settings, allInstances;
  try {
    settings = await sendMessage({ action: 'getSettings' });
    allInstances = {};
    await Promise.all(Object.keys(SERVICE_META).map(async id => {
      allInstances[id] = await sendMessage({ action: 'getInstances', serviceId: id }) ?? [];
    }));
  } catch (err) {
    container.innerHTML = `<div class="loading">Couldn't load settings — try reloading.</div>`;
    console.error(err);
    return;
  }

  container.innerHTML = '';

  let order = 0;
  for (const id of Object.keys(SERVICE_META)) {
    if (!settings[id]) continue;
    container.append(buildSection(id, settings, allInstances[id] ?? [], order++));
  }

  // Scroll to a specific section if the popup sent us there
  const { optionsScrollTo } = await chrome.storage.local.get('optionsScrollTo');
  if (optionsScrollTo) {
    await chrome.storage.local.remove('optionsScrollTo');
    document.getElementById(`section-${optionsScrollTo}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

init();
