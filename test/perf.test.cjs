'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { LIMITER_SOURCE, normalizeFps, fpsForView, FPS_FOREGROUND, FPS_BACKGROUND } = require('../app/perf.cjs');

test('normalizeFps aceita só os valores previstos e cai no padrão', () => {
  assert.equal(normalizeFps(30, 60, FPS_FOREGROUND), 30);
  assert.equal(normalizeFps('60', 30, FPS_FOREGROUND), 60);
  assert.equal(normalizeFps(45, 60, FPS_FOREGROUND), 60);
  assert.equal(normalizeFps(0, 1, FPS_BACKGROUND), 0);
  assert.equal(normalizeFps(5, 1, FPS_BACKGROUND), 5);
  assert.equal(normalizeFps(-1, 1, FPS_BACKGROUND), 1);
  assert.equal(normalizeFps('x', 1, FPS_BACKGROUND), 1);
});

test('fpsForView usa foco + visibilidade para escolher o FPS', () => {
  const base = { enabled: true, foreground: 60, background: 1 };
  assert.equal(fpsForView({ ...base, focused: true, visible: true }), 60);
  assert.equal(fpsForView({ ...base, focused: false, visible: true }), 1);
  assert.equal(fpsForView({ ...base, focused: true, visible: false }), 1);
  assert.equal(fpsForView({ ...base, focused: true, minimized: true }), 1);
  assert.equal(fpsForView({ ...base, focused: true, hidden: true }), 1);
  assert.equal(fpsForView({ ...base, focused: true, locked: true }), 1);
  assert.equal(fpsForView({ ...base, enabled: false, focused: false }), 60);
});

test('limitador instala, substitui o rAF e entrega o primeiro frame', () => {
  let now = 0;
  const queue = [];
  const window = {
    requestAnimationFrame: callback => { queue.push(callback); return queue.length; },
    cancelAnimationFrame() {}
  };
  const context = { window, performance: { now: () => now },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} };
  vm.runInNewContext(LIMITER_SOURCE, context);
  assert.equal(typeof window.__LD_SET_FPS, 'function');
  assert.equal(window.__LD_FPS, 60);
  assert.equal(window.__LD_FPS_ACTUAL, 0);
  let calls = 0;
  window.requestAnimationFrame(() => { calls++; });
  assert.equal(queue.length, 1);
  now = 100;
  queue.shift()(100);
  assert.equal(calls, 1);
});
