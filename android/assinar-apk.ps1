# Gera o APK de lançamento assinado do Leveling Dual para Android.
# Rode com:  powershell -ExecutionPolicy Bypass -File assinar-apk.ps1
#
# Na primeira vez cria a chave de assinatura. Todas as versões futuras PRECISAM ser assinadas com
# esta mesma chave; sem ela, o celular não aceita a atualização. Guarde uma cópia do arquivo .jks
# e da senha num lugar seguro (pendrive, gerenciador de senhas). A senha é digitada aqui, escondida,
# e não é gravada em arquivo nenhum.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$jbr = 'C:\Program Files\Android\Android Studio\jbr'
$env:JAVA_HOME = $jbr
$keytool = Join-Path $jbr 'bin\keytool.exe'
$keyDir = Join-Path $env:USERPROFILE '.leveling-dual-chave'
$keystore = Join-Path $keyDir 'leveling-dual-release.jks'
$alias = 'levelingdual'

function Plain($secure) { [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)) }

if (-not (Test-Path $keystore)) {
  Write-Host "`n== Criando a chave de assinatura (só na primeira vez)" -ForegroundColor Cyan
  Write-Host "   Arquivo: $keystore"
  New-Item -ItemType Directory -Force $keyDir | Out-Null
  do {
    $p1 = Plain (Read-Host '   Escolha uma senha para a chave (8+ caracteres)' -AsSecureString)
    $p2 = Plain (Read-Host '   Repita a senha' -AsSecureString)
    if ($p1 -ne $p2) { Write-Host '   As senhas não conferem.' -ForegroundColor Yellow }
    elseif ($p1.Length -lt 8) { Write-Host '   Use 8 caracteres ou mais.' -ForegroundColor Yellow }
  } until ($p1 -eq $p2 -and $p1.Length -ge 8)
  $env:LD_KEYSTORE_PASSWORD = $p1
  & $keytool -genkeypair -keystore $keystore -alias $alias -keyalg RSA -keysize 4096 -validity 10000 `
    -dname 'CN=Leveling Dual, O=bruno220218 e SkymerLight' -storepass:env LD_KEYSTORE_PASSWORD -keypass:env LD_KEYSTORE_PASSWORD
  if ($LASTEXITCODE -ne 0) { throw 'Não consegui criar a chave.' }
  $p1 = $null; $p2 = $null
  Write-Host '   Chave criada. FAÇA UMA CÓPIA dessa pasta e guarde a senha!' -ForegroundColor Green
} else {
  $env:LD_KEYSTORE_PASSWORD = Plain (Read-Host "`n   Senha da chave de assinatura" -AsSecureString)
}

try {
  $env:LD_KEYSTORE = $keystore
  $env:LD_KEY_ALIAS = $alias
  Write-Host "`n== Gerando o APK assinado" -ForegroundColor Cyan
  & .\gradlew.bat testDebugUnitTest assembleRelease --console=plain
  if ($LASTEXITCODE -ne 0) { throw 'O build falhou (senha errada?).' }
} finally {
  Remove-Item Env:LD_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
}

$version = (Select-String -Path 'app\build.gradle.kts' -Pattern 'versionName = "([^"]+)"').Matches[0].Groups[1].Value
$apk = Join-Path $env:USERPROFILE '.leveling-dual-build\app\outputs\apk\release\app-release.apk'
$out = Join-Path $PSScriptRoot "LevelingDual-Android-$version.apk"
Copy-Item $apk $out -Force
$hash = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
Write-Host "`nPronto: $out" -ForegroundColor Green
Write-Host "SHA-256: $hash"
Write-Host "Suba esse arquivo numa release com a tag android-v$version (Release label: None)."
