#!/usr/bin/env bash
set -euo pipefail

installer_root="$(cd "$(dirname "$0")" && pwd)"
project_root="$(cd "$installer_root/../.." && pwd)"
output_path="${1:-$project_root/dist/DORN_AI_Installer_v2_4.0.0-alpha.7_x64.exe}"
zig_bin="${ZIG:-$project_root/build-tools/zig-linux-x64/zig}"
extractor="$project_root/node_modules/electron-winstaller/vendor/7z-x64.exe"
runtime_zip="$project_root/build-tools/electron-v37.2.6-win32-x64.zip"
work_root="$(mktemp -d "${TMPDIR:-/tmp}/dorn-installer-v2-build.XXXXXX")"
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1788307200}"
export ZIG_GLOBAL_CACHE_DIR="${ZIG_GLOBAL_CACHE_DIR:-$project_root/build-cache/zig-v2-global}"
export ZIG_LOCAL_CACHE_DIR="${ZIG_LOCAL_CACHE_DIR:-$project_root/build-cache/zig-v2-local}"

cleanup() {
  rm -rf -- "$work_root"
}
trap cleanup EXIT

test -x "$zig_bin"
test -f "$runtime_zip"
test -f "$extractor"
mkdir -p "$work_root/runtime" "$work_root/build" "$(dirname "$output_path")" "$ZIG_GLOBAL_CACHE_DIR" "$ZIG_LOCAL_CACHE_DIR"

DORN_ASAR_OFFLINE_REUSE=1 node "$project_root/scripts/build-app-asar.cjs" "$work_root/app.asar"
unzip -q "$runtime_zip" -d "$work_root/runtime"
node "$project_root/scripts/assemble-windows-portable.cjs" "$work_root/runtime" "$work_root/app.asar" "$work_root/portable"

(
  cd "$installer_root/native"
  "$zig_bin" rc /i . /fo "$work_root/build/dorn-installer-v2.res" -- dorn-installer-v2.rc
)
"$zig_bin" cc -target x86_64-windows-gnu -Os -s -Wl,--subsystem,windows \
  "$installer_root/native/dorn-installer-v2.c" "$work_root/build/dorn-installer-v2.res" \
  -o "$work_root/build/dorn-installer-v2-stub.exe" \
  -lcomctl32 -lshell32 -lole32 -luuid -lbcrypt -ladvapi32 -lgdi32 -luser32
"$zig_bin" cc -target x86_64-windows-gnu -Os -s -Wl,--subsystem,windows -DDORN_UNINSTALLER=1 \
  "$installer_root/native/dorn-installer-v2.c" "$work_root/build/dorn-installer-v2.res" \
  -o "$work_root/build/DORN AI Uninstall.exe" \
  -lcomctl32 -lshell32 -lole32 -luuid -lbcrypt -ladvapi32 -lgdi32 -luser32

node "$project_root/scripts/normalize-pe-timestamp.cjs" "$work_root/build/dorn-installer-v2-stub.exe" "$work_root/build/DORN AI Uninstall.exe"
node "$project_root/scripts/build-installer-v2.cjs" \
  "$work_root/build/dorn-installer-v2-stub.exe" "$work_root/portable" "$work_root/build/DORN AI Uninstall.exe" "$extractor" "$output_path"
node "$project_root/scripts/verify-installer-v2.cjs" "$output_path" "$work_root/portable"
