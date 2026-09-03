; El instalador genérico de electron-builder instala únicamente DORN AI.
; La selección de Design, Education, Machine y Editor pertenece al instalador
; industrial editable de installer/dorn-installer.nsi, que también escribe
; dorn-products.ini y crea los accesos con identidades visuales diferentes.
!macro customInstall
!macroend

!macro customUnInstall
  Delete "$DESKTOP\DORN Design.lnk"
  Delete "$DESKTOP\DORN Education.lnk"
  Delete "$DESKTOP\DORN Machine.lnk"
  Delete "$DESKTOP\DORN Editor.lnk"
  Delete "$SMPROGRAMS\DORN\DORN Design.lnk"
  Delete "$SMPROGRAMS\DORN\DORN Education.lnk"
  Delete "$SMPROGRAMS\DORN\DORN Machine.lnk"
  Delete "$SMPROGRAMS\DORN\DORN Editor.lnk"
  RMDir "$SMPROGRAMS\DORN"
!macroend
