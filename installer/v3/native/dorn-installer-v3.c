#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#define COBJMACROS

#include <windows.h>
#include <commctrl.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <shellapi.h>
#include <bcrypt.h>
#include <stdint.h>
#include <stdio.h>
#include <wchar.h>
#include <wctype.h>
#include <strsafe.h>

#define DORN_VERSION L"4.0.0-alpha.7"
#define DORN_MAGIC "DORNZIP4"
#define DORN_TRAILER_SIZE 64
#define DORN_MAX_PATH 32768
#define DORN_EXTRACTOR_BYTES 446976
#define DORN_INSTALLER_REVISION L"Installer v3"
#define DORN_TIMEOUT_EXTRACT_MS (20UL * 60UL * 1000UL)
#define DORN_TIMEOUT_AGENT_MS (10UL * 60UL * 1000UL)
#define DORN_PROCESS_TIMEOUT 0xE0D00001UL
#define WM_DORN_STATUS (WM_APP + 41)
#define WM_DORN_FINISH (WM_APP + 42)
#define IDC_PATH 1001
#define IDC_BROWSE 1002
#define IDC_DESKTOP 1003
#define IDC_LAUNCH 1004
#define IDC_INSTALL 1005
#define IDC_CANCEL 1006
#define IDC_PROGRESS 1007
#define IDC_STATUS 1008
#define IDC_LINUX 1009

typedef struct DornTrailer {
  char magic[8];
  uint64_t offset;
  uint64_t compressedSize;
  uint64_t unpackedSize;
  unsigned char sha256[32];
} DornTrailer;

typedef struct InstallOptions {
  HWND window;
  wchar_t target[DORN_MAX_PATH];
  BOOL desktop;
  BOOL launch;
  BOOL linux;
} InstallOptions;

static const unsigned char EXTRACTOR_SHA256[32] = {
  0xc7,0x24,0x5e,0x21,0xa7,0x55,0x3d,0x9e,0x52,0xd4,0x34,0x00,0x2a,0x40,0x1c,0x77,
  0xa7,0xca,0x7d,0x0f,0x24,0x5f,0x23,0x11,0xb0,0xdd,0xf1,0x6f,0x8f,0x94,0x6c,0x6f
};

static HINSTANCE g_instance;
static HWND g_window, g_progress, g_status, g_install, g_cancel;
static HFONT g_font, g_small, g_title, g_heading;
static HBRUSH g_background, g_edit;
static HBITMAP g_forest;
static volatile LONG g_installing = 0;
static wchar_t g_log_path[DORN_MAX_PATH];

static BOOL directory_exists(const wchar_t *path);

static COLORREF color(unsigned int hex) { return RGB((hex >> 16) & 255, (hex >> 8) & 255, hex & 255); }

static BOOL write_all(HANDLE file, const void *data, DWORD bytes) {
  const unsigned char *cursor = (const unsigned char *)data;
  while (bytes) {
    DWORD written = 0;
    if (!WriteFile(file, cursor, bytes, &written, NULL) || !written) return FALSE;
    cursor += written;
    bytes -= written;
  }
  return TRUE;
}

static void initialize_log(void) {
  wchar_t root[DORN_MAX_PATH], directory[DORN_MAX_PATH];
  if (FAILED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, SHGFP_TYPE_CURRENT, root))) return;
  if (FAILED(StringCchPrintfW(directory, DORN_MAX_PATH, L"%s\\DORN AI\\Installer", root))) return;
  if (SHCreateDirectoryExW(NULL, directory, NULL) != ERROR_SUCCESS && !directory_exists(directory)) return;
  StringCchPrintfW(g_log_path, DORN_MAX_PATH, L"%s\\installer-v3.log", directory);
}

static void log_event(const wchar_t *stage, const wchar_t *detail, DWORD code) {
  if (!g_log_path[0]) return;
  HANDLE file = CreateFileW(g_log_path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return;
  SYSTEMTIME now; GetLocalTime(&now);
  wchar_t line[1600];
  HRESULT formatted = StringCchPrintfW(line, ARRAYSIZE(line),
    L"[%04u-%02u-%02u %02u:%02u:%02u.%03u] %s | code=%lu | %s\r\n",
    now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond, now.wMilliseconds,
    stage ? stage : L"EVENT", code, detail ? detail : L"");
  if (SUCCEEDED(formatted)) {
    int bytes = WideCharToMultiByte(CP_UTF8, 0, line, -1, NULL, 0, NULL, NULL);
    if (bytes > 1) {
      char *utf8 = HeapAlloc(GetProcessHeap(), 0, (SIZE_T)bytes);
      if (utf8) {
        WideCharToMultiByte(CP_UTF8, 0, line, -1, utf8, bytes, NULL, NULL);
        write_all(file, utf8, (DWORD)(bytes - 1));
        HeapFree(GetProcessHeap(), 0, utf8);
      }
    }
  }
  CloseHandle(file);
}

static BOOL read_exact(HANDLE file, void *data, DWORD bytes) {
  unsigned char *cursor = (unsigned char *)data;
  while (bytes) {
    DWORD count = 0;
    if (!ReadFile(file, cursor, bytes, &count, NULL) || !count) return FALSE;
    cursor += count;
    bytes -= count;
  }
  return TRUE;
}

static BOOL hash_stream(HANDLE source, uint64_t offset, uint64_t size, HANDLE copy, unsigned char output[32]) {
  BCRYPT_ALG_HANDLE algorithm = NULL;
  BCRYPT_HASH_HANDLE hash = NULL;
  DWORD objectBytes = 0, returned = 0;
  unsigned char *object = NULL, *buffer = NULL;
  BOOL ok = FALSE;
  LARGE_INTEGER position;
  position.QuadPart = (LONGLONG)offset;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, NULL, 0) < 0) goto done;
  if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, (PUCHAR)&objectBytes, sizeof(objectBytes), &returned, 0) < 0) goto done;
  object = (unsigned char *)HeapAlloc(GetProcessHeap(), 0, objectBytes);
  buffer = (unsigned char *)HeapAlloc(GetProcessHeap(), 0, 1024 * 1024);
  if (!object || !buffer || BCryptCreateHash(algorithm, &hash, object, objectBytes, NULL, 0, 0) < 0) goto done;
  if (!SetFilePointerEx(source, position, NULL, FILE_BEGIN)) goto done;
  while (size) {
    DWORD wanted = size > 1024 * 1024 ? 1024 * 1024 : (DWORD)size;
    DWORD read = 0;
    if (!ReadFile(source, buffer, wanted, &read, NULL) || read != wanted) goto done;
    if (BCryptHashData(hash, buffer, read, 0) < 0) goto done;
    if (copy != INVALID_HANDLE_VALUE && !write_all(copy, buffer, read)) goto done;
    size -= read;
  }
  if (BCryptFinishHash(hash, output, 32, 0) < 0) goto done;
  ok = TRUE;
