#!/bin/zsh
# Gera o APK de lançamento assinado do Leveling Dual para Android no macOS.
# Rode com:  ./assinar-apk.sh
#
# Na primeira vez cria a chave de assinatura. Todas as versões futuras PRECISAM
# ser assinadas com esta mesma chave; sem ela, o celular não aceita a atualização.
# Guarde uma cópia do arquivo .jks e da senha num lugar seguro.
set -e
cd "$(dirname "$0")"

if [ -z "$JAVA_HOME" ] && [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi

KEY_DIR="$HOME/.leveling-dual-chave"
KEYSTORE="$KEY_DIR/leveling-dual-release.jks"
ALIAS="levelingdual"

if [ ! -f "$KEYSTORE" ]; then
  echo "\n== Criando a chave de assinatura (só na primeira vez)"
  echo "   Arquivo: $KEYSTORE"
  mkdir -p "$KEY_DIR"
  while true; do
    read -rs "p1?   Escolha uma senha para a chave (8+ caracteres): "; echo
    read -rs "p2?   Repita a senha: "; echo
    [ "$p1" = "$p2" ] && [ ${#p1} -ge 8 ] && break
    echo "   As senhas não conferem ou têm menos de 8 caracteres."
  done
  export LD_KEYSTORE_PASSWORD="$p1"
  keytool -genkeypair -keystore "$KEYSTORE" -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
    -dname "CN=Leveling Dual, O=bruno220218 e SkymerLight" -storepass:env LD_KEYSTORE_PASSWORD -keypass:env LD_KEYSTORE_PASSWORD
  echo "   Chave criada. FAÇA UMA CÓPIA dessa pasta e guarde a senha!"
else
  read -rs "p?   Senha da chave de assinatura: "; echo
  export LD_KEYSTORE_PASSWORD="$p"
fi

export LD_KEYSTORE="$KEYSTORE"
export LD_KEY_ALIAS="$ALIAS"
echo "\n== Gerando o APK assinado"
./gradlew testDebugUnitTest assembleRelease --console=plain

version=$(sed -n 's/.*versionName = "\([^"]*\)".*/\1/p' app/build.gradle.kts)
apk="$HOME/.leveling-dual-build/app/outputs/apk/release/app-release.apk"
out="$(pwd)/LevelingDual-Android-$version.apk"
cp "$apk" "$out"
echo "\nPronto: $out"
echo "SHA-256: $(shasum -a 256 "$out" | cut -d' ' -f1)"
echo "Suba esse arquivo numa release com a tag android-v$version."
