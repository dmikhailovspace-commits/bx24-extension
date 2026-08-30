[CmdletBinding()]
param(
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ContextPath = Join-Path $ProjectRoot 'PROJECT_CONTEXT.md'

function Get-Sha256Hex([string]$Path) {
    $Stream = [System.IO.File]::OpenRead($Path)
    $Sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($Sha256.ComputeHash($Stream))).Replace('-', '')
    } finally {
        $Sha256.Dispose()
        $Stream.Dispose()
    }
}

$Manifest = Get-Content -LiteralPath (Join-Path $ProjectRoot 'extension\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$Update = Get-Content -LiteralPath (Join-Path $ProjectRoot 'update.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$Setup = Get-Content -LiteralPath (Join-Path $ProjectRoot 'installers\windows\setup.iss') -Raw -Encoding UTF8
$Injected = Get-Content -LiteralPath (Join-Path $ProjectRoot 'extension\injected.js') -Raw -Encoding UTF8
$TestRunner = Get-Content -LiteralPath (Join-Path $ProjectRoot 'tests\run-all-regressions.mjs') -Raw -Encoding UTF8

$SetupVersion = [regex]::Match($Setup, '#define\s+AppVersion\s+"([^"]+)"').Groups[1].Value
$InjectedVersion = [regex]::Match($Injected, "const\s+VER\s*=\s*'([^']+)'").Groups[1].Value
$Versions = @($Manifest.version, $Update.version, $SetupVersion, $InjectedVersion) | Select-Object -Unique
if ($Versions.Count -ne 1) {
    throw "Release versions diverge: $($Versions -join ', ')"
}

$Version = [string]$Manifest.version
$SuiteCount = [regex]::Matches($TestRunner, "'[^']+\.mjs'").Count
$RuntimeCount = @($Update.extension_files).Count
$WindowsName = "PENA_Agency_Windows_v$Version.exe"
$MacName = "PENA_Agency_macOS_Universal_v$Version.dmg"
$WindowsPath = Join-Path $ProjectRoot "dist\$WindowsName"
$MacPath = Join-Path $ProjectRoot "dist\$MacName"
$WindowsValue = if (Test-Path -LiteralPath $WindowsPath) {
    $Hash = Get-Sha256Hex $WindowsPath
    "``dist/$WindowsName`` - SHA-256: ``$Hash``"
} else { '_not built_' }
$MacValue = if (Test-Path -LiteralPath $MacPath) {
    $Hash = Get-Sha256Hex $MacPath
    "``dist/$MacName`` - SHA-256: ``$Hash``"
} else { '_not built_' }

$Context = Get-Content -LiteralPath $ContextPath -Raw -Encoding UTF8
$Newline = if ($Context.Contains("`r`n")) { "`r`n" } else { "`n" }
$Generated = @(
    '<!-- AUTO:BEGIN -->'
    '## Current release facts (generated)'
    ''
    "- Version: **$Version**"
    "- Release date: **$($Update.release_date)**"
    "- Runtime files: **$RuntimeCount**"
    "- Regression suites: **$SuiteCount**"
    "- Windows artifact: $WindowsValue"
    "- macOS artifact: $MacValue"
    '<!-- AUTO:END -->'
) -join $Newline

$Pattern = '(?s)<!-- AUTO:BEGIN -->.*?<!-- AUTO:END -->'
if (-not [regex]::IsMatch($Context, $Pattern)) {
    throw 'PROJECT_CONTEXT.md has no AUTO:BEGIN/AUTO:END markers.'
}
$Updated = [regex]::Replace($Context, $Pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($Match) $Generated }, 1)

if ($Check) {
    if ($Updated -cne $Context) {
        throw 'PROJECT_CONTEXT.md is stale. Run tools/update-project-context.ps1 without -Check.'
    }
    Write-Host "PASS project context v$Version" -ForegroundColor Green
    exit 0
}

[System.IO.File]::WriteAllText($ContextPath, $Updated, [System.Text.UTF8Encoding]::new($false))
Write-Host "UPDATED PROJECT_CONTEXT.md v$Version" -ForegroundColor Green
