$ErrorActionPreference = 'Stop'

$candidates = @(
  $env:PENA_NODE20,
  $env:CODEX_BUNDLED_NODE,
  $env:NODE20,
  (Join-Path $HOME '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }

$node = $null
foreach ($candidate in $candidates) {
  $version = & $candidate --version 2>$null
  if ($LASTEXITCODE -eq 0 -and [int](($version -replace '^v', '').Split('.')[0]) -ge 20) {
    $node = $candidate
    break
  }
}

if (-not $node) {
  $systemNode = Get-Command node -ErrorAction SilentlyContinue
  if ($systemNode) {
    $version = & $systemNode.Source --version 2>$null
    if ($LASTEXITCODE -eq 0 -and [int](($version -replace '^v', '').Split('.')[0]) -ge 20) {
      $node = $systemNode.Source
    }
  }
}

if (-not $node) {
  Write-Error 'Node.js 20+ was not found. Set PENA_NODE20 to a compatible node executable.'
  exit 1
}

& $node (Join-Path $PSScriptRoot 'run-all-regressions.mjs')
exit $LASTEXITCODE
