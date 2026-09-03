Unicode true
ManifestSupportedOS Win10
ManifestDPIAware true

!ifndef APP_SOURCE
  !error "Define APP_SOURCE con la carpeta completa del portable."
!endif

!ifndef OUTPUT_FILE
  !define OUTPUT_FILE "output\DORN_AI_Setup_4.0.0-alpha.7_x64.exe"
!endif

!ifndef DORN_EXE_SIZE
  !error "Define DORN_EXE_SIZE con el tamaño exacto del ejecutable completo."
!endif

!define PRODUCT_NAME "DORN AI"
!define PRODUCT_VERSION "4.0.0-alpha.7"
!define PRODUCT_PUBLISHER "DORN"
!define PRODUCT_EXE "DORN AI.exe"
!define PRODUCT_UNINSTALLER "Desinstalar DORN AI.exe"
!define PRODUCT_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\DORN AI"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
Caption "Instalar ${PRODUCT_NAME}"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\DORN AI"
InstallDirRegKey HKCU "${PRODUCT_KEY}" "InstallLocation"
RequestExecutionLevel user
CRCCheck on
; Se comprime cada archivo por separado. El paquete crece ligeramente, pero
; evita que una interrupción o un extractor defectuoso afecte fragmentos
; posteriores dentro de un único flujo LZMA sólido.
SetCompressor lzma
SetCompressorDictSize 64
ShowInstDetails show
ShowUninstDetails show
BrandingText "DORN · SOBERANÍA TECNOLÓGICA"

VIProductVersion "4.0.0.6"
VIAddVersionKey /LANG=1034 "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey /LANG=1034 "CompanyName" "${PRODUCT_PUBLISHER}"
VIAddVersionKey /LANG=1034 "FileDescription" "Instalador de DORN AI para Windows x64"
VIAddVersionKey /LANG=1034 "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=1034 "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=1034 "LegalCopyright" "Copyright DORN"

Icon "assets\dorn-installer.ico"
UninstallIcon "assets\dorn-installer.ico"

!define MUI_ICON "assets\dorn-installer.ico"
!define MUI_UNICON "assets\dorn-installer.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "assets\dorn-header.bmp"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_WELCOMEFINISHPAGE_BITMAP "assets\dorn-sidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "assets\dorn-sidebar.bmp"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Iniciar DORN AI"
!define MUI_FINISHPAGE_LINK "Abrir la ayuda de inicio"
!define MUI_FINISHPAGE_LINK_LOCATION "$INSTDIR\AYUDA-DE-INICIO.txt"

Var WelcomeDialog
Var WelcomeTitle
Var WelcomeEyebrow
Var WelcomeText
Var WelcomeVersion
Var WelcomeLine
Var WelcomeFont
Var WelcomeSmallFont
Var OptionsDialog
Var DesktopCheckbox
Var StartMenuCheckbox
Var DesignCheckbox
Var EducationCheckbox
Var MachineCheckbox
Var EditorCheckbox
Var CreateDesktop
Var CreateStartMenu
Var InstallDesign
Var InstallEducation
Var InstallMachine
Var InstallEditor

Page custom DORNWelcomeCreate DORNWelcomeLeave
!insertmacro MUI_PAGE_DIRECTORY
Page custom DORNOptionsCreate DORNOptionsLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "Spanish"

LangString DORN_DIR_TEXT ${LANG_SPANISH} "Elige dónde instalar DORN AI. Tus conversaciones, preferencias y modelos descargados se guardan por separado."

Function .onInit
  SetShellVarContext current
  ; NSIS utiliza un iniciador de 32 bits. En Windows x64, la arquitectura
  ; nativa se informa mediante PROCESSOR_ARCHITEW6432.
  ReadEnvStr $0 "PROCESSOR_ARCHITEW6432"
  StrCmp $0 "AMD64" ArchitectureOk
  ReadEnvStr $1 "PROCESSOR_ARCHITECTURE"
  StrCmp $1 "AMD64" ArchitectureOk
  StrCmp $0 "" 0 ArchitectureBlocked
  StrCpy $0 "$1"
ArchitectureBlocked:
  MessageBox MB_ICONSTOP|MB_OK "Esta entrega de DORN AI requiere Windows 10 u 11 con procesador x64. Arquitectura nativa detectada: $0. No se realizará una instalación incompatible."
  Abort
ArchitectureOk:
  StrCpy $CreateDesktop "1"
  StrCpy $CreateStartMenu "1"
  StrCpy $InstallDesign "1"
  StrCpy $InstallEducation "1"
  StrCpy $InstallMachine "0"
  StrCpy $InstallEditor "0"
