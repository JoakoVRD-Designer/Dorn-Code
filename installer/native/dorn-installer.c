#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <commctrl.h>
#include <shlobj.h>
#include <bcrypt.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>
#include <wctype.h>
#include <strsafe.h>

#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "bcrypt.lib")

#define DORN_VERSION L"4.0.0-alpha.7"
#define DORN_TRAILER_MAGIC "DORNZIP3"
#define DORN_TRAILER_SIZE 56
#define DORN_MAX_PATH 32768
#define WM_DORN_STATUS (WM_APP + 31)
#define WM_DORN_FINISH (WM_APP + 32)
#define DORN_ANIMATION_TIMER 77

#define IDC_PATH 1001
#define IDC_BROWSE 1002
#define IDC_MAIN_DESKTOP 1010
#define IDC_DESIGN 1011
#define IDC_EDITOR 1012
#define IDC_EDUCATION 1013
#define IDC_MACHINE 1014
#define IDC_LAUNCH 1015
#define IDC_INSTALL 1020
#define IDC_CANCEL 1021
#define IDC_PROGRESS 1030
#define IDC_STATUS 1031

typedef struct DornTrailer {
  char magic[8];
  uint64_t offset;
  uint64_t size;
  unsigned char sha256[32];
} DornTrailer;

typedef struct InstallOptions {
  HWND window;
  wchar_t installPath[DORN_MAX_PATH];
  BOOL desktopMain;
  BOOL design;
  BOOL editor;
  BOOL education;
  BOOL machine;
  BOOL launch;
} InstallOptions;

static HINSTANCE g_instance;
static HWND g_window;
static HWND g_progress;
static HWND g_status;
static HWND g_installButton;
static HWND g_cancelButton;
static HFONT g_font;
static HFONT g_smallFont;
static HFONT g_titleFont;
static HFONT g_headingFont;
static HBRUSH g_backgroundBrush;
static HBRUSH g_panelBrush;
static HBRUSH g_editBrush;
static HBITMAP g_forestBitmap;
static unsigned int g_animationFrame = 0;
static volatile LONG g_installing = 0;

typedef struct DornParticle {
  int x;
  int y;
  int speed;
  int phase;
  int radius;
} DornParticle;

static const DornParticle g_particles[] = {
  {38, 91, 1, 3, 2}, {81, 238, 2, 17, 1}, {126, 162, 1, 29, 2},
  {169, 326, 2, 7, 1}, {218, 112, 1, 23, 2}, {266, 257, 2, 37, 1},
  {53, 421, 1, 11, 2}, {112, 505, 2, 31, 1}, {192, 452, 1, 41, 2},
  {251, 529, 2, 19, 1}, {287, 382, 1, 5, 2}, {151, 64, 2, 47, 1}
};

static COLORREF rgb(unsigned int hex) {
  return RGB((hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff);
}

static wchar_t *heap_wcsdup(const wchar_t *value) {
  size_t length = wcslen(value) + 1;
  wchar_t *copy = (wchar_t *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, length * sizeof(wchar_t));
  if (copy) memcpy(copy, value, length * sizeof(wchar_t));
  return copy;
}

static void post_status(HWND window, int progress, const wchar_t *message) {
  wchar_t *copy = heap_wcsdup(message ? message : L"");
  PostMessageW(window, WM_DORN_STATUS, (WPARAM)progress, (LPARAM)copy);
}

static void post_finish(HWND window, BOOL ok, const wchar_t *message) {
  wchar_t *copy = heap_wcsdup(message ? message : L"");
  PostMessageW(window, WM_DORN_FINISH, (WPARAM)ok, (LPARAM)copy);
}

static BOOL write_all(HANDLE file, const void *buffer, DWORD bytes) {
  const unsigned char *cursor = (const unsigned char *)buffer;
  DWORD remaining = bytes;
  while (remaining) {
    DWORD written = 0;
    if (!WriteFile(file, cursor, remaining, &written, NULL) || !written) return FALSE;
    cursor += written;
    remaining -= written;
  }
  return TRUE;
}

static BOOL read_exact(HANDLE file, void *buffer, DWORD bytes) {
  unsigned char *cursor = (unsigned char *)buffer;
  DWORD remaining = bytes;
  while (remaining) {
    DWORD read = 0;
    if (!ReadFile(file, cursor, remaining, &read, NULL) || !read) return FALSE;
    cursor += read;
    remaining -= read;
  }
  return TRUE;
}

static wchar_t *powershell_quote(const wchar_t *value) {
  size_t sourceLength = wcslen(value);
  size_t quoteCount = 0;
  for (size_t index = 0; index < sourceLength; index++) if (value[index] == L'\'') quoteCount++;
  size_t resultLength = sourceLength + quoteCount + 3;
  wchar_t *result = (wchar_t *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, resultLength * sizeof(wchar_t));
  if (!result) return NULL;
  size_t output = 0;
  result[output++] = L'\'';
  for (size_t index = 0; index < sourceLength; index++) {
    result[output++] = value[index];
    if (value[index] == L'\'') result[output++] = L'\'';
  }
  result[output++] = L'\'';
  result[output] = 0;
  return result;
}

static BOOL write_utf16_script(const wchar_t *path, const wchar_t *content) {
  HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_TEMPORARY, NULL);
  if (file == INVALID_HANDLE_VALUE) return FALSE;
  const unsigned char bom[2] = {0xff, 0xfe};
  BOOL ok = write_all(file, bom, 2) && write_all(file, content, (DWORD)(wcslen(content) * sizeof(wchar_t)));
  CloseHandle(file);
  return ok;
}

static DWORD run_powershell(const wchar_t *scriptPath, BOOL wait) {
  wchar_t command[DORN_MAX_PATH + 256];
  StringCchPrintfW(command, ARRAYSIZE(command),
    L"powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"%s\"", scriptPath);
  STARTUPINFOW startup;
  PROCESS_INFORMATION process;
  ZeroMemory(&startup, sizeof(startup));
  ZeroMemory(&process, sizeof(process));
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESHOWWINDOW;
  startup.wShowWindow = SW_HIDE;
  if (!CreateProcessW(NULL, command, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &startup, &process)) {
    return GetLastError();
  }
  DWORD exitCode = 0;
  if (wait) {
    WaitForSingleObject(process.hProcess, INFINITE);
    if (!GetExitCodeProcess(process.hProcess, &exitCode)) exitCode = GetLastError();
  }
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return exitCode;
}

static BOOL hash_file_range(HANDLE source, uint64_t offset, uint64_t size, HANDLE destination, unsigned char output[32]) {
  BCRYPT_ALG_HANDLE algorithm = NULL;
  BCRYPT_HASH_HANDLE hash = NULL;
  DWORD objectLength = 0;
  DWORD resultLength = 0;
  unsigned char *hashObject = NULL;
  unsigned char *buffer = NULL;
  BOOL ok = FALSE;
  LARGE_INTEGER seek;
  seek.QuadPart = (LONGLONG)offset;

  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, NULL, 0) < 0) goto cleanup;
  if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, (PUCHAR)&objectLength, sizeof(objectLength), &resultLength, 0) < 0) goto cleanup;
  hashObject = (unsigned char *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, objectLength);
  buffer = (unsigned char *)HeapAlloc(GetProcessHeap(), 0, 1024 * 1024);
  if (!hashObject || !buffer) goto cleanup;
  if (BCryptCreateHash(algorithm, &hash, hashObject, objectLength, NULL, 0, 0) < 0) goto cleanup;
  if (!SetFilePointerEx(source, seek, NULL, FILE_BEGIN)) goto cleanup;

  uint64_t remaining = size;
  while (remaining) {
    DWORD requested = remaining > 1024 * 1024 ? 1024 * 1024 : (DWORD)remaining;
    DWORD read = 0;
    if (!ReadFile(source, buffer, requested, &read, NULL) || read != requested) goto cleanup;
    if (BCryptHashData(hash, buffer, read, 0) < 0) goto cleanup;
    if (destination != INVALID_HANDLE_VALUE && !write_all(destination, buffer, read)) goto cleanup;
    remaining -= read;
  }
  if (BCryptFinishHash(hash, output, 32, 0) < 0) goto cleanup;
  ok = TRUE;

