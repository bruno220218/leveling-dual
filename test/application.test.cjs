'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const appDir = path.join(__dirname, '..', 'app');
async function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leveling-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (options.prefs) fs.writeFileSync(path.join(dir, 'preferences.json'), JSON.stringify(options.prefs));
  const windows = [], views = [], handlers = new Map(), opened = [], dialogs = [], switches = [], intervals = [], delayed = [];
  class Contents extends EventEmitter {
    constructor(options) { super(); this.options = options; this.loads = []; this.messages = []; this.scripts = []; this.session = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, cookies: { flushStore: async () => {} } }; this.debugger = { attached: false, isAttached() { return this.attached; }, attach() { this.attached = true; }, async sendCommand() { return {}; } }; }
    send(channel, data) { this.messages.push({ channel, data }); }
    setWindowOpenHandler(handler) { this.openHandler = handler; }
    isDestroyed() { return false; }
    setZoomFactor(value) { this.zoom = value; }
    setAudioMuted(value) { this.muted = value; }
    async executeJavaScript(script) { this.scripts.push(script); return 0; }
    focus() { this.focused = true; }
    getOSProcessId() { return this.pid; }
    async loadURL(url) { this.loads.push(url); this.emit('did-start-loading'); this.emit('did-finish-load'); this.emit('did-stop-loading'); }
    close() {}
  }
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new Contents(options.webPreferences); this.children = new Set(); this.contentView = { addChildView: v => this.children.add(v), removeChildView: v => this.children.delete(v) }; this.minimized = false; this.visible = true; this.focused = true; windows.push(this); }
    loadFile() { this.webContents.emit('did-finish-load'); }
    getContentSize() { return this.options.frame === false ? [520, 360] : [1600, 950]; }
    isDestroyed() { return Boolean(this.destroyed); }
    minimize() { this.minimized = true; } restore() { this.minimized = false; this.emit('restore'); } isMinimized() { return Boolean(this.minimized); } isFocused() { return this.focused !== false; } isVisible() { return this.visible !== false; } show() { this.visible = true; } hide() { this.visible = false; } destroy() { this.destroyed = true; }
    showInactive() {} maximize() {} close() { this.closed = true; if (this.options.frame === false) { this.destroyed = true; this.emit('closed'); } } setAlwaysOnTop(value) { this.onTop = value; } isMaximized() { return false; } isFullScreen() { return false; }
    getBounds() { return { x: 0, y: 0, width: 1600, height: 950 }; }
  }
  class View {
    constructor(options) { this.options = options; this.webContents = new Contents(options.webPreferences); views.push(this); }
    setBackgroundColor() {}
    setBounds(rect) { this.bounds = rect; }
    setVisible(value) { this.visible = value; }
  }
  const app = new EventEmitter();
  Object.assign(app, { setName() {}, setPath() {}, getVersion: () => '1.1.0', getLocale: () => options.locale || 'pt-BR',
    getAppMetrics: () => views.map((v, i) => ({ pid: v.webContents.pid, cpu: { percentCPUUsage: 3.4 + i }, memory: { workingSetSize: 204800 * (i + 1) } })), commandLine: { appendSwitch: name => switches.push(name) }, getPath: () => dir, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), quit() {} });
  const powerMonitor = new EventEmitter();
  const extLog = [];
  const sessions = new Map();
  const session = { fromPartition: name => {
    if (!sessions.has(name)) {
      const loaded = new Map();
      sessions.set(name, { loaded, extensions: {
        loadExtension: async dir => { const e = { id: 'idlocal', path: dir }; loaded.set(e.id, e); extLog.push({ op: 'load', name, dir, loadsBefore: views.map(v => v.webContents.loads.length) }); return e; },
        getAllExtensions: () => [...loaded.values()], getExtension: id => loaded.get(id) || null,
        removeExtension: id => { loaded.delete(id); extLog.push({ op: 'remove', name }); } } });
    }
    return sessions.get(name);
  } };
  if (options.extVersion) {
    const extDir = path.join(dir, 'extensions', 'haiokinkfpmnjmmihpbemoohhkclkdop', options.extVersion);
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify({ version: options.extVersion }));
  }
  let plainText = false;
  const safeStorage = {
    isEncryptionAvailable: () => options.safeStorage !== false && (!options.plainTextOnly || plainText),
    getSelectedStorageBackend: () => options.backend || 'keychain',
    setUsePlainTextEncryption: value => { if (value) plainText = true; },
    encryptString: value => Buffer.from(Buffer.from(value, 'utf8').toString('base64')),
    decryptString: value => Buffer.from(value.toString(), 'base64').toString('utf8')
  };
  const electron = { app, BrowserWindow: Window, WebContentsView: View, powerMonitor, safeStorage, session,
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) }, Menu: { setApplicationMenu() {}, buildFromTemplate: template => template },
    dialog: { showMessageBox: async (_win, opts) => { dialogs.push(opts); return options.dialog || { response: 0 }; } }, screen: { getDisplayMatching: () => null },
    shell: { openExternal: url => opened.push(url) },
    powerSaveBlocker: { start: () => 1, isStarted: () => true, stop() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(appDir, 'main.cjs'), 'utf8'), {
    require: id => id === 'electron' ? electron : id.startsWith('./') ? require(path.join(appDir, id)) : require(id),
    __dirname: appDir, URL, console, process: { env: {}, platform: options.platform || 'win32' }, setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }, clearInterval: id => { if (intervals[id - 1]) intervals[id - 1].cleared = true; },
    setTimeout: (fn, ms) => (ms >= 10000 ? (delayed.push({ fn, ms }), 0) : setTimeout(fn, ms)), clearTimeout, fetch: options.fetch
  }, { filename: 'main.cjs' });
  await new Promise(resolve => setImmediate(resolve));
  const win = windows[0];
  win.__all = windows;
  const event = { sender: win.webContents, senderFrame: { url: pathToFileURL(path.join(appDir, 'index.html')).href } };
  const command = message => handlers.get('dual:command')(event, message);
  views.forEach((v, i) => { v.webContents.pid = 100 + i; });
  const lastState = () => JSON.parse(JSON.stringify(win.webContents.messages.filter(m => m.channel === 'dual:state').at(-1).data));
  const saved = () => JSON.parse(fs.readFileSync(path.join(dir, 'preferences.json'), 'utf8'));
  return { extLog, sessions, win, views, command, rawCommand: handlers.get('dual:command'), event, dir, opened, dialogs, lastState, saved, switches, powerMonitor, intervals, delayed };
}

