'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, powerSaveBlocker, powerMonitor, safeStorage, shell, screen, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { getLayout, ratioFromPointer, isGameUrl, isWebUrl } = require('./layout.cjs');
const { LIMITER_SOURCE, normalizeFps, fpsForView, FPS_FOREGROUND, FPS_BACKGROUND } = require('./perf.cjs');
const { buildCredScript, buildCaptureScript } = require('./creds.cjs');
const I18N = require('./i18n.js');
const DPS = require('./extension.cjs');

const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
const GAME_URL = 'https://levelingidle2d.com.br/jogar';
const RELEASES_API = 'https://api.github.com/repos/bruno220218/leveling-dual/releases?per_page=10';
const RELEASES_PAGE = 'https://github.com/bruno220218/leveling-dual/releases';
const UI_FILE = path.join(__dirname, 'index.html');
const UI_URL = pathToFileURL(UI_FILE).href;
const PIP_FILE = path.join(__dirname, 'pip.html');
const PIP_URL = pathToFileURL(PIP_FILE).href;
const PIP_HEAD = 30;
const MODES = ['dual', 'stack', 'one', 'two'];
const LANGS = ['pt', 'en', 'es'];
const COLORS = ['#409eec', '#8b7bff', '#3ccf91', '#f5a524', '#f25c7a', '#e5484d', '#f0d43a', '#38c7d8'];
const ICONS = ['⚔️', '🛡️', '🏹', '🔮', '🗡️', '👑', '🐉', '💀', '⭐', '🔥', '🌙', '💎'];
app.setName('Leveling Dual');
const SHOT = process.env.LD_SHOT || '';
if (SHOT) app.setPath('userData', path.join(SHOT, 'userdata'));
const PERF_DEFAULTS = { enabled: true, fgFps: 60, bgFps: 1, muteBg: true, pauseHidden: false };
function readStartupPerf() {
  const out = { ...PERF_DEFAULTS };
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'preferences.json'), 'utf8'));
    if (typeof saved?.perf?.pauseHidden === 'boolean') out.pauseHidden = saved.perf.pauseHidden;
    if (typeof saved?.perf?.enabled === 'boolean') out.enabled = saved.perf.enabled;
  } catch {  }
  if (process.env.LD_PAUSE_HIDDEN !== undefined) out.pauseHidden = process.env.LD_PAUSE_HIDDEN === '1';
  if (process.env.LD_PERF !== undefined) out.enabled = process.env.LD_PERF !== '0';
  return out;
}
const STARTUP_PERF = readStartupPerf();
app.commandLine.appendSwitch('disable-background-timer-throttling');
if (!(STARTUP_PERF.enabled && STARTUP_PERF.pauseHidden)) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}
if (IS_LINUX) {
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  const desktop = String(process.env.XDG_CURRENT_DESKTOP || '').toUpperCase();
  if (!/GNOME|KDE|CINNAMON|DEEPIN|PANTHEON|UKUI|UNITY/.test(desktop)) {
    app.commandLine.appendSwitch('password-store', 'basic');
  }
}
let main;
let views = [];
let blocker;
let saving = false;
let focused = 0;
let dragging = false;
let overlay = false;
let current = null;
let update = null;
let pip = null;
let usageTimer;
let perfTimer;
let autoReloadTimer;
let autoReloadSecond;
let locked = false;
let dpsTimer;
let dpsPollTimer;
let dpsBusy = null;
const dps = { status: 'off', version: '', loaded: '', id: '' };
const dpsPanels = [null, null];
const hudRestored = [false, false];
const hudBusy = [false, false];
const lastFps = [null, null];
const lastMuted = [null, null];
let credentials = [null, null];
let credAvailable = false;
let credBackend = '';
let credInsecure = false;
const credWatch = [null, null];
const credBusy = [false, false];
let prefs = { names: ['Conta 1', 'Conta 2'], zoom: [0.8, 0.8], muted: [false, true],
  colors: [COLORS[0], COLORS[1]], icons: [ICONS[0], ICONS[1]],
  mode: 'dual', split: 'dual', ratio: { x: 0.5, y: 0.5 }, compact: false, bounds: null, maximized: false,
  lang: null, usage: false, confirmClose: true, updates: true, skipVersion: '', pipBounds: null,
  perf: { ...PERF_DEFAULTS }, autoReload: { on: false, value: 2, unit: 'h' }, dps: { on: true, hud: [false, false] } };
