param(
  [ValidateSet("production", "developer", "Production", "Developer")]
  [string]$Profile = "production",
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$materializer = Join-Path $RepoRoot "scripts\installer\materialize.mjs"
if (-not (Test-Path -LiteralPath $materializer -PathType Leaf)) {
  throw "Profile materializer not found: $materializer"
}

& node $materializer apply-profile --profile $Profile --repo-root $RepoRoot
if ($LASTEXITCODE -ne 0) {
  throw "Profile materialization failed."
}
