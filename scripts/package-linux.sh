#!/usr/bin/env bash
# Empacota o build do Linux em .tar.gz e .deb (amd64).
# Rode depois de: npm run build:linux
set -euo pipefail
cd "$(dirname "$0")/.."

APPDIR="dist/Leveling Dual-linux-x64"
if [ ! -x "$APPDIR/Leveling Dual" ]; then
  echo "Build não encontrado em $APPDIR. Rode: npm run build:linux" >&2
  exit 1
fi

VERSION=$(node -p "require('./package.json').version")
OUT="dist"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

APP="$WORK/opt/leveling-dual"
mkdir -p "$APP"
cp -R "$APPDIR/." "$APP/"
mv "$APP/Leveling Dual" "$APP/leveling-dual"
cp LEIA-ME.txt "$APP/LEIA-ME.txt"

mkdir -p "$WORK/tar/leveling-dual"
cp -R "$APP/." "$WORK/tar/leveling-dual/"
tar -czf "$OUT/Leveling-Dual-Linux-x64.tar.gz" -C "$WORK/tar" leveling-dual

DEB="$WORK/deb"
mkdir -p "$DEB/DEBIAN" "$DEB/opt/leveling-dual" "$DEB/usr/bin" \
  "$DEB/usr/share/applications" "$DEB/usr/share/icons/hicolor/256x256/apps" \
  "$DEB/usr/share/doc/leveling-dual"
cp -R "$APP/." "$DEB/opt/leveling-dual/"
ln -s /opt/leveling-dual/leveling-dual "$DEB/usr/bin/leveling-dual"
cp app/icon.png "$DEB/usr/share/icons/hicolor/256x256/apps/leveling-dual.png"
cp LEIA-ME.txt "$DEB/usr/share/doc/leveling-dual/LEIA-ME.txt"

cat > "$DEB/usr/share/applications/leveling-dual.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Leveling Dual
Comment=Duas contas de Leveling Idle 2D em uma janela
Exec=/opt/leveling-dual/leveling-dual
Icon=leveling-dual
Terminal=false
Categories=Game;
StartupWMClass=Leveling Dual
EOF

SIZE_KB=$(du -sk "$DEB" | cut -f1)
cat > "$DEB/DEBIAN/control" <<EOF
Package: leveling-dual
Version: $VERSION
Section: games
Priority: optional
Architecture: amd64
Installed-Size: $SIZE_KB
Maintainer: bruno220218 <bruno220218@users.noreply.github.com>
Depends: libgtk-3-0, libnss3, libnspr4, libasound2, libgbm1, libxkbcommon0, libxcomposite1, libxdamage1, libxrandr2, libatk-bridge2.0-0, libatspi2.0-0, libcups2, libdrm2, libpango-1.0-0, libcairo2, libx11-6, libxcb1, libxext6, libxfixes3, xdg-utils
Description: Duas contas de Leveling Idle 2D em uma janela
 Aplicativo independente que abre o jogo em duas sessoes separadas,
 com barra de controles, janelinha flutuante e tres idiomas.
EOF
chmod 644 "$DEB/DEBIAN/control"

cat > "$DEB/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if [ -f /opt/leveling-dual/chrome-sandbox ]; then
  chown root:root /opt/leveling-dual/chrome-sandbox || true
  chmod 4755 /opt/leveling-dual/chrome-sandbox || true
fi
EOF
chmod 755 "$DEB/DEBIAN/postinst"

printf '2.0\n' > "$WORK/debian-binary"
tar --uid 0 --gid 0 --uname root --gname root -czf "$WORK/control.tar.gz" -C "$DEB/DEBIAN" .
tar --uid 0 --gid 0 --uname root --gname root --exclude=DEBIAN -czf "$WORK/data.tar.gz" -C "$DEB" .

OUT_DEB="$(pwd)/$OUT/Leveling-Dual-Linux-x64.deb"
rm -f "$OUT_DEB"
(cd "$WORK" && ar -rcS "$OUT_DEB" debian-binary control.tar.gz data.tar.gz)

echo "Gerado:"
ls -lh "$OUT/Leveling-Dual-Linux-x64.tar.gz" "$OUT/Leveling-Dual-Linux-x64.deb"
