@ECHO off
SETLOCAL
node "%~dp0provider-ui.js" %*
EXIT /B %ERRORLEVEL%
