[CmdletBinding()]
param(
  [string]$OutputPath = ".superpowers/sdd/2026-08-31-clipboard-shelf-master-audit-and-roadmap/task-0-baseline.json",
  [switch]$Refresh
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packagePath = Join-Path $projectRoot "package.json"
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
  throw "Project package.json is missing: $packagePath"
}
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($package.version)) {
  throw "Project package.json has no version"
}
$artifactNames = @(
  "package.json", "main.cjs", "preload.cjs", "clipboard-shelf.html",
  "library-store.cjs", "markdown-library.cjs", "color-picker.cjs", "ocr-engine.cjs"
)
$excludedRuntimeDirectories = @(
  ".runtime-audit-user-data", ".runtime-smoke-user-data"
)
$historicalOutputPath = Join-Path $projectRoot ".superpowers/sdd/2026-08-31-clipboard-shelf-master-audit-and-roadmap/task-0-baseline.json"

function Resolve-ProjectPath {
  param([string]$Path)

  if ([IO.Path]::IsPathRooted($Path)) {
    return [IO.Path]::GetFullPath($Path)
  }
  return [IO.Path]::GetFullPath((Join-Path $projectRoot $Path))
}

function Assert-PathOutsideRuntimeDirectories {
  param([string]$Path, [string]$Description)

  $candidate = (Resolve-ProjectPath $Path).TrimEnd("\", "/") + [IO.Path]::DirectorySeparatorChar
  foreach ($directory in $excludedRuntimeDirectories) {
    $runtimePath = (Resolve-ProjectPath $directory).TrimEnd("\", "/") + [IO.Path]::DirectorySeparatorChar
    if ($candidate.StartsWith($runtimePath, [StringComparison]::OrdinalIgnoreCase)) {
      throw "$Description cannot be inside excluded runtime directory: $Path"
    }
  }
}

function Invoke-CheckedCommand {
  param([string]$FilePath, [string[]]$Arguments)

  & $FilePath @Arguments *> $null
  return $LASTEXITCODE
}

function Get-Sha256Hex {
  param([string]$FilePath)

  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return -join ($sha256.ComputeHash([IO.File]::ReadAllBytes($FilePath)) | ForEach-Object { $_.ToString("x2") })
  } finally {
    $sha256.Dispose()
  }
}

function Get-ArtifactHashes {
  param([string[]]$Names)

  $hashes = [ordered]@{}
  foreach ($name in $Names) {
    Assert-PathOutsideRuntimeDirectories $name "Baseline artifact"
    $artifactPath = Resolve-ProjectPath $name
    if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
      throw "Missing baseline artifact: $name"
    }

    $hashes[$name] = Get-Sha256Hex $artifactPath
  }
  return $hashes
}

$outputFile = Resolve-ProjectPath $OutputPath
Assert-PathOutsideRuntimeDirectories $OutputPath "Baseline output"
if ($Refresh -and ($outputFile -eq (Resolve-ProjectPath $historicalOutputPath))) {
  throw "Refresh requires a new OutputPath; historical baseline will not be overwritten"
}

Push-Location $projectRoot
try {
  $testExitCode = Invoke-CheckedCommand "npm.cmd" @("test")
  $auditExitCode = Invoke-CheckedCommand "npm.cmd" @("audit", "--omit=dev", "--audit-level=high")
} finally {
  Pop-Location
}
$artifactHashes = Get-ArtifactHashes $artifactNames
$gitCommit = (& git -C $projectRoot rev-parse HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gitCommit)) {
  $gitCommit = "unavailable"
}

$outputDirectory = Split-Path -Parent $outputFile
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$existingBaseline = $null
if (Test-Path -LiteralPath $outputFile -PathType Leaf) {
  $existingBaseline = Get-Content -LiteralPath $outputFile -Raw | ConvertFrom-Json
  foreach ($name in $artifactNames) {
    if (-not $Refresh -and $existingBaseline.artifactSha256.$name -ne $artifactHashes[$name]) {
      throw "Baseline artifact changed unexpectedly: $name"
    }
  }
}
$baseline = [ordered]@{
  schemaVersion = 1
  sourceCommit = $gitCommit
  packageVersion = $package.version
  test = [ordered]@{ command = "npm.cmd test"; exitCode = $testExitCode; passed = ($testExitCode -eq 0) }
  audit = [ordered]@{ command = "npm.cmd audit --omit=dev --audit-level=high"; exitCode = $auditExitCode; passed = ($auditExitCode -eq 0) }
  artifactSha256 = $artifactHashes
  excludedRuntimeDirectories = $excludedRuntimeDirectories
}
$baselineJson = $baseline | ConvertTo-Json -Depth 6
$runtimePaths = $excludedRuntimeDirectories | ForEach-Object { Join-Path $projectRoot $_ }
foreach ($runtimePath in $runtimePaths) {
  if ($baselineJson.Contains($runtimePath)) {
    throw "Baseline evidence must not contain a resolved runtime-data path"
  }
}
$shouldWriteBaseline = $Refresh -or -not (Test-Path -LiteralPath $outputFile -PathType Leaf)
if ($shouldWriteBaseline) {
  $baselineJson | Set-Content -LiteralPath $outputFile -Encoding utf8
}

if ($testExitCode -ne 0 -or $auditExitCode -ne 0) {
  throw "Baseline verification failed: test exit $testExitCode; audit exit $auditExitCode"
}

Write-Output "Baseline verification passed: $OutputPath"
