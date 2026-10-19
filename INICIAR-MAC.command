#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  source "$HOME/.nvm/nvm.sh"
  nvm use 24 >/dev/null 2>&1 || nvm use --lts >/dev/null 2>&1
fi
if [ ! -d node_modules ]; then
  echo "Instalando dependências (precisa de internet)..."
  npm install || exit 1
fi
exec npm start