FunctionEnd

Function DORNWelcomeCreate
  nsDialogs::Create 1018
  Pop $WelcomeDialog
  ${If} $WelcomeDialog == error
    Abort
  ${EndIf}

  SetCtlColors $WelcomeDialog F2F3F4 0A0A0C

  CreateFont $WelcomeFont "Segoe UI" 38 700
  CreateFont $WelcomeSmallFont "Consolas" 9 400

  ${NSD_CreateLabel} 8u 12u 260u 12u "●  ENTORNO DE TRABAJO INTELIGENTE"
  Pop $WelcomeEyebrow
  SetCtlColors $WelcomeEyebrow B7BBC0 0A0A0C
  SendMessage $WelcomeEyebrow ${WM_SETFONT} $WelcomeSmallFont 1

  ${NSD_CreateLabel} 8u 38u 270u 48u "DORN"
  Pop $WelcomeTitle
  SetCtlColors $WelcomeTitle F2F3F4 0A0A0C
  SendMessage $WelcomeTitle ${WM_SETFONT} $WelcomeFont 1

  ${NSD_CreateLabel} 8u 100u 270u 1u ""
  Pop $WelcomeLine
  SetCtlColors $WelcomeLine 3A3D42 3A3D42

  ${NSD_CreateLabel} 8u 118u 270u 54u "Instala DORN AI y los accesos independientes a Design, Education y Machine. Studio3D continúa en desarrollo para DORN 5.0.$\r$\n$\r$\nLocal cuando quieras. Conectado cuando tú lo decidas."
  Pop $WelcomeText
  SetCtlColors $WelcomeText B7BBC0 0A0A0C

  ${NSD_CreateLabel} 8u 188u 270u 14u "${PRODUCT_VERSION}  ·  WINDOWS x64"
  Pop $WelcomeVersion
  SetCtlColors $WelcomeVersion 74787D 0A0A0C
  SendMessage $WelcomeVersion ${WM_SETFONT} $WelcomeSmallFont 1

  nsDialogs::Show
FunctionEnd

Function DORNWelcomeLeave
FunctionEnd

Function DORNOptionsCreate
  !insertmacro MUI_HEADER_TEXT "Preferencias de instalación" "Decide cómo quieres acceder a DORN AI."
  nsDialogs::Create 1018
  Pop $OptionsDialog
  ${If} $OptionsDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0u 2u 100% 24u "DORN AI es obligatorio. Elige qué productos independientes quieres habilitar; los modelos de IA se descargan después desde el catálogo."
  Pop $0

  ${NSD_CreateCheckbox} 0u 31u 100% 14u "DORN Design · dibujo y composición visual"
  Pop $DesignCheckbox
  ${NSD_Check} $DesignCheckbox

  ${NSD_CreateCheckbox} 0u 51u 100% 14u "DORN Education · aprendizaje, cursos y corrector PAES"
  Pop $EducationCheckbox
  ${NSD_Check} $EducationCheckbox

  ${NSD_CreateCheckbox} 0u 71u 100% 14u "DORN Machine · productos físicos oficiales (base interna)"
  Pop $MachineCheckbox

  ${NSD_CreateCheckbox} 0u 91u 100% 14u "DORN Editor · edición audiovisual (base interna)"
  Pop $EditorCheckbox

  ${NSD_CreateCheckbox} 0u 121u 100% 14u "Crear accesos directos en el escritorio"
  Pop $DesktopCheckbox
  ${NSD_Check} $DesktopCheckbox

  ${NSD_CreateCheckbox} 0u 141u 100% 14u "Crear accesos directos en el menú Inicio"
  Pop $StartMenuCheckbox
  ${NSD_Check} $StartMenuCheckbox

  ${NSD_CreateLabel} 0u 169u 100% 26u "Privacidad: instalar DORN no activa telemetría. Cada API externa necesita configuración y confirmación."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function DORNOptionsLeave
  ${NSD_GetState} $DesktopCheckbox $CreateDesktop
  ${NSD_GetState} $StartMenuCheckbox $CreateStartMenu
  ${NSD_GetState} $DesignCheckbox $InstallDesign
  ${NSD_GetState} $EducationCheckbox $InstallEducation
  ${NSD_GetState} $MachineCheckbox $InstallMachine
  ${NSD_GetState} $EditorCheckbox $InstallEditor
FunctionEnd

