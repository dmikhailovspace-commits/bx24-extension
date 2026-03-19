@echo off
chcp 65001 > nul
setlocal
title PENA Agency — Сборка установщика Windows (.exe)
cd /d "%~dp0"

echo.
echo ====================================================
echo  PENA Agency — Сборка Windows-установщика (.exe)
echo ====================================================
echo.

:: Создаём папку dist если нет
if not exist "..\..\dist" mkdir "..\..\dist"

:: Ищем компилятор Inno Setup 6
set ISCC=
for %%P in (
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
    "C:\Program Files\Inno Setup 6\ISCC.exe"
    "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
) do (
    if exist %%P ( set ISCC=%%~P & goto :found )
)

echo  [!] Inno Setup 6 не найден!
echo.
echo  Скачайте и установите бесплатно:
echo  https://jrsoftware.org/isinfo.php
echo.
pause
exit /b 1

:found
echo  [+] Inno Setup найден: %ISCC%
echo.
echo  Компилирую setup.iss ...
echo.

"%ISCC%" /Q "setup.iss"
set EC=%errorlevel%

echo.
if %EC% equ 0 (
    echo  ====================================================
    echo  [OK] Установщик успешно создан:
    echo       ..\..\dist\PENA_Agency_Setup_v5.0.0.exe
    echo  ====================================================
) else (
    echo  ====================================================
    echo  [!!] Ошибка компиляции. Код: %EC%
    echo  Проверьте setup.iss на наличие ошибок.
    echo  ====================================================
)
echo.
pause