const states = [{ status: 'st_opening' }, { status: 'st_opening' }];
const t = key => (I18N[prefs.lang] || I18N.pt)[key] || I18N.pt[key] || key;
function prefsFile() { return path.join(app.getPath('userData'), 'preferences.json'); }
function loadPrefs() {
  try {
    const saved = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    for (let i = 0; i < 2; i++) {
      if (typeof saved.names?.[i] === 'string') prefs.names[i] = saved.names[i].slice(0, 24);
      if (Number.isFinite(saved.zoom?.[i])) prefs.zoom[i] = Math.max(0.5, Math.min(1.5, saved.zoom[i]));
      if (typeof saved.muted?.[i] === 'boolean') prefs.muted[i] = saved.muted[i];
      if (COLORS.includes(saved.colors?.[i])) prefs.colors[i] = saved.colors[i];
      if (ICONS.includes(saved.icons?.[i])) prefs.icons[i] = saved.icons[i];
    }
    if (MODES.includes(saved.mode)) prefs.mode = saved.mode;
    if (['dual', 'stack'].includes(saved.split)) prefs.split = saved.split;
    for (const k of ['x', 'y']) if (Number.isFinite(saved.ratio?.[k])) prefs.ratio[k] = Math.max(0.15, Math.min(0.85, saved.ratio[k]));
    if (LANGS.includes(saved.lang)) prefs.lang = saved.lang;
    for (const k of ['compact', 'maximized', 'usage']) prefs[k] = saved[k] === true;
    for (const k of ['confirmClose', 'updates']) prefs[k] = saved[k] !== false;
    prefs.autoReload = cleanAutoReload(saved.autoReload);
    if (saved.dps && typeof saved.dps === 'object') {
      if (typeof saved.dps.on === 'boolean') prefs.dps.on = saved.dps.on;
      for (let i = 0; i < 2; i++) prefs.dps.hud[i] = saved.dps.hud?.[i] === true;
    }
    if (typeof saved.skipVersion === 'string') prefs.skipVersion = saved.skipVersion.slice(0, 20);
    const okBounds = b => b && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(b[k]));
    if (okBounds(saved.bounds)) prefs.bounds = saved.bounds;
    if (okBounds(saved.pipBounds)) prefs.pipBounds = saved.pipBounds;
    if (saved.perf && typeof saved.perf === 'object') {
      if (typeof saved.perf.enabled === 'boolean') prefs.perf.enabled = saved.perf.enabled;
      if (typeof saved.perf.muteBg === 'boolean') prefs.perf.muteBg = saved.perf.muteBg;
      if (typeof saved.perf.pauseHidden === 'boolean') prefs.perf.pauseHidden = saved.perf.pauseHidden;
      prefs.perf.fgFps = normalizeFps(saved.perf.fgFps, PERF_DEFAULTS.fgFps, FPS_FOREGROUND);
      prefs.perf.bgFps = normalizeFps(saved.perf.bgFps, PERF_DEFAULTS.bgFps, FPS_BACKGROUND);
    }
  } catch {  }
  if (process.env.LD_PERF !== undefined) prefs.perf.enabled = process.env.LD_PERF !== '0';
  if (process.env.LD_FG_FPS !== undefined) prefs.perf.fgFps = normalizeFps(process.env.LD_FG_FPS, PERF_DEFAULTS.fgFps, FPS_FOREGROUND);
  if (process.env.LD_BG_FPS !== undefined) prefs.perf.bgFps = normalizeFps(process.env.LD_BG_FPS, PERF_DEFAULTS.bgFps, FPS_BACKGROUND);
  if (!prefs.lang) {
    const locale = String(app.getLocale?.() || 'pt').toLowerCase();
    prefs.lang = locale.startsWith('es') ? 'es' : locale.startsWith('en') ? 'en' : 'pt';
  }
}
function savePrefs() {
  try {
    fs.writeFileSync(prefsFile() + '.tmp', JSON.stringify(prefs, null, 2));
    fs.renameSync(prefsFile() + '.tmp', prefsFile());
  } catch {  }
}
function credFile() { return path.join(app.getPath('userData'), 'credentials.bin'); }
function initCredentials() {
  credAvailable = false;
  credBackend = '';
  credInsecure = false;
  try {
    credAvailable = Boolean(safeStorage?.isEncryptionAvailable?.());
    if (!credAvailable && process.platform === 'linux' && safeStorage?.setUsePlainTextEncryption) {
      safeStorage.setUsePlainTextEncryption(true);
      credAvailable = Boolean(safeStorage.isEncryptionAvailable());
      if (credAvailable) { credBackend = 'basic_text'; credInsecure = true; }
    }
    if (credAvailable && process.platform === 'linux') {
      const backend = String(safeStorage.getSelectedStorageBackend?.() || '');
      credBackend = backend || credBackend || 'unknown';
      credInsecure = credInsecure || !backend || backend === 'basic_text';
    } else if (credAvailable) {
      credBackend = process.platform === 'darwin' ? 'keychain' : process.platform === 'win32' ? 'dpapi' : 'secret-service';
    }
  } catch { credAvailable = false; }
  if (process.env.LD_CREDS_DEBUG) console.log('[creds]', { credAvailable, credBackend, credInsecure });
  if (!credAvailable) { credentials = [null, null]; return; }
  try {
    const raw = fs.readFileSync(credFile());
    const data = JSON.parse(safeStorage.decryptString(raw));
    for (let i = 0; i < 2; i++) {
      const item = data?.[i];
      if (item && typeof item.user === 'string' && typeof item.pass === 'string' && item.user && item.pass) {
        credentials[i] = { user: item.user.slice(0, 16), pass: item.pass.slice(0, 128), auto: item.auto !== false };
      }
    }
  } catch {  }
}
function saveCredentials() {
  if (!credAvailable) return false;
  try {
    if (!credentials[0] && !credentials[1]) {
      fs.rmSync(credFile(), { force: true });
      return true;
    }
    const payload = JSON.stringify({ 0: credentials[0], 1: credentials[1] });
    const encrypted = safeStorage.encryptString(payload);
    const tmp = credFile() + '.tmp';
    fs.writeFileSync(tmp, encrypted, { mode: 0o600 });
    fs.renameSync(tmp, credFile());
    try { fs.chmodSync(credFile(), 0o600); } catch {  }
    return true;
  } catch { return false; }
}
function applyCredentials(i) {
  const cred = credentials[i];
  if (!cred || !cred.user || !cred.pass) return;
  const wc = views[i]?.webContents;
  if (!wc || wc.isDestroyed?.()) return;
  Promise.resolve(wc.executeJavaScript(buildCredScript(cred))).catch(() => {});
}
function installCapture(wc) {
  if (!wc || wc.isDestroyed?.()) return;
  Promise.resolve(wc.executeJavaScript(buildCaptureScript())).catch(() => {});
}
function handleCapturedCredentials(i, capture) {
  const user = String(capture.user || '').trim().slice(0, 16);
  const pass = String(capture.pass || '').slice(0, 128);
  if (!credAvailable || !/^[A-Za-z0-9_-]{3,16}$/.test(user) || !pass) return;
  if (!main || main.isDestroyed() || !main.isFocused()) return;
  const existing = credentials[i];
  if (existing && existing.user === user && existing.pass === pass) return;
  const name = prefs.names[i] || `Conta ${i + 1}`;
  const update = Boolean(existing);
  dialog.showMessageBox(main, {
    type: 'question',
    title: update ? t('cred_prompt_update_title') : t('cred_prompt_title'),
    message: `${name} (${user})`,
    detail: `${update ? t('cred_prompt_update_message') : t('cred_prompt_message')}\n\n${t('cred_prompt_detail')}`,
    buttons: [t('cred_prompt_save'), t('cred_prompt_not_now')],
    defaultId: 0, cancelId: 1, noLink: true,
    checkboxLabel: t('cred_auto'), checkboxChecked: existing ? existing.auto !== false : true
  }).then(({ response, checkboxChecked }) => {
    if (response !== 0 || !main || main.isDestroyed()) return;
    const previous = credentials[i];
    credentials[i] = { user, pass, auto: checkboxChecked };
    if (!saveCredentials()) credentials[i] = previous;
    sendState();
  }).catch(() => {});
}
function startCredWatch(i) {
  if (credWatch[i]) return;
  credWatch[i] = setInterval(async () => {
    if (credBusy[i]) return;
    credBusy[i] = true;
    try {
      const wc = views[i]?.webContents;
      if (!wc || wc.isDestroyed?.()) return;
      const capture = await wc.executeJavaScript('window.__LD_CRED_CAPTURE__ || null');
      if (!capture || !capture.user || !capture.pass) return;
      if (!credAvailable) { await wc.executeJavaScript('window.__LD_CRED_CAPTURE__ = null'); return; }
      if (!main || main.isDestroyed() || !main.isFocused()) return;
      await wc.executeJavaScript('window.__LD_CRED_CAPTURE__ = null');
      handleCapturedCredentials(i, capture);
    } catch {  }
    finally { credBusy[i] = false; }
  }, 1000);
}
function sendState() {
  if (!main || main.isDestroyed()) return;
  const state = { mode: prefs.mode, compact: prefs.compact, focused, dragging, layout: current,
    lang: prefs.lang, pip: pip ? pip.index : -1, usage: prefs.usage, confirmClose: prefs.confirmClose, updates: prefs.updates, autoReload: prefs.autoReload,
    perfEnabled: prefs.perf.enabled, perfMuteBg: prefs.perf.muteBg, perfPauseHidden: prefs.perf.pauseHidden,
    perfFg: prefs.perf.fgFps, perfBg: prefs.perf.bgFps, perfPauseHiddenActive: STARTUP_PERF.pauseHidden,
    credAvailable, credBackend, credInsecure,
    dpsEnabled: prefs.dps.on,
    dps: { on: prefs.dps.on, status: dps.status, version: dps.loaded || dps.version, hud: [...prefs.dps.hud] },
    credentials: credentials.map(c => c ? { has: true, user: c.user, auto: c.auto !== false } : { has: false, user: '', auto: true }),
    update, version: app.getVersion?.() || '', choices: { colors: COLORS, icons: ICONS },
    accounts: states.map((s, i) => ({ status: s.status, usage: prefs.usage ? s.usage || null : null, name: prefs.names[i],
      zoom: Math.round(prefs.zoom[i] * 100), muted: prefs.muted[i], color: prefs.colors[i], icon: prefs.icons[i] })) };
  main.webContents.send('dual:state', state);
  if (pip && !pip.win.isDestroyed()) pip.win.webContents.send('dual:state', state);
}
function isViewVisible(i) {
  if (pip && pip.index === i) return true;
  return Boolean(current?.views?.[i]) && !dragging && !overlay;
}
function setViewFps(i, fps) {
  const wc = views[i]?.webContents;
  if (!wc || wc.isDestroyed?.()) return;
  if (lastFps[i] === fps) return;
  lastFps[i] = fps;
  Promise.resolve(wc.executeJavaScript(`window.__LD_SET_FPS ? window.__LD_SET_FPS(${fps}) : (window.__LD_FPS = ${fps})`))
    .catch(() => { lastFps[i] = null; });
}
function setViewMuted(i, muted) {
  const wc = views[i]?.webContents;
  if (!wc || wc.isDestroyed?.()) return;
  if (lastMuted[i] === muted) return;
  lastMuted[i] = muted;
  wc.setAudioMuted(muted);
}
function applyPerf() {
  if (!main || main.isDestroyed()) return;
  const perf = prefs.perf;
  for (let i = 0; i < views.length; i++) {
    const host = pip && pip.index === i ? pip.win : main;
    if (!host || host.isDestroyed()) continue;
    const minimized = host.isMinimized();
    const hidden = !host.isVisible();
    const hostFocused = Boolean(host.isFocused() && !minimized && !hidden && !locked);
    const foreground = fpsForView({ enabled: perf.enabled, foreground: perf.fgFps, background: perf.bgFps,
      focused: hostFocused, visible: isViewVisible(i), minimized, locked, hidden });
    setViewFps(i, foreground);
    setViewMuted(i, prefs.muted[i] || (foreground !== perf.fgFps && perf.muteBg));
  }
}
function schedulePerf(delay = 0) {
  clearTimeout(perfTimer);
  perfTimer = setTimeout(() => { perfTimer = null; applyPerf(); }, delay);
}
function layout() {
  if (!main || main.isDestroyed()) return;
  const [w, h] = main.getContentSize();
  current = getLayout(w, h, prefs.mode, { ratio: prefs.ratio, compact: prefs.compact });
  current.views.forEach((rect, i) => {
    if (!views[i] || (pip && pip.index === i)) return;
    if (rect) views[i].setBounds(rect);
    views[i].setVisible(Boolean(rect) && !dragging && !overlay);
  });
  applyPerf();
  sendState();
}
function setMode(value) {
  if (!MODES.includes(value)) return;
  prefs.mode = value;
  if (value === 'dual' || value === 'stack') prefs.split = value;
  layout();
  if (value === 'one') focusAccount(0);
  if (value === 'two') focusAccount(1);
}
function focusAccount(i) {
  if (!views[i]) return;
  focused = i;
  views[i].webContents.focus();
  schedulePerf(0);
  sendState();
}
function setZoom(i, delta) {
  prefs.zoom[i] = delta === 0 ? 0.8 : Math.round(Math.max(0.5, Math.min(1.5, prefs.zoom[i] + delta * 0.1)) * 100) / 100;
  views[i].webContents.setZoomFactor(prefs.zoom[i]);
}
function toggleMute(i) {
  prefs.muted[i] = !prefs.muted[i];
  views[i].webContents.setAudioMuted(prefs.muted[i]);
  lastMuted[i] = prefs.muted[i];
}
function fitPip() {
  if (!pip || pip.win.isDestroyed()) return;
  const [w, h] = pip.win.getContentSize();
  const view = views[pip.index];
  view.setBounds({ x: 0, y: PIP_HEAD, width: Math.max(1, w), height: Math.max(1, h - PIP_HEAD) });
  view.setVisible(true);
}
function openPip(i = focused) {
  if (pip || !main || !views[i]) return;
  const bounds = prefs.pipBounds && screen.getDisplayMatching(prefs.pipBounds) ? prefs.pipBounds : { width: 520, height: 360 };
  const win = new BrowserWindow({ ...bounds, minWidth: 280, minHeight: 200, frame: false, alwaysOnTop: true, fullscreenable: false,
    title: 'Leveling Dual', backgroundColor: '#0b0f17', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.setAlwaysOnTop(true, 'floating');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('before-input-event', handleShortcut);
  win.webContents.on('did-finish-load', sendState);
  main.contentView.removeChildView(views[i]);
  win.contentView.addChildView(views[i]);
  pip = { win, index: i };
  win.loadFile(PIP_FILE);
  fitPip();
  win.on('resize', fitPip);
  const remember = () => { if (!win.isDestroyed()) { prefs.pipBounds = win.getBounds(); savePrefs(); } };
  win.on('resized', remember); win.on('moved', remember);
  win.on('closed', () => { if (pip && pip.win === win) closePip(); });
  for (const event of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide']) {
    win.on(event, () => schedulePerf(event === 'blur' ? 1500 : 0));
  }
  focusAccount(i);
  main.minimize();
  layout();
}
function closePip() {
  if (!pip) return;
  const { win, index } = pip;
  pip = null;
  if (!win.isDestroyed()) {
    win.contentView.removeChildView(views[index]);
    win.close();
  }
  if (main && !main.isDestroyed()) {
    main.contentView.addChildView(views[index]);
    if (main.isMinimized()) main.restore();
    main.show();
  }
  layout();
}
function swapPip() {
  if (!pip) return;
  const from = pip.index, to = 1 - from;
  pip.win.contentView.removeChildView(views[from]);
  main.contentView.addChildView(views[from]);
  main.contentView.removeChildView(views[to]);
  pip.win.contentView.addChildView(views[to]);
  pip.index = to;
  fitPip();
  focusAccount(to);
  layout();
}
function togglePip() { if (pip) closePip(); else openPip(); }
async function readUsage() {
  const metrics = app.getAppMetrics?.() || [];
  const fps = await Promise.all(views.map(v => Promise.resolve(
    v.webContents.executeJavaScript('window.__LD_FPS_ACTUAL || 0')).catch(() => 0)));
  views.forEach((v, i) => {
    const m = metrics.find(p => p.pid === v.webContents.getOSProcessId?.());
    const base = m ? { cpu: Math.round(m.cpu?.percentCPUUsage || 0), mem: Math.round((m.memory?.workingSetSize || 0) / 1024) } : { cpu: 0, mem: 0 };
    states[i].usage = { ...base, fps: Math.round(Number(fps[i]) || 0) };
  });
  sendState();
}
function cleanAutoReload(v) {
  const unit = v?.unit === 'min' ? 'min' : 'h';
  const max = unit === 'h' ? 48 : 48 * 60, min = unit === 'h' ? 1 : 5;
  const value = Number.isFinite(+v?.value) ? Math.min(max, Math.max(min, Math.round(+v.value))) : (unit === 'h' ? 2 : 120);
  return { on: v?.on === true, value, unit };
}
function setupAutoReload() {
  clearInterval(autoReloadTimer);
  clearTimeout(autoReloadSecond);
  autoReloadTimer = autoReloadSecond = undefined;
  if (!prefs.autoReload.on) return;
  const minutes = prefs.autoReload.unit === 'h' ? prefs.autoReload.value * 60 : prefs.autoReload.value;
  autoReloadTimer = setInterval(() => {
    loadGame(0);
    clearTimeout(autoReloadSecond);
    autoReloadSecond = setTimeout(() => loadGame(1), 20000);
  }, minutes * 60000);
}
function setUsage(value) {
  prefs.usage = value;
  clearInterval(usageTimer);
  usageTimer = undefined;
  if (value) { readUsage(); usageTimer = setInterval(readUsage, 2000); }
}
const PLATFORM = IS_MAC ? 'macos' : IS_LINUX ? 'linux' : 'windows';
const PLATFORM_ASSET = { windows: /windows|^leveling-dual\.zip$/i, macos: /mac/i, linux: /linux/i }[PLATFORM];
const VERSION_RE = /^v?\d+\.\d+\.\d+$/;
function newer(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[.-]/).map(Number), pb = String(b).replace(/^v/i, '').split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y; }
  return false;
}
async function platformVersion(release) {
  const file = (release.assets || []).find(a => a.name === 'versoes.json');
  if (!file) return (release.assets || []).some(a => PLATFORM_ASSET.test(a.name)) ? release.tag_name : null;
  const url = String(file.browser_download_url || '');
  if (!url.startsWith(RELEASES_PAGE + '/download/')) return null;
  const r = await fetch(url, { headers: { 'User-Agent': 'LevelingDual' } });
  if (!r.ok) return null;
  const text = await r.text();
  if (text.length > 10000) return null;
  const version = JSON.parse(text)?.[PLATFORM];
  return typeof version === 'string' && VERSION_RE.test(version.trim()) ? version.trim() : null;
}
async function checkUpdates() {
  if (!prefs.updates || SHOT || typeof fetch !== 'function') return;
  try {
    const r = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LevelingDual' } });
    if (!r.ok) return;
    const best = (await r.json()).filter(rel => !rel.draft && /^v?\d+\.\d+/.test(rel.tag_name || ''))
      .reduce((top, rel) => (!top || newer(rel.tag_name, top.tag_name) ? rel : top), null);
    if (!best) return;
    const version = await platformVersion(best);
    if (!version || !newer(version, app.getVersion())) return;
    const tag = 'v' + version.replace(/^v/i, '');
    if (tag === prefs.skipVersion) return;
    const url = String(best.html_url || '').startsWith(RELEASES_PAGE + '/') ? best.html_url : RELEASES_PAGE;
    update = { version: tag.slice(1), tag, url };
    sendState();
  } catch {  }
}
// ---------- Medidor de DPS (extensão DPS Meter Lite, por ds_, baixada da Chrome Web Store) ----------
const dpsBase = () => path.join(app.getPath('userData'), 'extensions');
const accountSession = i => session.fromPartition(`persist:leveling-account-${i + 1}`);
const extApi = ses => ses.extensions || ses;
// Extensão carregada de pasta ganha um id derivado do caminho, por isso o id usado é o que o Electron devolve.
function removeDpsFrom(api) {
  try {
    for (const ext of api.getAllExtensions?.() || []) {
      if (ext.id === dps.id || String(ext.path || '').includes(DPS.DPS_ID)) api.removeExtension(ext.id);
    }
  } catch {  }
}
async function loadDpsInto(dir, version) {
  let id = '';
  for (let i = 0; i < 2; i++) {
    const api = extApi(accountSession(i));
    removeDpsFrom(api);
    const ext = await api.loadExtension(dir, { allowFileAccess: false });
    id = ext?.id || id;
  }
  dps.id = id;
  dps.loaded = version;
}
function unloadDps() {
  for (let i = 0; i < 2; i++) removeDpsFrom(extApi(accountSession(i)));
  dps.loaded = '';
  dps.id = '';
  for (let i = 0; i < 2; i++) closeDpsPanel(i);
}
// Na abertura do app: carrega a versão já baixada antes das páginas do jogo abrirem.
async function loadInstalledDps() {
  if (!prefs.dps.on || process.env.LD_NO_DPS) { dps.status = 'off'; return; }
  const local = DPS.installedDir(dpsBase());
  if (!local) { dps.status = 'downloading'; return; }
  try { await loadDpsInto(local.dir, local.version); dps.status = 'ready'; dps.version = local.version; }
  catch (err) { dps.status = 'error'; if (process.env.LD_DPS_DEBUG) console.log('[dps] load', err); }
}
// Procura versão nova na loja. Na primeira instalação recarrega as contas para a extensão entrar.
function refreshDps() {
  if (dpsBusy) return dpsBusy;
  dpsBusy = (async () => {
    if (!prefs.dps.on || process.env.LD_NO_DPS || typeof fetch !== 'function') return;
    const hadLoaded = Boolean(dps.loaded);
    if (!hadLoaded) { dps.status = 'downloading'; sendState(); }
    try {
      const result = await DPS.downloadAndInstall(dpsBase(), fetch);
      if (!prefs.dps.on) return;
      dps.version = result.version;
      if (result.updated || !hadLoaded) {
        await loadDpsInto(result.dir, result.version);
        DPS.pruneOld(dpsBase(), result.version);
        if (!hadLoaded) { loadGame(0); loadGame(1); }
      }
      dps.status = 'ready';
    } catch (err) {
      if (process.env.LD_DPS_DEBUG) console.log('[dps] refresh', err);
      if (!dps.loaded) dps.status = 'error';
    } finally { sendState(); }
  })().finally(() => { dpsBusy = null; });
  return dpsBusy;
}
async function setDpsEnabled(on) {
  prefs.dps.on = on;
  savePrefs();
  if (!on) { unloadDps(); dps.status = 'off'; sendState(); loadGame(0); loadGame(1); return; }
  await loadInstalledDps();
  sendState();
  if (dps.loaded) { loadGame(0); loadGame(1); refreshDps(); }
  else refreshDps();
}
async function runHud(i, script) {
  const wc = views[i]?.webContents;
  if (!wc || wc.isDestroyed?.()) return null;
  try { return await wc.executeJavaScript(script); } catch { return null; }
}
async function toggleHud(i) {
  if (!dps.loaded) return;
  const visible = await runHud(i, DPS.hudCommandScript('toggleInGameHud'));
  if (visible === null) return;
  hudRestored[i] = true;
  prefs.dps.hud[i] = visible === true;
  savePrefs(); sendState();
}
// Mantém o botão DPS em dia (o HUD tem botão de fechar próprio) e reabre o HUD depois de recarregar.
async function pollHud() {
  if (!dps.loaded) return;
  let changed = false;
  for (let i = 0; i < views.length; i++) {
    if (hudBusy[i]) continue;
    hudBusy[i] = true;
    try {
      const visible = await runHud(i, DPS.HUD_STATE_SCRIPT);
      if (visible === null) continue;
      if (!hudRestored[i]) {
        hudRestored[i] = true;
        if (prefs.dps.hud[i] && !visible) await runHud(i, DPS.hudCommandScript('toggleInGameHud'));
        continue;
      }
      if (prefs.dps.hud[i] !== visible) { prefs.dps.hud[i] = visible; changed = true; }
    } finally { hudBusy[i] = false; }
  }
  if (changed) { savePrefs(); sendState(); }
}
function closeDpsPanel(i) {
  const win = dpsPanels[i];
  dpsPanels[i] = null;
  if (win && !win.isDestroyed()) win.close();
}
// Painel completo da extensão (o mesmo do ícone no Chrome), ligado à sessão da conta.
function openDpsPanel(i) {
  if (!dps.loaded || !dps.id || !main) return;
  const existing = dpsPanels[i];
  if (existing && !existing.isDestroyed()) { existing.focus(); return; }
  const win = new BrowserWindow({ width: 420, height: 640, minWidth: 320, minHeight: 300, parent: main, autoHideMenuBar: true,
    title: `DPS · ${prefs.names[i] || `Conta ${i + 1}`}`, backgroundColor: '#0b0f17', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { partition: `persist:leveling-account-${i + 1}`, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const base = `chrome-extension://${dps.id}/`;
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(base)) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (isWebUrl(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('page-title-updated', event => event.preventDefault());
  win.on('closed', () => { if (dpsPanels[i] === win) dpsPanels[i] = null; });
  dpsPanels[i] = win;
  win.loadURL(base + 'popup.html').catch(() => {});
}
function hardened(partition) {
  return { partition, nodeIntegration: false, contextIsolation: true, sandbox: true,
    webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false,
    navigateOnDragDrop: false, webviewTag: false, safeDialogs: true };
}
function guardNavigation(wc) {
  wc.on('will-navigate', (event, url) => { if (!isGameUrl(url)) event.preventDefault(); });
  wc.on('will-redirect', (event, url) => { if (!isGameUrl(url)) event.preventDefault(); });
  wc.on('will-attach-webview', event => event.preventDefault());
}
function installLimiterNow(wc) {
  if (!wc || wc.isDestroyed?.()) return Promise.resolve();
  return Promise.resolve(wc.executeJavaScript(LIMITER_SOURCE)).catch(() => {});
}
async function loadGame(i) {
  try { await views[i].webContents.loadURL(GAME_URL); }
  catch {  }
}
function handleShortcut(event, input) {
  if (input.type !== 'keyDown') return;
  const key = String(input.key || '').toLowerCase();
  const ctrl = input.control || input.meta;
  const digit = /^(?:Digit|Numpad)([12])$/.exec(String(input.code || ''));
  const n = digit ? Number(digit[1]) - 1 : -1;
  let done = true;
  if (key === 'f11') main.setFullScreen(!main.isFullScreen());
  else if (ctrl && input.shift && key === 'r') { loadGame(0); loadGame(1); }
  else if (key === 'f5' || (ctrl && key === 'r')) loadGame(focused);
  else if (ctrl && n >= 0 && !input.shift) focusAccount(n);
  else if (ctrl && n >= 0 && input.shift) setMode(prefs.mode === (n ? 'two' : 'one') ? prefs.split : (n ? 'two' : 'one'));
  else if (ctrl && key === 'tab') focusAccount(focused ? 0 : 1);
  else if (ctrl && key === 'm') toggleMute(focused);
  else if (ctrl && (key === '=' || key === '+')) setZoom(focused, 1);
  else if (ctrl && key === '-') setZoom(focused, -1);
  else if (ctrl && key === '0') setZoom(focused, 0);
  else if (ctrl && key === 'b') { prefs.compact = !prefs.compact; layout(); }
  else if (ctrl && key === 'p') togglePip();
  else if (key === 'escape' && pip && BrowserWindow.getFocusedWindow?.() === pip.win) closePip();
  else if (key === 'escape' && (prefs.mode === 'one' || prefs.mode === 'two')) setMode(prefs.split);
  else done = false;
  if (done) { event.preventDefault(); savePrefs(); sendState(); }
}
function createAccount(i) {
  const partition = `persist:leveling-account-${i + 1}`;
  const view = new WebContentsView({ webPreferences: hardened(partition) });
  const wc = view.webContents;
  view.setBackgroundColor('#0b0f17');
  wc.setAudioMuted(prefs.muted[i]);
  guardNavigation(wc);
  wc.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  wc.session.setPermissionCheckHandler(() => false);
  wc.setWindowOpenHandler(({ url }) => {
    if (isGameUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 1000, height: 760, autoHideMenuBar: true, webPreferences: hardened(partition) } };
    if (isWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', child => {
    const childWc = child.webContents;
    guardNavigation(childWc);
    childWc.setWindowOpenHandler(() => ({ action: 'deny' }));
    childWc.on('dom-ready', () => installLimiterNow(childWc));
    childWc.on('did-finish-load', () => installLimiterNow(childWc)
      .then(() => childWc.executeJavaScript(`window.__LD_SET_FPS && window.__LD_SET_FPS(${prefs.perf.fgFps})`))
      .catch(() => {}));
  });
  wc.on('dom-ready', () => {
    installLimiterNow(wc).then(() => { lastFps[i] = null; schedulePerf(0); });
    installCapture(wc);
    startCredWatch(i);
    applyCredentials(i);
    sendState();
  });
  wc.on('did-start-loading', () => { hudRestored[i] = false; states[i].status = 'st_loading'; sendState(); });
  wc.on('did-stop-loading', () => {
    if (states[i].status === 'st_loading') states[i].status = 'st_open';
    sendState();
  });
  wc.on('did-finish-load', () => {
    installLimiterNow(wc).then(() => { lastFps[i] = null; schedulePerf(0); });
    installCapture(wc);
    startCredWatch(i);
    applyCredentials(i);
    wc.setZoomFactor(prefs.zoom[i]);
    lastMuted[i] = null;
    states[i].status = 'st_open'; sendState();
  });
  wc.on('did-fail-load', (_event, code, _text, _url, isMainFrame) => {
    if (code === -3 || !isMainFrame) return;
    states[i].status = 'st_failed'; sendState();
  });
  wc.on('render-process-gone', () => { lastFps[i] = null; lastMuted[i] = null; states[i].status = 'st_crashed'; sendState(); });
  wc.on('unresponsive', () => { states[i].status = 'st_frozen'; sendState(); });
  wc.on('responsive', () => { states[i].status = 'st_open'; sendState(); });
  wc.on('focus', () => { if (focused !== i) { focused = i; } schedulePerf(0); sendState(); });
  wc.on('before-input-event', handleShortcut);
  main.contentView.addChildView(view);
  return view;
}
async function closeApp() {
  saving = true;
  savePrefs();
  await Promise.allSettled(views.map(v => v.webContents.session.cookies.flushStore()));
  main.close();
}
function defaultBounds() {
  const area = screen.getPrimaryDisplay?.().workAreaSize;
  return {
    width: area ? Math.max(1000, Math.min(1600, area.width - 40)) : 1600,
    height: area ? Math.max(650, Math.min(950, area.height - 40)) : 950
  };
}
function createWindow() {
  loadPrefs();
  initCredentials();
  const bounds = prefs.bounds && screen.getDisplayMatching(prefs.bounds) ? prefs.bounds : defaultBounds();
  main = new BrowserWindow({ ...bounds, minWidth: 1000, minHeight: 650,
    title: 'Leveling Dual', backgroundColor: '#0b0f17', autoHideMenuBar: true, show: !SHOT, icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  if (SHOT) main.showInactive();
  else if (prefs.maximized) main.maximize();
  main.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  main.webContents.on('will-navigate', event => event.preventDefault());
  main.webContents.on('before-input-event', handleShortcut);
  views = [createAccount(0), createAccount(1)];
  main.webContents.on('did-finish-load', sendState);
  main.loadFile(UI_FILE);
  main.on('resize', layout);
  for (const event of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide', 'enter-full-screen', 'leave-full-screen']) {
    main.on(event, () => schedulePerf(event === 'blur' ? 1500 : 0));
  }
  const lock = value => () => { locked = value; schedulePerf(0); };
  powerMonitor?.on?.('lock-screen', lock(true));
  powerMonitor?.on?.('unlock-screen', lock(false));
  powerMonitor?.on?.('suspend', lock(true));
  powerMonitor?.on?.('resume', lock(false));
  main.on('restore', () => { if (pip) closePip(); });
  const remember = () => {
    if (!main.isMaximized() && !main.isFullScreen()) prefs.bounds = main.getBounds();
    prefs.maximized = main.isMaximized();
    savePrefs();
  };
  main.on('resized', remember); main.on('moved', remember); main.on('maximize', remember); main.on('unmaximize', remember);
  main.on('close', event => {
    if (saving) return;
    event.preventDefault();
    if (!prefs.confirmClose) { closeApp(); return; }
    dialog.showMessageBox(main, { type: 'question', title: t('close_title'), message: t('close_message'), detail: t('close_detail'),
      buttons: [t('close_keep'), t('close_quit')], defaultId: 0, cancelId: 0, checkboxLabel: t('close_dont_ask') }).then(({ response, checkboxChecked }) => {
      if (response !== 1 || !main || main.isDestroyed()) return;
      if (checkboxChecked) prefs.confirmClose = false;
      closeApp();
    });
  });
  main.on('closed', () => {
    if (pip && !pip.win.isDestroyed()) pip.win.destroy();
    pip = null;
    for (const v of views) if (!v.webContents.isDestroyed()) v.webContents.close();
    views = []; main = null;
    clearInterval(usageTimer);
    clearTimeout(perfTimer);
    clearInterval(autoReloadTimer);
    clearTimeout(autoReloadSecond);
    clearInterval(dpsTimer);
    clearInterval(dpsPollTimer);
    for (let i = 0; i < 2; i++) closeDpsPanel(i);
    for (const timer of credWatch) clearInterval(timer);
    if (blocker !== undefined && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
    blocker = undefined;
  });
  blocker = powerSaveBlocker.start('prevent-app-suspension');
  layout();
  applyPerf();
  loadInstalledDps().finally(() => {
    if (!main) return;
    sendState();
    loadGame(0); loadGame(1);
    refreshDps();
  });
  dpsTimer = setInterval(refreshDps, 12 * 60 * 60 * 1000);
  dpsPollTimer = setInterval(pollHud, 2500);
  if (prefs.usage) setUsage(true);
  setupAutoReload();
  checkUpdates();
  setInterval(checkUpdates, 6 * 60 * 60 * 1000).unref?.();
}
ipcMain.handle('dual:command', async (event, message) => {
  if (!main || !message || typeof message !== 'object') return;
  if (pip && event.sender === pip.win.webContents && event.senderFrame?.url === PIP_URL) {
    if (message.action === 'state') sendState();
    if (message.action === 'pipSwap') swapPip();
    if (message.action === 'pipClose') closePip();
    return;
  }
  if (event.sender !== main.webContents || event.senderFrame?.url !== UI_URL) return;
  const { action, index, value } = message;
  if (action === 'state') { sendState(); return; }
  if (action === 'mode') { setMode(value); savePrefs(); return; }
  if (action === 'compact') { prefs.compact = !prefs.compact; layout(); savePrefs(); return; }
  if (action === 'center') { prefs.ratio = { x: 0.5, y: 0.5 }; layout(); savePrefs(); return; }
  if (action === 'overlay') { overlay = value === true; layout(); return; }
  if (action === 'reloadBoth') { loadGame(0); loadGame(1); return; }
  if (action === 'lang' && LANGS.includes(value)) { prefs.lang = value; savePrefs(); sendState(); return; }
  if (action === 'pip') { togglePip(); return; }
  if (action === 'autoReload') { prefs.autoReload = cleanAutoReload(value); setupAutoReload(); savePrefs(); sendState(); return; }
  if (action === 'usage') { setUsage(!prefs.usage); savePrefs(); sendState(); return; }
  if (action === 'dpsEnabled') { await setDpsEnabled(!prefs.dps.on); return; }
  if (action === 'dpsRetry') { refreshDps(); return; }
  if (action === 'dpsStore') { shell.openExternal(DPS.DPS_STORE); return; }
  if (action === 'credSave') {
    if (index !== 0 && index !== 1) return;
    if (!credAvailable) { sendState(); return; }
    const user = String(value?.user ?? '').trim().slice(0, 16);
    const pass = String(value?.pass ?? '').slice(0, 128);
    const auto = value?.auto !== false;
    const existing = credentials[index];
    if (!/^[A-Za-z0-9_-]{3,16}$/.test(user) || (!pass && !existing)) { sendState(); return; }
    const previous = existing;
    credentials[index] = { user, pass: pass || existing.pass, auto };
    if (saveCredentials()) applyCredentials(index);
    else credentials[index] = previous;
    sendState();
    return;
  }
  if (action === 'credClear') {
    if (index !== 0 && index !== 1) return;
    const previous = credentials[index];
    credentials[index] = null;
    if (!saveCredentials()) credentials[index] = previous;
    sendState();
    return;
  }
  if (action === 'credAuto') {
    if (index !== 0 && index !== 1) return;
    const existing = credentials[index];
    if (!existing) return;
    const previous = existing.auto;
    existing.auto = value === true;
    if (!saveCredentials()) existing.auto = previous;
    sendState();
    return;
  }
  if (action === 'perfEnabled') { prefs.perf.enabled = !prefs.perf.enabled; applyPerf(); savePrefs(); sendState(); return; }
  if (action === 'perfMuteBg') { prefs.perf.muteBg = !prefs.perf.muteBg; applyPerf(); savePrefs(); sendState(); return; }
  if (action === 'perfPauseHidden') { prefs.perf.pauseHidden = !prefs.perf.pauseHidden; savePrefs(); sendState(); return; }
  if (action === 'perfFg' && FPS_FOREGROUND.includes(Number(value))) { prefs.perf.fgFps = Number(value); applyPerf(); savePrefs(); sendState(); return; }
  if (action === 'perfBg' && FPS_BACKGROUND.includes(Number(value))) { prefs.perf.bgFps = Number(value); applyPerf(); savePrefs(); sendState(); return; }
  if (action === 'confirmClose') { prefs.confirmClose = !prefs.confirmClose; savePrefs(); sendState(); return; }
  if (action === 'updates') { prefs.updates = !prefs.updates; if (!prefs.updates) update = null; else checkUpdates(); savePrefs(); sendState(); return; }
  if (action === 'updateOpen') { if (update) shell.openExternal(update.url); return; }
  if (action === 'updateSkip') { if (update) prefs.skipVersion = update.tag; update = null; savePrefs(); sendState(); return; }
  if (action === 'dragStart') { dragging = Boolean(current?.divider); layout(); return; }
  if (action === 'dragMove') {
    if (!dragging || !Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
    prefs.ratio[current.divider.dir === 'v' ? 'x' : 'y'] = ratioFromPointer(current.divider, message.x, message.y);
    layout(); return;
  }
  if (action === 'dragEnd') { dragging = false; layout(); savePrefs(); return; }
  if (index !== 0 && index !== 1) return;
  const wc = views[index]?.webContents;
  if (!wc || wc.isDestroyed()) return;
  if (action === 'focus') { focusAccount(index); return; }
  if (action === 'pipOpen') { openPip(index); return; }
  if (action === 'dpsHud') { await toggleHud(index); return; }
  if (action === 'dpsPanel') { openDpsPanel(index); return; }
  if (action === 'expand') { const target = index ? 'two' : 'one'; setMode(prefs.mode === target ? prefs.split : target); savePrefs(); return; }
  if (action === 'reload') await loadGame(index);
  if (action === 'mute') toggleMute(index);
  if (action === 'zoom' && [-1, 1].includes(value)) setZoom(index, value);
  if (action === 'name' && typeof value === 'string') prefs.names[index] = value.trim().slice(0, 24) || `Conta ${index + 1}`;
  if (action === 'color' && COLORS.includes(value)) prefs.colors[index] = value;
  if (action === 'icon' && ICONS.includes(value)) prefs.icons[index] = value;
  savePrefs(); sendState();
});
async function shots() {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const shot = async (name, keepOverlay = false) => {
    const imgs = [];
    for (const [i, v] of views.entries()) if (current.views[i]) imgs.push({ r: current.views[i], src: (await v.webContents.capturePage()).toDataURL() });
    await main.webContents.executeJavaScript(`for (const { r, src } of ${JSON.stringify(imgs)}) {
      const img = document.createElement('img'); img.className = 'shot'; img.src = src;
      Object.assign(img.style, { position: 'fixed', left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' });
      document.body.prepend(img);
    } new Promise(ok => setTimeout(ok, 300));`);
    overlay = true; layout(); await wait(300);
    fs.writeFileSync(path.join(SHOT, name + '.png'), (await main.webContents.capturePage()).toPNG());
    await main.webContents.executeJavaScript("document.querySelectorAll('img.shot').forEach(e => e.remove())");
    overlay = keepOverlay; layout();
  };
  const ui = js => main.webContents.executeJavaScript(js);
  main.setContentSize(1600, 900);
  await wait(9000);
  prefs.usage = true; readUsage(); prefs.icons = ['🐉', '🔮']; prefs.colors = ['#3ccf91', '#f5a524'];
  update = { version: '1.2.0', tag: 'v1.2.0', url: RELEASES_PAGE }; sendState(); await wait(500);
  await shot('1-lado-a-lado');
  await ui("document.getElementById('options').click()"); await wait(600); await shot('2-opcoes', true);
  await ui("document.getElementById('options-close').click()"); await wait(300);
  prefs.lang = 'en'; setMode('stack'); await wait(3000); await shot('3-ingles-empilhado');
  prefs.lang = 'es'; setMode('dual'); prefs.compact = true; layout(); await wait(1500); await shot('4-espanhol-barra-escondida');
  saving = true; app.quit();
}
function installMenu() {
  if (!IS_MAC) { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ]));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (main) { if (main.isMinimized()) main.restore(); main.show(); main.focus(); } });
  app.whenReady().then(() => { installMenu(); createWindow(); if (SHOT) shots(); });
  app.on('window-all-closed', () => app.quit());
}