test('duas contas usam sessões persistentes diferentes e páginas sem acesso privilegiado', async t => {
  const { views } = await setup(t);
  assert.equal(views.length, 2);
  assert.notEqual(views[0].options.webPreferences.partition, views[1].options.webPreferences.partition);
  for (const view of views) {
    const p = view.options.webPreferences;
    assert.match(p.partition, /^persist:/);
    assert.equal(p.nodeIntegration, false);
    assert.equal(p.sandbox, true);
    assert.equal(p.contextIsolation, true);
    assert.equal(p.webSecurity, true);
    assert.equal(p.backgroundThrottling, false);
    assert.equal(p.preload, undefined);
    assert.deepEqual(view.webContents.loads, ['https://levelingidle2d.com.br/jogar']);
  }
});

test('recarregar e silenciar uma conta não afetam a outra', async t => {
  const { views, command } = await setup(t);
  await command({ action: 'reload', index: 0 });
  assert.equal(views[0].webContents.loads.length, 2);
  assert.equal(views[1].webContents.loads.length, 1);
  await command({ action: 'mute', index: 0 });
  assert.equal(views[0].webContents.muted, true);
  assert.equal(views[1].webContents.muted, true);
});

test('ampliar e voltar não recarregam nem destroem as páginas', async t => {
  const { views, command } = await setup(t);
  await command({ action: 'mode', value: 'one' });
  assert.equal(views[0].visible, true); assert.equal(views[1].visible, false);
  assert.equal(views[0].bounds.width, 1600 - 4);
  await command({ action: 'mode', value: 'dual' });
  assert.equal(views[0].visible, true); assert.equal(views[1].visible, true);
  assert.equal(views[0].webContents.loads.length, 1);
  assert.equal(views[1].webContents.loads.length, 1);
});

