@ECHO off
SETLOCAL
SET "SCRIPT=%~dp0sync-catalog.js"
node "%SCRIPT%" %*
EXIT /B %ERRORLEVEL%
