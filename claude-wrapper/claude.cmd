@ECHO off
SETLOCAL
REM Official Claude Code harness (latest binary) via Claudio native wrapper.
REM Legacy Ink fork: set CLAUDE_WRAPPER_MODE=claudio
IF NOT DEFINED CLAUDE_WRAPPER_MODE SET "CLAUDE_WRAPPER_MODE=native"
SET "HERE=%~dp0"
IF EXIST "%HERE%claudio-wrapper-native19.exe" (
  "%HERE%claudio-wrapper-native19.exe" %*
  EXIT /B %ERRORLEVEL%
)
IF EXIST "%HERE%claudio-wrapper-native18.exe" (
  "%HERE%claudio-wrapper-native18.exe" %*
  EXIT /B %ERRORLEVEL%
)
node "%HERE%claude-cli.js" %*
EXIT /B %ERRORLEVEL%