test('comandos do jogo remoto são rejeitados; nome e zoom válidos são persistidos', async t => {
  const { views, command, rawCommand, event, dir } = await setup(t);
  await rawCommand({ sender: views[0].webContents, senderFrame: { url: 'https://levelingidle2d.com.br/jogar' } }, { action: 'reload', index: 1 });
  await rawCommand({ ...event, senderFrame: { url: 'https://evil.example' } }, { action: 'reload', index: 1 });
  assert.equal(views[1].webContents.loads.length, 1);
  await command({ action: 'name', index: 1, value: 'souludd' });
  for (let n = 0; n < 30; n++) await command({ action: 'zoom', index: 1, value: -1 });
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'preferences.json'), 'utf8'));
  assert.equal(saved.names[1], 'souludd'); assert.equal(saved.zoom[1], 0.5);
  assert.equal(saved.zoom[0], 0.8);
});

test('nenhum comando abre uma terceira conta', async t => {
  const { views, command } = await setup(t);
  await command({ action: 'focus', index: 2 });
  await command({ action: 'reload', index: 3 });
  await command({ action: 'mode', value: 'three' });
  assert.equal(views.length, 2);
});

test('empilhado, ampliar pelo botão e voltar mantêm as duas sessões', async t => {
  const { views, command, dir } = await setup(t);
  await command({ action: 'mode', value: 'stack' });
  assert.equal(views[0].bounds.width, views[1].bounds.width);
  assert.ok(views[1].bounds.y > views[0].bounds.y);
  await command({ action: 'expand', index: 1 });
  assert.equal(views[0].visible, false); assert.equal(views[1].visible, true);
  await command({ action: 'expand', index: 1 });
  assert.equal(views[0].visible, true); assert.equal(views[1].visible, true);
  assert.ok(views[1].bounds.y > views[0].bounds.y, 'volta para o empilhado');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'preferences.json'), 'utf8')).mode, 'stack');
  assert.equal(views[0].webContents.loads.length, 1);
});

test('arrastar a divisória esconde as páginas, muda o tamanho e mostra de novo', async t => {
  const { views, command } = await setup(t);
  await command({ action: 'dragStart' });
  assert.equal(views[0].visible, false); assert.equal(views[1].visible, false);
  await command({ action: 'dragMove', x: 400, y: 500 });
  await command({ action: 'dragEnd' });
  assert.equal(views[0].visible, true); assert.equal(views[1].visible, true);
  assert.ok(views[0].bounds.width < views[1].bounds.width);
  await command({ action: 'center' });
  assert.ok(Math.abs(views[0].bounds.width - views[1].bounds.width) <= 1);
});

test('links de fora do jogo abrem no navegador, nunca dentro do aplicativo', async t => {
  const { views, opened } = await setup(t);
  assert.equal(views[0].webContents.openHandler({ url: 'https://discord.gg/exemplo' }).action, 'deny');
  assert.equal(views[0].webContents.openHandler({ url: 'javascript:alert(1)' }).action, 'deny');
  assert.deepEqual(opened, ['https://discord.gg/exemplo']);
  assert.equal(views[0].webContents.openHandler({ url: 'https://levelingidle2d.com.br/login' }).action, 'allow');
});

test('atalhos Ctrl trocam a conta ativa e silenciam só ela; teclas soltas vão para o jogo', async t => {
  const { views, win } = await setup(t);
  const press = (input, wc = views[0].webContents) => { let blocked = false; wc.emit('before-input-event', { preventDefault: () => { blocked = true; } }, { type: 'keyDown', ...input }); return blocked; };
  assert.equal(press({ key: 'r', code: 'KeyR' }), false);
  assert.equal(press({ key: '2', code: 'Digit2', control: true }), true);
  assert.equal(views[1].webContents.focused, true);
  press({ key: 'm', code: 'KeyM', control: true }, views[1].webContents);
  assert.equal(views[1].webContents.muted, false);
  assert.equal(views[0].webContents.muted, false);
  press({ key: 'b', code: 'KeyB', control: true }, win.webContents);
  assert.equal(views[0].bounds.y, 56 + 2);
});

