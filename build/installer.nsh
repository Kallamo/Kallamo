; Included at the top of the generated installer, before any page is declared.

; Kallamo's ground on the header, the welcome page and the finish page.
; The page bodies, buttons and progress bar stay Windows' own.
!define MUI_BGCOLOR 011419
!define MUI_TEXTCOLOR EEF2F5

!ifndef BUILD_UNINSTALLER
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Kallamo Setup"
  !define MUI_WELCOMEPAGE_TEXT "Kallamo is a local-first studio for roleplay and long-form writing.$\r$\n$\r$\nYour stories stay on this computer. Click Next to continue."
  !define MUI_FINISHPAGE_TITLE "Kallamo is ready"
  !define MUI_FINISHPAGE_TEXT "Kallamo has been installed on your computer. From now on it updates itself when it opens."
!endif

; The assisted installer has no welcome page unless one is asked for.
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend
