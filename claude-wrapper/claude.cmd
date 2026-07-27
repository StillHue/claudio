@ECHO off
SETLOCAL
REM Official Claude Code harness (latest binary) via Claudio native wrapper.
REM Uses Node.js directly so JS changes are picked up (bypasses compiled .exe).
REM To switch back to the compiled binary, set CLAUDE_USE_EXE=1.
REM Legacy Ink fork: set CLAUDE_WRAPPER_MODE=claudio
IF NOT DEFINED CLAUDE_WRAPPER_MODE SET "CLAUDE_WRAPPER_MODE=native"
SET "HERE=%~dp0"
IF DEFINED CLAUDE_USE_EXE (
  IF EXIST "%HERE%claudio-wrapper-native19.exe" (
    "%HERE%claudio-wrapper-native19.exe" %*
    EXIT /B %ERRORLEVEL%
  )
  IF EXIST "%HERE%claudio-wrapper-native18.exe" (
    "%HERE%claudio-wrapper-native18.exe" %*
    EXIT /B %ERRORLEVEL%
  )
)
node "%HERE%claude-cli.js" %*
EXIT /B %ERRORLEVEL%