done:
  if (hash) BCryptDestroyHash(hash);
  if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
  if (object) HeapFree(GetProcessHeap(), 0, object);
  if (buffer) HeapFree(GetProcessHeap(), 0, buffer);
  return ok;
}

static BOOL hash_file(const wchar_t *path, unsigned char output[32]) {
  HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return FALSE;
  LARGE_INTEGER size;
  BOOL ok = GetFileSizeEx(file, &size) && hash_stream(file, 0, (uint64_t)size.QuadPart, INVALID_HANDLE_VALUE, output);
  CloseHandle(file);
  return ok;
}

static BOOL valid_path(const wchar_t *path) {
  size_t length = path ? wcslen(path) : 0;
  if (length < 4 || length >= DORN_MAX_PATH - 256 || !iswalpha(path[0]) || path[1] != L':' || path[2] != L'\\') return FALSE;
  if (wcschr(path, L'"') || wcschr(path, L'|') || wcschr(path, L'<') || wcschr(path, L'>')) return FALSE;
  const wchar_t *cursor = path + 3;
  while (*cursor) {
    const wchar_t *end = wcschr(cursor, L'\\');
    size_t size = end ? (size_t)(end - cursor) : wcslen(cursor);
    if (!size || (size == 1 && cursor[0] == L'.') || (size == 2 && cursor[0] == L'.' && cursor[1] == L'.')) return FALSE;
    cursor = end ? end + 1 : cursor + size;
  }
  return TRUE;
}

static void trim_end(wchar_t *path) {
  size_t length = wcslen(path);
  while (length > 3 && (path[length - 1] == L'\\' || path[length - 1] == L'/')) path[--length] = 0;
}

static BOOL same_path(const wchar_t *left, const wchar_t *right) {
  wchar_t a[DORN_MAX_PATH], b[DORN_MAX_PATH];
  if (FAILED(StringCchCopyW(a, DORN_MAX_PATH, left)) || FAILED(StringCchCopyW(b, DORN_MAX_PATH, right))) return FALSE;
  trim_end(a); trim_end(b);
  return CompareStringOrdinal(a, -1, b, -1, TRUE) == CSTR_EQUAL;
}

static BOOL directory_exists(const wchar_t *path) {
  DWORD attributes = GetFileAttributesW(path);
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
}

static BOOL delete_tree_safe(const wchar_t *path) {
  DWORD attributes = GetFileAttributesW(path);
  if (attributes == INVALID_FILE_ATTRIBUTES) return GetLastError() == ERROR_FILE_NOT_FOUND || GetLastError() == ERROR_PATH_NOT_FOUND;
  if (attributes & FILE_ATTRIBUTE_REPARSE_POINT) {
    SetFileAttributesW(path, FILE_ATTRIBUTE_NORMAL);
    return (attributes & FILE_ATTRIBUTE_DIRECTORY) ? RemoveDirectoryW(path) : DeleteFileW(path);
  }
  if (!(attributes & FILE_ATTRIBUTE_DIRECTORY)) {
    SetFileAttributesW(path, FILE_ATTRIBUTE_NORMAL);
    return DeleteFileW(path);
  }
  wchar_t pattern[DORN_MAX_PATH];
  if (FAILED(StringCchPrintfW(pattern, DORN_MAX_PATH, L"%s\\*", path))) return FALSE;
  WIN32_FIND_DATAW item;
  HANDLE find = FindFirstFileW(pattern, &item);
  if (find != INVALID_HANDLE_VALUE) {
    do {
      if (!wcscmp(item.cFileName, L".") || !wcscmp(item.cFileName, L"..")) continue;
      wchar_t child[DORN_MAX_PATH];
      if (FAILED(StringCchPrintfW(child, DORN_MAX_PATH, L"%s\\%s", path, item.cFileName)) || !delete_tree_safe(child)) { FindClose(find); return FALSE; }
    } while (FindNextFileW(find, &item));
    FindClose(find);
  } else if (GetLastError() != ERROR_FILE_NOT_FOUND) return FALSE;
  SetFileAttributesW(path, FILE_ATTRIBUTE_NORMAL);
  return RemoveDirectoryW(path);
}

static BOOL create_unique_temp(wchar_t *output, size_t count) {
  wchar_t root[DORN_MAX_PATH], guidText[64];
  GUID guid;
  if (!GetTempPathW(DORN_MAX_PATH, root) || FAILED(CoCreateGuid(&guid)) || !StringFromGUID2(&guid, guidText, 64)) return FALSE;
  for (wchar_t *cursor = guidText; *cursor; cursor++) if (*cursor == L'{' || *cursor == L'}') *cursor = L'-';
  if (FAILED(StringCchPrintfW(output, count, L"%sDORN-Installer-v2%s", root, guidText))) return FALSE;
  return CreateDirectoryW(output, NULL) != 0;
}

