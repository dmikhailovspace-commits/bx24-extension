# ==============================================================
# PENA Agency — Скрипт автообновления (Windows)
# Версия: 6.1.0
#
# Режимы запуска:
#   -Setup   : Первоначальная настройка (запускается установщиком)
#              Находит Bitrix24, создаёт ярлыки, регистрирует
#              задачу в Планировщике для ежедневного обновления.
#   -Launch  : Запускает Bitrix24 с расширением (из чекбокса в конце установки).
#   (нет)    : Проверяет обновление и устанавливает, если есть.
#
# Планировщик запускает этот скрипт ежедневно автоматически.
# ==============================================================
param(
    [switch]$Setup,                 # первоначальная настройка (из Inno Setup)
    [switch]$Launch,                # запустить Bitrix24 с расширением
    [switch]$LaunchWithUpdate,      # проверить обновление + запустить (из ярлыка)
    [switch]$CreateDesktopShortcut, # создать ярлык на рабочем столе (postinstall чекбокс)
    [string]$InstallFrom            # атомарно опубликовать staging-каталог установщика
)

# ── Конфигурация (замените URL на свой реальный репозиторий) ──
$UPDATE_JSON_URL = "https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json"
$INSTALL_DIR     = "$env:LOCALAPPDATA\PENA Agency\Extension"
$TASK_NAME       = "PENAAgencyUpdater"
$LOG_FILE        = "$env:LOCALAPPDATA\PENA Agency\updater.log"
$BITRIX_PATH_FILE = "$env:LOCALAPPDATA\PENA Agency\bitrix_path.txt"
$TRUSTED_RAW_PREFIX = "https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension"
$REQUIRED_EXTENSION_FILES = @(
    'background.js',
    'content.js',
    'native-catalog.js',
    'native-interaction-state.js',
	'native-time-control.js',
    'native-lifecycle.js',
    'dialog-repository.js',
    'injected.js',
    'injected.css',
    'manifest.json',
    'popup.html',
    'popup.js',
    'icons/icon16.png',
    'icons/icon48.png',
    'icons/icon128.png',
    'icons/logo.png'
)
$REQUIRED_WINDOWS_RELEASE_FILES = @(
    'installers/windows/updater.ps1',
    'installers/windows/pena_host.ps1',
    'installers/windows/pena_host.bat'
)
$REQUIRED_WINDOWS_TARGET_FILES = @('updater.ps1', 'pena_host.ps1', 'pena_host.bat')
# ──────────────────────────────────────────────────────────────

$ErrorActionPreference = "SilentlyContinue"

function Log($msg) {
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $line = "[$ts] $msg"
    Write-Host $line
    try {
        $logDir = Split-Path $LOG_FILE
        if (-not (Test-Path $logDir)) { New-Item $logDir -ItemType Directory -Force | Out-Null }
        Add-Content -Path $LOG_FILE -Value $line -Encoding UTF8
    } catch {}
}

function ShowBalloon($title, $text) {
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue
        $ico = [System.Drawing.SystemIcons]::Information
        $n = New-Object System.Windows.Forms.NotifyIcon
        $n.Icon = $ico
        $n.BalloonTipTitle = $title
        $n.BalloonTipText  = $text
        $n.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Info
        $n.Visible = $true
        $n.ShowBalloonTip(8000)
        Start-Sleep -Seconds 2
        $n.Dispose()
    } catch {}
}

function CompareVersions($a, $b) {
    # Возвращает 1 если $a > $b, 0 если равны, -1 если $a < $b
    try {
        $va = [System.Version]$a
        $vb = [System.Version]$b
        return $va.CompareTo($vb)
    } catch { return 0 }
}

function ConvertTo-SafeReleasePath($Path) {
    $normalized = ([string]$Path).Replace('\', '/').Trim()
    if ([string]::IsNullOrWhiteSpace($normalized) -or
        $normalized.StartsWith('/') -or
        $normalized -match '(^|/)\.\.(/|$)' -or
        $normalized -notmatch '^[A-Za-z0-9._/-]+$') {
        throw "Недопустимый путь release-файла: $Path"
    }
    return $normalized
}

function Get-BitrixExecutable {
    if (Test-Path $BITRIX_PATH_FILE) {
        $savedPath = (Get-Content $BITRIX_PATH_FILE -Raw -ErrorAction SilentlyContinue).Trim()
        if ($savedPath -and (Test-Path $savedPath)) { return $savedPath }
    }
    foreach ($candidate in @(
        "$env:LOCALAPPDATA\Programs\Bitrix24\Bitrix24.exe",
        "$env:LOCALAPPDATA\Bitrix24\Bitrix24.exe",
        "C:\Program Files (x86)\Bitrix24\Bitrix24.exe",
        "C:\Program Files\Bitrix24\Bitrix24.exe"
    )) {
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Test-StagedRelease($StageDir, $ExpectedVersion, $ExpectedFiles) {
    $manifestPath = Join-Path $StageDir 'manifest.json'
    if (-not (Test-Path $manifestPath -PathType Leaf)) {
        throw "В staging-каталоге отсутствует manifest.json"
    }
    try {
        $manifest = Get-Content $manifestPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw "Некорректный manifest.json в staging-каталоге: $($_.Exception.Message)"
    }
    if ([string]$manifest.version -ne [string]$ExpectedVersion) {
        throw "Версия staging manifest ($($manifest.version)) не совпадает с release ($ExpectedVersion)"
    }

    foreach ($relativePath in $ExpectedFiles) {
        $safePath = ConvertTo-SafeReleasePath $relativePath
        $filePath = Join-Path $StageDir ($safePath.Replace('/', '\'))
        if (-not (Test-Path $filePath -PathType Leaf) -or (Get-Item $filePath -ErrorAction Stop).Length -le 0) {
            throw "В staging-каталоге отсутствует обязательный файл: $safePath"
        }
    }

    $resources = @($manifest.web_accessible_resources | ForEach-Object { @($_.resources) })
    foreach ($module in @('native-catalog.js', 'native-interaction-state.js', 'native-time-control.js', 'native-lifecycle.js', 'dialog-repository.js', 'injected.js')) {
        if ($resources -notcontains $module) {
            throw "manifest.json не публикует обязательный runtime-модуль: $module"
        }
    }
}

function Test-InstalledReleaseHealth($ExpectedVersion) {
    try {
        $expectedFiles = @($REQUIRED_EXTENSION_FILES + $REQUIRED_WINDOWS_TARGET_FILES)
        Test-StagedRelease $INSTALL_DIR $ExpectedVersion $expectedFiles
        return $true
    } catch {
        Log "Установленный release неполный: $($_.Exception.Message)"
        return $false
    }
}

function Publish-StagedRelease($StageDir, $ExpectedVersion, $ExpectedFiles) {
    $stageFull = [System.IO.Path]::GetFullPath($StageDir).TrimEnd('\')
    $installFull = [System.IO.Path]::GetFullPath($INSTALL_DIR).TrimEnd('\')
    $stageParent = Split-Path $stageFull -Parent
    $installParent = Split-Path $installFull -Parent
    if (-not $stageParent.Equals($installParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Staging и install должны находиться на одном томе и в одном каталоге"
    }
    if ($stageFull.Equals($installFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Staging-каталог совпадает с install-каталогом"
    }

    Test-StagedRelease $stageFull $ExpectedVersion $ExpectedFiles

    $runningBitrix = @(Get-Process -Name 'Bitrix24' -ErrorAction SilentlyContinue)
    if ($runningBitrix.Count -gt 0) {
        Log "Останавливаю Bitrix24 перед атомарной публикацией release."
        $runningBitrix | Stop-Process -Force -ErrorAction SilentlyContinue
        $runningBitrix | Wait-Process -Timeout 8 -ErrorAction SilentlyContinue
    }

    $backupDir = "$installFull.previous"
    if (Test-Path $backupDir) {
        Remove-Item -LiteralPath $backupDir -Recurse -Force -ErrorAction Stop
    }

    $currentMoved = $false
    try {
        if (Test-Path $installFull) {
            Move-Item -LiteralPath $installFull -Destination $backupDir -ErrorAction Stop
            $currentMoved = $true
        }
        Move-Item -LiteralPath $stageFull -Destination $installFull -ErrorAction Stop
    } catch {
        if (-not (Test-Path $installFull) -and $currentMoved -and (Test-Path $backupDir)) {
            Move-Item -LiteralPath $backupDir -Destination $installFull -ErrorAction SilentlyContinue
        }
        throw "Не удалось опубликовать release; выполнен rollback: $($_.Exception.Message)"
    }

    if (Test-Path $backupDir) {
        try {
            Remove-Item -LiteralPath $backupDir -Recurse -Force -ErrorAction Stop
        } catch {
            Log "Предыдущая версия оставлена для отложенной очистки: $backupDir"
        }
    }
}

function Invoke-WithUpdateLock([scriptblock]$Action) {
    $mutex = New-Object System.Threading.Mutex($false, 'Local\PENAAgencyExtensionUpdate')
    $hasLock = $false
    try {
        try {
            $hasLock = $mutex.WaitOne([TimeSpan]::FromSeconds(30))
        } catch [System.Threading.AbandonedMutexException] {
            $hasLock = $true
        }
        if (-not $hasLock) { throw "Другой процесс уже обновляет расширение" }
        return & $Action
    } finally {
        if ($hasLock) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Invoke-AtomicExtensionUpdate($UpdateInfo) {
    $remoteVersion = [string]$UpdateInfo.version
    $rawBase = ([string]$UpdateInfo.raw_base_url).TrimEnd('/')
    $expectedBase = "$TRUSTED_RAW_PREFIX/v$remoteVersion"
    if ($rawBase -ne $expectedBase) {
        throw "raw_base_url должен указывать на неизменяемый тег $expectedBase"
    }

    $extensionFiles = @($UpdateInfo.extension_files | ForEach-Object { ConvertTo-SafeReleasePath $_ })
    if ($extensionFiles.Count -eq 0) { throw "update.json не содержит extension_files" }
    foreach ($requiredFile in $REQUIRED_EXTENSION_FILES) {
        if ($extensionFiles -notcontains $requiredFile) {
            throw "update.json не содержит обязательный runtime-файл: $requiredFile"
        }
    }
    $windowsFiles = @($UpdateInfo.windows_files | ForEach-Object { ConvertTo-SafeReleasePath $_ })
    foreach ($requiredFile in $REQUIRED_WINDOWS_RELEASE_FILES) {
        if ($windowsFiles -notcontains $requiredFile) {
            throw "update.json не содержит обязательный Windows release-файл: $requiredFile"
        }
    }

    $installParent = Split-Path $INSTALL_DIR -Parent
    if (-not (Test-Path $installParent)) {
        New-Item -Path $installParent -ItemType Directory -Force -ErrorAction Stop | Out-Null
    }
    $stageDir = Join-Path $installParent ("Extension.update.{0}.{1}" -f $PID, [Guid]::NewGuid().ToString('N'))
    New-Item -Path $stageDir -ItemType Directory -ErrorAction Stop | Out-Null

    try {
        if (Test-Path $INSTALL_DIR) {
            Get-ChildItem -LiteralPath $INSTALL_DIR -Force -ErrorAction Stop |
                Copy-Item -Destination $stageDir -Recurse -Force -ErrorAction Stop
        }

        foreach ($relativePath in $extensionFiles) {
            $outFile = Join-Path $stageDir ($relativePath.Replace('/', '\'))
            $outDir = Split-Path $outFile -Parent
            if (-not (Test-Path $outDir)) { New-Item $outDir -ItemType Directory -Force -ErrorAction Stop | Out-Null }
            $downloadPath = "$outFile.download"
            Invoke-WebRequest -Uri "$rawBase/extension/$relativePath" -OutFile $downloadPath `
                -UseBasicParsing -TimeoutSec 60 -ErrorAction Stop
            Move-Item -LiteralPath $downloadPath -Destination $outFile -Force -ErrorAction Stop
            Log "Загружен: $relativePath"
        }

        foreach ($sourcePath in $windowsFiles) {
            $targetName = Split-Path $sourcePath -Leaf
            $outFile = Join-Path $stageDir $targetName
            $downloadPath = "$outFile.download"
            Invoke-WebRequest -Uri "$rawBase/$sourcePath" -OutFile $downloadPath `
                -UseBasicParsing -TimeoutSec 60 -ErrorAction Stop
            Move-Item -LiteralPath $downloadPath -Destination $outFile -Force -ErrorAction Stop
            Log "Загружен release-файл: $sourcePath"
        }

        $expectedStageFiles = @($extensionFiles + $REQUIRED_WINDOWS_TARGET_FILES)
        Test-StagedRelease $stageDir $remoteVersion $expectedStageFiles
        Publish-StagedRelease $stageDir $remoteVersion $expectedStageFiles
        return $true
    } finally {
        if (Test-Path $stageDir) {
            Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Register-NativeHost {
    # Копируем скрипт хоста и регистрируем Native Messaging Host для расширения
    $hostDir     = "$env:LOCALAPPDATA\PENA Agency"
    $hostPs1Src  = "$INSTALL_DIR\pena_host.ps1"
    $hostBatSrc  = "$INSTALL_DIR\pena_host.bat"
    $hostPs1Dst  = "$hostDir\pena_host.ps1"
    $hostBatDst  = "$hostDir\pena_host.bat"
    $manifestDst = "$hostDir\com.pena.agency.helper.json"

    try {
        if (-not (Test-Path $hostDir)) { New-Item $hostDir -ItemType Directory -Force | Out-Null }

        # Копируем файлы хоста (если есть в INSTALL_DIR)
        if (Test-Path $hostPs1Src) { Copy-Item $hostPs1Src $hostPs1Dst -Force }
        if (Test-Path $hostBatSrc) { Copy-Item $hostBatSrc $hostBatDst -Force }

        # Генерируем манифест с абсолютным путём (env-переменные здесь не работают)
        $manifest = @{
            name            = 'com.pena.agency.helper'
            description     = 'PENA Agency native helper'
            path            = $hostBatDst
            type            = 'stdio'
            allowed_origins = @('chrome-extension://hlhefpcndfepdlgbjcokkcodcbfnnepm/')
        } | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText($manifestDst, $manifest, [System.Text.Encoding]::UTF8)

        # Регистрируем в реестре для Chrome / Chromium / Edge (Bitrix24 использует Chromium)
        foreach ($base in @(
            'HKCU:\Software\Google\Chrome\NativeMessagingHosts',
            'HKCU:\Software\Chromium\NativeMessagingHosts',
            'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts'
        )) {
            $key = "$base\com.pena.agency.helper"
            New-Item -Path $key -Force -ErrorAction SilentlyContinue | Out-Null
            Set-ItemProperty -Path $key -Name '(Default)' -Value $manifestDst -ErrorAction SilentlyContinue
        }
        Log "Native Messaging Host зарегистрирован: $manifestDst"
    } catch {
        Log "ПРЕДУПРЕЖДЕНИЕ: Не удалось зарегистрировать Native Messaging Host: $($_.Exception.Message)"
    }
}

function MakeShortcut($Path, $Target, $LnkArgs, $WorkDir, $Desc, $Icon) {
    try {
        $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($Path)
        $sc.TargetPath       = $Target
        $sc.Arguments        = $LnkArgs
        $sc.WorkingDirectory = $WorkDir
        $sc.Description      = $Desc
        if ($Icon) { $sc.IconLocation = $Icon }
        $sc.Save()
        return $true
    } catch { return $false }
}

if ($InstallFrom) {
    try {
        Invoke-WithUpdateLock {
            $stageManifest = Get-Content (Join-Path $InstallFrom 'manifest.json') -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
            $expectedStageFiles = @($REQUIRED_EXTENSION_FILES + $REQUIRED_WINDOWS_TARGET_FILES)
            Publish-StagedRelease $InstallFrom ([string]$stageManifest.version) $expectedStageFiles
        } | Out-Null
        Log "Release атомарно установлен в: $INSTALL_DIR"
        exit 0
    } catch {
        Log "ОШИБКА атомарной установки: $($_.Exception.Message)"
        exit 1
    }
}

# ==============================================================
# РЕЖИМ НАСТРОЙКИ (-Setup)
# Вызывается один раз из Inno Setup после установки файлов
# ==============================================================
if ($Setup) {
    Log "=== РЕЖИМ НАСТРОЙКИ ==="

    # -- Находим Bitrix24 --
    $BitrixCandidates = @(
        "$env:LOCALAPPDATA\Programs\Bitrix24\Bitrix24.exe",
        "$env:LOCALAPPDATA\Bitrix24\Bitrix24.exe",
        "C:\Program Files (x86)\Bitrix24\Bitrix24.exe",
        "C:\Program Files\Bitrix24\Bitrix24.exe",
        "$env:APPDATA\Bitrix24\Bitrix24.exe",
        "$env:USERPROFILE\AppData\Local\Programs\Bitrix24\Bitrix24.exe"
    )

    $BitrixExe = $null
    # Сначала пробуем стандартные пути
    foreach ($p in $BitrixCandidates) {
        if (Test-Path $p) { $BitrixExe = $p; break }
    }
    # Затем реестр
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
                    $candidate = Join-Path $loc "Bitrix24.exe"
                    if (Test-Path $candidate) { $BitrixExe = $candidate; break }
                }
            }
        }
    }

    # Если не найден — создаём ярлык "Setup" на рабочем столе
    # (InputBox прячется за окно установщика, поэтому не используем его)
    if (-not $BitrixExe) {
        Log "Bitrix24 not found. Creating setup shortcut on Desktop."
        $Desktop = [Environment]::GetFolderPath("Desktop")
        $SetupLnk = "$Desktop\Setup BX24 Chat Sorter.lnk"
        try {
            $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($SetupLnk)
            $sc.TargetPath  = "powershell.exe"
            $sc.Arguments   = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Normal -File `"$INSTALL_DIR\updater.ps1`" -Setup"
            $sc.Description = "Configure BX24 Chat Sorter - find Bitrix24"
            $sc.Save()
            Log "Setup shortcut created: $SetupLnk"
        } catch {
            Log "Could not create setup shortcut: $($_.Exception.Message)"
        }
    }

    # Создаём ярлыки и сохраняем путь (если Bitrix24 найден — автоматически или вручную)
    if ($BitrixExe) {
        Log "Битрикс24: $BitrixExe"

        # Сохраняем путь для режимов -Launch / -LaunchWithUpdate
        $BitrixExe | Set-Content -Path $BITRIX_PATH_FILE -Encoding UTF8

        $LnkName    = "Bitrix24 (PENA Agency)"
        $DesktopDir = [Environment]::GetFolderPath('Desktop')
        if ([string]::IsNullOrEmpty($DesktopDir)) { $DesktopDir = "$env:USERPROFILE\Desktop" }

        # Папка Programs в меню Пуск — несколько fallback-вариантов для разных систем
        $ProgramsDir = [Environment]::GetFolderPath([System.Environment+SpecialFolder]::Programs)
        if ([string]::IsNullOrEmpty($ProgramsDir)) {
            $ProgramsDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
        }

        # Ярлык запускает updater.ps1 -LaunchWithUpdate:
        #   проверка обновления → скачивание файлов → запуск Bitrix24
        $LauncherTarget = "powershell.exe"
        $LauncherArgs   = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$INSTALL_DIR\updater.ps1`" -LaunchWithUpdate"
        $BitrixIcon     = "$BitrixExe,0"

        # Ярлык в меню Пуск (всегда)
        $StartDir = "$ProgramsDir\BX24 Chat Sorter"
        try {
            if (-not (Test-Path $StartDir)) {
                New-Item -Path $StartDir -ItemType Directory -Force | Out-Null
            }
            $StartLnk = "$StartDir\$LnkName.lnk"
            if (MakeShortcut $StartLnk $LauncherTarget $LauncherArgs $INSTALL_DIR "Bitrix24 with BX24 Chat Sorter" $BitrixIcon) {
                Log "Start Menu shortcut created: $StartLnk"
            } else {
                Log "WARNING: could not create Start Menu shortcut"
            }
        } catch {
            Log "WARNING: Start Menu error: $($_.Exception.Message)"
        }

        # Обновляем стандартные ярлыки Bitrix24 (передаём им параметры расширения)
        $StdLinks = @(
            "$DesktopDir\Bitrix24.lnk",
            "$env:PUBLIC\Desktop\Bitrix24.lnk",
            "$ProgramsDir\Bitrix24\Bitrix24.lnk"
        )
        foreach ($lnk in $StdLinks) {
            if (Test-Path $lnk) {
                if (MakeShortcut $lnk $LauncherTarget $LauncherArgs $INSTALL_DIR "Bitrix24 with BX24 Chat Sorter" $BitrixIcon) {
                    Log "Updated existing shortcut: $(Split-Path $lnk -Leaf)"
                }
            }
        }
    } else {
        Log "Bitrix24 не найден — ярлыки не созданы. Запустите updater.ps1 -Setup после установки Bitrix24."
    }

    # -- Регистрируем задачу Планировщика для ежедневного обновления --
    try {
        $action  = New-ScheduledTaskAction `
            -Execute "powershell.exe" `
            -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$INSTALL_DIR\updater.ps1`""
        $trigger = New-ScheduledTaskTrigger -Daily -At "10:00"
        $settings = New-ScheduledTaskSettingsSet `
            -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
            -StartWhenAvailable `
            -RunOnlyIfNetworkAvailable
        Register-ScheduledTask `
            -TaskName $TASK_NAME `
            -Action $action `
            -Trigger $trigger `
            -Settings $settings `
            -Description "Ежедневная проверка обновлений PENA Agency" `
            -RunLevel Limited `
            -Force | Out-Null
        Log "Задача планировщика зарегистрирована: $TASK_NAME (ежедневно в 10:00)"
    } catch {
        Log "ПРЕДУПРЕЖДЕНИЕ: Не удалось создать задачу планировщика: $($_.Exception.Message)"
    }

    # -- Регистрируем Native Messaging Host --
    Register-NativeHost

    Log "Настройка завершена."
    exit 0
}

# ==============================================================
# РЕЖИМ ЯРЛЫКА НА РАБОЧЕМ СТОЛЕ (-CreateDesktopShortcut)
# Вызывается из postinstall-чекбокса "Создать ярлык на рабочем столе"
# Читает путь Bitrix24 из bitrix_path.txt (сохранён в -Setup)
# ==============================================================
if ($CreateDesktopShortcut) {
    $LnkName    = "Bitrix24 (PENA Agency)"
    $DesktopDir = [Environment]::GetFolderPath('Desktop')

    # Ярлык запускает updater.ps1 -LaunchWithUpdate (проверка + скачивание + запуск)
    $LauncherTarget = "powershell.exe"
    $LauncherArgs   = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$INSTALL_DIR\updater.ps1`" -LaunchWithUpdate"

    # Иконка Bitrix24
    $BitrixExe = $null
    if (Test-Path $BITRIX_PATH_FILE) {
        $p = (Get-Content $BITRIX_PATH_FILE -Raw -ErrorAction SilentlyContinue).Trim()
        if ($p -and (Test-Path $p)) { $BitrixExe = $p }
    }
    if (-not $BitrixExe) {
        @("$env:LOCALAPPDATA\Programs\Bitrix24\Bitrix24.exe",
          "$env:LOCALAPPDATA\Bitrix24\Bitrix24.exe",
          "C:\Program Files (x86)\Bitrix24\Bitrix24.exe",
          "C:\Program Files\Bitrix24\Bitrix24.exe") | ForEach-Object {
            if (-not $BitrixExe -and (Test-Path $_)) { $BitrixExe = $_ }
        }
    }
    $BitrixIcon = if ($BitrixExe) { "$BitrixExe,0" } else { $null }

    $DesktopLnk = "$DesktopDir\$LnkName.lnk"
    if (MakeShortcut $DesktopLnk $LauncherTarget $LauncherArgs $INSTALL_DIR "Bitrix24 with BX24 Chat Sorter" $BitrixIcon) {
        Log "Desktop shortcut created: $DesktopLnk"
    } else {
        Log "WARNING: could not create desktop shortcut"
    }

    exit 0
}

# ==============================================================
# РЕЖИМ ЗАПУСКА (-Launch)
# Вызывается из чекбокса "Запустить Bitrix24" в конце установки
# ==============================================================
if ($Launch) {
    $INSTALL_DIR = "$env:LOCALAPPDATA\PENA Agency\Extension"
    $BITRIX_PATH_FILE = "$env:LOCALAPPDATA\PENA Agency\bitrix_path.txt"
    $extArgs = "--disable-extensions-except=`"$INSTALL_DIR`" --load-extension=`"$INSTALL_DIR`""
    $Desktop = [Environment]::GetFolderPath('Desktop')

    # 1. Читаем сохранённый путь
    if (Test-Path $BITRIX_PATH_FILE) {
        $exe = (Get-Content $BITRIX_PATH_FILE -Raw -ErrorAction SilentlyContinue).Trim()
        if ($exe -and (Test-Path $exe)) {
            Start-Process -FilePath $exe -ArgumentList $extArgs; exit 0
        }
    }
    # 2. Ищем в ярлыке
    $lnk = "$Desktop\Bitrix24 (PENA Agency).lnk"
    if (Test-Path $lnk) {
        $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
        if (Test-Path $sc.TargetPath) {
            Start-Process -FilePath $sc.TargetPath -ArgumentList $sc.Arguments; exit 0
        }
    }
    # 3. Ищем стандартные пути
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Bitrix24\Bitrix24.exe",
        "$env:LOCALAPPDATA\Bitrix24\Bitrix24.exe",
        "C:\Program Files (x86)\Bitrix24\Bitrix24.exe",
        "C:\Program Files\Bitrix24\Bitrix24.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) {
            Start-Process -FilePath $c -ArgumentList $extArgs; exit 0
        }
    }
    exit 0
}

# ==============================================================
# РЕЖИМ ЗАПУСКА С ОБНОВЛЕНИЕМ (-LaunchWithUpdate)
# Вызывается из ярлыка «Bitrix24 (PENA Agency)».
# 1. Проверяет update.json (макс. 8 сек)
# 2. Если есть обновление — проверяет его в staging и атомарно публикует
# 3. Запускает Bitrix24 с --load-extension
# ==============================================================
if ($LaunchWithUpdate) {
    $localVersion = "0.0.0"
    $manifestPath = Join-Path $INSTALL_DIR "manifest.json"
    if (Test-Path $manifestPath) {
        try {
            $mf = Get-Content $manifestPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
            $localVersion = $mf.version
        } catch {}
    }
    $releaseHealthy = Test-InstalledReleaseHealth $localVersion

    try {
        $updateInfo = Invoke-RestMethod -Uri $UPDATE_JSON_URL -TimeoutSec 8 -ErrorAction Stop
        $remoteVersion = $updateInfo.version
        $versionComparison = CompareVersions $remoteVersion $localVersion
        if ($remoteVersion -and ($versionComparison -gt 0 -or ($versionComparison -eq 0 -and -not $releaseHealthy))) {
            if ($versionComparison -gt 0) {
                Log "Обновление: $localVersion -> $remoteVersion"
            } else {
                Log "Восстанавливаю неполный release $remoteVersion"
            }
            Invoke-WithUpdateLock { Invoke-AtomicExtensionUpdate $updateInfo } | Out-Null
            Log "Обновление до $remoteVersion установлено атомарно."
            ShowBalloon "PENA Agency" "Расширение обновлено до v$remoteVersion"
        }
    } catch {
        Log "Проверка или установка обновления не удалась; запускаю целую предыдущую версию: $($_.Exception.Message)"
    }

    Register-NativeHost
    $extArgs = "--disable-extensions-except=`"$INSTALL_DIR`" --load-extension=`"$INSTALL_DIR`""
    $BitrixExe = Get-BitrixExecutable
    if ($BitrixExe) {
        Start-Process -FilePath $BitrixExe -ArgumentList $extArgs
    } else {
        Log "Bitrix24 не найден — запустите вручную."
    }
    exit 0
}

# ==============================================================
# РЕЖИМ ОБНОВЛЕНИЯ (запуск без параметров — из Планировщика)
# ==============================================================
Log "=== ПРОВЕРКА ОБНОВЛЕНИЯ ==="

# Проверяем, что папка установки существует
if (-not (Test-Path (Join-Path $INSTALL_DIR "manifest.json"))) {
    Log "Расширение не установлено: $INSTALL_DIR — выход."
    exit 0
}

# Текущая версия
try {
    $manifest = Get-Content (Join-Path $INSTALL_DIR "manifest.json") -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    $localVersion = $manifest.version
} catch {
    Log "Ошибка чтения manifest.json: $($_.Exception.Message)"
    exit 1
}
Log "Установлена версия: $localVersion"
$releaseHealthy = Test-InstalledReleaseHealth $localVersion

# Получаем update.json
try {
    $updateInfo = Invoke-RestMethod -Uri $UPDATE_JSON_URL -TimeoutSec 15 -ErrorAction Stop
} catch {
    Log "Не удалось получить update.json: $($_.Exception.Message)"
    exit 0   # не критично — пробуем завтра
}

$remoteVersion = $updateInfo.version
Log "Доступна версия: $remoteVersion"

$versionComparison = CompareVersions $remoteVersion $localVersion
if ($versionComparison -lt 0 -or ($versionComparison -eq 0 -and $releaseHealthy)) {
    Log "Обновление не требуется."
    exit 0
}

if ($versionComparison -eq 0) {
    Log "Восстанавливаю неполный release $remoteVersion"
}

Log "Загружаю обновление $remoteVersion ..."

try {
    Invoke-WithUpdateLock { Invoke-AtomicExtensionUpdate $updateInfo } | Out-Null
    Log "Release атомарно опубликован в: $INSTALL_DIR"

    $extArgs = "--disable-extensions-except=`"$INSTALL_DIR`" --load-extension=`"$INSTALL_DIR`""
    $bitrixExe = Get-BitrixExecutable

    Register-NativeHost
    if ($bitrixExe) {
        Start-Process -FilePath $bitrixExe -ArgumentList $extArgs
        Log "Bitrix24 перезапущен: $bitrixExe"
        ShowBalloon "PENA Agency обновлён" "Установлена версия $remoteVersion. Bitrix24 перезапускается."
    } else {
        ShowBalloon "PENA Agency обновлён" "Установлена версия $remoteVersion. Перезапустите Bitrix24 вручную."
        Log "Bitrix24.exe не найден — перезапуск вручную."
    }

    Log "Обновление до $remoteVersion завершено успешно."

} catch {
    Log "ОШИБКА обновления: $($_.Exception.Message)"
    ShowBalloon "PENA Agency — ошибка обновления" "Не удалось обновить до v$remoteVersion. Подробности: $LOG_FILE"
    exit 1
}
