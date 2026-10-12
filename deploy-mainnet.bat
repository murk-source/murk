@echo off
chcp 65001 >nul
node "%~dp0deploy\deploy.mjs"
echo.
pause