static BOOL extract_payload(const wchar_t *archive, DornTrailer *trailer, wchar_t *error, size_t count) {
  wchar_t self[DORN_MAX_PATH];
  if (!GetModuleFileNameW(NULL, self, DORN_MAX_PATH)) return FALSE;
  HANDLE source = CreateFileW(self, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (source == INVALID_HANDLE_VALUE) return FALSE;
  LARGE_INTEGER size;
  BOOL ok = FALSE;
  if (!GetFileSizeEx(source, &size) || size.QuadPart < DORN_TRAILER_SIZE) { StringCchCopyW(error, count, L"El instalador está truncado."); goto done; }
  LARGE_INTEGER position; position.QuadPart = size.QuadPart - DORN_TRAILER_SIZE;
  if (!SetFilePointerEx(source, position, NULL, FILE_BEGIN) || !read_exact(source, trailer, sizeof(*trailer))) { StringCchCopyW(error, count, L"No se pudo leer el tráiler DORNZIP4."); goto done; }
  if (memcmp(trailer->magic, DORN_MAGIC, 8) || trailer->offset + trailer->compressedSize + DORN_TRAILER_SIZE != (uint64_t)size.QuadPart || trailer->compressedSize < 50ULL * 1024 * 1024 || trailer->unpackedSize < trailer->compressedSize) {
    StringCchCopyW(error, count, L"El formato o tamaño del payload DORN no es válido."); goto done;
  }
  HANDLE destination = CreateFileW(archive, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, NULL);
  if (destination == INVALID_HANDLE_VALUE) { StringCchCopyW(error, count, L"No se pudo reservar el payload temporal."); goto done; }
  unsigned char actual[32];
  BOOL copied = hash_stream(source, trailer->offset, trailer->compressedSize, destination, actual);
  CloseHandle(destination);
  if (!copied || memcmp(actual, trailer->sha256, 32)) { DeleteFileW(archive); StringCchCopyW(error, count, L"El SHA-256 del payload no coincide. Descarga nuevamente el instalador."); goto done; }
  ok = TRUE;
done:
  CloseHandle(source);
  return ok;
}

static BOOL extract_locked_7z(const wchar_t *output, wchar_t *error, size_t count) {
  HRSRC resource = FindResourceW(g_instance, MAKEINTRESOURCEW(3), RT_RCDATA);
  if (!resource) { StringCchCopyW(error, count, L"Falta el extractor interno."); return FALSE; }
  HGLOBAL loaded = LoadResource(g_instance, resource);
  DWORD bytes = SizeofResource(g_instance, resource);
  const void *data = loaded ? LockResource(loaded) : NULL;
  if (!data || bytes != DORN_EXTRACTOR_BYTES) { StringCchCopyW(error, count, L"El extractor interno tiene un tamaño inválido."); return FALSE; }
  HANDLE file = CreateFileW(output, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, NULL);
  if (file == INVALID_HANDLE_VALUE) return FALSE;
  BOOL written = write_all(file, data, bytes);
  CloseHandle(file);
  unsigned char digest[32];
  if (!written || !hash_file(output, digest) || memcmp(digest, EXTRACTOR_SHA256, 32)) { DeleteFileW(output); StringCchCopyW(error, count, L"El extractor interno no supera la verificación SHA-256."); return FALSE; }
  return TRUE;
}

static DWORD run_process(const wchar_t *executable, const wchar_t *arguments, const wchar_t *workingDirectory, BOOL wait, DWORD timeoutMs, const wchar_t *label) {
  wchar_t command[DORN_MAX_PATH * 3];
  if (FAILED(StringCchPrintfW(command, ARRAYSIZE(command), L"\"%s\" %s", executable, arguments ? arguments : L""))) return ERROR_BUFFER_OVERFLOW;
  STARTUPINFOW startup; PROCESS_INFORMATION process;
  ZeroMemory(&startup, sizeof(startup)); ZeroMemory(&process, sizeof(process)); startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESHOWWINDOW; startup.wShowWindow = SW_HIDE;
  if (!CreateProcessW(executable, command, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, workingDirectory, &startup, &process)) {
    DWORD error = GetLastError();
    log_event(label ? label : L"PROCESS_START_FAILED", executable, error);
    return error;
  }
  DWORD result = 0;
  if (wait) {
    DWORD waitResult = WaitForSingleObject(process.hProcess, timeoutMs ? timeoutMs : DORN_TIMEOUT_AGENT_MS);
    if (waitResult == WAIT_TIMEOUT) {
      log_event(label ? label : L"PROCESS_TIMEOUT", executable, DORN_PROCESS_TIMEOUT);
      TerminateProcess(process.hProcess, DORN_PROCESS_TIMEOUT);
      WaitForSingleObject(process.hProcess, 5000);
      result = DORN_PROCESS_TIMEOUT;
    } else if (waitResult != WAIT_OBJECT_0) {
      result = GetLastError();
    } else if (!GetExitCodeProcess(process.hProcess, &result)) {
      result = GetLastError();
    }
  }
  CloseHandle(process.hThread); CloseHandle(process.hProcess);
  log_event(label ? label : L"PROCESS_DONE", executable, result);
  return result;
}

static DWORD run_agent(const wchar_t *root, const wchar_t *mode, const wchar_t *target) {
  wchar_t executable[DORN_MAX_PATH], arguments[DORN_MAX_PATH * 2];
  StringCchPrintfW(executable, DORN_MAX_PATH, L"%s\\DORN AI.exe", root);
  if (target) StringCchPrintfW(arguments, ARRAYSIZE(arguments), L"--dorn-installer-agent=%s \"--dorn-root=%s\" \"--dorn-target=%s\"", mode, root, target);
  else StringCchPrintfW(arguments, ARRAYSIZE(arguments), L"--dorn-installer-agent=%s \"--dorn-root=%s\"", mode, root);
  return run_process(executable, arguments, root, TRUE, DORN_TIMEOUT_AGENT_MS, mode);
}

static BOOL request_linux_setup(void) {
  wchar_t system[DORN_MAX_PATH], executable[DORN_MAX_PATH];
  if (!GetSystemDirectoryW(system, DORN_MAX_PATH) || FAILED(StringCchPrintfW(executable, DORN_MAX_PATH, L"%s\\wsl.exe", system))) {
    log_event(L"LINUX_SETUP_PATH_FAILED", L"No se pudo resolver wsl.exe.", GetLastError());
    return FALSE;
  }
  SHELLEXECUTEINFOW request; ZeroMemory(&request, sizeof(request));
  request.cbSize = sizeof(request);
  request.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_NO_UI;
  request.lpVerb = L"runas";
  request.lpFile = executable;
  request.lpParameters = L"--install --distribution Ubuntu --no-launch";
  request.nShow = SW_SHOWNORMAL;
  if (!ShellExecuteExW(&request)) {
    log_event(L"LINUX_SETUP_NOT_STARTED", L"Windows no inició la preparación WSL 2 / Ubuntu.", GetLastError());
    return FALSE;
  }
  if (request.hProcess) CloseHandle(request.hProcess);
  log_event(L"LINUX_SETUP_STARTED", L"WSL 2 / Ubuntu quedó en un proceso independiente del instalador DORN.", 0);
  return TRUE;
}

static BOOL ensure_parent(const wchar_t *target) {
  wchar_t parent[DORN_MAX_PATH];
  if (FAILED(StringCchCopyW(parent, DORN_MAX_PATH, target))) return FALSE;
  wchar_t *slash = wcsrchr(parent, L'\\');
  if (!slash || slash <= parent + 2) return FALSE;
  *slash = 0;
  int result = SHCreateDirectoryExW(NULL, parent, NULL);
  return result == ERROR_SUCCESS || result == ERROR_ALREADY_EXISTS || directory_exists(parent);
}

static BOOL preflight(const wchar_t *target, uint64_t unpacked, wchar_t *error, size_t count) {
  SYSTEM_INFO info; GetNativeSystemInfo(&info);
  if (info.wProcessorArchitecture != PROCESSOR_ARCHITECTURE_AMD64) { StringCchCopyW(error, count, L"DORN AI requiere Windows x64 (AMD64)."); return FALSE; }
  typedef LONG (WINAPI *RtlGetVersionFn)(OSVERSIONINFOW *);
  RtlGetVersionFn rtl = (RtlGetVersionFn)GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "RtlGetVersion");
  OSVERSIONINFOW version; ZeroMemory(&version, sizeof(version)); version.dwOSVersionInfoSize = sizeof(version);
  if (!rtl || rtl(&version) != 0 || version.dwMajorVersion < 10 || version.dwBuildNumber < 22000) { StringCchCopyW(error, count, L"Installer v2 requiere Windows 11 build 22000 o posterior."); return FALSE; }
  wchar_t root[4] = { target[0], L':', L'\\', 0 };
  if (GetDriveTypeW(root) != DRIVE_FIXED) { StringCchCopyW(error, count, L"La instalación debe realizarse en una unidad local fija."); return FALSE; }
  ULARGE_INTEGER freeBytes;
  if (!GetDiskFreeSpaceExW(root, &freeBytes, NULL, NULL) || freeBytes.QuadPart < unpacked * 2 + 512ULL * 1024 * 1024) { StringCchCopyW(error, count, L"No hay espacio suficiente para preparar instalación y rollback."); return FALSE; }
  return TRUE;
}

