# ==============================================================
# PENA Agency — Полный установщик расширения для Битрикс24
# Версия: 2.3.0  |  Платформа: Windows
# ==============================================================
# Запуск: дважды кликните install_windows.bat
# ==============================================================

# Вспомогательные функции
function Info  ($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Ok    ($m) { Write-Host "  $m" -ForegroundColor Green }
function Warn  ($m) { Write-Host "  $m" -ForegroundColor Yellow }
function Fail  ($m) { Write-Host "  $m" -ForegroundColor Red }
function Div   ()   { Write-Host ("=" * 54) -ForegroundColor Cyan }
function Wait  ()   {
    Write-Host ""
    $null = Read-Host "  Нажмите Enter для выхода"
}

function MakeShortcut($Path, $Target, $LnkArgs, $WorkDir, $Desc) {
    try {
        $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($Path)
        $sc.TargetPath       = $Target
        $sc.Arguments        = $LnkArgs
        $sc.WorkingDirectory = $WorkDir
        $sc.Description      = $Desc
        $sc.IconLocation     = "$Target, 0"
        $sc.Save()
        return $true
    } catch {
        Warn "Не удалось создать ярлык '$Path': $($_.Exception.Message)"
        return $false
    }
}

# ==============================================================
# Основная логика — обёрнута в try/catch
# ==============================================================
try {

Div
Info "PENA Agency — Установщик расширения"
Info "Битрикс24  |  Windows  |  v2.3.0"
Div
Write-Host ""

# --- 1. Пути ---

# $PSScriptRoot всегда корректен при запуске через -File
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $ScriptDir) { $ScriptDir = (Get-Location).Path }

Write-Host "  Папка скрипта:   $ScriptDir" -ForegroundColor DarkGray

# Корень расширения — папка extension/ рядом с installers/
$ExtSource = (Get-Item (Join-Path $ScriptDir "..\..\extension")).FullName
$InstallDir = Join-Path $env:LOCALAPPDATA "PENA Agency\Extension"

Info "Исходная папка:   $ExtSource"
Info "Папка установки:  $InstallDir"
Write-Host ""

if (-not (Test-Path (Join-Path $ExtSource "manifest.json"))) {
    Fail "ОШИБКА: manifest.json не найден в '$ExtSource'"
    Fail "Убедитесь, что папка 'installers' находится ВНУТРИ папки расширения."
    Wait; exit 1
}

# --- 2. Копируем файлы ---

Warn "Копирую файлы расширения..."

if (Test-Path $InstallDir) {
    Warn "Найдена предыдущая установка — обновляю..."
    Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -Path $InstallDir -ItemType Directory -Force | Out-Null

$ExcludeDirs  = @('installers', '.claude', 'gitInf', '.git')
$ExcludeFiles = @('*.ps1', '*.sh', '*.bat', 'README.md')

Get-ChildItem -Path $ExtSource | ForEach-Object {
    $skip = $false
    foreach ($d in $ExcludeDirs)  { if ($_.Name -eq $d) { $skip = $true; break } }
    foreach ($p in $ExcludeFiles) { if ($_.Name -like $p) { $skip = $true; break } }
    if (-not $skip) {
        Copy-Item -Path $_.FullName -Destination $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path (Join-Path $InstallDir "manifest.json"))) {
    Fail "ОШИБКА: файлы не скопировались. Проверьте права доступа к:"
    Fail "$InstallDir"
    Wait; exit 1
}

Ok "Файлы скопированы: $InstallDir"
Write-Host ""

# --- 3. Ищем Битрикс24 ---

$BitrixCandidates = @(
    "C:\Program Files (x86)\Bitrix24\Bitrix24.exe",
    "C:\Program Files\Bitrix24\Bitrix24.exe",
    "$env:LOCALAPPDATA\Programs\Bitrix24\Bitrix24.exe",
    "$env:LOCALAPPDATA\Bitrix24\Bitrix24.exe",
    "$env:APPDATA\Bitrix24\Bitrix24.exe"
)

$BitrixExe = $null
foreach ($p in $BitrixCandidates) {
    if (Test-Path $p) { $BitrixExe = $p; break }
}

if (-not $BitrixExe) {
    Warn "Битрикс24 не найден по стандартным путям."
    Write-Host ""
    $BitrixInput = (Read-Host "  Введите путь к Bitrix24.exe").Trim().Trim('"')
    if (-not (Test-Path $BitrixInput)) {
        Fail "Файл не найден: $BitrixInput"
        Wait; exit 1
    }
    $BitrixExe = $BitrixInput
}

Ok "Битрикс24: $BitrixExe"
Write-Host ""

# --- 4. Ярлыки ---

$ExtArgs = "--disable-extensions-except=`"$InstallDir`" --load-extension=`"$InstallDir`""

# Обновляем стандартные ярлыки
$StdShortcuts = @(
    "$env:USERPROFILE\Desktop\Bitrix24.lnk",
    "$env:PUBLIC\Desktop\Bitrix24.lnk",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Bitrix24\Bitrix24.lnk"
)
# ProgramData требует прав администратора — добавляем только если они есть
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($IsAdmin) {
    $StdShortcuts += "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Bitrix24\Bitrix24.lnk"
}
$UpdatedCount = 0
foreach ($s in $StdShortcuts) {
    if (Test-Path $s) {
        if (MakeShortcut $s $BitrixExe $ExtArgs (Split-Path $BitrixExe) "Битрикс24 с PENA Agency") {
            Ok "Обновлён ярлык: $(Split-Path $s -Leaf)"
            $UpdatedCount++
        }
    }
}

# Ярлык PENA Agency на рабочем столе
$PenaDesktopLnk = "$env:USERPROFILE\Desktop\Bitrix24 (PENA Agency).lnk"
if (MakeShortcut $PenaDesktopLnk $BitrixExe $ExtArgs (Split-Path $BitrixExe) "Битрикс24 с расширением PENA Agency") {
    Ok "Создан ярлык: Bitrix24 (PENA Agency) [рабочий стол]"
}

# Ярлык в меню Пуск
$StartMenuDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Сортировщик чатов BX24"
New-Item -Path $StartMenuDir -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null
$PenaStartLnk = "$StartMenuDir\Bitrix24 (PENA Agency).lnk"
if (MakeShortcut $PenaStartLnk $BitrixExe $ExtArgs (Split-Path $BitrixExe) "Битрикс24 с расширением PENA Agency") {
    Ok "Создан ярлык: Bitrix24 (PENA Agency) [меню Пуск]"
}
Write-Host ""

# --- 5. Автообновление — Task Scheduler ---

$UpdaterSrc = Join-Path $ScriptDir "updater.ps1"
$UpdaterDst = Join-Path $InstallDir "updater.ps1"

if (Test-Path $UpdaterSrc) {
    Copy-Item $UpdaterSrc $UpdaterDst -Force
    try {
        $action   = New-ScheduledTaskAction `
            -Execute "powershell.exe" `
            -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$UpdaterDst`""
        $trigger  = New-ScheduledTaskTrigger -Daily -At "10:00"
        $settings = New-ScheduledTaskSettingsSet `
            -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
            -StartWhenAvailable `
            -RunOnlyIfNetworkAvailable
        Register-ScheduledTask `
            -TaskName "PENAAgencyUpdater" `
            -Action $action `
            -Trigger $trigger `
            -Settings $settings `
            -Description "Ежедневная проверка обновлений PENA Agency" `
            -RunLevel Limited `
            -Force | Out-Null
        Ok "Автообновление: зарегистрировано (ежедневно в 10:00)"
    } catch {
        Warn "Не удалось зарегистрировать задачу автообновления: $($_.Exception.Message)"
    }
} else {
    Warn "pena_updater.ps1 не найден — автообновление не настроено."
}
Write-Host ""

# --- 6. Деинсталлятор ---

$UninstallPath = Join-Path $InstallDir "uninstall.ps1"
@"
# PENA Agency — Деинсталлятор
`$ErrorActionPreference = "SilentlyContinue"
`$ws = New-Object -ComObject WScript.Shell
`$lnk1 = "$PenaDesktopLnk"
`$lnk2 = "$PenaStartLnk"
`$dir  = "$InstallDir"
`$smdir = "$StartMenuDir"
Write-Host "Удаление PENA Agency..." -ForegroundColor Cyan
if (Test-Path `$lnk1)  { Remove-Item `$lnk1  -Force; Write-Host "Удалён: `$lnk1"  -ForegroundColor Green }
if (Test-Path `$lnk2)  { Remove-Item `$lnk2  -Force; Write-Host "Удалён: `$lnk2"  -ForegroundColor Green }
if (Test-Path `$smdir) { Remove-Item `$smdir -Recurse -Force; Write-Host "Удалена папка меню Пуск" -ForegroundColor Green }
@("$($env:USERPROFILE)\Desktop\Bitrix24.lnk","$($env:PUBLIC)\Desktop\Bitrix24.lnk","$($env:APPDATA)\Microsoft\Windows\Start Menu\Programs\Bitrix24\Bitrix24.lnk","$($env:ProgramData)\Microsoft\Windows\Start Menu\Programs\Bitrix24\Bitrix24.lnk") | ForEach-Object {
    if (Test-Path `$_) { `$sc=`$ws.CreateShortcut(`$_); if(`$sc.Arguments -like "*load-extension*"){ `$sc.Arguments=""; `$sc.Save(); Write-Host "Восстановлен: `$_" -ForegroundColor Green } }
}
if (Test-Path `$dir) { Remove-Item `$dir -Recurse -Force; Write-Host "Удалена папка: `$dir" -ForegroundColor Green }
Write-Host ""; Write-Host "Удалено успешно." -ForegroundColor Green
Write-Host "Нажмите любую клавишу..." -ForegroundColor DarkGray
[void][System.Console]::ReadKey(`$true)
"@ | Set-Content -Path $UninstallPath -Encoding UTF8

Ok "Деинсталлятор: $UninstallPath"
Write-Host ""

# --- 7. Итог ---

Div
Ok "Установка завершена успешно!"
Div
Write-Host ""
Ok "Расширение: $InstallDir"
Ok "Ярлык: Bitrix24 (PENA Agency) [рабочий стол + меню Пуск]"
if ($UpdatedCount -gt 0) { Ok "Обновлено стандартных ярлыков Битрикс24: $UpdatedCount" }
Write-Host ""
Warn "Для удаления: $InstallDir\uninstall.ps1"
Write-Host ""

$ans = Read-Host "  Запустить Битрикс24 прямо сейчас? (y/n)"
if ($ans -match '^[YyДд]') {
    Ok "Запускаю..."
    Start-Process -FilePath $BitrixExe -ArgumentList $ExtArgs
}

} catch {
    # Глобальный перехватчик — любая необработанная ошибка
    Write-Host ""
    Div
    Fail "НЕПРЕДВИДЕННАЯ ОШИБКА:"
    Fail "$($_.Exception.Message)"
    Write-Host "  Строка $($_.InvocationInfo.ScriptLineNumber)" -ForegroundColor DarkGray
    Div
    Write-Host ""
    # Сигнализируем bat-файлу об ошибке
    exit 1
}
