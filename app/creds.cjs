'use strict';

// Script injetado no jogo para preencher o formulário de login.
// Só age quando o formulário real do Leveling Idle está na página; se a conta
// já estiver logada, não encontra o formulário e desiste sozinho.
function buildCredScript(cred) {
  const data = JSON.stringify({
    user: String(cred.user || ''),
    pass: String(cred.pass || ''),
    auto: cred.auto !== false
  });
  return `(function () {
  if (window.__LD_CRED_ATTEMPTED__) return;
  window.__LD_CRED_ATTEMPTED__ = true;
  var cred = ${data};
  if (!cred.user || !cred.pass) return;
  var sleep = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  var findForm = function () {
    var user = document.querySelector('#slAuth-username');
    var pass = document.querySelector('#slAuth-password');
    return user && pass ? { user: user, pass: pass } : null;
  };
  var setValue = function (input, value) {
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  var openLogin = function () {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    var byText = buttons.filter(function (button) {
      return /já tenho conta|i already have an account|ya tengo cuenta/i.test(button.textContent || '');
    })[0];
    if (byText) { byText.click(); return true; }
    var entry = document.querySelector('.slEntryButton:not(.slEntryButtonPrimary)');
    if (entry) { entry.click(); return true; }
    return false;
  };
  (async function () {
    var form = findForm();
    for (var i = 0; i < 50 && !form; i++) {
      if (i % 10 === 0) openLogin();
      await sleep(300);
      form = findForm();
    }
    if (!form) return;
    setValue(form.user, cred.user);
    setValue(form.pass, cred.pass);
    if (!cred.auto) return;
    var submit = document.querySelector('#slAuthForm button[type=submit], button.slAuthSubmit');
    if (!submit) return;
    await sleep(400);
    window.__LD_AUTO_SUBMIT__ = true;
    submit.click();
    setTimeout(function () { window.__LD_AUTO_SUBMIT__ = false; }, 3000);
  })();
})();`;
}

// Detecta um login manual no formulário do jogo. Só entrega as credenciais
// ao processo principal depois que o formulário some (login aceito), para não
// salvar senha errada. O auto-login é ignorado.
function buildCaptureScript() {
  return `(function () {
  if (window.__LD_CRED_WATCH__) return;
  window.__LD_CRED_WATCH__ = true;
  var lastSubmit = 0;
  var pending = null;
  var hidden = 0;
  var timer = null;
  var visible = function (el) { return Boolean(el && el.offsetParent !== null && el.getClientRects().length); };
  var read = function () {
    var user = document.querySelector('#slAuth-username');
    var pass = document.querySelector('#slAuth-password');
    return user && pass && user.value && pass.value ? { user: user.value, pass: pass.value } : null;
  };
  var watchResult = function () {
    var tries = 0;
    hidden = 0;
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      tries++;
      var form = document.querySelector('#slAuthForm');
      if (visible(form)) hidden = 0; else hidden++;
      if (hidden >= 2) {
        clearInterval(timer); timer = null;
        if (pending) { window.__LD_CRED_CAPTURE__ = pending; pending = null; }
        return;
      }
      if (tries > 40) { clearInterval(timer); timer = null; pending = null; }
    }, 500);
  };
  var onSubmit = function () {
    if (window.__LD_AUTO_SUBMIT__) return;
    var now = Date.now();
    if (now - lastSubmit < 1200) return;
    lastSubmit = now;
    var cred = read();
    if (!cred) return;
    pending = cred;
    watchResult();
  };
  var attach = function () {
    var form = document.querySelector('#slAuthForm');
    if (!form || form.__ldWatch) return;
    form.__ldWatch = true;
    form.addEventListener('submit', onSubmit, true);
    var button = form.querySelector('button[type="submit"]');
    if (button) button.addEventListener('click', onSubmit, true);
  };
  setInterval(attach, 1000);
  attach();
})();`;
}

module.exports = { buildCredScript, buildCaptureScript };
