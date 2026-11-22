'use strict';
// Medidor de DPS: a extensão "Leveling Idle 2D — DPS Meter Lite" (por ds_) é baixada da
// Chrome Web Store no computador de quem usa o app. Nada dela é redistribuído aqui:
// o pacote .crx é verificado (assinatura + id) e extraído na pasta de dados do app.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DPS_ID = 'haiokinkfpmnjmmihpbemoohhkclkdop';
const DPS_STORE = `https://chromewebstore.google.com/detail/${DPS_ID}`;
const CHROME_VERSION = '140.0.0.0';
const crxUrl = (id = DPS_ID) => 'https://clients2.google.com/service/update2/crx?response=redirect'
  + `&prodversion=${CHROME_VERSION}&acceptformat=crx3&x=id%3D${id}%26uc`;
const MAX_CRX = 5 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_UNPACKED = 20 * 1024 * 1024;

// ---------- protobuf mínimo (só o que o cabeçalho CRX3 usa) ----------
function readVarint(buf, pos) {
  let value = 0, shift = 0;
  for (;;) {
    if (pos >= buf.length || shift > 35) throw new Error('varint');
    const b = buf[pos++];
    value += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return [value, pos];
    shift += 7;
  }
}
function fields(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let key; [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8), type = key & 7;
    if (type === 2) {
      let len; [len, pos] = readVarint(buf, pos);
      if (pos + len > buf.length) throw new Error('protobuf');
      out.push({ field, data: buf.subarray(pos, pos + len) });
      pos += len;
    } else if (type === 0) { [, pos] = readVarint(buf, pos); }
    else if (type === 5) pos += 4;
    else if (type === 1) pos += 8;
    else throw new Error('protobuf');
  }
  return out;
}
// id de extensão = 16 primeiros bytes do SHA-256 da chave pública, em letras a–p
function idFromBytes(bytes) {
  let s = '';
  for (const b of bytes.subarray(0, 16)) s += String.fromCharCode(97 + (b >> 4), 97 + (b & 15));
  return s;
}
const idFromKey = key => idFromBytes(crypto.createHash('sha256').update(key).digest());

// Confere a assinatura do CRX3 e devolve o zip de dentro. Lança erro se algo não bater.
function unpackCrx(buf, expectedId = DPS_ID) {
  if (!Buffer.isBuffer(buf) || buf.length < 12 || buf.toString('latin1', 0, 4) !== 'Cr24') throw new Error('não é um .crx');
  const version = buf.readUInt32LE(4), headerLen = buf.readUInt32LE(8);
  if (version !== 3) throw new Error(`crx versão ${version}`);
  if (12 + headerLen > buf.length) throw new Error('cabeçalho');
  const header = buf.subarray(12, 12 + headerLen);
  const archive = buf.subarray(12 + headerLen);
  const parts = fields(header);
  const signedData = parts.find(p => p.field === 10000)?.data;
  if (!signedData) throw new Error('sem dados assinados');
  const crxId = fields(signedData).find(p => p.field === 1)?.data;
  if (!crxId || idFromBytes(crxId) !== expectedId) throw new Error('id diferente do esperado');
  const len = Buffer.alloc(4); len.writeUInt32LE(signedData.length);
  const message = Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'latin1'), len, signedData, archive]);
  // A prova RSA cuja chave gera o id da extensão precisa ser válida (é a do autor).
  const proofs = parts.filter(p => p.field === 2).map(p => {
    const f = fields(p.data);
    return { key: f.find(x => x.field === 1)?.data, sig: f.find(x => x.field === 2)?.data };
  }).filter(p => p.key && p.sig);
  const own = proofs.find(p => idFromKey(p.key) === expectedId);
  if (!own) throw new Error('sem assinatura do autor');
  const publicKey = crypto.createPublicKey({ key: own.key, format: 'der', type: 'spki' });
  if (!crypto.verify('sha256', message, publicKey, own.sig)) throw new Error('assinatura inválida');
  return archive;
}