static BOOL set_reg_string(HKEY key, const wchar_t *name, const wchar_t *value) {
  return RegSetValueExW(key, name, 0, REG_SZ, (const BYTE *)value, (DWORD)((wcslen(value) + 1) * sizeof(wchar_t))) == ERROR_SUCCESS;
}

static BOOL create_shortcut(const wchar_t *shortcutPath, const wchar_t *target) {
  IShellLinkW *link = NULL; IPersistFile *persist = NULL;
  HRESULT result = CoCreateInstance(&CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER, &IID_IShellLinkW, (void **)&link);
  if (FAILED(result)) return FALSE;
  IShellLinkW_SetPath(link, target);
  wchar_t working[DORN_MAX_PATH]; StringCchCopyW(working, DORN_MAX_PATH, target); wchar_t *slash = wcsrchr(working, L'\\'); if (slash) *slash = 0;
  IShellLinkW_SetWorkingDirectory(link, working); IShellLinkW_SetIconLocation(link, target, 0);
  result = IShellLinkW_QueryInterface(link, &IID_IPersistFile, (void **)&persist);
  if (SUCCEEDED(result)) result = IPersistFile_Save(persist, shortcutPath, TRUE);
  if (persist) IPersistFile_Release(persist); IShellLinkW_Release(link);
  return SUCCEEDED(result);
}

static BOOL register_installation(const wchar_t *target, BOOL desktop, uint64_t unpacked) {
  wchar_t executable[DORN_MAX_PATH], uninstaller[DORN_MAX_PATH], uninstallCommand[DORN_MAX_PATH + 4];
  StringCchPrintfW(executable, DORN_MAX_PATH, L"%s\\DORN AI.exe", target);
  StringCchPrintfW(uninstaller, DORN_MAX_PATH, L"%s\\DORN AI Uninstall.exe", target);
  StringCchPrintfW(uninstallCommand, ARRAYSIZE(uninstallCommand), L"\"%s\"", uninstaller);
  HKEY key = NULL;
  if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DORN AI", 0, NULL, 0, KEY_SET_VALUE, NULL, &key, NULL) != ERROR_SUCCESS) return FALSE;
  DWORD estimated = (DWORD)(unpacked / 1024); if (!estimated) estimated = 1;
  BOOL ok = set_reg_string(key, L"DisplayName", L"DORN AI") && set_reg_string(key, L"DisplayVersion", DORN_VERSION) && set_reg_string(key, L"Publisher", L"DORN") && set_reg_string(key, L"InstallLocation", target) && set_reg_string(key, L"DisplayIcon", executable) && set_reg_string(key, L"UninstallString", uninstallCommand);
  RegSetValueExW(key, L"EstimatedSize", 0, REG_DWORD, (const BYTE *)&estimated, sizeof(estimated));
  DWORD one = 1; RegSetValueExW(key, L"NoModify", 0, REG_DWORD, (const BYTE *)&one, sizeof(one));
  RegCloseKey(key);
  wchar_t programs[DORN_MAX_PATH], menu[DORN_MAX_PATH], menuLink[DORN_MAX_PATH];
  if (FAILED(SHGetFolderPathW(NULL, CSIDL_PROGRAMS, NULL, SHGFP_TYPE_CURRENT, programs))) return FALSE;
  StringCchPrintfW(menu, DORN_MAX_PATH, L"%s\\DORN AI", programs); SHCreateDirectoryExW(NULL, menu, NULL);
  StringCchPrintfW(menuLink, DORN_MAX_PATH, L"%s\\DORN AI.lnk", menu);
  ok = ok && create_shortcut(menuLink, executable);
  if (desktop) {
    wchar_t desktopPath[DORN_MAX_PATH], desktopLink[DORN_MAX_PATH];
    if (FAILED(SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY, NULL, SHGFP_TYPE_CURRENT, desktopPath))) return FALSE;
    StringCchPrintfW(desktopLink, DORN_MAX_PATH, L"%s\\DORN AI.lnk", desktopPath);
    ok = ok && create_shortcut(desktopLink, executable);
  }
  return ok;
}

static void remove_registration_and_shortcuts(void) {
  RegDeleteTreeW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DORN AI");
  wchar_t path[DORN_MAX_PATH];
  if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY, NULL, SHGFP_TYPE_CURRENT, path))) { StringCchCatW(path, DORN_MAX_PATH, L"\\DORN AI.lnk"); DeleteFileW(path); }
  if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_PROGRAMS, NULL, SHGFP_TYPE_CURRENT, path))) { StringCchCatW(path, DORN_MAX_PATH, L"\\DORN AI"); delete_tree_safe(path); }
}

static BOOL registry_matches_target(const wchar_t *target) {
  HKEY key = NULL; wchar_t value[DORN_MAX_PATH]; DWORD type = 0, bytes = sizeof(value);
  if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DORN AI", 0, KEY_QUERY_VALUE, &key) != ERROR_SUCCESS) return FALSE;
  LONG result = RegQueryValueExW(key, L"InstallLocation", NULL, &type, (BYTE *)value, &bytes); RegCloseKey(key);
  if (result != ERROR_SUCCESS || (type != REG_SZ && type != REG_EXPAND_SZ)) return FALSE;
  value[DORN_MAX_PATH - 1] = 0; return same_path(value, target);
}

static wchar_t *heap_copy(const wchar_t *text) {
  size_t bytes = (wcslen(text) + 1) * sizeof(wchar_t); wchar_t *copy = HeapAlloc(GetProcessHeap(), 0, bytes); if (copy) memcpy(copy, text, bytes); return copy;
}

