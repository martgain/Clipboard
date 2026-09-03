param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,
  [int]$TimeoutSeconds = 30
)

$resolvedExecutable = [IO.Path]::GetFullPath($Executable)
if (-not (Test-Path -LiteralPath $resolvedExecutable -PathType Leaf)) {
  Write-Error "Executable does not exist: $resolvedExecutable"
  exit 2
}

$profileRoot = Join-Path ([IO.Path]::GetTempPath()) ("clipboard-shelf-smoke-" + [guid]::NewGuid().ToString("N"))
$process = $null
try {
  $process = Start-Process -FilePath $resolvedExecutable -ArgumentList @("--user-data-dir=$profileRoot") -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Write-Error "Packaged app did not exit within the smoke timeout."
    exit 1
  }
  Write-Output (ConvertTo-Json ([ordered]@{ exitCode = $process.ExitCode; profile = $profileRoot }) -Compress)
  exit $process.ExitCode
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $profileRoot) {
    Remove-Item -LiteralPath $profileRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
