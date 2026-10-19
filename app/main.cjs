'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, powerSaveBlocker, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { getLayout, ratioFromPointer, isGameUrl, isWebUrl } = require('./layout.cjs');
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
// Disables Chromium's optional timer throttling; never changes game logic.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
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
// O jogo permite no máximo 2 contas por pessoa: o aplicativo nunca abre uma terceira.
let prefs = { names: ['Conta 1', 'Conta 2'], zoom: [0.8, 0.8], muted: [false, true],
  colors: [COLORS[0], COLORS[1]], icons: [ICONS[0], ICONS[1]],
  mode: 'dual', split: 'dual', ratio: { x: 0.5, y: 0.5 }, compact: false, bounds: null, maximized: false,
  lang: null, usage: false, confirmClose: true, updates: true, skipVersion: '', pipBounds: null };
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
  } catch { /* First run uses defaults. */ }
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
function sendState() {
  if (!main || main.isDestroyed()) return;
  const state = { mode: prefs.mode, compact: prefs.compact, focused, dragging, layout: current,
    lang: prefs.lang, pip: pip ? pip.index : -1, usage: prefs.usage, confirmClose: prefs.confirmClose, updates: prefs.updates,
    update, version: app.getVersion?.() || '', choices: { colors: COLORS, icons: ICONS },
    accounts: states.map((s, i) => ({ status: s.status, usage: prefs.usage ? s.usage || null : null, name: prefs.names[i],
      zoom: Math.round(prefs.zoom[i] * 100), muted: prefs.muted[i], color: prefs.colors[i], icon: prefs.icons[i] })) };
  main.webContents.send('dual:state', state);
  if (pip && !pip.win.isDestroyed()) pip.win.webContents.send('dual:state', state);
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
  sendState();
}
function setZoom(i, delta) {
  prefs.zoom[i] = delta === 0 ? 0.8 : Math.round(Math.max(0.5, Math.min(1.5, prefs.zoom[i] + delta * 0.1)) * 100) / 100;
  views[i].webContents.setZoomFactor(prefs.zoom[i]);
}
function toggleMute(i) {
  prefs.muted[i] = !prefs.muted[i];
  views[i].webContents.setAudioMuted(prefs.muted[i]);
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
// Uso de CPU e memória de cada conta (só quando a opção está ligada).
function readUsage() {
  const metrics = app.getAppMetrics?.() || [];
  views.forEach((v, i) => {
    const m = metrics.find(p => p.pid === v.webContents.getOSProcessId?.());
    states[i].usage = m ? { cpu: Math.round(m.cpu?.percentCPUUsage || 0), mem: Math.round((m.memory?.workingSetSize || 0) / 1024) } : null;
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
    guardNavigation(child.webContents);
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  wc.on('did-start-loading', () => { states[i].status = 'st_loading'; sendState(); });
  wc.on('did-stop-loading', () => {
    if (states[i].status === 'st_loading') states[i].status = 'st_open';
    sendState();
  });
  wc.on('did-finish-load', () => {
    wc.setZoomFactor(prefs.zoom[i]);
    states[i].status = 'st_open'; sendState();
  });
  wc.on('did-fail-load', (_event, code, _text, _url, isMainFrame) => {
    if (code === -3 || !isMainFrame) return;
    states[i].status = 'st_failed'; sendState();
  });
  wc.on('render-process-gone', () => { states[i].status = 'st_crashed'; sendState(); });
  wc.on('unresponsive', () => { states[i].status = 'st_frozen'; sendState(); });
  wc.on('responsive', () => { states[i].status = 'st_open'; sendState(); });
  wc.on('focus', () => { if (focused !== i) { focused = i; sendState(); } });
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
    if (blocker !== undefined && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
    blocker = undefined;
  });
  blocker = powerSaveBlocker.start('prevent-app-suspension');
  layout();
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
