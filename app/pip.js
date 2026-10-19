'use strict';
// Faixa de cima da janelinha flutuante: mostra a conta e tem os botões de trocar e voltar.
const api = window.dual;
const I18N = window.I18N;
if (api) {
  document.getElementById('swap').addEventListener('click', () => api.command({ action: 'pipSwap' }));
  document.getElementById('back').addEventListener('click', () => api.command({ action: 'pipClose' }));
  api.onState(state => {
    if (state.pip < 0) return;
    const t = key => (I18N[state.lang] || I18N.pt)[key] || I18N.pt[key];
    const account = state.accounts[state.pip];
    const name = account.name === `Conta ${state.pip + 1}` ? `${t('account')} ${state.pip + 1}` : account.name;
    document.documentElement.style.setProperty('--c', account.color);
    document.getElementById('icon').textContent = account.icon;
    document.getElementById('name').textContent = name;
    document.title = `${name} · Leveling Dual`;
    document.getElementById('swap').title = t('pip_swap');
    document.getElementById('back').title = t('pip_back');
  });
  api.command({ action: 'state' });
}