Section "DORN AI" SEC_MAIN
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; Una actualización conserva datos de usuario, pero limpia archivos de
  ; programa antiguos para evitar mezclas de dependencias.
  Delete "$INSTDIR\${PRODUCT_EXE}"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"

  File /r /x "${PRODUCT_UNINSTALLER}" /x "*.log" "${APP_SOURCE}\*.*"

  ReadEnvStr $2 "COMSPEC"
  StrCmp $2 "" 0 +2
  StrCpy $2 "$SYSDIR\cmd.exe"
  nsExec::ExecToStack '"$2" /D /Q /C copy /B "$INSTDIR\DORN_AI_EXE.part000"+"$INSTDIR\DORN_AI_EXE.part001"+"$INSTDIR\DORN_AI_EXE.part002"+"$INSTDIR\DORN_AI_EXE.part003"+"$INSTDIR\DORN_AI_EXE.part004"+"$INSTDIR\DORN_AI_EXE.part005"+"$INSTDIR\DORN_AI_EXE.part006"+"$INSTDIR\DORN_AI_EXE.part007"+"$INSTDIR\DORN_AI_EXE.part008"+"$INSTDIR\DORN_AI_EXE.part009"+"$INSTDIR\DORN_AI_EXE.part010"+"$INSTDIR\DORN_AI_EXE.part011"+"$INSTDIR\DORN_AI_EXE.part012" "$INSTDIR\${PRODUCT_EXE}" >NUL'
  Pop $0
  Pop $1
  StrCmp $0 "0" ExeCopyOk
    MessageBox MB_ICONSTOP|MB_OK "El instalador no pudo reconstruir DORN AI.exe. No se creará una instalación incompleta.$\r$\n$\r$\nDetalle del sistema: $1"
    Abort

ExeCopyOk:
  FileOpen $0 "$INSTDIR\${PRODUCT_EXE}" r
  IfErrors ExeSizeWrong
  FileSeek $0 0 END $1
  FileClose $0
  IntCmp $1 ${DORN_EXE_SIZE} ExeSizeOk ExeSizeWrong ExeSizeWrong

ExeSizeWrong:
  Delete "$INSTDIR\${PRODUCT_EXE}"
  MessageBox MB_ICONSTOP|MB_OK "DORN AI.exe no alcanzó el tamaño íntegro esperado. La instalación se detuvo para evitar el error «esta aplicación no puede ejecutarse en este equipo»."
  Abort

