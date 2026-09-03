#!/usr/bin/env bash
set -euo pipefail

installer_root="$(cd "$(dirname "$0")" && pwd)"
project_root="$(cd "$installer_root/.." && pwd)"
zig_bin="${ZIG:-$project_root/build-tools/zig-linux-x64/zig}"
portable_path="${1:-}"
output_path="${2:-$installer_root/output/DORN_AI_Setup_4.0.0-alpha.7_x64.exe}"
build_dir="${TMPDIR:-/tmp}/dorn-native-installer-build"
export ZIG_GLOBAL_CACHE_DIR="${ZIG_GLOBAL_CACHE_DIR:-$project_root/build-cache/zig-global}"
export ZIG_LOCAL_CACHE_DIR="${ZIG_LOCAL_CACHE_DIR:-$project_root/build-cache/zig-local}"

if [ -z "$portable_path" ] || [ ! -f "$portable_path/DORN AI.exe" ]; then
  echo "Uso: ./build-native-installer.sh <carpeta-portable> [salida.exe]" >&2
  exit 2
fi
if [ ! -x "$zig_bin" ]; then
  echo "No se encontró el compilador Zig bloqueado en $zig_bin" >&2
  exit 1
fi

mkdir -p "$build_dir" "$(dirname "$output_path")" "$ZIG_GLOBAL_CACHE_DIR" "$ZIG_LOCAL_CACHE_DIR"
"$zig_bin" rc /i "$installer_root/native" /fo "$build_dir/dorn-installer.res" -- "$installer_root/native/dorn-installer.rc"
"$zig_bin" cc -target x86_64-windows-gnu -Os -s -Wl,--subsystem,windows \
  "$installer_root/native/dorn-installer.c" "$build_dir/dorn-installer.res" \
  -o "$build_dir/dorn-installer-stub.exe" -lcomctl32 -lshell32 -lole32 -lbcrypt -ladvapi32 -lgdi32 -luser32
"$zig_bin" cc -target x86_64-windows-gnu -Os -s -Wl,--subsystem,windows -DDORN_UNINSTALLER=1 \
  "$installer_root/native/dorn-installer.c" "$build_dir/dorn-installer.res" \
  -o "$build_dir/DORN AI Uninstall.exe" -lcomctl32 -lshell32 -lole32 -lbcrypt -ladvapi32 -lgdi32 -luser32

node "$project_root/scripts/build-native-installer.cjs" \
  "$build_dir/dorn-installer-stub.exe" "$portable_path" "$build_dir/DORN AI Uninstall.exe" "$output_path"
sha256sum "$output_path"
