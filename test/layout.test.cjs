'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getLayout, getBounds, ratioFromPointer, isGameUrl, isWebUrl } = require('../app/layout.cjs');
test('duas contas ocupam a área útil sem sobreposição em janelas pares e ímpares', () => {
  for (const width of [1000, 1001, 1366, 1920, 2561]) {
    const { slots: [a, b], divider } = getLayout(width, 900);
    assert.equal(a.x, 0);
    assert.equal(a.width + b.width + 6, width);
    assert.equal(b.x, a.width + 6);
    assert.equal(b.x + b.width, width);
    assert.equal(a.y + a.height, 870);
    assert.deepEqual([a.y, a.height], [b.y, b.height]);
    assert.deepEqual(divider.rect, { x: a.width, y: 120, width: 6, height: 750 });
  }
});
test('as páginas ficam dentro da área, com 2px para a borda da conta ativa', () => {
  const [a, b] = getBounds(1600, 900);
  assert.deepEqual(a, { x: 2, y: 122, width: 793, height: 746 });
  assert.equal(b.x + b.width, 1598);
});
test('empilhado divide na horizontal sem sobreposição', () => {
  const { slots: [a, b], divider } = getLayout(1440, 900, 'stack');
  assert.equal(divider.dir, 'h');
  assert.deepEqual([a.x, a.width, b.x, b.width], [0, 1440, 0, 1440]);
  assert.equal(b.y, a.y + a.height + 6);
  assert.equal(b.y + b.height, 870);
});
test('ampliar conta preserva a área inteira e oculta apenas a outra visualização', () => {
  assert.deepEqual(getLayout(1440, 900, 'one').slots, [{ x: 0, y: 120, width: 1440, height: 750 }, null]);
  assert.deepEqual(getLayout(1440, 900, 'two').slots, [null, { x: 0, y: 120, width: 1440, height: 750 }]);
  assert.equal(getLayout(1440, 900, 'one').divider, null);
});
test('barra escondida deixa só a faixa de controles no topo e tira o rodapé', () => {
  const { slots: [a] } = getLayout(1440, 900, 'dual', { compact: true });
  assert.equal(a.y, 56);
  assert.equal(a.y + a.height, 900);
});
test('a divisória acompanha o mouse entre 15% e 85%', () => {
  const { divider } = getLayout(1000, 900);
  assert.equal(ratioFromPointer(divider, 250, 0), 0.25);
  assert.equal(ratioFromPointer(divider, -40, 0), 0.15);
  assert.equal(ratioFromPointer(divider, 5000, 0), 0.85);
  const [a] = getLayout(1000, 900, 'dual', { ratio: { x: 0.25 } }).slots;
  assert.equal(a.width, Math.floor((1000 - 6) * 0.25));
});
test('navegação aceita somente HTTPS no domínio real do jogo', () => {
  for (const url of ['https://levelingidle2d.com.br/jogar', 'https://www.levelingidle2d.com.br/login']) assert.equal(isGameUrl(url), true);
  for (const url of ['http://levelingidle2d.com.br/jogar', 'https://levelingidle2d.com.br.example.com/', 'https://evil.example/?levelingidle2d.com.br', 'javascript:alert(1)', 'file:///tmp/x', 'https://user:pass@levelingidle2d.com.br/', 'invalid']) assert.equal(isGameUrl(url), false);
  assert.equal(isWebUrl('https://discord.gg/x'), true);
  for (const url of ['javascript:alert(1)', 'file:///tmp/x', 'invalid']) assert.equal(isWebUrl(url), false);
});
