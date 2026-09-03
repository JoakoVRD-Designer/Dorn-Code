param(
  [Parameter(Mandatory = $true)][string]$PortablePath,
  [string]$OutputPath = "",
  [string]$MakensisPath = "${env:ProgramFiles(x86)}\NSIS\makensis.exe"
)

$ErrorActionPreference = "Stop"
$installerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = [System.IO.Path]::GetFullPath((Join-Path $installerRoot $PortablePath))
$output = if ($OutputPath) {
  [System.IO.Path]::GetFullPath($OutputPath)
} else {
  Join-Path $installerRoot "output\DORN_AI_Setup_4.0.0-alpha.4_x64.exe"
}
$script = Join-Path $installerRoot "dorn-installer.nsi"
$verifier = Join-Path $installerRoot "..\scripts\verify-windows-runtime.cjs"

if (-not (Test-Path -LiteralPath $MakensisPath)) {
  throw "No se encontró makensis.exe. Instala NSIS 3.x o pasa -MakensisPath."
}
if (-not (Test-Path -LiteralPath (Join-Path $source "DORN AI.exe"))) {
  throw "Portable inválido: no se encontró DORN AI.exe en $source"
}

& node $verifier $source
if ($LASTEXITCODE -ne 0) {
  throw "El runtime de Windows no superó la verificación PE. No se compilará el instalador."
}

$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("dorn-installer-stage-" + [Guid]::NewGuid().ToString("N"))
$stage = Join-Path $stageRoot "app"
New-Item -ItemType Directory -Force -Path $stage | Out-Null

try {
  Copy-Item -Path (Join-Path $source "*") -Destination $stage -Recurse -Force
  $exe = Join-Path $stage "DORN AI.exe"
  $exeSize = (Get-Item -LiteralPath $exe).Length
  $exeHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
  $input = [System.IO.File]::OpenRead($exe)
  try {
    $buffer = New-Object byte[] (1MB)
    for ($part = 0; $part -lt 13; $part++) {
      $partPath = Join-Path $stage ("DORN_AI_EXE.part{0:D3}" -f $part)
      $outputStream = [System.IO.File]::Create($partPath)
      try {
        $remaining = [Math]::Min(16MB, $input.Length - $input.Position)
        while ($remaining -gt 0) {
          $read = $input.Read($buffer, 0, [Math]::Min($buffer.Length, [int]$remaining))
          if ($read -le 0) { break }
          $outputStream.Write($buffer, 0, $read)
          $remaining -= $read
        }
      } finally {
        $outputStream.Dispose()
      }
    }
  } finally {
    $input.Dispose()
  }

  $verifyPath = Join-Path $stage "DORN_AI_EXE.verify"
  $verifyStream = [System.IO.File]::Create($verifyPath)
  try {
    for ($part = 0; $part -lt 13; $part++) {
      $partPath = Join-Path $stage ("DORN_AI_EXE.part{0:D3}" -f $part)
      $partStream = [System.IO.File]::OpenRead($partPath)
      try {
        $partStream.CopyTo($verifyStream)
      } finally {
        $partStream.Dispose()
      }
    }
  } finally {
    $verifyStream.Dispose()
  }
  $verifySize = (Get-Item -LiteralPath $verifyPath).Length
  $verifyHash = (Get-FileHash -LiteralPath $verifyPath -Algorithm SHA256).Hash
  if ($verifySize -ne $exeSize -or $verifyHash -ne $exeHash) {
    throw "Los trece fragmentos no reconstruyen exactamente DORN AI.exe."
  }
  Write-Host "Fragmentos verificados · $verifySize bytes · SHA-256 $verifyHash"
  Remove-Item -LiteralPath $verifyPath -Force
  Remove-Item -LiteralPath $exe -Force

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null
  & $MakensisPath "/DAPP_SOURCE=$stage" "/DDORN_EXE_SIZE=$exeSize" "/DOUTPUT_FILE=$output" $script
  if ($LASTEXITCODE -ne 0) {
    throw "NSIS terminó con código $LASTEXITCODE."
  }
} finally {
  if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
}

Get-Item -LiteralPath $output
Get-FileHash -LiteralPath $output -Algorithm SHA256
