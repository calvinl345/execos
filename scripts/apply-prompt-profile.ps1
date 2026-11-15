param(
  [ValidateSet("production", "developer", "Production", "Developer")]
  [string]$Profile = "production",
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$profileScript = Join-Path $PSScriptRoot "apply-profile.ps1"
& powershell -ExecutionPolicy Bypass -NoProfile -File $profileScript -Profile $Profile -RepoRoot $RepoRoot
exit $LASTEXITCODE
