'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const ext = require('../app/extension.cjs');

// ---- monta um .crx3 assinado de mentira (sem usar a extensão real) ----
function varint(n) { const out = []; while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128); } out.push(n); return Buffer.from(out); }
const bytesField = (field, data) => Buffer.concat([varint(field * 8 + 2), varint(data.length), data]);
function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content, deflate] of entries) {
    const data = Buffer.from(content);
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, body); centrals.push(central, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const spki = publicKey.export({ type: 'spki', format: 'der' });
const ID = ext.idFromKey(spki);
function makeCrx(zip, { key = spki, priv = privateKey, id = ID } = {}) {
  const idBytes = Buffer.from(crypto.createHash('sha256').update(key).digest().subarray(0, 16));
  if (id !== ID) idBytes.fill(0);
  const signed = bytesField(1, idBytes);
  const len = Buffer.alloc(4); len.writeUInt32LE(signed.length);
  const sig = crypto.sign('sha256', Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'latin1'), len, signed, zip]), priv);
  const header = Buffer.concat([bytesField(2, Buffer.concat([bytesField(1, key), bytesField(2, sig)])), bytesField(10000, signed)]);
  const top = Buffer.alloc(12); top.write('Cr24', 0, 'latin1'); top.writeUInt32LE(3, 4); top.writeUInt32LE(header.length, 8);
  return Buffer.concat([top, header, zip]);
}
const manifest = v => JSON.stringify({ manifest_version: 3, name: 'teste', version: v });
const goodZip = v => makeZip([['manifest.json', manifest(v), true], ['content.js', 'console.log(1)', false],
  ['_metadata/verified_contents.json', '{}', false], ['icons/a.png', 'png', true]]);

test('aceita crx assinado e pula a pasta _metadata', () => {
  const files = ext.readZip(ext.unpackCrx(makeCrx(goodZip('1.2.0')), ID));
  assert.deepEqual(files.map(f => f.name).sort(), ['content.js', 'icons/a.png', 'manifest.json']);
  assert.equal(ext.readManifest(files).version, '1.2.0');
});

test('recusa crx adulterado, de outro autor ou com outro id', () => {
  const crx = makeCrx(goodZip('1.0.0'));
  const bad = Buffer.from(crx); bad[bad.length - 30] ^= 1;
  assert.throws(() => ext.unpackCrx(bad, ID), /assinatura/);
  assert.throws(() => ext.unpackCrx(crx, 'a'.repeat(32)), /id/);
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => ext.unpackCrx(makeCrx(goodZip('1.0.0'), { priv: other.privateKey }), ID), /assinatura/);
  assert.throws(() => ext.unpackCrx(Buffer.from('PK\x03\x04nada'), ID), /crx/);
});

test('recusa caminhos perigosos dentro do zip', () => {
  for (const name of ['../fora.js', '/abs.js', 'a/../../b.js', 'c:/win.js', 'a\\b.js']) {
    assert.throws(() => ext.readZip(makeZip([['manifest.json', manifest('1.0.0')], [name, 'x']])), /caminho/);
  }
});

test('compara versões', () => {
  assert.equal(ext.compareVersions('1.2.0', '1.10.0'), -1);
  assert.equal(ext.compareVersions('1.2', '1.2.0.0'), 0);
  assert.equal(ext.compareVersions('2.0.0.1', '2.0.0'), 1);
});

test('baixa, instala, não reinstala igual e atualiza para versão nova', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-ext-'));
  let served = makeCrx(goodZip('1.2.0'));
  const urls = [];
  const fakeFetch = async url => { urls.push(url); return { ok: true, status: 200, arrayBuffer: async () => served }; };
  const first = await ext.downloadAndInstall(base, fakeFetch, ID);
  assert.equal(first.updated, true);
  assert.equal(first.version, '1.2.0');
  assert.ok(fs.existsSync(path.join(first.dir, 'content.js')));
  assert.ok(!fs.existsSync(path.join(first.dir, '_metadata')));
  assert.match(urls[0], new RegExp(`id%3D${ID}`));
  const again = await ext.downloadAndInstall(base, fakeFetch, ID);
  assert.equal(again.updated, false);
  served = makeCrx(goodZip('1.3.0'));
  const next = await ext.downloadAndInstall(base, fakeFetch, ID);
  assert.equal(next.updated, true);
  assert.deepEqual(ext.installedDir(base, ID), { dir: next.dir, version: '1.3.0' });
  ext.pruneOld(base, '1.3.0', ID);
  assert.deepEqual(fs.readdirSync(path.join(base, ID)), ['1.3.0']);
  await assert.rejects(ext.downloadAndInstall(base, async () => ({ ok: false, status: 404 }), ID), /404/);
  fs.rmSync(base, { recursive: true, force: true });
});

test('script do HUD só envia comando quando a extensão está na página', () => {
  const script = ext.hudCommandScript('toggleInGameHud');
  assert.match(script, /__slMeterSync/);
  assert.match(script, /toggleInGameHud/);
  assert.match(script, /!window\.__slState\) return null/);
  assert.doesNotThrow(() => new Function(script));
});
