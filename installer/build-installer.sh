#!/usr/bin/env bash
set -euo pipefail

installer_root="$(cd "$(dirname "$0")" && pwd)"
portable_path="${1:-}"
makensis_bin="${MAKENSIS:-makensis}"
output_path="${2:-$installer_root/output/DORN_AI_Setup_4.0.0-alpha.7_x64.exe}"
stage_root=""

cleanup() {
  if [ -n "$stage_root" ] && [ -d "$stage_root" ]; then
    rm -rf -- "$stage_root"
  fi
}
trap cleanup EXIT

if [ -z "$portable_path" ]; then
  echo "Uso: ./build-installer.sh <carpeta-portable-v4> [archivo-salida.exe]" >&2
  exit 2
fi

if [ ! -f "$portable_path/DORN AI.exe" ]; then
  echo "Portable inválido: no se encontró DORN AI.exe en $portable_path" >&2
  exit 1
fi

node "$installer_root/../scripts/verify-windows-runtime.cjs" "$portable_path"

stage_root="$(mktemp -d "${TMPDIR:-/tmp}/dorn-installer-stage.XXXXXX")"
stage_path="$stage_root/app"
mkdir -p "$stage_path"
cp -a "$portable_path/." "$stage_path/"

exe_path="$stage_path/DORN AI.exe"
exe_size="$(stat -c '%s' "$exe_path")"
exe_sha256="$(sha256sum "$exe_path" | awk '{print $1}')"
split -b 16m -d -a 3 "$exe_path" "$stage_path/DORN_AI_EXE.part"

part_count="$(find "$stage_path" -maxdepth 1 -type f -name 'DORN_AI_EXE.part???' | wc -l)"
if [ "$part_count" -ne 13 ]; then
  echo "No se pudieron preparar los trece fragmentos verificables de DORN AI.exe." >&2
  exit 1
fi

part_bytes="$(find "$stage_path" -maxdepth 1 -type f -name 'DORN_AI_EXE.part???' -printf '%s\n' | awk '{total += $1} END {print total}')"
part_sha256="$(cat "$stage_path"/DORN_AI_EXE.part??? | sha256sum | awk '{print $1}')"
if [ "$part_bytes" -ne "$exe_size" ] || [ "$part_sha256" != "$exe_sha256" ]; then
  echo "Los fragmentos del instalador no reconstruyen exactamente DORN AI.exe." >&2
  exit 1
fi

printf 'Fragmentos verificados · %s bytes · SHA-256 %s\n' "$part_bytes" "$part_sha256"
rm -f -- "$exe_path"

mkdir -p "$installer_root/output"
NSISDIR="${NSISDIR:-}" "$makensis_bin" \
  "-DAPP_SOURCE=$stage_path" \
  "-DDORN_EXE_SIZE=$exe_size" \
  "-DOUTPUT_FILE=$output_path" \
  "$installer_root/dorn-installer.nsi"

sha256sum "$output_path"
