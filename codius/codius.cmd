@ECHO off
SETLOCAL
SET "HERE=%~dp0"
node "%HERE%codius-wrapper.js" %*
EXIT /B %ERRORLEVEL%
