\
# ==============================================================
# Sortировщик чатов BX24 — установщик (запасной, без .exe)
# Запуск: дважды кликните install.bat
# ==============================================================

function Info  ($m) { Write-Host "  -> $m" -ForegroundColor Cyan }
function Ok    ($m) { Write-Host "  OK $m" -ForegroundColor Green }
function Warn  ($m) { Write-Host "  >> $m" -ForegroundColor Yellow }
function Fail  ($m) { Write-Host "  !! $m" -ForegroundColor Red }
function Div   ()   { Write-Host ("=" * 54) -ForegroundColor Cyan }

function MakeShortcut($Path, $Target, $LnkArgs, $WorkDir, $Desc) {
    try {
        $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($Path)
        $sc.TargetPath       = $Target
        $sc.Arguments        = $LnkArgs
        $sc.WorkingDirectory = $WorkDir
        $sc.Description      = $Desc
        $sc.Save()
        return $true
    } catch {
        Warn "Shortcut failed '$Path': $($_.Exception.Message)"
        return $false
    }
}

try {

Div
Info "BX24 Chat Sorter installer"
Info "Windows | v5.0.0"
Div
Write-Host ""

# --- 1. Пути ---
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $ScriptDir) { $ScriptDir = (Get-Location).Path }

Write-Host "  Script dir:  $ScriptDir" -ForegroundColor DarkGray

$ExtSource  = (Get-Item (Join-Path $ScriptDir "..\..\extension")).FullName
$InstallDir = Join-Path $env:LOCALAPPDATA "PENA Agency\Extension"

Info "Source:  $ExtSource"
Info "Target:  $InstallDir"
Write-Host ""

if (-not (Test-Path (Join-Path $ExtSource "manifest.json"))) {
    Fail "ERROR: manifest.json not found in '$ExtSource'"
    Fail "Run install.bat from inside the project folder."
    Read-Host "Press Enter to exit"; exit 1
}

# --- 2. Копируем файлы ---
Warn "Copying extension files..."

if (Test-Path $InstallDir) {
    Warn "Previous installation found - updating..."
    Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -Path $InstallDir -ItemType Directory -Force | Out-Null

$ExcludeDirs  = @('installers', '.claude', 'gitInf', '.git', 'dist')
$ExcludeFiles = @('*.ps1', '*.sh', '*.bat', '*.command', 'README.md', '.gitignore')

Get-ChildItem -Path $ExtSource | ForEach-Object {
    $skip = $false
    foreach ($d in $ExcludeDirs)  { if ($_.Name -eq $d) { $skip = $true; break } }
    foreach ($p in $ExcludeFiles) { if ($_.Name -like $p) { $skip = $true; break } }
    if (-not $skip) {
        Copy-Item -Path $_.FullName -Destination $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path (Join-Path $InstallDir "manifest.json"))) {
    Fail "ERROR: files not copied. Check permissions for: $InstallDir"
    Read-Host "Press Enter to exit"; exit 1
}
Ok "Files copied to: $InstallDir"
Write-Host ""

# --- 3. Ищем Bitrix24 ---
$BitrixCandidates = @(
    "$env:LOCALAPPDATA\Programs\Bitrix24\Bitrix24.exe",
    "$env:LOCALAPPDATA\Bitrix24\Bitrix24.exe",
    "C:\Program Files (x86)\Bitrix24\Bitrix24.exe",
    "C:\Program Files\Bitrix24\Bitrix24.exe",
    "$env:APPDATA\Bitrix24\Bitrix24.exe"
)

$BitrixExe = $null
foreach ($p in $BitrixCandidates) {
    if (Test-Path $p) { $BitrixExe = $p; break }
}

# Проверяем реестр
if (-not $BitrixExe) {
    $regPaths = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Bitrix24',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Bitrix24',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Bitrix24'
    )
    foreach ($rp in $regPaths) {
        if (Test-Path $rp) {
            $loc = (Get-ItemProperty $rp -ErrorAction SilentlyContinue).InstallLocation
            if ($loc) {
                $c = Join-Path $loc "Bitrix24.exe"
                if (Test-Path $c) { $BitrixExe = $c; break }
            }
        }
    }
}