// ---------- zip mínimo (stored + deflate), com proteção contra caminhos maliciosos ----------
function readZip(zip) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip sem diretório');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  if (count > MAX_FILES) throw new Error('arquivos demais');
  const files = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('zip corrompido');
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20), usize = zip.readUInt32LE(p + 24);
    const nlen = zip.readUInt16LE(p + 28), elen = zip.readUInt16LE(p + 30), clen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    const parts = name.split('/');
    if (name.startsWith('/') || name.includes('\\') || parts.some(s => s === '..' || s === '' || s === '.') || /^[a-z]:/i.test(name)) {
      throw new Error(`caminho inválido: ${name}`);
    }
    // Pastas começando com "_" são reservadas pelo Chromium (ex.: _metadata da loja); só _locales é aceita.
    if (parts[0].startsWith('_') && parts[0] !== '_locales') continue;
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('zip corrompido');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + csize);
    total += usize;
    if (total > MAX_UNPACKED) throw new Error('extensão grande demais');
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: usize + 1 });
    else throw new Error(`compressão ${method}`);
    if (data.length !== usize) throw new Error('tamanho não confere');
    files.push({ name, data });
  }
  return files;
}

function readManifest(files) {
  const file = files.find(f => f.name === 'manifest.json');
  if (!file) throw new Error('sem manifest.json');
  const manifest = JSON.parse(file.data.toString('utf8').replace(/^﻿/, ''));
  if (typeof manifest.version !== 'string' || !/^\d+(\.\d+){0,3}$/.test(manifest.version)) throw new Error('versão inválida');
  return manifest;
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 4; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y ? 1 : -1; }
  return 0;
}

// Pasta: <base>/<id>/<versão>/ — troca atômica: extrai em .tmp e renomeia.
function installFiles(baseDir, files, manifest, id = DPS_ID) {
  const root = path.join(baseDir, id);
  const target = path.join(root, manifest.version);
  if (fs.existsSync(path.join(target, 'manifest.json'))) return target;
  const tmp = `${target}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of files) {
    const dest = path.join(tmp, ...f.name.split('/'));
    if (!dest.startsWith(tmp + path.sep)) throw new Error('caminho inválido');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.data);
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(tmp, target);
  return target;
}

// Versão instalada mais nova (ou null).
function installedDir(baseDir, id = DPS_ID) {
  const root = path.join(baseDir, id);
  let best = null;
  try {
    for (const name of fs.readdirSync(root)) {
      if (!/^\d+(\.\d+){0,3}$/.test(name)) continue;
      if (!fs.existsSync(path.join(root, name, 'manifest.json'))) continue;
      if (!best || compareVersions(name, best) > 0) best = name;
    }
  } catch { return null; }
  return best ? { dir: path.join(root, best), version: best } : null;
}

// Apaga versões antigas, mantendo a atual.
function pruneOld(baseDir, keepVersion, id = DPS_ID) {
  const root = path.join(baseDir, id);
  try {
    for (const name of fs.readdirSync(root)) {
      if (name !== keepVersion) fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
  } catch {  }
}

// Baixa da loja, verifica e instala. Devolve { dir, version, updated }.
async function downloadAndInstall(baseDir, fetchImpl = fetch, id = DPS_ID) {
  const r = await fetchImpl(crxUrl(id), { headers: { 'User-Agent': `Mozilla/5.0 Chrome/${CHROME_VERSION}` }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_CRX) throw new Error('arquivo grande demais');
  const files = readZip(unpackCrx(buf, id));
  const manifest = readManifest(files);
  const before = installedDir(baseDir, id);
  if (before && compareVersions(manifest.version, before.version) <= 0) return { ...before, updated: false };
  const dir = installFiles(baseDir, files, manifest, id);
  return { dir, version: manifest.version, updated: true };
}

// Comando que liga/desliga o HUD flutuante da extensão (roda no mundo principal da página,
// o mesmo onde o content script dela escuta o evento __slMeterSync).
function hudCommandScript(cmd) {
  const msg = JSON.stringify({ type: 'SL_CMD', cmd: String(cmd) });
  return `(() => { const r = document.documentElement; if (!r || !window.__slState) return null;
    r.setAttribute('data-sl-cmd', ${JSON.stringify(msg)});
    document.dispatchEvent(new CustomEvent('__slMeterSync'));
    return Boolean(window.__slState.inGameHudVisible); })()`;
}
const HUD_STATE_SCRIPT = '(() => window.__slState ? Boolean(window.__slState.inGameHudVisible) : null)()';

module.exports = { DPS_ID, DPS_STORE, crxUrl, unpackCrx, readZip, readManifest, compareVersions, installFiles,
  installedDir, pruneOld, downloadAndInstall, hudCommandScript, HUD_STATE_SCRIPT, idFromKey };