static void post_status(HWND window, int progress, const wchar_t *text) { log_event(L"STATUS", text, (DWORD)progress); PostMessageW(window, WM_DORN_STATUS, progress, (LPARAM)heap_copy(text)); }
static void post_finish(HWND window, BOOL ok, const wchar_t *text) { log_event(ok ? L"FINISH_OK" : L"FINISH_ERROR", text, ok ? 0 : 1); PostMessageW(window, WM_DORN_FINISH, ok, (LPARAM)heap_copy(text)); }

static DWORD WINAPI install_worker(LPVOID parameter) {
  InstallOptions *options = (InstallOptions *)parameter;
  wchar_t temp[DORN_MAX_PATH] = {0}, archive[DORN_MAX_PATH] = {0}, extractor[DORN_MAX_PATH] = {0};
  wchar_t stage[DORN_MAX_PATH] = {0}, backup[DORN_MAX_PATH] = {0}, error[700] = {0};
  DornTrailer trailer; ZeroMemory(&trailer, sizeof(trailer));
  BOOL committed = FALSE, hadBackup = FALSE, success = FALSE;
  post_status(options->window, 4, L"Comprobando Windows, arquitectura y espacio disponible…");
  if (!valid_path(options->target) || !ensure_parent(options->target)) { StringCchCopyW(error, ARRAYSIZE(error), L"La ruta elegida no es una carpeta local válida."); goto done; }
  if (!create_unique_temp(temp, ARRAYSIZE(temp))) { StringCchCopyW(error, ARRAYSIZE(error), L"No se pudo crear el espacio temporal exclusivo."); goto done; }
  StringCchPrintfW(archive, DORN_MAX_PATH, L"%s\\payload.zip", temp);
  StringCchPrintfW(extractor, DORN_MAX_PATH, L"%s\\7z-x64.exe", temp);
  if (!extract_payload(archive, &trailer, error, ARRAYSIZE(error)) || !preflight(options->target, trailer.unpackedSize, error, ARRAYSIZE(error)) || !extract_locked_7z(extractor, error, ARRAYSIZE(error))) goto done;
  StringCchPrintfW(stage, DORN_MAX_PATH, L"%s.dorn-v2-stage", options->target);
  StringCchPrintfW(backup, DORN_MAX_PATH, L"%s.dorn-v2-backup", options->target);
  if (directory_exists(backup)) {
    if (!directory_exists(options->target)) {
      if (!MoveFileExW(backup, options->target, MOVEFILE_WRITE_THROUGH)) { StringCchCopyW(error, ARRAYSIZE(error), L"Se encontró un respaldo interrumpido que Windows no pudo restaurar."); goto done; }
    } else if (run_agent(options->target, L"verify", NULL) == 0) {
      if (!delete_tree_safe(backup)) { StringCchCopyW(error, ARRAYSIZE(error), L"La instalación está válida, pero no se pudo retirar un respaldo anterior."); goto done; }
    } else { StringCchCopyW(error, ARRAYSIZE(error), L"Existen una instalación y un respaldo inconsistentes. Se preservaron ambos para recuperación manual."); goto done; }
  }
  if (directory_exists(stage) && !delete_tree_safe(stage)) { StringCchCopyW(error, ARRAYSIZE(error), L"No se pudo limpiar una preparación interrumpida anterior."); goto done; }
  post_status(options->window, 24, L"Payload y extractor verificados. Descomprimiendo DORN AI…");
  wchar_t arguments[DORN_MAX_PATH * 2];
  StringCchPrintfW(arguments, ARRAYSIZE(arguments), L"x -y -bd -bso0 -bsp0 \"-o%s\" \"%s\"", stage, archive);
  DWORD extractResult = run_process(extractor, arguments, temp, TRUE, DORN_TIMEOUT_EXTRACT_MS, L"EXTRACT_PAYLOAD");
  if (extractResult != 0 || !directory_exists(stage)) {
    StringCchCopyW(error, ARRAYSIZE(error), extractResult == DORN_PROCESS_TIMEOUT
      ? L"La extracción excedió 20 minutos y fue detenida. Revisa antivirus, espacio y el registro installer-v3.log."
      : L"No se pudo extraer el paquete DORN verificado. Revisa installer-v3.log.");
    goto done;
  }
  post_status(options->window, 49, L"Verificando cada archivo antes de modificar la instalación…");
  DWORD prepareResult = run_agent(stage, L"prepare", options->target);
  if (prepareResult != 0) {
    StringCchCopyW(error, ARRAYSIZE(error), prepareResult == DORN_PROCESS_TIMEOUT
      ? L"La verificación previa no respondió en 10 minutos y fue detenida. Consulta installer-v3.log."
      : L"El agente DORN rechazó el paquete o la carpeta de destino. Consulta installer-v3.log.");
    goto done;
  }
  if (directory_exists(options->target)) {
    if (directory_exists(backup) || !MoveFileExW(options->target, backup, MOVEFILE_WRITE_THROUGH)) { StringCchCopyW(error, ARRAYSIZE(error), L"No se pudo conservar la instalación anterior como respaldo."); goto done; }
    hadBackup = TRUE;
  }
  post_status(options->window, 70, L"Aplicando el cambio atómico con respaldo recuperable…");
  if (!MoveFileExW(stage, options->target, MOVEFILE_WRITE_THROUGH)) { if (hadBackup) MoveFileExW(backup, options->target, MOVEFILE_WRITE_THROUGH); StringCchCopyW(error, ARRAYSIZE(error), L"Windows no pudo confirmar el cambio atómico."); goto done; }
  committed = TRUE;
  DWORD verifyResult = run_agent(options->target, L"verify", NULL);
  if (verifyResult != 0 || !register_installation(options->target, options->desktop, trailer.unpackedSize)) {
    delete_tree_safe(options->target); committed = FALSE;
    if (hadBackup) MoveFileExW(backup, options->target, MOVEFILE_WRITE_THROUGH);
    StringCchCopyW(error, ARRAYSIZE(error), verifyResult == DORN_PROCESS_TIMEOUT
      ? L"La verificación final no respondió en 10 minutos. DORN restauró la instalación anterior. Consulta installer-v3.log."
      : L"La verificación posterior falló y DORN restauró la instalación anterior. Consulta installer-v3.log.");
    goto done;
  }
  post_status(options->window, 96, L"Instalación verificada. DORN AI ya está listo.");
  success = TRUE;
  if (options->launch) {
    wchar_t executable[DORN_MAX_PATH]; StringCchPrintfW(executable, DORN_MAX_PATH, L"%s\\DORN AI.exe", options->target);
    run_process(executable, L"", options->target, FALSE, 0, L"LAUNCH_DORN");
  }
done:
  if (!success && committed && hadBackup && !directory_exists(options->target)) MoveFileExW(backup, options->target, MOVEFILE_WRITE_THROUGH);
  if (directory_exists(stage)) delete_tree_safe(stage);
  if (success) {
    log_event(L"INSTALL_VERIFIED", options->target, 0);
    post_finish(options->window, TRUE, options->linux
      ? L"DORN AI fue instalado y verificado. Windows solicitará permiso para preparar DORN Linux en un proceso separado; puede requerir reinicio."
      : L"DORN AI fue instalado y verificado. Tus proyectos y datos de usuario permanecen separados del programa.");
    if (options->linux) request_linux_setup();
    if (hadBackup && !delete_tree_safe(backup)) log_event(L"BACKUP_CLEANUP_DEFERRED", backup, GetLastError());
  } else {
    log_event(L"INSTALL_FAILED", error[0] ? error : L"Fallo sin detalle", GetLastError());
    post_finish(options->window, FALSE, error[0] ? error : L"Installer v3 no pudo completar la operación. No se confirmó ningún estado incompleto.");
  }
  if (temp[0] && !delete_tree_safe(temp)) log_event(L"TEMP_CLEANUP_DEFERRED", temp, GetLastError());
  HeapFree(GetProcessHeap(), 0, options);
  return success ? 0 : 1;
}

