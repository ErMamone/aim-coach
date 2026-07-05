# package-opk.ps1 - empaqueta dist/ en un .opk instalable de Overwolf.
# Un OPK es un ZIP con manifest.json en la RAIZ. Este script:
#   1. valida que dist/ este completo (manifest + capturer),
#   2. copia dist/ a un staging y ahi genera un manifest de PRODUCCION
#      (apaga open_dev_tools / enable_auto_refresh; NO toca el manifest de dev en public/),
#   3. comprime (ZIP deflate estandar) y renombra a .opk en release/.
# Uso: yarn build:all  ->  yarn package   (o: powershell -File scripts/package-opk.ps1)

$ErrorActionPreference = 'Stop'

$repo   = Split-Path $PSScriptRoot -Parent
$dist   = Join-Path $repo 'dist'
$stage  = Join-Path $repo '.opk-stage'
$outDir = Join-Path $repo 'release'

# 1. validaciones (no shippear un OPK incompleto)
$distManifest = Join-Path $dist 'manifest.json'
if (-not (Test-Path $distManifest)) { throw "No existe dist/manifest.json. Corre 'yarn build:all' primero." }
$exe = Join-Path $dist 'native\AimCoach-MouseCapturer.exe'
if (-not (Test-Path $exe)) { throw "Falta el capturer en dist/native/. Corre 'yarn build:native' (o 'yarn build:all')." }
$dll = Join-Path $dist 'plugins\process_manager.dll'
if (-not (Test-Path $dll)) { throw "Falta plugins/process_manager.dll en dist/." }

$version = ((Get-Content $distManifest -Raw) | ConvertFrom-Json).meta.version
Write-Host "Empaquetando Aim Coach v$version ..."

# 2. staging: copia de dist para no mutarlo
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item (Join-Path $dist '*') $stage -Recurse -Force

# poda defensiva: el OPK lleva SOLO archivos de la app. Saca docs/notas/source-maps/simbolos/IA por si
# alguno se colara en dist/ (para que el OPK quede limpio para el review de Overwolf).
$junk = @('.md', '.markdown', '.txt', '.log', '.map', '.pdb', '.ts', '.tsx')
$dropped = @()
Get-ChildItem -Path $stage -Recurse -File | Where-Object { $junk -contains $_.Extension.ToLower() } | ForEach-Object {
  $dropped += $_.Name; Remove-Item $_.FullName -Force
}
if ($dropped.Count) { Write-Host ("  poda (fuera del OPK): " + ($dropped -join ', ')) }

# manifest de PRODUCCION: apagar settings de dev (dev tools + file watcher)
$stageManifest = Join-Path $stage 'manifest.json'
$m = [System.IO.File]::ReadAllText($stageManifest)
$m = $m -replace '"open_dev_tools":\s*true', '"open_dev_tools": false'
$m = $m -replace '"enable_auto_refresh":\s*true', '"enable_auto_refresh": false'
[System.IO.File]::WriteAllText($stageManifest, $m, (New-Object System.Text.UTF8Encoding($false)))

# 3. comprimir stage/ -> .opk (manifest en la raiz del zip).
# OJO: en PS 5.1 (.NET Framework) TANTO Compress-Archive COMO ZipFile::CreateFromDirectory meten backslashes
# en las rutas del zip (viola el spec ZIP, debe ser '/') -> Overwolf puede extraerlo mal. Por eso armamos el
# zip a mano con ZipArchive y forzamos '/' en cada entry.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
$opk = Join-Path $outDir "AimCoach-$version.opk"
if (Test-Path $opk) { Remove-Item $opk -Force }

$stageFull = (Resolve-Path $stage).Path.TrimEnd('\') + '\'
$fs = [System.IO.File]::Open($opk, [System.IO.FileMode]::CreateNew)
$archive = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -Path $stage -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($stageFull.Length) -replace '\\', '/'   # ruta relativa con forward-slash
    $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $es = $entry.Open()
    $src = [System.IO.File]::OpenRead($_.FullName)
    try { $src.CopyTo($es) } finally { $src.Dispose(); $es.Dispose() }
  }
} finally { $archive.Dispose(); $fs.Dispose() }

Remove-Item $stage -Recurse -Force
$size = [math]::Round((Get-Item $opk).Length / 1MB, 1)
Write-Host "OK -> release\AimCoach-$version.opk ($size MB)"
