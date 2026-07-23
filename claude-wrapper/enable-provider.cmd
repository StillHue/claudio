@ECHO off
SETLOCAL
node "%~dp0enable-provider.js" %*
EXIT /B %ERRORLEVEL%
