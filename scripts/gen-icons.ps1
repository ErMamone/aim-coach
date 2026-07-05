# gen-icons.ps1 - genera los iconos de la app desde el master public/assets/aim-coach-logo.png
# Produce en public/assets:
#   icon.png        (256x256)  -> icono de la app (dock de Overwolf, activo)
#   icon_gray.png   (256x256)  -> version gris (app inactiva)
#   desktop_icon.ico (16/32/48/256, PNG embebido) -> icono del acceso directo de escritorio
# Cuando cambie el diseno: reemplaza aim-coach-logo.png (cuadrado, PNG) y corre 'yarn icons'.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repo    = Split-Path $PSScriptRoot -Parent
$assets  = Join-Path $repo 'public\assets'
$srcPath = Join-Path $assets 'aim-coach-logo.png'
if (-not (Test-Path $srcPath)) { throw "No existe $srcPath (el master del logo)." }

$src = [System.Drawing.Image]::FromFile($srcPath)
if ($src.Width -ne $src.Height) { Write-Warning "El logo NO es cuadrado ($($src.Width)x$($src.Height)); se va a deformar al escalar. Ideal: cuadrado." }

function New-Icon([System.Drawing.Image]$img, [int]$size, [bool]$gray) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  if ($gray) {
    $cm = New-Object System.Drawing.Imaging.ColorMatrix
    $cm.Matrix00 = 0.299; $cm.Matrix01 = 0.299; $cm.Matrix02 = 0.299
    $cm.Matrix10 = 0.587; $cm.Matrix11 = 0.587; $cm.Matrix12 = 0.587
    $cm.Matrix20 = 0.114; $cm.Matrix21 = 0.114; $cm.Matrix22 = 0.114
    $ia = New-Object System.Drawing.Imaging.ImageAttributes
    $ia.SetColorMatrix($cm)
    $dst = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $g.DrawImage($img, $dst, 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
  } else {
    $g.DrawImage($img, 0, 0, $size, $size)
  }
  $g.Dispose()
  return $bmp
}
# icon.png + icon_gray.png (256)
$icon = New-Icon $src 256 $false
$icon.Save((Join-Path $assets 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png); $icon.Dispose()
$gray = New-Icon $src 256 $true
$gray.Save((Join-Path $assets 'icon_gray.png'), [System.Drawing.Imaging.ImageFormat]::Png); $gray.Dispose()

# desktop_icon.ico (multi-size, cada entry es un PNG embebido -> Windows Vista+).
# Lista TIPADA de byte[] (evita que PowerShell "desenrolle" los arrays y pierda los datos PNG).
$sizes = 16, 32, 48, 256
$pngs = New-Object 'System.Collections.Generic.List[byte[]]'
foreach ($s in $sizes) {
  $b = New-Icon $src $s $false
  $ms = New-Object System.IO.MemoryStream
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs.Add($ms.ToArray())
  $ms.Dispose(); $b.Dispose()
}
$icoPath = Join-Path $assets 'desktop_icon.ico'
$fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)  # ICONDIR: reserved, type=icon, count
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]
  $bw.Write([byte]($s -band 0xFF)); $bw.Write([byte]($s -band 0xFF))  # width/height (256 -> 0)
  $bw.Write([byte]0); $bw.Write([byte]0)                              # colorCount, reserved
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)                         # planes, bitCount
  $bw.Write([UInt32]$pngs[$i].Length); $bw.Write([UInt32]$offset)     # bytesInRes, imageOffset
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Flush(); $bw.Close(); $fs.Close()
$src.Dispose()

Write-Host "Iconos generados en public/assets: icon.png (256), icon_gray.png (256 gris), desktop_icon.ico (16/32/48/256)"
