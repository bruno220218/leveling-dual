'use strict';

// Limitador de requestAnimationFrame injetado em cada página do jogo.
// A página continua com o loop vivo (timers e rede intactos); só a taxa de
// desenho muda. Alvo em window.__LD_FPS; 0 segura os callbacks até voltar.
const LIMITER_SOURCE = `(function () {
  if (window.__LD_LIMITER__) return;
  window.__LD_LIMITER__ = true;
  var nativeRAF = window.requestAnimationFrame.bind(window);
  var pending = new Map();
  var seq = 0;
  var last = 0;
  var frames = 0;
  var mark = performance.now();
  var running = false;
  var timer = null;
  var poll = null;

  function target() {
    var n = Number(window.__LD_FPS);
    if (!isFinite(n)) return 60;
    n = Math.round(n);
    return Math.max(0, Math.min(240, n));
  }

  function countFrame() {
    var now = performance.now();
    frames++;
    if (now - mark >= 1000) {
      window.__LD_FPS_ACTUAL = Math.round(frames * 1000 / (now - mark));
      frames = 0;
      mark = now;
    }
  }

  function flush(ts) {
    if (!pending.size) return;
    var callbacks = Array.from(pending.values());
    pending.clear();
    for (var i = 0; i < callbacks.length; i++) {
      countFrame();
      try { callbacks[i](ts); }
      catch (err) { setTimeout(function () { throw err; }, 0); }
    }
  }

  function ensure() {
    if (running || !pending.size) return;
    var fps = target();
    if (fps <= 0) {
      if (!poll) poll = setInterval(function () {
        if (target() > 0) { clearInterval(poll); poll = null; ensure(); }
      }, 250);
      return;
    }
    running = true;
    if (fps < 30) {
      var wait = Math.max(0, 1000 / fps - (performance.now() - last));
      timer = setTimeout(function () {
        timer = null;
        nativeRAF(function (ts) { running = false; step(ts); });
      }, wait);
    } else {
      nativeRAF(step);
    }
  }

  function step(ts) {
    var fps = target();
    if (fps <= 0) { running = false; ensure(); return; }
    var interval = 1000 / fps;
    if (ts - last >= interval - 0.5) { last = ts; flush(ts); }
    running = false;
    ensure();
  }

  window.requestAnimationFrame = function (cb) {
    var id = ++seq;
    pending.set(id, cb);
    ensure();
    return id;
  };

  window.cancelAnimationFrame = function (id) {
    pending.delete(id);
  };

  window.__LD_SET_FPS = function (value) {
    window.__LD_FPS = value;
    if (timer) { clearTimeout(timer); timer = null; }
    if (poll) { clearInterval(poll); poll = null; }
    running = false;
    last = 0;
    if (target() > 0) ensure();
  };

  var initial = Number(window.__LD_FPS);
  window.__LD_FPS = isFinite(initial) ? initial : 60;
  window.__LD_FPS_ACTUAL = 0;
})();`;

const FPS_FOREGROUND = [30, 60];
const FPS_BACKGROUND = [0, 1, 2, 5, 10];

function normalizeFps(value, fallback, allowed) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 0 || number > 240) return fallback;
  if (Array.isArray(allowed) && !allowed.includes(number)) return fallback;
  return number;
}

// A conta só roda no FPS de foco quando a janela que a contém está visível,
// focada, acordada e a própria conta está na tela.
function fpsForView({ enabled = true, foreground = 60, background = 1,
  focused = false, visible = true, minimized = false, locked = false, hidden = false } = {}) {
  if (!enabled) return foreground;
  return focused && visible && !minimized && !locked && !hidden ? foreground : background;
}

module.exports = { LIMITER_SOURCE, normalizeFps, fpsForView, FPS_FOREGROUND, FPS_BACKGROUND };