test('idioma segue o Windows na primeira vez, troca pelas bandeiras e aceita só pt, en e es', async t => {
  const { command, lastState, saved } = await setup(t, { locale: 'es-ES' });
  assert.equal(lastState().lang, 'es');
  await command({ action: 'lang', value: 'en' });
  assert.equal(lastState().lang, 'en');
  await command({ action: 'lang', value: 'fr' });
  assert.equal(saved().lang, 'en');
});

test('textos das três línguas têm as mesmas chaves', () => {
  const I18N = require('../app/i18n.js');
  const keys = Object.keys(I18N.pt).sort();
  for (const lang of ['en', 'es']) assert.deepEqual(Object.keys(I18N[lang]).sort(), keys, lang);
});

test('janelinha leva a conta ativa para uma janela por cima de tudo sem recarregar', async t => {
  const { win, views, command, lastState, rawCommand } = await setup(t);
  await command({ action: 'focus', index: 1 });
  await command({ action: 'pip' });
  const pipWin = lastWindow();
  assert.ok(pipWin && pipWin !== win);
  assert.equal(pipWin.options.alwaysOnTop, true);
  assert.equal(pipWin.options.webPreferences.sandbox, true);
  assert.ok(pipWin.children.has(views[1]) && !win.children.has(views[1]));
  assert.ok(win.children.has(views[0]));
  assert.equal(win.minimized, true);
  assert.deepEqual({ ...views[1].bounds }, { x: 0, y: 30, width: 520, height: 330 });
  assert.equal(lastState().pip, 1);
  const pipEvent = { sender: pipWin.webContents, senderFrame: { url: require('node:url').pathToFileURL(require('node:path').join(__dirname, '..', 'app', 'pip.html')).href } };
  await rawCommand(pipEvent, { action: 'reloadBoth' });
  assert.equal(views[0].webContents.loads.length, 1);
  await rawCommand(pipEvent, { action: 'pipSwap' });
  assert.ok(pipWin.children.has(views[0]) && win.children.has(views[1]));
  assert.equal(lastState().pip, 0);
  await rawCommand(pipEvent, { action: 'pipClose' });
  assert.ok(win.children.has(views[0]) && win.children.has(views[1]));
  assert.equal(pipWin.destroyed, true);
  assert.equal(win.minimized, false);
  assert.equal(lastState().pip, -1);
  assert.equal(views[0].webContents.loads.length, 1);
  assert.equal(views[1].webContents.loads.length, 1);
  function lastWindow() { return windowsRef().at(-1); }
  function windowsRef() { return win.__all; }
});

test('abrir a janela grande de novo traz a conta da janelinha de volta', async t => {
  const { win, views, command } = await setup(t);
  await command({ action: 'pipOpen', index: 0 });
  const pipWin = win.__all.at(-1);
  assert.ok(pipWin.children.has(views[0]));
  win.restore();
  assert.ok(win.children.has(views[0]));
  assert.equal(pipWin.destroyed, true);
});

test('recarregar as duas recarrega as duas contas', async t => {
  const { views, command } = await setup(t);
  await command({ action: 'reloadBoth' });
  assert.equal(views[0].webContents.loads.length, 2);
  assert.equal(views[1].webContents.loads.length, 2);
});

