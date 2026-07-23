@ECHO off
SETLOCAL
SET "SCRIPT=%~dp0set-default-model.js"
node "%SCRIPT%" %*
