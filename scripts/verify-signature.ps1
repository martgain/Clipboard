param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$resolvedPath = [IO.Path]::GetFullPath($Path)
if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
  Write-Error "Artifact does not exist: $resolvedPath"
  exit 2
}

$signature = Get-AuthenticodeSignature -LiteralPath $resolvedPath
[ordered]@{
  path = $resolvedPath
  status = [string]$signature.Status
  signer = $signature.SignerCertificate.Subject
  thumbprint = $signature.SignerCertificate.Thumbprint
} | ConvertTo-Json -Compress

if ([string]$signature.Status -ne "Valid") {
  exit 1
}
