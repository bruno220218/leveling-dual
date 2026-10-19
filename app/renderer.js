'use strict';
const api = window.dual;
const I18N = window.I18N;
const layer = document.getElementById('layer');
let drag = false;
let frame = 0;
let last = null; // último estado recebido
let lang = 'pt';
const t = (key, vars = {}) => String((I18N[lang] || I18N.pt)[key] ?? I18N.pt[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
// A CSP não aceita style="" no HTML: as posições e cores são aplicadas pelo JS.
function box(className, rect, color) {
  const el = document.createElement('div');
  el.className = className;
  Object.assign(el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  if (color) el.style.setProperty('--c', color);
  return el;
}
function applyLanguage(value) {
  if (value === lang && document.documentElement.dataset.ready) return;
  lang = value;
  document.documentElement.dataset.ready = '1';
  document.documentElement.lang = { pt: 'pt-BR', en: 'en', es: 'es' }[lang] || 'pt-BR';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  const credits = document.getElementById('credits-line');
  const [before, middle, after] = t('credits').split(/\{creator\}|\{collab\}/);
  const bold = text => { const b = document.createElement('b'); b.textContent = text; return b; };
  credits.replaceChildren(before, bold('bruno220218'), middle, bold('SkymerLight'), after || '');
}
function drawLayer(state) {
  layer.replaceChildren();
  const { slots, divider } = state.layout || {};
  if (!slots) return;
  slots.forEach((slot, i) => {
    if (!slot) return;
    const color = state.accounts[i].color;
    if (state.dragging) {
      const ghost = box('ghost', slot, color);
      ghost.textContent = `${state.accounts[i].icon} ${displayName(state.accounts[i], i)}`;
      layer.appendChild(ghost);
    } else layer.appendChild(box(`frame${state.focused === i ? ' active' : ''}`, slot, color));
  });
  if (divider) {
    const bar = box(`divider ${divider.dir}${drag ? ' dragging' : ''}`, divider.rect);
    bar.title = t('divider');
    layer.appendChild(bar);
  }
}
const displayName = (data, i) => (data.name === `Conta ${i + 1}` ? `${t('account')} ${i + 1}` : data.name);
function drawCustomizer(state) {
  const list = document.getElementById('custom-list');
  list.replaceChildren(...state.accounts.map((data, i) => {
    const row = document.createElement('div');
    row.className = 'custom';
    row.style.setProperty('--c', data.color);
    const title = document.createElement('div');
    title.className = 'custom-title';
    title.textContent = `${data.icon} ${displayName(data, i)}`;
    const colors = document.createElement('div');
    colors.className = 'swatches';
    state.choices.colors.forEach(color => {
      const b = document.createElement('button');
      b.className = `swatch${color === data.color ? ' selected' : ''}`;
      b.style.setProperty('--c', color);
      b.title = `${t('opt_color')} ${color}`;
      b.addEventListener('click', () => api.command({ action: 'color', index: i, value: color }));
      colors.appendChild(b);
    });
    const icons = document.createElement('div');
    icons.className = 'icons';
    state.choices.icons.forEach(icon => {
      const b = document.createElement('button');
      b.className = icon === data.icon ? 'selected' : '';
      b.textContent = icon;
      b.title = t('opt_icon');
      b.addEventListener('click', () => api.command({ action: 'icon', index: i, value: icon }));
      icons.appendChild(b);
    });
    row.append(title, colors, icons);
    return row;
  }));
}
function openModal(id, open) {
  document.getElementById(id).hidden = !open;
  const any = [...document.querySelectorAll('.modal')].some(m => !m.hidden);
  api.command({ action: 'overlay', value: any });
  if (open && id === 'options-box' && last) drawCustomizer(last);
}
if (api) {
  applyLanguage('pt');
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => api.command({ action: 'mode', value: button.dataset.mode })));
  document.querySelectorAll('[data-lang]').forEach(button => button.addEventListener('click', () => api.command({ action: 'lang', value: button.dataset.lang })));
  document.getElementById('pip').addEventListener('click', () => api.command({ action: 'pip' }));
  document.getElementById('reload-both').addEventListener('click', () => api.command({ action: 'reloadBoth' }));
  document.getElementById('center').addEventListener('click', () => api.command({ action: 'center' }));
  document.getElementById('compact').addEventListener('click', () => api.command({ action: 'compact' }));
  document.getElementById('show-bar').addEventListener('click', () => api.command({ action: 'compact' }));
  document.getElementById('update-get').addEventListener('click', () => api.command({ action: 'updateOpen' }));
  document.getElementById('update-skip').addEventListener('click', () => api.command({ action: 'updateSkip' }));
  document.getElementById('help').addEventListener('click', () => openModal('help-box', true));
  document.getElementById('options').addEventListener('click', () => openModal('options-box', true));
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => openModal(button.dataset.close, false)));
  document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) openModal(modal.id, false); }));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.modal').forEach(modal => { if (!modal.hidden) openModal(modal.id, false); });
  });
  document.querySelectorAll('[data-pref]').forEach(input => input.addEventListener('change', () => api.command({ action: input.dataset.pref })));
  document.querySelectorAll('.account').forEach(account => {
    const index = Number(account.dataset.index);
    account.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.action === 'customize') { openModal('options-box', true); return; }
      api.command({ action: button.dataset.action, index, value: Number(button.dataset.value) });
    }));
    account.addEventListener('click', event => { if (!event.target.closest('button, input')) api.command({ action: 'focus', index }); });
    const input = account.querySelector('.name');
    input.addEventListener('change', () => api.command({ action: 'name', index, value: input.value }));
    input.addEventListener('keydown', event => { if (event.key === 'Enter') input.blur(); });
  });
  // Divisória: enquanto arrasta, as páginas somem e aparece uma prévia dos tamanhos.
  layer.addEventListener('pointerdown', event => {
    if (!event.target.classList.contains('divider') || event.button !== 0) return;
    event.preventDefault();
    drag = true;
    document.body.classList.add(event.target.classList.contains('h') ? 'drag-h' : 'drag-v');
    api.command({ action: 'dragStart' });
  });
  window.addEventListener('pointermove', event => {
    if (!drag) return;
    const { clientX: x, clientY: y } = event;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => api.command({ action: 'dragMove', x, y }));
  });
  const stopDrag = () => {
    if (!drag) return;
    drag = false;
    document.body.classList.remove('drag-h', 'drag-v');
    api.command({ action: 'dragEnd' });
  };
  window.addEventListener('pointerup', stopDrag);
  window.addEventListener('blur', stopDrag);
  layer.addEventListener('dblclick', event => { if (event.target.classList.contains('divider')) api.command({ action: 'center' }); });
  api.onState(state => {
    last = state;
    applyLanguage(state.lang);
    document.body.classList.toggle('compact', state.compact);
    document.querySelectorAll('[data-mode]').forEach(button => {
      const selected = button.dataset.mode === state.mode;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    document.querySelectorAll('[data-lang]').forEach(button => button.classList.toggle('selected', button.dataset.lang === state.lang));
    document.getElementById('pip').classList.toggle('selected', state.pip >= 0);
    document.querySelectorAll('[data-pref]').forEach(input => { input.checked = Boolean(state[input.dataset.pref]); });
    document.getElementById('version-line').textContent = `Leveling Dual ${state.version}`;
    const pill = document.getElementById('update');
    pill.hidden = !state.update;
    document.getElementById('show-bar').classList.toggle('has-update', Boolean(state.update));
    if (state.update) document.getElementById('update-text').textContent = t('update_new', { version: state.update.version });
    state.accounts.forEach((data, i) => {
      const account = document.querySelector(`[data-index="${i}"]`);
      const input = account.querySelector('.name');
      if (document.activeElement !== input) input.value = displayName(data, i);
      input.setAttribute('aria-label', `${t('account')} ${i + 1}`);
      account.style.setProperty('--c', data.color);
      account.classList.toggle('active', state.focused === i);
      account.querySelector('.icon').textContent = data.icon;
      const usage = data.usage ? ` · ${t('usage', { cpu: data.usage.cpu, mem: data.usage.mem })}` : '';
      account.querySelector('.status').textContent = t(data.status) + usage;
      account.querySelector('.zoom').textContent = `${data.zoom}%`;
      account.querySelector('.mute').textContent = data.muted ? t('unmute') : t('mute');
      account.querySelector('.expand').textContent = state.mode === (i ? 'two' : 'one') ? t('back') : t('expand');
    });
    if (!document.getElementById('options-box').hidden) drawCustomizer(state);
    drawLayer(state);
  });
  api.command({ action: 'state' });
}