cleanup:
  if (hash) BCryptDestroyHash(hash);
  if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
  if (hashObject) HeapFree(GetProcessHeap(), 0, hashObject);
  if (buffer) HeapFree(GetProcessHeap(), 0, buffer);
  return ok;
}

static BOOL extract_embedded_payload(const wchar_t *zipPath, wchar_t *error, size_t errorCount) {
  wchar_t self[DORN_MAX_PATH];
  if (!GetModuleFileNameW(NULL, self, ARRAYSIZE(self))) {
    StringCchCopyW(error, errorCount, L"No se pudo localizar el instalador.");
    return FALSE;
  }
  HANDLE source = CreateFileW(self, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (source == INVALID_HANDLE_VALUE) {
    StringCchCopyW(error, errorCount, L"No se pudo abrir el instalador para verificar su contenido.");
    return FALSE;
  }
  LARGE_INTEGER fileSize;
  DornTrailer trailer;
  ZeroMemory(&trailer, sizeof(trailer));
  BOOL ok = FALSE;
  if (!GetFileSizeEx(source, &fileSize) || fileSize.QuadPart < DORN_TRAILER_SIZE) {
    StringCchCopyW(error, errorCount, L"El instalador está incompleto.");
    goto cleanup;
  }
  LARGE_INTEGER trailerPosition;
  trailerPosition.QuadPart = fileSize.QuadPart - DORN_TRAILER_SIZE;
  if (!SetFilePointerEx(source, trailerPosition, NULL, FILE_BEGIN) || !read_exact(source, &trailer, sizeof(trailer))) {
    StringCchCopyW(error, errorCount, L"No se pudo leer el manifiesto del instalador.");
    goto cleanup;
  }
  if (memcmp(trailer.magic, DORN_TRAILER_MAGIC, 8) != 0 ||
      trailer.offset + trailer.size + DORN_TRAILER_SIZE != (uint64_t)fileSize.QuadPart ||
      trailer.size < 1024 * 1024) {
    StringCchCopyW(error, errorCount, L"El contenido del instalador no coincide con el formato DORN.");
    goto cleanup;
  }
  HANDLE destination = CreateFileW(zipPath, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_TEMPORARY, NULL);
  if (destination == INVALID_HANDLE_VALUE) {
    StringCchCopyW(error, errorCount, L"No se pudo preparar el archivo temporal de instalación.");
    goto cleanup;
  }
  unsigned char actualHash[32];
  BOOL copied = hash_file_range(source, trailer.offset, trailer.size, destination, actualHash);
  CloseHandle(destination);
  if (!copied || memcmp(actualHash, trailer.sha256, 32) != 0) {
    DeleteFileW(zipPath);
    StringCchCopyW(error, errorCount, L"La verificación SHA-256 del paquete falló. Descarga nuevamente el instalador.");
    goto cleanup;
  }
  ok = TRUE;

cleanup:
  CloseHandle(source);
  return ok;
}

static BOOL valid_install_path(const wchar_t *path) {
  size_t length = wcslen(path);
  if (length < 4 || length >= DORN_MAX_PATH - 128) return FALSE;
  if (!iswalpha(path[0]) || path[1] != L':' || (path[2] != L'\\' && path[2] != L'/')) return FALSE;
  if (wcsstr(path, L"..")) return FALSE;
  return TRUE;
}

static BOOL create_unique_temp_directory(const wchar_t *tempRoot, wchar_t *output, size_t outputCount) {
  GUID guid;
  wchar_t guidText[64];
  if (FAILED(CoCreateGuid(&guid)) || !StringFromGUID2(&guid, guidText, ARRAYSIZE(guidText))) return FALSE;
  for (wchar_t *cursor = guidText; *cursor; cursor++) {
    if (*cursor == L'{' || *cursor == L'}') *cursor = L'-';
  }
  if (FAILED(StringCchPrintfW(output, outputCount, L"%sDORN-AI-Setup%s", tempRoot, guidText))) return FALSE;
  return CreateDirectoryW(output, NULL) != 0;
}

static void trim_path_end(wchar_t *value) {
  size_t length = wcslen(value);
  while (length > 3 && (value[length - 1] == L'\\' || value[length - 1] == L'/')) value[--length] = 0;
}

static BOOL same_windows_path(const wchar_t *left, const wchar_t *right) {
  wchar_t a[DORN_MAX_PATH], b[DORN_MAX_PATH];
  if (FAILED(StringCchCopyW(a, ARRAYSIZE(a), left)) || FAILED(StringCchCopyW(b, ARRAYSIZE(b), right))) return FALSE;
  trim_path_end(a);
  trim_path_end(b);
  return CompareStringOrdinal(a, -1, b, -1, TRUE) == CSTR_EQUAL;
}

static BOOL read_small_utf8_file(const wchar_t *filePath, char *buffer, DWORD capacity) {
  HANDLE file = CreateFileW(filePath, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return FALSE;
  LARGE_INTEGER size;
  BOOL ok = GetFileSizeEx(file, &size) && size.QuadPart > 0 && size.QuadPart < capacity;
  DWORD read = 0;
  if (ok) ok = ReadFile(file, buffer, (DWORD)size.QuadPart, &read, NULL) && read == (DWORD)size.QuadPart;
  if (ok) buffer[read] = 0;
  CloseHandle(file);
  return ok;
}

static BOOL owned_uninstall_location(const wchar_t *self, const wchar_t *target, wchar_t *error, size_t errorCount) {
  if (!valid_install_path(target) || wcslen(target) <= 3) {
    StringCchCopyW(error, errorCount, L"La ubicación del desinstalador no es una carpeta DORN segura.");
    return FALSE;
  }
  DWORD targetAttributes = GetFileAttributesW(target);
  if (targetAttributes == INVALID_FILE_ATTRIBUTES || !(targetAttributes & FILE_ATTRIBUTE_DIRECTORY) || (targetAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
    StringCchCopyW(error, errorCount, L"La carpeta instalada no existe o es un enlace no permitido.");
    return FALSE;
  }
  wchar_t expectedSelf[DORN_MAX_PATH];
  if (FAILED(StringCchPrintfW(expectedSelf, ARRAYSIZE(expectedSelf), L"%s\\DORN AI Uninstall.exe", target)) || !same_windows_path(self, expectedSelf)) {
    StringCchCopyW(error, errorCount, L"Este desinstalador fue movido. Ejecútalo desde la carpeta instalada de DORN AI.");
    return FALSE;
  }
  wchar_t ownerPath[DORN_MAX_PATH], manifestPath[DORN_MAX_PATH];
  StringCchPrintfW(ownerPath, ARRAYSIZE(ownerPath), L"%s\\DORN-INSTALL-OWNERSHIP.json", target);
  StringCchPrintfW(manifestPath, ARRAYSIZE(manifestPath), L"%s\\DORN-INSTALL-MANIFEST.json", target);
  DWORD ownerAttributes = GetFileAttributesW(ownerPath);
  DWORD manifestAttributes = GetFileAttributesW(manifestPath);
  if (ownerAttributes == INVALID_FILE_ATTRIBUTES || manifestAttributes == INVALID_FILE_ATTRIBUTES ||
      (ownerAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) ||
      (manifestAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT))) {
    StringCchCopyW(error, errorCount, L"Faltan los manifiestos que demuestran que esta carpeta pertenece a DORN AI.");
    return FALSE;
  }
  char owner[8192];
  if (!read_small_utf8_file(ownerPath, owner, ARRAYSIZE(owner)) ||
      !strstr(owner, "dorn.install-ownership/1") || !strstr(owner, "com.dorn.ai") || !strstr(owner, "DORN AI")) {
    StringCchCopyW(error, errorCount, L"El manifiesto de propiedad de la instalación no es válido.");
    return FALSE;
  }
  HKEY key = NULL;
  const wchar_t *registryPath = L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DORN AI";
  if (RegOpenKeyExW(HKEY_CURRENT_USER, registryPath, 0, KEY_QUERY_VALUE, &key) != ERROR_SUCCESS) {
    StringCchCopyW(error, errorCount, L"DORN AI no está registrado como instalado para este usuario.");
    return FALSE;
  }
  wchar_t registered[DORN_MAX_PATH];
  DWORD type = 0, bytes = sizeof(registered);
  LONG query = RegQueryValueExW(key, L"InstallLocation", NULL, &type, (LPBYTE)registered, &bytes);
  RegCloseKey(key);
  if (query != ERROR_SUCCESS || (type != REG_SZ && type != REG_EXPAND_SZ) || bytes < sizeof(wchar_t)) {
    StringCchCopyW(error, errorCount, L"El registro de instalación DORN está incompleto.");
    return FALSE;
  }
  registered[ARRAYSIZE(registered) - 1] = 0;
  if (!same_windows_path(target, registered)) {
    StringCchCopyW(error, errorCount, L"La carpeta del desinstalador no coincide con la ubicación registrada de DORN AI.");
    return FALSE;
  }
  return TRUE;
}

static BOOL validate_install_tree_with_powershell(const wchar_t *target, const wchar_t *scriptPath) {
  wchar_t *qTarget = powershell_quote(target);
  if (!qTarget) return FALSE;
  const size_t capacity = 48 * 1024;
  wchar_t *script = (wchar_t *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, capacity * sizeof(wchar_t));
  if (!script) { HeapFree(GetProcessHeap(), 0, qTarget); return FALSE; }
  HRESULT formatted = StringCchPrintfW(script, capacity,
    L"$ErrorActionPreference='Stop'\r\n$root=%s\r\n$ownerName='DORN-INSTALL-OWNERSHIP.json'\r\n$manifestName='DORN-INSTALL-MANIFEST.json'\r\n"
    L"try{$rootItem=Get-Item -LiteralPath $root -Force;if(($rootItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne 0){exit 41}\r\n"
    L"if(@(Get-ChildItem -LiteralPath $root -Force -Recurse|Where-Object{($_.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne 0}).Count-ne 0){exit 42}\r\n"
    L"$ownerPath=Join-Path $root $ownerName;$manifestPath=Join-Path $root $manifestName\r\n"
    L"$owner=Get-Content -LiteralPath $ownerPath -Raw|ConvertFrom-Json;$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json\r\n"
    L"if(($owner.schema-ne'dorn.install-ownership/1')-or($owner.product-ne'DORN AI')-or($owner.appId-ne'com.dorn.ai')){exit 43}\r\n"
    L"if(($manifest.schema-ne'dorn.install-files/1')-or($manifest.product-ne'DORN AI')-or($manifest.appId-ne'com.dorn.ai')-or($manifest.version-ne$owner.version)){exit 44}\r\n"
    L"if((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()-ne([string]$owner.manifestSha256).ToLowerInvariant()){exit 45}\r\n"
    L"$prefix=[IO.Path]::GetFullPath($root).TrimEnd('\\')+'\\';$expected=@{}\r\n"
    L"foreach($file in @($manifest.files)){$rel=[string]$file.path;$parts=@($rel-split'[/\\]');if([IO.Path]::IsPathRooted($rel)-or$parts.Count-eq 0-or@($parts|Where-Object{$_-eq''-or$_-eq'.'-or$_-eq'..'}).Count-ne 0){exit 46}\r\n"
    L"$full=[IO.Path]::GetFullPath((Join-Path $root ($rel-replace'/','\\')));if(-not$full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){exit 47}\r\n"
    L"$key=($rel-replace'\\','/').ToLowerInvariant();if($expected.ContainsKey($key)){exit 48};$expected[$key]=$file\r\n"
    L"if(-not(Test-Path -LiteralPath $full -PathType Leaf)){exit 49};$item=Get-Item -LiteralPath $full -Force\r\n"
    L"if(($item.Length-ne[long]$file.sizeBytes)-or((Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()-ne([string]$file.sha256).ToLowerInvariant())){exit 50}}\r\n"
    L"$actual=@(Get-ChildItem -LiteralPath $root -File -Force -Recurse|Where-Object{$_.FullName-ne$ownerPath-and$_.FullName-ne$manifestPath});if($actual.Count-ne$expected.Count){exit 51}\r\n"
    L"foreach($item in $actual){$rel=$item.FullName.Substring($prefix.Length)-replace'\\','/';$key=$rel.ToLowerInvariant();if((-not$expected.ContainsKey($key))-or(-not([string]$expected[$key].path-ceq$rel))){exit 52}};exit 0}catch{exit 53}\r\n",
    qTarget);
  BOOL written = SUCCEEDED(formatted) && write_utf16_script(scriptPath, script);
  HeapFree(GetProcessHeap(), 0, script);
  HeapFree(GetProcessHeap(), 0, qTarget);
  if (!written) return FALSE;
  return run_powershell(scriptPath, TRUE) == 0;
}

static DWORD WINAPI install_worker(LPVOID parameter) {
  InstallOptions *options = (InstallOptions *)parameter;
  wchar_t tempRoot[DORN_MAX_PATH] = {0};
  wchar_t tempDirectory[DORN_MAX_PATH] = {0};
  wchar_t zipPath[DORN_MAX_PATH] = {0};
  wchar_t scriptPath[DORN_MAX_PATH] = {0};
  wchar_t error[512] = {0};
  wchar_t *qZip = NULL, *qTarget = NULL, *qStage = NULL;
  wchar_t *script = NULL;
  BOOL success = FALSE;

  post_status(options->window, 5, L"Validando el paquete firmado por manifiesto…");
  if (!GetTempPathW(ARRAYSIZE(tempRoot), tempRoot)) {
    StringCchCopyW(error, ARRAYSIZE(error), L"Windows no devolvió una carpeta temporal válida.");
    goto cleanup;
  }
  if (!create_unique_temp_directory(tempRoot, tempDirectory, ARRAYSIZE(tempDirectory))) {
    StringCchCopyW(error, ARRAYSIZE(error), L"No se pudo reservar una carpeta temporal exclusiva para DORN.");
    goto cleanup;
  }
  StringCchPrintfW(zipPath, ARRAYSIZE(zipPath), L"%s\\payload.zip", tempDirectory);
  StringCchPrintfW(scriptPath, ARRAYSIZE(scriptPath), L"%s\\install.ps1", tempDirectory);
  if (!extract_embedded_payload(zipPath, error, ARRAYSIZE(error))) goto cleanup;

  post_status(options->window, 28, L"Integridad verificada. Preparando DORN AI…");
  wchar_t stagePath[DORN_MAX_PATH];
  StringCchPrintfW(stagePath, ARRAYSIZE(stagePath), L"%s\\payload", tempDirectory);
  qZip = powershell_quote(zipPath);
  qTarget = powershell_quote(options->installPath);
  qStage = powershell_quote(stagePath);
  if (!qZip || !qTarget || !qStage) {
    StringCchCopyW(error, ARRAYSIZE(error), L"No hubo memoria suficiente para preparar la instalación.");
    goto cleanup;
  }

  size_t capacity = 96 * 1024;
  script = (wchar_t *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, capacity * sizeof(wchar_t));
  if (!script) {
    StringCchCopyW(error, ARRAYSIZE(error), L"No hubo memoria suficiente para crear el plan de instalación.");
    goto cleanup;
  }

  HRESULT formatResult = StringCchPrintfW(script, capacity,
    L"$ErrorActionPreference='Stop'\r\n"
    L"$zip=%s\r\n$target=%s\r\n$stage=%s\r\n"
    L"$ownerName='DORN-INSTALL-OWNERSHIP.json'\r\n$manifestName='DORN-INSTALL-MANIFEST.json'\r\n"
    L"function Test-DornTree([string]$root){try{\r\n"
    L"$rootItem=Get-Item -LiteralPath $root -Force -ErrorAction Stop\r\n"
    L"if(($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){return $false}\r\n"
    L"if(@(Get-ChildItem -LiteralPath $root -Force -Recurse|Where-Object{($_.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0}).Count-ne 0){return $false}\r\n"
    L"$ownerPath=Join-Path $root $ownerName;$manifestPath=Join-Path $root $manifestName\r\n"
    L"if((-not (Test-Path -LiteralPath $ownerPath -PathType Leaf)) -or (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf))){return $false}\r\n"
    L"$owner=Get-Content -LiteralPath $ownerPath -Raw|ConvertFrom-Json;$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json\r\n"
    L"if(($owner.schema -ne 'dorn.install-ownership/1') -or ($owner.product -ne 'DORN AI') -or ($owner.appId -ne 'com.dorn.ai')){return $false}\r\n"
    L"if(($manifest.schema -ne 'dorn.install-files/1') -or ($manifest.product -ne 'DORN AI') -or ($manifest.appId -ne 'com.dorn.ai') -or ($manifest.version -ne $owner.version)){return $false}\r\n"
    L"if((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()-ne([string]$owner.manifestSha256).ToLowerInvariant()){return $false}\r\n"
    L"$prefix=[IO.Path]::GetFullPath($root).TrimEnd('\\')+'\\';$expected=@{}\r\n"
    L"foreach($file in @($manifest.files)){$rel=[string]$file.path;$parts=@($rel-split'[/\\]')\r\n"
    L"if([IO.Path]::IsPathRooted($rel) -or $parts.Count -eq 0 -or @($parts|Where-Object{$_ -eq '' -or $_ -eq '.' -or $_ -eq '..'}).Count -ne 0){return $false}\r\n"
    L"$full=[IO.Path]::GetFullPath((Join-Path $root ($rel-replace'/','\\')));if(-not$full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){return $false}\r\n"
    L"$key=($rel-replace'\\','/').ToLowerInvariant();if($expected.ContainsKey($key)){return $false};$expected[$key]=$file\r\n"
    L"if(-not(Test-Path -LiteralPath $full -PathType Leaf)){return $false};$item=Get-Item -LiteralPath $full -Force\r\n"
    L"if(($item.Length -ne [long]$file.sizeBytes) -or ((Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant() -ne ([string]$file.sha256).ToLowerInvariant())){return $false}}\r\n"
    L"$actual=@(Get-ChildItem -LiteralPath $root -File -Force -Recurse|Where-Object{$_.FullName -ne $ownerPath -and $_.FullName -ne $manifestPath})\r\n"
    L"if($actual.Count -ne $expected.Count){return $false};foreach($item in $actual){$rel=$item.FullName.Substring($prefix.Length)-replace'\\','/';$key=$rel.ToLowerInvariant();if((-not $expected.ContainsKey($key)) -or (-not ([string]$expected[$key].path -ceq $rel))){return $false}}\r\n"
    L"return $true}catch{return $false}}\r\n"
    L"try {\r\n"
    L"if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}\r\n"
    L"New-Item -ItemType Directory -Path $stage -Force|Out-Null\r\n"
    L"Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force\r\n"
    L"if(-not(Test-DornTree $stage)){throw 'El conjunto de archivos del paquete no supera la verificación exacta'}\r\n"
    L"$targetExists=Test-Path -LiteralPath $target;$targetEntries=@();$backup=$null;$createdTarget=$false\r\n"
    L"if($targetExists){$targetItem=Get-Item -LiteralPath $target -Force;if((-not $targetItem.PSIsContainer) -or (($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'La ruta de instalación no es una carpeta local segura'}\r\n"
    L"$targetEntries=@(Get-ChildItem -LiteralPath $target -Force);if(($targetEntries.Count -gt 0) -and (-not (Test-DornTree $target))){throw 'La carpeta no está vacía ni pertenece a una instalación DORN verificable'}}\r\n"
    L"try{if($targetExists){if($targetEntries.Count-gt 0){$backup=$target+'.dorn-backup-'+[Guid]::NewGuid().ToString('N');Move-Item -LiteralPath $target -Destination $backup}else{Remove-Item -LiteralPath $target -Force}}\r\n"
    L"New-Item -ItemType Directory -Path $target|Out-Null;$createdTarget=$true\r\n"
    L"Get-ChildItem -LiteralPath $stage -Force|ForEach-Object{Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse}\r\n"
    L"if(-not(Test-DornTree $target)){throw 'La instalación copiada no coincide byte por byte con su manifiesto'}\r\n"
    L"$exe=Join-Path $target 'DORN AI.exe'\r\n"
    L"$shell=New-Object -ComObject WScript.Shell\r\n"
    L"$programs=[Environment]::GetFolderPath('Programs')\r\n$menu=Join-Path $programs 'DORN AI'\r\n"
    L"New-Item -ItemType Directory -Path $menu -Force|Out-Null\r\n"
    L"function New-DornShortcut([string]$path,[string]$args){$s=$shell.CreateShortcut($path);$s.TargetPath=$exe;$s.Arguments=$args;$s.WorkingDirectory=$target;$s.IconLocation=$exe+',0';$s.Save()}\r\n"
    L"New-DornShortcut (Join-Path $menu 'DORN AI.lnk') ''\r\n"
    L"if(%s){New-DornShortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'DORN AI.lnk') ''}\r\n"
    L"if(%s){New-DornShortcut (Join-Path $menu 'DORN Design.lnk') '--product=design';New-DornShortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'DORN Design.lnk') '--product=design'}\r\n"
    L"if(%s){New-DornShortcut (Join-Path $menu 'DORN Editor.lnk') '--product=editor';New-DornShortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'DORN Editor.lnk') '--product=editor'}\r\n"
    L"if(%s){New-DornShortcut (Join-Path $menu 'DORN Education.lnk') '--product=education';New-DornShortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'DORN Education.lnk') '--product=education'}\r\n"
    L"if(%s){New-DornShortcut (Join-Path $menu 'DORN Machine.lnk') '--product=machine';New-DornShortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'DORN Machine.lnk') '--product=machine'}\r\n"
    L"$reg='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DORN AI'\r\n"
    L"New-Item -Path $reg -Force|Out-Null\r\n"
    L"$uninstall='\"'+(Join-Path $target 'DORN AI Uninstall.exe')+'\"'\r\n"
    L"$estimated=[Math]::Max(1,[int]((Get-ChildItem -LiteralPath $target -File -Recurse|Measure-Object Length -Sum).Sum/1KB))\r\n"
    L"New-ItemProperty -Path $reg -Name DisplayName -Value 'DORN AI' -PropertyType String -Force|Out-Null\r\n"
    L"New-ItemProperty -Path $reg -Name DisplayVersion -Value '4.0.0-alpha.7' -PropertyType String -Force|Out-Null\r\n"
    L"New-ItemProperty -Path $reg -Name Publisher -Value 'DORN' -PropertyType String -Force|Out-Null\r\n"
    L"New-ItemProperty -Path $reg -Name InstallLocation -Value $target -PropertyType String -Force|Out-Null\r\n"
    L"New-ItemProperty -Path $reg -Name DisplayIcon -Value $exe -PropertyType String -Force|Out-Null\r\n"
    L"New-ItemProperty -Path $reg -Name UninstallString -Value $uninstall -PropertyType String -Force|Out-Null\r\n"
    L"New-ItemProperty -Path $reg -Name EstimatedSize -Value $estimated -PropertyType DWord -Force|Out-Null\r\n"
    L"New-ItemProperty -Path $reg -Name NoModify -Value 1 -PropertyType DWord -Force|Out-Null\r\n"
    L"New-ItemProperty -Path $reg -Name NoRepair -Value 1 -PropertyType DWord -Force|Out-Null\r\n"
    L"if($backup -and (Test-Path -LiteralPath $backup)){if(-not(Test-DornTree $backup)){throw 'El respaldo cambió durante la actualización y no se eliminará'};Remove-Item -LiteralPath $backup -Recurse -Force}\r\n"
    L"}catch{if($createdTarget -and (Test-Path -LiteralPath $target)){$failedItem=Get-Item -LiteralPath $target -Force;if($failedItem.PSIsContainer -and (($failedItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)){Remove-Item -LiteralPath $target -Recurse -Force}};if($backup -and (Test-Path -LiteralPath $backup) -and (-not(Test-Path -LiteralPath $target)) -and (Test-DornTree $backup)){Move-Item -LiteralPath $backup -Destination $target};throw}\r\n"
    L"} finally {if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}}\r\n",
    qZip, qTarget, qStage,
    options->desktopMain ? L"$true" : L"$false",
    options->design ? L"$true" : L"$false",
    options->editor ? L"$true" : L"$false",
    options->education ? L"$true" : L"$false",
    options->machine ? L"$true" : L"$false");
  if (FAILED(formatResult) || !write_utf16_script(scriptPath, script)) {
    StringCchCopyW(error, ARRAYSIZE(error), L"No se pudo escribir el plan de instalación local.");
    goto cleanup;
  }

  post_status(options->window, 48, L"Instalando el núcleo y los productos seleccionados…");
  DWORD result = run_powershell(scriptPath, TRUE);
  if (result != 0) {
    StringCchPrintfW(error, ARRAYSIZE(error), L"Windows no pudo completar la instalación (código %lu). Tus datos personales no fueron eliminados.", result);
    goto cleanup;
  }
  post_status(options->window, 92, L"Registrando accesos directos y desinstalador…");
  Sleep(250);
  success = TRUE;

  if (options->launch) {
    wchar_t executable[DORN_MAX_PATH];
    StringCchPrintfW(executable, ARRAYSIZE(executable), L"%s\\DORN AI.exe", options->installPath);
    STARTUPINFOW startup;
    PROCESS_INFORMATION process;
    ZeroMemory(&startup, sizeof(startup));
    ZeroMemory(&process, sizeof(process));
    startup.cb = sizeof(startup);
    wchar_t command[DORN_MAX_PATH + 8];
    StringCchPrintfW(command, ARRAYSIZE(command), L"\"%s\"", executable);
    if (CreateProcessW(executable, command, NULL, NULL, FALSE, 0, NULL, options->installPath, &startup, &process)) {
      CloseHandle(process.hThread);
      CloseHandle(process.hProcess);
    }
  }

cleanup:
  if (script) HeapFree(GetProcessHeap(), 0, script);
  if (qZip) HeapFree(GetProcessHeap(), 0, qZip);
  if (qTarget) HeapFree(GetProcessHeap(), 0, qTarget);
  if (qStage) HeapFree(GetProcessHeap(), 0, qStage);
  if (scriptPath[0]) DeleteFileW(scriptPath);
  if (zipPath[0]) DeleteFileW(zipPath);
  if (tempDirectory[0]) RemoveDirectoryW(tempDirectory);
  if (success) post_finish(options->window, TRUE, L"DORN AI quedó instalado y listo para iniciar.");
  else post_finish(options->window, FALSE, error[0] ? error : L"La instalación no pudo completarse.");
  HeapFree(GetProcessHeap(), 0, options);
  return 0;
}

static void start_installation(HWND window) {
  if (InterlockedCompareExchange(&g_installing, 1, 0) != 0) return;
  InstallOptions *options = (InstallOptions *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(InstallOptions));
  if (!options) {
    InterlockedExchange(&g_installing, 0);
    MessageBoxW(window, L"No hubo memoria suficiente para iniciar.", L"DORN AI", MB_OK | MB_ICONERROR);
    return;
  }
  options->window = window;
  GetWindowTextW(GetDlgItem(window, IDC_PATH), options->installPath, ARRAYSIZE(options->installPath));
  if (!valid_install_path(options->installPath)) {
    HeapFree(GetProcessHeap(), 0, options);
    InterlockedExchange(&g_installing, 0);
    MessageBoxW(window, L"Elige una ruta local absoluta y válida para instalar DORN AI.", L"Ruta no válida", MB_OK | MB_ICONWARNING);
    return;
  }
  options->desktopMain = IsDlgButtonChecked(window, IDC_MAIN_DESKTOP) == BST_CHECKED;
  options->design = IsDlgButtonChecked(window, IDC_DESIGN) == BST_CHECKED;
  options->editor = IsDlgButtonChecked(window, IDC_EDITOR) == BST_CHECKED;
  options->education = IsDlgButtonChecked(window, IDC_EDUCATION) == BST_CHECKED;
  options->machine = IsDlgButtonChecked(window, IDC_MACHINE) == BST_CHECKED;
  options->launch = IsDlgButtonChecked(window, IDC_LAUNCH) == BST_CHECKED;

  EnableWindow(GetDlgItem(window, IDC_PATH), FALSE);
  EnableWindow(GetDlgItem(window, IDC_BROWSE), FALSE);
  EnableWindow(g_installButton, FALSE);
  SetWindowTextW(g_cancelButton, L"Ocultar");
  SendMessageW(g_progress, PBM_SETPOS, 2, 0);
  SetWindowTextW(g_status, L"Iniciando verificación…");
  HANDLE thread = CreateThread(NULL, 0, install_worker, options, 0, NULL);
  if (!thread) {
    HeapFree(GetProcessHeap(), 0, options);
    InterlockedExchange(&g_installing, 0);
    EnableWindow(g_installButton, TRUE);
    MessageBoxW(window, L"Windows no pudo iniciar el proceso de instalación.", L"DORN AI", MB_OK | MB_ICONERROR);
  } else CloseHandle(thread);
}

static void browse_install_path(HWND window) {
  BROWSEINFOW info;
  ZeroMemory(&info, sizeof(info));
  info.hwndOwner = window;
  info.lpszTitle = L"Elige la carpeta base para DORN AI";
  info.ulFlags = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE | BIF_USENEWUI;
  PIDLIST_ABSOLUTE selection = SHBrowseForFolderW(&info);
  if (!selection) return;
  wchar_t path[DORN_MAX_PATH];
  if (SHGetPathFromIDListW(selection, path)) {
    size_t length = wcslen(path);
    if (length && path[length - 1] != L'\\') StringCchCatW(path, ARRAYSIZE(path), L"\\");
    StringCchCatW(path, ARRAYSIZE(path), L"DORN AI");
    SetWindowTextW(GetDlgItem(window, IDC_PATH), path);
  }
  CoTaskMemFree(selection);
}

static void set_control_font(HWND control, HFONT font) {
  SendMessageW(control, WM_SETFONT, (WPARAM)font, TRUE);
}

static HWND add_static(HWND parent, int id, const wchar_t *text, int x, int y, int width, int height, HFONT font) {
  HWND control = CreateWindowExW(0, L"STATIC", text, WS_CHILD | WS_VISIBLE, x, y, width, height, parent, (HMENU)(INT_PTR)id, g_instance, NULL);
  set_control_font(control, font);
  return control;
}

static HWND add_button(HWND parent, int id, const wchar_t *text, int x, int y, int width, int height, DWORD extraStyle) {
  HWND control = CreateWindowExW(0, L"BUTTON", text, WS_CHILD | WS_VISIBLE | WS_TABSTOP | extraStyle, x, y, width, height, parent, (HMENU)(INT_PTR)id, g_instance, NULL);
  set_control_font(control, g_font);
  return control;
}

static void create_installer_controls(HWND window) {
  add_static(window, 2001, L"DORN", 42, 34, 260, 72, g_titleFont);
  add_static(window, 2002, L"SISTEMA DE TRABAJO CON IA", 46, 112, 240, 22, g_smallFont);
  add_static(window, 2003, L"4.0 · ALPHA 7 · BOSQUE VIVO", 46, 505, 240, 22, g_smallFont);
  add_static(window, 2004, L"INSTALADOR NATIVO · WINDOWS 11 X64", 350, 38, 470, 22, g_smallFont);
  add_static(window, 2005, L"Configura DORN AI", 350, 72, 480, 42, g_headingFont);
  add_static(window, 2006, L"El núcleo se instala por usuario. Elige la ruta y los accesos directos de los productos que usarás.", 350, 118, 510, 46, g_font);
  add_static(window, 2007, L"CARPETA DE INSTALACIÓN", 350, 177, 300, 22, g_smallFont);

  HWND path = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_AUTOHSCROLL, 350, 203, 410, 36, window, (HMENU)(INT_PTR)IDC_PATH, g_instance, NULL);
  set_control_font(path, g_font);
  add_button(window, IDC_BROWSE, L"Examinar", 770, 203, 98, 36, BS_OWNERDRAW);

  add_static(window, 2008, L"ACCESOS Y PRODUCTOS", 350, 258, 300, 22, g_smallFont);
  add_button(window, IDC_MAIN_DESKTOP, L"DORN AI en el escritorio", 350, 287, 245, 26, BS_AUTOCHECKBOX);
  add_button(window, IDC_DESIGN, L"DORN Design", 350, 319, 245, 26, BS_AUTOCHECKBOX);
  add_button(window, IDC_EDITOR, L"DORN Editor", 610, 319, 245, 26, BS_AUTOCHECKBOX);
  add_button(window, IDC_EDUCATION, L"DORN Education", 350, 351, 245, 26, BS_AUTOCHECKBOX);
  add_button(window, IDC_MACHINE, L"DORN Machine", 610, 351, 245, 26, BS_AUTOCHECKBOX);
  add_button(window, IDC_LAUNCH, L"Iniciar DORN AI al finalizar", 350, 383, 300, 26, BS_AUTOCHECKBOX);
  CheckDlgButton(window, IDC_MAIN_DESKTOP, BST_CHECKED);
  CheckDlgButton(window, IDC_DESIGN, BST_CHECKED);
  CheckDlgButton(window, IDC_EDUCATION, BST_CHECKED);
  CheckDlgButton(window, IDC_LAUNCH, BST_CHECKED);

  g_progress = CreateWindowExW(0, PROGRESS_CLASSW, NULL, WS_CHILD | WS_VISIBLE | PBS_SMOOTH, 350, 430, 518, 10, window, (HMENU)(INT_PTR)IDC_PROGRESS, g_instance, NULL);
  SendMessageW(g_progress, PBM_SETRANGE, 0, MAKELPARAM(0, 100));
  SendMessageW(g_progress, PBM_SETBKCOLOR, 0, rgb(0x171b21));
  SendMessageW(g_progress, PBM_SETBARCOLOR, 0, rgb(0xc8d1dc));
  g_status = add_static(window, IDC_STATUS, L"Listo para instalar · el paquete se verificará antes de copiar archivos.", 350, 448, 510, 36, g_smallFont);

  g_installButton = add_button(window, IDC_INSTALL, L"Instalar DORN AI", 650, 498, 218, 44, BS_OWNERDRAW);
  g_cancelButton = add_button(window, IDC_CANCEL, L"Cancelar", 532, 498, 108, 44, BS_OWNERDRAW);

  wchar_t localAppData[DORN_MAX_PATH];
  if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, SHGFP_TYPE_CURRENT, localAppData))) {
    StringCchCatW(localAppData, ARRAYSIZE(localAppData), L"\\Programs\\DORN AI");
    SetWindowTextW(path, localAppData);
  } else SetWindowTextW(path, L"C:\\DORN AI");
}

