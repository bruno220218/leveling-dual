'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCredScript, buildCaptureScript } = require('../app/creds.cjs');

test('autofill preenche o formulário e sinaliza o auto-submit', () => {
  const script = buildCredScript({ user: 'jinwoo', pass: 'p"a\\s', auto: true });
  assert.match(script, /#slAuth-username/);
  assert.match(script, /#slAuth-password/);
  assert.match(script, /__LD_AUTO_SUBMIT__ = true/);
  assert.ok(script.includes('jinwoo'));
  assert.ok(script.includes('p\\"a\\\\s'));
  assert.ok(!script.includes('cred.pass = "p"a'));
});

test('captura só ouve o formulário de login real e ignora o auto-login', () => {
  const script = buildCaptureScript();
  assert.match(script, /#slAuthForm/);
  assert.match(script, /#slAuth-username/);
  assert.match(script, /#slAuth-password/);
  assert.match(script, /__LD_AUTO_SUBMIT__/);
  assert.match(script, /__LD_CRED_CAPTURE__/);
  assert.match(script, /setInterval\(attach, 1000\)/);
});
