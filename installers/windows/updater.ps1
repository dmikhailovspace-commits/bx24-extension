# ==============================================================
# PENA Agency — Скрипт автообновления (Windows)
# Версия: 5.0.0
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
    [switch]$Setup,   # первоначальная настройка (из Inno Setup)
    [switch]$Launch   # запустить Bitrix24 с расширением
)

# ── Конфигурация (замените URL на свой реальный репозиторий) ──
$UPDATE_JSON_URL = "https://raw.githubusercontent.com/PENA-AGENCY/bx24-extension/main/update.json"
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

function MakeShortcut($Path, $Target, $Args, $WorkDir, $Desc) {
    try {
        $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($Path)
        $sc.TargetPath       = $Target
        $sc.Arguments        = $Args
        $sc.WorkingDirectory = $WorkDir
        $sc.Description      = $Desc
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

    # Если не найден — спросить пользователя через диалог
    if (-not $BitrixExe) {
        Log "Bitrix24 не найден по стандартным путям — показываю диалог ввода."
        Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction SilentlyContinue
        $BitrixInput = [Microsoft.VisualBasic.Interaction]::InputBox(
            "Bitrix24.exe не найден в стандартных папках.`n`nВставьте полный путь к Bitrix24.exe:`n(например: C:\Users\User\AppData\Local\Programs\Bitrix24\Bitrix24.exe)",
            "Сортировщик чатов BX24 — укажите путь к Bitrix24", "")
        $BitrixInput = $BitrixInput.Trim().Trim('"')
        if ($BitrixInput -and (Test-Path $BitrixInput)) {
            $BitrixExe = $BitrixInput
            Log "Путь к Bitrix24 указан пользователем: $BitrixExe"
        } else {
            Log "Путь не указан. Запустите updater.ps1 -Setup вручную после установки Bitrix24."
        }
    }

    # Создаём ярлыки и сохраняем путь (если Bitrix24 найден — автоматически или вручную)
    if ($BitrixExe) {
        Log "Битрикс24: $BitrixExe"
        $ExtArgs = "--disable-extensions-except=`"$INSTALL_DIR`" --load-extension=`"$INSTALL_DIR`""

        # Сохраняем путь для режима -Launch
        $BitrixExe | Set-Content -Path $BITRIX_PATH_FILE -Encoding UTF8

        # Ярлык на рабочем столе
        $DesktopLnk = "$env:USERPROFILE\Desktop\Bitrix24 + Фильтр чатов.lnk"
        if (MakeShortcut $DesktopLnk $BitrixExe $ExtArgs (Split-Path $BitrixExe) "Bitrix24 с фильтром чатов") {
            Log "Создан ярлык: рабочий стол"
        }

        # Ярлык в меню Пуск
        $StartDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Сортировщик чатов BX24"
        New-Item -Path $StartDir -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null
        $StartLnk = "$StartDir\Bitrix24 + Фильтр чатов.lnk"
        if (MakeShortcut $StartLnk $BitrixExe $ExtArgs (Split-Path $BitrixExe) "Bitrix24 с фильтром чатов") {
            Log "Создан ярлык: меню Пуск"
        }

        # Обновляем стандартные ярлыки Bitrix24 (передаём им параметры расширения)
        $StdLinks = @(
            "$env:USERPROFILE\Desktop\Bitrix24.lnk",
            "$env:PUBLIC\Desktop\Bitrix24.lnk",
            "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Bitrix24\Bitrix24.lnk"
        )
        foreach ($lnk in $StdLinks) {
            if (Test-Path $lnk) {
                if (MakeShortcut $lnk $BitrixExe $ExtArgs (Split-Path $BitrixExe) "Битрикс24 с фильтром чатов") {
                    Log "Обновлён ярлык: $(Split-Path $lnk -Leaf)"
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
# РЕЖИМ ЗАПУСКА (-Launch)
# Вызывается из чекбокса "Запустить Bitrix24" в конце установки
# ==============================================================
if ($Launch) {
    $INSTALL_DIR = "$env:LOCALAPPDATA\PENA Agency\Extension"
    $BITRIX_PATH_FILE = "$env:LOCALAPPDATA\PENA Agency\bitrix_path.txt"
    if (Test-Path $BITRIX_PATH_FILE) {
        $exe = (Get-Content $BITRIX_PATH_FILE -Raw -ErrorAction SilentlyContinue).Trim()
        if ($exe -and (Test-Path $exe)) {
            $extArgs = "--disable-extensions-except=`"$INSTALL_DIR`" --load-extension=`"$INSTALL_DIR`""
            Start-Process -FilePath $exe -ArgumentList $extArgs
            exit 0
        }
    }
    # Путь не сохранён — ищем в ярлыке на рабочем столе
    $lnk = "$env:USERPROFILE\Desktop\Bitrix24 + Фильтр чатов.lnk"
    if (Test-Path $lnk) {
        $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
        if (Test-Path $sc.TargetPath) {
            Start-Process -FilePath $sc.TargetPath -ArgumentList $sc.Arguments
            exit 0
        }
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
$zipUrl        = $updateInfo.zip_url
Log "Доступна версия: $remoteVersion"

if ((CompareVersions $remoteVersion $localVersion) -le 0) {
    Log "Обновление не требуется."
    exit 0
}

Log "Загружаю обновление $remoteVersion ..."

# Загружаем и распаковываем
$tmpZip  = [System.IO.Path]::GetTempFileName() + ".zip"
$tmpDir  = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "pena_update_$remoteVersion")

try {
    # Скачиваем ZIP
    Invoke-WebRequest -Uri $zipUrl -OutFile $tmpZip -TimeoutSec 120
    Log "ZIP загружен: $tmpZip"

    # Распаковываем во временную папку
    if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
    Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force

    # Определяем папку с файлами расширения (может быть в корне или в подпапке extension/)
    $srcDir = $tmpDir
    if (Test-Path (Join-Path $tmpDir "extension\manifest.json")) {
        $srcDir = Join-Path $tmpDir "extension"
    } elseif (-not (Test-Path (Join-Path $tmpDir "manifest.json"))) {
        # ищем manifest.json на один уровень глубже
        $found = Get-ChildItem $tmpDir -Filter "manifest.json" -Recurse -Depth 2 | Select-Object -First 1
        if ($found) { $srcDir = $found.DirectoryName }
    }

    # Проверяем, что нашли манифест
    if (-not (Test-Path (Join-Path $srcDir "manifest.json"))) {
        throw "manifest.json не найден в ZIP-архиве"
    }

    # Копируем файлы расширения поверх установленных
    Copy-Item -Path "$srcDir\*" -Destination $INSTALL_DIR -Recurse -Force
    Log "Файлы скопированы в: $INSTALL_DIR"

    # Уведомление
    ShowBalloon "PENA Agency обновлён" "Установлена версия $remoteVersion. Перезапустите Bitrix24."
    Log "Обновление до $remoteVersion завершено успешно."

} catch {
    Log "ОШИБКА обновления: $($_.Exception.Message)"
    ShowBalloon "PENA Agency — ошибка обновления" "Не удалось обновить до v$remoteVersion. Подробности: $LOG_FILE"
    exit 1
} finally {
    try { Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue } catch {}
    try { Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
}