static void start_install(HWND window) {
  if (InterlockedCompareExchange(&g_installing, 1, 0)) return;
  InstallOptions *options = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*options));
  if (!options) { InterlockedExchange(&g_installing, 0); return; }
  options->window = window; GetWindowTextW(GetDlgItem(window, IDC_PATH), options->target, DORN_MAX_PATH);
  options->desktop = IsDlgButtonChecked(window, IDC_DESKTOP) == BST_CHECKED;
  options->launch = IsDlgButtonChecked(window, IDC_LAUNCH) == BST_CHECKED;
  options->linux = IsDlgButtonChecked(window, IDC_LINUX) == BST_CHECKED;
  if (!valid_path(options->target)) { HeapFree(GetProcessHeap(), 0, options); InterlockedExchange(&g_installing, 0); MessageBoxW(window, L"Elige una ruta absoluta en una unidad local fija.", L"Ruta no válida", MB_OK | MB_ICONWARNING); return; }
  EnableWindow(GetDlgItem(window, IDC_PATH), FALSE); EnableWindow(GetDlgItem(window, IDC_BROWSE), FALSE); EnableWindow(GetDlgItem(window, IDC_DESKTOP), FALSE); EnableWindow(GetDlgItem(window, IDC_LINUX), FALSE); EnableWindow(GetDlgItem(window, IDC_LAUNCH), FALSE); EnableWindow(g_install, FALSE); SetWindowTextW(g_cancel, L"Ocultar");
  HANDLE thread = CreateThread(NULL, 0, install_worker, options, 0, NULL);
  if (thread) CloseHandle(thread); else { HeapFree(GetProcessHeap(), 0, options); InterlockedExchange(&g_installing, 0); }
}

static void browse(HWND window) {
  BROWSEINFOW info; ZeroMemory(&info, sizeof(info)); info.hwndOwner = window; info.lpszTitle = L"Elige la carpeta base para DORN AI"; info.ulFlags = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE | BIF_USENEWUI;
  PIDLIST_ABSOLUTE selected = SHBrowseForFolderW(&info); if (!selected) return;
  wchar_t path[DORN_MAX_PATH]; if (SHGetPathFromIDListW(selected, path)) { trim_end(path); StringCchCatW(path, DORN_MAX_PATH, L"\\DORN AI"); SetWindowTextW(GetDlgItem(window, IDC_PATH), path); }
  CoTaskMemFree(selected);
}

static HWND add_text(HWND parent, int id, const wchar_t *text, int x, int y, int width, int height, HFONT font) {
  HWND item = CreateWindowExW(0, L"STATIC", text, WS_CHILD | WS_VISIBLE, x, y, width, height, parent, (HMENU)(INT_PTR)id, g_instance, NULL); SendMessageW(item, WM_SETFONT, (WPARAM)font, TRUE); return item;
}

static HWND add_button(HWND parent, int id, const wchar_t *text, int x, int y, int width, int height, DWORD style) {
  HWND item = CreateWindowExW(0, L"BUTTON", text, WS_CHILD | WS_VISIBLE | WS_TABSTOP | style, x, y, width, height, parent, (HMENU)(INT_PTR)id, g_instance, NULL); SendMessageW(item, WM_SETFONT, (WPARAM)g_font, TRUE); return item;
}

static void create_controls(HWND window) {
  add_text(window, 2001, L"DORN", 42, 36, 260, 72, g_title);
  add_text(window, 2002, L"SISTEMA DE CREACIÓN CON IA", 46, 112, 245, 24, g_small);
  add_text(window, 2003, L"INSTALLER v3 · WINDOWS 11 X64", 350, 38, 470, 22, g_small);
  add_text(window, 2004, L"Instala una sola aplicación", 350, 72, 500, 42, g_heading);
  add_text(window, 2005, L"DORN AI integra productos, agentes, Linux administrado, MCP y Skills dentro del mismo espacio de trabajo.", 350, 120, 520, 56, g_font);
  add_text(window, 2006, L"CARPETA DE INSTALACIÓN", 350, 195, 300, 22, g_small);
  HWND path = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_AUTOHSCROLL, 350, 221, 410, 36, window, (HMENU)(INT_PTR)IDC_PATH, g_instance, NULL); SendMessageW(path, WM_SETFONT, (WPARAM)g_font, TRUE);
  add_button(window, IDC_BROWSE, L"Examinar", 770, 221, 98, 36, BS_OWNERDRAW);
  add_text(window, 2007, L"PROTECCIONES", 350, 284, 300, 22, g_small);
  add_text(window, 2008, L"✓ Verificación SHA-256 completa\n✓ Procesos con límite y registro de diagnóstico\n✓ Reparación y rollback recuperable\n✓ Datos personales preservados", 350, 312, 500, 92, g_font);
  add_button(window, IDC_DESKTOP, L"Crear acceso directo DORN AI", 350, 414, 300, 26, BS_AUTOCHECKBOX);
  add_button(window, IDC_LINUX, L"Preparar DORN Linux (WSL 2 + Ubuntu; puede pedir reinicio)", 350, 446, 500, 26, BS_AUTOCHECKBOX);
  add_button(window, IDC_LAUNCH, L"Iniciar DORN AI al finalizar", 350, 478, 300, 26, BS_AUTOCHECKBOX);
  CheckDlgButton(window, IDC_DESKTOP, BST_CHECKED); CheckDlgButton(window, IDC_LINUX, BST_CHECKED); CheckDlgButton(window, IDC_LAUNCH, BST_CHECKED);
  g_progress = CreateWindowExW(0, PROGRESS_CLASSW, NULL, WS_CHILD | WS_VISIBLE | PBS_SMOOTH, 350, 514, 518, 10, window, (HMENU)(INT_PTR)IDC_PROGRESS, g_instance, NULL); SendMessageW(g_progress, PBM_SETRANGE, 0, MAKELPARAM(0, 100)); SendMessageW(g_progress, PBM_SETBARCOLOR, 0, color(0x76d6ee));
  g_status = add_text(window, IDC_STATUS, L"Listo para verificar e instalar DORN AI.", 350, 532, 510, 34, g_small);
  g_install = add_button(window, IDC_INSTALL, L"Instalar / reparar DORN AI", 626, 570, 242, 44, BS_OWNERDRAW);
  g_cancel = add_button(window, IDC_CANCEL, L"Cancelar", 508, 570, 108, 44, BS_OWNERDRAW);
  wchar_t local[DORN_MAX_PATH]; if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, SHGFP_TYPE_CURRENT, local))) { StringCchCatW(local, DORN_MAX_PATH, L"\\Programs\\DORN AI"); SetWindowTextW(path, local); } else SetWindowTextW(path, L"C:\\DORN AI");
}

