param(
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $root "DORN AI.exe"
$expectedExe = "582c6eeaac0b32d7f78cfe5e225854a3cfe38ff16d725f41f590c20800054375"
$expectedExeBytes = 205883904
$expectedElectron = "37.2.6"
$failed = $false
$required = @(
  "DORN AI.exe",
  "version",
  "ELECTRON-RUNTIME.json",
  "resources\app.asar",
  "resources\startup\splash.html",
  "resources\startup\dorn-startup.wav",
  "resources\startup\icon.ico",
  "resources\local-ai\runtime\llama-server.exe",
  "icudtl.dat",
  "v8_context_snapshot.bin",
  "libEGL.dll",
  "libGLESv2.dll",
  "locales\es.pak"
)

function Test-DornPe {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [System.IO.File]::Open(
    $Path,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::Read
  )
  $reader = New-Object System.IO.BinaryReader($stream)
  try {
    if ($reader.ReadUInt16() -ne 0x5A4D) {
      throw "La cabecera MZ no es valida."
    }
    $stream.Position = 0x3C
    $peOffset = $reader.ReadUInt32()
    $stream.Position = $peOffset
    if ($reader.ReadUInt32() -ne 0x00004550) {
      throw "La cabecera PE no es valida."
    }
    $machine = $reader.ReadUInt16()
    $sectionCount = $reader.ReadUInt16()
    $stream.Position = $peOffset + 20
    $optionalHeaderSize = $reader.ReadUInt16()
    $stream.Position = $peOffset + 24
    $optionalMagic = $reader.ReadUInt16()
    $sectionTable = $peOffset + 24 + $optionalHeaderSize
    $requiredSize = [Int64]0
    for ($index = 0; $index -lt $sectionCount; $index += 1) {
      $stream.Position = $sectionTable + ($index * 40) + 16
      $rawSize = [Int64]$reader.ReadUInt32()
      $rawOffset = [Int64]$reader.ReadUInt32()
      $rawEnd = $rawOffset + $rawSize
      if ($rawEnd -gt $requiredSize) {
        $requiredSize = $rawEnd
      }
    }
    return [PSCustomObject]@{
      Machine = $machine
      OptionalMagic = $optionalMagic
      SectionCount = $sectionCount
      PhysicalSize = $stream.Length
      RequiredSize = $requiredSize
      Complete = ($requiredSize -le $stream.Length)
    }
  } finally {
    $reader.Dispose()
  }
}

Write-Host "DORN AI 4.0.0-alpha.3 - comprobacion integral de inicio"
Write-Host ""
Write-Host "Windows:" ([Environment]::OSVersion.VersionString)
Write-Host "Arquitectura:" ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)
Write-Host "Sistema de 64 bits:" ([Environment]::Is64BitOperatingSystem)
Write-Host ""

foreach ($relative in $required) {
  $target = Join-Path $root $relative
  if (Test-Path -LiteralPath $target) {
    Write-Host "[OK] $relative"
  } else {
    Write-Host "[FALTA] $relative" -ForegroundColor Red
    $failed = $true
  }
}

if (Test-Path -LiteralPath $exe) {
  try {
    $pe = Test-DornPe -Path $exe
    Write-Host ""
    Write-Host "PE x64:" ($pe.Machine -eq 0x8664)
    Write-Host "PE32+:" ($pe.OptionalMagic -eq 0x20B)
    Write-Host "Secciones:" $pe.SectionCount
    Write-Host "Tamano fisico:" $pe.PhysicalSize "bytes"
    Write-Host "Tamano requerido por PE:" $pe.RequiredSize "bytes"
    Write-Host "Ejecutable completo:" $pe.Complete
    if (
      $pe.Machine -ne 0x8664 -or
      $pe.OptionalMagic -ne 0x20B -or
      -not $pe.Complete -or
      $pe.PhysicalSize -ne $expectedExeBytes
    ) {
      $failed = $true
    }
  } catch {
    Write-Host "[ERROR PE]" $_.Exception.Message -ForegroundColor Red
    $failed = $true
  }

  $actualExe = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host "SHA256 EXE:" $actualExe
  Write-Host "Runtime oficial integro:" ($actualExe -eq $expectedExe)
  if ($actualExe -ne $expectedExe) {
    $failed = $true
  }
}

$versionPath = Join-Path $root "version"
if (Test-Path -LiteralPath $versionPath) {
  $actualElectron = (Get-Content -LiteralPath $versionPath -Raw).Trim()
  Write-Host "Electron:" $actualElectron
  if ($actualElectron -ne $expectedElectron) {
    Write-Host "Se esperaba Electron $expectedElectron." -ForegroundColor Red
    $failed = $true
  }
}

$asar = Join-Path $root "resources\app.asar"
if (Test-Path -LiteralPath $asar) {
  $actualAsar = (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host "SHA256 app.asar:" $actualAsar
}

Write-Host ""
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne "X64") {
  Write-Host "Esta entrega es x64. Este equipo necesita una compilacion especifica para su arquitectura." -ForegroundColor Yellow
  $failed = $true
}

if ($failed) {
  Write-Host "RESULTADO: DORN no debe iniciarse desde esta carpeta. La descarga o extraccion no es integra." -ForegroundColor Red
  $exitCode = 1
} else {
  Write-Host "RESULTADO: runtime oficial x64, archivos y secciones PE correctos." -ForegroundColor Green
  $exitCode = 0
}

Write-Host ""
if (-not $NoPause) {
  Read-Host "Presiona Enter para cerrar"
}
exit $exitCode
