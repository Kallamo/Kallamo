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

; The assisted installer's own finish page, with a show function to colour the run checkbox.
; A show function applies to the next page declared, so it is defined here, right before it.
!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif

  !define MUI_PAGE_CUSTOMFUNCTION_SHOW KallamoFinishShow
  !insertmacro MUI_PAGE_FINISH

  ; Defined after the page, which declares $mui.FinishPage.Run. A themed checkbox ignores
  ; control colours, so its theme is dropped first.
  Function KallamoFinishShow
    !ifndef HIDE_RUN_AFTER_FINISH
      System::Call 'uxtheme::SetWindowTheme(p $mui.FinishPage.Run, w " ", w " ")'
      SetCtlColors $mui.FinishPage.Run EEF2F5 011419
    !endif
  FunctionEnd
!macroend

; The assisted installer has no welcome page unless one is asked for.
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend
