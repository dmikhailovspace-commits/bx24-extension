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
    [switch]$CreateDesktopShortcut  # создать ярлык на рабочем столе (postinstall чекбокс)
)

# ── Конфигурация (замените URL на свой реальный репозиторий) ──
$UPDATE_JSON_URL = "https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json"
$INSTALL_DIR     = "$env:LOCALAPPDATA\PENA Agency\Extension"
$TASK_NAME       = "PENAAgencyUpdater"
$LOG_FILE        = "$env:LOCALAPPDATA\PENA Agency\updater.log"
$BITRIX_PATH_FILE = "$env:LOCALAPPDATA\PENA Agency\bitrix_path.txt"
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
# 2. Если есть обновление — скачивает файлы расширения с GitHub
# 3. Запускает Bitrix24 с --load-extension
# ==============================================================
if ($LaunchWithUpdate) {
    $RAW_BASE = "https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/extension"
    $UPD_FILES = @("background.js", "content.js", "injected.js", "manifest.json")

    # — Текущая версия —
    $localVersion = "0.0.0"
    $manifestPath = Join-Path $INSTALL_DIR "manifest.json"
    if (Test-Path $manifestPath) {
        try {
            $mf = Get-Content $manifestPath -Raw | ConvertFrom-Json
            $localVersion = $mf.version
        } catch {}
    }

    # — Проверяем update.json (таймаут 8 сек, чтобы не задерживать запуск) —
    $needsUpdate = $false
    try {
        $updateInfo = Invoke-RestMethod -Uri $UPDATE_JSON_URL -TimeoutSec 8
        $remoteVersion = $updateInfo.version
        if ($remoteVersion -and (CompareVersions $remoteVersion $localVersion) -gt 0) {
            $needsUpdate = $true
            Log "Обновление: $localVersion -> $remoteVersion"
        }
    } catch {
        Log "Не удалось проверить обновление (сеть недоступна) — запускаем как есть."
    }

    # — Скачиваем файлы если нужно —
    if ($needsUpdate) {
        foreach ($f in $UPD_FILES) {
            try {
                Invoke-WebRequest -Uri "$RAW_BASE/$f" -OutFile (Join-Path $INSTALL_DIR $f) `
                    -UseBasicParsing -TimeoutSec 30
                Log "Загружен: $f"
            } catch {
                Log "ОШИБКА загрузки $f — пропускаем."
            }
        }
        ShowBalloon "PENA Agency" "Расширение обновлено до v$remoteVersion"
    }

    # — Запускаем Bitrix24 (идентично -Launch) —
    $extArgs = "--disable-extensions-except=`"$INSTALL_DIR`" --load-extension=`"$INSTALL_DIR`""
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
    $manifest    = Get-Content (Join-Path $INSTALL_DIR "manifest.json") -Raw | ConvertFrom-Json
    $localVersion = $manifest.version
} catch {
    Log "Ошибка чтения manifest.json: $($_.Exception.Message)"
    exit 1
}
Log "Установлена версия: $localVersion"

# Получаем update.json
try {
    $updateInfo = Invoke-RestMethod -Uri $UPDATE_JSON_URL -TimeoutSec 15
} catch {
    Log "Не удалось получить update.json: $($_.Exception.Message)"
    exit 0   # не критично — пробуем завтра
}

$remoteVersion = $updateInfo.version
$rawBase       = "https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/extension"
$updateFiles   = @('background.js', 'content.js', 'injected.js', 'manifest.json')
Log "Доступна версия: $remoteVersion"

if ((CompareVersions $remoteVersion $localVersion) -le 0) {
    Log "Обновление не требуется."
    exit 0
}

Log "Загружаю обновление $remoteVersion ..."

try {
    # Скачиваем файлы расширения из GitHub напрямую в папку установки
    foreach ($f in $updateFiles) {
        $url     = "$rawBase/$f"
        $outFile = Join-Path $INSTALL_DIR $f
        Invoke-WebRequest -Uri $url -OutFile $outFile -UseBasicParsing -TimeoutSec 60
        Log "Загружен: $f"
    }

    Log "Файлы обновлены в: $INSTALL_DIR"

    # Перезапускаем Bitrix24 с расширением
    $extArgs = "--disable-extensions-except=`"$INSTALL_DIR`" --load-extension=`"$INSTALL_DIR`""
    $bitrixExe = $null

    # Сначала из сохранённого пути
    if (Test-Path $BITRIX_PATH_FILE) {
        $p = (Get-Content $BITRIX_PATH_FILE -Raw -ErrorAction SilentlyContinue).Trim()
        if ($p -and (Test-Path $p)) { $bitrixExe = $p }
    }
    # Fallback: стандартные пути
    if (-not $bitrixExe) {
        @(
            "$env:LOCALAPPDATA\Programs\Bitrix24\Bitrix24.exe",
            "$env:LOCALAPPDATA\Bitrix24\Bitrix24.exe",
            "C:\Program Files (x86)\Bitrix24\Bitrix24.exe",
            "C:\Program Files\Bitrix24\Bitrix24.exe"
        ) | ForEach-Object { if (-not $bitrixExe -and (Test-Path $_)) { $bitrixExe = $_ } }
    }

    if ($bitrixExe) {
        Stop-Process -Name "Bitrix24" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
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
