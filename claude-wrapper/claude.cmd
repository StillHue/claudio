@ECHO off
SETLOCAL
REM Official Claude Code harness + local bridge (Node.js).
SET "HERE=%~dp0"
node "%HERE%claude-cli.js" %*
EXIT /B %ERRORLEVEL%
