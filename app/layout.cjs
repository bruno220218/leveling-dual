'use strict';
const HEADER = 64;   // barra com a marca e os modos (some com Ctrl+B)
const CONTROLS = 56; // faixa com os controles das duas contas
const FOOT = 30;     // rodapé (some com Ctrl+B)
const GAP = 6;       // espaço entre as contas, onde fica a divisória
const FRAME = 2;     // borda colorida da conta ativa
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ratioOf = v => (Number.isFinite(v) ? clamp(v, 0.15, 0.85) : 0.5);
// mode: 'dual' (lado a lado), 'stack' (empilhado), 'one' / 'two' (ampliar uma conta)
function getLayout(width, height, mode = 'dual', options = {}) {
  const top = (options.compact ? 0 : HEADER) + CONTROLS;
  const foot = options.compact ? 0 : FOOT;
  const w = Math.max(2, width);
  const area = { x: 0, y: top, width: w, height: Math.max(1, height - top - foot) };
  let slots, divider = null;
  if (mode === 'one') slots = [{ ...area }, null];
  else if (mode === 'two') slots = [null, { ...area }];
  else if (mode === 'stack') {
    const first = Math.floor((area.height - GAP) * ratioOf(options.ratio?.y));
    slots = [{ ...area, height: first }, { ...area, y: area.y + first + GAP, height: area.height - first - GAP }];
    divider = { dir: 'h', rect: { x: 0, y: area.y + first, width: w, height: GAP }, area };
  } else {
    const left = Math.floor((w - GAP) * ratioOf(options.ratio?.x));
    slots = [{ ...area, width: left }, { ...area, x: left + GAP, width: w - left - GAP }];
    divider = { dir: 'v', rect: { x: left, y: area.y, width: GAP, height: area.height }, area };
  }
  const views = slots.map(s => s && { x: s.x + FRAME, y: s.y + FRAME, width: Math.max(1, s.width - FRAME * 2), height: Math.max(1, s.height - FRAME * 2) });
  return { top, foot, slots, views, divider };
}
// Mantido da 1.0: retângulos das duas páginas do jogo.
function getBounds(width, height, mode = 'dual', options = {}) {
  return getLayout(width, height, mode, options).views;
}
// Posição do mouse durante o arraste -> nova proporção da divisória (15% a 85%).
function ratioFromPointer(divider, x, y) {
  const a = divider.area;
  return divider.dir === 'v' ? ratioOf((x - a.x) / Math.max(1, a.width)) : ratioOf((y - a.y) / Math.max(1, a.height));
}
function isGameUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password &&
      ['levelingidle2d.com.br', 'www.levelingidle2d.com.br'].includes(u.hostname);
  } catch { return false; }
}
function isWebUrl(value) {
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}
module.exports = { getLayout, getBounds, ratioFromPointer, isGameUrl, isWebUrl, HEADER, CONTROLS, FOOT, GAP, FRAME };