ExeSizeOk:
  Delete "$INSTDIR\DORN_AI_EXE.part000"
  Delete "$INSTDIR\DORN_AI_EXE.part001"
  Delete "$INSTDIR\DORN_AI_EXE.part002"
  Delete "$INSTDIR\DORN_AI_EXE.part003"
  Delete "$INSTDIR\DORN_AI_EXE.part004"
  Delete "$INSTDIR\DORN_AI_EXE.part005"
  Delete "$INSTDIR\DORN_AI_EXE.part006"
  Delete "$INSTDIR\DORN_AI_EXE.part007"
  Delete "$INSTDIR\DORN_AI_EXE.part008"
  Delete "$INSTDIR\DORN_AI_EXE.part009"
  Delete "$INSTDIR\DORN_AI_EXE.part010"
  Delete "$INSTDIR\DORN_AI_EXE.part011"
  Delete "$INSTDIR\DORN_AI_EXE.part012"
  WriteUninstaller "$INSTDIR\${PRODUCT_UNINSTALLER}"
  FileOpen $9 "$INSTDIR\dorn-products.ini" w
  FileWrite $9 "[products]$\r$\n"
  FileWrite $9 "design=$InstallDesign$\r$\n"
  FileWrite $9 "education=$InstallEducation$\r$\n"
  FileWrite $9 "machine=$InstallMachine$\r$\n"
  FileWrite $9 "editor=$InstallEditor$\r$\n"
  FileClose $9

  Delete "$DESKTOP\DORN Design.lnk"
  Delete "$DESKTOP\DORN Education.lnk"
  Delete "$DESKTOP\DORN Machine.lnk"
  Delete "$DESKTOP\DORN Editor.lnk"
  Delete "$SMPROGRAMS\DORN\DORN Design.lnk"
  Delete "$SMPROGRAMS\DORN\DORN Education.lnk"
  Delete "$SMPROGRAMS\DORN\DORN Machine.lnk"
  Delete "$SMPROGRAMS\DORN\DORN Editor.lnk"

  ${If} $CreateDesktop == ${BST_CHECKED}
    CreateShortcut "$DESKTOP\DORN AI.lnk" "$INSTDIR\${PRODUCT_EXE}" "" "$INSTDIR\resources\startup\icon.ico" 0
    ${If} $InstallDesign == ${BST_CHECKED}
      CreateShortcut "$DESKTOP\DORN Design.lnk" "$INSTDIR\${PRODUCT_EXE}" "--product=design" "$INSTDIR\resources\startup\icons\design.ico" 0
    ${EndIf}
    ${If} $InstallEducation == ${BST_CHECKED}
      CreateShortcut "$DESKTOP\DORN Education.lnk" "$INSTDIR\${PRODUCT_EXE}" "--product=education" "$INSTDIR\resources\startup\icons\education.ico" 0
    ${EndIf}
    ${If} $InstallMachine == ${BST_CHECKED}
      CreateShortcut "$DESKTOP\DORN Machine.lnk" "$INSTDIR\${PRODUCT_EXE}" "--product=machine" "$INSTDIR\resources\startup\icons\machine.ico" 0
    ${EndIf}
    ${If} $InstallEditor == ${BST_CHECKED}
      CreateShortcut "$DESKTOP\DORN Editor.lnk" "$INSTDIR\${PRODUCT_EXE}" "--product=editor" "$INSTDIR\resources\startup\icons\editor.ico" 0
    ${EndIf}
  ${EndIf}

  ${If} $CreateStartMenu == ${BST_CHECKED}
    CreateDirectory "$SMPROGRAMS\DORN"
    CreateShortcut "$SMPROGRAMS\DORN\DORN AI.lnk" "$INSTDIR\${PRODUCT_EXE}" "" "$INSTDIR\resources\startup\icon.ico" 0
    ${If} $InstallDesign == ${BST_CHECKED}
      CreateShortcut "$SMPROGRAMS\DORN\DORN Design.lnk" "$INSTDIR\${PRODUCT_EXE}" "--product=design" "$INSTDIR\resources\startup\icons\design.ico" 0
    ${EndIf}
    ${If} $InstallEducation == ${BST_CHECKED}
      CreateShortcut "$SMPROGRAMS\DORN\DORN Education.lnk" "$INSTDIR\${PRODUCT_EXE}" "--product=education" "$INSTDIR\resources\startup\icons\education.ico" 0
    ${EndIf}
    ${If} $InstallMachine == ${BST_CHECKED}
      CreateShortcut "$SMPROGRAMS\DORN\DORN Machine.lnk" "$INSTDIR\${PRODUCT_EXE}" "--product=machine" "$INSTDIR\resources\startup\icons\machine.ico" 0
    ${EndIf}
    ${If} $InstallEditor == ${BST_CHECKED}
      CreateShortcut "$SMPROGRAMS\DORN\DORN Editor.lnk" "$INSTDIR\${PRODUCT_EXE}" "--product=editor" "$INSTDIR\resources\startup\icons\editor.ico" 0
    ${EndIf}
    CreateShortcut "$SMPROGRAMS\DORN\Desinstalar DORN AI.lnk" "$INSTDIR\${PRODUCT_UNINSTALLER}"
  ${EndIf}

  WriteRegStr HKCU "${PRODUCT_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${PRODUCT_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${PRODUCT_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${PRODUCT_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${PRODUCT_KEY}" "DisplayIcon" "$INSTDIR\${PRODUCT_EXE},0"
  WriteRegStr HKCU "${PRODUCT_KEY}" "UninstallString" '"$INSTDIR\${PRODUCT_UNINSTALLER}"'
  WriteRegStr HKCU "${PRODUCT_KEY}" "QuietUninstallString" '"$INSTDIR\${PRODUCT_UNINSTALLER}" /S'
  WriteRegDWORD HKCU "${PRODUCT_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${PRODUCT_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\DORN AI.lnk"
  Delete "$DESKTOP\DORN Design.lnk"
  Delete "$DESKTOP\DORN Education.lnk"
  Delete "$DESKTOP\DORN Machine.lnk"
  Delete "$DESKTOP\DORN Editor.lnk"
  RMDir /r "$SMPROGRAMS\DORN"
  DeleteRegKey HKCU "${PRODUCT_KEY}"

  RMDir /r "$INSTDIR"

  IfSilent KeepUserData
  MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 "¿También quieres eliminar las conversaciones, preferencias y modelos locales guardados por DORN en este usuario de Windows?" IDNO KeepUserData
  RMDir /r "$APPDATA\DORN AI"

KeepUserData:
SectionEnd