test('uso de CPU e memória fica escondido até ligar a opção', async t => {
  const { command, lastState } = await setup(t);
  assert.equal(lastState().accounts[0].usage, null);
  await command({ action: 'usage' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(lastState().accounts.map(a => a.usage), [{ cpu: 3, mem: 200, fps: 0 }, { cpu: 4, mem: 400, fps: 0 }]);
  await command({ action: 'usage' });
  assert.equal(lastState().accounts[1].usage, null);
});

test('cor e ícone por conta aceitam só as opções da lista', async t => {
  const { command, saved } = await setup(t);
  await command({ action: 'color', index: 1, value: '#3ccf91' });
  await command({ action: 'icon', index: 1, value: '🐉' });
  await command({ action: 'color', index: 0, value: 'red; background:url(x)' });
  await command({ action: 'icon', index: 0, value: '<img>' });
  assert.deepEqual(saved().colors, ['#409eec', '#3ccf91']);
  assert.deepEqual(saved().icons, ['⚔️', '🐉']);
});

test('"não perguntar de novo" fecha direto nas próximas vezes', async t => {
  const first = await setup(t, { dialog: { response: 1, checkboxChecked: true } });
  first.win.emit('close', { preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(first.dialogs.length, 1);
  assert.equal(first.dialogs[0].checkboxLabel, 'Não perguntar de novo');
  assert.equal(first.saved().confirmClose, false);
  const second = await setup(t, { prefs: { confirmClose: false } });
  second.win.emit('close', { preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(second.dialogs.length, 0);
  assert.equal(second.win.closed, true);
});

test('aviso de versão nova usa as releases do bruno, ignora rascunhos e versões antigas', async t => {
  const releases = [
    { tag_name: 'v1.3.0', draft: true, html_url: 'https://github.com/bruno220218/leveling-dual/releases/tag/v1.3.0' },
    { tag_name: 'v1.2.0', draft: false, prerelease: true, html_url: 'https://github.com/bruno220218/leveling-dual/releases/tag/v1.2.0', assets: [{ name: 'Leveling-Dual-Windows-x64.zip' }] },
    { tag_name: 'v1.0.0', draft: false, html_url: 'https://github.com/bruno220218/leveling-dual/releases/tag/v1.0.0' }];
  const fetch = async url => { assert.match(url, /^https:\/\/api\.github\.com\/repos\/bruno220218\/leveling-dual\/releases/); return { ok: true, json: async () => releases }; };
  const { command, lastState, opened, saved } = await setup(t, { fetch });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(lastState().update, { version: '1.2.0', tag: 'v1.2.0', url: releases[1].html_url });
  await command({ action: 'updateOpen' });
  assert.deepEqual(opened, [releases[1].html_url]);
  await command({ action: 'updateSkip' });
  assert.equal(lastState().update, null);
  assert.equal(saved().skipVersion, 'v1.2.0');
});

test('aviso de versão não abre endereço estranho vindo da resposta', async t => {
  const fetch = async () => ({ ok: true, json: async () => [{ tag_name: 'v9.0.0', draft: false, html_url: 'https://evil.example/x', assets: [{ name: 'Leveling-Dual-Windows-x64.zip' }] }] });
  const { command, opened } = await setup(t, { fetch });
  await new Promise(resolve => setTimeout(resolve, 20));
  await command({ action: 'updateOpen' });
  assert.deepEqual(opened, ['https://github.com/bruno220218/leveling-dual/releases']);
});

const MANIFEST_URL = 'https://github.com/bruno220218/leveling-dual/releases/download/v1.4.1/versoes.json';
function releaseWithManifest(manifest, manifestUrl = MANIFEST_URL) {
  const releases = [{ tag_name: 'v1.4.1', draft: false, html_url: 'https://github.com/bruno220218/leveling-dual/releases/tag/v1.4.1',
    assets: [{ name: 'Leveling-Dual-Windows-x64.zip' }, { name: 'Leveling-Dual-Linux-x64.deb' }, { name: 'versoes.json', browser_download_url: manifestUrl }] }];
  const asked = [];
  const fetch = async url => {
    asked.push(url);
    if (url.startsWith('https://api.github.com/')) return { ok: true, json: async () => releases };
    return { ok: true, text: async () => (typeof manifest === 'string' ? manifest : JSON.stringify(manifest)) };
  };
  return { fetch, asked };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('no Linux libera WebGL por software para VMs sem GPU', async t => {
  const { switches } = await setup(t, { platform: 'linux' });
  assert.ok(switches.includes('enable-unsafe-swiftshader'));
  assert.ok(switches.includes('ignore-gpu-blocklist'));
});

test('modo economia reduz o FPS no background e volta ao foco', async t => {
  const { win, views } = await setup(t);
  const lastScript = i => views[i].webContents.scripts.filter(s => /__LD_SET_FPS\(\d+\)/.test(s)).at(-1) || '';
  assert.match(lastScript(0), /\(60\)/);
  win.focused = false;
  win.minimized = true;
  win.emit('minimize');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(lastScript(0), /\(1\)/);
  assert.match(lastScript(1), /\(1\)/);
  win.minimized = false;
  win.focused = true;
  win.emit('restore');
  win.emit('focus');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(lastScript(0), /\(60\)/);
});

test('opções de desempenho persistem e validam os valores', async t => {
  const { command, lastState, saved } = await setup(t);
  await command({ action: 'perfFg', value: 30 });
  assert.equal(lastState().perfFg, 30);
  await command({ action: 'perfBg', value: 0 });
  assert.equal(lastState().perfBg, 0);
  await command({ action: 'perfFg', value: 45 });
  assert.equal(lastState().perfFg, 30);
  await command({ action: 'perfEnabled' });
  assert.equal(lastState().perfEnabled, false);
  assert.equal(saved().perf.fgFps, 30);
});

test('Fase 0b remove os switches que mantêm a página desenhando escondida', async t => {
  const { switches } = await setup(t, { prefs: { perf: { pauseHidden: true } } });
  assert.ok(switches.includes('disable-background-timer-throttling'));
  assert.ok(!switches.includes('disable-backgrounding-occluded-windows'));
  assert.ok(!switches.includes('disable-renderer-backgrounding'));
});

test('login salvo fica criptografado e é injetado na página', async t => {
  const { command, lastState, views, dir } = await setup(t);
  await command({ action: 'credSave', index: 0, value: { user: 'jinwoo', pass: 'segredo123', auto: true } });
  const state = lastState();
  assert.equal(state.credAvailable, true);
  assert.equal(state.credentials[0].has, true);
  assert.equal(state.credentials[0].user, 'jinwoo');
  assert.equal(state.credentials[0].pass, undefined);
  assert.equal(state.credentials[0].password, undefined);
  const raw = fs.readFileSync(path.join(dir, 'credentials.bin'), 'utf8');
  assert.ok(!raw.includes('segredo123'));
  assert.ok(raw.length > 10);
  assert.ok(views[0].webContents.scripts.some(script => script.includes('#slAuth-username') && script.includes('jinwoo')));
  await command({ action: 'credAuto', index: 0, value: false });
  assert.equal(lastState().credentials[0].auto, false);
  await command({ action: 'credClear', index: 0 });
  assert.equal(lastState().credentials[0].has, false);
  assert.ok(!fs.existsSync(path.join(dir, 'credentials.bin')));
});

test('sem armazenamento seguro o login não é gravado', async t => {
  const { command, lastState } = await setup(t, { safeStorage: false });
  await command({ action: 'credSave', index: 0, value: { user: 'a', pass: 'b' } });
  assert.equal(lastState().credAvailable, false);
  assert.equal(lastState().credentials[0].has, false);
});

test('linux sem chaveiro (basic_text) ainda salva o login, com aviso', async t => {
  const { command, lastState, dir } = await setup(t, { platform: 'linux', backend: 'basic_text' });
  await command({ action: 'credSave', index: 0, value: { user: 'jinwoo', pass: 'segredo123', auto: true } });
  const state = lastState();
  assert.equal(state.credAvailable, true);
  assert.equal(state.credInsecure, true);
  assert.equal(state.credBackend, 'basic_text');
  assert.equal(state.credentials[0].has, true);
  assert.ok(fs.existsSync(path.join(dir, 'credentials.bin')));
});

test('linux com chaveiro não mostra o aviso de armazenamento fraco', async t => {
  const { command, lastState } = await setup(t, { platform: 'linux', backend: 'gnome_libsecret' });
  await command({ action: 'credSave', index: 0, value: { user: 'jinwoo', pass: 'segredo123' } });
  assert.equal(lastState().credAvailable, true);
  assert.equal(lastState().credInsecure, false);
});

test('linux sem chaveiro liga o fallback de texto e salva o login', async t => {
  const { command, lastState, switches } = await setup(t, { platform: 'linux', backend: 'basic_text', plainTextOnly: true });
  assert.ok(switches.includes('password-store'), 'XFCE/sem DE usa o backend básico');
  await command({ action: 'credSave', index: 0, value: { user: 'jinwoo', pass: 'segredo123', auto: true } });
  const state = lastState();
  assert.equal(state.credAvailable, true);
  assert.equal(state.credInsecure, true);
  assert.equal(state.credBackend, 'basic_text');
  assert.equal(state.credentials[0].has, true);
});

test('correção só do Linux não avisa quem usa Windows', async t => {
  const { fetch } = releaseWithManifest({ windows: '1.1.0', macos: '1.1.0', linux: '1.4.1' });
  const { lastState } = await setup(t, { fetch, platform: 'win32' });
  await settle();
  assert.equal(lastState().update, null);
});

test('o mesmo release avisa quem usa Linux, com a versão do Linux', async t => {
  const { fetch } = releaseWithManifest({ windows: '1.1.0', linux: '1.4.1' });
  const { lastState } = await setup(t, { fetch, platform: 'linux' });
  await settle();
  assert.deepEqual(lastState().update, { version: '1.4.1', tag: 'v1.4.1', url: 'https://github.com/bruno220218/leveling-dual/releases/tag/v1.4.1' });
});

test('Windows mais antigo recebe o aviso da versão do Windows, e ignorar vale só para ela', async t => {
  const { fetch } = releaseWithManifest({ windows: '1.4.0', linux: '1.4.1' });
  const { lastState, command, saved } = await setup(t, { fetch, platform: 'win32' });
  await settle();
  assert.equal(lastState().update.version, '1.4.0');
  await command({ action: 'updateSkip' });
  assert.equal(saved().skipVersion, 'v1.4.0');
});

test('sistema fora do versoes.json não recebe aviso', async t => {
  const { fetch } = releaseWithManifest({ linux: '1.4.1' });
  const { lastState } = await setup(t, { fetch, platform: 'darwin' });
  await settle();
  assert.equal(lastState().update, null);
});

test('versoes.json estranho ou fora das releases do bruno é ignorado', async t => {
  for (const [manifest, url] of [['{nada', MANIFEST_URL], [{ windows: '9.9.9; rm -rf' }, MANIFEST_URL], [{ windows: '9.9.9' }, 'https://evil.example/versoes.json']]) {
    const { fetch, asked } = releaseWithManifest(manifest, url);
    const { lastState } = await setup(t, { fetch, platform: 'win32' });
    await settle();
    assert.equal(lastState().update, null);
    assert.ok(!asked.includes('https://evil.example/versoes.json'));
  }
});

test('release antiga sem versoes.json só avisa se tiver download para este sistema', async t => {
  const releases = [{ tag_name: 'v9.0.0', draft: false, html_url: 'https://github.com/bruno220218/leveling-dual/releases/tag/v9.0.0', assets: [{ name: 'Leveling-Dual-Linux-x64.deb' }] }];
  const fetch = async () => ({ ok: true, json: async () => releases });
  const win = await setup(t, { fetch, platform: 'win32' });
  await settle();
  assert.equal(win.lastState().update, null);
  const linux = await setup(t, { fetch, platform: 'linux' });
  await settle();
  assert.equal(linux.lastState().update.version, '9.0.0');
});

test('recarregar automático fica desligado até marcar e respeita o tempo escolhido', async t => {
  const { views, command, saved, intervals, delayed, lastState } = await setup(t);
  const active = () => intervals.filter(i => !i.cleared && i.ms >= 60000 && i.ms !== 6 * 3600000 && i.ms !== 12 * 3600000);
  assert.equal(active().length, 0);
  assert.deepEqual(lastState().autoReload, { on: false, value: 2, unit: 'h' });
  await command({ action: 'autoReload', value: { on: true, value: 30, unit: 'min' } });
  assert.deepEqual(active().map(i => i.ms), [30 * 60000]);
  assert.deepEqual(saved().autoReload, { on: true, value: 30, unit: 'min' });
  active()[0].fn();
  assert.equal(views[0].webContents.loads.length, 2);
  assert.equal(views[1].webContents.loads.length, 1);
  assert.equal(delayed.at(-1).ms, 20000);
  delayed.at(-1).fn();
  assert.equal(views[1].webContents.loads.length, 2);
  await command({ action: 'autoReload', value: { on: true, value: 3, unit: 'h' } });
  assert.deepEqual(active().map(i => i.ms), [3 * 3600000]);
  await command({ action: 'autoReload', value: { on: false, value: 3, unit: 'h' } });
  assert.equal(active().length, 0);
});

test('recarregar automático fica entre 5 minutos e 48 horas', async t => {
  const { command, saved } = await setup(t);
  await command({ action: 'autoReload', value: { on: true, value: 1, unit: 'min' } });
  assert.deepEqual(saved().autoReload, { on: true, value: 5, unit: 'min' });
  await command({ action: 'autoReload', value: { on: true, value: 999, unit: 'h' } });
  assert.deepEqual(saved().autoReload, { on: true, value: 48, unit: 'h' });
  await command({ action: 'autoReload', value: { on: 'sim', value: 'abc', unit: 'dias' } });
  assert.deepEqual(saved().autoReload, { on: false, value: 2, unit: 'h' });
});

test('nome de caçador aceita letras maiúsculas', async t => {
  const { command, lastState } = await setup(t);
  await command({ action: 'credSave', index: 0, value: { user: 'Skymer', pass: 'segredo123', auto: true } });
  assert.equal(lastState().credentials[0].has, true);
  assert.equal(lastState().credentials[0].user, 'Skymer');
});

const settleAll = () => new Promise(resolve => setTimeout(resolve, 20));
test('medidor de DPS já baixado entra nas duas contas antes do jogo abrir', async t => {
  const { extLog, views, lastState } = await setup(t, { extVersion: '1.2.0' });
  await settleAll();
  const loads = extLog.filter(e => e.op === 'load');
  assert.deepEqual(loads.map(e => e.name), ['persist:leveling-account-1', 'persist:leveling-account-2']);
  assert.ok(loads.every(e => e.dir.endsWith(path.join('haiokinkfpmnjmmihpbemoohhkclkdop', '1.2.0'))));
  assert.ok(loads.every(e => e.loadsBefore.every(n => n === 0)));
  assert.deepEqual(views.map(v => v.webContents.loads.length), [1, 1]);
  assert.equal(lastState().dps.status, 'ready');
  assert.equal(lastState().dps.version, '1.2.0');
  assert.equal(lastState().dpsEnabled, true);
});

test('desligar o medidor de DPS tira a extensão e recarrega as contas; religar volta', async t => {
  const { extLog, sessions, views, command, saved, lastState } = await setup(t, { extVersion: '1.2.0' });
  await settleAll();
  await command({ action: 'dpsEnabled' });
  assert.equal(saved().dps.on, false);
  assert.equal(lastState().dps.status, 'off');
  assert.ok([...sessions.values()].every(s => s.loaded.size === 0));
  assert.deepEqual(views.map(v => v.webContents.loads.length), [2, 2]);
  await command({ action: 'dpsEnabled' });
  await settleAll();
  assert.equal(saved().dps.on, true);
  assert.ok([...sessions.values()].every(s => s.loaded.size === 1));
  assert.equal(extLog.filter(e => e.op === 'load').length, 4);
});

test('botão DPS mexe só no HUD da conta escolhida', async t => {
  const { views, command } = await setup(t, { extVersion: '1.2.0' });
  await settleAll();
  const before = views.map(v => v.webContents.scripts.length);
  await command({ action: 'dpsHud', index: 1 });
  const sent = views.map((v, i) => v.webContents.scripts.slice(before[i]));
  assert.equal(sent[0].length, 0);
  assert.ok(sent[1].some(s => s.includes('toggleInGameHud')));
});

test('sem extensão baixada e sem internet o app abre normalmente e mostra o erro', async t => {
  const fetch = async () => { throw new Error('offline'); };
  const { views, lastState } = await setup(t, { fetch });
  await settleAll();
  assert.deepEqual(views.map(v => v.webContents.loads.length), [1, 1]);
  assert.equal(lastState().dps.status, 'error');
});