if (-not $BitrixExe) {
    Warn "Bitrix24 not found in standard paths."
    Write-Host ""
    $BitrixInput = (Read-Host "  Enter full path to Bitrix24.exe").Trim().Trim('"')
    if (-not (Test-Path $BitrixInput)) {
        Fail "File not found: $BitrixInput"
        Read-Host "Press Enter to exit"; exit 1
    }
    $BitrixExe = $BitrixInput
}

Ok "Bitrix24: $BitrixExe"
# Сохраняем путь для -Launch
$BitrixExe | Set-Content -Path "$env:LOCALAPPDATA\PENA Agency\bitrix_path.txt" -Encoding UTF8
Write-Host ""

# --- 4. Ярлыки ---
$ExtArgs  = "--disable-extensions-except=`"$InstallDir`" --load-extension=`"$InstallDir`""
$Desktop  = [Environment]::GetFolderPath('Desktop')

# Новый ярлык на рабочем столе
$DesktopLnk = "$Desktop\Bitrix24 + Chat Filter.lnk"
if (MakeShortcut $DesktopLnk $BitrixExe $ExtArgs (Split-Path $BitrixExe) "Bitrix24 with BX24 Chat Sorter") {
    Ok "Shortcut created: Desktop"
}

# Меню Пуск
$StartDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\BX24 Chat Sorter"
New-Item -Path $StartDir -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null
$StartLnk = "$StartDir\Bitrix24 + Chat Filter.lnk"
if (MakeShortcut $StartLnk $BitrixExe $ExtArgs (Split-Path $BitrixExe) "Bitrix24 with BX24 Chat Sorter") {
    Ok "Shortcut created: Start Menu"
}

# Обновляем стандартные ярлыки Bitrix24
$StdLinks = @(
    "$Desktop\Bitrix24.lnk",
    "$env:PUBLIC\Desktop\Bitrix24.lnk",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Bitrix24\Bitrix24.lnk"
)
foreach ($lnk in $StdLinks) {
    if (Test-Path $lnk) {
        if (MakeShortcut $lnk $BitrixExe $ExtArgs (Split-Path $BitrixExe) "Bitrix24 with BX24 Chat Sorter") {
            Ok "Updated shortcut: $(Split-Path $lnk -Leaf)"
        }
    }
}

# --- 5. Автообновление ---
$UpdaterSrc = Join-Path $ScriptDir "updater.ps1"
$UpdaterDst = Join-Path $InstallDir "updater.ps1"

if (Test-Path $UpdaterSrc) {
    Copy-Item $UpdaterSrc $UpdaterDst -Force
    try {
        $action   = New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$UpdaterDst`""
        $trigger  = New-ScheduledTaskTrigger -Daily -At "10:00"
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
            -StartWhenAvailable -RunOnlyIfNetworkAvailable
        Register-ScheduledTask -TaskName "PENAAgencyUpdater" -Action $action -Trigger $trigger `
            -Settings $settings -Description "BX24 Chat Sorter daily update check" `
            -RunLevel Limited -Force | Out-Null
        Ok "Auto-update task registered (daily at 10:00)"
    } catch {
        Warn "Could not register update task: $($_.Exception.Message)"
    }
}
Write-Host ""

# --- 6. Итог ---
Div
Ok "Installation complete!"
Div
Write-Host ""
Ok "Extension: $InstallDir"
Ok "Shortcut:  $DesktopLnk"
Write-Host ""

$ans = Read-Host "  Launch Bitrix24 now? (y/n)"
if ($ans -match '^[Yy1]') {
    Ok "Launching..."
    Start-Process -FilePath $BitrixExe -ArgumentList $ExtArgs
}

} catch {
    Write-Host ""
    Write-Host ("=" * 54) -ForegroundColor Red
    Write-Host "  UNEXPECTED ERROR:" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Line: $($_.InvocationInfo.ScriptLineNumber)" -ForegroundColor DarkGray
    Write-Host ("=" * 54) -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}
