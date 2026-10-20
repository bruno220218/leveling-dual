#!/usr/bin/env bash
# Gera DMG + ZIP do app macOS (universal por padrão).
# Rode depois de: npm run build:mac (ou build:mac:arm64)
# Uso: ./scripts/package-mac.sh [universal|arm64|x64]
set -euo pipefail
cd "$(dirname "$0")/.."

ARCH="${1:-universal}"
APP="dist/Leveling Dual-darwin-${ARCH}/Leveling Dual.app"
DMG="dist/Leveling-Dual-macOS-${ARCH}.dmg"
ZIP="dist/Leveling-Dual-macOS-${ARCH}.zip"

if [ ! -d "$APP" ]; then
  echo "Build não encontrado em $APP. Rode: npm run build:mac (ou build:mac:arm64)" >&2
  exit 1
fi

export COPYFILE_DISABLE=1
# O packager 20.3 no macOS 26 ignora o .icns; aplica o ícone manualmente.
cp "$(pwd)/build/icon.icns" "$APP/Contents/Resources/icon.icns"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIconFile icon.icns' "$APP/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c 'Add :CFBundleIconFile string icon.icns' "$APP/Contents/Info.plist"
xattr -cr "$APP" 2>/dev/null || true
# Assinatura ad-hoc: não é notarizada, mas permite abrir no Apple Silicon.
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
ditto "$APP" "$WORK/Leveling Dual.app"
ln -s /Applications "$WORK/Applications"

hdiutil create -volname "Leveling Dual" -srcfolder "$WORK" -ov -format UDZO "$DMG"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
echo "DMG gerado: $DMG"
echo "ZIP gerado: $ZIP"