static void draw_owner_button(const DRAWITEMSTRUCT *draw) {
  wchar_t text[128];
  GetWindowTextW(draw->hwndItem, text, ARRAYSIZE(text));
  BOOL primary = draw->CtlID == IDC_INSTALL;
  BOOL pressed = (draw->itemState & ODS_SELECTED) != 0;
  BOOL disabled = (draw->itemState & ODS_DISABLED) != 0;
  HBRUSH brush = CreateSolidBrush(disabled ? rgb(0x333840) : primary ? (pressed ? rgb(0x9ba8b6) : rgb(0xc8d1dc)) : (pressed ? rgb(0x242a31) : rgb(0x1a1f26)));
  HPEN pen = CreatePen(PS_SOLID, 1, primary ? rgb(0xe4e9ef) : rgb(0x3b434d));
  HGDIOBJ previousBrush = SelectObject(draw->hDC, brush);
  HGDIOBJ previousPen = SelectObject(draw->hDC, pen);
  RoundRect(draw->hDC, draw->rcItem.left, draw->rcItem.top, draw->rcItem.right, draw->rcItem.bottom, 10, 10);
  SelectObject(draw->hDC, g_font);
  SetBkMode(draw->hDC, TRANSPARENT);
  SetTextColor(draw->hDC, disabled ? rgb(0x707782) : primary ? rgb(0x090b0e) : rgb(0xe9edf2));
  DrawTextW(draw->hDC, text, -1, (RECT *)&draw->rcItem, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
  SelectObject(draw->hDC, previousBrush);
  SelectObject(draw->hDC, previousPen);
  DeleteObject(brush);
  DeleteObject(pen);
}

static LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
  switch (message) {
    case WM_CREATE:
      SetTimer(window, DORN_ANIMATION_TIMER, 42, NULL);
      return 0;
    case WM_TIMER:
      if (wParam == DORN_ANIMATION_TIMER) {
        g_animationFrame++;
        RECT animatedArea = {0, 0, 316, 566};
        InvalidateRect(window, &animatedArea, FALSE);
        return 0;
      }
      break;
    case WM_COMMAND:
      switch (LOWORD(wParam)) {
        case IDC_BROWSE: browse_install_path(window); return 0;
        case IDC_INSTALL: start_installation(window); return 0;
        case IDC_CANCEL:
          if (InterlockedCompareExchange(&g_installing, 0, 0)) ShowWindow(window, SW_MINIMIZE);
          else DestroyWindow(window);
          return 0;
      }
      break;
    case WM_DORN_STATUS: {
      wchar_t *messageText = (wchar_t *)lParam;
      SendMessageW(g_progress, PBM_SETPOS, wParam, 0);
      SetWindowTextW(g_status, messageText ? messageText : L"");
      if (messageText) HeapFree(GetProcessHeap(), 0, messageText);
      return 0;
    }
    case WM_DORN_FINISH: {
      wchar_t *messageText = (wchar_t *)lParam;
      BOOL ok = (BOOL)wParam;
      InterlockedExchange(&g_installing, 0);
      SendMessageW(g_progress, PBM_SETPOS, ok ? 100 : 0, 0);
      SetWindowTextW(g_status, messageText ? messageText : L"");
      SetWindowTextW(g_cancelButton, ok ? L"Cerrar" : L"Cancelar");
      if (!ok) {
        EnableWindow(g_installButton, TRUE);
        EnableWindow(GetDlgItem(window, IDC_PATH), TRUE);
        EnableWindow(GetDlgItem(window, IDC_BROWSE), TRUE);
        MessageBoxW(window, messageText, L"DORN AI no pudo instalar", MB_OK | MB_ICONERROR);
      } else MessageBoxW(window, messageText, L"DORN AI está listo", MB_OK | MB_ICONINFORMATION);
      if (messageText) HeapFree(GetProcessHeap(), 0, messageText);
      return 0;
    }
    case WM_DRAWITEM:
      draw_owner_button((const DRAWITEMSTRUCT *)lParam);
      return TRUE;
    case WM_CTLCOLORSTATIC: {
      HDC dc = (HDC)wParam;
      int id = GetDlgCtrlID((HWND)lParam);
      SetBkMode(dc, TRANSPARENT);
      if (id == 2001) SetTextColor(dc, rgb(0xe7ebf0));
      else if (id == 2002 || id == 2003 || id == 2004 || id == 2007 || id == 2008) SetTextColor(dc, rgb(0x84909e));
      else if (id == IDC_STATUS) SetTextColor(dc, rgb(0x98a4b2));
      else SetTextColor(dc, rgb(0xe7ebf0));
      if (id == 2001 || id == 2002 || id == 2003) return (LRESULT)GetStockObject(NULL_BRUSH);
      return (LRESULT)g_backgroundBrush;
    }
    case WM_CTLCOLOREDIT: {
      HDC dc = (HDC)wParam;
      SetTextColor(dc, rgb(0xe7ebf0));
      SetBkColor(dc, rgb(0x11151a));
      return (LRESULT)g_editBrush;
    }
    case WM_PAINT: {
      PAINTSTRUCT paint;
      HDC dc = BeginPaint(window, &paint);
      RECT client;
      GetClientRect(window, &client);
      HBRUSH background = CreateSolidBrush(rgb(0x090b0e));
      FillRect(dc, &client, background);
      DeleteObject(background);
      RECT side = {0, 0, 316, client.bottom};
      if (g_forestBitmap) {
        BITMAP bitmap;
        HDC memory = CreateCompatibleDC(dc);
        HGDIOBJ previousBitmap = SelectObject(memory, g_forestBitmap);
        GetObjectW(g_forestBitmap, sizeof(bitmap), &bitmap);
        SetStretchBltMode(dc, HALFTONE);
        StretchBlt(dc, 0, 0, 316, client.bottom, memory, 0, 0, bitmap.bmWidth, bitmap.bmHeight, SRCCOPY);
        SelectObject(memory, previousBitmap);
        DeleteDC(memory);
      } else {
        HBRUSH panel = CreateSolidBrush(rgb(0x0d1117));
        FillRect(dc, &side, panel);
        DeleteObject(panel);
      }
      for (size_t index = 0; index < ARRAYSIZE(g_particles); index++) {
        const DornParticle *particle = &g_particles[index];
        unsigned int phase = g_animationFrame + (unsigned int)particle->phase;
        int wave = (int)(phase % 48);
        if (wave > 24) wave = 48 - wave;
        int x = particle->x + wave / 4 - 3;
        int travel = (int)((phase * (unsigned int)particle->speed) % 520);
        int y = 545 - ((particle->y + travel) % 520);
        COLORREF glow = particle->radius > 1 ? rgb(0xb8e9f4) : rgb(0x62aebe);
        HBRUSH particleBrush = CreateSolidBrush(glow);
        HPEN particlePen = CreatePen(PS_SOLID, 1, glow);
        HGDIOBJ oldBrush = SelectObject(dc, particleBrush);
        HGDIOBJ oldParticlePen = SelectObject(dc, particlePen);
        Ellipse(dc, x - particle->radius, y - particle->radius, x + particle->radius + 1, y + particle->radius + 1);
        SelectObject(dc, oldBrush);
        SelectObject(dc, oldParticlePen);
        DeleteObject(particleBrush);
        DeleteObject(particlePen);
      }
      RECT pathCard = {336, 188, 884, 250};
      RECT productCard = {336, 272, 884, 418};
      HBRUSH cardBrush = CreateSolidBrush(rgb(0x0f1318));
      HPEN cardPen = CreatePen(PS_SOLID, 1, rgb(0x242c35));
      HGDIOBJ oldCardBrush = SelectObject(dc, cardBrush);
      HGDIOBJ oldCardPen = SelectObject(dc, cardPen);
      RoundRect(dc, pathCard.left, pathCard.top, pathCard.right, pathCard.bottom, 14, 14);
      RoundRect(dc, productCard.left, productCard.top, productCard.right, productCard.bottom, 14, 14);
      SelectObject(dc, oldCardBrush);
      SelectObject(dc, oldCardPen);
      DeleteObject(cardBrush);
      DeleteObject(cardPen);
      HPEN accent = CreatePen(PS_SOLID, 1, rgb(0x5f7f8a));
      HGDIOBJ oldPen = SelectObject(dc, accent);
      MoveToEx(dc, 316, 24, NULL);
      LineTo(dc, 316, client.bottom - 24);
      SelectObject(dc, oldPen);
      DeleteObject(accent);
      EndPaint(window, &paint);
      return 0;
    }
    case WM_CLOSE:
      if (InterlockedCompareExchange(&g_installing, 0, 0)) {
        if (MessageBoxW(window, L"La instalación sigue trabajando. Puedes ocultar esta ventana y esperar a que termine.", L"DORN AI", MB_OKCANCEL | MB_ICONINFORMATION) == IDOK) ShowWindow(window, SW_MINIMIZE);
        return 0;
      }
      DestroyWindow(window);
      return 0;
    case WM_DESTROY:
      KillTimer(window, DORN_ANIMATION_TIMER);
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(window, message, wParam, lParam);
}

#ifdef DORN_UNINSTALLER
static int run_uninstaller(void) {
  wchar_t self[DORN_MAX_PATH];
  wchar_t target[DORN_MAX_PATH];
  wchar_t temp[DORN_MAX_PATH];
  wchar_t scriptPath[DORN_MAX_PATH];
  wchar_t ownershipError[512] = {0};
  GetModuleFileNameW(NULL, self, ARRAYSIZE(self));
  StringCchCopyW(target, ARRAYSIZE(target), self);
  wchar_t *slash = wcsrchr(target, L'\\');
  if (!slash) return 2;
  *slash = 0;
  if (!owned_uninstall_location(self, target, ownershipError, ARRAYSIZE(ownershipError))) {
    MessageBoxW(NULL, ownershipError, L"Desinstalación bloqueada", MB_OK | MB_ICONERROR);
    return 4;
  }
  GetTempPathW(ARRAYSIZE(temp), temp);
  if (!GetTempFileNameW(temp, L"DOR", 0, scriptPath)) {
    MessageBoxW(NULL, L"Windows no pudo reservar un archivo temporal seguro para desinstalar.", L"Desinstalación bloqueada", MB_OK | MB_ICONERROR);
    return 7;
  }
  if (!validate_install_tree_with_powershell(target, scriptPath)) {
    DeleteFileW(scriptPath);
    MessageBoxW(NULL,
      L"La instalación contiene archivos faltantes, alterados o no declarados. DORN no borrará recursivamente esta carpeta. Reinstala en una carpeta limpia o revisa el contenido manualmente.",
      L"Integridad de instalación no válida", MB_OK | MB_ICONERROR);
    return 5;
  }
  if (MessageBoxW(NULL,
      L"¿Quieres quitar DORN AI de este computador?\n\nSe verificaron la carpeta registrada y todos sus archivos. Las conversaciones, preferencias y modelos guardados en AppData se conservarán.",
      L"Desinstalar DORN AI", MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2) != IDYES) {
    DeleteFileW(scriptPath);
    return 0;
  }
  wchar_t *qTarget = powershell_quote(target);
  if (!qTarget) return 6;
  wchar_t script[32768];
  StringCchPrintfW(script, ARRAYSIZE(script),
    L"$ErrorActionPreference='SilentlyContinue'\r\n$target=%s\r\n$pidToWait=%lu\r\n"
    L"Wait-Process -Id $pidToWait -ErrorAction SilentlyContinue\r\n"
    L"$reg='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DORN AI'\r\n"
    L"$registered=(Get-ItemProperty -LiteralPath $reg -Name InstallLocation -ErrorAction SilentlyContinue).InstallLocation\r\n"
    L"if([string]::IsNullOrWhiteSpace($registered)-or(-not([IO.Path]::GetFullPath($registered).TrimEnd('\\')-ieq[IO.Path]::GetFullPath($target).TrimEnd('\\')))){exit 61}\r\n"
    L"$owner=Join-Path $target 'DORN-INSTALL-OWNERSHIP.json';if(-not(Test-Path -LiteralPath $owner -PathType Leaf)){exit 62}\r\n"
    L"$desktop=[Environment]::GetFolderPath('Desktop')\r\n$programs=[Environment]::GetFolderPath('Programs')\r\n"
    L"@('DORN AI.lnk','DORN Design.lnk','DORN Editor.lnk','DORN Education.lnk','DORN Machine.lnk')|ForEach-Object{Remove-Item -LiteralPath (Join-Path $desktop $_) -Force}\r\n"
    L"Remove-Item -LiteralPath (Join-Path $programs 'DORN AI') -Recurse -Force\r\n"
    L"Remove-Item -LiteralPath $reg -Recurse -Force\r\n"
    L"Remove-Item -LiteralPath $target -Recurse -Force\r\nRemove-Item -LiteralPath $PSCommandPath -Force\r\n",
    qTarget, GetCurrentProcessId());
  HeapFree(GetProcessHeap(), 0, qTarget);
  if (!write_utf16_script(scriptPath, script)) return 3;
  run_powershell(scriptPath, FALSE);
  MessageBoxW(NULL, L"DORN AI se quitará al cerrar este mensaje. Tus datos de usuario se conservarán.", L"DORN AI", MB_OK | MB_ICONINFORMATION);
  return 0;
}
#endif

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR commandLine, int showCommand) {
  (void)previous;
  (void)commandLine;
  (void)showCommand;
#ifdef DORN_UNINSTALLER
  return run_uninstaller();
#else
  g_instance = instance;
  SetProcessDPIAware();
  CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
  INITCOMMONCONTROLSEX controls = {sizeof(controls), ICC_PROGRESS_CLASS | ICC_STANDARD_CLASSES};
  InitCommonControlsEx(&controls);

  g_backgroundBrush = CreateSolidBrush(rgb(0x090b0e));
  g_panelBrush = CreateSolidBrush(rgb(0x0d1117));
  g_editBrush = CreateSolidBrush(rgb(0x11151a));
  g_font = CreateFontW(-16, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
  g_smallFont = CreateFontW(-13, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
  g_titleFont = CreateFontW(-58, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
  g_headingFont = CreateFontW(-30, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
  g_forestBitmap = (HBITMAP)LoadImageW(instance, MAKEINTRESOURCEW(2), IMAGE_BITMAP, 0, 0, LR_CREATEDIBSECTION);

  WNDCLASSEXW windowClass;
  ZeroMemory(&windowClass, sizeof(windowClass));
  windowClass.cbSize = sizeof(windowClass);
  windowClass.style = CS_HREDRAW | CS_VREDRAW;
  windowClass.lpfnWndProc = window_proc;
  windowClass.hInstance = instance;
  windowClass.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(1));
  windowClass.hCursor = LoadCursorW(NULL, IDC_ARROW);
  windowClass.hbrBackground = g_backgroundBrush;
  windowClass.lpszClassName = L"DORN_AI_NATIVE_INSTALLER_4";
  windowClass.hIconSm = windowClass.hIcon;
  if (!RegisterClassExW(&windowClass)) return 10;

  int width = 920, height = 590;
  int x = (GetSystemMetrics(SM_CXSCREEN) - width) / 2;
  int y = (GetSystemMetrics(SM_CYSCREEN) - height) / 2;
  g_window = CreateWindowExW(0, windowClass.lpszClassName, L"DORN AI · Instalador",
    WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
    x, y, width, height, NULL, NULL, instance, NULL);
  if (!g_window) return 11;
  create_installer_controls(g_window);
  ShowWindow(g_window, SW_SHOW);
  UpdateWindow(g_window);

  MSG message;
  while (GetMessageW(&message, NULL, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }

  DeleteObject(g_font);
  DeleteObject(g_smallFont);
  DeleteObject(g_titleFont);
  DeleteObject(g_headingFont);
  DeleteObject(g_backgroundBrush);
  DeleteObject(g_panelBrush);
  DeleteObject(g_editBrush);
  if (g_forestBitmap) DeleteObject(g_forestBitmap);
  CoUninitialize();
  return (int)message.wParam;
#endif
}

int WINAPI WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR commandLine, int showCommand) {
  (void)commandLine;
  return wWinMain(instance, previous, GetCommandLineW(), showCommand);
}
