@echo off
chcp 65001 > nul
setlocal
title BX24 Chat Sorter -- Installer
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
