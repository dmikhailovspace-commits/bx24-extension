# ==============================================================
# PENA Agency — Native Messaging Host
# Принимает команды от расширения через stdin, выполняет их,
# отвечает через stdout (Chrome Native Messaging Protocol).
# ==============================================================

$stdin  = [Console]::OpenStandardInput()
$stdout = [Console]::OpenStandardOutput()

function Read-NativeMessage {
    $lenBuf = New-Object byte[] 4
    $read = 0
    while ($read -lt 4) {
        $part = $stdin.Read($lenBuf, $read, 4 - $read)
        if ($part -le 0) { return $null }
        $read += $part
    }
    $len = [BitConverter]::ToInt32($lenBuf, 0)
    if ($len -le 0 -or $len -gt 1048576) { return $null }
    $msgBuf = New-Object byte[] $len
    $totalRead = 0
    while ($totalRead -lt $len) {
        $r = $stdin.Read($msgBuf, $totalRead, $len - $totalRead)
        if ($r -le 0) { break }
        $totalRead += $r
    }
    if ($totalRead -ne $len) { return $null }
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
    'status' {
        $state = 'idle'
        $statusFile = "$env:LOCALAPPDATA\PENA Agency\update-status.json"
        if (Test-Path $statusFile) {
            try { $state = Get-Content $statusFile -Raw | ConvertFrom-Json } catch {}
        }
        Write-NativeMessage @{ ok = $true; protocol = 1; state = $state }
    }
    'apply' {
        $version = [string]$msg.version
        if ($version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$' -or -not (Test-Path $UPDATER)) {
            Write-NativeMessage @{ok=$false;error='invalid_update'}; exit 1
        }
        $statusFile = "$env:LOCALAPPDATA\PENA Agency\update-status.json"
        @{version=$version;status='installing'} | ConvertTo-Json -Compress | Set-Content -LiteralPath $statusFile -Encoding UTF8
        $updaterLiteral = $UPDATER.Replace("'", "''")
        $statusLiteral = $statusFile.Replace("'", "''")
        $script = "& '$updaterLiteral' -ApprovedVersion '$version'; `$result = if (`$LASTEXITCODE -eq 0) {'done'} else {'error'}; @{version='$version';status=`$result} | ConvertTo-Json -Compress | Set-Content -LiteralPath '$statusLiteral' -Encoding UTF8"
        # A separate process survives Bitrix24 closing during the atomic swap.
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
        try {
            Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded" -WindowStyle Hidden -ErrorAction Stop
            Write-NativeMessage @{ok=$true;started=$true;version=$version}
        } catch { Write-NativeMessage @{ok=$false;error='launch_failed'} }
    }
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
