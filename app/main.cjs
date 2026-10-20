'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, powerSaveBlocker, powerMonitor, safeStorage, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { getLayout, ratioFromPointer, isGameUrl, isWebUrl } = require('./layout.cjs');
const { LIMITER_SOURCE, normalizeFps, fpsForView, FPS_FOREGROUND, FPS_BACKGROUND } = require('./perf.cjs');
const { buildCredScript, buildCaptureScript } = require('./creds.cjs');
const I18N = require('./i18n.js');

const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
const GAME_URL = 'https://levelingidle2d.com.br/jogar';
const RELEASES_API = 'https://api.github.com/repos/bruno220218/leveling-dual/releases?per_page=10';
const RELEASES_PAGE = 'https://github.com/bruno220218/leveling-dual/releases';
const UI_FILE = path.join(__dirname, 'index.html');
const UI_URL = pathToFileURL(UI_FILE).href;
const PIP_FILE = path.join(__dirname, 'pip.html');
const PIP_URL = pathToFileURL(PIP_FILE).href;
const PIP_HEAD = 30; // faixa de cima da janelinha (nome da conta e botões)
const MODES = ['dual', 'stack', 'one', 'two'];
const LANGS = ['pt', 'en', 'es'];
const COLORS = ['#409eec', '#8b7bff', '#3ccf91', '#f5a524', '#f25c7a', '#e5484d', '#f0d43a', '#38c7d8'];
const ICONS = ['⚔️', '🛡️', '🏹', '🔮', '🗡️', '👑', '🐉', '💀', '⭐', '🔥', '🌙', '💎'];
app.setName('Leveling Dual');
// Modo de teste (variável LD_SHOT): usa uma pasta temporária, salva prints da janela e fecha.
const SHOT = process.env.LD_SHOT || '';
if (SHOT) app.setPath('userData', path.join(SHOT, 'userdata'));
const PERF_DEFAULTS = { enabled: true, fgFps: 60, bgFps: 1, muteBg: true, pauseHidden: false };
// A opção "pausar quando escondido" muda switches do Chromium, então é lida
// antes do app ficar pronto. As demais opções são lidas em loadPrefs().
function readStartupPerf() {
  const out = { ...PERF_DEFAULTS };
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'preferences.json'), 'utf8'));
    if (typeof saved?.perf?.pauseHidden === 'boolean') out.pauseHidden = saved.perf.pauseHidden;
    if (typeof saved?.perf?.enabled === 'boolean') out.enabled = saved.perf.enabled;
  } catch { /* Primeira execução. */ }
  if (process.env.LD_PAUSE_HIDDEN !== undefined) out.pauseHidden = process.env.LD_PAUSE_HIDDEN === '1';
  if (process.env.LD_PERF !== undefined) out.enabled = process.env.LD_PERF !== '0';
  return out;
}
const STARTUP_PERF = readStartupPerf();
// Disables Chromium's optional timer throttling; never changes game logic.
app.commandLine.appendSwitch('disable-background-timer-throttling');
// A Fase 0b deixa o Chromium esconder/depriorizar a página quando minimizada.
// Fora dela, os switches mantêm o loop vivo para o limitador de FPS controlar.
if (!(STARTUP_PERF.enabled && STARTUP_PERF.pauseHidden)) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}
// Muitas VMs e servidores Linux bloqueiam WebGL por falta de GPU; libera o fallback por software.
if (IS_LINUX) {
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}
let main;
let views = [];
let blocker;
let saving = false;
let focused = 0;      // conta que recebe o teclado
let dragging = false; // divisória sendo arrastada (as páginas ficam escondidas)
let overlay = false;  // janela de atalhos/opções aberta (as páginas ficam escondidas)
let current = null;   // último layout calculado
let update = null;    // versão nova encontrada nas releases
let pip = null;       // janelinha flutuante: { win, index } (a conta mostrada sai da janela grande e vai para ela)
let usageTimer;
let perfTimer;
let locked = false;   // tela bloqueada/suspensa: tudo em FPS de segundo plano
const lastFps = [null, null];
const lastMuted = [null, null];
let credentials = [null, null];
let credAvailable = false;
let credBackend = '';
const credWatch = [null, null];
const credBusy = [false, false];
// O jogo permite no máximo 2 contas por pessoa: o aplicativo nunca abre uma terceira.
let prefs = { names: ['Conta 1', 'Conta 2'], zoom: [0.8, 0.8], muted: [false, true],
  colors: [COLORS[0], COLORS[1]], icons: [ICONS[0], ICONS[1]],
  mode: 'dual', split: 'dual', ratio: { x: 0.5, y: 0.5 }, compact: false, bounds: null, maximized: false,
  lang: null, usage: false, confirmClose: true, updates: true, skipVersion: '', pipBounds: null,
  perf: { ...PERF_DEFAULTS } };
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
  } catch { /* First run uses defaults. */ }
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
  } catch { /* The game sessions remain managed independently by Chromium. */ }
}
function credFile() { return path.join(app.getPath('userData'), 'credentials.bin'); }
// Credenciais ficam criptografadas pelo safeStorage (Keychain/DPAPI/libsecret).
// Nunca são gravadas em texto puro nem enviadas de volta para a interface.
function initCredentials() {
  credAvailable = false;
  credBackend = '';
  try {
    credAvailable = Boolean(safeStorage?.isEncryptionAvailable?.());
    if (credAvailable && process.platform === 'linux') {
      const backend = String(safeStorage.getSelectedStorageBackend?.() || '');
      if (!backend || backend === 'basic_text') credAvailable = false;
      else credBackend = backend;
    } else if (credAvailable) {
      credBackend = process.platform === 'darwin' ? 'keychain' : process.platform === 'win32' ? 'dpapi' : 'secret-service';
    }
  } catch { credAvailable = false; }
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
  } catch { /* Primeira vez ou chave antiga: o usuário digita de novo. */ }
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
    try { fs.chmodSync(credFile(), 0o600); } catch { /* Windows não usa chmod. */ }
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
  if (!credAvailable || !/^[a-z0-9_-]{3,16}$/.test(user) || !pass) return;
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
      // Se a janela perdeu o foco, mantém a captura para perguntar quando voltar.
      if (!main || main.isDestroyed() || !main.isFocused()) return;
      await wc.executeJavaScript('window.__LD_CRED_CAPTURE__ = null');
      handleCapturedCredentials(i, capture);
    } catch { /* página recarregando */ }
    finally { credBusy[i] = false; }
  }, 1000);
}
function sendState() {
  if (!main || main.isDestroyed()) return;
  const state = { mode: prefs.mode, compact: prefs.compact, focused, dragging, layout: current,
    lang: prefs.lang, pip: pip ? pip.index : -1, usage: prefs.usage, confirmClose: prefs.confirmClose, updates: prefs.updates,
    perfEnabled: prefs.perf.enabled, perfMuteBg: prefs.perf.muteBg, perfPauseHidden: prefs.perf.pauseHidden,
    perfFg: prefs.perf.fgFps, perfBg: prefs.perf.bgFps, perfPauseHiddenActive: STARTUP_PERF.pauseHidden,
    credAvailable, credBackend,
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
// Aplica o FPS/mudo de cada conta conforme a janela que a contém e o layout.
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
    if (!views[i] || (pip && pip.index === i)) return; // a conta da janelinha é arrumada por fitPip
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
// Janelinha flutuante: a conta escolhida vai para uma janela pequena por cima de tudo e a janela
// grande é minimizada. A outra conta continua rodando nela. A página não recarrega ao trocar de janela.
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
// Uso de CPU, memória e FPS real de cada conta (só quando a opção está ligada).
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
function setUsage(value) {
  prefs.usage = value;
  clearInterval(usageTimer);
  usageTimer = undefined;
  if (value) { readUsage(); usageTimer = setInterval(readUsage, 2000); }
}
// Aviso de versão nova: consulta as releases públicas do repositório do bruno. Não baixa nada sozinho.
function newer(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[.-]/).map(Number), pb = String(b).replace(/^v/i, '').split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y; }
  return false;
}
async function checkUpdates() {
  if (!prefs.updates || SHOT || typeof fetch !== 'function') return;
  try {
    const r = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LevelingDual' } });
    if (!r.ok) return;
    const best = (await r.json()).filter(rel => !rel.draft && /^v?\d+\.\d+/.test(rel.tag_name || ''))
      .reduce((top, rel) => (!top || newer(rel.tag_name, top.tag_name) ? rel : top), null);
    if (!best || !newer(best.tag_name, app.getVersion()) || best.tag_name === prefs.skipVersion) return;
    const url = String(best.html_url || '').startsWith(RELEASES_PAGE + '/') ? best.html_url : RELEASES_PAGE;
    update = { version: best.tag_name.replace(/^v/i, ''), tag: best.tag_name, url };
    sendState();
  } catch { /* Sem internet: tenta de novo mais tarde. */ }
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
// Instala o limitador na página já carregada. O Phaser chama
// window.requestAnimationFrame a cada frame, então a injeção tardia vale.
function installLimiterNow(wc) {
  if (!wc || wc.isDestroyed?.()) return Promise.resolve();
  return Promise.resolve(wc.executeJavaScript(LIMITER_SOURCE)).catch(() => {});
}
async function loadGame(i) {
  try { await views[i].webContents.loadURL(GAME_URL); }
  catch { /* did-fail-load displays the actionable status. */ }
}
// Atalhos com Ctrl (as teclas soltas continuam indo para o jogo).
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
  // A game popup keeps the account's session and remains sandboxed; outside links open in the browser.
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
    // Injeção tardia: cobre o caso em que o CDP não está disponível.
    installLimiterNow(wc).then(() => { lastFps[i] = null; schedulePerf(0); });
    installCapture(wc);
    startCredWatch(i);
    applyCredentials(i);
    sendState();
  });
  wc.on('did-start-loading', () => { states[i].status = 'st_loading'; sendState(); });
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
  // abrir a janela grande de novo traz a conta da janelinha de volta
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
    for (const timer of credWatch) clearInterval(timer);
    if (blocker !== undefined && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
    blocker = undefined;
  });
  blocker = powerSaveBlocker.start('prevent-app-suspension');
  layout();
  applyPerf();
  loadGame(0); loadGame(1);
  if (prefs.usage) setUsage(true);
  checkUpdates();
  setInterval(checkUpdates, 6 * 60 * 60 * 1000).unref?.();
}
ipcMain.handle('dual:command', async (event, message) => {
  if (!main || !message || typeof message !== 'object') return;
  // a janelinha só pode trocar de conta, voltar para a janela grande e pedir o estado
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
  if (action === 'usage') { setUsage(!prefs.usage); savePrefs(); sendState(); return; }
  if (action === 'credSave') {
    if (index !== 0 && index !== 1) return;
    if (!credAvailable) { sendState(); return; }
    const user = String(value?.user ?? '').trim().slice(0, 16);
    const pass = String(value?.pass ?? '').slice(0, 128);
    const auto = value?.auto !== false;
    const existing = credentials[index];
    if (!/^[a-z0-9_-]{3,16}$/.test(user) || (!pass && !existing)) { sendState(); return; }
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
  // As páginas ficam em views separadas: copia cada uma para dentro da interface e captura tudo junto.
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
  // No macOS o menu padrão mantém Cmd+C/V/Q e a tela cheia; nas demais plataformas a barra fica oculta.
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