static void draw_button(const DRAWITEMSTRUCT *draw) {
  wchar_t text[128]; GetWindowTextW(draw->hwndItem, text, 128); BOOL primary = draw->CtlID == IDC_INSTALL; BOOL pressed = draw->itemState & ODS_SELECTED; BOOL disabled = draw->itemState & ODS_DISABLED;
  HBRUSH brush = CreateSolidBrush(disabled ? color(0x30343a) : primary ? (pressed ? color(0x54b9d0) : color(0x76d6ee)) : color(pressed ? 0x222a31 : 0x171d23)); HPEN pen = CreatePen(PS_SOLID, 1, primary ? color(0xbaf2ff) : color(0x394550));
  HGDIOBJ oldBrush = SelectObject(draw->hDC, brush), oldPen = SelectObject(draw->hDC, pen); RoundRect(draw->hDC, draw->rcItem.left, draw->rcItem.top, draw->rcItem.right, draw->rcItem.bottom, 10, 10);
  SelectObject(draw->hDC, g_font); SetBkMode(draw->hDC, TRANSPARENT); SetTextColor(draw->hDC, disabled ? color(0x777777) : primary ? color(0x071014) : color(0xe9edf2)); DrawTextW(draw->hDC, text, -1, (RECT *)&draw->rcItem, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
  SelectObject(draw->hDC, oldBrush); SelectObject(draw->hDC, oldPen); DeleteObject(brush); DeleteObject(pen);
}

static LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
  switch (message) {
    case WM_COMMAND:
      if (LOWORD(wParam) == IDC_BROWSE) { browse(window); return 0; }
      if (LOWORD(wParam) == IDC_INSTALL) { start_install(window); return 0; }
      if (LOWORD(wParam) == IDC_CANCEL) { if (InterlockedCompareExchange(&g_installing, 0, 0)) ShowWindow(window, SW_MINIMIZE); else DestroyWindow(window); return 0; }
      break;
    case WM_DORN_STATUS: {
      wchar_t *text = (wchar_t *)lParam; SendMessageW(g_progress, PBM_SETPOS, wParam, 0); SetWindowTextW(g_status, text ? text : L""); if (text) HeapFree(GetProcessHeap(), 0, text); return 0;
    }
    case WM_DORN_FINISH: {
      wchar_t *text = (wchar_t *)lParam; BOOL ok = (BOOL)wParam; InterlockedExchange(&g_installing, 0); SendMessageW(g_progress, PBM_SETPOS, ok ? 100 : 0, 0); SetWindowTextW(g_status, text ? text : L""); SetWindowTextW(g_cancel, L"Cerrar");
      if (!ok) { EnableWindow(g_install, TRUE); EnableWindow(GetDlgItem(window, IDC_PATH), TRUE); EnableWindow(GetDlgItem(window, IDC_BROWSE), TRUE); EnableWindow(GetDlgItem(window, IDC_DESKTOP), TRUE); EnableWindow(GetDlgItem(window, IDC_LINUX), TRUE); EnableWindow(GetDlgItem(window, IDC_LAUNCH), TRUE); }
      MessageBoxW(window, text, ok ? L"DORN AI está listo" : L"Instalación bloqueada", MB_OK | (ok ? MB_ICONINFORMATION : MB_ICONERROR)); if (text) HeapFree(GetProcessHeap(), 0, text); return 0;
    }
    case WM_DRAWITEM: draw_button((const DRAWITEMSTRUCT *)lParam); return TRUE;
    case WM_CTLCOLORSTATIC: { HDC dc = (HDC)wParam; SetBkMode(dc, TRANSPARENT); SetTextColor(dc, GetDlgCtrlID((HWND)lParam) == 2001 ? color(0xf4f7fa) : color(0xc7d0d9)); return (LRESULT)GetStockObject(NULL_BRUSH); }
    case WM_CTLCOLOREDIT: { HDC dc = (HDC)wParam; SetTextColor(dc, color(0xf1f5f9)); SetBkColor(dc, color(0x10161b)); return (LRESULT)g_edit; }
    case WM_PAINT: {
      PAINTSTRUCT paint; HDC dc = BeginPaint(window, &paint); RECT client; GetClientRect(window, &client); FillRect(dc, &client, g_background);
      if (g_forest) { BITMAP bitmap; HDC memory = CreateCompatibleDC(dc); HGDIOBJ old = SelectObject(memory, g_forest); GetObjectW(g_forest, sizeof(bitmap), &bitmap); StretchBlt(dc, 0, 0, 316, client.bottom, memory, 0, 0, bitmap.bmWidth, bitmap.bmHeight, SRCCOPY); SelectObject(memory, old); DeleteDC(memory); }
      HBRUSH card = CreateSolidBrush(color(0x0d1318)); HPEN pen = CreatePen(PS_SOLID, 1, color(0x26323b)); HGDIOBJ ob = SelectObject(dc, card), op = SelectObject(dc, pen); RoundRect(dc, 334, 184, 884, 269, 14, 14); RoundRect(dc, 334, 276, 884, 508, 14, 14); SelectObject(dc, ob); SelectObject(dc, op); DeleteObject(card); DeleteObject(pen); EndPaint(window, &paint); return 0;
    }
    case WM_CLOSE: if (InterlockedCompareExchange(&g_installing, 0, 0)) { ShowWindow(window, SW_MINIMIZE); return 0; } DestroyWindow(window); return 0;
    case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(window, message, wParam, lParam);
}

#ifdef DORN_UNINSTALLER
static BOOL owned_uninstall_target(const wchar_t *self, wchar_t *target, size_t count) {
  if (FAILED(StringCchCopyW(target, count, self))) return FALSE; wchar_t *slash = wcsrchr(target, L'\\'); if (!slash) return FALSE; *slash = 0;
  if (!valid_path(target) || !registry_matches_target(target)) return FALSE;
  DWORD attrs = GetFileAttributesW(target); if (attrs == INVALID_FILE_ATTRIBUTES || !(attrs & FILE_ATTRIBUTE_DIRECTORY) || (attrs & FILE_ATTRIBUTE_REPARSE_POINT)) return FALSE;
  wchar_t owner[DORN_MAX_PATH]; StringCchPrintfW(owner, DORN_MAX_PATH, L"%s\\DORN-INSTALL-OWNERSHIP.json", target); attrs = GetFileAttributesW(owner);
  return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT));
}

