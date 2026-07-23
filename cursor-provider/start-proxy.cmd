@echo off
setlocal
REM Shim forces cmd.exe spawn (preserves Windows agent.cmd auth)
set "CURSOR_AGENT_BIN=%~dp0agent-for-proxy.cmd"
set "CURSOR_BRIDGE_MODE=ask"
REM chat-only overrides HOME/USERPROFILE and breaks agent login on Windows
set "CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE=0"
set "CURSOR_BRIDGE_WORKSPACE=%USERPROFILE%"
set "PATH=C:\Users\gabdr\AppData\Local\cursor-agent;%PATH%"
echo Starting cursor-api-proxy on http://127.0.0.1:8765 ...
echo agent bin: %CURSOR_AGENT_BIN%
echo chat-only: %CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE%
npx --yes cursor-api-proxy@latest %*
