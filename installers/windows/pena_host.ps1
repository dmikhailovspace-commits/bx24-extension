# ==============================================================
# PENA Agency — Native Messaging Host
# Принимает команды от расширения через stdin, выполняет их,
# отвечает через stdout (Chrome Native Messaging Protocol).
# ==============================================================

$stdin  = [Console]::OpenStandardInput()
$stdout = [Console]::OpenStandardOutput()

function Read-NativeMessage {
    $lenBuf = New-Object byte[] 4
    $read = $stdin.Read($lenBuf, 0, 4)
    if ($read -lt 4) { return $null }
    $len = [BitConverter]::ToInt32($lenBuf, 0)
    if ($len -le 0 -or $len -gt 1048576) { return $null }
    $msgBuf = New-Object byte[] $len
    $totalRead = 0
    while ($totalRead -lt $len) {
        $r = $stdin.Read($msgBuf, $totalRead, $len - $totalRead)
        if ($r -le 0) { break }
        $totalRead += $r
    }
    $json = [System.Text.Encoding]::UTF8.GetString($msgBuf, 0, $totalRead)
    return $json | ConvertFrom-Json
}

function Write-NativeMessage($obj) {
    $json  = $obj | ConvertTo-Json -Compress -Depth 5
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $len   = [BitConverter]::GetBytes([int32]$bytes.Length)
    $stdout.Write($len,   0, 4)
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

$msg = Read-NativeMessage
if (-not $msg) { exit 1 }

$INSTALL_DIR = "$env:LOCALAPPDATA\PENA Agency\Extension"
$UPDATER     = "$INSTALL_DIR\updater.ps1"

# Имена процессов Bitrix24 (перебираем все возможные)
$BX_PROCS = @('Bitrix24', 'BitrixDesktop', 'desktop', 'bitrix24')

function Kill-Bitrix24 {
    $killed = $false
    foreach ($name in $BX_PROCS) {
        $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
        if ($procs) {
            $procs | Stop-Process -Force -ErrorAction SilentlyContinue
            $killed = $true
        }
    }
    return $killed
}

switch ($msg.action) {
    'quit' {
        $killed = Kill-Bitrix24
        Write-NativeMessage @{ ok = $true; killed = $killed }
    }
    'relaunch' {
        # Убиваем процесс, затем перезапускаем через updater.ps1
        Kill-Bitrix24 | Out-Null
        Start-Sleep -Milliseconds 800
        if (Test-Path $UPDATER) {
            Start-Process powershell.exe `
                -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$UPDATER`" -LaunchWithUpdate" `
                -WindowStyle Hidden
            Write-NativeMessage @{ ok = $true; launched = $true }
        } else {
            Write-NativeMessage @{ ok = $false; error = 'updater_not_found' }
        }
    }
    default {
        Write-NativeMessage @{ ok = $false; error = "unknown_action: $($msg.action)" }
    }
}