static int cleanup_mode(int argc, wchar_t **argv) {
  if (argc != 4 || wcscmp(argv[1], L"--dorn-cleanup") || !valid_path(argv[2]) || !registry_matches_target(argv[2])) return 71;
  DWORD pid = wcstoul(argv[3], NULL, 10); if (pid) { HANDLE process = OpenProcess(SYNCHRONIZE, FALSE, pid); if (process) { WaitForSingleObject(process, 60000); CloseHandle(process); } }
  remove_registration_and_shortcuts();
  if (!delete_tree_safe(argv[2])) return 72;
  wchar_t self[DORN_MAX_PATH]; GetModuleFileNameW(NULL, self, DORN_MAX_PATH); MoveFileExW(self, NULL, MOVEFILE_DELAY_UNTIL_REBOOT);
  return 0;
}

static int run_uninstaller(void) {
  int argc = 0; wchar_t **argv = CommandLineToArgvW(GetCommandLineW(), &argc); if (!argv) return 70;
  if (argc > 1) { int result = cleanup_mode(argc, argv); LocalFree(argv); return result; }
  LocalFree(argv);
  wchar_t self[DORN_MAX_PATH], target[DORN_MAX_PATH]; GetModuleFileNameW(NULL, self, DORN_MAX_PATH);
  if (!owned_uninstall_target(self, target, DORN_MAX_PATH) || run_agent(target, L"verify", NULL) != 0) { MessageBoxW(NULL, L"La instalación no coincide con el registro y manifiesto DORN. Ejecuta Installer v2 para reparar antes de desinstalar.", L"Desinstalación bloqueada", MB_OK | MB_ICONERROR); return 73; }
  if (MessageBoxW(NULL, L"¿Quieres quitar DORN AI?\n\nSe eliminará solamente el programa. Proyectos, conversaciones, modelos y preferencias se conservarán.", L"Desinstalar DORN AI", MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2) != IDYES) return 0;
  wchar_t tempRoot[DORN_MAX_PATH], tempExe[DORN_MAX_PATH]; if (!create_unique_temp(tempRoot, DORN_MAX_PATH)) return 74; StringCchPrintfW(tempExe, DORN_MAX_PATH, L"%s\\DORN AI Uninstall.exe", tempRoot);
  if (!CopyFileW(self, tempExe, TRUE)) return 75; unsigned char a[32], b[32]; if (!hash_file(self, a) || !hash_file(tempExe, b) || memcmp(a, b, 32)) return 76;
  wchar_t arguments[DORN_MAX_PATH + 80]; StringCchPrintfW(arguments, ARRAYSIZE(arguments), L"--dorn-cleanup \"%s\" %lu", target, GetCurrentProcessId());
  DWORD result = run_process(tempExe, arguments, tempRoot, FALSE, 0, L"UNINSTALL_CLEANUP_LAUNCH"); if (result) return (int)result;
  MessageBoxW(NULL, L"DORN AI se quitará al cerrar este mensaje. Tus datos de usuario se conservarán.", L"DORN AI", MB_OK | MB_ICONINFORMATION); return 0;
}
#endif

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR commandLine, int showCommand) {
  (void)previous; (void)commandLine; (void)showCommand; g_instance = instance; CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
#ifdef DORN_UNINSTALLER
  int result = run_uninstaller(); CoUninitialize(); return result;
#else
  SetProcessDPIAware(); initialize_log(); log_event(L"INSTALLER_START", DORN_INSTALLER_REVISION, 0); INITCOMMONCONTROLSEX controls = { sizeof(controls), ICC_PROGRESS_CLASS | ICC_STANDARD_CLASSES }; InitCommonControlsEx(&controls);
  g_background = CreateSolidBrush(color(0x080b0e)); g_edit = CreateSolidBrush(color(0x10161b));
  g_font = CreateFontW(-16,0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
  g_small = CreateFontW(-13,0,0,0,FW_SEMIBOLD,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
  g_title = CreateFontW(-58,0,0,0,FW_BOLD,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
  g_heading = CreateFontW(-30,0,0,0,FW_SEMIBOLD,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
  g_forest = (HBITMAP)LoadImageW(instance, MAKEINTRESOURCEW(2), IMAGE_BITMAP, 0, 0, LR_CREATEDIBSECTION);
  WNDCLASSEXW wc; ZeroMemory(&wc, sizeof(wc)); wc.cbSize = sizeof(wc); wc.style = CS_HREDRAW | CS_VREDRAW; wc.lpfnWndProc = window_proc; wc.hInstance = instance; wc.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(1)); wc.hIconSm = wc.hIcon; wc.hCursor = LoadCursorW(NULL, IDC_ARROW); wc.hbrBackground = g_background; wc.lpszClassName = L"DORN_AI_INSTALLER_V3";
  if (!RegisterClassExW(&wc)) return 80; int width = 920, height = 670; int x = (GetSystemMetrics(SM_CXSCREEN)-width)/2, y=(GetSystemMetrics(SM_CYSCREEN)-height)/2;
  g_window = CreateWindowExW(0, wc.lpszClassName, L"DORN AI · Installer v3", WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX, x,y,width,height,NULL,NULL,instance,NULL); if (!g_window) return 81;
  create_controls(g_window); ShowWindow(g_window, SW_SHOW); UpdateWindow(g_window); MSG message; while (GetMessageW(&message,NULL,0,0)>0) { TranslateMessage(&message); DispatchMessageW(&message); }
  DeleteObject(g_font); DeleteObject(g_small); DeleteObject(g_title); DeleteObject(g_heading); DeleteObject(g_background); DeleteObject(g_edit); if (g_forest) DeleteObject(g_forest); CoUninitialize(); return (int)message.wParam;
#endif
}

int WINAPI WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR commandLine, int showCommand) { (void)commandLine; return wWinMain(instance, previous, GetCommandLineW(), showCommand); }
